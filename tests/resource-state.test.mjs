import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { checkedResourceState, newResourceState, restoreResourceState } from '../server/resourceState.mjs';

function fixture() {
  const host = new GameHost({ seed: 97, bots: 0, log() {} });
  return { host, world: host.server.world };
}

test('resource restore pauses offline, keeps partial work, and retains revisions', t => {
  const { world } = fixture(), data = newResourceState(world);
  const palm = data.nodes.find(n => n.kind === 'palm'), wood = data.nodes.find(n => n.kind === 'wood');
  palm.hits = 2; palm.rev = 3;
  wood.rev = 2; wood.readyAt = 800; data.tick = 500;
  t.mock.method(Date, 'now', () => 2000000000000);
  restoreResourceState(world, data);
  assert.equal(world.resources.nodes.get(wood.id).readyTick, 300);
  assert.equal(world.resources.nodes.get(palm.id).hits, 2);
  t.mock.method(Date, 'now', () => 3000000000000);
  restoreResourceState(world, data);
  assert.equal(world.resources.nodes.get(wood.id).readyTick, 300, 'wall time cannot finish respawn');
  data.tick = 800;
  restoreResourceState(world, data);
  assert.equal(world.resources.nodes.get(wood.id).readyTick, 0);
  assert.equal(world.resources.nodes.get(wood.id).rev, 2);
  assert.equal(world.resources.nodes.get(palm.id).hits, 2);
  palm.hits = 3; palm.readyAt = 800;
  restoreResourceState(world, data);
  assert.equal(world.resources.nodes.get(palm.id).hits, 0, 'a fully exhausted palm regrows after its deadline');
  assert.equal(world.resources.nodes.get(palm.id).rev, 3, 'regrowth cannot revive a stale operation revision');
});

test('invalid or incompatible resource snapshots fail before changing any live node', () => {
  const { world } = fixture(), data = newResourceState(world), before = structuredClone(world.resources.nodes);
  for (const change of [
    state => state.nodes.push({ ...state.nodes[0] }),
    state => { state.nodes[0].hits = 100; },
    state => { state.nodes[0].readyAt = -1; },
    state => { state.tick = -1; },
    state => { state.nodes[0].id = 'missing-layout-node'; },
    state => { state.nodes.pop(); },
    state => { state.cooldowns['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = '123'; },
  ]) {
    const bad = structuredClone(data); change(bad);
    assert.throws(() => restoreResourceState(world, bad), { code: 'world_format' });
    assert.deepEqual(world.resources.nodes, before);
  }
  const copy = checkedResourceState(data); copy.nodes[0].rev = 999;
  assert.equal(data.nodes[0].rev, 1);
});

test('resource migration must pass before world creation and cannot silently fall back', async () => {
  const base = createMemoryStore(); let writes = 0;
  const store = { ...base, checkResourceOperations: async () => { throw new Error('missing SQL015'); },
    saveWorld: async (...args) => { writes++; return base.saveWorld(...args); } };
  const host = new GameHost({ seed: 97, bots: 0, store, resolvePlayer: async () => null,
    worldId: 'resource-preflight', economicOperations: true, resourceOperations: true, log() {} });
  await assert.rejects(host.prepare());
  assert.equal(writes, 0); assert.equal(host.healthy(), false);
  assert.equal(host.server.step(), false);
  await host.close().catch(() => {});
});

test('worlds with durable resources refuse an old snapshot-only resource host', async () => {
  const store = createMemoryStore(), opts = { seed: 97, bots: 0, store, resolvePlayer: async () => null,
    worldId: 'resource-downgrade', economicOperations: true, log() {} };
  const first = new GameHost({ ...opts, resourceOperations: true });
  await first.prepare(); await first.close();
  const saved = await store.loadWorld(opts.worldId);
  const second = new GameHost(opts);
  await assert.rejects(second.prepare(), { code: 'configuration' });
  assert.equal(second.healthy(), false);
  await second.close().catch(() => {});
  assert.deepEqual(await store.loadWorld(opts.worldId), saved);
  const erased = structuredClone(saved.data); delete erased.resources;
  assert.deepEqual(await store.saveWorld(opts.worldId, erased, saved.version), { ok: false, why: 'conflict' });
});

test('world autosaves checkpoint only monotonic resource time and preserve the epoch across restarts', async t => {
  const store = createMemoryStore(), opts = { seed: 97, bots: 0, store, resolvePlayer: async () => null,
    worldId: 'resource-clock', economicOperations: true, resourceOperations: true, log() {} };
  const first = new GameHost(opts);
  t.after(() => first.close().catch(() => {}));
  await first.prepare(); first.server.world.tick = 150;
  first.worldState.save(first.server.world.economy); await first.worldState.flush();
  const saved = await store.loadWorld(opts.worldId);
  assert.equal(saved.data.resources.tick, 150);
  assert.equal(first.worldState.resources.tick, 150);
  for (const change of [
    resources => { resources.tick--; },
    resources => { resources.tick++; resources.nodes[0].rev++; },
    resources => { resources.cooldowns['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = 250; },
  ]) {
    const invalid = structuredClone(saved.data); change(invalid.resources);
    assert.deepEqual(await store.saveWorld(opts.worldId, invalid, saved.version), { ok: false, why: 'conflict' });
    assert.deepEqual(await store.loadWorld(opts.worldId), saved);
  }
  await first.close();
  const second = new GameHost(opts); t.after(() => second.close().catch(() => {}));
  await second.prepare();
  assert.equal(second.server.world.tick, 0);
  assert.equal(second.worldState.resourceTick(), 150);
  second.server.world.tick = 10; await second.close();
  assert.equal((await store.loadWorld(opts.worldId)).data.resources.tick, 160);
});
