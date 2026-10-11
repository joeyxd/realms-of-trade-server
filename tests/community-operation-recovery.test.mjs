import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { CommunityOperationRecovery } from '../server/community/operationRecovery.mjs';
import { createSupabaseOperationStore } from '../server/community/supabaseOperationStore.mjs';
import { operationIntent, operationEntry } from '../server/community/operationJournalContract.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = { worldId: 'salty', worldEpoch: uuid(1) };
const binding = n => ({ ...scope, accountId: uuid(100 + n), characterId: uuid(n) });
const row = n => ({ ...scope, characterId: uuid(n), version: 1,
  data: { v: 1, xp: 8, eco: { tradeRev: 0, pack: { goods: { madera: 9 } } }, raft: { cargo: { madera: 3 } } } });
const save = (id, n = 2) => ({ operationId: uuid(id), binding: binding(n), kind: 'save',
  request: { ...row(n), data: { ...row(n).data, xp: 19 } } });
const contribute = (id, n = 2) => ({ operationId: uuid(id), binding: binding(n), kind: 'contribution',
  request: { ...scope, operationId: uuid(id), characterId: uuid(n), projectId: 'carpentry',
    good: 'madera', amount: 3, expectedCharacterVersion: 1, expectedProjectVersion: 1 } });
const project = { ...scope, projectId: 'carpentry', version: 1, requirements: { madera: 12 }, contributed: { madera: 0 } };
const fixture = () => createMemoryContributionStore({ characters: [2, 3, 4].map(row),
  bindings: [2, 3, 4].map(binding), projects: [project] });
const recovery = (store, extra = {}) => new CommunityOperationRecovery(store, { ...scope, allowVolatile: true, ...extra });
const error = code => e => e?.code === code;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('exact journal contract rejects malformed families, scopes, IDs, versions and terminal outcomes', () => {
  const original = save(10);
  assert.deepEqual(operationIntent(original), original);
  for (const mutate of [x => { x.kind = null; }, x => { x.extra = true; },
    x => { x.binding.characterId = uuid(9); }, x => { x.request.version = 2147483647; },
    x => { x.operationId = uuid(10).toUpperCase(); }, x => { x.request.data.xp = Infinity; }]) {
    const input = structuredClone(original); mutate(input);
    assert.throws(() => operationIntent(input), error('input'));
  }
  const c = contribute(20); c.request.operationId = uuid(21);
  assert.throws(() => operationIntent(c), error('input'));
  const pending = { intent: original, state: 'pending', result: null };
  assert.deepEqual(operationEntry(pending), pending);
  assert.throws(() => operationEntry({ ...pending, state: 'complete' }), error('response'));
  assert.throws(() => operationEntry({ ...pending, result: {} }), error('response'));
  assert.throws(() => operationEntry({ ...pending, state: 'complete', result: { ok: true, character: row(2) } }), error('response'));
  const getter = { ...original }; Object.defineProperty(getter, 'kind', { get: () => 'save', enumerable: true });
  assert.throws(() => operationIntent(getter), error('input'));
});

test('memory journal prepares without debit and commits save and contribution exactly once', async () => {
  const store = fixture(), intent = contribute(30);
  const pending = await store.prepareOperation(intent);
  assert.equal(pending.state, 'pending');
  pending.intent.request.amount = 9;
  assert.deepEqual(await store.loadCharacter(...Object.values(scope), uuid(2)), row(2));
  const done = await store.commitOperation(intent);
  assert.equal(done.result.accepted, 3);
  assert.deepEqual(await store.commitOperation(intent), done);
  const current = await store.loadCharacter(...Object.values(scope), uuid(2));
  const later = { ...current, data: { ...current.data, xp: 50 } };
  await store.saveCharacter(later);
  assert.deepEqual(await store.commitOperation(intent), done);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(2))).data.xp, 50);
  assert.deepEqual(done.result.character.data.raft, row(2).data.raft);
  const s = save(31, 3); await store.prepareOperation(s);
  assert.equal((await store.commitOperation(s)).result.character.version, 2);
  assert.equal((await store.commitOperation(s)).result.character.version, 2);
  assert.deepEqual(await store.listPendingOperations(...Object.values(scope)), []);
});

test('memory ownership, pending uniqueness and contribution UUID collisions hold in both directions', async () => {
  const store = fixture(), s = save(40);
  await store.prepareOperation(s);
  await assert.rejects(store.prepareOperation(save(41)), error('operation'));
  await assert.rejects(store.prepareOperation({ ...s, request: row(2) }), error('operation'));
  await assert.rejects(store.commitContribution(contribute(40).request), error('operation'));
  await store.commitOperation(s);
  const c = contribute(42, 3);
  const receipt = await store.commitContribution(c.request);
  assert.deepEqual((await store.prepareOperation(c)).result, receipt);
  await assert.rejects(store.prepareOperation(save(42, 4)), error('operation'));
  await assert.rejects(store.prepareOperation({ ...save(43, 4), binding: { ...binding(4), accountId: uuid(999) } }), error('identity'));
});

test('startup gate rejects volatile stores by default and scans every pending page before opening', async () => {
  const store = fixture();
  assert.throws(() => new CommunityOperationRecovery(store, scope), error('configuration'));
  await store.prepareOperation(save(50)); await store.prepareOperation(save(51, 3));
  const calls = [], wrapped = { ...store, listPendingOperations: async (...args) => {
    calls.push(args); return store.listPendingOperations(...args);
  } };
  const gate = recovery(wrapped, { pageSize: 1 });
  assert.equal(gate.canAdmit(), false);
  await assert.rejects(gate.execute(save(52, 4)), error('startup'));
  assert.deepEqual(await gate.recover(), { phase: 'closed', ready: false, unresolved: 2, active: 0, reason: 'pending' });
  assert.equal(calls.length, 6);
  assert.equal(calls[2][2], uuid(51));
  assert.equal((await gate.recover({ retry: true })).ready, true);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(2))).version, 2);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(3))).version, 2);
  assert.equal((await gate.execute(save(52, 4))).state, 'complete');
});

test('lost prepare reply fences admission and read-only recovery never writes', async () => {
  const store = fixture(); let prepares = 0, commits = 0;
  const wrapped = { ...store, prepareOperation: async intent => {
    prepares++; await store.prepareOperation(intent); throw new Error('lost');
  }, commitOperation: async intent => { commits++; return store.commitOperation(intent); } };
  const gate = recovery(wrapped); await gate.recover();
  assert.deepEqual(await gate.execute(save(60)), { ok: false, why: 'unavailable' });
  assert.equal(gate.canAdmit(), false);
  assert.equal((await gate.recover()).reason, 'pending');
  assert.equal(prepares, 1); assert.equal(commits, 0);
  // A different controller discovers durable pending evidence without old local maps.
  const restarted = recovery(store);
  assert.equal((await restarted.recover()).ready, false);
  assert.equal((await restarted.recover({ retry: true })).ready, true);
  assert.equal((await gate.recover()).ready, true);
  assert.equal(commits, 0);
});

test('missing ambiguous prepare remains reserved until explicit retry uses the retained original', async () => {
  const store = fixture(); let first = true; const requests = [];
  const wrapped = { ...store, prepareOperation: async intent => {
    requests.push(structuredClone(intent));
    if (first) { first = false; throw new Error('no reply'); }
    return store.prepareOperation(intent);
  } };
  const gate = recovery(wrapped); await gate.recover();
  const intent = save(70), expected = structuredClone(intent);
  await gate.execute(intent); intent.request.data.xp = 99;
  assert.equal((await gate.recover()).ready, false);
  assert.equal(requests.length, 1);
  assert.equal((await gate.recover({ retry: true })).ready, true);
  assert.deepEqual(requests, [expected, expected]);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(2))).data.xp, 19);
});

test('lost committed reply resolves by journal read and preserves a newer current character', async () => {
  const store = fixture(); let commits = 0;
  const wrapped = { ...store, commitOperation: async intent => {
    commits++; await store.commitOperation(intent); throw new Error('lost commit');
  } };
  const gate = recovery(wrapped); await gate.recover();
  assert.equal((await gate.execute(contribute(80))).ok, false);
  const current = await store.loadCharacter(...Object.values(scope), uuid(2));
  await store.saveCharacter({ ...current, data: { ...current.data, xp: 66 } });
  assert.equal((await gate.recover()).ready, true);
  assert.equal(commits, 1);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(2))).version, 3);
  assert.equal((await store.loadCharacter(...Object.values(scope), uuid(2))).data.xp, 66);
  assert.equal((await store.loadOperation(uuid(80))).result.character.version, 2);
  assert.equal(Object.hasOwn(gate.view(), 'character'), false);
});

test('in-flight operation blocks its character and recovery while permitting another character', async () => {
  const store = fixture(), wait = deferred(), entered = deferred();
  const wrapped = { ...store, commitOperation: async intent => {
    if (intent.operationId === uuid(90)) { entered.resolve(); await wait.promise; }
    return store.commitOperation(intent);
  } };
  const gate = recovery(wrapped); await gate.recover();
  const running = gate.execute(save(90)); await entered.promise;
  await assert.rejects(gate.execute(save(91)), error('busy'));
  await assert.rejects(gate.recover(), error('busy'));
  await assert.rejects(gate.execute(save(90, 3)), error('response'));
  assert.equal((await gate.execute(save(92, 3))).state, 'complete');
  wait.resolve(); assert.equal((await running).state, 'complete');
  assert.equal(gate.view().active, 0);
});

test('startup refuses cross-scope, duplicate, over-limit, truncated and malformed evidence', async () => {
  for (const type of ['scope', 'duplicate', 'capacity', 'failure', 'complete']) {
    const store = fixture(); await store.prepareOperation(save(100)); await store.prepareOperation(save(101, 3));
    const wrapped = { ...store, listPendingOperations: async (...args) => {
      const page = await store.listPendingOperations(...args);
      if (type === 'scope' && page[0]) page[0].intent.binding.worldId = 'other';
      if (type === 'duplicate' && page.length) page.push(structuredClone(page[0]));
      if (type === 'failure' && args[2] !== null) throw new Error('second page unavailable');
      if (type === 'complete' && page[0]) page[0].state = 'complete';
      return page;
    } };
    const gate = recovery(wrapped, { pageSize: type === 'duplicate' ? 128 : 1,
      maxPending: type === 'capacity' ? 1 : 8 });
    const status = await gate.recover();
    assert.equal(status.ready, false, type); assert.equal(status.phase, 'fenced', type);
  }
});

test('SDK adapter validates arguments and response identity and has a bounded unknown timeout', async () => {
  let calls = 0;
  const bad = createSupabaseOperationStore({ rpc: async () => {
    calls++; return { data: { intent: save(111), state: 'pending', result: null } };
  } });
  await assert.rejects(bad.prepareOperation(save(110)), error('response'));
  await assert.rejects(bad.loadOperation(uuid(110)), error('response'));
  await assert.rejects(bad.listPendingOperations(scope.worldId, scope.worldEpoch, null, 0), error('input'));
  assert.equal(calls, 2);
  const hung = createSupabaseOperationStore({ rpc: () => new Promise(() => {}) }, { timeoutMs: 10 });
  await assert.rejects(hung.prepareOperation(save(112)), error('unavailable'));
});
