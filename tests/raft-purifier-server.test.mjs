import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { ECON } from '../src/sim/economy/economy.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { applyPartDamage } from '../src/sim/naval/structure.js';
import { persistRaftCondition } from '../src/sim/naval/condition.js';
import { hmacSaves } from '../server/saves.mjs';
import { MAX_SAVE } from '../src/net/saves.js';
import { DT } from '../src/data/tuning.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

function purifierProfile() {
  const profile = newProfile();
  const ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.grid = newRaft(STARTER_RAFT);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = { madera: 2, hierro: 1 };
  profile.eco.pack.goods = { madera: 2, hierro: 1 };
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

function join(server, id, profile = purifierProfile()) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Purifier ${id}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'trusted purifier fixture joined');
  return entity;
}

function joinSigned(server, id, blob) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Signed purifier ${id}`, skin: 0, weapon: 0, save: blob });
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'signed guest purifier save joined');
  assert.equal(server.clients.get(id).serverProfile, false);
  return entity;
}

function ownRaft(server, entity) {
  const profile = server.world.profiles.get(entity);
  const ship = profile.eco.ships.find((item) => item.kind === 'raft' && item.at === 'aldea');
  const active = [...server.world.rafts.values()].find((record) => record.owner === entity && record.ship === ship);
  assert.ok(active, 'primary Aldea raft is active');
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
  for (let i = 0; i < count; i++) {
    server.world.economy.acc = ECON.tickSec - DT;
    server.step();
  }
}

function events(messages, id, type) {
  return (messages.get(id) || []).filter((message) => message.t === MSG.EVENT && message.ev?.type === type)
    .map((message) => message.ev);
}

function raftCommand(server, id, fields) {
  server.receive(id, { t: MSG.CMD, type: 'raft', ...fields });
  server.flushEvents();
}

function cargoStatus(server, messages, id, ship) {
  server.receive(id, { t: MSG.CMD, type: 'commerce', op: 'cargo', id: ship.id, opId: 'purifier-cargo-status' });
  server.flushEvents();
  return events(messages, id, 'commerce').at(-1);
}

function placement(server, messages, id, ship, opId, piece) {
  raftCommand(server, id, { op: 'place', id: ship.id, expectedRev: ship.rev, opId, piece });
  return events(messages, id, 'raftEdit').find((event) => event.opId === opId);
}

function purifierFixture() {
  const { server, messages, onSave } = makeServer();
  const ownerId = 1, visitorId = 2;
  const profile = purifierProfile();
  profile.eco.pack.goods.hierro = 2;
  const ownerEntity = join(server, ownerId, profile), visitor = join(server, visitorId, newProfile());
  const own = ownRaft(server, ownerEntity);
  standOnRaft(server, ownerEntity, own.active);
  return { server, messages, onSave, ownerId, ownerEntity, visitor, visitorId, ...own };
}

test('LocalServer purifier placement debits hold before pack, deduplicates, and rejects unsupported or unfunded pieces atomically', () => {
  const { server, messages, profile, ship, ownerId } = purifierFixture();
  profile.eco.pack.goods.hierro = 1;
  const piece = ['purifier', 1, 0, 0, 0];
  const before = { hold: copy(ship.hold), pack: copy(profile.eco.pack), parts: copy(ship.grid.parts), rev: ship.rev };

  const noSupport = placement(server, messages, ownerId, ship, 'purifier-no-support', ['purifier', 5, 5, 0, 0]);
  assert.equal(noSupport?.ok, false);
  assert.ok(['deck', 'support', 'supported'].includes(noSupport.why));
  const insufficient = placement(server, messages, ownerId, ship, 'purifier-no-goods', ['purifier', 1, 0, 0, 0]);
  assert.equal(insufficient?.ok, false);
  assert.equal(insufficient.why, 'goods');
  assert.deepEqual({ hold: ship.hold, pack: profile.eco.pack, parts: ship.grid.parts, rev: ship.rev }, before,
    'failed placement leaves cargo, plan, and revision untouched');

  // A fixture can provide only the missing last unit after both actual denial paths.
  profile.eco.pack.goods.hierro = 2;
  const placed = placement(server, messages, ownerId, ship, 'place-working-purifier', piece);
  assert.equal(placed?.ok, true);
  assert.deepEqual(ship.hold.goods, {}, 'construction takes available materials from the hold first');
  assert.equal(profile.eco.pack.goods.madera, 2);
  assert.equal(profile.eco.pack.goods.hierro, undefined, 'the two iron units beyond the held unit came from the pack');
  assert.ok(ship.grid.parts.some((part) => JSON.stringify(part) === JSON.stringify(piece)));

  raftCommand(server, ownerId, { op: 'place', id: ship.id, expectedRev: before.rev, opId: 'place-working-purifier', piece });
  const replay = events(messages, ownerId, 'raftEdit').filter((event) => event.opId === 'place-working-purifier').at(-1);
  assert.equal(replay?.ok, true);
  assert.equal(ship.rev, placed.rev, 'receipt replay does not repeat debit or revision');
  assert.equal(ship.grid.parts.filter((part) => part[0] === 'purifier').length, 1);
});

test('LocalServer produces purifier water on its economy clock, revises once, saves, and reports only to the owner', () => {
  const { server, messages, onSave, ownerId, visitorId, profile, ship } = purifierFixture();
  const piece = ['purifier', 1, 0, 0, 0];
  assert.equal(placement(server, messages, ownerId, ship, 'place-purifier-production', piece)?.ok, true);
  const key = productionKey(piece), rev = ship.rev, tradeRev = profile.eco.tradeRev;

  economySteps(server, 9); // 45 simulation seconds of a 96-second water lot.
  assert.ok(Math.abs(ship.grid.work[key] - 45 / 96) < 1e-9);
  assert.equal(ship.hold.goods.agua, undefined);
  assert.equal(ship.rev, rev, 'fractional progress does not revise the raft');
  assert.equal(profile.eco.tradeRev, tradeRev);

  economySteps(server, 11); // 100 seconds total: one lot and four seconds toward the next.
  assert.equal(ship.hold.goods.agua, 1);
  assert.ok(Math.abs(ship.grid.work[key] - 4 / 96) < 1e-9);
  assert.equal(ship.rev, rev + 1);
  assert.equal(profile.eco.tradeRev, tradeRev + 1);
  const event = events(messages, ownerId, 'raftProduction').at(-1);
  assert.deepEqual(event.made, { agua: 1 });
  assert.equal(event.raftRev, ship.rev);
  assert.equal(event.rev, profile.eco.tradeRev);
  assert.ok(event.production.some((row) => row.part === 'purifier' && row.status === 'working'));
  assert.equal(events(messages, visitorId, 'raftProduction').length, 0, 'production report is private to its owner');
  assert.equal(onSave.get(ownerId)?.eco.ships.find((candidate) => candidate.id === ship.id)?.hold.goods.agua, 1,
    'the settled lot reaches the server save callback');
});

test('full hold and signed-save preflight pause purifier output without consuming its earned fraction', () => {
  const saves = hmacSaves('rnv06-purifier-server-save-preflight');
  const profile = purifierProfile();
  const ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.grid = newRaft([...STARTER_RAFT, ['purifier', 1, 0, 0, 0]]);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = {};
  profile.eco.pack.goods = {};
  const { server, messages } = makeServer({ saves });
  const ownerId = 20, owner = joinSigned(server, ownerId, saves.store(profile)), own = ownRaft(server, owner);
  standOnRaft(server, owner, own.active);
  const key = productionKey(['purifier', 1, 0, 0, 0]);
  economySteps(server, 9);
  const earned = own.ship.grid.work[key];
  own.ship.hold.goods = { madera: 2 };
  economySteps(server, 11);
  assert.deepEqual(own.ship.hold.goods, { madera: 2 });
  assert.equal(own.ship.grid.work[key], earned, 'a full hold retains the earned purifier fraction');
  const cargo = cargoStatus(server, messages, ownerId, own.ship);
  assert.equal(cargo?.production.find((row) => row.part === 'purifier')?.status, 'room');

  own.ship.hold.goods = {};
  economySteps(server, 11);
  assert.equal(own.ship.hold.goods.agua, 1);
  assert.ok(own.ship.grid.work[key] > 0);

  const parts = [];
  for (const kind of ['foundation', 'pillar', 'floor'])
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) parts.push([kind, x, z, kind === 'floor' ? 1 : 0, 0]);
  for (let i = 0; i < 4; i++) own.profile.eco.ships.push({ kind: 'raft', id: `purifier-save-limit-${i}`, n: 'Extra',
    hold: { cap: 0, goods: {} }, at: 'sol', hp: 1, rev: 1, grid: { parts: copy(parts), work: {} } });
  assert.ok(saves.store(own.profile).length > MAX_SAVE, 'the guest save fixture exceeds its real HMAC save limit');
  const holdBefore = copy(own.ship.hold), workBefore = copy(own.ship.grid.work), revBefore = own.ship.rev;
  economySteps(server, 1);
  assert.deepEqual(own.ship.hold, holdBefore);
  assert.deepEqual(own.ship.grid.work, workBefore);
  assert.equal(own.ship.rev, revBefore);
  const blocked = events(messages, ownerId, 'raftProduction').at(-1);
  assert.equal(blocked.productionBlocked, 'saveSize');
  assert.equal(blocked.production.find((row) => row.part === 'purifier')?.status, 'saveSize');
});

test('raft capacity preflight refuses a purifier lot when its added cargo would exceed the live structure', () => {
  const { server, messages, ownerId, ship, active } = purifierFixture();
  const piece = ['purifier', 1, 0, 0, 0];
  assert.equal(placement(server, messages, ownerId, ship, 'place-purifier-capacity', piece)?.ok, true);
  const key = productionKey(piece);
  economySteps(server, 9);
  const rev = ship.rev;
  // A wrecked float frame has no remaining cargo allowance. The purifier itself stays live,
  // so the attempted water lot reaches the same capacity preflight used in ordinary production.
  for (const entry of active.condition.entries.filter((candidate) => candidate.part[0] === 'foundation'))
    active.condition = applyPartDamage(active.condition, entry.id, entry.hp).structure;
  persistRaftCondition(active);
  economySteps(server, 11);
  assert.ok(Math.abs(ship.grid.work[key] - 95 / 96) < 1e-9);
  assert.equal(ship.hold.goods.agua, undefined);
  assert.equal(ship.rev, rev);
  const event = events(messages, ownerId, 'raftProduction').at(-1);
  assert.equal(event.productionBlocked, 'capacity');
  assert.equal(event.production.find((row) => row.part === 'purifier')?.status, 'capacity');
});

test('destroyed purifier keeps its fraction and reports broken, then the real repair command resumes it', () => {
  const { server, messages, ownerId, ownerEntity, profile, ship, active } = purifierFixture();
  const piece = ['purifier', 1, 0, 0, 0];
  assert.equal(placement(server, messages, ownerId, ship, 'place-purifier-damage', piece)?.ok, true);
  const key = productionKey(piece);
  economySteps(server, 9);
  const work = ship.grid.work[key];
  const index = ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(piece));
  const entry = active.condition.entries.find((candidate) => JSON.stringify(candidate.part) === JSON.stringify(piece));
  active.condition = applyPartDamage(active.condition, entry.id, entry.hp).structure;
  persistRaftCondition(active);
  economySteps(server, 2);
  assert.equal(ship.grid.work[key], work, 'destroyed equipment neither gains work nor loses its saved fraction');
  const damagedStatus = cargoStatus(server, messages, ownerId, ship);
  assert.equal(damagedStatus?.production.find((row) => row.part === 'purifier')?.status, 'broken');

  profile.eco.pack.goods = { hierro: 3, madera: 2 };
  const beforeRev = ship.rev;
  raftCommand(server, ownerId, { op: 'repair', id: ship.id, expectedRev: ship.rev, opId: 'repair-purifier', index, piece,
    partId: entry.id, expectedHp: 0 });
  const repaired = events(messages, ownerId, 'raftEdit').find((event) => event.opId === 'repair-purifier');
  assert.equal(repaired?.ok, true);
  assert.equal(ship.rev, beforeRev + 1);
  assert.equal(ship.grid.work[key], work, 'repair keeps the exact module fraction');
  economySteps(server, 11);
  assert.equal(ship.hold.goods.agua, 1, 'repaired purifier completes only its remaining online interval');
});

test('voyage lock pauses purifier work; local HMAC rejoin restores produced water and work without offline production', () => {
  const saves = hmacSaves('rnv06-purifier-signed-rejoin');
  const { server, messages } = makeServer({ saves });
  const initial = purifierProfile(); initial.eco.pack.goods.hierro = 2;
  const firstOwnerId = 40, firstOwner = join(server, firstOwnerId, initial), first = ownRaft(server, firstOwner);
  standOnRaft(server, firstOwner, first.active);
  const piece = ['purifier', 1, 0, 0, 0];
  assert.equal(placement(server, messages, firstOwnerId, first.ship, 'place-purifier-rejoin', piece)?.ok, true);
  const key = productionKey(piece);
  economySteps(server, 29);
  const progress = first.ship.grid.work[key];
  assert.equal(first.ship.hold.goods.agua, 1);
  const blob = saves.store(first.profile);
  assert.ok(blob);
  server.disconnect(firstOwnerId);
  server.world.economy.advance(ECON.daySec);

  const ownerId = 41, owner = joinSigned(server, ownerId, blob), own = ownRaft(server, owner);
  assert.equal(own.ship.grid.work[key], progress);
  assert.equal(own.ship.hold.goods.agua, 1);
  assert.ok(own.ship.grid.parts.some((part) => JSON.stringify(part) === JSON.stringify(piece)));
  standOnRaft(server, owner, own.active);
  // The server's real pilot lock is the same gate used by navigation commands.
  server.world.navalPilot.locked = (entity) => entity === owner;
  economySteps(server, 20);
  assert.equal(own.ship.grid.work[key], progress);
  const event = events(messages, ownerId, 'raftProduction').at(-1);
  assert.equal(event.productionBlocked, 'voyage');
  assert.equal(event.production.find((row) => row.part === 'purifier')?.status, 'voyage');

  server.world.navalPilot.locked = () => false;
  assert.equal(cargoStatus(server, messages, ownerId, own.ship)?.production[0]?.status, 'working',
    'docking clears the projected voyage pause before the next economy checkpoint');
  economySteps(server, 11);
  assert.equal(own.ship.hold.goods.agua, 2, 'only resumed online time completes the saved fraction');
});
