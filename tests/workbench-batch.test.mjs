import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAFT_RECIPES, HARVEST } from '../src/data/resources.js';
import { GOODS } from '../src/data/goods.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { C } from '../src/sim/ecs.js';
import { installResources, resourceCmd } from '../src/sim/systems/resources.js';
import { workbenchPreview } from '../src/ui/workbench.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { hmacSaves } from '../server/saves.mjs';

function fixture() {
  const map = { seed: 17, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 30, z: 0 } },
    heightAt: () => 2, groundAt: () => 2, onDock: () => false, lawlessAt: () => false,
    colliders: [], npcs: [], racks: [], practice: { dummy: { x: 100, z: 100 }, ring: { x: 100, z: 100, r: 1 } },
    toWorld: (x, z) => ({ x, z }) };
  const w = { map, tick: 100, events: [], emit(ev) { this.events.push(ev); }, raftDeck: { surface: () => null },
    profiles: new Map(), profileDirty: new Set(), ecs: {
      alive: new Uint8Array(8), dead: new Float32Array(8), mask: new Uint16Array(8), hp: new Float32Array(8),
      x: new Float32Array(8), y: new Float32Array(8), z: new Float32Array(8), moveMag: new Float32Array(8),
      vx: new Float32Array(8), vz: new Float32Array(8), dashT: new Float32Array(8), dashBuffer: new Float32Array(8),
      castK: new Float32Array(8), castLock: new Float32Array(8), atkStage: new Float32Array(8), regenT: new Float32Array(8),
    } };
  installResources(w);
  w.resources.bench = { x: 0, y: 2, z: 0 };
  w.ecs.alive[1] = 1; w.ecs.mask[1] = C.PLAYER; w.ecs.hp[1] = 100;
  w.ecs.x[1] = 0; w.ecs.y[1] = 2; w.ecs.z[1] = 0; w.ecs.dashT[1] = -1; w.ecs.regenT[1] = 10;
  const p = newProfile();
  p.gold = 321; p.flags.tier = 3;
  p.eco.pack = { cap: 40, goods: { tronco: 6, piedra: 2 } };
  w.profiles.set(1, p);
  return w;
}

const craft = (opId, expectedRev = 0, n) => ({ type: 'resource', op: 'craft', opId, recipe: 'madera', expectedRev,
  ...(n === undefined ? {} : { n }) });
const last = (w) => w.events.at(-1);
const snapshot = (w) => structuredClone(w.profiles.get(1));

test('two logs make one board; batch crafting consumes exact inputs and advances one revision', () => {
  const w = fixture(), p = w.profiles.get(1);
  assert.deepEqual(CRAFT_RECIPES.madera.inputs, { tronco: 2 });
  assert.equal(CRAFT_RECIPES.madera.count, 1);
  assert.equal(resourceCmd(w, 1, craft('batch-three', 0, 3)), true);
  assert.deepEqual(p.eco.pack.goods, { madera: 3, piedra: 2 });
  assert.equal(p.eco.tradeRev, 1);
  assert.equal(p.gold, 321); assert.equal(p.flags.tier, 3);
  assert.equal(last(w).count, 3);
  assert.equal(w.profileDirty.has(1), true);
  assert.equal(w.resources.cooldowns.get(1), w.tick + HARVEST.actionTicks);
});

test('exact batch replay does not debit twice; quantity reuse is denied and omitted n equals one', () => {
  const w = fixture(), p = w.profiles.get(1);
  assert.equal(resourceCmd(w, 1, craft('replay', 0, 2)), true);
  const after = snapshot(w);
  assert.equal(resourceCmd(w, 1, craft('replay', 0, 2)), true);
  assert.deepEqual(p, after);
  assert.equal(resourceCmd(w, 1, craft('replay', 0, 3)), false);
  assert.equal(last(w).why, 'opIdReuse');
  assert.deepEqual(p, after);

  w.tick += HARVEST.actionTicks;
  p.eco.pack.goods = { tronco: 2, piedra: 2 }; p.eco.tradeRev++;
  const singleRev = p.eco.tradeRev;
  assert.equal(resourceCmd(w, 1, craft('single', singleRev)), true);
  const afterSingle = snapshot(w);
  assert.equal(resourceCmd(w, 1, craft('single', singleRev, 1)), true);
  assert.deepEqual(p, afterSingle);
});

test('batch schema rejects invalid n values and gather cannot carry n', () => {
  const w = fixture();
  for (const n of ['3', 1.5, 0, -1, HARVEST.craftMax + 1, NaN, null]) {
    assert.equal(resourceCmd(w, 1, craft(`invalid-${String(n)}`, 0, n)), false, `n=${String(n)}`);
    assert.equal(last(w).why, 'schema');
  }
  const missing = craft('omitted-default'); delete missing.n;
  assert.equal(resourceCmd(w, 1, missing), true); // omitted quantity is the single-craft default
  assert.equal(resourceCmd(w, 1, { type: 'resource', op: 'gather', opId: 'gather-n', node: 'coast-1', expectedRev: 1, n: 1 }), false);
  assert.equal(last(w).why, 'schema');
});

test('insufficient materials, stale revision, preflight false or throw leave profile and side effects untouched', () => {
  const w = fixture(), p = w.profiles.get(1);
  const before = snapshot(w);
  p.eco.pack.goods.tronco = 2;
  const short = snapshot(w);
  assert.equal(resourceCmd(w, 1, craft('short', 0, 3)), false);
  assert.equal(last(w).why, 'materials');
  assert.deepEqual(p, short);
  assert.equal(resourceCmd(w, 1, craft('stale', 99, 1)), false);
  assert.equal(last(w).why, 'revision');
  assert.deepEqual(p, short);

  p.eco.pack.goods.tronco = 6;
  for (const preflight of [() => false, () => { throw new Error('fixture'); }]) {
    const state = snapshot(w);
    assert.equal(resourceCmd(w, 1, craft(`savefail-${w.events.length}`, 0, 3), preflight), false);
    assert.equal(last(w).why, 'saveSize');
    assert.deepEqual(p, state);
    assert.equal(w.profileDirty.has(1), false);
    assert.equal(w.resources.cooldowns.has(1), false);
  }
  assert.notDeepEqual(before, short); // fixture mutation itself is independent of rejected crafting
});

test('final output volume overflow rejects the entire batch', () => {
  const w = fixture(), p = w.profiles.get(1);
  p.eco.pack = { cap: 23, goods: { tronco: 6, piedra: 2 } };
  const original = GOODS.madera.volume;
  try {
    // Model a future recipe whose product occupies more space than its inputs.
    GOODS.madera.volume = GOODS.tronco.volume + 4;
    const before = snapshot(w);
    assert.equal(resourceCmd(w, 1, craft('output-overflow', 0, 3)), false);
    assert.equal(last(w).why, 'full');
    assert.deepEqual(p, before);
    assert.equal(w.profileDirty.has(1), false);
    assert.equal(w.resources.cooldowns.has(1), false);
  } finally { GOODS.madera.volume = original; }
});

test('craft rejects dead, low-health, combat, distant, and naval-locked actions', () => {
  const w = fixture(), attempt = (id) => resourceCmd(w, 1, craft(id, 0, 1));
  w.ecs.dead[1] = 1; assert.equal(attempt('dead'), false); assert.equal(last(w).why, 'dead');
  w.ecs.dead[1] = 0; w.ecs.hp[1] = 0; assert.equal(attempt('zero-hp'), false); assert.equal(last(w).why, 'dead');
  w.ecs.hp[1] = 100; w.ecs.regenT[1] = 0; assert.equal(attempt('combat'), false); assert.equal(last(w).why, 'combat');
  w.ecs.regenT[1] = 10; w.ecs.x[1] = 10; assert.equal(attempt('far'), false); assert.equal(last(w).why, 'far');
  w.ecs.x[1] = 0; w.navalPilot = { locked: () => true };
  assert.equal(attempt('naval-lock'), false); assert.equal(last(w).why, 'busy');
});

test('only the first of two distinct requests at the same revision can craft', () => {
  const w = fixture(), p = w.profiles.get(1);
  assert.equal(resourceCmd(w, 1, craft('first', 0, 1)), true);
  w.tick += HARVEST.actionTicks;
  assert.equal(resourceCmd(w, 1, craft('second', 0, 2)), false);
  assert.equal(last(w).why, 'revision');
  assert.deepEqual(p.eco.pack.goods, { tronco: 4, madera: 1, piedra: 2 });
  assert.equal(p.eco.tradeRev, 1);
});

test('pure workbench preview agrees with server batch input, output, and pack-space limits', () => {
  const w = fixture(), p = w.profiles.get(1);
  const preview = workbenchPreview(p, 3);
  assert.equal(preview.craftMax, HARVEST.craftMax);
  assert.equal(preview.inputNeeded, 6);
  assert.equal(preview.outputAmount, 3);
  assert.equal(preview.maxCraftable, 3);
  assert.equal(preview.canCraft, true);

  p.eco.pack = { cap: 22, goods: { tronco: 6, piedra: 2 } };
  const original = GOODS.madera.volume;
  try {
    GOODS.madera.volume = GOODS.tronco.volume + 4;
    const tight = workbenchPreview(p, 3);
    assert.equal(tight.maxCraftable, 0);
    assert.equal(tight.spaceFits, false);
    assert.equal(tight.canCraft, false);
  } finally { GOODS.madera.volume = original; }
});

test('workbench preview and server agree when a recipe would exceed the pack mass limit', () => {
  const w = fixture(), p = w.profiles.get(1);
  p.eco.pack = { cap: 40, maxMass: 28, goods: { tronco: 6, piedra: 2 } };
  const original = GOODS.madera.mass;
  try {
    GOODS.madera.mass = 7;
    const tooHeavy = workbenchPreview(p, 3);
    assert.equal(tooHeavy.massBefore, 26);
    assert.equal(tooHeavy.maxCraftable, 2);
    assert.equal(tooHeavy.massFits, false);
    const before = snapshot(w);
    assert.equal(resourceCmd(w, 1, craft('mass-overflow', 0, 3)), false);
    assert.equal(last(w).why, 'full');
    assert.deepEqual(p, before);

    const allowed = workbenchPreview(p, 2);
    assert.equal(allowed.canCraft, true);
    assert.equal(resourceCmd(w, 1, craft('mass-fits', 0, 2)), true);
    assert.equal(last(w).count, allowed.outputAmount);
    assert.deepEqual(p.eco.pack.goods, { tronco: 2, madera: 2, piedra: 2 });
  } finally { GOODS.madera.mass = original; }
});

test('LocalServer HMAC batch craft acknowledges, saves, replays once, and reloads exact profile state', () => {
    const saves = hmacSaves('workbench-batch-integration-test-secret');
    const makeServer = (options = {}) => {
      const messages = new Map();
      const server = new LocalServer({ seed: 71, bots: 0, enemies: false, dev: false,
        send(id, message) { const list = messages.get(id) || []; list.push(structuredClone(message)); messages.set(id, list); },
        ...options });
      return { server, messages };
    };
    const join = (server, id, save) => {
      server.connect(id);
      server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Workbench ${id}`, skin: 0, weapon: 0, save });
      const entity = server.clients.get(id)?.entity;
      assert.ok(entity, 'latest protocol handshake admits the signed profile');
      return entity;
    };
    const standAtBench = (server, entity) => {
      const bench = server.world.resources.bench;
      assert.ok(bench && [bench.x, bench.y, bench.z].every(Number.isFinite), 'server generated its workbench location');
      const ecs = server.world.ecs;
      ecs.x[entity] = bench.x; ecs.y[entity] = bench.y; ecs.z[entity] = bench.z;
      ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = 0;
      ecs.moveMag[entity] = 0; ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
      ecs.castK[entity] = ecs.castLock[entity] = ecs.atkStage[entity] = 0;
      ecs.regenT[entity] = 100;
    };
    const resourceEvent = (server, messages, id, command) => {
      server.receive(id, { t: MSG.CMD, type: 'resource', ...command });
      server.flushEvents();
      return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT
        && m.ev?.type === 'resource' && m.ev.opId === command.opId)?.ev || null;
    };
    const latestSave = (messages, id) => [...(messages.get(id) || [])].reverse()
      .find((m) => m.t === MSG.SAVE)?.blob || '';

    const initial = newProfile();
    initial.gold = 246;
    initial.eco.pack = { cap: 14, maxMass: 18, goods: { tronco: 4, piedra: 1 } };
    const f = makeServer({ saves }), owner = join(f.server, 31, saves.store(initial));
    const profile = f.server.world.profiles.get(owner);
    standAtBench(f.server, owner);
    const shipCondition = structuredClone(profile.eco.ships[0].condition);
    assert.ok(shipCondition?.entries?.length, 'the signed profile has an attached starter raft condition');

    const command = { op: 'craft', recipe: 'madera', n: 2, expectedRev: profile.eco.tradeRev, opId: 'hmac-batch-2' };
    const ack = resourceEvent(f.server, f.messages, 31, command);
    assert.equal(ack?.ok, true);
    assert.equal(ack.count, 2);
    assert.deepEqual(profile.eco.pack.goods, { madera: 2, piedra: 1 });
    assert.equal(profile.gold, 246);
    assert.deepEqual(profile.eco.ships[0].condition, shipCondition);
    assert.equal(profile.eco.tradeRev, command.expectedRev + 1);

    const afterFirst = structuredClone(profile);
    const replay = resourceEvent(f.server, f.messages, 31, command);
    assert.equal(replay?.ok, true);
    assert.deepEqual(profile, afterFirst, 'the same operation receipt does not consume a second batch');
    f.server.step();
    const blob = latestSave(f.messages, 31);
    assert.ok(blob, 'successful batch sends a signed save');
    assert.ok(saves.load(blob), 'saved profile HMAC verifies');
    f.server.disconnect(31);

    const reopened = makeServer({ saves }), nextOwner = join(reopened.server, 32, blob);
    const restored = reopened.server.world.profiles.get(nextOwner);
    assert.deepEqual(restored.eco.pack.goods, { madera: 2, piedra: 1 });
    assert.equal(restored.gold, 246);
    assert.deepEqual(restored.eco.ships[0].condition, shipCondition);
    assert.equal(restored.eco.tradeRev, command.expectedRev + 1);
    reopened.server.disconnect(32);

    let allowed = false;
    const deniedServer = makeServer({ saves, commandAccess: () => allowed });
    const deniedOwner = join(deniedServer.server, 41, saves.store(initial));
    standAtBench(deniedServer.server, deniedOwner);
    const deniedProfile = deniedServer.server.world.profiles.get(deniedOwner);
    const before = structuredClone(deniedProfile), cooldown = deniedServer.server.world.resources.cooldowns.get(deniedOwner);
    const denied = resourceEvent(deniedServer.server, deniedServer.messages, 41,
      { ...command, opId: 'access-denied-batch', expectedRev: deniedProfile.eco.tradeRev });
    assert.equal(denied, null, 'transport access rejects before the resource handler emits an acknowledgement');
    assert.deepEqual(deniedProfile, before);
    assert.equal(deniedServer.server.world.resources.cooldowns.get(deniedOwner), cooldown);
    assert.equal((deniedServer.messages.get(41) || []).some((m) => m.t === MSG.EVENT && m.ev?.type === 'resource'), false);
    allowed = true;
    deniedServer.server.disconnect(41);
});
