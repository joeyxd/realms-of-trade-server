import test from 'node:test';
import assert from 'node:assert/strict';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { World } from '../src/sim/world.js';
import { PEARL } from '../src/data/pearls.js';
import { newProfile, installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { map, A as arena } from './helpers.mjs';

const accounts = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
const scope = 'staging:harbor', uid = 'staging-pearl', pearl = { uid, kind: 'brasa' };
const op = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function fixture({ wrapStore = (base) => base, wrapJournal = (journal) => journal, limit } = {}) {
  const base = createMemoryStore(), journals = createMemoryPearlJournals();
  for (const id of accounts) {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 20;
    await base.saveProfile(id, p, 0);
  }
  for (const [index, owner] of [[0, accounts[0]], [1, accounts[2]]]) {
    const row = await base.loadProfile(owner), data = structuredClone(row.data);
    data.pearls.bag.push({ ...pearl, uid: index ? 'staging-other' : uid });
    assert.equal((await base.commitPearl({ operationId: op(index), uid: data.pearls.bag[0].uid, kind: pearl.kind,
      from: null, to: owner, expectedVersion: 0, profiles: [{ id: owner, expectedVersion: row.version, data }] })).ok, true);
  }
  const errors = [], store = wrapStore(base), journal = wrapJournal(journals(scope));
  const sessions = new ProfileSessions(store, (id, code) => errors.push({ id, code }), { journal });
  await sessions.recoverPearls();
  const w = new World(42, { map, server: true }); installInventory(w, scope);
  const entities = [];
  for (let i = 0; i < accounts.length; i++) {
    const p = await sessions.open(i + 1, accounts[i]), e = w.spawnPlayer({ x: arena.x + i * 0.2, z: arena.z + 4, clientId: i + 1 });
    attachProfile(w, e, p); w.ecs.regenT[e] = 99; entities.push(e);
  }
  w.events.length = 0; w.profileDirty.clear();
  const staging = new PearlStaging(sessions, w, scope, limit === undefined ? {} : { limit });
  const command = (a = 0, b = 1, version = 1) => ({ uid: a >= 2 ? 'staging-other' : uid, expectedVersion: version,
    source: { clientId: a + 1, entity: entities[a] }, target: { clientId: b + 1, entity: entities[b] } });
  return { base, store, journal, journals, sessions, staging, w, entities, errors, command };
}
const state = (w) => structuredClone({ profiles: [...w.profiles], ledger: [...w.pearlLedger], dirty: [...w.profileDirty],
  events: w.events, drops: [...w.drops], nextDrop: w.nextDrop, nextPearl: w.nextPearl,
  rng: w.rng.state(), lootRng: w.lootRng.state(), columns: Object.fromEntries(Object.entries(w.ecs).filter(([, v]) => ArrayBuffer.isView(v))) });
const bag = (f, index) => f.w.profiles.get(f.entities[index]).pearls.bag;
const denied = (fn, code) => assert.throws(fn, { code });

test('a slow commit and closed journal have no live effects; the gameplay gate survives storage completion until one tick apply', async () => {
  const sent = deferred(), reply = deferred(), terminal = deferred(), terminalReply = deferred();
  let sends = 0, request;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
    sends++; request = raw; const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result;
  } }), wrapJournal: (journal) => ({ ...journal, async resolve(...args) {
    const result = await journal.resolve(...args); terminal.resolve(); await terminalReply.promise; return result;
  } }) });
  const before = state(f.w), handle = f.staging.give(f.command());
  assert.deepEqual(state(f.w), before); denied(() => f.staging.give(f.command()), 'busy');
  await sent.promise;
  assert.deepEqual(state(f.w), before); assert.deepEqual(f.staging.drain(), []);
  assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]);
  reply.resolve(); await terminal.promise;
  assert.deepEqual(state(f.w), before); denied(() => f.staging.assertAvailable({ accounts: [accounts[0]] }), 'busy');
  terminalReply.resolve(); await f.staging.settle();
  assert.equal(f.sessions.pearls.accountIds.size, 0); assert.deepEqual(state(f.w), before);
  denied(() => f.staging.assertAvailable({ accounts: [accounts[1]] }), 'busy');
  denied(() => f.staging.assertAvailable({ uids: [uid] }), 'busy');
  assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
  assert.deepEqual(bag(f, 0), []); assert.deepEqual(bag(f, 1), [pearl]);
  assert.deepEqual(f.w.pearlLedger.get(uid), { owner: `account:${accounts[1]}`, entity: f.entities[1], place: 'profile' });
  assert.deepEqual(f.w.events.map((e) => [e.type, e.to]), [['pearlChanged', f.entities[0]], ['pickup', f.entities[1]]]);
  assert.equal(f.w.events[0].elem, 0); assert.equal(sends, 1); assert.equal(request.operationId, handle.operationId);
  assert.equal(Object.isFrozen(request), true); assert.deepEqual(f.staging.drain(), []);
  assert.equal(f.w.events.length, 2); f.staging.assertAvailable({ accounts: accounts.slice(0, 2), uids: [uid] });
  await f.sessions.flush(); assert.equal((await f.base.loadProfile(accounts[1])).data.gold, 20);
});

test('initial give uses existing combat, range, capacity and bag rules without emitting denial or preparing storage', async (t) => {
  const cases = [
    ['combat', (f) => { f.w.ecs.regenT[f.entities[0]] = 0; }],
    ['combat', (f) => { const e = f.w.spawnEnemy('archer', arena.x + 3, arena.z + 4); f.w.ecs.brain[e].target = f.entities[1]; f.w.ecs.brain[e].state = 'chase'; }],
    ['far', (f) => { f.w.ecs.x[f.entities[1]] += PEARL.transferR + 1; }],
    ['full', (f) => { f.w.profiles.get(f.entities[1]).pearls.bag = Array.from({ length: PEARL.bag }, (_, i) => ({ uid: `full-${i}`, kind: 'tinta' })); }],
    ['unknown', (f) => { const p = f.w.profiles.get(f.entities[0]); p.pearls.swallowed = p.pearls.bag.pop(); }],
  ];
  for (const [code, alter] of cases) await t.test(code, async () => {
    let calls = 0;
    const f = await fixture({ wrapJournal: (journal) => ({ ...journal, async prepare(...args) { calls++; return journal.prepare(...args); } }) });
    alter(f); const before = state(f.w);
    denied(() => f.staging.give(f.command()), code); assert.deepEqual(state(f.w), before);
    assert.equal(calls, 0); assert.equal(f.staging.operations.size, 0);
  });
});

test('holders and pearl kind come from trusted sessions; invalid identity, generation, scope and managed owner are rejected', async (t) => {
  for (const [name, code, change] of [
    ['guest', 'session', (f, cmd) => { f.w.profiles.get(cmd.source.entity).pirateId = 'guest:test'; }],
    ['wrong holder', 'ownership', (f) => { f.w.pearlLedger.get(uid).owner = `account:${accounts[1]}`; }],
    ['same account', 'operation', (_f, cmd) => { cmd.target = cmd.source; }],
    ['mint', 'operation', (_f, cmd) => { cmd.expectedVersion = 0; }],
    ['unknown generation', 'operation', (_f, cmd) => { cmd.expectedVersion = NaN; }],
  ]) await t.test(name, async () => {
    const f = await fixture(), cmd = f.command(); change(f, cmd); const before = state(f.w);
    denied(() => f.staging.give(cmd), code); assert.deepEqual(state(f.w), before);
  });
  const f = await fixture(); denied(() => new PearlStaging(f.sessions, f.w, 'foreign'), 'configuration');
  denied(() => new PearlStaging(f.sessions, f.w, scope, { limit: 0 }), 'configuration');
});

test('buffered saves before and after storage completion preserve ordinary progress and never write the old UID in the apply gap', async () => {
  const sent = deferred(), reply = deferred(), saves = [];
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async saveProfile(...args) { saves.push(structuredClone(args)); return base.saveProfile(...args); },
    async commitPearlGround(raw) { const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result; },
  }) });
  f.staging.give(f.command()); await sent.promise;
  const p = f.w.profiles.get(f.entities[0]); p.gold += 7; p.xp = 13;
  f.staging.save(1, p); reply.resolve(); await f.staging.settle();
  p.gold += 2; p.xp = 19; f.staging.save(1, p);
  p.gold += 3; p.xp = 23; // Progress after the last buffered autosave is also retained at apply.
  assert.equal(saves.length, 0); assert.equal((await f.base.loadProfile(accounts[0])).data.gold, 20);
  const wrong = structuredClone(p); wrong.pearls.bag = [];
  denied(() => f.staging.save(1, wrong), 'ownership');
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
  const saved = await f.base.loadProfile(accounts[0]);
  assert.equal(saved.data.gold, 32); assert.equal(saved.data.xp, 23); assert.deepEqual(saved.data.pearls.bag, []);
  assert.equal(p.gold, 32); assert.equal(p.xp, 23); assert.deepEqual(p.pearls.bag, []);
  assert.equal(saves.length, 1); assert.deepEqual(saves[0][1].pearls.bag, []);
});

test('a prior save drains before the frozen pearl delta builds; mutable command and later range/combat cannot rewrite the accepted intent', async () => {
  const saving = deferred(), saved = deferred(); let request;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async saveProfile(...args) { saving.resolve(); await saved.promise; return base.saveProfile(...args); },
    async commitPearlGround(raw) { request = raw; return base.commitPearlGround(raw); },
  }) });
  const p = f.w.profiles.get(f.entities[0]); p.xp = 8;
  f.sessions.save(1, p); await saving.promise;
  const cmd = f.command(), handle = f.staging.give(cmd);
  cmd.uid = 'changed'; cmd.expectedVersion = 100; cmd.target.clientId = 4;
  f.w.ecs.x[f.entities[1]] += 50; f.w.ecs.regenT[f.entities[0]] = 0;
  await Promise.resolve(); assert.equal(request, undefined); saved.resolve(); await f.staging.settle();
  assert.equal(request.uid, uid); assert.equal(request.operationId, handle.operationId); assert.equal(request.to, accounts[1]);
  assert.equal(request.profiles.find((r) => r.id === accounts[0]).data.xp, 8);
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
});

test('disjoint accounts progress independently while account, UID and bounded operation lanes remain reserved', async () => {
  const sent = deferred(), reply = deferred();
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
    const result = await base.commitPearlGround(raw); if (raw.uid === uid) { sent.resolve(); await reply.promise; } return result;
  } }) });
  f.staging.give(f.command()); await sent.promise;
  denied(() => f.staging.assertAvailable({ accounts: [accounts[0]], uids: ['unrelated'] }), 'busy');
  f.staging.assertAvailable({ accounts: accounts.slice(2), uids: ['staging-other'] });
  const other = f.staging.give(f.command(2, 3));
  while (!f.staging.completed.length) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.staging.drain(), [{ operationId: other.operationId, state: 'applied' }]);
  assert.deepEqual(bag(f, 3), [{ ...pearl, uid: 'staging-other' }]); assert.deepEqual(bag(f, 0), [pearl]);
  reply.resolve(); await f.staging.settle(); assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
  const limited = await fixture({ limit: 1 }); limited.staging.give(limited.command());
  denied(() => limited.staging.give(limited.command(2, 3)), 'busy'); await limited.staging.settle(); limited.staging.drain(); await limited.sessions.flush();
});

test('death, close, recycled profile/session, bypassed pearl/ledger mutation and sticky lifecycle invalidation fence committed work without success', async (t) => {
  for (const [name, alter] of [
    ['death', (f) => { f.w.ecs.dead[f.entities[1]] = 10; }],
    ['close', (f) => { f.sessions.close(2); }],
    ['profile recycled', (f) => { f.w.profiles.set(f.entities[1], structuredClone(f.w.profiles.get(f.entities[1]))); }],
    ['session recycled', (f) => { f.sessions.clients.set(2, { ...f.sessions.clients.get(2) }); }],
    ['client rebound', (f) => { f.w.ecs.clientId[f.entities[1]] = 99; }],
    ['pearl bypass', (f) => { f.w.profiles.get(f.entities[0]).pearls.bag = []; }],
    ['ledger bypass', (f) => { f.w.pearlLedger.get(uid).entity = 0; }],
    ['death then revival', (f) => { f.staging.invalidate(accounts[1]); f.w.ecs.dead[f.entities[1]] = 0; }],
  ]) await t.test(name, async () => {
    const f = await fixture(), handle = f.staging.give(f.command()); await f.staging.settle();
    assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]); alter(f);
    const afterAlter = state(f.w), result = f.staging.drain();
    assert.equal(result[0].operationId, handle.operationId); assert.equal(result[0].state, 'fenced');
    assert.deepEqual(state(f.w), afterAlter); assert.deepEqual(f.staging.drain(), []);
    denied(() => f.staging.assertAvailable({ accounts: [accounts[0]] }), 'busy');
    denied(() => f.staging.assertAvailable({ uids: [uid] }), 'busy'); assert.equal(f.errors.length, 2);
    await assert.rejects(f.sessions.flush(), { code: 'flush' });
  });
});

test('invalidation before asynchronous dispatch cancels without mutation and retains the gameplay fence', async () => {
  let sends = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }) });
  const before = state(f.w); f.staging.give(f.command()); f.staging.invalidate(accounts[0]); await f.staging.settle();
  assert.equal(sends, 0); assert.equal((await f.base.loadUnique(uid)).holder, accounts[0]);
  assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
});

test('unknown storage result or lost terminal reply retains fences; receipt reconciliation cannot trigger a late apply', async (t) => {
  for (const phase of ['receipt', 'terminal']) await t.test(phase, async () => {
    let sends = 0;
    const f = await fixture({ wrapStore: (base) => ({ ...base,
      async commitPearlGround(raw) { sends++; await base.commitPearlGround(raw); throw new StoreError('unavailable'); },
      async loadPearlGroundOperation(id) { if (phase === 'receipt') throw new StoreError('unavailable'); return base.loadPearlGroundOperation(id); },
    }), wrapJournal: (journal) => ({ ...journal, async resolve(...args) {
      const row = await journal.resolve(...args); if (phase === 'terminal') throw new StoreError('unavailable'); return row;
    } }) });
    const before = state(f.w), handle = f.staging.give(f.command()); await f.staging.settle();
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before); assert.equal(sends, 2);
    f.store.loadPearlGroundOperation = (id) => f.base.loadPearlGroundOperation(id);
    f.journal.resolve = (...args) => f.journals(scope).resolve(...args);
    await f.sessions.reconcilePearlGround(handle.operationId);
    assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.w), before);
    denied(() => f.staging.assertAvailable({ accounts: [accounts[1]] }), 'busy');
    denied(() => pearlMutationGate(f.sessions).reserve({ uids: [uid] }), 'busy');
  });
});

test('lost commit response retries the exact request and produces one tick apply', async () => {
  const requests = [];
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
    requests.push(raw); const result = await base.commitPearlGround(raw); if (requests.length === 1) throw new Error('lost'); return result;
  } }) });
  f.staging.give(f.command()); await f.staging.settle(); assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]); assert.equal(f.staging.drain()[0].state, 'applied');
  assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(f.w.events.length, 2); await f.sessions.flush();
});

test('event preparation and local apply failures never leak success, retry effects or roll back SQL', async (t) => {
  for (const phase of ['event', 'apply', 'save', 'broken ledger']) await t.test(phase, async () => {
    const f = await fixture(), before = state(f.w); f.staging.give(f.command()); await f.staging.settle();
    if (phase === 'event') f.w.emit = () => { throw new Error('publication'); };
    if (phase === 'apply') {
      const set = f.w.pearlLedger.set.bind(f.w.pearlLedger); let failed = false;
      f.w.pearlLedger.set = (...args) => { if (!failed) { failed = true; throw new Error('apply'); } return set(...args); };
    }
    if (phase === 'save') f.sessions.save = () => { throw new Error('save'); };
    if (phase === 'broken ledger') f.w.pearlLedger.set = () => { throw new Error('permanent apply failure'); };
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
    assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]); assert.deepEqual(f.staging.drain(), []);
    denied(() => f.staging.assertAvailable({ uids: [uid] }), 'busy');
  });
});

test('a direct ProfileSessions save in the apply gap is rejected before dispatch; the legitimate tick apply still succeeds', async () => {
  let writes = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async saveProfile(...args) {
    writes++; return base.saveProfile(...args);
  } }) });
  const before = state(f.w); f.staging.give(f.command()); await f.staging.settle();
  const bypass = structuredClone(f.w.profiles.get(f.entities[0])); bypass.xp = 9;
  denied(() => f.sessions.save(1, bypass), 'busy'); await f.sessions.flush();
  assert.equal(writes, 0); assert.deepEqual(state(f.w), before);
  assert.equal(f.staging.drain()[0].state, 'applied'); await f.sessions.flush();
  assert.equal(writes, 0); assert.equal((await f.base.loadProfile(accounts[0])).data.xp, 0);
  f.staging.assertAvailable({ accounts: [accounts[0]] });
});

test('failure on the second real save enqueue clears both accounts before the first scheduled storage write', async () => {
  let writes = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async saveProfile(...args) { writes++; return base.saveProfile(...args); } }) });
  const before = state(f.w); f.staging.give(f.command()); await f.staging.settle();
  f.w.profiles.get(f.entities[0]).xp = 11; // Force a changed snapshot on the first real enqueue.
  const beforeApply = state(f.w), save = f.sessions.save.bind(f.sessions); let calls = 0;
  f.sessions.save = (...args) => { if (++calls === 2) throw new Error('second enqueue'); return save(...args); };
  assert.equal(f.staging.drain()[0].state, 'fenced'); assert.equal(calls, 2);
  assert.deepEqual(state(f.w), beforeApply); assert.equal(before.events.length, 0);
  await assert.rejects(f.sessions.flush(), { code: 'flush' });
  assert.equal(writes, 0); assert.equal((await f.base.loadProfile(accounts[0])).data.xp, 0);
  assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]);
});

test('restart after durable commit before tick apply hydrates current authority and never republishes the old event', async () => {
  let sends = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }) });
  f.staging.give(f.command()); await f.staging.settle(); assert.deepEqual(bag(f, 0), [pearl]); assert.equal(f.w.events.length, 0);
  const sessions = new ProfileSessions(f.store, null, { journal: f.journals(scope) });
  assert.deepEqual(await sessions.recoverPearls(), []);
  const source = await sessions.open(1, accounts[0]), target = await sessions.open(2, accounts[1]);
  assert.deepEqual(source.pearls.bag, []); assert.deepEqual(target.pearls.bag, [pearl]); assert.equal(source.gold, 20);
  const w = new World(42, { map, server: true }); installInventory(w, scope);
  attachProfile(w, w.spawnPlayer({ x: arena.x, z: arena.z + 4 }), source);
  attachProfile(w, w.spawnPlayer({ x: arena.x, z: arena.z + 4 }), target); w.events.length = 0;
  const restored = new PearlStaging(sessions, w, scope);
  assert.deepEqual(restored.drain(), []); assert.equal(w.events.length, 0); assert.equal(sends, 1);
  assert.equal(w.pearlLedger.get(uid).owner, `account:${accounts[1]}`);
  assert.deepEqual(await f.base.loadPearlLocation(uid), { world: scope, ground: null, version: 2 });
});

test('a shared reservation blocks another staging coordinator, ordinary mutation, save and profile publication through the apply gap', async () => {
  const f = await fixture(), other = new PearlStaging(f.sessions, f.w, scope), before = state(f.w);
  assert.equal(other.gate, f.staging.gate); assert.equal(pearlMutationGate(f.sessions), f.staging.gate);
  const ordinary = other.gate.reserve({ accounts: [accounts[0]], uids: [uid, 'replacement'] });
  denied(() => f.staging.give(f.command()), 'busy');
  denied(() => f.staging.save(1, f.w.profiles.get(f.entities[0])), 'busy');
  denied(() => f.staging.assertPublishable(1), 'busy'); assert.deepEqual(state(f.w), before);
  other.gate.release(ordinary);
  const handle = f.staging.give(f.command());
  denied(() => other.give(f.command()), 'busy'); denied(() => f.staging.assertPublishable(2), 'busy');
  f.staging.assertPublishable(3);
  await f.staging.settle(); assert.equal(f.sessions.pearls.accountIds.size, 0);
  denied(() => other.gate.reserve({ accounts: [accounts[1]], uids: ['different'] }), 'busy');
  denied(() => other.save(1, f.w.profiles.get(f.entities[0])), 'busy');
  denied(() => other.assertPublishable(1), 'busy');
  assert.deepEqual(state(f.w), before); assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
  f.staging.assertPublishable(1); other.assertPublishable(2);
  const next = other.gate.reserve({ accounts: accounts.slice(0, 2), uids: [uid] }); other.gate.release(next);
  await f.sessions.flush();
});

test('UID lifecycle invalidation from a different adapter closes publication; a settled receipt cannot release the fence', async () => {
  const f = await fixture(), other = new PearlStaging(f.sessions, f.w, scope), before = state(f.w);
  const handle = f.staging.give(f.command()); await f.staging.settle();
  other.gate.invalidate({ uids: [uid] });
  assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  await assert.rejects(f.sessions.reconcilePearlGround(handle.operationId), { code: 'operation' });
  denied(() => other.assertAvailable({ accounts: [accounts[1]] }), 'busy');
  denied(() => other.assertPublishable(1), 'session');
  denied(() => other.give(f.command()), 'session'); assert.deepEqual(f.staging.drain(), []);
  await assert.rejects(f.sessions.flush(), { code: 'flush' });
});

test('lifecycle invalidation during event preparation or save enqueue is rechecked before success can escape', async (t) => {
  for (const phase of ['event', 'save']) await t.test(phase, async () => {
    const f = await fixture(), before = state(f.w); f.staging.give(f.command()); await f.staging.settle();
    if (phase === 'event') {
      const emit = f.w.emit;
      f.w.emit = function(event) { f.staging.gate.invalidate({ uids: [uid] }); return emit.call(this, event); };
    } else {
      const save = f.sessions.save.bind(f.sessions);
      f.sessions.save = (...args) => { save(...args); f.staging.gate.invalidate({ accounts: [accounts[0]] }); };
    }
    assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
    assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]);
    denied(() => f.staging.assertAvailable({ uids: [uid] }), 'busy');
    await assert.rejects(f.sessions.flush(), { code: 'flush' });
  });
});

test('UID invalidation while journal preparation waits prevents first dispatch and retires that exact intent as rejected', async () => {
  const prepared = deferred(), reply = deferred(); let sends = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }),
    wrapJournal: (journal) => ({ ...journal, async prepare(...args) {
      const row = await journal.prepare(...args); prepared.resolve(); await reply.promise; return row;
    } }) });
  const before = state(f.w), handle = f.staging.give(f.command()); await prepared.promise;
  f.staging.gate.invalidate({ uids: [uid] }); reply.resolve(); await f.staging.settle();
  assert.equal(sends, 0); assert.equal(f.staging.drain()[0].state, 'fenced'); assert.deepEqual(state(f.w), before);
  assert.equal((await f.journals(scope).prepare('ground', { operationId: handle.operationId,
    ...f.staging.operations.get(handle.operationId).request })).state, 'rejected');
  assert.equal((await f.base.loadUnique(uid)).holder, accounts[0]);
  await assert.rejects(f.sessions.flush(), { code: 'flush' });
});

test('explicit resume cannot dispatch a fenced gameplay intent even when its receipt is authoritatively absent', async () => {
  let sends = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround() { sends++; throw new StoreError('unavailable'); } }) });
  const before = state(f.w), handle = f.staging.give(f.command()); await f.staging.settle();
  assert.equal(sends, 2); assert.equal(f.staging.drain()[0].state, 'fenced');
  await assert.rejects(f.sessions.resumePearlGround(handle.operationId), { code: 'cancelled' });
  assert.equal(sends, 2); assert.deepEqual(state(f.w), before); assert.deepEqual(f.staging.drain(), []);
  denied(() => f.staging.assertAvailable({ accounts: [accounts[1]], uids: [uid] }), 'busy');
  await assert.rejects(f.sessions.flush(), { code: 'flush' });
});
