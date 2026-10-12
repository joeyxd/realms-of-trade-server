import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { C } from '../src/sim/ecs.js';
import { createLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { draftResource } from '../server/resourceState.mjs';
import { loggingParticipants } from '../server/loggingOperation.mjs';

const ACCOUNT = 'aaaa0000-0000-4000-8000-000000000001';
const CONTRIBUTOR = 'bbbb0000-0000-4000-8000-000000000002';
const OP = 'f0000000-0000-4000-8000-000000000001';
const WORLD_ID = 'torch-resin-sql-world';
const SEED = 314;
const TOWNS = ['aldea', 'cala', 'sol', 'ceniza', 'corona', 'coral'];
const copy = value => structuredClone(value);

function profile(goods = {}, extra = {}) {
  return { v: 1, lvl: 1, carry: { v: 1, backpack: 0 }, ...extra,
    eco: { tradeRev: 0, pack: { cap: 18, maxMass: 18, goods }, ships: [] } };
}
function world() {
  return { v: 1, seed: 314, economy: { v: 2,
    markets: Object.fromEntries(TOWNS.map(id => [id, { id, stock: {}, last: {} }])),
    plots: Object.fromEntries(TOWNS.map(id => [id, []])) } };
}
function roll(node, rev, good) {
  let h = 17;
  for (const ch of `${node}:${rev}:${good}`) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  return h % 100 < (good === 'resina' ? 35 : 40);
}
function expectedLoot(node, rev) {
  const loot = {};
  if (roll(node, rev, 'resina')) loot.resina = 1;
  if (roll(node, rev, 'coco')) loot.coco = 1;
  return loot;
}
function palmWorld(node = 'palm-1', rev = 3, final = true) {
  return { ...world(), resources: { v: 3, tick: 100,
    nodes: [{ id: node, kind: 'palm', rev, hits: final ? 3 : 2, readyAt: final ? 3700 : 0 }],
    cooldowns: {}, logging: { [node]: { cycle: 1, contributors: [], quality: 0 } } } };
}

function seededProfile(goods = {}) {
  const p = newProfile();
  p.tools.axe = 1;
  p.carry.backpack = 2;
  p.lvl = 10;
  p.attr = { v: 1, carga: 9, re: 0 };
  p.eco.pack.goods = copy(goods);
  return sanitizeProfile(p);
}

function palmV3State({ hits = 2, rev = 3, tick = 100 } = {}) {
  return { v: 3, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev, hits,
    readyAt: hits === 3 ? tick + 3600 : 0 }], cooldowns: {}, logging: { 'palm-1': {
      cycle: 1, contributors: hits ? [{ actor: ACCOUNT, hits: 1 }, ...(hits > 1 ? [{ actor: CONTRIBUTOR, hits: hits - 1 }] : [])] : [], quality: 0,
    } } };
}

function palmSimulation(state, actorProfile, lootEnabled = true) {
  const vector = () => new Float64Array(3);
  const world = { tick: 100, economy: new Economy(SEED), map: { groundAt: () => 2, onDock: () => false },
    raftDeck: { surface: () => null }, ecs: { alive: new Uint8Array(3), dead: vector(), mask: new Uint16Array(3),
      hp: vector(), x: vector(), y: vector(), z: vector(), moveMag: vector(), vx: vector(), vz: vector(),
      dashT: new Float64Array(3).fill(-1), dashBuffer: vector(), castK: vector(), castLock: vector(),
      atkStage: vector(), regenT: new Float64Array(3).fill(100) }, profiles: new Map([[1, copy(actorProfile)]]),
    profileDirty: new Set(), harvestLootEnabled: lootEnabled, loggingTimingVersion: state.v === 3 ? 3 : undefined,
    resources: { nodes: new Map([['palm-1', { id: 'palm-1', kind: 'palm', x: 0, y: 2, z: 0,
      rev: state.nodes[0].rev, hits: state.nodes[0].hits, readyTick: 0 }]]), cooldowns: new Map(), receipts: new Map(), bench: null } };
  world.ecs.alive[1] = 1; world.ecs.mask[1] = C.PLAYER; world.ecs.hp[1] = 100; world.ecs.y[1] = 2;
  return world;
}

function draftPalmReceipt({ state = palmV3State(), operationId = 'palm-final', worldId = WORLD_ID,
  actorGoods = { resina: 2, coco: 2 }, contributorGoods = { resina: 4, coco: 3 }, marked = true,
  lootEnabled = true } = {}) {
  const simulationActor = seededProfile({});
  const beforeContributor = seededProfile(contributorGoods);
  const sim = palmSimulation(state, simulationActor, lootEnabled);
  const challenge = createLoggingChallenge({ node: 'palm-1', rev: state.nodes[0].rev, startTick: 100, practice: 0 });
  const receivedTick = challenge.targetTick;
  const timing = { challenge, receivedTick, quality: 1 };
  const command = { type: 'resource', op: 'gather', opId: operationId, node: 'palm-1',
    expectedRev: state.nodes[0].rev, challenge: `challenge-${operationId}`,
    ...(marked ? { lootRules: 1 } : {}) };
  const proposal = draftResource(sim, 1, command, simulationActor, state, ACCOUNT, receivedTick,
    new Map([[ACCOUNT, simulationActor], [CONTRIBUTOR, beforeContributor]]), timing);
  assert.equal(proposal.ack.ok, true, JSON.stringify(proposal.ack));
  const baseWorld = { v: 1, seed: SEED, economy: new Economy(SEED).serialize() };
  const afterProfiles = new Map(proposal.profiles);
  const beforeActor = seededProfile(actorGoods);
  const afterActor = copy(proposal.profile);
  afterActor.eco.pack.goods = { ...proposal.profile.eco.pack.goods };
  for (const [good, amount] of Object.entries(actorGoods))
    afterActor.eco.pack.goods[good] = (afterActor.eco.pack.goods[good] ?? 0) + amount;
  afterProfiles.set(ACCOUNT, afterActor);
  const request = { world: worldId, account: ACCOUNT,
    command, expectedProfileVersion: 1, expectedWorldVersion: 1,
    profile: afterActor, worldData: { ...baseWorld, resources: proposal.resources }, ack: proposal.ack,
    beneficiaries: [...afterProfiles].sort(([a], [b]) => a.localeCompare(b)).map(([account, profile]) => ({
      account, expectedVersion: 1, before: account === ACCOUNT ? beforeActor : beforeContributor, profile,
    })) };
  loggingParticipants(request);
  return { request, state, beforeActor, beforeContributor, sim };
}

async function seedRpc(f, request, currentWorldData, currentProfile = request.before ?? request.profile) {
  const rows = request.beneficiaries ?? [{ account: ACCOUNT, before: currentProfile, expectedVersion: 1 }];
  for (const row of rows)
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [row.account, row.before]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)',
    [request.world, currentWorldData]);
  await f.db.exec('SET ROLE service_role');
}

async function commitRpc(f, operationId, request) {
  return (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result',
    [operationId, request])).rows[0].result;
}

function initialPalmWorld(request, initialState) {
  return { ...request.worldData, resources: copy(initialState) };
}

async function database({ through036 = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    const names = ['001_store','002_accounts','003_pearl_operations','004_pearl_ground','005_pearl_journal','006_pearl_same_holder',
      '007_pearl_batch','008_pearl_batch_journal','009_death_operations','010_death_journal','011_death_drop_lifecycle',
      '012_death_drop_journal','013_ground_clock','014_economic_operations','015_resource_operations','016_logging_operations',
      '017_agent_goods_budget','018_ground_transactions','019_ground_transaction_journal','020_gm_drafts','021_artisan_operations',
      '022_fire_operations','023_ground_world_adoption','024_starter_workshop','025_companion_config',
      '026_workshop_raft_identifiers','027_companion_control','028_inference_config','029_attribute_operations',
      '030_freshwater_operations','031_gm_terrain_drafts','032_canteen_survival_operations','033_gm_terrain_materials',
      '034_companion_creation','035_special_meal_operations','036_gm_resource_roster','037_torch_resin_coconut'];
    for (const name of through036 ? names.slice(0, -1) : names)
      await db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    return { db, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

function closeAfterEach(t, f) {
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await f.close(); } };
  t.after(close);
  return close;
}

test('SQL037 is rerunnable, reports readiness only to service_role, and preserves old migration capabilities', async t => {
  const f = await database(); t.after(() => f.close());
  const migration = await readFile(new URL('../server/migrations/037_torch_resin_coconut.sql', import.meta.url), 'utf8');
  await f.db.exec(migration);
  assert.equal((await f.db.query(`select public.mn_starter_valid_goods('{"resina":1,"coco":1}'::jsonb,18,18) ok`)).rows[0].ok, true);
  assert.equal((await f.db.query(`select public.mn_starter_valid_pack_036('{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{}},"ships":[]}}'::jsonb) ok`)).rows[0].ok, true);
  assert.equal((await f.db.query(`select public.mn_starter_valid_pack('{"v":1,"lvl":1,"carry":{"v":1,"backpack":0},"eco":{"tradeRev":0,"pack":{"cap":18,"maxMass":18,"goods":{"resina":1,"coco":1}},"ships":[]}}'::jsonb) ok`)).rows[0].ok, true);
  assert.equal((await f.db.query("select public.mn_starter_valid_goods('{\"resina\":1,\"coco\":1}'::jsonb,2,1) ok")).rows[0].ok, true);
  assert.equal((await f.db.query("select public.mn_starter_valid_goods('{\"resina\":1,\"coco\":1}'::jsonb,1,1) ok")).rows[0].ok, false);
  assert.equal((await f.db.query("select public.mn_torch_loot_roll('palm-1',2,NULL) ok")).rows[0].ok, false,
    'malformed loot goods fail closed');
  const pack = profile({ resina: 1, coco: 1 });
  assert.equal((await f.db.query('select public.mn_starter_valid_pack($1::jsonb) ok', [pack])).rows[0].ok, true);
  pack.eco.pack.goods = { coco: 19 };
  assert.equal((await f.db.query('select public.mn_starter_valid_pack($1::jsonb) ok', [pack])).rows[0].ok, false);
  const fireWorld = world(); fireWorld.economy.hours = 0;
  const fireBefore = profile({ tronco: 3, resina: 1, madera: 1 });
  const fireAfter = copy(fireBefore); fireAfter.eco.pack.goods = { tronco: 1, madera: 1 }; fireAfter.eco.tradeRev = 1;
  fireAfter.fire = { v: 1, rev: 1, slots: { hand: { kind: 'handTorch', seconds: 1200, since: 0, lit: true } } };
  const fireRequest = { world: 'torch-ready', account: ACCOUNT,
    command: { type: 'fire', op: 'load', opId: 'ready-torch', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true, rules: 2 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, before: fireBefore, profile: fireAfter,
    worldData: fireWorld, ack: { type: 'fire', op: 'load', opId: 'ready-torch', ok: true, why: '', rev: 1 } };
  const fireCheck = await f.db.query('select public.mn_valid_fire_transition($1::jsonb,$2::jsonb) ok', [fireRequest, fireWorld]);
  assert.equal(fireCheck.rows[0].ok, true, 'readiness fixture should exercise the versioned hand torch validator');
  const cocoBefore = profile({ coco: 2, fruta: 3 }, { surv: { v: 1, sat: 47, hyd: 20 } }); cocoBefore.eco.pack.vessels = [];
  const cocoAfter = copy(cocoBefore); cocoAfter.eco.pack.goods.coco = 1; cocoAfter.eco.tradeRev = 1; cocoAfter.surv.hyd = 45;
  const cocoRequest = { command: { type: 'freshwater', op: 'eat', opId: 'ready-coco', expectedRev: 0,
    source: 'coco', ship: '', part: '', n: 1 }, before: cocoBefore, profile: cocoAfter,
    ack: { type: 'freshwater', op: 'eat', opId: 'ready-coco', ok: true, why: '', rev: 1 } };
  const cocoCheck = await f.db.query('select public.mn_torch_coconut_transition($1::jsonb) ok', [cocoRequest]);
  assert.equal(cocoCheck.rows[0].ok, true, 'readiness fixture should exercise coconut hydration and consumption');
  assert.deepEqual((await f.db.query('select public.mn_torch_resin_coconut_ready() as ready')).rows[0].ready, { version: 1 });
  const acl = (await f.db.query(`select has_function_privilege('service_role','public.mn_torch_resin_coconut_ready()','EXECUTE') service,
    has_function_privilege('service_role','public.mn_torch_loot_normalize(jsonb,jsonb)','EXECUTE') helper,
    has_function_privilege('anon','public.mn_torch_resin_coconut_ready()','EXECUTE') anon,
    has_function_privilege('authenticated','public.mn_torch_resin_coconut_ready()','EXECUTE') authenticated`)).rows[0];
  assert.deepEqual(acl, { service: true, helper: true, anon: false, authenticated: false });
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual((await f.db.query('select public.mn_torch_resin_coconut_ready() ready')).rows[0].ready, { version: 1 });
  await f.db.exec('RESET ROLE');
});

test('SQL037 derives final palm loot, strips only verified awards, and preserves pre-existing goods and beneficiaries', async t => {
  const f = await database(); t.after(() => f.close());
  const node = 'palm-4', rev = 3, loot = expectedLoot(node, rev);
  assert.ok(Object.keys(loot).length > 0, 'fixture revision exercises at least one bonus');
  const before = profile({ tronco: 2, resina: 4, coco: 6 });
  const afterGoods = { ...before.eco.pack.goods, tronco: 4,
    ...(loot.resina ? { resina: 5 } : {}), ...(loot.coco ? { coco: 7 } : {}) };
  const after = profile(afterGoods);
  after.eco.tradeRev = 1;
  const request = { world: 'loot-sql', account: ACCOUNT, command: { type: 'resource', op: 'gather', opId: 'loot-1', node, expectedRev: rev - 1, challenge: 'challenge', lootRules: 1 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, before, profile: after, worldData: palmWorld(node, rev),
    ack: { type: 'resource', op: 'gather', opId: 'loot-1', ok: true, why: '', rev, good: 'tronco', count: 3,
      ...(Object.keys(loot).length ? { loot } : {}) } };
  const actorRow = { account: ACCOUNT, expectedVersion: 1, before, profile: after };
  request.beneficiaries = [actorRow];
  const normalized = (await f.db.query('select public.mn_torch_loot_normalize($1::jsonb) as value', [request])).rows[0].value;
  assert.ok(normalized, 'valid deterministic award normalizes');
  assert.equal(normalized.ack.loot, undefined);
  assert.deepEqual(normalized.before.eco.pack.goods, before.eco.pack.goods, 'before goods stay untouched');
  assert.deepEqual(normalized.profile.eco.pack.goods, { ...before.eco.pack.goods, tronco: 4 }, 'only the palm log yield remains in the legacy delta');
  assert.deepEqual(normalized.beneficiaries[0].profile.eco.pack.goods, normalized.profile.eco.pack.goods,
    'the actor row receives the same projected profile');

  const forged = copy(request); forged.ack.loot = { ...loot, resina: (loot.resina ?? 0) + 1 };
  assert.equal((await f.db.query('select public.mn_torch_loot_normalize($1::jsonb) as value', [forged])).rows[0].value, null,
    'a fabricated or incomplete award is rejected');
  const wrongAmount = copy(request); wrongAmount.ack.loot = { ...loot, ...(loot.resina ? { resina: 2 } : { resina: 1 }) };
  assert.equal((await f.db.query('select public.mn_torch_loot_normalize($1::jsonb) as value', [wrongAmount])).rows[0].value, null);
  const nonFinal = copy(request); nonFinal.worldData = palmWorld(node, rev, false);
  assert.equal((await f.db.query('select public.mn_torch_loot_normalize($1::jsonb) as value', [nonFinal])).rows[0].value, null,
    'loot cannot attach to a non-final hit');
  const wrongRevision = copy(request); wrongRevision.ack.rev++;
  assert.equal((await f.db.query('select public.mn_torch_loot_normalize($1::jsonb) as value', [wrongRevision])).rows[0].value, null);
});

test('SQL037 commits marked final palm loot atomically, replays exactly, and preserves historical unmarked receipts', async t => {
  const f = await database(); t.after(() => f.close());
  const drafted = draftPalmReceipt({ operationId: 'palm-rpc-final' });
  const request = drafted.request;
  const expected = expectedLoot('palm-1', 4);
  assert.deepEqual(request.ack.loot, expected);
  const initialWorldData = initialPalmWorld(request, drafted.state);
  await seedRpc(f, request, initialWorldData);

  const forged = copy(request);
  forged.ack.loot = { ...expected, forged: 1 };
  assert.deepEqual(await commitRpc(f, OP, forged), { ok: false, why: 'operation' },
    'the composed RPC rejects an extra fabricated good');

  const committed = await commitRpc(f, OP, request);
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(committed.replay, false);
  assert.deepEqual(await commitRpc(f, OP, request), { ...committed, replay: true }, 'same request replays its exact receipt');
  const alteredReplay = copy(request); alteredReplay.ack.loot = { resina: 1 };
  assert.deepEqual(await commitRpc(f, OP, alteredReplay), { ok: false, why: 'operation' });
  await f.db.exec('RESET ROLE');
  const storedActor = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
  assert.equal(storedActor.version, 2);
  assert.deepEqual(storedActor.data.eco.pack.goods, request.profile.eco.pack.goods);
  const storedContributor = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [CONTRIBUTOR])).rows[0];
  assert.equal(storedContributor.version, 2);
  assert.equal(storedContributor.data.eco.pack.goods.resina, 4);
  assert.equal(storedContributor.data.eco.pack.goods.coco, 3);
  await f.db.exec('SET ROLE service_role');

  // A request committed under SQL036 has neither the new command marker nor loot fields.
  const legacy = await database({ through036: true }); t.after(() => legacy.close());
  const old = draftPalmReceipt({ operationId: 'palm-rpc-old', actorGoods: {}, contributorGoods: {}, marked: false, lootEnabled: false });
  const oldRequest = old.request;
  const legacyWorld = initialPalmWorld(oldRequest, old.state);
  await seedRpc(legacy, oldRequest, legacyWorld);
  const oldId = 'f0000000-0000-4000-8000-000000000002';
  const oldResult = await commitRpc(legacy, oldId, oldRequest);
  assert.equal(oldResult.ok, true, JSON.stringify(oldResult));
  await legacy.db.exec('RESET ROLE');
  await legacy.db.exec(await readFile(new URL('../server/migrations/037_torch_resin_coconut.sql', import.meta.url), 'utf8'));
  await legacy.db.exec('SET ROLE service_role');
  assert.deepEqual(await commitRpc(legacy, oldId, oldRequest), { ...oldResult, replay: true },
    'the new CHECK accepts and preserves pre-migration receipts without loot markers');
});

test('SQL037 rejects deterministic palm loot on a nonfinal marked hit through the composed RPC', async t => {
  const f = await database(); t.after(() => f.close());
  const drafted = draftPalmReceipt({ state: palmV3State({ hits: 1, rev: 2 }), operationId: 'palm-rpc-nonfinal' });
  const request = drafted.request;
  assert.equal(request.ack.loot, undefined);
  request.ack.loot = { resina: 1 };
  const initialWorldData = initialPalmWorld(request, drafted.state);
  await seedRpc(f, request, initialWorldData);
  assert.deepEqual(await commitRpc(f, 'f0000000-0000-4000-8000-000000000003', request), { ok: false, why: 'operation' });
});

test('coconut eating consumes exactly one unit and restores 25 hydration through the existing survival receipt', async t => {
  const f = await database(); t.after(() => f.close());
  const before = profile({ coco: 2, fruta: 3 }, { surv: { v: 1, sat: 47, hyd: 20 } });
  before.eco.pack.vessels = [];
  const after = copy(before); after.eco.pack.goods.coco = 1; after.eco.tradeRev = 1;
  after.surv = { v: 1, sat: 47, hyd: 45 };
  const command = { type: 'freshwater', op: 'eat', opId: 'eat-coco', expectedRev: 0,
    source: 'coco', ship: '', part: '', n: 1 };
  const request = { world: 'coco-sql', account: ACCOUNT, command, expectedProfileVersion: 1, expectedWorldVersion: 1,
    before, profile: after, worldData: world(),
    ack: { type: 'freshwater', op: 'eat', opId: command.opId, ok: true, why: '', rev: 1 } };
  assert.equal((await f.db.query('select public.mn_freshwater_request($1::uuid,$2::jsonb) ok', [OP, request])).rows[0].ok, true);
  await f.db.exec('SET ROLE service_role');
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [request])).rows[0].ok, true);
  await f.db.exec('RESET ROLE');
  const fake = copy(request); fake.command.source = 'fruta';
  fake.before.eco.pack.goods = { fruta: 5 }; fake.before.eco.pack.vessels = [];
  fake.profile.eco.pack.goods = { fruta: 4 }; fake.profile.eco.pack.vessels = [];
  fake.profile.surv = { v: 1, sat: 62, hyd: 30 };
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition_036($1::jsonb) ok', [fake])).rows[0].ok, true);
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [request])).rows[0].ok, true);
  const forgedHydration = copy(request); forgedHydration.profile.surv.hyd = 46;
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [forgedHydration])).rows[0].ok, false);
  const forgedSatiety = copy(request); forgedSatiety.profile.surv.sat = 62;
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [forgedSatiety])).rows[0].ok, false);
  const noCoconut = copy(request); noCoconut.before.eco.pack.goods.coco = 0;
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [noCoconut])).rows[0].ok, false);

  await seedRpc(f, request, request.worldData);
  const rpcId = 'f0000000-0000-4000-8000-000000000004';
  const forgedRpc = copy(request); forgedRpc.profile.surv.hyd = 46;
  assert.equal((await commitRpc(f, rpcId, forgedRpc)).ok, false);
  const committed = await commitRpc(f, rpcId, request);
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.deepEqual(await commitRpc(f, rpcId, request), { ...committed, replay: true });
  await f.db.exec('RESET ROLE');
  const saved = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.data.surv, { v: 1, sat: 47, hyd: 45 });
  assert.equal(saved.data.eco.pack.goods.coco, 1);

  const boundary = await database(); t.after(() => boundary.close());
  const heavyBefore = profile({ coco: 12, piedra: 2 }, { surv: { v: 1, sat: 47, hyd: 20 } });
  heavyBefore.eco.pack.vessels = [];
  const heavyAfter = copy(heavyBefore); heavyAfter.eco.pack.goods.coco = 11;
  heavyAfter.eco.tradeRev = 1; heavyAfter.surv.hyd = 45;
  const heavyRequest = { world: 'coco-heavy', account: ACCOUNT,
    command: { ...command, opId: 'eat-heavy-coco' }, expectedProfileVersion: 1, expectedWorldVersion: 1,
    before: heavyBefore, profile: heavyAfter, worldData: world(),
    ack: { type: 'freshwater', op: 'eat', opId: 'eat-heavy-coco', ok: true, why: '', rev: 1 } };
  assert.equal((await boundary.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [heavyRequest])).rows[0].ok, true,
    'projection to fruit must not double coconut mass at a near-limit cargo');
  const heavyChecks = await boundary.db.query(`select public.mn_valid_economic_request($1::uuid,$2::jsonb) valid,
    public.mn_freshwater_request($1::uuid,$2::jsonb) request_valid`, ['f0000000-0000-4000-8000-000000000008', heavyRequest]);
  await seedRpc(boundary, heavyRequest, heavyRequest.worldData);
  const heavyResult = await commitRpc(boundary, 'f0000000-0000-4000-8000-000000000008', heavyRequest);
  assert.equal(heavyResult.ok, true, JSON.stringify({ heavyResult, checks: heavyChecks.rows[0] }));
  const noHydration = copy(heavyRequest);
  noHydration.before.surv.hyd = 100; noHydration.profile.surv.hyd = 100;
  assert.equal((await boundary.db.query('select public.mn_torch_coconut_transition($1::jsonb) ok', [noHydration])).rows[0].ok, false,
    'eating a coconut at full hydration is not a valid consumption');
  const overCapacity = copy(heavyRequest);
  overCapacity.before.eco.pack.goods.piedra = 4;
  overCapacity.profile.eco.pack.goods.piedra = 4;
  assert.equal((await boundary.db.query('select public.mn_starter_valid_pack($1::jsonb) ok', [overCapacity.before])).rows[0].ok, false,
    'fixture exceeds the real pack mass/volume bounds');
  assert.equal((await boundary.db.query('select public.mn_torch_coconut_transition($1::jsonb) ok', [overCapacity])).rows[0].ok, false,
    'internal fruit projection cannot hide an over-cap real profile');
});

test('versioned hand torch costs two logs and resin while historic torch and raft fuel keep the plank rule', async t => {
  const f = await database(); t.after(() => f.close());
  const worldData = world(); worldData.economy.hours = 0;
  const before = profile({ tronco: 5, resina: 2, madera: 3 });
  const makeRequest = (rules, goods) => {
    const after = copy(before); after.eco.pack.goods = goods; after.eco.tradeRev = 1;
    after.fire = { v: 1, rev: 1, slots: { hand: { kind: 'handTorch', seconds: 1200, since: 0, lit: true } } };
    const command = { type: 'fire', op: 'load', opId: 'torch-load', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true,
      ...(rules === undefined ? {} : { rules }) };
    return { world: 'torch-sql', account: ACCOUNT, command, expectedProfileVersion: 1, expectedWorldVersion: 1,
      before, profile: after, worldData, ack: { type: 'fire', op: 'load', opId: 'torch-load', ok: true, why: '', rev: 1 } };
  };
  const newTorch = makeRequest(2, { tronco: 3, resina: 1, madera: 3 });
  assert.equal((await f.db.query('select public.mn_valid_fire_transition($1::jsonb,$2::jsonb) ok', [newTorch, worldData])).rows[0].ok, true);
  await f.db.exec('SET ROLE service_role');
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [OP, newTorch])).rows[0].ok, true);
  await f.db.exec('RESET ROLE');
  const noResin = makeRequest(2, { tronco: 3, madera: 4 });
  assert.equal((await f.db.query('select public.mn_valid_fire_transition($1::jsonb,$2::jsonb) ok', [noResin, worldData])).rows[0].ok, false);
  const legacy = makeRequest(undefined, { tronco: 5, resina: 2, madera: 2 });
  assert.equal((await f.db.query('select public.mn_valid_fire_transition($1::jsonb,$2::jsonb) ok', [legacy, worldData])).rows[0].ok, true);
  const forgedRule = makeRequest(1, { tronco: 3, resina: 1, madera: 3 });
  assert.equal((await f.db.query('select public.mn_valid_fire_transition($1::jsonb,$2::jsonb) ok', [forgedRule, worldData])).rows[0].ok, false);

  await seedRpc(f, newTorch, worldData);
  const rpcId = 'f0000000-0000-4000-8000-000000000005';
  assert.equal((await commitRpc(f, rpcId, noResin)).ok, false);
  const committed = await commitRpc(f, rpcId, newTorch);
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.deepEqual(await commitRpc(f, rpcId, newTorch), { ...committed, replay: true });
  await f.db.exec('RESET ROLE');
  const saved = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.data.eco.pack.goods, { tronco: 3, resina: 1, madera: 3 });
});

test('ordinary commerce and raft transfers retain pre-existing resin and coconut through durable profile writes', async t => {
  for (const scenario of ['commerce', 'raft-transfer']) {
    const f = await database(); t.after(() => f.close());
    const before = newProfile(); before.gold = 500;
    before.eco.pack.goods = { madera: 3, resina: 2, coco: 1 };
    before.eco.ships[0].id = 'raft:goods';
    const economy = new Economy(SEED);
    let after = copy(before), command, ack;
    if (scenario === 'commerce') {
      const wallet = { gold: before.gold, hold: copy(before.eco.pack) };
      const quote = economy.trade('aldea', 'madera', 2, 'buy', wallet);
      assert.equal(quote.ok, true);
      after.gold = wallet.gold; after.eco.pack = wallet.hold; after.eco.tradeRev++;
      command = { type: 'commerce', op: 'buy', opId: 'buy-with-new-goods', town: 'aldea',
        g: 'madera', n: 2, expectedTotal: quote.total };
      ack = { type: 'commerce', op: 'buy', opId: command.opId, ok: true, why: '', rev: 1 };
    } else {
      after.eco.pack.goods.madera = 2;
      after.eco.ships[0].hold.goods.madera = 1;
      after.eco.ships[0].rev++;
      after.eco.tradeRev++;
      command = { type: 'commerce', op: 'transfer', opId: 'raft-deposit-new-goods', id: 'raft:goods',
        expectedRev: 1, g: 'madera', n: 1, side: 'deposit' };
      ack = { type: 'commerce', op: 'transfer', opId: command.opId, ok: true, why: '', rev: 2 };
    }
    const worldData = { v: 1, seed: SEED, economy: economy.serialize() };
    const request = { world: `goods-${scenario}`, account: ACCOUNT, command,
      expectedProfileVersion: 1, expectedWorldVersion: 1, profile: after, worldData, ack };
    await seedRpc(f, request, worldData, before);
    const operationId = scenario === 'commerce'
      ? 'f0000000-0000-4000-8000-000000000006' : 'f0000000-0000-4000-8000-000000000007';
    const checks = await f.db.query(`select public.mn_valid_economic_request($1::uuid,$2::jsonb) valid,
      public.mn_starter_valid_pack($2->'before') before_pack, public.mn_starter_valid_pack($2->'profile') after_pack`, [operationId, request]);
    const result = await commitRpc(f, operationId, request);
    assert.equal(result.ok, true, `${scenario}: ${JSON.stringify({result,checks:checks.rows[0]})}`);
    await f.db.exec('RESET ROLE');
    const saved = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data;
    assert.equal(saved.eco.pack.goods.resina, 2, `${scenario} retains resin`);
    assert.equal(saved.eco.pack.goods.coco, 1, `${scenario} retains coconut`);
  }
});

test('resin and coconut transfer to and from raft holds, while market sales remain persisted denials', async t => {
  let id = 10;
  for (const good of ['resina', 'coco']) for (const side of ['deposit', 'withdraw']) {
    const f = await database(); const close = closeAfterEach(t, f);
    const before = newProfile();
    before.eco.ships[0].id = 'raft:goods';
    before.eco.pack.goods = { [good]: side === 'deposit' ? 3 : 2 };
    before.eco.ships[0].hold.goods = side === 'withdraw' ? { [good]: 1 } : {};
    const after = copy(before);
    const amount = 1;
    const packCount = before.eco.pack.goods[good] ?? 0;
    const holdCount = before.eco.ships[0].hold.goods[good] ?? 0;
    after.eco.pack.goods[good] = side === 'deposit' ? packCount - amount : packCount + amount;
    if (!after.eco.pack.goods[good]) delete after.eco.pack.goods[good];
    after.eco.ships[0].hold.goods[good] = side === 'deposit' ? holdCount + amount : holdCount - amount;
    if (!after.eco.ships[0].hold.goods[good]) delete after.eco.ships[0].hold.goods[good];
    after.eco.ships[0].rev++;
    after.eco.tradeRev++;
    const opId = `raft-${side}-${good}`;
    const command = { type: 'commerce', op: 'transfer', opId, id: 'raft:goods', expectedRev: 1,
      g: good, n: amount, side };
    const worldData = world();
    const request = { world: `transfer-${side}-${good}`, account: ACCOUNT, command,
      expectedProfileVersion: 1, expectedWorldVersion: 1, profile: after, worldData,
      ack: { type: 'commerce', op: 'transfer', opId, ok: true, why: '', rev: 2 } };
    const operationId = `f0000000-0000-4000-8000-${String(id++).padStart(12, '0')}`;
    await seedRpc(f, request, worldData, before);
    if (good === 'resina' && side === 'deposit') {
      const forged = copy(request); forged.command.g = 'unknown_good';
      assert.equal((await commitRpc(f, operationId, forged)).ok, false, 'unknown goods remain rejected');
    }
    const result = await commitRpc(f, operationId, request);
    assert.equal(result.ok, true, `${side} ${good}: ${JSON.stringify(result)}`);
    await f.db.exec('RESET ROLE');
    const saved = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data;
    assert.deepEqual(saved.eco.pack.goods, after.eco.pack.goods);
    assert.deepEqual(saved.eco.ships[0].hold.goods, after.eco.ships[0].hold.goods);
    assert.deepEqual((await f.db.query('select request from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).rows[0].request.command.g, good,
      'receipt stores the actual new good rather than its bounded validator projection');
    await close();
  }

  for (const good of ['resina', 'coco']) for (const op of ['buy', 'sell']) {
    const f = await database(); const close = closeAfterEach(t, f);
    const before = newProfile(); before.gold = 500; before.eco.pack.goods = { [good]: 2 };
    const worldData = world();
    const opId = `market-${op}-${good}`;
    const request = { world: `market-denial-${op}-${good}`, account: ACCOUNT,
      command: { type: 'commerce', op, opId, town: 'aldea', g: good, n: 1, expectedTotal: 0 },
      expectedProfileVersion: 1, expectedWorldVersion: 1, profile: copy(before), worldData,
      ack: { type: 'commerce', op, opId, ok: false, why: 'unsupported_good', rev: 0 } };
    const operationId = `f0000000-0000-4000-8000-${String(id++).padStart(12, '0')}`;
    await seedRpc(f, request, worldData, before);
    assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [operationId, request])).rows[0].ok, true,
      'known new goods can persist an unsupported-market denial receipt');
    const accepted = await commitRpc(f, operationId, request);
    assert.equal(accepted.ok, true, `${op} denial ${good}: ${JSON.stringify(accepted)}`);
    const success = copy(request); success.ack.ok = true; success.ack.why = '';
    assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [operationId, success])).rows[0].ok, false,
      'new goods cannot be bought or sold before market rules exist');
    await f.db.exec('RESET ROLE');
    const savedWorld = (await f.db.query('select economy from public.mn_worlds where world=$1', [request.world])).rows[0].economy;
    assert.deepEqual(savedWorld, worldData, 'a denied trade leaves all market stocks unchanged');
    await close();
  }

  const f = await database(); const close = closeAfterEach(t, f);
  const before = newProfile(); before.eco.pack.goods = { resina: 2 };
  const worldData = world(); worldData.community = { projects: { 'salty:hall': { version: 1, contributed: {} } } };
  const opId = 'community-resina-denial';
  const request = { world: 'community-resina-denial', account: ACCOUNT,
    command: { type: 'community', op: 'contribute', opId, projectId: 'salty:hall', good: 'resina', amount: 1, expectedRev: 1 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: copy(before), worldData,
    ack: { type: 'community', op: 'contribute', opId, ok: false, why: 'unsupported_good', rev: 0 } };
  await seedRpc(f, request, worldData, before);
  const communityResult = await commitRpc(f, 'f0000000-0000-4000-8000-000000000030', request);
  assert.equal(communityResult.ok, true, `unsupported resin contribution denial: ${JSON.stringify(communityResult)}`);
  const attempted = copy(request); attempted.ack.ok = true; attempted.ack.why = '';
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok',
    ['f0000000-0000-4000-8000-000000000030', attempted])).rows[0].ok, false,
    'resin community contribution cannot commit until project rules include it');
  await close();
});

test('attribute allocation and freshwater vessel-aware hold validation retain exact new goods', async t => {
  const f = await database(); const close = closeAfterEach(t, f);
  const before = newProfile();
  before.lvl = 3; before.carry = { v: 1, backpack: 0 }; before.attr = { v: 1, carga: 0, re: 0 };
  before.eco.pack = { cap: 18, maxMass: 50, goods: { resina: 2, coco: 2 }, vessels: [] };
  const after = copy(before);
  after.attr.carga = 1; after.eco.pack.maxMass = 55; after.eco.tradeRev++;
  const worldData = world();
  const command = { type: 'attributes', op: 'assign', opId: 'new-goods-carga', expectedRev: 0, stat: 'carga', n: 1 };
  const request = { world: 'new-goods-attribute', account: ACCOUNT, command, expectedProfileVersion: 1,
    expectedWorldVersion: 1, before, profile: after, worldData,
    ack: { type: 'attributes', op: 'assign', opId: command.opId, ok: true, why: '', rev: 1,
      points: { earned: 2, invested: 1, available: 1, resetsLeft: 1 },
      limits: { volume: 18, comfortableMass: 44, maxMass: 55 } } };
  await seedRpc(f, request, worldData, before);
  const operationId = 'f0000000-0000-4000-8000-000000000020';
  const result = await commitRpc(f, operationId, request);
  assert.equal(result.ok, true, `attribute allocation with new goods: ${JSON.stringify(result)}`);
  await f.db.exec('RESET ROLE');
  const saved = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data;
  assert.deepEqual(saved.eco.pack.goods, { resina: 2, coco: 2 });

  await f.db.exec('SET ROLE service_role');
  const hold = { cap: 2, goods: { resina: 3, coco: 1 }, vessels: [{ id: 'p1', kind: 'barrel', water: 4 }] };
  assert.equal((await f.db.query('select public.mn_valid_artisan_hold($1::jsonb) ok', [hold])).rows[0].ok, true,
    'fractional resin volume and a valid hold barrel remain accepted');
  const overflow = copy(hold); overflow.cap = 1;
  assert.equal((await f.db.query('select public.mn_valid_artisan_hold($1::jsonb) ok', [overflow])).rows[0].ok, false,
    'new hold goods still count toward the exact capacity');
  const malformed = copy(hold); malformed.goods.unknown = 1;
  assert.equal((await f.db.query('select public.mn_valid_artisan_hold($1::jsonb) ok', [malformed])).rows[0].ok, false,
    'the projection does not widen the hold goods catalog');
  await close();
});
