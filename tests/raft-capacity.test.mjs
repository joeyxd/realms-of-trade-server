import test from 'node:test';
import assert from 'node:assert/strict';
import { GOODS } from '../src/data/goods.js';
import { RAFT_PARTS, STARTER_RAFT } from '../src/data/raftparts.js';
import { newHold, goodMass, goodVolume, holdMass, holdUsed, load, roomFor, sanitizeHold } from '../src/sim/economy/cargo.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { raftCapacity } from '../src/sim/economy/raftCapacity.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { createTrialBody, damageTrialBody } from '../src/sim/naval/trialBody.js';
import { GameClient } from '../src/client/gameClient.js';
import { map } from './helpers.mjs';
import { confirmedNavalCapacity } from '../src/ui/navalHudState.js';

test('equal-volume goods retain distinct masses; storage capacity uses volume while ballast uses mass', () => {
  assert.equal(GOODS.piedra.volume, GOODS.lona.volume);
  assert.equal(goodVolume('piedra'), 2);
  assert.equal(goodVolume('lona'), 2);
  assert.equal(goodMass('piedra'), 4);
  assert.equal(goodMass('lona'), 1);

  const hold = newHold(6), pack = newHold(10);
  assert.equal(load(hold, 'lona', 1), true);
  assert.equal(load(pack, 'piedra', 1), true);
  assert.equal(holdUsed(hold), 2);
  assert.equal(holdMass(hold), 1);
  assert.equal(holdUsed(pack), 2);
  assert.equal(holdMass(pack), 4);
  assert.equal(roomFor(hold, 'hierro'), 1, 'iron room is bounded by volume 3, not its mass 6');

  const capacity = raftCapacity(STARTER_RAFT, hold, pack);
  assert.equal(capacity.holdVolume, 2);
  assert.equal(capacity.holdFree, 4);
  assert.equal(capacity.packVolume, 2);
  assert.equal(capacity.packFree, 8);
  assert.equal(capacity.holdMass, 1);
  assert.equal(capacity.packMass, 4);
  assert.equal(capacity.cargoMass, 5);
  assert.equal(capacity.totalMass, capacity.dryMass + 5 + capacity.crewMass,
    'the capacity forecast reserves the pilot body independently of cargo');
});

test('crate raises volume capacity; upper structure adds dry mass without changing flotation', () => {
  const noFloats = raftCapacity([], newHold(0), newHold());
  const oneFoundation = raftCapacity([STARTER_RAFT[0]], newHold(0), newHold());
  assert.equal(oneFoundation.buoyancy, 14);
  assert.equal(oneFoundation.structuralLimit, 10);
  assert.equal(oneFoundation.totalLimit, 10, 'the structural rating is the bottleneck for a single basic foundation');
  assert.equal(oneFoundation.freeMass, 3, 'reserve the pilot from the structure-limited carrying allowance');
  assert.ok(oneFoundation.freeMass > noFloats.freeMass);

  const base = newRaft(STARTER_RAFT);
  const baseCap = raftStats(base).hold;
  const baseReading = raftCapacity(base.parts, newHold(baseCap), newHold());

  const withStorage = newRaft([...STARTER_RAFT, ['storage', 1, 0, 0, 0]]);
  const storageCap = raftStats(withStorage).hold;
  const storageReading = raftCapacity(withStorage.parts, newHold(storageCap), newHold());
  assert.ok(storageCap > baseCap);
  assert.equal(storageReading.holdCap, storageCap);
  assert.equal(storageReading.buoyancy, baseReading.buoyancy, 'storage adds volume, not flotation');
  assert.equal(storageReading.freeMass, baseReading.freeMass - RAFT_PARTS.storage.weight,
    'empty storage still consumes flotation reserve through its dry mass');

  const withUpper = newRaft([...withStorage.parts, ['pillar', 0, 1, 0, 0], ['floor', 0, 1, 1, 0]]);
  const upperReading = raftCapacity(withUpper.parts, newHold(storageCap), newHold());
  assert.equal(upperReading.holdCap, storageCap);
  assert.equal(upperReading.buoyancy, storageReading.buoyancy);
  assert.equal(upperReading.dryMass, storageReading.dryMass + RAFT_PARTS.pillar.weight + RAFT_PARTS.floor.weight,
    'the added pillar and floor add their structural mass only');
});

test('lethal foundation damage rebuilds flotation from live parts while preserving cargo', () => {
  const hold = newHold(6), pack = newHold(10);
  load(hold, 'piedra', 1); load(pack, 'lona', 1);
  const contentsBefore = { hold: structuredClone(hold.goods), pack: structuredClone(pack.goods) };
  const cargo = [{ mass: goodMass('piedra'), x: 0, z: 0 }, { mass: goodMass('lona'), x: 0, z: 0 }];
  const body = createTrialBody(STARTER_RAFT, { x: 0, y: 0.72, z: 0, yaw: 0 }, 'capacity-damage', 0,
    { cargo, navigation: true, flowOrigin: { x: 0, z: 0, yaw: 0 }, wind: { yaw: 0, strength: 0 } });
  const before = raftCapacity(body.operational.parts, hold, pack, body.operational.rig);
  const foundation = body.structure.entries.find((entry) => entry.part[0] === 'foundation');
  const damaged = damageTrialBody(body, foundation.id, foundation.maxHp);
  assert.equal(damaged.event.destroyed, true);
  assert.equal(damaged.body.operational.disabled, false, 'three surviving foundations keep the voyage operational');
  const after = raftCapacity(damaged.body.operational.parts, hold, pack, damaged.body.operational.rig);
  assert.equal(after.buoyancy, damaged.body.operational.rig.buoyancy);
  assert.equal(after.cargoMass, before.cargoMass);
  assert.equal(after.holdMass, 4); assert.equal(after.packMass, 1);
  assert.ok(after.freeMass < before.freeMass, 'lost flotation reserve is visible without deleting cargo');
  assert.deepEqual(hold.goods, contentsBefore.hold);
  assert.deepEqual(pack.goods, contentsBefore.pack);
});

test('legacy over-cap cargo survives sanitize and dimensions are derived without save migration', () => {
  const legacy = newProfile();
  const ship = legacy.eco.ships.find((entry) => entry.kind === 'raft');
  ship.hold.goods = { hierro: 3 };
  ship.hold.cap = 999;
  delete legacy.eco.raftV;

  const restored = sanitizeProfile(JSON.parse(JSON.stringify(legacy)));
  const hold = restored.eco.ships.find((entry) => entry.kind === 'raft').hold;
  assert.equal(hold.cap, raftStats(restored.eco.ships.find((entry) => entry.kind === 'raft').grid).hold,
    'capacity is recalculated from the saved blueprint');
  assert.deepEqual(hold.goods, { hierro: 3 }, 'old goods are not discarded when recalculated capacity is lower');
  assert.equal(holdUsed(hold), 9, 'the catalog volume applies to the unchanged saved count');
  assert.equal(holdMass(hold), 18, 'the catalog mass applies independently to that same count');
  const reading = raftCapacity(restored.eco.ships[0].grid.parts, hold, restored.eco.pack);
  assert.equal(reading.holdFree, 0, 'over-cap legacy cargo reports no remaining volume');
  assert.equal(reading.overMass, Math.max(0, reading.totalMass - reading.totalLimit));

  const sanitized = sanitizeHold({ goods: { piedra: 1, lona: 1 } }, 4);
  assert.deepEqual(sanitized.goods, { piedra: 1, lona: 1 });
  assert.equal(holdUsed(sanitized), 4);
  assert.equal(holdMass(sanitized), 5);
});

test('GameClient commits only accepted capacity snapshots, rejects old ticks, and clears an accepted null', () => {
  const transport = { onSnapshot() {}, onMessage() {}, send() {}, sendInput() {}, start() {} };
  const client = new GameClient(transport, map, { emit() {} });
  const first = { id: 'raft-a', mode: 'port', holdVolume: 0, cargoMass: 0 };
  const feed = (snapshot) => client.onSnapshot({ ack: 0, ents: [], rafts: [], ...snapshot });
  feed({ tick: 10, capacity: first });
  assert.equal(client.capacity, first, 'fresh owner-private capacity reaches the client from an accepted snapshot');
  feed({ tick: 9, capacity: { ...first, cargoMass: 99 } });
  assert.equal(client.capacity, first, 'an older snapshot cannot roll capacity back');
  feed({ tick: 11, naval: { active: true, body: { state: { tick: 10 } } },
    capacity: { ...first, cargoMass: 77 } });
  assert.equal(client.lastSnapshotTick, 10, 'a rejected mixed-clock snapshot is not partially committed');
  assert.equal(client.capacity, first);
  feed({ tick: 11, capacity: null });
  assert.equal(client.capacity, null, 'accepted no-owned-raft state clears the prior reading');
});

test('confirmed owner HUD capacity follows raft/profile revisions and port, sailing, and reboard modes', () => {
  const id = 'raft-owner-a';
  const ship = { kind: 'raft', id, rev: 4 };
  const capacity = { id, raftRev: 4, tradeRev: 3, mode: 'port', freeMass: 10, overMass: 0,
    holdVolume: 2, holdCap: 6 };
  const client = { capacity, profile: { eco: { tradeRev: 3, ships: [ship] } },
    naval: { active: false }, voyage: { active: false } };
  const raft = { id, rev: 4 };
  assert.equal(confirmedNavalCapacity(client, raft), capacity, 'matching private snapshot and plan are confirmed');

  ship.rev += 1; raft.rev += 1;
  assert.equal(confirmedNavalCapacity(client, raft), null, 'old capacity is hidden after the owner plan advances');
  client.capacity = { ...capacity, raftRev: ship.rev };
  client.profile.eco.tradeRev += 1;
  assert.equal(confirmedNavalCapacity(client, raft), null, 'old capacity is hidden after pack revision advances');
  client.capacity = { ...client.capacity, tradeRev: client.profile.eco.tradeRev };
  assert.equal(confirmedNavalCapacity(client, raft), client.capacity);

  assert.equal(confirmedNavalCapacity(client, { ...raft, id: 'other-raft' }), null, 'another raft ID is never shown');
  assert.equal(confirmedNavalCapacity(client, raft, { active: true, phase: 'shore', shipId: 'other-raft' }), null,
    'a voyage tied to another ship invalidates the reading');
  client.profile.eco.ships = [{ kind: 'raft', id: 'other-raft', rev: raft.rev }];
  assert.equal(confirmedNavalCapacity(client, raft), null, 'a client without ownership of this raft has no reading');
  client.profile.eco.ships = [ship];

  client.capacity = { ...client.capacity, mode: 'sailing' };
  assert.equal(confirmedNavalCapacity(client, raft), null, 'sailing data is not confirmed when not sailing');
  client.naval.active = true;
  assert.equal(confirmedNavalCapacity(client, raft), client.capacity);
  client.voyage = { active: true, phase: 'shore', shipId: id };
  client.capacity = { ...client.capacity, mode: 'reboard' };
  assert.equal(confirmedNavalCapacity(client, raft), client.capacity, 'a fresh shore reading confirms reboard mass');

  const validReboard = client.capacity;
  for (const [field, invalid] of [['freeMass', Number.POSITIVE_INFINITY], ['overMass', -1],
    ['holdVolume', Number.NaN], ['holdCap', -0.1]]) {
    client.capacity = { ...validReboard, [field]: invalid };
    assert.equal(confirmedNavalCapacity(client, raft), null, `${field} must be finite and nonnegative`);
  }
});
