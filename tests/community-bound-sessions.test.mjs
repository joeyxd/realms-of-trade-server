import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { database } from './helpers/community-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3);
const profile = (version = 1, name = 'Nerea') => ({ worldId: WORLD, worldEpoch: EPOCH,
  characterId: CHAR, version, data: { v: 1, name,
    eco: { tradeRev: 0, pack: { cap: 40, goods: { madera: 8 } } } } });
const project = () => ({ worldId: WORLD, worldEpoch: EPOCH, projectId: 'salty:hall', version: 1,
  requirements: { madera: 10 }, contributed: { madera: 0 } });
const binding = () => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR });
const intent = n => ({ operationId: id(n), projectId: 'salty:hall', good: 'madera', amount: 2,
  expectedProjectVersion: 1 });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wrapped(store, overrides) {
  const result = Object.create(store);
  for (const [key, value] of Object.entries(overrides)) result[key] = value;
  return result;
}
function fixture({ store, identities = new Map(), scope = { worldId: WORLD, worldEpoch: EPOCH } } = {}) {
  const resolver = clientId => identities.get(clientId);
  const sessions = new BoundProfileSessions(store, { ...scope, resolveIdentity: resolver });
  return { sessions, identities, resolver };
}
function memoryStore({ bound = true } = {}) {
  const store = createMemoryContributionStore({ characters: [profile()], projects: [project()] });
  if (bound) return store.initializeBinding(binding()).then(() => store);
  return Promise.resolve(store);
}
function auth(accountId = ACCOUNT) { return Object.freeze({ accountId }); }

test('admission accepts only the resolver account and the fixed durable binding', async () => {
  const store = await memoryStore(), identities = new Map([['peer', auth()]]);
  const { sessions } = fixture({ store, identities });
  const opened = await sessions.open('peer', { accountId: id(44), worldId: 'forged', characterId: id(45) });
  assert.deepEqual(opened.binding, binding());
  assert.equal(opened.character.characterId, CHAR);
  const invalid = fixture({ store, identities: new Map([['invalid', Object.freeze({ accountId: ACCOUNT, worldId: WORLD })]]) });
  await assert.rejects(invalid.sessions.open('invalid'), error => error.code === 'identity');
});

test('missing binding denies admission without creating or initializing a character', async () => {
  const store = await memoryStore({ bound: false }); let initialized = 0;
  const tracked = wrapped(store, { initializeBinding: async (...args) => { initialized++; return store.initializeBinding(...args); },
    initializeCharacter: async (...args) => { initialized++; return store.initializeCharacter(...args); } });
  const { sessions } = fixture({ store: tracked, identities: new Map([['peer', auth()]]) });
  await assert.rejects(sessions.open('peer'), error => error.code === 'identity');
  assert.equal(initialized, 0);
  assert.equal(await store.loadBinding(ACCOUNT, WORLD, EPOCH), null);
});

test('one account cannot start concurrent admissions through the same or another client', async () => {
  const store = await memoryStore(), gate = deferred(), started = deferred();
  const slow = wrapped(store, { loadBinding: async (...args) => { started.resolve(); await gate.promise; return store.loadBinding(...args); } });
  const identities = new Map([['first', auth()], ['second', auth()]]), { sessions } = fixture({ store: slow, identities });
  const opening = sessions.open('first'); await started.promise;
  await assert.rejects(sessions.open('second'), error => error.code === 'session');
  await assert.rejects(sessions.open('first'), error => error.code === 'session');
  gate.resolve(); await opening;
  assert.equal(sessions.canMutate('first'), true);
});

test('close during initial lookup retains the client and account reservation until lookup settles', async () => {
  const store = await memoryStore(), gate = deferred(), started = deferred();
  const slow = wrapped(store, { loadBinding: async (...args) => { started.resolve(); await gate.promise; return store.loadBinding(...args); } });
  const identities = new Map([['same', auth()], ['other', auth()]]), { sessions } = fixture({ store: slow, identities });
  const oldOpen = sessions.open('same'); await started.promise;
  sessions.close('same');
  await assert.rejects(sessions.open('same'), error => error.code === 'session');
  await assert.rejects(sessions.open('other'), error => error.code === 'session');
  gate.resolve();
  await assert.rejects(oldOpen, error => error.code === 'identity');
  const replacement = await sessions.open('same');
  assert.equal(replacement.character.version, 1);
});

test('same-account auth connection replacement revokes writes and prevents stale drain publication', async () => {
  const store = await memoryStore(), originalAuth = auth(), identities = new Map([['peer', originalAuth]]);
  const { sessions } = fixture({ store, identities }), opened = await sessions.open('peer');
  const saved = await sessions.save('peer', opened.token, { ...opened.character.data, name: 'Staged' });
  assert.equal(saved.ok, true);
  identities.set('peer', auth());
  assert.equal(sessions.canMutate('peer'), false);
  assert.deepEqual(sessions.view('peer'), { phase: 'fenced', binding: null, character: null,
    token: null, reason: 'identity', pending: null });
  assert.throws(() => sessions.save('peer', opened.token, profile().data), error => error.code === 'identity');
  let published = 0;
  assert.deepEqual(sessions.drain(() => { published++; }), []);
  assert.equal(published, 0);
  assert.throws(() => sessions.recover('peer'), error => error.code === 'identity');
  identities.set('peer', originalAuth);
  assert.equal(sessions.canMutate('peer'), false, 'restoring an old resolver object cannot revive a revoked incarnation');
  assert.equal(sessions.view('peer').character, null);
});

test('lost contribution response holds ownership through close and closed recovery without publication', async () => {
  const underlying = await memoryStore(); let commits = 0;
  const store = wrapped(underlying, { commitContribution: async request => {
    commits++;
    const result = await underlying.commitContribution(request);
    if (commits === 1) throw new Error('committed but reply lost');
    return result;
  } });
  const identities = new Map([['old', auth()], ['new', auth()]]), { sessions } = fixture({ store, identities });
  const opened = await sessions.open('old');
  assert.deepEqual(await sessions.contribute('old', opened.token, intent(60)), { ok: false, why: 'unavailable' });
  assert.equal(sessions.canMutate('old'), false);
  sessions.close('old'); identities.set('old', auth());
  assert.deepEqual(sessions.view('old'), { phase: 'closed', binding: null, character: null,
    token: null, reason: 'identity', pending: null });
  await assert.rejects(sessions.open('new'), error => error.code === 'session');
  const recovered = await sessions.recover('old');
  assert.equal(recovered.replay, true);
  assert.equal(commits, 1, 'recovery reads the durable receipt without resubmitting the contribution');
  assert.deepEqual(sessions.drain(() => assert.fail('closed identity published')), []);
  const replacement = await sessions.open('new');
  assert.equal(replacement.character.version, 2);
  assert.equal(replacement.character.data.eco.pack.goods.madera, 6);
});

test('async drain callbacks are refused before invocation', async () => {
  const store = await memoryStore(), { sessions } = fixture({ store, identities: new Map([['peer', auth()]]) });
  const opened = await sessions.open('peer');
  await sessions.save('peer', opened.token, { ...opened.character.data, name: 'Pending' });
  let invoked = false;
  assert.throws(() => sessions.drain(async () => { invoked = true; }), error => error.code === 'configuration');
  assert.equal(invoked, false);
  assert.equal(sessions.view('peer').phase, 'pending');
});

test('a real SDK backed binding admits only its pre-bound character', async t => {
  const sql = await database(undefined, { bindings: true, sessionSaves: true }); t.after(() => sql.close());
  await sql.store.initializeCharacter(profile());
  await sql.store.initializeProject(project());
  await sql.store.initializeBinding(binding());
  const provisions = sql.calls.filter(call => call.name === 'mn_comm_initialize_binding').length;
  const { sessions } = fixture({ store: sql.store, identities: new Map([['peer', auth()]]) });
  const opened = await sessions.open('peer');
  assert.deepEqual(opened.binding, binding());
  assert.equal(opened.character.version, 1);
  assert.ok(sql.calls.some(call => call.name === 'mn_comm_load_binding'));
  assert.equal(sql.calls.filter(call => call.name === 'mn_comm_initialize_binding').length, provisions);
});
