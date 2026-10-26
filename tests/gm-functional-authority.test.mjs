import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_ONE, RESOURCE_WORLD, accountProfile, calmAt, connect, makeResourceHost, makeResourceStore, submitAndApply } from './helpers/resource-authority-fixture.mjs';
import { upgradeLoggingState, upgradeTimingState } from '../server/resourceState.mjs';

const GM_ID = `gm_${'a'.repeat(32)}`;
const clone = value => structuredClone(value);
const target = (host, kind = 'palm', id = GM_ID, x = null) => {
  const old = [...host.server.world.resources.nodes.values()].find(node => node.kind === kind);
  return { gmResources: [{ id, kind, x: x ?? old.x, y: old.y, z: old.z,
    ...(kind === 'palm' ? { scale: 1, rot: 0 } : {}) }] };
};
const clean = (t, host) => t.after(async () => {
  try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
});

async function prepared(t, { options = {}, id = GM_ID } = {}) {
  const { base, store: raw } = makeResourceStore();
  const store = { ...raw, durable: true };
  await store.initializeProfile(ACCOUNT_ONE, accountProfile({ tools: { axe: 1 } }));
  await store.checkResourceOperations();
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  clean(t, host);
  await host.prepare();
  return { base, store, host, id };
}

async function activate(host, map) {
  const resume = host.beginContentSwitch();
  try {
    await host.prepareContentResources(map);
    host.server.world.map.gmResources = clone(map.gmResources || []);
    host.installContentResources();
  } finally { resume(); }
}

test('authored resource admission is gated, appended by CAS, installed from map.gmResources, and gathered through normal authority', async t => {
  const f = await prepared(t), { host, store, id } = f;
  const map = target(host);
  const before = clone(host.worldState.resources);
  await assert.rejects(host.prepareContentResources(map), { code: 'gm_resource_unavailable' });
  assert.deepEqual(host.worldState.resources, before, 'preflight outside the content-switch lease makes no write');

  await activate(host, map);
  assert.equal(host.server.world.resources.nodes.has(id), true);
  const durable = await store.loadWorld(RESOURCE_WORLD);
  assert.deepEqual(durable.data.resources.nodes.at(-1), { id, kind: 'palm', rev: 1, hits: 0, readyAt: 0 });
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity;
  const node = host.server.world.resources.nodes.get(id); calmAt(host, entity, node);
  const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', node: id,
    expectedRev: node.rev, opId: 'gm-palm-hit-1' });
  assert.equal(ack?.ok, true);
  assert.equal(host.worldState.resources.nodes.find(row => row.id === id).hits, 1);
});

test('authored palms enforce tool and range checks, then award v2 logging once on the third hit', async t => {
  const f = await prepared(t, { options: { loggingOperations: true } }), { host, store, id } = f;
  await activate(host, target(host));
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity, node = host.server.world.resources.nodes.get(id);
  const profile = host.server.world.profiles.get(entity);
  calmAt(host, entity, node);
  profile.tools.axe = 0;
  const noAxe = await submitAndApply(host, client, { type: 'resource', op: 'gather', node: id,
    expectedRev: node.rev, opId: 'gm-palm-no-axe' });
  assert.equal(noAxe?.ok, false); assert.equal(noAxe?.why, 'tool'); assert.equal(node.hits, 0);
  profile.tools.axe = 1;
  calmAt(host, entity, { ...node, x: node.x + 12 });
  const outOfRange = await submitAndApply(host, client, { type: 'resource', op: 'gather', node: id,
    expectedRev: node.rev, opId: 'gm-palm-range' });
  assert.equal(outOfRange?.ok, false); assert.equal(node.hits, 0);
  for (let i = 0; i < 3; i++) {
    calmAt(host, entity, node);
    while ((host.server.world.resources.cooldowns.get(entity) || 0) > host.server.world.tick) host.server.step();
    const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', node: id,
      expectedRev: node.rev, opId: `gm-palm-cycle-${i}` });
    assert.equal(ack?.ok, true, JSON.stringify(ack));
    assert.equal(ack.count, i === 2 ? 2 : 0);
  }
  assert.equal(profile.progression.practice.logging, 10);
  assert.equal(profile.eco.pack.goods.tronco, 2);
  const state = (await store.loadWorld(RESOURCE_WORLD)).data.resources;
  assert.equal(state.v, 2);
  assert.deepEqual(state.logging[id], { cycle: 1, contributors: [{ actor: ACCOUNT_ONE, hits: 3 }] });
});

test('authored stone pickup uses normal authority and an operation replay cannot duplicate the reward', async t => {
  const f = await prepared(t), { host, store } = f;
  const map = target(host, 'stone'); await activate(host, map);
  const id = map.gmResources[0].id;
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity, node = host.server.world.resources.nodes.get(id);
  calmAt(host, entity, node);
  const command = { type: 'resource', op: 'gather', node: id, expectedRev: node.rev, opId: 'gm-stone-pickup' };
  assert.equal((await submitAndApply(host, client, command))?.ok, true);
  const after = clone(host.server.world.profiles.get(entity));
  assert.equal(after.eco.pack.goods.piedra, 1);
  assert.equal((await submitAndApply(host, client, command))?.replay, true);
  assert.deepEqual(host.server.world.profiles.get(entity), after);
  assert.equal((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes.find(row => row.id === id).rev, 2);
});

test('removed and moved authored nodes retain depleted state through rollback, reactivation, and restart', async t => {
  const f = await prepared(t, { options: { loggingOperations: true } }), { host, store, id } = f;
  await activate(host, target(host));
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity, node = host.server.world.resources.nodes.get(id);
  calmAt(host, entity, node);
  for (let i = 0; i < 3; i++) {
    calmAt(host, entity, node);
    while ((host.server.world.resources.cooldowns.get(entity) || 0) > host.server.world.tick) host.server.step();
    const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', node: id,
      expectedRev: node.rev, opId: `gm-palm-deplete-${i}` });
    assert.equal(ack?.ok, true);
  }
  const exhausted = clone(host.worldState.resources.nodes.find(row => row.id === id));
  assert.equal(exhausted.hits, 3);
  assert.ok(exhausted.readyAt > host.worldState.resources.tick, 'depletion persists a future logical respawn deadline');
  const ledger = clone(host.worldState.resources.logging[id]);
  assert.equal(ledger.contributors[0].hits, 3);
  host.onClose(host.sockets.get(client.id), true);
  await host.economicAuthority.settle(); await host.profiles.flush(); await host.worldState.flush();

  const moved = target(host, 'palm', id, node.x + 20);
  await activate(host, moved);
  assert.deepEqual(host.worldState.resources.nodes.find(row => row.id === id), exhausted);
  assert.deepEqual(host.worldState.resources.logging[id], ledger);
  await activate(host, { gmResources: [] });
  assert.equal(host.server.world.resources.nodes.has(id), false);
  assert.deepEqual((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes.find(row => row.id === id), exhausted,
    'removal tombstones rather than prunes durable depletion');
  assert.deepEqual((await store.loadWorld(RESOURCE_WORLD)).data.resources.logging[id], ledger);
  await activate(host, target(host, 'palm', id, node.x + 20));
  assert.equal(host.server.world.resources.nodes.get(id).hits, exhausted.hits, 'rollback/republication restores the existing identity');
  await host.close();

  const restarted = makeResourceHost(store, async () => ACCOUNT_ONE, { loggingOperations: true });
  clean(t, restarted);
  restarted.server.world.map.gmResources = clone(moved.gmResources);
  restarted.installContentResources();
  await restarted.prepare();
  assert.equal(restarted.server.world.resources.nodes.get(id).hits, exhausted.hits);
  assert.equal(restarted.worldState.resources.nodes.find(row => row.id === id).rev, exhausted.rev);
  assert.equal(restarted.worldState.resources.nodes.find(row => row.id === id).readyAt, exhausted.readyAt);
  assert.deepEqual(restarted.worldState.resources.logging[id], ledger);
});

test('append-only roster creates schema-correct palm ledgers for resource baselines v1, v2, and v3', async t => {
  for (const [label, options, expected] of [
    ['v1', {}, 1], ['v2', { loggingOperations: true }, 2],
    ['v3', { loggingOperations: true, artisanOperations: true, workshopOperations: true }, 3],
  ]) {
    await t.test(label, async st => {
      const f = await prepared(st, { options });
      const { host, store } = f;
      assert.equal(host.worldState.resources.v, expected);
      await activate(host, target(host));
      const state = (await store.loadWorld(RESOURCE_WORLD)).data.resources;
      if (expected === 2) assert.deepEqual(state.logging[GM_ID], { cycle: 1, contributors: [] });
      if (expected === 3) assert.deepEqual(state.logging[GM_ID], { cycle: 1, contributors: [], quality: 0 });
      if (expected === 1) assert.equal(Object.hasOwn(state, 'logging'), false);
    });
  }
  const v2 = upgradeLoggingState({ v: 1, tick: 0, nodes: [{ id: GM_ID, kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} });
  assert.deepEqual(upgradeTimingState(v2).logging[GM_ID], { cycle: 1, contributors: [], quality: 0 });
});

test('CAS conflict and ambiguous SQL acknowledgement fence the host without installing the target map', async t => {
  for (const mode of ['conflict', 'ambiguous']) await t.test(mode, async st => {
    const { base, store: initial } = makeResourceStore();
    const store = { ...initial, durable: true };
    await store.initializeProfile(ACCOUNT_ONE, accountProfile()); await store.checkResourceOperations();
    let host;
    store.admitGmResources = async (...args) => {
      if (mode === 'conflict') {
        const current = await base.loadWorld(RESOURCE_WORLD);
        const bumped = await base.saveWorld(RESOURCE_WORLD, current.data, current.version);
        assert.equal(bumped.ok, true);
      } else {
        await base.admitGmResources(...args);
        throw new Error('lost SQL acknowledgement');
      }
      return base.admitGmResources(...args);
    };
    host = makeResourceHost(store);
    clean(st, host); await host.prepare();
    const before = clone(host.server.world.map.gmResources || []);
    const resume = host.beginContentSwitch();
    try { await assert.rejects(host.prepareContentResources(target(host)), mode === 'conflict' ? /conflict/ : /acknowledgement/); }
    finally { resume(); }
    assert.equal(host.worldState.failed, true);
    assert.deepEqual(host.server.world.map.gmResources || [], before);
    assert.equal((await base.loadWorld(RESOURCE_WORLD)).data.resources.nodes.some(row => row.id === GM_ID), mode === 'ambiguous');
  });
});

test('unsupported ground-authority resource admission rejects before roster writes', async t => {
  for (const missing of ['capability', 'readiness']) await t.test(missing, async st => {
    const f = await prepared(st), { host, base, store } = f;
    const before = await base.loadWorld(RESOURCE_WORLD);
    let admissions = 0;
    // 'capability': an alternate ground authority with no GM roster family, on a store with SQL040 ready.
    // 'readiness': the SQL040 capability exists, but the store does not report the SQL040 readiness.
    store.checkGroundGmResources = async () => ({ version: missing === 'readiness' ? 0 : 1 });
    store.admitGmResources = async () => { admissions++; throw new Error('SQL036 must not run'); };
    host.groundAuthority = { ready: true, canMutate: () => true, status: () => ({ ready: true, failed: false }),
      stop() {}, async settle() {},
      ...(missing === 'readiness' ? { async admitGmResources() { admissions++; throw new Error('SQL040 must not run'); } } : {}) };
    const resume = host.beginContentSwitch();
    try { await assert.rejects(host.prepareContentResources(target(host)), { code: 'gm_resource_unavailable' }); }
    finally { resume(); }
    assert.equal(admissions, 0);
    assert.deepEqual(await base.loadWorld(RESOURCE_WORLD), before);
  });
});
