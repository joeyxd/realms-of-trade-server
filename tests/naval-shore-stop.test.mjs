import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { FRESHWATER, freshwaterSource } from '../src/data/freshwater.js';
import { holdMass } from '../src/sim/economy/cargo.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { NavalTrial } from '../src/sim/naval/trial.js';
import { ACCOUNT_ONE, connect, makeResourceStore, makeResourceHost, turn, submitAndApply,
  calmAt, copy, deferred } from './helpers/resource-authority-fixture.mjs';

const options = { freshwaterOperations: true, canteenOperations: true };
const fresh = (op, opId, expectedRev, extra = {}) => ({ type: 'freshwater', op, opId,
  expectedRev, source: '', ship: '', part: '', n: 0, ...extra });

async function hostFixture(t, { storeOverride = {},
  hold = {}, secondAccount = false } = {}) {
  const { base, store: baseStore } = makeResourceStore();
  const store = { ...baseStore, ...(typeof storeOverride === 'function' ? storeOverride(base) : storeOverride) };
  const accounts = [ACCOUNT_ONE];
  const { accountProfile } = await import('./helpers/resource-authority-fixture.mjs');
  const profile = accountProfile({ goods: { madera: 6 } });
  profile.gold = 1000;
  profile.surv = { v: 1, sat: 45, hyd: 45 };
  profile.carry = { v: 1, backpack: 2 }; profile.eco.pack.cap = 42; profile.eco.pack.maxMass = 70;
  profile.lvl = 5; profile.attr = { v: 1, carga: 4, re: 1 };
  if (secondAccount) {
    const { ACCOUNT_TWO } = await import('./helpers/resource-authority-fixture.mjs');
    accounts.push(ACCOUNT_TWO);
  }
  for (const account of accounts) {
    const saved = copy(profile);
    saved.pirateId = `account:${account}`;
    await store.initializeProfile(account, saved);
  }
  await store.checkResourceOperations();
  const host = makeResourceHost(store, async (_request, hello) => hello.name === 'guest' ? null :
    hello.name === 'second' ? accounts[1] : ACCOUNT_ONE, options);
  t.after(async () => {
    if (host.closePromise) return;
    try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
  });
  await host.prepare();
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = () => host.server.clients.get(client.id).entity;
  const world = host.server.world, player = entity(), p = world.profiles.get(player);
  p.eco.pack.goods = { madera: 3, lona: 2, agua: 2, fruta: 3 };
  p.carry = { v: 1, backpack: 2 }; p.eco.pack.cap = 42; p.eco.pack.maxMass = 70;
  p.lvl = 5; p.attr = { v: 1, carga: 4, re: 1 };
  p.surv = { v: 1, sat: 45, hyd: 45 };
  world.ecs.sat[player] = 45; world.ecs.hyd[player] = 45;
  const ship = p.eco.ships.find((item) => item.kind === 'raft');
  const source = world.rafts.get(ship.id);
  Object.assign(ship.hold.goods, hold);

  // Keep the real generated Aldea landmark, but place the active trial near it and expose a tiny
  // deterministic dry patch for an actual NavalTrial landing. The old berth remains the return anchor.
  const village = world.map.landmarks.village, home = source.home;
  const dir = world.map.dock.dir;
  const pose = { x: home.x + dir.x * 25, y: 0, z: home.z + dir.z * 25,
    yaw: Math.atan2(dir.x, dir.z) };
  assert.ok(Math.hypot(pose.x - home.x, pose.z - home.z) >= 20, 'controlled coast lies beyond the voyage threshold');
  world.ecs.x[source.entity] = pose.x; world.ecs.y[source.entity] = pose.y;
  world.ecs.z[source.entity] = pose.z; world.ecs.facing[source.entity] = pose.yaw;
  const shore = { x: pose.x + 4, z: pose.z + 1 };
  // The controlled host fixture places Aldea's existing market radius around this physical cove.
  world.map.landmarks = { ...world.map.landmarks, village: { x: shore.x, z: shore.z } };
  const originalGround = world.map.groundAt.bind(world.map), originalDock = world.map.onDock.bind(world.map);
  world.map.groundAt = (x, z) => Math.hypot(x - shore.x, z - shore.z) <= 1.6 ? 0.6 : originalGround(x, z);
  world.map.onDock = (x, z) => Math.hypot(x - shore.x, z - shore.z) <= 1.6 ? false : originalDock(x, z);
  world.map.colliders = [];
  world.map.queryColliders = () => [];
  world.raftDeck.update(publicRafts(world));
  // Force the server trial to capture the current generated heightfield and preserve the real pilot.
  world.navalTrial.close();
  world.navalTrial = new NavalTrial(world, { coast: true, navigation: true });
  const raft = publicRafts(world).find((item) => item.id === ship.id);
  const helm = pilotPoint(raft, raft.helm);
  calmAt(host, player, helm); world.ecs.facing[player] = helm.f;
  client.send({ type: 'navalPilot', op: 'mount', shipId: ship.id }); await turn();
  const sailing = world.navalPilot.snapshot(player);
  assert.equal(sailing.active, true, `real NavalTrial mount failed at ${JSON.stringify({ pose,
    owner: [world.ecs.x[player], world.ecs.y[player], world.ecs.z[player]],
    surface: world.raftDeck.surface(world.ecs.x[player], world.ecs.z[player], world.ecs.y[player]),
    capacity: world.navalPilot.loadCapacity(ship.id) })}`);
  world.navalPilot.prepare();
  const ready = world.navalPilot.voyageSnapshot(player);
  assert.equal(ready.visited, true);
  assert.equal(ready.canLand, true, `controlled coast is landable: ${JSON.stringify(ready)}`);
  client.send({ type: 'navalPilot', op: 'land', epoch: sailing.epoch }); await turn();
  assert.equal(world.navalPilot.shoreStop(player), true, 'actual pilot landed on the dry patch while the real trial is parked');
  assert.equal(world.navalTrial.isParked(player, ship.id), true);
  return { host, store, base, client, world, entity, player, profile: p, ship, source, pose,
    landing: world.navalPilot.voyageSnapshot(player).landing };
}

async function command(f, value) { return submitAndApply(f.host, f.client, value); }

async function query(f, op, opId, fields) {
  await f.host.economicAuthority.settle(); await f.host.profiles.flush(); await f.host.worldState.flush();
  await turn();
  f.client.send({ type: 'commerce', op, opId, ...fields });
  // After M5 owns publication, queued read ACKs publish only on an admitted tick.
  await turn(); f.host.server.step();
  return f.client.events(opId).at(-1);
}

async function fillAtSpring(f, op, opId, n) {
  const source = freshwaterSource(f.world.map), before = f.landing;
  assert.ok(source, 'the world has a freshwater spring');
  const groundAt = f.world.map.groundAt.bind(f.world.map);
  f.world.map.groundAt = (x, z) => Math.hypot(x - source.x, z - source.z) <= source.radius ? source.y : groundAt(x, z);
  calmAt(f.host, f.player, source);
  const cmd = fresh(op, opId, f.profile.eco.tradeRev, { source: source.id, n });
  f.client.send(cmd);
  for (let i = 0; i < 20 && !f.world.freshwaterGather?.has(f.player); i++) await turn();
  assert.ok(f.world.freshwaterGather?.has(f.player), `channel starts before ticking: ${JSON.stringify(f.client.events(opId))}`);
  calmAt(f.host, f.player, source);
  f.world.ecs.hp[f.player] = f.world.freshwaterGather.get(f.player).hp;
  f.host.server.step();
  assert.equal(f.client.events(opId).at(-1)?.stage, 'gathering');
  const gathering = f.world.freshwaterGather.get(f.player);
  for (let i = 0; i < FRESHWATER.collectTicks - 1; i++) {
    calmAt(f.host, f.player, source);
    f.world.ecs.hp[f.player] = f.world.freshwaterGather.get(f.player).hp;
    f.host.server.step();
  }
  assert.equal(f.host.economicAuthority.busy, false, 'no receipt is committed before the full channel');
  calmAt(f.host, f.player, source);
  f.world.ecs.hp[f.player] = f.world.freshwaterGather.get(f.player).hp;
  f.host.server.step(); await turn(); await f.host.economicAuthority.settle(); f.host.server.step();
  assert.equal(f.client.events(opId).at(-1)?.ok, true, JSON.stringify({ events: f.client.events(opId),
    source, gather: f.world.freshwaterGather.get(f.player), tick: f.world.tick,
    position: [f.world.ecs.x[f.player], f.world.ecs.y[f.player], f.world.ecs.z[f.player]] }));
  calmAt(f.host, f.player, before);
  return f.client.events(opId).at(-1);
}

test('real parked coast allows durable pack resupply and resumes the same voyage with refreshed cargo mass', async (t) => {
  const f = await hostFixture(t), { host, client, world, player, ship, profile, base } = f;
  const holdBefore = copy(ship.hold), blueprintBefore = copy(ship.grid.parts), sourceBefore = world.rafts.get(ship.id);
  const bodyBefore = world.navalPilot.voyageSnapshot(player).target;
  const initialMass = holdMass(profile.eco.pack);
  assert.equal(world.navalPilot.locked(player), true, 'the broad voyage lock remains active ashore');

  const list = await query(f, 'list', 'shore-list', { town: 'aldea' });
  assert.equal(list?.ok, true, JSON.stringify({ list, status: host.economicAuthority.status(),
    tickBlocked: host.server.tickBlocked, available: host.commandAvailable(client.id, player, { world: true, target: null }),
    tail: client.ws.messages.slice(-3).map((m) => m.ev || { t: m.t, type: m.type }),
    session: { running: host.profiles.clients.get(client.id)?.running, failed: host.profiles.clients.get(client.id)?.failed,
      version: host.profiles.clients.get(client.id)?.version }, worldRunning: host.worldState.running }));
  const quote = await query(f, 'quote', 'shore-quote', { town: 'aldea', g: 'madera', n: 1, side: 'buy' });
  assert.equal(quote?.ok, true, JSON.stringify(quote));
  const buy = { type: 'commerce', op: 'buy', opId: 'shore-buy', town: 'aldea', g: 'madera', n: 1,
    expectedTotal: quote.total };
  const beforeBuy = copy(profile);
  const bought = await command(f, buy);
  assert.equal(bought?.ok, true, JSON.stringify(bought));
  assert.equal(profile.eco.pack.goods.madera, (beforeBuy.eco.pack.goods.madera || 0) + 1);
  assert.ok(await base.loadEconomicOperation(economicOperationId(host.worldState.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', buy.opId)));
  assert.equal((await command(f, buy))?.replay, true, 'exact M5 retry does not buy twice');

  const saleQuote = await query(f, 'quote', 'shore-sale-quote', { town: 'aldea', g: 'fruta', n: 1, side: 'sell' });
  assert.equal(saleQuote?.ok, true, JSON.stringify(saleQuote));
  const sale = { type: 'commerce', op: 'sell', opId: 'shore-sell', town: 'aldea', g: 'fruta', n: 1,
    expectedTotal: saleQuote.total };
  assert.equal((await command(f, sale))?.ok, true);
  assert.equal(profile.eco.pack.goods.fruta, 2);

  const craftBucket = fresh('craftBucket', 'shore-bucket', profile.eco.tradeRev);
  assert.equal((await command(f, craftBucket))?.ok, true);
  const craftCanteen = fresh('craftCanteen', 'shore-canteen', profile.eco.tradeRev);
  assert.equal((await command(f, craftCanteen))?.ok, true);
  await fillAtSpring(f, 'fillCanteen', 'shore-canteen-fill', FRESHWATER.canteenCapacity);
  await fillAtSpring(f, 'fill', 'shore-bucket-fill', FRESHWATER.bucketCapacity);
  const drink = fresh('drink', 'shore-drink', profile.eco.tradeRev, { n: 1 });
  const beforeDrink = copy(profile);
  assert.equal((await command(f, drink))?.ok, true, JSON.stringify(client.events(drink.opId)));
  assert.equal(profile.eco.pack.vessels.find((v) => v.kind === 'canteen').water,
    beforeDrink.eco.pack.vessels.find((v) => v.kind === 'canteen').water - 1);
  const refill = fresh('refillCanteen', 'shore-refill', profile.eco.tradeRev,
    { source: 'provisions', n: 1 });
  assert.equal((await command(f, refill))?.ok, true);
  const satBeforeEat = profile.surv.sat;
  const eat = fresh('eat', 'shore-eat', profile.eco.tradeRev, { source: 'fruta', n: 1 });
  assert.equal((await command(f, eat))?.ok, true);
  assert.ok(profile.surv.sat > satBeforeEat, 'food restores needs through the same durable profile');

  const transfer = { type: 'commerce', op: 'transfer', opId: 'shore-hold-denied', id: ship.id,
    expectedRev: ship.rev, g: 'madera', n: 1, side: 'deposit' };
  assert.equal((await command(f, transfer))?.ok, false, 'hold transfer stays locked even on a dry stop');
  const barrelRefill = fresh('refillCanteen', 'shore-barrel-denied', profile.eco.tradeRev,
    { source: 'barrel', ship: ship.id, part: 'p1', n: 1 });
  assert.equal((await command(f, barrelRefill))?.ok, false, 'ship barrel service stays locked');
  assert.deepEqual(ship.hold, holdBefore);
  assert.deepEqual(ship.grid.parts, blueprintBefore);
  assert.equal(world.rafts.get(ship.id), sourceBefore);
  assert.deepEqual(world.navalPilot.voyageSnapshot(player).target, bodyBefore);

  const currentMass = holdMass(profile.eco.pack);
  assert.ok(currentMass < initialMass, `pack-only consumption changes the next sailing mass (${initialMass} -> ${currentMass})`);
  // Walking ashore can leave the captain facing away from a rotated helm.
  world.ecs.facing[player] = f.pose.yaw + Math.PI / 2;
  assert.equal(world.navalPilot.reboard(player, ship.id), true);
  assert.equal(world.navalPilot.locked(player), true, 'the owner is underway before the M5 command');
  host.server.step();
  assert.equal(world.navalPilot.voyageSnapshot(player).phase, 'sailing',
    'the first post-reboard tick preserves the seat after the shore-facing direction changed');
  assert.equal(world.navalPilot.aboard(player), true);
  assert.equal(world.navalPilot.snapshot(player).shipId, ship.id, 'reboarding continues the same trial and vessel');
  const resumed = world.navalPilot.snapshot(player).body, payload = world.navalPilot.payload(ship.id);
  assert.equal(resumed.operational.rig.cargoMass,
    holdMass(ship.hold) + holdMass(profile.eco.pack) + payload.crewMass + payload.guestMass,
    'reboarded trial rows include refreshed pack vessels and crew payload');
  assert.equal(ship.hold, world.rafts.get(ship.id).ship.hold, 'pack-only M5 receipts preserve the hold reference');
});

test('sailing, shore cargo edits, and recovery after reconnect do not grant shore pack services', async (t) => {
  const f = await hostFixture(t), { host, client, world, player, ship, profile, base } = f;
  assert.equal(world.navalPilot.reboard(player, ship.id), true);
  const sailCmd = fresh('craftBucket', 'sailing-craft-denied', profile.eco.tradeRev);
  const before = copy(profile);
  assert.equal((await command(f, sailCmd))?.why, 'busy');
  assert.deepEqual(profile.eco.pack, before.eco.pack, 'denied sailing service does not change the pack');
  assert.deepEqual(profile.surv, before.surv);
  assert.equal(profile.eco.tradeRev, before.eco.tradeRev);

  const transfer = { type: 'commerce', op: 'transfer', opId: 'sailing-transfer-denied', id: ship.id,
    expectedRev: ship.rev, g: 'madera', n: 1, side: 'withdraw' };
  const transferDenied = await command(f, transfer);
  assert.equal(transferDenied?.ok, false);
  const transferReceipt = await base.loadEconomicOperation(economicOperationId(host.worldState.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transfer.opId));
  assert.equal(transferReceipt?.result?.ack?.ok, false, 'durable rejection records no cargo effect');
  client.ws.close(); await turn();
  const resumed = connect(host, 'Resource tester'); resumed.hello(); await Promise.all([...host.joins]);
  const e2 = host.server.clients.get(resumed.id).entity;
  assert.equal(world.navalPilot.shoreStop(e2), false, 'reconnect restores a recovery anchor, not a live shore permit');
  const recoveryCommand = fresh('craftBucket', 'recovery-denied', world.profiles.get(e2).eco.tradeRev);
  resumed.send(recoveryCommand); await turn(); await host.economicAuthority.settle(); host.server.step();
  assert.equal(resumed.events(recoveryCommand.opId).at(-1)?.why, 'busy');
  const recoveryReceipt = await base.loadEconomicOperation(economicOperationId(host.worldState.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recoveryCommand.opId));
  assert.equal(recoveryReceipt?.result?.ack?.why, 'busy', 'recovery denial has no service effect');
});

test('a held shore purchase has no early effect and reboarding waits for the M5 receipt', async (t) => {
  const gate = deferred(), entered = deferred();
  t.after(() => gate.resolve());
  const f = await hostFixture(t, { storeOverride: (base) => ({ async commitEconomicOperation(...args) {
    entered.resolve(); await gate.promise; return base.commitEconomicOperation(...args);
  } }) });
  const { host, client, world, player, ship, profile, base } = f;
  const list = await query(f, 'list', 'held-shore-list', { town: 'aldea' });
  const quote = await query(f, 'quote', 'held-shore-quote', { town: 'aldea', g: 'madera', n: 1, side: 'buy' });
  assert.equal(list?.ok, true); assert.equal(quote?.ok, true);
  const buy = { type: 'commerce', op: 'buy', opId: 'held-shore-buy', town: 'aldea', g: 'madera', n: 1,
    expectedTotal: quote.total };
  const before = { gold: profile.gold, pack: copy(profile.eco.pack), hold: copy(ship.hold),
    body: copy(world.navalPilot.voyageSnapshot(player).target) };
  client.send(buy); await turn();
  const reachedStore = await Promise.race([entered.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
  assert.equal(reachedStore, true, 'the M5 operation reaches the deferred store commit');
  assert.equal(host.economicAuthority.busy, true, 'M5 commit is held after planning');
  assert.equal(client.events(buy.opId).length, 0, 'no receipt is acknowledged before commit');
  assert.equal(profile.gold, before.gold); assert.deepEqual(profile.eco.pack, before.pack);
  assert.deepEqual(ship.hold, before.hold);
  assert.deepEqual(world.navalPilot.voyageSnapshot(player).target, before.body);
  assert.equal(await base.loadEconomicOperation(economicOperationId(host.worldState.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', buy.opId)), null);
  client.send({ type: 'navalPilot', op: 'reboard', shipId: ship.id }); await turn();
  assert.equal(world.navalPilot.shoreStop(player), true, 'reboard is refused while M5 owns the mutation lane');
  gate.resolve(); await host.economicAuthority.settle(); host.server.step();
  const receipt = client.events(buy.opId).at(-1);
  assert.equal(receipt?.ok, true, JSON.stringify(receipt));
  assert.equal(profile.gold, before.gold - quote.total);
  assert.equal(profile.eco.pack.goods.madera, (before.pack.goods.madera || 0) + 1);
  assert.equal(await base.loadEconomicOperation(economicOperationId(host.worldState.id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', buy.opId)) !== null, true);
  assert.equal(world.navalPilot.reboard(player, ship.id), true);
  const body = world.navalPilot.snapshot(player).body;
  assert.equal(body.operational.rig.cargoMass,
    holdMass(ship.hold) + holdMass(profile.eco.pack) + world.navalPilot.payload(ship.id).crewMass +
      world.navalPilot.payload(ship.id).guestMass, 'trial cargo rows exactly reflect the confirmed pack and payload');
  gate.resolve(); await host.economicAuthority.settle();
});
