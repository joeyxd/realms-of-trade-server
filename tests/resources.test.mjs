import test from 'node:test';
import assert from 'node:assert/strict';
import { HARVEST } from '../src/data/resources.js';
import { DT } from '../src/data/tuning.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { C } from '../src/sim/ecs.js';
import { clearResourceReceipts, installResources, publicResources, resourceCmd } from '../src/sim/systems/resources.js';

function fixture({ players = 1 } = {}) {
  const map = {
    seed: 17,
    landmarks: { spawn: { x: 0, z: 0 }, village: { x: 30, z: 0 } },
    heightAt: () => 2,
    groundAt: () => 2,
    onDock: () => false,
    lawlessAt: () => false,
    colliders: [], npcs: [], racks: [],
    practice: { dummy: { x: 100, z: 100 }, ring: { x: 100, z: 100, r: 1 } },
    toWorld: (x, z) => ({ x, z }),
  };
  const w = { map, tick: 100, events: [], emit(ev) { this.events.push(ev); },
    raftDeck: { surface: () => null }, profiles: new Map(), profileDirty: new Set(),
    ecs: { alive: new Uint8Array(32), dead: new Float32Array(32), mask: new Uint16Array(32), hp: new Float32Array(32), x: new Float32Array(32),
      y: new Float32Array(32), z: new Float32Array(32), moveMag: new Float32Array(32),
      vx: new Float32Array(32), vz: new Float32Array(32), dashT: new Float32Array(32),
      dashBuffer: new Float32Array(32), castK: new Float32Array(32), castLock: new Float32Array(32),
      atkStage: new Float32Array(32), regenT: new Float32Array(32) },
  };
  installResources(w);
  w.resources.nodes = new Map([['wood-1', { id: 'wood-1', kind: 'wood', x: 0, y: 2, z: 0, rev: 1, readyTick: 0 }],
    ['stone-1', { id: 'stone-1', kind: 'stone', x: 5, y: 2, z: 0, rev: 1, readyTick: 0 }]]);
  w.resources.bench = { x: 0, y: 2, z: 0 };
  for (let i = 1; i <= players; i++) {
    w.ecs.alive[i] = 1; w.ecs.mask[i] = C.PLAYER; w.ecs.hp[i] = 100;
    w.ecs.x[i] = 0; w.ecs.y[i] = 2; w.ecs.z[i] = 0;
    w.ecs.dashT[i] = -1; w.ecs.regenT[i] = 10;
    const p = newProfile(); p.eco.pack = { cap: 10, goods: {} };
    w.profiles.set(i, p);
  }
  return w;
}

const gather = (opId, expectedRev = 1, node = 'wood-1') =>
  ({ type: 'resource', op: 'gather', opId, node, expectedRev });
const craft = (opId, expectedRev = 0) =>
  ({ type: 'resource', op: 'craft', opId, recipe: 'madera', expectedRev });
const last = (w) => w.events.at(-1);

test('two players race for one resource; shared depletion and exact replay cannot duplicate goods', () => {
  const w = fixture({ players: 2 });
  assert.equal(resourceCmd(w, 1, gather('a')), true);
  assert.equal(last(w).profileRev, 1, 'private acknowledgement identifies the exact inventory revision');
  assert.equal(w.profiles.get(1).eco.pack.goods.tronco, 1);
  assert.deepEqual(sanitizeProfile(w.profiles.get(1)).eco.pack.goods, { tronco: 1 });
  assert.equal(resourceCmd(w, 2, gather('b')), false);
  assert.equal(last(w).why, 'revision');
  assert.equal(w.profiles.get(2).eco.pack.goods.tronco, undefined);
  assert.equal(resourceCmd(w, 1, gather('a', 1)), true);
  assert.equal(w.profiles.get(1).eco.pack.goods.tronco, 1);
  assert.deepEqual(publicResources(w).nodes.find((n) => n.id === 'wood-1'), {
    id: 'wood-1', kind: 'wood', x: 0, y: 2, z: 0, rev: 2, ready: false, wait: HARVEST.respawnTicks * DT,
  });
});

test('rejects malformed and extra fields without coercion', () => {
  const w = fixture();
  for (const msg of [
    { ...gather('bad'), extra: 1 }, { ...gather('bad'), expectedRev: '1' },
    { ...gather('bad'), node: 1 }, { ...gather('bad'), t: 'evil' },
    { ...craft('bad'), recipe: 'madera', extra: false }, { ...gather('') },
  ]) {
    assert.equal(resourceCmd(w, 1, msg), false);
    assert.equal(last(w).why, 'schema');
  }
  assert.equal(w.profiles.get(1).eco.tradeRev, 0);
  assert.deepEqual(w.profiles.get(1).eco.pack.goods, {});
});

test('denies far, dead, moving, attacking, dashing, water, dock, and deck actions', () => {
  const w = fixture();
  const attempt = (opId) => resourceCmd(w, 1, gather(opId));
  w.ecs.x[1] = 20; assert.equal(attempt('far'), false); assert.equal(last(w).why, 'far');
  w.ecs.x[1] = 0; w.ecs.dead[1] = 1; assert.equal(attempt('dead'), false); assert.equal(last(w).why, 'dead');
  w.ecs.dead[1] = 0; w.ecs.moveMag[1] = 1; assert.equal(attempt('moving'), false); assert.equal(last(w).why, 'busy');
  w.ecs.moveMag[1] = 0; w.ecs.atkStage[1] = 1; assert.equal(attempt('attacking'), false); assert.equal(last(w).why, 'busy');
  w.ecs.atkStage[1] = 0; w.ecs.dashT[1] = 0; assert.equal(attempt('dash'), false); assert.equal(last(w).why, 'busy');
  w.ecs.dashT[1] = -1; w.map.groundAt = () => 10; assert.equal(attempt('water'), false); assert.equal(last(w).why, 'land');
  w.map.groundAt = () => 0; w.ecs.y[1] = 0; assert.equal(attempt('sea-floor'), false); assert.equal(last(w).why, 'land');
  w.map.groundAt = () => 2; w.ecs.y[1] = 2; w.map.onDock = () => true;
  assert.equal(attempt('dock'), false); assert.equal(last(w).why, 'land');
  w.map.onDock = () => false; w.raftDeck.surface = () => ({ id: 'raft' });
  assert.equal(attempt('deck'), false); assert.equal(last(w).why, 'land');
});

test('gathering remains available while a non-aboard player is naval-locked', () => {
  const w = fixture();
  w.navalPilot = { locked: () => true, aboard: () => false };
  assert.equal(resourceCmd(w, 1, gather('shore')), true);
  w.tick += HARVEST.actionTicks;
  w.navalPilot.aboard = () => true;
  assert.equal(resourceCmd(w, 1, gather('aboard', 2)), false);
  assert.equal(last(w).why, 'land');
});

test('gathering requires calm, a live player entity, and a node revision below the cap', () => {
  const w = fixture();
  w.ecs.regenT[1] = 0;
  assert.equal(resourceCmd(w, 1, gather('fight')), false); assert.equal(last(w).why, 'combat');
  w.ecs.regenT[1] = 10;
  const node = w.resources.nodes.get('wood-1');
  node.rev = HARVEST.maxRev;
  assert.equal(resourceCmd(w, 1, gather('rev-limit', HARVEST.maxRev)), false);
  assert.equal(last(w).why, 'revisionLimit');
  node.rev = 1;
  w.ecs.hp[1] = 0;
  assert.equal(resourceCmd(w, 1, gather('dead-hp')), false); assert.equal(last(w).why, 'dead');
});

test('craft requires calm, bench proximity, and no naval lock; pack mutation conserves units', () => {
  const w = fixture();
  w.profiles.get(1).eco.pack.goods = { tronco: 1 };
  w.navalPilot = { locked: () => true };
  assert.equal(resourceCmd(w, 1, craft('locked')), false); assert.equal(last(w).why, 'busy');
  w.navalPilot.locked = () => false; w.ecs.regenT[1] = 0;
  assert.equal(resourceCmd(w, 1, craft('combat')), false); assert.equal(last(w).why, 'combat');
  w.ecs.regenT[1] = 10; w.ecs.x[1] = 10;
  assert.equal(resourceCmd(w, 1, craft('far')), false); assert.equal(last(w).why, 'far');
  w.ecs.x[1] = 0;
  assert.equal(resourceCmd(w, 1, craft('make')), true);
  assert.deepEqual(w.profiles.get(1).eco.pack.goods, { madera: 1 });
  assert.equal(w.profiles.get(1).eco.tradeRev, 1);
  const reloaded = sanitizeProfile(JSON.parse(JSON.stringify(w.profiles.get(1))));
  assert.deepEqual(reloaded.eco.pack.goods, { madera: 1 });
});

test('full pack, revision conflicts and save preflight are atomic', () => {
  const w = fixture();
  const profile = w.profiles.get(1);
  profile.eco.pack = { cap: 3, goods: { madera: 1 } };
  assert.equal(resourceCmd(w, 1, gather('full')), false); assert.equal(last(w).why, 'full');
  assert.equal(profile.eco.tradeRev, 0);
  profile.eco.pack = { cap: 10, goods: {} };
  assert.equal(resourceCmd(w, 1, gather('stale', 9)), false); assert.equal(last(w).why, 'revision');
  const node = w.resources.nodes.get('wood-1');
  const before = structuredClone(profile);
  assert.equal(resourceCmd(w, 1, gather('savefail'), () => false), false); assert.equal(last(w).why, 'saveSize');
  assert.deepEqual(profile, before);
  assert.equal(node.rev, 1); assert.equal(node.readyTick, 0);
  assert.equal(w.profileDirty.size, 0);
});

test('cooldown and respawn use world ticks; receipt window is bounded and clearable on detach', () => {
  const w = fixture();
  assert.equal(resourceCmd(w, 1, gather('once')), true);
  w.tick += HARVEST.actionTicks - 1;
  assert.equal(resourceCmd(w, 1, gather('cool', 2)), false); assert.equal(last(w).why, 'cooldown');
  w.tick += 1;
  assert.equal(resourceCmd(w, 1, gather('still-empty', 2)), false); assert.equal(last(w).why, 'depleted');
  assert.equal(publicResources(w).nodes.find((n) => n.id === 'wood-1').wait,
    (HARVEST.respawnTicks - HARVEST.actionTicks) * DT);
  w.tick += HARVEST.respawnTicks - HARVEST.actionTicks;
  assert.equal(publicResources(w).nodes.find((n) => n.id === 'wood-1').ready, true);
  assert.equal(resourceCmd(w, 1, gather('again', 2)), true);
  assert.equal(resourceCmd(w, 1, gather('again', 2)), true); assert.equal(w.profiles.get(1).eco.pack.goods.tronco, 2);
  assert.equal(resourceCmd(w, 1, gather('again', 3)), false); assert.equal(last(w).why, 'opIdReuse');
  clearResourceReceipts(w, 1);
  assert.equal(w.resources.receipts.has(1), false);
  assert.equal(w.resources.cooldowns.has(1), false);
});

test('keeps only the newest 64 operation receipts per player', () => {
  const w = fixture();
  w.ecs.x[1] = 50;
  for (let i = 0; i < 65; i++)
    assert.equal(resourceCmd(w, 1, gather(`miss${i}`)), false);
  assert.equal(w.resources.receipts.get(1).size, 64);
  assert.equal(w.resources.receipts.get(1).has('miss0'), false);
  w.ecs.x[1] = 0;
  assert.equal(resourceCmd(w, 1, gather('miss0')), true);
});

test('bench crafting rejects missing materials, full output capacity, and revision overflow', () => {
  const w = fixture();
  assert.equal(resourceCmd(w, 1, craft('none')), false); assert.equal(last(w).why, 'materials');
  const p = w.profiles.get(1);
  p.eco.pack = { cap: 5, goods: { tronco: 1, piedra: 1 } };
  assert.equal(resourceCmd(w, 1, craft('full-but-fits')), true);
  assert.equal(p.eco.pack.goods.madera, 1);
  assert.equal(p.eco.pack.goods.piedra, 1);
  w.tick += HARVEST.actionTicks;
  p.eco.pack = { cap: 10, goods: { tronco: 1 } }; p.eco.tradeRev = HARVEST.maxRev;
  assert.equal(resourceCmd(w, 1, craft('limit', HARVEST.maxRev)), false); assert.equal(last(w).why, 'revisionLimit');
});
