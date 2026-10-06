import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { ECON } from '../src/sim/economy/economy.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { hmacSaves } from '../server/saves.mjs';
import { MAX_SAVE } from '../src/net/saves.js';
import { DT } from '../src/data/tuning.js';
import { publicRafts } from '../src/sim/systems/rafts.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const MAX_REV = 2147483647;

function productionProfile() {
  const profile = newProfile();
  const ship = profile.eco.ships.find((item) => item.kind === 'raft');
  // The starter raft has four foundations, a sail, and a crate. Put the net at the rim and
  // the grill on the other free deck cell so this fixture exercises the real placed-part keys.
  ship.grid = newRaft([...STARTER_RAFT, ['net', 1, 0, 0, 0], ['grill', 0, 1, 0, 0]]);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = {};
  return profile;
}

function makeServer(options = {}) {
  const messages = new Map(), onSave = new Map();
  const server = new LocalServer({ seed: 173, bots: 0, enemies: false,
    send: (id, message) => {
      if (!messages.has(id)) messages.set(id, []);
      messages.get(id).push(copy(message));
    },
    onSave: (id, profile) => onSave.set(id, copy(profile)),
    ...options,
  });
  return { server, messages, onSave };
}

function join(server, id, profile = productionProfile()) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Producer ${id}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'trusted test profile joined');
  return entity;
}

function joinSigned(server, id, profile, saves) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Signed producer ${id}`, skin: 0, weapon: 0, save: saves.store(profile) });
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'HMAC-signed guest save joined');
  assert.equal(server.clients.get(id).serverProfile, false, 'guest remains subject to signed-save size preflight');
  return entity;
}

function ownRaft(server, entity) {
  const profile = server.world.profiles.get(entity);
  const ship = profile.eco.ships.find((item) => item.kind === 'raft' && item.at === 'aldea');
  const active = [...server.world.rafts.values()].find((record) => record.owner === entity && record.ship === ship);
  assert.ok(active, 'primary Aldea raft is connected and active');
  return { profile, ship, active };
}

function standOnRaft(server, entity, active) {
  const ecs = server.world.ecs, raftEntity = active.entity;
  const c = Math.cos(ecs.facing[raftEntity]), s = Math.sin(ecs.facing[raftEntity]);
  ecs.x[entity] = ecs.x[raftEntity] + c + s;
  ecs.z[entity] = ecs.z[raftEntity] - s + c;
  ecs.y[entity] = ecs.y[raftEntity];
  ecs.regenT[entity] = 100;
  ecs.moveMag[entity] = ecs.vx[entity] = ecs.vz[entity] = 0;
}

function economySteps(server, count) {
  // Drive the real LocalServer.step -> World.stepWorld -> Economy.step -> onAdvance path.
  // Seed the economy accumulator just below its 5-second boundary for a bounded fast-forward.
  for (let i = 0; i < count; i++) {
    server.world.economy.acc = ECON.tickSec - DT;
    server.step();
  }
}

function events(messages, id, type) {
  return (messages.get(id) || []).filter((message) => message.t === MSG.EVENT && message.ev?.type === type)
    .map((message) => message.ev);
}

function command(server, id, fields) {
  server.receive(id, { t: MSG.CMD, type: 'commerce', ...fields });
  server.flushEvents();
}

function raftCommand(server, id, fields) {
  server.receive(id, { t: MSG.CMD, type: 'raft', ...fields });
  server.flushEvents();
}

function saveBlobs(messages, id) {
  return (messages.get(id) || []).filter((message) => message.t === MSG.SAVE).map((message) => message.blob);
}

function makeOversized(profile) {
  const parts = [];
  for (const kind of ['foundation', 'pillar', 'floor']) {
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++)
      parts.push([kind, x, z, kind === 'floor' ? 1 : 0, 0]);
  }
  for (let i = 0; i < 4; i++) profile.eco.ships.push({ kind: 'raft', id: `inactive-production-${i}`,
    n: 'Inactive fixture', hold: { cap: 0, goods: {} }, at: 'sol', hp: 1, rev: 1,
    grid: { parts: copy(parts), work: {} } });
}

test('LocalServer clock preserves fractional work, settles the net-to-grill chain, and revises once per lot tick', () => {
  const { server, messages, onSave } = makeServer();
  const owner = join(server, 1), visitor = join(server, 2, newProfile());
  const { profile, ship, active } = ownRaft(server, owner);
  const netKey = productionKey(['net', 1, 0, 0, 0]);
  const rev0 = ship.rev, tradeRev0 = profile.eco.tradeRev;

  economySteps(server, 16); // 80 seconds: half of the 160-second net interval.
  assert.equal(ship.grid.work[netKey], 0.5);
  assert.equal(ship.hold.goods.pescado || 0, 0);
  assert.equal(ship.rev, rev0, 'fractional work does not spend a revision');
  assert.equal(profile.eco.tradeRev, tradeRev0, 'fractional work does not spend the profile trade revision');

  economySteps(server, 16); // 160 seconds total: one net lot.
  assert.equal(ship.hold.goods.pescado, 1);
  assert.equal(ship.grid.work[netKey] ?? 0, 0);
  assert.equal(ship.rev, rev0 + 1);
  assert.equal(profile.eco.tradeRev, tradeRev0 + 1);
  assert.equal(events(messages, 1, 'raftProduction').filter((event) => Object.keys(event.made || {}).length).length, 1);
  assert.equal(onSave.get(1)?.eco.ships[0].hold.goods.pescado, 1,
    'settled lot schedules an immediate server-owned save even when the trusted profile emits no guest blob');

  economySteps(server, 32); // At 320 seconds, the net has supplied the grill's first two-fish recipe.
  assert.equal(ship.hold.goods.pescado, 2);
  assert.equal(ship.hold.goods.galleta, undefined);
  assert.equal(ship.rev, rev0 + 2, 'separate net lots each get their own economy-step revision');

  economySteps(server, 32); // By 480 seconds, the grill has had its own full production interval.
  assert.equal(ship.hold.goods.pescado, 1);
  assert.equal(ship.hold.goods.galleta, 2);
  assert.ok(ship.rev >= rev0 + 3);
  assert.ok(profile.eco.tradeRev >= tradeRev0 + 3);

  // Align both recipes just below a lot boundary. The net's fish is staged before the grill
  // consumes its two inputs, and the whole tick must still advance each revision only once.
  const grillKey = productionKey(['grill', 0, 1, 0, 0]);
  ship.hold.goods = { pescado: 2 };
  ship.grid.work = { [netKey]: 0.96875, [grillKey]: 0.96875 };
  const beforeCombinedLot = { shipRev: ship.rev, tradeRev: profile.eco.tradeRev };
  const priorProductionEvents = events(messages, 1, 'raftProduction').length;
  economySteps(server, 1);
  assert.equal(ship.rev, beforeCombinedLot.shipRev + 1, 'two modules settling in one tick use one raft revision');
  assert.equal(profile.eco.tradeRev, beforeCombinedLot.tradeRev + 1, 'two modules settling in one tick use one trade revision');
  assert.equal(ship.hold.goods.pescado, 1);
  assert.equal(ship.hold.goods.galleta, 2);
  const combinedLot = events(messages, 1, 'raftProduction').slice(priorProductionEvents).at(-1);
  assert.deepEqual(combinedLot.made, { pescado: 1, galleta: 2 });
  assert.deepEqual(combinedLot.used, { pescado: 2 });
  assert.equal(combinedLot.daySec, 960);
  assert.equal(events(messages, 2, 'raftProduction').length, 0, 'production events are private to the raft owner');

  standOnRaft(server, owner, active);
  command(server, 1, { type: 'commerce', op: 'cargo', id: ship.id, opId: 'private-cargo-production' });
  const cargo = events(messages, 1, 'commerce').find((event) => event.opId === 'private-cargo-production');
  assert.ok(cargo?.production?.some((row) => row.part === 'net'));
  assert.equal(cargo.daySec, 960);
  assert.equal(JSON.stringify(publicRafts(server.world)).includes('work'), false, 'public raft records omit fractional work');
  assert.equal(JSON.stringify(publicRafts(server.world)).includes('goods'), false, 'public raft records omit hold contents');
  server.broadcastSnapshot();
  for (const id of [1, 2]) {
    const snapshot = (messages.get(id) || []).filter((message) => message.t === MSG.SNAPSHOT).at(-1);
    assert.ok(snapshot);
    assert.equal(JSON.stringify(snapshot.rafts).includes('work'), false);
    assert.equal(JSON.stringify(snapshot.rafts).includes('goods'), false);
  }
});

test('signed save restores fractional work without producing while the owner is offline', () => {
  const saves = hmacSaves('d06b-production-continuity-test');
  const { server, messages } = makeServer({ saves });
  const owner = joinSigned(server, 10, productionProfile(), saves);
  const first = ownRaft(server, owner), key = productionKey(['net', 1, 0, 0, 0]);
  economySteps(server, 16);
  assert.equal(first.ship.grid.work[key], 0.5);
  server.sendSave(10, server.clients.get(10));
  const blob = saveBlobs(messages, 10).at(-1);
  assert.ok(blob && saves.load(blob));
  server.disconnect(10);

  server.world.economy.advance(ECON.daySec); // No active raft means no offline production is banked.
  server.connect(11);
  server.receive(11, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Rejoined producer', skin: 0, weapon: 0, save: blob });
  const reopened = server.clients.get(11).entity, restored = ownRaft(server, reopened);
  assert.equal(restored.ship.grid.work[key], 0.5);
  assert.equal(restored.ship.hold.goods.pescado, undefined);
  economySteps(server, 16);
  assert.equal(restored.ship.hold.goods.pescado, 1, 'only the remaining online time completes the saved fraction');
  assert.equal(restored.ship.grid.work[key] ?? 0, 0);
});

test('full hold pauses both pieces without consuming or losing goods, then resumes when space returns', () => {
  const { server } = makeServer();
  const owner = join(server, 20), { ship } = ownRaft(server, owner);
  const key = productionKey(['net', 1, 0, 0, 0]);
  economySteps(server, 16);
  assert.equal(ship.grid.work[key], 0.5);
  ship.hold.goods = { madera: 2 };
  const before = { goods: copy(ship.hold.goods), work: copy(ship.grid.work), rev: ship.rev };
  economySteps(server, 16);
  assert.deepEqual(ship.hold.goods, before.goods, 'full hold rejects the whole production lot without losing cargo');
  assert.deepEqual(ship.grid.work, before.work, 'blocked net retains its earned fraction');
  assert.equal(ship.rev, before.rev);
  ship.hold.goods = {};
  economySteps(server, 16);
  assert.equal(ship.hold.goods.pescado, 1, 'the next eligible interval resumes the net');
  assert.equal(ship.grid.work[key] ?? 0, 0);
});

test('signed guest save preflight rejects an oversized lot atomically, then recovers', () => {
  const saves = hmacSaves('d06b-production-preflight-test');
  const { server, messages } = makeServer({ saves });
  const owner = joinSigned(server, 30, productionProfile(), saves), { profile, ship } = ownRaft(server, owner);
  economySteps(server, 31);
  const key = productionKey(['net', 1, 0, 0, 0]);
  const workBefore = copy(ship.grid.work), holdBefore = copy(ship.hold), revBefore = ship.rev, tradeBefore = profile.eco.tradeRev;
  makeOversized(profile);
  assert.ok(saves.store(profile).length > MAX_SAVE, 'fixture is genuinely over the signed guest save limit');

  economySteps(server, 1);
  assert.deepEqual(ship.grid.work, workBefore, 'failed save preflight cannot commit even fractional candidate work');
  assert.deepEqual(ship.hold, holdBefore, 'failed save preflight leaves cargo unchanged');
  assert.equal(ship.rev, revBefore);
  assert.equal(profile.eco.tradeRev, tradeBefore);
  assert.equal(ship.hold.goods.pescado, undefined);
  assert.equal(events(messages, 30, 'raftProduction').at(-1)?.productionBlocked, 'saveSize');

  profile.eco.ships.splice(1);
  assert.ok(saves.store(profile).length <= MAX_SAVE);
  economySteps(server, 1);
  assert.equal(ship.hold.goods.pescado, 1, 'the deferred lot succeeds after save capacity returns');
  assert.equal(ship.rev, revBefore + 1);
  assert.equal(profile.eco.tradeRev, tradeBefore + 1);
  assert.equal(ship.grid.work[key] ?? 0, 0);
});

test('save-store throws preserve the entire staged lot and a later healthy preflight recovers', () => {
  const signer = hmacSaves('d06b-production-throw-test');
  let throwing = false;
  const saves = { kind: 'hmac-test', load: (blob) => signer.load(blob), store(profile) {
    if (throwing) throw new Error('injected save-store failure');
    return signer.store(profile);
  } };
  const { server } = makeServer({ saves });
  const owner = joinSigned(server, 40, productionProfile(), saves), { profile, ship } = ownRaft(server, owner);
  economySteps(server, 31);
  const before = { grid: copy(ship.grid), hold: copy(ship.hold), shipRev: ship.rev, tradeRev: profile.eco.tradeRev };
  throwing = true;
  economySteps(server, 1);
  assert.deepEqual(ship.grid, before.grid);
  assert.deepEqual(ship.hold, before.hold);
  assert.equal(ship.rev, before.shipRev);
  assert.equal(profile.eco.tradeRev, before.tradeRev);
  throwing = false;
  economySteps(server, 1);
  assert.equal(ship.hold.goods.pescado, 1);
  assert.equal(ship.rev, before.shipRev + 1);
  assert.equal(profile.eco.tradeRev, before.tradeRev + 1);
});

test('revision exhaustion blocks once without work, cargo, or revision changes', () => {
  for (const field of ['ship', 'trade']) {
    const { server, messages } = makeServer();
    const owner = join(server, field === 'ship' ? 50 : 51), { profile, ship } = ownRaft(server, owner);
    if (field === 'ship') ship.rev = MAX_REV;
    else profile.eco.tradeRev = MAX_REV;
    const before = { work: copy(ship.grid.work), hold: copy(ship.hold), shipRev: ship.rev, tradeRev: profile.eco.tradeRev };
    economySteps(server, 2);
    const productionEvents = events(messages, field === 'ship' ? 50 : 51, 'raftProduction');
    assert.equal(productionEvents.length, 1, 'only the transition into global revision blocking emits');
    assert.equal(productionEvents[0].productionBlocked, 'revisionLimit');
    assert.deepEqual(ship.grid.work, before.work);
    assert.deepEqual(ship.hold, before.hold);
    assert.equal(ship.rev, before.shipRev);
    assert.equal(profile.eco.tradeRev, before.tradeRev);
  }
});

test('editor edits preserve unrelated module work and removing a module clears only its own tuple key', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 60), { profile, ship, active } = ownRaft(server, owner);
  standOnRaft(server, owner, active);
  const netTuple = ['net', 1, 0, 0, 0], grillTuple = ['grill', 0, 1, 0, 0];
  const netKey = productionKey(netTuple), grillKey = productionKey(grillTuple);
  ship.grid.work = { [netKey]: 0.375, [grillKey]: 0.625 };
  const base = { id: ship.id, expectedRev: ship.rev };
  raftCommand(server, 60, { ...base, op: 'remove', index: 5, piece: ['crate', 1, 1, 0, 0], opId: 'remove-unrelated-crate' });
  const unrelated = events(messages, 60, 'raftEdit').find((event) => event.opId === 'remove-unrelated-crate');
  assert.equal(unrelated?.ok, true);
  assert.deepEqual(ship.grid.work, { [netKey]: 0.375, [grillKey]: 0.625 });

  const netIndex = ship.grid.parts.findIndex((tuple) => JSON.stringify(tuple) === JSON.stringify(netTuple));
  raftCommand(server, 60, { id: ship.id, expectedRev: ship.rev, op: 'remove', index: netIndex, piece: netTuple, opId: 'remove-net-progress' });
  const removed = events(messages, 60, 'raftEdit').find((event) => event.opId === 'remove-net-progress');
  assert.equal(removed?.ok, true);
  assert.equal(Object.hasOwn(ship.grid.work, netKey), false, 'the removed tuple loses its orphan fraction');
  assert.equal(ship.grid.work[grillKey], 0.625, 'the other production module keeps its independent fraction');
});
