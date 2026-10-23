import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newResourceState, upgradeTimingState, checkedResourceState } from '../server/resourceState.mjs';
import { harvestLoot } from '../src/data/harvestLoot.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { database } from './helpers/ground-host-authority-sql.mjs';
import { connect, calmAt, turn } from './helpers/resource-authority-fixture.mjs';

// Torch / resin / coconut composed with the common Ground pilot (real SQL001-037 on PGlite).
// Torch has no operations of its own: its three flavours are ordinary economic-family commands,
// so each one must commit through SQL018/019 (outer receipt), SQL014 (inner receipt) and apply at
// the tick boundary exactly once.
const WORLD = 'torch-ground-host';
const SEED = 97;
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLOCK_ID = 'c4100000-0000-4000-8000-000000000105';
const TICK = 1000;
const MIGRATIONS = ['022_fire_operations', '023_ground_world_adoption', '024_starter_workshop',
  '025_companion_config', '026_workshop_raft_identifiers', '027_companion_control', '028_inference_config',
  '029_attribute_operations', '030_freshwater_operations', '031_gm_terrain_drafts', '032_canteen_survival_operations',
  '033_gm_terrain_materials', '034_companion_creation', '035_special_meal_operations', '036_gm_resource_roster',
  '037_torch_resin_coconut'];
const copy = value => structuredClone(value);
const opKey = opId => economicOperationId(WORLD, ACCOUNT_A, opId);

// The shared Ground fixture ends at SQL021: add the later migrations in order, as production has them.
async function torchDatabase() {
  const f = await database();
  try {
    await f.db.exec('RESET ROLE');
    for (const name of MIGRATIONS)
      await f.db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    await f.db.exec('SET ROLE service_role');
    return f;
  } catch (error) { await f.close(); throw error; }
}

// The shared store maps only the SQL001-021 readiness RPCs; the later probes read the real SQL function.
function torchStore(f) {
  const ready = name => async () => {
    const data = (await f.db.query(`select public.${name}() as data`)).rows[0].data;
    assert.equal(data.version, 1, `${name} reports readiness`);
    return { version: 1 };
  };
  return { ...f.store,
    checkFireOperations: ready('mn_fire_operations_ready'),
    checkStarterWorkshop: ready('mn_starter_workshop_ready'),
    checkFreshwaterOperations: ready('mn_freshwater_operations_ready'),
    checkCanteenOperations: ready('mn_canteen_operations_ready'),
    checkTorchResinCoconutOperations: ready('mn_torch_resin_coconut_ready') };
}

function hostFor(f) {
  return new GameHost({ seed: SEED, bots: 0, log() {}, store: torchStore(f), worldId: WORLD,
    resolvePlayer: async (_request, hello) => hello.name === 'A' ? ACCOUNT_A : hello.name === 'B' ? ACCOUNT_B : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true, artisanOperations: true,
    workshopOperations: true, fireOperations: true, freshwaterOperations: true, canteenOperations: true,
    torchResinCoconutOperations: true, groundTransactions: { journal: f.journal(WORLD) } });
}

async function closeHost(host) {
  if (!host || host.closePromise) return;
  try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
}

function accountProfile(account, { goods = {}, surv = null, axe = true } = {}) {
  const profile = newProfile();
  profile.pirateId = `account:${account}`;
  profile.eco.pack.goods = { ...goods };
  if (axe) profile.tools.axe = 1;
  if (surv) profile.surv = { ...surv };
  return profile;
}

// Seeds the world, both accounts and the SQL013 clock on one durable tick. The palm sits one hit
// before its final blow (rev 3, hits 2) with both accounts in its cooperative ledger.
async function seed(f, { goods = {}, surv = null } = {}) {
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  try {
    const resources = upgradeTimingState(newResourceState(template.server.world));
    resources.tick = TICK;
    const palm = resources.nodes.find(row => row.kind === 'palm' &&
      Object.keys(harvestLoot('palm', row.id, 4)).join(',') === 'resina,coco');
    assert.ok(palm, 'the deterministic layout has a palm whose revision-4 roll yields resin and coconut');
    palm.rev = 3; palm.hits = 2;
    resources.logging[palm.id] = { cycle: 1, quality: 0,
      contributors: [{ actor: ACCOUNT_A, hits: 1 }, { actor: ACCOUNT_B, hits: 1 }] };
    checkedResourceState(resources);
    const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources };
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, data]);
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
      [ACCOUNT_A, accountProfile(ACCOUNT_A, { goods, surv }), ACCOUNT_B, accountProfile(ACCOUNT_B, { axe: false })]);
    assert.equal((await f.store.commitGroundClock({ operationId: CLOCK_ID, world: WORLD,
      expectedVersion: 0, expectedTick: 0, tick: TICK })).ok, true);
    return { palmId: palm.id };
  } finally { await template.close(); }
}

async function start(host, names = ['A']) {
  await host.prepare();
  assert.equal(host.groundAuthority.ready, true);
  const clients = {};
  for (const name of names) {
    const client = connect(host, name); client.hello(); await Promise.all([...host.joins]);
    assert.equal(client.of(MSG.WELCOME).length, 1, `${name} joins from its stored account profile`);
    clients[name] = { client, entity: host.server.clients.get(client.id).entity };
  }
  return clients;
}

async function pump(host, until, what) {
  for (let i = 0; i < 240; i++) {
    const found = until();
    if (found) return found;
    await turn();
    host.server.step();
  }
  assert.fail(`${what}: ${JSON.stringify({ ground: host.groundAuthority.status(), economic: host.economicAuthority.status() })}`);
}

// Sends the command and steps the host until the durable commit is ready, then stops before the next
// step: the apply (and the ACK) stay deferred to the tick boundary, exactly the crash window of the matrix.
async function commitOnly(host, client, command) {
  client.send(command);
  for (let i = 0; i < 480; i++) {
    await turn();
    if (host.economicAuthority.active?.ready) return;
    host.server.step();
  }
  assert.fail(`no durable commit for ${command.opId}: ${JSON.stringify({
    ground: host.groundAuthority.status(), economic: host.economicAuthority.status() })}`);
}

// Full flow: send and drain at the tick boundary until a new ACK for this opId is published.
async function sendAndPump(host, client, command) {
  const seen = client.events(command.opId).length;
  client.send(command);
  return pump(host, () => client.events(command.opId).length > seen && client.events(command.opId).at(-1),
    `no ACK for ${command.opId}`);
}

async function aimAtPalm(host, client, entity, node) {
  calmAt(host, entity, node);
  client.send({ type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
  const aim = await pump(host, () => client.ws.messages.filter(m => m.ev?.type === 'loggingAim').at(-1)?.ev, 'no aim challenge');
  assert.equal(aim.ok, true, JSON.stringify(aim));
  const receivedAt = aim.challenge.targetTick + 6; // late but valid: the yield stays at three logs
  await pump(host, () => host.worldState.resourceTick() >= receivedAt, 'resource clock did not reach the challenge window');
  assert.equal(host.worldState.resourceTick(), receivedAt);
  return aim;
}

const palmFinalHit = (opId, node, challenge) => ({ type: 'resource', op: 'gather', opId, node: node.id,
  expectedRev: node.rev, challenge: challenge.challengeId, lootRules: 1 });
const handTorch = (opId, expectedRev) => ({ type: 'fire', op: 'load', opId, ship: '', part: 'hand',
  kind: 'handTorch', expectedRev, lit: true, rules: 2 });
const eatCoconut = (opId, expectedRev) => ({ type: 'freshwater', op: 'eat', opId, expectedRev,
  source: 'coco', ship: '', part: '', n: 1 });

async function rows(f, opId) {
  const operationId = opKey(opId);
  const outer = (await f.db.query('select request,result from public.mn_ground_transactions where operation_id=$1::uuid', [operationId])).rows;
  const inner = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).rows;
  const intents = (await f.db.query('select state from public.mn_ground_transaction_intents where operation_id=$1::uuid', [operationId])).rows;
  return { outer, inner, intents };
}

function setup(t, hostSeed) {
  const state = { f: null, host: null, restarted: null };
  t.after(async () => { await closeHost(state.host); await closeHost(state.restarted); await state.f?.close(); });
  return { state, async open(names = ['A']) {
    state.f = await torchDatabase();
    state.seeded = await seed(state.f, hostSeed);
    state.host = hostFor(state.f);
    return { f: state.f, host: state.host, ...await start(state.host, names), palmId: state.seeded.palmId };
  } };
}

test('A: handTorch load rules 2 commits through the ground journal and spends 2 tronco + 1 resina once', async t => {
  const s = setup(t, { goods: { tronco: 3, resina: 2, coco: 1 } });
  const { f, host, A } = await s.open();
  const live = host.server.world.profiles.get(A.entity);
  const command = handTorch('torch-ground-load', live.fire?.rev ?? 0);
  const ack = await sendAndPump(host, A.client, command);
  assert.equal(ack.type, 'fire');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.deepEqual(live.eco.pack.goods, { tronco: 1, resina: 1, coco: 1 }, 'cost is exactly 2 tronco + 1 resina');
  assert.equal(live.eco.pack.goods.madera, undefined, 'the versioned recipe never debits legacy planks');
  assert.equal(live.fire.slots.hand.kind, 'handTorch');
  assert.equal(live.fire.slots.hand.lit, true);

  const { outer, inner, intents } = await rows(f, command.opId);
  assert.equal(outer.length, 1);
  assert.equal(outer[0].request.family, 'economic');
  assert.equal(outer[0].request.operation.command.type, 'fire');
  assert.equal(outer[0].request.operation.command.rules, 2);
  assert.equal(outer[0].result.effect.ack.opId, command.opId);
  assert.equal(inner.length, 1);
  assert.equal(inner[0].request.command.kind, 'handTorch');
  assert.equal(inner[0].request.command.rules, 2);
  assert.deepEqual(inner[0].request.before.eco.pack.goods, { tronco: 3, resina: 2, coco: 1 });
  assert.deepEqual(inner[0].request.profile.eco.pack.goods, { tronco: 1, resina: 1, coco: 1 });
  assert.deepEqual(intents.map(row => row.state), ['committed']);
  assert.equal(host.groundAuthority.status().failed, false);

  const settled = copy(live);
  const resent = await sendAndPump(host, A.client, command);
  assert.equal(resent.replay, true, 'a resend with the same opId is a receipt replay');
  assert.deepEqual(live, settled, 'the replay never debits a second set of fuel');
  const again = await rows(f, command.opId);
  assert.equal(again.outer.length, 1); assert.equal(again.inner.length, 1);
});

test('B: marked palm final hit with beneficiaries commits the deterministic loot under ground', async t => {
  const s = setup(t, {});
  const { f, host, A, B, palmId } = await s.open(['A', 'B']);
  const node = host.server.world.resources.nodes.get(palmId);
  assert.equal(node.rev, 3); assert.equal(node.hits, 2);
  const live = host.server.world.profiles.get(A.entity);
  assert.deepEqual(live.eco.pack.goods, {});
  const expected = harvestLoot(node.kind, node.id, node.rev + 1);
  assert.deepEqual(expected, { resina: 1, coco: 1 });

  const aim = await aimAtPalm(host, A.client, A.entity, node);
  const command = palmFinalHit('torch-ground-palm', node, aim);
  const ack = await sendAndPump(host, A.client, command);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.good, 'tronco'); assert.equal(ack.count, 3);
  assert.deepEqual(ack.loot, expected, 'the ACK carries the deterministic roll');
  assert.deepEqual(live.eco.pack.goods, { tronco: 3, ...expected }, 'loot equals harvestLoot(kind, node.id, finalRev)');
  assert.equal(node.rev, 4); assert.equal(node.hits, 3);
  const savedNode = host.worldState.resources.nodes.find(row => row.id === palmId);
  assert.equal(savedNode.rev, 4); assert.equal(savedNode.hits, 3);

  const { outer, inner, intents } = await rows(f, command.opId);
  assert.equal(outer.length, 1); assert.equal(inner.length, 1);
  assert.equal(outer[0].request.operation.command.lootRules, 1);
  assert.equal(inner[0].request.command.lootRules, 1);
  assert.deepEqual(inner[0].request.ack.loot, expected);
  assert.deepEqual(inner[0].request.beneficiaries.map(row => row.account), [ACCOUNT_A, ACCOUNT_B]);
  assert.deepEqual(intents.map(row => row.state), ['committed']);
  const contributor = host.server.world.profiles.get(B.entity);
  assert.deepEqual(contributor.eco.pack.goods, {}, 'the cooperative contributor receives practice, never the actor loot');
  const persistedB = (await f.store.loadProfile(ACCOUNT_B)).data;
  assert.ok(persistedB.progression.practice.logging > 0, 'the earlier contributor receives the durable practice award');
  assert.equal(host.groundAuthority.status().failed, false);
});

test('C: coconut eat under ground consumes one coco and restores 25 hydration capped at 100', async t => {
  const s = setup(t, { goods: { coco: 2 }, surv: { v: 1, sat: 42, hyd: 60 } });
  const { f, host, A } = await s.open();
  const live = host.server.world.profiles.get(A.entity);

  const first = eatCoconut('torch-ground-coco-1', live.eco.tradeRev);
  const ackOne = await sendAndPump(host, A.client, first);
  assert.equal(ackOne.ok, true, JSON.stringify(ackOne));
  assert.equal(live.eco.pack.goods.coco, 1, 'one coconut consumed');
  const one = await rows(f, first.opId);
  assert.equal(one.outer.length, 1); assert.equal(one.inner.length, 1);
  assert.equal(one.outer[0].request.operation.command.source, 'coco');
  assert.equal(one.inner[0].request.before.surv.hyd, 60);
  assert.deepEqual(one.inner[0].request.profile.surv, { v: 1, sat: 42, hyd: 85 }, '+25 hydration, saturation untouched');
  assert.equal(live.surv.sat, 42);

  const second = eatCoconut('torch-ground-coco-2', live.eco.tradeRev);
  const ackTwo = await sendAndPump(host, A.client, second);
  assert.equal(ackTwo.ok, true, JSON.stringify(ackTwo));
  assert.equal(live.eco.pack.goods.coco, undefined);
  const two = await rows(f, second.opId);
  assert.equal(two.inner[0].request.before.surv.hyd, 85);
  assert.deepEqual(two.inner[0].request.profile.surv, { v: 1, sat: 42, hyd: 100 }, 'hydration clamps at the cap');
  assert.equal(live.surv.hyd, 100);

  const settled = copy(live);
  assert.equal((await sendAndPump(host, A.client, second)).replay, true);
  assert.deepEqual(live, settled, 'a resend never consumes a second coconut');
  assert.equal((await rows(f, second.opId)).inner.length, 1);
  assert.equal(host.groundAuthority.status().failed, false);
});

test('D: a host stopped after the palm commit and before its apply recovers it exactly once on a fresh host', async t => {
  const s = setup(t, {});
  const { f, host, A, palmId } = await s.open(['A', 'B']);
  const node = host.server.world.resources.nodes.get(palmId);
  const live = host.server.world.profiles.get(A.entity);
  const expected = harvestLoot(node.kind, node.id, node.rev + 1);
  const aim = await aimAtPalm(host, A.client, A.entity, node);
  const command = palmFinalHit('torch-ground-recover', node, aim);

  await commitOnly(host, A.client, command);
  assert.equal(A.client.events(command.opId).length, 0, 'no ACK publishes before the tick boundary');
  assert.deepEqual(live.eco.pack.goods, {}, 'the live profile still has no loot: the commit is durable but not applied');
  assert.equal(node.rev, 3);
  const committed = await rows(f, command.opId);
  assert.equal(committed.outer.length, 1); assert.equal(committed.inner.length, 1);
  assert.deepEqual(committed.inner[0].request.ack.loot, expected);
  const persistedBefore = (await f.store.loadProfile(ACCOUNT_A)).data;
  assert.deepEqual(persistedBefore.eco.pack.goods, { tronco: 3, ...expected });
  const worldBefore = await f.store.loadWorld(WORLD);

  await closeHost(host); // the old process stops here: its apply never ran
  const restarted = hostFor(f);
  s.state.restarted = restarted;
  const { A: resumed } = await start(restarted, ['A']);
  const liveAfter = restarted.server.world.profiles.get(resumed.entity);
  assert.deepEqual(liveAfter.eco.pack.goods, { tronco: 3, ...expected }, 'recovery restores the committed loot once, without a re-roll');
  const nodeAfter = restarted.server.world.resources.nodes.get(palmId);
  assert.equal(nodeAfter.rev, 4); assert.equal(nodeAfter.hits, 3);
  assert.deepEqual((await f.store.loadWorld(WORLD)).data.resources.nodes.find(row => row.id === palmId),
    worldBefore.data.resources.nodes.find(row => row.id === palmId));

  const settled = copy(liveAfter);
  const worldVersion = restarted.worldState.version;
  const resent = await sendAndPump(restarted, resumed.client, command);
  assert.equal(resent.replay, true, 'the resend with the same opId is answered from the receipt');
  assert.deepEqual(liveAfter, settled, 'the resend adds no loot and spends nothing');
  assert.equal(restarted.worldState.version, worldVersion);
  assert.equal(nodeAfter.rev, 4);
  const after = await rows(f, command.opId);
  assert.equal(after.outer.length, 1); assert.equal(after.inner.length, 1);
  assert.deepEqual(after.inner[0].request.ack.loot, expected);
  assert.deepEqual(after.intents.map(row => row.state), ['committed']);
  assert.deepEqual((await f.store.loadProfile(ACCOUNT_A)).data.eco.pack.goods, { tronco: 3, ...expected });
  assert.equal(restarted.groundAuthority.status().failed, false);
});
