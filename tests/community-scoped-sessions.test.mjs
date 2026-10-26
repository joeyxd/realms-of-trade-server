import test from 'node:test';
import assert from 'node:assert/strict';
import { ContributionError } from '../server/community/contributionContract.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { ScopedProfileSessions } from '../server/community/scopedProfileSessions.mjs';
import { database } from './helpers/community-sql.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = uuid(1), CHAR = uuid(2), PROJECT = 'salty:hall';
function character(version = 1, name = 'Nerea', characterId = CHAR) {
  return { worldId: WORLD, worldEpoch: EPOCH, characterId, version, data: {
    v: 1, name, gold: 321, eco: { tradeRev: 0, pack: { cap: 40, goods: { madera: 7 } } },
    flags: { nested: ['keep'] }, raft: { id: 'raft-keep', cargo: { tronco: 4 } },
  } };
}
function project(version = 1, contributed = 2) { return { worldId: WORLD, worldEpoch: EPOCH,
  projectId: PROJECT, version, requirements: { madera: 10 }, contributed: { madera: contributed } }; }
const intent = (n, amount = 1) => ({ operationId: uuid(n), projectId: PROJECT, good: 'madera', amount,
  expectedProjectVersion: 1 });
function baseStore(options = {}) { return createMemoryContributionStore({
  characters: [character(), ...(options.characters ?? [])], projects: [project(), ...(options.projects ?? [])],
}); }
function binding(accountId = uuid(100), changes = {}) { return { accountId, worldId: WORLD,
  worldEpoch: EPOCH, characterId: CHAR, ...changes }; }
function harness(store = baseStore(), bindings = new Map([['c1', binding()]])) {
  return { store, bindings, sessions: new ScopedProfileSessions(store, { resolveBinding: id => bindings.get(id) }) };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wrap(store, overrides) {
  const wrapped = Object.create(store);
  for (const [key, value] of Object.entries(overrides)) wrapped[key] = value;
  return wrapped;
}
async function sqlStore(t) {
  const sql = await database(undefined, { sessionSaves: true }); t.after(() => sql.close());
  await sql.store.initializeCharacter(character()); await sql.store.initializeProject(project());
  return sql.store;
}

test('trusted binding comes only from resolver and contribution intent cannot spoof identity or scope', async () => {
  const { sessions } = harness();
  const opened = await sessions.open('c1', { accountId: uuid(101), worldId: 'world:spoof', characterId: uuid(88) });
  assert.deepEqual(opened.binding, binding());
  assert.equal(opened.character.characterId, CHAR);
  assert.throws(() => sessions.contribute('c1', opened.token, { ...intent(10), characterId: uuid(88) }), ContributionError);
  assert.throws(() => sessions.contribute('c1', opened.token, { ...intent(10), worldId: 'world:spoof' }), ContributionError);
  assert.equal(await sessions.store.loadContributionReceipt(uuid(10)), null);
  assert.equal(sessions.canMutate('c1'), true);
});

test('admission rejects duplicate account or duplicate scoped character', async () => {
  const bindings = new Map([
    ['a', binding(uuid(110))], ['same-account', binding(uuid(110), { characterId: uuid(3) })],
    ['same-character', binding(uuid(111))], ['other-character', binding(uuid(112), { characterId: uuid(3) })],
  ]);
  const sessions = harness(baseStore({ characters: [character(1, 'Another', uuid(3))] }), bindings).sessions;
  await sessions.open('a');
  await assert.rejects(sessions.open('same-account'), e => e.code === 'session');
  await assert.rejects(sessions.open('same-character'), e => e.code === 'session');
  await sessions.open('other-character');
  assert.equal(sessions.canMutate('a'), true);
  assert.equal(sessions.canMutate('other-character'), true);
});

test('session revision tokens are opaque and stale tokens are rejected after publication', async () => {
  const { sessions } = harness(); const opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Saved' });
  assert.deepEqual(sessions.drain(() => {}), ['c1']);
  const current = sessions.view('c1');
  assert.equal(current.character.version, 2);
  assert.notEqual(current.token, opened.token);
  assert.throws(() => sessions.save('c1', opened.token, character().data), e => e.code === 'stale');
});

test('busy save fences mutation immediately and publishes only from the synchronous drain callback', async () => {
  const gate = deferred(), started = deferred();
  const underlying = baseStore();
  // Keep the deferred wrapper and the stateful backing store the same instance.
  const shared = wrap(underlying, { saveCharacter: async row => {
    started.resolve(); await gate.promise; return underlying.saveCharacter(row);
  } });
  const sessions = harness(shared).sessions, opened = await sessions.open('c1');
  const pending = sessions.save('c1', opened.token, { ...opened.character.data, name: 'Saved' });
  await started.promise;
  assert.equal(sessions.canMutate('c1'), false);
  assert.equal(sessions.view('c1').phase, 'saving');
  let publications = 0;
  assert.deepEqual(sessions.drain(() => { publications++; }), []);
  assert.equal(publications, 0);
  gate.resolve(); await pending;
  assert.equal(sessions.view('c1').phase, 'pending');
  assert.equal(sessions.canMutate('c1'), false);
  assert.equal(publications, 0);
  assert.deepEqual(sessions.drain(event => { publications++; assert.equal(event.character.version, 2); }), ['c1']);
  assert.equal(publications, 1);
  assert.equal(sessions.canMutate('c1'), true);
});

test('contribution and ordinary save run through the same scoped Supabase/PGlite row authority', async t => {
  const store = await sqlStore(t), { sessions } = harness(store);
  const opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Saved first' });
  sessions.drain(() => {});
  const current = sessions.view('c1');
  const result = await sessions.contribute('c1', current.token, intent(20, 2));
  assert.equal(result.ok, true);
  assert.equal(result.character.version, 3);
  assert.equal(result.character.data.name, 'Saved first');
  assert.equal(result.character.data.eco.pack.goods.madera, 5);
  sessions.drain(event => {
    assert.equal(event.character.version, 3);
    assert.equal(event.project.version, 2);
  });
  assert.equal((await store.loadCharacter(WORLD, EPOCH, CHAR)).version, 3);
});

test('unknown contribution transport fences without retry; receipt recovery publishes current rows', async () => {
  const underlying = baseStore(); let lose = true, commits = 0;
  const store = wrap(underlying, { commitContribution: async request => {
    commits++;
    const result = await underlying.commitContribution(request);
    if (lose) { lose = false; throw new Error('reply lost after commit'); }
    return result;
  } });
  const { sessions } = harness(store), opened = await sessions.open('c1');
  const failed = await sessions.contribute('c1', opened.token, intent(30));
  assert.deepEqual(failed, { ok: false, why: 'unavailable' });
  assert.equal(sessions.canMutate('c1'), false);
  assert.equal(commits, 1);
  assert.deepEqual(await sessions.recover('c1'), { ok: true, accepted: 1,
    character: { ...character(2), data: { ...character().data,
      eco: { tradeRev: 1, pack: { cap: 40, goods: { madera: 6 } } } } },
    project: { ...project(2, 3) }, replay: true });
  assert.equal(commits, 1);
  const published = [];
  assert.deepEqual(sessions.drain(event => published.push(event)), ['c1']);
  assert.equal(published[0].character.version, 2);
  assert.equal(published[0].project.version, 2);
  assert.equal(sessions.canMutate('c1'), true);
});

test('repeated operation intent resolves historical receipt but publishes latest character and project rows', async () => {
  const store = baseStore(), { sessions } = harness(store), opened = await sessions.open('c1');
  const first = await sessions.contribute('c1', opened.token, intent(40));
  assert.equal(first.ok, true); sessions.drain(() => {});
  const currentToken = sessions.view('c1').token;
  const later = await store.commitContribution({ operationId: uuid(41), worldId: WORLD, worldEpoch: EPOCH,
    characterId: CHAR, projectId: PROJECT, good: 'madera', amount: 1,
    expectedCharacterVersion: 2, expectedProjectVersion: 2 });
  assert.equal(later.ok, true);
  const replay = await sessions.contribute('c1', currentToken, intent(40));
  assert.equal(replay.replay, true);
  assert.equal(replay.character.version, 2, 'the operation receipt remains historical');
  let event;
  sessions.drain(value => { event = value; });
  assert.equal(event.character.version, 3);
  assert.equal(event.project.version, 3);
  assert.equal(event.character.data.eco.pack.goods.madera, 5);
  assert.equal(sessions.view('c1').character.version, 3);
});

test('close during an in-flight write reserves identity until settled and prevents late publication', async () => {
  const underlying = baseStore(), gate = deferred(), started = deferred();
  const store = wrap(underlying, { saveCharacter: async row => {
    started.resolve(); await gate.promise; return underlying.saveCharacter(row);
  } });
  const bindings = new Map([['c1', binding()], ['c2', binding()]]);
  const sessions = harness(store, bindings).sessions, opened = await sessions.open('c1');
  const pending = sessions.save('c1', opened.token, { ...opened.character.data, name: 'Late old owner' });
  await started.promise; sessions.close('c1');
  await assert.rejects(sessions.open('c2'), e => e.code === 'session');
  gate.resolve(); await pending;
  assert.deepEqual(sessions.drain(() => assert.fail('closed session published')), []);
  const reopened = await sessions.open('c2');
  assert.equal(reopened.character.version, 2);
  assert.equal(reopened.character.data.name, 'Late old owner');
});

test('close during successful contribution reserves identity until RPC settles and never publishes old owner', async () => {
  const underlying = baseStore(), gate = deferred(), started = deferred();
  const store = wrap(underlying, { commitContribution: async request => {
    started.resolve(); await gate.promise; return underlying.commitContribution(request);
  } });
  const bindings = new Map([['old-owner', binding()], ['new-owner', binding()]]);
  const sessions = harness(store, bindings).sessions, opened = await sessions.open('old-owner');
  const pending = sessions.contribute('old-owner', opened.token, intent(70, 2));
  await started.promise; sessions.close('old-owner');
  await assert.rejects(sessions.open('new-owner'), e => e.code === 'session');
  gate.resolve();
  const contribution = await pending;
  assert.equal(contribution.ok, true);
  assert.deepEqual(sessions.drain(() => assert.fail('closed owner published contribution')), []);
  const reopened = await sessions.open('new-owner');
  assert.equal(reopened.character.version, 2);
  assert.equal(reopened.character.data.eco.pack.goods.madera, 5);
  assert.equal((await sessions.store.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 4);
});

test('late initial load after close cannot remove a replacement session with the same client ID', async () => {
  const underlying = baseStore(), gate = deferred(), firstStarted = deferred(); let loads = 0;
  const store = wrap(underlying, { loadCharacter: async (...args) => {
    loads++;
    if (loads === 1) { firstStarted.resolve(); await gate.promise; }
    return underlying.loadCharacter(...args);
  } });
  const bindings = new Map([['same-client', binding()], ['competitor', binding()]]);
  const sessions = harness(store, bindings).sessions;
  const oldOpen = sessions.open('same-client');
  await firstStarted.promise; sessions.close('same-client');
  const replacement = await sessions.open('same-client');
  assert.equal(replacement.character.version, 1);
  gate.resolve();
  await assert.rejects(oldOpen, e => e.code === 'identity');
  assert.equal(sessions.view('same-client').phase, 'ready');
  assert.equal(sessions.canMutate('same-client'), true);
  await assert.rejects(sessions.open('competitor'), e => e.code === 'session');
});

test('identity change after staging blocks publication and fences the session', async () => {
  const { sessions, bindings } = harness(); const opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Staged' });
  bindings.set('c1', binding(uuid(101), { worldId: 'world:changed', characterId: uuid(70) }));
  let called = false;
  assert.deepEqual(sessions.drain(() => { called = true; }), []);
  assert.equal(called, false);
  assert.equal(sessions.view('c1').phase, 'fenced');
  assert.equal(sessions.canMutate('c1'), false);
});

test('publication callback failure keeps the owner fenced until close and fresh admission', async () => {
  const bindings = new Map([['c1', binding()], ['c2', binding()]]);
  const { sessions } = harness(baseStore(), bindings), opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Needs publish' });
  assert.deepEqual(sessions.drain(() => { throw new Error('world rollback'); }), []);
  assert.equal(sessions.view('c1').phase, 'fenced');
  assert.equal(sessions.view('c1').reason, 'publication');
  assert.equal(sessions.canMutate('c1'), false);
  sessions.close('c1');
  assert.equal((await sessions.open('c2')).character.version, 2);
});

test('reentrant drain is rejected while the outer drain publishes exactly one revision', async () => {
  const { sessions } = harness(), opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Published once' });
  let events = 0, nestedError;
  assert.deepEqual(sessions.drain(event => {
    events++;
    assert.equal(event.character.version, 2);
    try { sessions.drain(() => { events++; }); } catch (error) { nestedError = error; }
  }), ['c1']);
  assert.equal(events, 1);
  assert.equal(nestedError.code, 'busy');
  assert.equal(sessions.view('c1').phase, 'ready');
  assert.equal(sessions.view('c1').character.version, 2);
  assert.equal(sessions.view('c1').token.revision, 2);
});

test('mutating callback payload cannot change stored row or trusted binding', async () => {
  const { store, sessions } = harness(), opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Confirmed' });
  sessions.drain(event => {
    event.character.version = 900;
    event.character.data.name = 'Callback mutation';
    event.character.data.eco.pack.goods.madera = 0;
    event.binding.accountId = uuid(999);
    event.binding.worldId = 'world:callback';
  });
  const current = sessions.view('c1');
  const durable = await store.loadCharacter(WORLD, EPOCH, CHAR);
  assert.equal(current.character.version, 2);
  assert.equal(current.character.data.name, 'Confirmed');
  assert.equal(current.character.data.eco.pack.goods.madera, 7);
  assert.deepEqual(current.binding, binding());
  assert.deepEqual(durable, current.character);
  assert.equal(current.token.revision, 2);
  assert.notEqual(current.token, opened.token);
});

test('async publication functions are refused before invocation and returned thenables fence the session', async () => {
  const { sessions } = harness(), opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Awaiting publication' });
  let asyncCalled = false;
  assert.throws(() => sessions.drain(async () => { asyncCalled = true; }), e => e.code === 'configuration');
  assert.equal(asyncCalled, false);
  assert.equal(sessions.view('c1').phase, 'pending');
  assert.deepEqual(sessions.drain(() => Promise.resolve()), []);
  assert.equal(sessions.view('c1').phase, 'fenced');
  assert.equal(sessions.view('c1').reason, 'publication');
  assert.equal(sessions.canMutate('c1'), false);
});

test('save CAS conflict is sticky until close and reopen reloads the authoritative row', async () => {
  const store = baseStore(), { sessions } = harness(store), opened = await sessions.open('c1');
  await store.saveCharacter({ ...character(), data: { ...character().data, name: 'External writer' } });
  assert.deepEqual(await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Stale owner' }),
    { ok: false, why: 'conflict' });
  assert.equal(sessions.view('c1').phase, 'fenced');
  assert.throws(() => sessions.recover('c1'), e => e.code === 'conflict');
  sessions.close('c1');
  const bindings = new Map([['c2', binding()]]);
  const reopened = await harness(store, bindings).sessions.open('c2');
  assert.equal(reopened.character.data.name, 'External writer');
  assert.equal(reopened.character.version, 2);
});

test('unknown save with unchanged baseline stays pending until explicit retry of the original CAS', async () => {
  const underlying = baseStore(), started = deferred(); let failBeforeWrite = true, calls = [];
  const store = wrap(underlying, { saveCharacter: async row => {
    calls.push(structuredClone(row)); started.resolve();
    if (failBeforeWrite) { failBeforeWrite = false; throw new Error('uncertain transport'); }
    return underlying.saveCharacter(row);
  } });
  const { sessions } = harness(store), opened = await sessions.open('c1');
  assert.deepEqual(await sessions.save('c1', opened.token, { ...opened.character.data, name: 'Original intent' }),
    { ok: false, why: 'unavailable' });
  assert.equal((await sessions.recover('c1')).why, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(sessions.view('c1').phase, 'fenced');
  const recovered = await sessions.recover('c1', { retry: true });
  assert.equal(recovered.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(sessions.view('c1').phase, 'pending');
  assert.deepEqual(sessions.drain(() => {}), ['c1']);
  assert.equal(sessions.view('c1').character.data.name, 'Original intent');
});

test('closed unknown contribution without a receipt stays reserved until explicit retry settles and releases', async () => {
  const underlying = baseStore(), bindings = new Map([['c1', binding()], ['c2', binding()]]);
  let failed = false, commits = 0;
  const store = wrap(underlying, { commitContribution: async request => {
    commits++;
    if (!failed) { failed = true; throw new Error('request may not have reached store'); }
    return underlying.commitContribution(request);
  } });
  const sessions = harness(store, bindings).sessions, opened = await sessions.open('c1');
  assert.deepEqual(await sessions.contribute('c1', opened.token, intent(60)), { ok: false, why: 'unavailable' });
  sessions.close('c1');
  await assert.rejects(sessions.open('c2'), e => e.code === 'session');
  assert.deepEqual(await sessions.recover('c1'), { ok: false, why: 'pending' });
  assert.equal(commits, 1);
  const recovered = await sessions.recover('c1', { retry: true });
  assert.equal(recovered.ok, true);
  assert.equal(commits, 2);
  assert.deepEqual(sessions.drain(() => assert.fail('closed session published')), []);
  const reopened = await sessions.open('c2');
  assert.equal(reopened.character.version, 2);
  assert.equal(reopened.character.data.eco.pack.goods.madera, 6);
});
