import test from 'node:test';
import assert from 'node:assert/strict';
import { GOODS } from '../src/data/goods.js';
import { FOODS } from '../src/data/survival.js';
import { FIRE_SECONDS, FIRE_FUEL, fuelForKind } from '../src/data/fire.js';
import { BONUS_CHANCES, harvestLoot } from '../src/data/harvestLoot.js';
import { C, KIND } from '../src/sim/ecs.js';
import { consumeNeeds } from '../src/sim/systems/survival.js';
import { freshwaterProfileDelta } from '../src/sim/economy/waterContainers.js';
import { fireProfileDelta } from '../src/sim/systems/fireProfile.js';
import { localFireCmd } from '../src/sim/systems/fire.js';
import { resourceCmd } from '../src/sim/systems/resources.js';

const clone = value => structuredClone(value);
const hash = text => {
  let value = 17;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 2147483647;
  return value;
};

function findId(good, percent, revision = 4) {
  for (let i = 0; i < 100000; i++) {
    const id = `palm-${i}`;
    if (hash(`${id}:${revision}:${good}`) % 100 === percent) return id;
  }
  throw new Error(`no id found for ${good} roll ${percent}`);
}

function fixture({ nodeId = 'palm-1', cap = 10, goods = {}, harvestLootEnabled = true } = {}) {
  const w = {
    map: { groundAt: () => 2, onDock: () => false }, tick: 100, events: [], harvestLootEnabled,
    emit(event) { this.events.push(event); }, profileDirty: new Set(), profiles: new Map(),
    raftDeck: { surface: () => null },
    ecs: { alive: new Uint8Array(4), dead: new Float32Array(4), mask: new Uint16Array(4), hp: new Float32Array(4),
      x: new Float32Array(4), y: new Float32Array(4), z: new Float32Array(4), moveMag: new Float32Array(4),
      vx: new Float32Array(4), vz: new Float32Array(4), dashT: new Float32Array(4), dashBuffer: new Float32Array(4),
      castK: new Float32Array(4), castLock: new Float32Array(4), atkStage: new Float32Array(4), regenT: new Float32Array(4) },
  };
  const node = { id: nodeId, kind: 'palm', x: 0, y: 2, z: 0, rev: 1, readyTick: 0, hits: 0 };
  w.resources = { nodes: new Map(), cooldowns: new Map(), receipts: new Map() };
  w.resources.nodes = new Map([[node.id, node]]);
  w.ecs.alive[1] = 1; w.ecs.mask[1] = C.PLAYER; w.ecs.hp[1] = 100;
  w.ecs.x[1] = 0; w.ecs.y[1] = 2; w.ecs.z[1] = 0; w.ecs.dashT[1] = -1; w.ecs.regenT[1] = 100;
  w.profiles.set(1, { eco: { tradeRev: 0, pack: { cap, goods: { ...goods } }, ships: [] }, tools: { axe: 1 } });
  return { w, node, profile: w.profiles.get(1) };
}

const command = (opId, node, expectedRev) => ({ type: 'resource', op: 'gather', opId, node, expectedRev, lootRules: 1 });
function hit(w, node, opId) {
  if (node.hits) w.tick += 54;
  return resourceCmd(w, 1, command(opId, node.id, node.rev));
}
const latestAck = w => [...w.events].reverse().find(event => event.type === 'resource');

test('stable ASCII rolls use strict chance thresholds and stay near authored rates across node IDs', () => {
  for (const [good, chance] of Object.entries(BONUS_CHANCES)) {
    const included = findId(good, chance - 1), excluded = findId(good, chance);
    assert.equal(harvestLoot('palm', included, 4)[good], 1);
    assert.equal(Object.hasOwn(harvestLoot('palm', excluded, 4), good), false);
    assert.equal(harvestLoot('palm', included, 4)[good], 1, 'same node and final revision repeat exactly');
    const nextRevision = {};
    for (const [candidate, threshold] of Object.entries(BONUS_CHANCES))
      if (hash(`${included}:5:${candidate}`) % 100 < threshold) nextRevision[candidate] = 1;
    assert.deepEqual(harvestLoot('palm', included, 5), nextRevision, 'final revision participates in the independent roll');
    let count = 0;
    for (let i = 0; i < 1000; i++) count += Object.hasOwn(harvestLoot('palm', `palm-${i}`, 4), good) ? 1 : 0;
    assert.ok(Math.abs(count - chance * 10) < 45, `${good}: observed ${count}/1000 for ${chance}%`);
  }
  assert.deepEqual(harvestLoot('wood', 'palm-1', 4), {});
  assert.deepEqual(harvestLoot('palm', 'bad:id', 4), {});
});

test('only a successful final palm hit grants and receipts the independently rolled bonus goods', () => {
  const nodeId = 'palm-final-loot', { w, node, profile } = fixture({ nodeId });
  const expected = harvestLoot('palm', nodeId, 4);
  assert.equal(hit(w, node, 'palm-hit-1'), true);
  assert.equal(Object.hasOwn(latestAck(w), 'loot'), false);
  assert.equal(hit(w, node, 'palm-hit-2'), true);
  assert.equal(Object.hasOwn(latestAck(w), 'loot'), false);
  assert.equal(hit(w, node, 'palm-hit-3'), true);
  const ack = latestAck(w);
  assert.deepEqual(ack.loot, Object.keys(expected).length ? expected : undefined);
  assert.equal(Object.hasOwn(ack, 'loot'), Object.keys(expected).length > 0);
  assert.equal(profile.eco.pack.goods.tronco, 2);
  for (const good of ['resina', 'coco']) assert.equal(profile.eco.pack.goods[good] || 0, expected[good] || 0);
  const after = clone({ node, profile });
  assert.equal(resourceCmd(w, 1, command('palm-hit-3', node.id, 3)), true);
  assert.deepEqual({ node, profile }, after, 'a replay returns its receipt without another roll or debit');
  assert.deepEqual(latestAck(w).loot, Object.keys(expected).length ? expected : undefined);
});

test('bonus capacity denial on the final hit leaves the node, pack, revision, and dirty set untouched', () => {
  const nodeId = findId('resina', 0), expected = harvestLoot('palm', nodeId, 4);
  assert.ok(expected.resina, 'fixture guarantees a resin bonus');
  const { w, node, profile } = fixture({ nodeId, goods: { piedra: 2 } });
  for (let i = 1; i <= 2; i++) assert.equal(hit(w, node, `full-hit-${i}`), true);
  const before = clone({ node, profile, dirty: [...w.profileDirty] });
  assert.equal(hit(w, node, 'full-hit-3'), false);
  assert.equal(latestAck(w).why, 'full');
  assert.deepEqual({ node, profile, dirty: [...w.profileDirty] }, before);
});

test('harvest bonus calculation does not consume world RNG state', () => {
  let calls = 0;
  const { w, node } = fixture();
  w.rng = { next() { calls++; return 0.5; }, state() { return 123; } };
  const state = w.rng.state();
  for (let i = 1; i <= 3; i++) assert.equal(hit(w, node, `rng-hit-${i}`), true);
  assert.equal(calls, 0);
  assert.equal(w.rng.state(), state);
});

test('hand torch spends two logs and one resin for 20 minutes while raft fires keep one plank fuel', () => {
  assert.deepEqual(fuelForKind('handTorch'), { tronco: 2, resina: 1 });
  assert.deepEqual(fuelForKind('lantern'), { madera: 1 });
  assert.deepEqual(FIRE_FUEL, { good: 'madera', count: 1 }, 'legacy raft/UI fuel constant remains available');
  const before = { eco: { tradeRev: 8, pack: { cap: 20, goods: { tronco: 4, resina: 2, madera: 3 } }, ships: [] } };
  const command = { type: 'fire', op: 'load', opId: 'hand-fuel', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true, rules: 2 };
  const result = fireProfileDelta(before, command, 0);
  assert.equal(result.why, '');
  assert.deepEqual(result.profile.eco.pack.goods, { tronco: 2, resina: 1, madera: 3 });
  assert.equal(result.profile.fire.slots.hand.seconds, FIRE_SECONDS.handTorch);
  assert.equal(result.profile.eco.tradeRev, 9);

  const legacy = fireProfileDelta(before, { ...command, opId: 'hand-legacy', rules: undefined }, 0);
  assert.equal(legacy.why, 'input', 'an undefined property is not the historical absent-rules schema');
  const historical = { ...command }; delete historical.rules; historical.opId = 'hand-historical';
  const oldFuel = fireProfileDelta(before, historical, 0);
  assert.equal(oldFuel.why, '');
  assert.deepEqual(oldFuel.profile.eco.pack.goods, { tronco: 4, resina: 2, madera: 2 });

  const missingResin = structuredClone(before);
  delete missingResin.eco.pack.goods.resina;
  assert.equal(fireProfileDelta(missingResin, command, 0).why, 'goods');

  const raft = structuredClone(before), ship = { id: 'raft-one', kind: 'raft', hp: 100, hold: { goods: { madera: 1 } },
    grid: { parts: [] }, condition: { v: 1, next: 2, entries: [] } };
  raft.eco.ships.push(ship);
  ship.grid.parts.push(['lantern', 0, 0, 0, 0]);
  ship.condition = { v: 1, next: 2, entries: [['p1', 'lantern', 0, 0, 0, 0, 10]] };
  const stationCommand = { ...command, opId: 'raft-fuel', expectedRev: 0, ship: 'raft-one', part: 'p1', kind: 'lantern' };
  delete stationCommand.rules;
  const station = fireProfileDelta(raft, stationCommand, 0);
  assert.equal(station.why, '');
  assert.equal(station.profile.eco.ships[0].hold.goods.madera, undefined);
  assert.equal(station.profile.eco.pack.goods.tronco, 4);
  assert.equal(station.profile.eco.pack.goods.resina, 2);
});

function localFireFixture({ harvestLootEnabled, goods }) {
  const profile = { eco: { tradeRev: 4, pack: { cap: 20, goods: { ...goods } }, ships: [] } };
  const w = { fireEnabled: true, harvestLootEnabled, economy: { hours: 0 }, profiles: new Map([[1, profile]]),
    events: [], profileDirty: new Set(), emit(event) { this.events.push(event); },
    ecs: { alive: new Uint8Array(2), kind: new Uint8Array(2), mask: new Uint16Array(2), hp: new Float32Array(2), dead: new Float32Array(2), lantern: new Float32Array(2) } };
  w.ecs.alive[1] = 1; w.ecs.kind[1] = KIND.PLAYER; w.ecs.mask[1] = C.PLAYER; w.ecs.hp[1] = 100;
  return { w, profile };
}

const fireCommand = (opId, rules) => ({ t: 'cmd', type: 'fire', op: 'load', opId, ship: '', part: 'hand',
  kind: 'handTorch', expectedRev: 0, lit: true, ...(rules === undefined ? {} : { rules }) });

test('local fire authority gates new solo worlds but still replays historical one-plank receipts', () => {
  const fresh = localFireFixture({ harvestLootEnabled: true, goods: { madera: 1, tronco: 2, resina: 1 } });
  const missingMarker = localFireCmd(fresh.w, 1, fireCommand('new-world-old-form', undefined));
  assert.equal(missingMarker.why, 'command');
  assert.equal(fresh.profile.eco.pack.goods.madera, 1);
  const paidNew = localFireCmd(fresh.w, 1, fireCommand('new-world-rules2', 2));
  assert.equal(paidNew.ok, true);
  assert.deepEqual(fresh.profile.eco.pack.goods, { madera: 1 });

  const old = localFireFixture({ harvestLootEnabled: false, goods: { madera: 1 } });
  const historical = fireCommand('historical-torch', undefined);
  assert.equal(localFireCmd(old.w, 1, historical).ok, true);
  assert.equal(old.profile.eco.pack.goods.madera, undefined);
  old.w.harvestLootEnabled = true;
  const replay = localFireCmd(old.w, 1, historical);
  assert.equal(replay.ok, true); assert.equal(replay.replay, true);
  assert.equal(old.profile.eco.pack.goods.madera, undefined, 'replay returns before the active rules gate and never spends twice');
});

test('local resource authority requires lootRules only on enabled palms and preserves stored legacy receipts', () => {
  const fresh = fixture({ harvestLootEnabled: true });
  const noMarker = { type: 'resource', op: 'gather', opId: 'new-palm-old-form', node: fresh.node.id, expectedRev: 1 };
  assert.equal(resourceCmd(fresh.w, 1, noMarker), false);
  assert.equal(latestAck(fresh.w).why, 'schema');
  assert.equal(fresh.node.rev, 1);
  assert.equal(hit(fresh.w, fresh.node, 'new-palm-versioned'), true);

  const old = fixture({ harvestLootEnabled: false });
  const historical = { type: 'resource', op: 'gather', opId: 'old-palm-receipt', node: old.node.id, expectedRev: 1 };
  assert.equal(resourceCmd(old.w, 1, historical), true);
  const before = clone({ node: old.node, profile: old.profile });
  old.w.harvestLootEnabled = true;
  assert.equal(resourceCmd(old.w, 1, historical), true);
  assert.deepEqual({ node: old.node, profile: old.profile }, before, 'historical replay is resolved before the active rules gate');
  assert.equal(Object.hasOwn(latestAck(old.w), 'loot'), false);
});

test('coco has the requested trade dimensions and restores 25 hydration through the normal food path', () => {
  assert.deepEqual({ cat: GOODS.coco.cat, base: GOODS.coco.base, volume: GOODS.coco.volume, mass: GOODS.coco.mass },
    { cat: 'food', base: 4, volume: 1, mass: 0.5 });
  assert.deepEqual(FOODS.coco, { sat: 0, hyd: 25 });
  const thirsty = consumeNeeds({ gold: 0, surv: { v: 1, sat: 62, hyd: 30 } }, 'coco');
  assert.deepEqual(thirsty.surv, { v: 1, sat: 62, hyd: 55 });
  const profile = { eco: { tradeRev: 3, pack: { cap: 10, goods: { coco: 1 } }, ships: [] },
    surv: { v: 1, sat: 62, hyd: 30 } };
  const eaten = freshwaterProfileDelta(profile, { type: 'freshwater', op: 'eat', opId: 'eat-coco', expectedRev: 3,
    source: 'coco', ship: '', part: '', n: 1 });
  assert.equal(eaten.why, '');
  assert.equal(eaten.profile.eco.pack.goods.coco, undefined);
  assert.deepEqual(eaten.profile.surv, { v: 1, sat: 62, hyd: 55 });
});
