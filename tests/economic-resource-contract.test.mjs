import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { checkedEconomicReceipt, economicOperation } from '../server/economicOperation.mjs';
import { createMemoryStore } from '../server/store.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const world = () => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });
const resourceCommand = (op, changes = {}) => op === 'gather'
  ? { type: 'resource', op, opId: 'gather-1', node: 'palm-1', expectedRev: 1, ...changes }
  : { type: 'resource', op, opId: 'craft-1', recipe: 'madera', expectedRev: 0, n: 10, ...changes };
function operation(command, { worldData = world(), ack = null } = {}) {
  return { operationId: id(1), request: { world: 'world:salty-shore', account: id(2), command,
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: newProfile(), worldData,
    ack: ack ?? { type: 'resource', op: command.op, opId: command.opId, ok: true, why: '', rev: 1 } } };
}
function rejectsInput(raw) {
  assert.throws(() => economicOperation(raw), error => error?.code === 'input');
}

test('resource gather and craft contracts accept exact fields and preserve helper acknowledgement extras', () => {
  for (const command of [resourceCommand('gather'), resourceCommand('craft', { recipe: 'hacha_piedra', n: 1 })]) {
    const raw = operation(command, { ack: { type: 'resource', op: command.op, opId: command.opId,
      ok: true, why: '', rev: 2, good: 'tronco', count: 2, remaining: 1 } });
    const checked = economicOperation(raw);
    assert.deepEqual(checked.request.command, command);
    assert.deepEqual(checked.request.ack, raw.request.ack);
    const receipt = checkedEconomicReceipt({ request: checked.request, result: { ok: true, replay: false,
      profileVersion: 2, worldVersion: 2, ack: checked.request.ack } }, checked.operationId);
    assert.deepEqual(receipt.request.ack, raw.request.ack);
  }
});

test('resource command schemas and revision/count bounds are strict', () => {
  const base = resourceCommand('gather');
  for (const command of [
    { ...base, unexpected: true }, { ...base, node: 'bad node' }, { ...base, expectedRev: 0 },
    { ...base, expectedRev: 2147483647 },
    resourceCommand('craft', { recipe: 'unknown' }), resourceCommand('craft', { n: 11 }),
    resourceCommand('craft', { n: 0 }), resourceCommand('craft', { expectedRev: -1 }),
    resourceCommand('craft', { expectedRev: 2147483647 }),
  ]) rejectsInput(operation(command));
});

test('resource world state is mandatory for resource commands and strictly checked', () => {
  const command = resourceCommand('gather');
  rejectsInput(operation(command, { worldData: { v: 1, seed: 91, economy: new Economy(91).serialize() } }));
  for (const resources of [
    { ...world().resources, tick: -1 },
    { ...world().resources, tick: '1' },
    { v: 1, nodes: [], cooldowns: {} },
    { v: 1, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 4, readyAt: 0 }], cooldowns: {} },
    { v: 1, nodes: [{ id: 'x', kind: 'wood', rev: 1, hits: 0, readyAt: 0 },
      { id: 'x', kind: 'wood', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} },
    { v: 1, nodes: [{ id: 'wood-1', kind: 'wood', rev: 1, hits: 0, readyAt: 0, extra: true }], cooldowns: {} },
    { v: 1, nodes: [{ id: 'wood-1', kind: 'wood', rev: 1, hits: 0, readyAt: 0 }], cooldowns: { 'BAD-UUID': 1 } },
  ]) rejectsInput(operation(command, { worldData: { ...world(), resources } }));
});

test('community and resources can coexist in an economic world snapshot', () => {
  const worldData = { ...world(), community: { v: 1, epoch: id(3), project: { id: 'salty-shore-carpentry',
    version: 1, requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } } } };
  const checked = economicOperation(operation({ type: 'commerce', op: 'buy', opId: 'buy-1', town: 'aldea',
    g: 'madera', n: 1, expectedTotal: 1 }, { worldData,
    ack: { type: 'commerce', op: 'buy', opId: 'buy-1', ok: true, why: '', rev: 1 } }));
  assert.deepEqual(checked.request.worldData, worldData);
});

test('memory storage accepts logical checkpoint advances but rejects rewinds and ordinary node changes', async () => {
  const store = createMemoryStore(), account = id(9), worldId = 'world:salty-shore';
  const profile = newProfile(), baseline = { v: 1, seed: 91, economy: new Economy(91).serialize() };
  await store.initializeProfile(account, profile);
  await store.saveWorld(worldId, baseline, 0);
  let data = { ...baseline, resources: world().resources };
  await store.saveWorld(worldId, data, 1);
  assert.deepEqual(await store.saveWorld(worldId, { ...data, resources: { ...data.resources, tick: 1 } }, 2),
    { ok: true, version: 3 }, 'checkpoint may advance time while node and cooldown data stay fixed');
  data = { ...data, resources: { ...data.resources, tick: 1 } };
  const rewound = { ...data, resources: { ...data.resources, tick: 0 } };
  assert.deepEqual(await store.saveWorld(worldId, rewound, 3), { ok: false, why: 'conflict' });
  const changed = structuredClone(data); changed.resources.nodes[0].rev++;
  assert.deepEqual(await store.saveWorld(worldId, changed, 3), { ok: false, why: 'conflict' });

  const economic = (serial, worldData, command, expectedWorldVersion, expectedProfileVersion = 1) => ({
    operationId: id(serial), request: { world: worldId, account, command, expectedWorldVersion,
      expectedProfileVersion, profile: structuredClone(profile), worldData,
      ack: { type: 'resource', op: command.op, opId: command.opId, ok: true, why: '', rev: 2 } },
  });
  const advance = { ...data, resources: { ...data.resources, tick: 2 } };
  const ordinary = economic(10, advance, { type: 'commerce', op: 'buy', opId: 'buy-tick', town: 'aldea',
    g: 'madera', n: 1, expectedTotal: 0 }, 3);
  ordinary.request.ack.type = 'commerce'; ordinary.request.ack.op = 'buy';
  assert.equal((await store.commitEconomicOperation(ordinary)).ok, true,
    'ordinary economic commits may carry a monotonic tick checkpoint with unchanged nodes');
  const resourceWorld = structuredClone(advance); resourceWorld.resources.tick = 3;
  resourceWorld.resources.nodes[0].rev++;
  const resource = economic(11, resourceWorld, { type: 'resource', op: 'gather', opId: 'gather-tick',
    node: 'palm-1', expectedRev: 1 }, 4, 2);
  assert.equal((await store.commitEconomicOperation(resource)).ok, true,
    'resource operations may change node state while moving the logical tick forward');
  const resourceRewindWorld = structuredClone(resourceWorld); resourceRewindWorld.resources.tick = 2;
  resourceRewindWorld.resources.nodes[0].rev++;
  const resourceRewind = economic(12, resourceRewindWorld, { type: 'resource', op: 'gather',
    opId: 'gather-rewind', node: 'palm-1', expectedRev: 2 }, 5, 3);
  assert.deepEqual(await store.commitEconomicOperation(resourceRewind), { ok: false, why: 'conflict' },
    'resource operations cannot rewind the world tick while changing nodes');
});
