import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { capturePearlProfile, PEARL_PROFILE_ECS_FIELDS } from '../server/pearlProfileSnapshot.mjs';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile, attachProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { fixture, accounts, scope, uid, deferred, state, row } from './helpers/pearl-swallow-staging.mjs';
import { fixture as replacementFixture, incomingUid, outgoingUid, WORLD } from './helpers/pearl-replace-staging.mjs';
import { database as swallowSql } from './helpers/pearl-same-holder-sql.mjs';
import { database as batchSql } from './helpers/pearl-batch-journal-sql.mjs';

const progress = (profile) => Object.fromEntries(PEARL_PROFILE_ECS_FIELDS.map((key) => [key, profile[key]]));
function ecsProgress(world, entity, n) {
  const ecs = world.ecs, cp = Object.entries(world.map.checkpoints).find(([id]) => id !== 'spawn') ?? ['spawn', world.map.checkpoints.spawn];
  ecs.level[entity] = n; ecs.xp[entity] = n * 10 + 0.126; ecs.potions[entity] = n;
  ecs.cpX[entity] = cp[1].x; ecs.cpZ[entity] = cp[1].z;
  return { lvl: n, xp: Math.round(ecs.xp[entity] * 100) / 100, pot: n, cp: cp[0] };
}
function install(f, callback = (_id, entity) => capturePearlProfile(f.w, entity)) {
  f.staging = new PearlStaging(f.sessions, f.w, scope, { captureProfile: callback });
  return f;
}

test('detached capture reads current ECS progress while preserving profile-only state and all world containers', async () => {
  const f = await fixture(), e = f.entities[0], p = f.w.profiles.get(e);
  p.gold = 48; p.mast[0] = [3, 41]; p.stats.kills = 9; p.quests.snapshot = [1, 7];
  const expected = ecsProgress(f.w, e, 4), before = state(f.w), captured = capturePearlProfile(f.w, e);
  assert.deepEqual(progress(captured), expected); assert.deepEqual(state(f.w), before);
  for (const key of ['gold', 'mast', 'sk', 'stats', 'quests', 'eco', 'eq', 'pearls']) assert.deepEqual(captured[key], p[key]);
  captured.pearls.bag.length = 0; captured.mast[0][0] = 1;
  assert.deepEqual(state(f.w), before, 'returned nested objects are detached from authority');
  assert.throws(() => capturePearlProfile(f.w, 0), { code: 'session' });
  f.w.ecs.alive[e] = 0; assert.throws(() => capturePearlProfile(f.w, e), { code: 'session' });
});

test('invalid ECS progress fails capture rather than resetting or clamping a durable profile', async (t) => {
  for (const [column, value] of [['xp', NaN], ['xp', -1], ['level', 0], ['potions', 1000]]) {
    await t.test(`${column}:${value}`, async () => {
      const f = await fixture(), e = f.entities[0]; f.w.ecs[column][e] = value;
      const before = state(f.w);
      assert.throws(() => capturePearlProfile(f.w, e), { code: 'profile' }); assert.deepEqual(state(f.w), before);
    });
  }
});

test('capture adapters reject async, malformed and inventory/progress substitutions before scheduling storage', async (t) => {
  for (const [name, callback] of [
    ['throw', () => { throw new StoreError('profile'); }],
    ['resolved Promise', (f) => Promise.resolve(f.w.profiles.get(f.entities[0]))],
    ['rejected Promise', () => Promise.reject(new Error('bad capture'))],
    ['noncanonical', (f) => ({ ...f.w.profiles.get(f.entities[0]), invented: 1 })],
    ['gold replacement', (f) => ({ ...f.w.profiles.get(f.entities[0]), gold: 99 })],
    ['pearl replacement', (f) => ({ ...f.w.profiles.get(f.entities[0]), pearls: { bag: [], swallowed: null } })],
    ['identity replacement', (f) => ({ ...f.w.profiles.get(f.entities[0]), pirateId: `account:${accounts[1]}` })],
  ]) await t.test(name, async () => {
    let saves = 0, commits = 0;
    const f = install(await fixture({ wrapStore: (base) => ({ ...base,
      async saveProfile(...args) { saves++; return base.saveProfile(...args); },
      async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
    }) }), () => callback(f));
    const before = state(f.w);
    assert.throws(() => f.staging.swallow(f.command())); await f.staging.settle();
    assert.deepEqual(state(f.w), before); assert.equal(saves, 0); assert.equal(commits, 0);
    assert.equal(f.staging.operations.size, 0); assert.equal(f.staging.tasks.size, 0);
    pearlMutationGate(f.sessions).assertWorldAvailable();
    await new Promise((done) => setImmediate(done));
  });
  const f = await fixture();
  assert.throws(() => new PearlStaging(f.sessions, f.w, scope, { captureProfile: true }), { code: 'configuration' });
});

for (const [backendName, backend] of [['memory', undefined], ['SDK/SQL006', swallowSql]]) {
  test(`${backendName}: baseline captures synchronously and apply rebases newer ECS/profile progress once`, async () => {
    const sent = deferred(), reply = deferred(); let request, captures = 0;
    const f = await fixture({ backend, wrapStore: (base) => ({ ...base,
      async commitPearlGround(raw) { request = structuredClone(raw); const result = await base.commitPearlGround(raw);
        sent.resolve(); await reply.promise; return result; },
    }) });
    install(f, (_id, entity) => { captures++; return capturePearlProfile(f.w, entity); });
    try {
      const e = f.entities[0], p = f.w.profiles.get(e), baseline = ecsProgress(f.w, e, 3), before = state(f.w);
      const handle = f.staging.swallow(f.command());
      assert.equal(captures, 1, 'captured before a promise continuation can run'); assert.deepEqual(state(f.w), before);
      ecsProgress(f.w, e, 4); // A later continuation must not retroactively change the captured baseline.
      await sent.promise;
      assert.deepEqual(progress(request.profiles[0].data), baseline);
      assert.deepEqual(progress((await f.base.loadProfile(accounts[0])).data), baseline);
      assert.deepEqual(progress(p), progress(before.profiles[0][1]), 'IO does not sync the live profile');
      p.gold += 13; p.mast[0] = [3, 71]; p.stats.kills = 12; p.quests.snapshot = [2, 9];
      const latest = ecsProgress(f.w, e, 5), refs = { eq: p.eq, mast: p.mast, sk: p.sk, eco: p.eco };
      reply.resolve(); await f.staging.settle();
      const preApply = state(f.w);
      const reference = { ecs: structuredClone(f.w.ecs), profiles: new Map([[e, capturePearlProfile(f.w, e)]]),
        profileDirty: new Set(), events: [], emit(event) { this.events.push(event); } };
      assert.equal(swallowPearl(reference, e, uid), true);
      assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
      assert.equal(captures, 2); assert.deepEqual(progress(p), latest); assert.equal(p.gold, 33); assert.equal(p.mast[0][1], 71);
      for (const key of Object.keys(refs)) assert.equal(p[key], refs[key], 'unrelated nested identity is preserved');
      assert.equal(p.pearls.swallowed.uid, uid); assert.deepEqual(row(f.w.ecs, e), row(reference.ecs, e));
      for (const column of ['level', 'xp', 'potions', 'cpX', 'cpZ']) assert.equal(f.w.ecs[column][e], preApply.ecs[column][e]);
      await f.sessions.flush(); const stored = (await f.base.loadProfile(accounts[0])).data;
      assert.deepEqual(stored, p); assert.equal(stored.stats.kills, 12); assert.deepEqual(stored.quests.snapshot, [2, 9]);
      assert.deepEqual(f.staging.drain(), []); assert.equal(captures, 2);
      assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(f.w.events.length, 1);
      const restored = structuredClone(stored); f.w.profiles.delete(e); attachProfile(f.w, e, restored);
      assert.deepEqual(progress(capturePearlProfile(f.w, e)), latest, 'loading current stored profile restores the progress');
    } finally { reply.resolve(); await f.staging.settle(); await f.close(); }
  });
}

test('give captures both trusted endpoints independently and transfers no player progress with the UID', async () => {
  const f = install(await fixture()), [a, b] = f.entities;
  ecsProgress(f.w, a, 3); ecsProgress(f.w, b, 2);
  f.staging.give(f.give()); await f.staging.settle();
  const latestA = ecsProgress(f.w, a, 5), latestB = ecsProgress(f.w, b, 4);
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
  assert.deepEqual(progress((await f.base.loadProfile(accounts[0])).data), latestA);
  const receiver = (await f.base.loadProfile(accounts[1])).data;
  assert.deepEqual(progress(receiver), latestB); assert.equal(receiver.pearls.bag.at(-1).uid, uid);
  assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]);
});

for (const [backendName, backend] of [['memory', undefined], ['SDK/SQL008', batchSql]]) {
  test(`${backendName}: replacement keeps its frozen ground plan and newer detached progress`, async () => {
    const sent = deferred(), reply = deferred(); let request;
    const f = await replacementFixture({ backend, wrapStore: (base) => ({ ...base,
      async commitPearlBatch(raw) { request = structuredClone(raw); const result = await base.commitPearlBatch(raw);
        sent.resolve(); await reply.promise; return result; },
    }) });
    const w = f.world, e = f.entities[0], p = w.profiles.get(e);
    f.staging = new PearlStaging(f.sessions, w, WORLD, { captureProfile: (_id, entity) => capturePearlProfile(w, entity) });
    try {
      const baseline = ecsProgress(w, e, 3), rng = w.lootRng.state(); f.staging.replace(f.command()); await sent.promise;
      assert.deepEqual(progress(request.profile.data), baseline);
      const ground = request.items.find((q) => q.uid === outgoingUid).ground;
      const latest = ecsProgress(w, e, 5); p.gold += 7; w.tick += 10; w.ecs.x[e] += 3;
      reply.resolve(); await f.staging.settle(); assert.equal(f.staging.drain()[0].state, 'applied');
      assert.deepEqual(progress(p), latest); assert.equal(p.gold, 44); assert.equal(p.pearls.swallowed.uid, incomingUid);
      const drop = [...w.drops.values()].find((d) => d.pearl?.uid === outgoingUid);
      assert.deepEqual({ x: drop.x, z: drop.z, availableAt: drop.pickAt, returnAt: drop.t }, ground);
      assert.equal(w.lootRng.state(), rng); await f.sessions.flush(); assert.deepEqual((await f.base.loadProfile(accounts[0])).data, p);
      assert.equal((await f.base.loadUnique(outgoingUid)).holder, null); assert.equal(w.events.length, 2);
    } finally { reply.resolve(); await f.staging.settle(); await f.close(); }
  });
}

test('reserved save accepts the canonical detached snapshot without publishing, syncing or queuing old inventory', async () => {
  const f = install(await fixture()), e = f.entities[0];
  f.staging.swallow(f.command()); await f.staging.settle(); ecsProgress(f.w, e, 4);
  const before = state(f.w), session = f.sessions.clients.get(1), version = session.version;
  f.staging.save(1, capturePearlProfile(f.w, e));
  assert.deepEqual(state(f.w), before); assert.equal(session.pending, null); assert.equal(session.version, version);
  assert.throws(() => f.staging.save(1, f.w.profiles.get(e)), { code: 'profile' });
  assert.throws(() => f.staging.assertPublishable(1), { code: 'busy' });
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
});

test('capture failure after the durable receipt fences before any local progress, pearl or event writes', async () => {
  let calls = 0;
  const f = install(await fixture(), (_id, entity) => {
    if (++calls > 1) throw new StoreError('profile'); return capturePearlProfile(f.w, entity);
  });
  f.staging.swallow(f.command()); await f.staging.settle(); ecsProgress(f.w, f.entities[0], 5);
  const before = state(f.w); assert.equal(f.staging.drain()[0].state, 'fenced');
  assert.deepEqual(state(f.w), before); assert.equal((await f.base.loadUnique(uid)).version, 2);
  assert.deepEqual(f.staging.drain(), []); assert.equal(calls, 2);
  assert.throws(() => pearlMutationGate(f.sessions).assertWorldAvailable(), { code: 'busy' });
});

test('failed local save enqueue rolls back captured scalars, pearl slots and ECS while keeping the durable fence', async () => {
  const f = install(await fixture()), e = f.entities[0], p = f.w.profiles.get(e);
  f.staging.swallow(f.command()); await f.staging.settle(); ecsProgress(f.w, e, 5);
  const before = state(f.w), pearlRef = p.pearls, eqRef = p.eq;
  f.sessions.save = () => { throw new StoreError('unavailable'); };
  assert.equal(f.staging.drain()[0].state, 'fenced');
  assert.deepEqual(state(f.w), before); assert.equal(p.pearls, pearlRef); assert.equal(p.eq, eqRef);
  assert.equal((await f.base.loadUnique(uid)).version, 2); assert.deepEqual(f.staging.drain(), []);
});

test('invalidation, death/revival and entity reuse prevent both late capture and local apply', async (t) => {
  for (const [name, change] of [
    ['invalidation after revival', (f) => { f.w.ecs.dead[f.entities[0]] = 1; f.staging.invalidate(accounts[0]); f.w.ecs.dead[f.entities[0]] = 0; }],
    ['closed session', (f) => f.sessions.close(1)],
    ['reused profile/entity', (f) => { f.w.profiles.set(f.entities[0], structuredClone(f.w.profiles.get(f.entities[0]))); }],
  ]) await t.test(name, async () => {
    let calls = 0; const f = install(await fixture(), (_id, entity) => { calls++; return capturePearlProfile(f.w, entity); });
    f.staging.swallow(f.command()); await f.staging.settle(); change(f); const before = state(f.w);
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.equal(calls, 1); assert.deepEqual(state(f.w), before);
  });
});

test('caught staging reentry from a trusted capture cannot reserve, save or drain another operation', async () => {
  const f = install(await fixture(), (_id, entity) => {
    assert.throws(() => f.staging.drain(), { code: 'effect' });
    assert.throws(() => f.staging.save(1, f.w.profiles.get(entity)), { code: 'effect' });
    assert.throws(() => f.staging.swallow(f.command()), { code: 'effect' });
    return capturePearlProfile(f.w, entity);
  });
  const before = state(f.w); assert.throws(() => f.staging.swallow(f.command()), { code: 'profile' });
  await f.staging.settle(); assert.deepEqual(state(f.w), before); assert.equal(f.staging.operations.size, 0);
  pearlMutationGate(f.sessions).assertWorldAvailable();
});

test('identity invalidation during initial capture retains the gate fence without starting journal or storage work', async () => {
  const f = install(await fixture(), (_id, entity) => {
    const captured = capturePearlProfile(f.w, entity); f.staging.invalidate(accounts[0]); return captured;
  });
  const before = state(f.w), version = f.sessions.clients.get(1).version;
  assert.throws(() => f.staging.swallow(f.command()), { code: 'cancelled' }); await f.staging.settle();
  assert.deepEqual(state(f.w), before); assert.equal(f.staging.operations.size, 0); assert.equal(f.staging.tasks.size, 0);
  assert.equal(f.sessions.clients.get(1).version, version); assert.equal((await f.base.loadUnique(uid)).version, 1);
  assert.throws(() => pearlMutationGate(f.sessions).assertWorldAvailable(), { code: 'busy' });
});

class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

test('actual GameHost bridge captures reserved trusted accounts; paused tick applies progress without early publication', async (t) => {
  const base = createMemoryStore(), initial = newProfile(); initial.pirateId = `account:${accounts[0]}`;
  await base.saveProfile(accounts[0], initial, 0); const seeded = structuredClone(initial); seeded.pearls.bag.push({ uid, kind: 'brasa' });
  assert.equal((await base.commitPearl({ operationId: '74000000-0000-4000-8000-000000000001', uid, kind: 'brasa',
    from: null, to: accounts[0], expectedVersion: 0, profiles: [{ id: accounts[0], expectedVersion: 1, data: seeded }] })).ok, true);
  const h = new GameHost({ seed: 42, bots: 0, store: base, resolvePlayer: async () => accounts[0], log() {} }), ws = new Socket();
  h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'snapshot' } }); const id = h.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Snapshot', weapon: 0 })), false);
  await Promise.all([...h.joins]);
  const c = h.server.clients.get(id), w = h.server.world, e = c.entity, p = w.profiles.get(e);
  w.ecs.regenT[e] = 99; w.ecs.dashT[e] = -1; w.ecs.castK[e] = 0; w.ecs.atkStage[e] = 0;
  const staging = new PearlStaging(h.profiles, w, scope, { captureProfile: (client, entity) => h.capturePearlProfile(client, entity) });
  t.after(async () => { await staging.settle(); await h.close(); });
  assert.equal(h.server.beforeTick, null, 'automatic host integration remains explicit');
  const baseline = ecsProgress(w, e, 3); w.events.length = 0; w.profileDirty.clear(); ws.messages.length = 0;
  staging.swallow({ uid, expectedVersion: 1, source: { clientId: id, entity: e } }); await staging.settle();
  const beforeRead = state(w); assert.deepEqual(progress(h.capturePearlProfile(id, e)), baseline); assert.deepEqual(state(w), beforeRead);
  assert.equal(h.profileAvailable(id, e), false); assert.throws(() => h.capturePearlProfile(id + 1, e), { code: 'session' });
  const identity = p.pirateId; p.pirateId = 'guest:snapshot';
  assert.throws(() => h.capturePearlProfile(id, e), { code: 'session' }); p.pirateId = identity;
  const latest = ecsProgress(w, e, 5), tick = w.tick; h.server.pausable = true; c.paused = true;
  h.server.beforeTick = () => { staging.drain(); return true; }; h.server.pump();
  assert.equal(w.tick, tick); assert.deepEqual(progress(p), latest); assert.equal(p.pearls.swallowed.uid, uid);
  assert.equal(ws.messages.length, 0); assert.equal(w.events.length, 1);
  await h.profiles.flush(); assert.deepEqual((await base.loadProfile(accounts[0])).data, p);
  c.paused = false; c.profT = -1e9; assert.equal(h.server.step(), true);
  assert.equal(ws.messages.filter((msg) => msg.t === MSG.EVENT && msg.ev.type === 'pearlChanged').length, 1);
  assert.deepEqual(progress(ws.messages.find((msg) => msg.t === MSG.PROFILE).p), latest);
});
