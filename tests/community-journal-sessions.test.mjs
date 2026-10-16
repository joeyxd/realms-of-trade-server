import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { ContributionError } from '../server/community/contributionContract.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3), PROJECT = 'salty:hall';
const row = (version = 1, name = 'Nerea') => ({ worldId: WORLD, worldEpoch: EPOCH,
  characterId: CHAR, version, data: { v: 1, name, eco: { tradeRev: version - 1,
    pack: { cap: 40, goods: { madera: 8 } } } } });
const project = (version = 1, contributed = 0) => ({ worldId: WORLD, worldEpoch: EPOCH,
  projectId: PROJECT, version, requirements: { madera: 10 }, contributed: { madera: contributed } });
const binding = () => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR });
const contribution = n => ({ operationId: id(n), projectId: PROJECT, good: 'madera', amount: 2,
  expectedProjectVersion: 1 });
const auth = () => Object.freeze({ accountId: ACCOUNT });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wrap(store, overrides) {
  const result = Object.create(store);
  for (const [key, value] of Object.entries(overrides)) result[key] = value;
  return result;
}
async function fixture({ store: base, operationStore, identities = new Map([['peer', auth()]]),
  extra = {}, uuids = [id(50), id(51), id(52)] } = {}) {
  const store = base ?? createMemoryContributionStore({ characters: [row()], projects: [project()] });
  if (!await store.loadBinding(ACCOUNT, WORLD, EPOCH)) await store.initializeBinding(binding());
  const generated = [];
  const sessions = new BoundProfileSessions(store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: clientId => identities.get(clientId), operationStore: operationStore ?? store,
    allowVolatile: true, uuid: () => { const value = uuids.shift(); generated.push(value); return value; }, ...extra });
  return { store, sessions, identities, generated };
}

test('journal mode is opt-in and the legacy session path remains available by default', async () => {
  const store = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await store.initializeBinding(binding());
  const identity = auth();
  const legacy = new BoundProfileSessions(store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => identity });
  const opened = await legacy.open('legacy');
  assert.equal((await legacy.save('legacy', opened.token, { ...opened.character.data, name: 'Legacy' })).ok, true);
  assert.equal(legacy.recoveryView(), null);
});

test('journal mode needs explicit volatile opt-in; it starts closed and gates admission until full recovery', async () => {
  const store = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await store.initializeBinding(binding());
  assert.throws(() => new BoundProfileSessions(store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => auth(), operationStore: store }), e => e.code === 'configuration');
  const { sessions } = await fixture({ store });
  assert.deepEqual(sessions.recoveryView().ready, false);
  assert.equal(sessions.canMutate('peer'), false);
  await assert.rejects(sessions.open('peer'), e => e.code === 'startup');
  assert.deepEqual(sessions.drain(() => assert.fail('closed gate published')), []);
  assert.equal((await sessions.recoverWorld()).ready, true);
  assert.equal((await sessions.open('peer')).phase, 'ready');
});

test('pending startup evidence keeps all sessions closed until an explicit world retry resolves it', async () => {
  const { store } = await fixture();
  await store.prepareOperation({ operationId: id(60), binding: binding(), kind: 'save', request: row() });
  const { sessions } = await fixture({ store });
  const status = await sessions.recoverWorld();
  assert.equal(status.ready, false);
  assert.equal(status.unresolved, 1);
  await assert.rejects(sessions.open('peer'), e => e.code === 'startup');
  assert.equal((await sessions.recoverWorld({ retry: true })).ready, true);
});

test('save journals a server UUID and contribution journals the caller operation UUID', async () => {
  const { sessions, generated, store } = await fixture();
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const saved = await sessions.save('peer', opened.token, { ...opened.character.data, name: 'Guardado' });
  assert.equal(saved.ok, true);
  const saveEntry = await store.loadOperation(id(50));
  assert.equal(saveEntry.intent.kind, 'save');
  assert.deepEqual(saveEntry.intent.binding, binding());
  sessions.drain(() => {});
  const next = sessions.view('peer');
  const result = await sessions.contribute('peer', next.token, contribution(61));
  assert.equal(result.ok, true);
  assert.ok(await store.loadOperation(id(61)));
  assert.deepEqual(generated, [id(50)]);
});

test('contribution UUID replay avoids ordinary writes and never debits twice', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let ordinaryWrites = 0, commits = 0;
  const store = wrap(backing, {
    saveCharacter: async () => { ordinaryWrites++; throw new Error('ordinary save path used'); },
    commitContribution: async () => { ordinaryWrites++; throw new Error('ordinary contribution path used'); },
  });
  const operationStore = wrap(backing, { commitOperation: async intent => {
    commits++; return backing.commitOperation(intent);
  } });
  const { sessions } = await fixture({ store, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const first = await sessions.contribute('peer', opened.token, contribution(62));
  assert.equal(first.ok, true); sessions.drain(() => {});
  const current = sessions.view('peer');
  const replay = await sessions.contribute('peer', current.token, contribution(62));
  assert.equal(replay.ok, true); assert.equal(replay.replay, true);
  let event; sessions.drain(value => { event = value; });
  assert.equal(event.character.version, 2);
  assert.equal(event.project.version, 2);
  assert.equal(event.character.data.eco.pack.goods.madera, 6);
  assert.equal((await backing.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
  assert.equal(commits, 1);
  assert.equal(ordinaryWrites, 0);
});

test('an in-flight journal write blocks world recovery and duplicate account admission until it settles', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding());
  const entered = deferred(), wait = deferred();
  const operationStore = wrap(backing, { commitOperation: async intent => {
    entered.resolve(); await wait.promise; return backing.commitOperation(intent);
  } });
  const identities = new Map([['peer', auth()], ['other', auth()]]);
  const { sessions } = await fixture({ store: backing, operationStore, identities });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const saving = sessions.save('peer', opened.token, { ...opened.character.data, name: 'late' });
  await entered.promise;
  assert.throws(() => sessions.recoverWorld(), e => e.code === 'busy');
  await assert.rejects(sessions.open('other'), e => e.code === 'session');
  assert.equal(sessions.canMutate('peer'), false);
  wait.resolve(); assert.equal((await saving).ok, true);
});

test('lost prepare reply remains globally closed; read-only world recovery does not resubmit it', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let prepares = 0, commits = 0;
  const operationStore = wrap(backing, { prepareOperation: async intent => {
    prepares++; await backing.prepareOperation(intent); throw new Error('prepare response lost');
  }, commitOperation: async intent => { commits++; return backing.commitOperation(intent); } });
  const { sessions } = await fixture({ store: backing, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  assert.deepEqual(await sessions.save('peer', opened.token, { ...opened.character.data, name: 'uncertain' }),
    { ok: false, why: 'unavailable' });
  assert.equal(sessions.recoveryView().ready, false);
  assert.equal((await sessions.recoverWorld()).ready, false);
  assert.equal(prepares, 1);
  assert.equal((await sessions.recoverWorld({ retry: true })).ready, true);
  assert.equal(prepares, 1, 'recovery commits the exact durable pending intent');
  assert.equal(commits, 1);
  assert.equal((await backing.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
});

test('missing prepare reply retries the identical retained intent only after explicit world retry', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let lose = true; const requests = [];
  const operationStore = wrap(backing, { prepareOperation: async intent => {
    requests.push(structuredClone(intent));
    if (lose) { lose = false; throw new Error('no prepare persisted'); }
    return backing.prepareOperation(intent);
  } });
  const { sessions } = await fixture({ store: backing, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  await sessions.save('peer', opened.token, { ...opened.character.data, name: 'retry me' });
  assert.equal((await sessions.recoverWorld()).ready, false);
  assert.equal(requests.length, 1);
  assert.equal((await sessions.recoverWorld({ retry: true })).ready, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal((await backing.loadCharacter(WORLD, EPOCH, CHAR)).data.name, 'retry me');
});

test('lost commit reply is reconciled by exact operation recovery and publishes only after synchronous drain', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let commits = 0;
  const operationStore = wrap(backing, { commitOperation: async intent => {
    commits++; await backing.commitOperation(intent); throw new Error('commit response lost');
  } });
  const { sessions } = await fixture({ store: backing, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  assert.deepEqual(await sessions.contribute('peer', opened.token, contribution(70)),
    { ok: false, why: 'unavailable' });
  assert.equal((await sessions.recoverWorld()).ready, true);
  assert.equal(commits, 1);
  const recovered = await sessions.recover('peer');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.replay, true);
  let event;
  assert.deepEqual(sessions.drain(value => { event = value; }), ['peer']);
  assert.equal(event.character.version, 2);
  assert.equal(event.project.version, 2);
  assert.equal(sessions.canMutate('peer'), true);
});

test('recovery publishes current character and project rows newer than the historical operation result', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let lose = true;
  const operationStore = wrap(backing, { commitOperation: async intent => {
    const result = await backing.commitOperation(intent);
    if (lose) {
      lose = false;
      const current = await backing.loadCharacter(WORLD, EPOCH, CHAR);
      await backing.commitContribution({ operationId: id(72), worldId: WORLD, worldEpoch: EPOCH,
        characterId: CHAR, projectId: PROJECT, good: 'madera', amount: 1,
        expectedCharacterVersion: current.version, expectedProjectVersion: 2 });
      throw new Error('late lost reply');
    }
    return result;
  } });
  const { sessions } = await fixture({ store: backing, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  await sessions.contribute('peer', opened.token, contribution(71));
  await sessions.recoverWorld(); await sessions.recover('peer');
  let event; sessions.drain(value => { event = value; });
  assert.equal((await backing.loadOperation(id(71))).result.character.version, 2);
  assert.equal(event.character.version, 3);
  assert.equal(event.project.version, 3);
  assert.equal(event.character.data.eco.pack.goods.madera, 5);
});

test('terminal save CAS conflict is durable and stages the latest row for publication', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); let changed = false;
  const operationStore = wrap(backing, { commitOperation: async intent => {
    if (!changed) { changed = true; await backing.saveCharacter({ ...row(), data: { ...row().data, name: 'otro writer' } }); }
    return backing.commitOperation(intent);
  } });
  const { sessions } = await fixture({ store: backing, operationStore });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const result = await sessions.save('peer', opened.token, { ...opened.character.data, name: 'mi save' });
  assert.deepEqual(result, { ok: false, why: 'conflict' });
  let event; sessions.drain(value => { event = value; });
  assert.equal(event.character.version, 2);
  assert.equal(event.character.data.name, 'otro writer');
  assert.deepEqual(event.outcome, { ok: false, why: 'conflict' });
});

test('close during commit retains the account reservation and closed exact recovery releases without publication', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); const entered = deferred(), wait = deferred();
  const operationStore = wrap(backing, { commitOperation: async intent => {
    entered.resolve(); await wait.promise; await backing.commitOperation(intent); throw new Error('lost closed reply');
  } });
  const identities = new Map([['old', auth()], ['new', auth()]]);
  const { sessions } = await fixture({ store: backing, operationStore, identities });
  await sessions.recoverWorld(); const opened = await sessions.open('old');
  const pending = sessions.contribute('old', opened.token, contribution(80)); await entered.promise;
  sessions.close('old');
  await assert.rejects(sessions.open('new'), e => e.code === 'session');
  wait.resolve(); assert.deepEqual(await pending, { ok: false, why: 'closed' });
  assert.equal((await sessions.recoverWorld()).ready, true);
  const recovered = await sessions.recover('old');
  assert.equal(recovered.ok, true);
  assert.deepEqual(sessions.drain(() => assert.fail('closed session published')), []);
  await sessions.open('new');
});

test('auth reference replacement during journal I/O stays revoked after the late result', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); const entered = deferred(), wait = deferred();
  const operationStore = wrap(backing, { commitOperation: async intent => {
    entered.resolve(); await wait.promise; return backing.commitOperation(intent);
  } });
  const original = auth(), identities = new Map([['peer', original]]);
  const { sessions } = await fixture({ store: backing, operationStore, identities });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const pending = sessions.save('peer', opened.token, { ...opened.character.data, name: 'late' }); await entered.promise;
  identities.set('peer', auth()); wait.resolve(); await pending;
  assert.equal(sessions.canMutate('peer'), false);
  assert.deepEqual(sessions.drain(() => assert.fail('revoked session published')), []);
  identities.set('peer', original);
  assert.equal(sessions.canMutate('peer'), false, 'restoring an observed auth object cannot revive the session');
});

test('auth replacement during current-row reload suppresses the late save result and publication', async () => {
  const backing = createMemoryContributionStore({ characters: [row()], projects: [project()] });
  await backing.initializeBinding(binding()); const entered = deferred(), wait = deferred(); let loads = 0;
  const store = wrap(backing, { loadCharacter: async (...args) => {
    loads++;
    if (loads === 2) { entered.resolve(); await wait.promise; }
    return backing.loadCharacter(...args);
  } });
  const identities = new Map([['peer', auth()]]);
  const { sessions } = await fixture({ store, operationStore: backing, identities });
  await sessions.recoverWorld(); const opened = await sessions.open('peer');
  const saving = sessions.save('peer', opened.token, { ...opened.character.data, name: 'stale reload' });
  await entered.promise;
  identities.set('peer', auth()); wait.resolve();
  assert.deepEqual(await saving, { ok: false, why: 'identity' });
  assert.deepEqual(sessions.drain(() => assert.fail('replaced identity published')), []);
});

test('async and throwing publishers fence instead of updating session revision; explicit recovery is required', async () => {
  const { sessions } = await fixture(); await sessions.recoverWorld();
  const opened = await sessions.open('peer');
  await sessions.save('peer', opened.token, { ...opened.character.data, name: 'staged' });
  let called = false;
  assert.throws(() => sessions.drain(async () => { called = true; }), e => e.code === 'configuration');
  assert.equal(called, false);
  assert.deepEqual(sessions.drain(() => { throw new Error('publisher failed'); }), []);
  assert.equal(sessions.canMutate('peer'), false);
  await sessions.recover('peer');
  assert.deepEqual(sessions.drain(() => {}), ['peer']);
});

test('reentrant close is deferred until the synchronous publication boundary finishes', async () => {
  const { sessions } = await fixture(); await sessions.recoverWorld();
  const opened = await sessions.open('peer');
  await sessions.save('peer', opened.token, { ...opened.character.data, name: 'published atomically' });
  let recoveryError;
  assert.deepEqual(sessions.drain(event => {
    assert.equal(event.character.version, 2);
    try { sessions.recoverWorld(); } catch (error) { recoveryError = error; }
    sessions.close('peer');
  }), ['peer']);
  assert.equal(recoveryError?.code, 'busy');
  await assert.rejects(Promise.resolve().then(() => sessions.view('peer')), e => e.code === 'session');
  assert.deepEqual(sessions.drain(() => assert.fail('closed session republished')), []);
  assert.equal((await sessions.open('peer')).character.version, 2);
});

test('journal mode rejects per-client retry and confines retry authority to the explicit world recovery API', async () => {
  const { sessions } = await fixture(); await sessions.recoverWorld();
  const opened = await sessions.open('peer');
  await sessions.save('peer', opened.token, { ...opened.character.data, name: 'saved' });
  assert.throws(() => sessions.recover('peer', { retry: true }), e => e instanceof ContributionError && e.code === 'input');
});
