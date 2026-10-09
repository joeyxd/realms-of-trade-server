import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = { worldId: 'salty', worldEpoch: id(1) };
const binding = n => ({ ...scope, accountId: id(100 + n), characterId: id(n) });
const row = n => ({ ...scope, characterId: id(n), version: 1,
  data: { v: 1, name: `Sailor ${n}`, eco: { pack: { goods: { madera: 8 } } } } });
const intent = n => ({ operationId: id(n), projectId: 'carpentry', good: 'madera', amount: 2,
  expectedProjectVersion: 1 });
const error = code => e => e?.code === code;
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const wrap = (store, methods) => Object.assign(Object.create(store), methods);
async function fixture(overrides = {}) {
  const store = createMemoryContributionStore({ characters: [row(2), row(3)], projects: [{ ...scope,
    projectId: 'carpentry', version: 1, requirements: { madera: 10 }, contributed: { madera: 0 } }] });
  for (const n of [2, 3]) await store.initializeBinding(binding(n));
  const auth = new Map([['a', Object.freeze({ accountId: id(102) })], ['b', Object.freeze({ accountId: id(103) })]]);
  let generated = 200;
  const sessions = new BoundProfileSessions(overrides.characterStore?.(store) ?? store, {
    ...scope, resolveIdentity: client => auth.get(client),
    operationStore: overrides.operationStore?.(store) ?? store,
    allowVolatile: true, uuid: overrides.uuid ?? (() => id(generated++)),
  });
  return { store, auth, sessions };
}

test('another operation closing the gate during preflight never creates an orphan retry', async () => {
  const entered = deferred(), resume = deferred(); let prepares = 0;
  const { sessions, store } = await fixture({ operationStore: backing => wrap(backing, {
    loadOperation: async op => {
      if (op === id(300)) { entered.resolve(); await resume.promise; }
      return backing.loadOperation(op);
    },
    prepareOperation: async raw => { prepares++; return backing.prepareOperation(raw); },
    commitOperation: async raw => { await backing.commitOperation(raw); throw new Error('lost reply'); },
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a'), b = await sessions.open('b');
  const waiting = sessions.contribute('b', b.token, intent(300)); await entered.promise;
  assert.equal((await sessions.save('a', a.token, { ...a.character.data, name: 'Saved A' })).why, 'unavailable');
  resume.resolve(); assert.equal((await waiting).why, 'startup');
  assert.equal(prepares, 1); assert.equal(await store.loadOperation(id(300)), null);
  assert.equal((await sessions.recoverWorld()).ready, true);
  await sessions.recover('a'); await sessions.recover('b');
  assert.deepEqual(sessions.drain(() => {}), ['a', 'b']);
  assert.equal(sessions.canMutate('b'), true);
  assert.equal((await store.loadCharacter(...Object.values(scope), id(3))).version, 1);
});

test('admission rechecks the barrier after loading a current character and releases failed reservations', async () => {
  const entered = deferred(), resume = deferred(); let pause = true;
  const { sessions } = await fixture({ characterStore: backing => wrap(backing, {
    loadCharacter: async (...args) => {
      if (args[2] === id(3) && pause) { entered.resolve(); await resume.promise; }
      return backing.loadCharacter(...args);
    },
  }), operationStore: backing => wrap(backing, {
    commitOperation: async raw => { await backing.commitOperation(raw); throw new Error('lost'); },
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a');
  const opening = sessions.open('b'); await entered.promise;
  await sessions.save('a', a.token, { ...a.character.data, name: 'A' });
  assert.throws(() => sessions.recoverWorld(), error('busy'));
  pause = false; resume.resolve(); await assert.rejects(opening, error('startup'));
  await sessions.recoverWorld();
  assert.equal((await sessions.open('b')).character.characterId, id(3));
});

test('a recovery scan blocks mutation, admission, tokens and drain until its final proof', async () => {
  const entered = deferred(), resume = deferred(); let pause = false;
  const { sessions } = await fixture({ operationStore: backing => wrap(backing, {
    listPendingOperations: async (...args) => {
      if (pause) { entered.resolve(); await resume.promise; }
      return backing.listPendingOperations(...args);
    },
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a');
  await sessions.save('a', a.token, { ...a.character.data, name: 'Pending' });
  pause = true; const recovery = sessions.recoverWorld(); await entered.promise;
  assert.equal(sessions.canMutate('a'), false); assert.equal(sessions.view('a').token, null);
  assert.throws(() => sessions.save('a', a.token, a.character.data), error('startup'));
  await assert.rejects(sessions.open('b'), error('startup'));
  assert.deepEqual(sessions.drain(() => assert.fail('published during scan')), []);
  pause = false; resume.resolve(); assert.equal((await recovery).ready, true);
  assert.deepEqual(sessions.drain(() => {}), ['a']);
});

test('close during the post-commit reload hides success and reserves the account until I/O finishes', async () => {
  const entered = deferred(), resume = deferred(); let pause = false;
  const { sessions, auth } = await fixture({ characterStore: backing => wrap(backing, {
    loadCharacter: async (...args) => {
      if (pause) { entered.resolve(); await resume.promise; }
      return backing.loadCharacter(...args);
    },
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a');
  auth.set('replacement', Object.freeze({ accountId: id(102) }));
  pause = true; const saving = sessions.save('a', a.token, { ...a.character.data, name: 'Saved' });
  await entered.promise; sessions.close('a');
  await assert.rejects(sessions.open('replacement'), error('session'));
  pause = false; resume.resolve(); assert.deepEqual(await saving, { ok: false, why: 'closed' });
  assert.deepEqual(sessions.drain(() => assert.fail('closed publication')), []);
  assert.equal((await sessions.open('replacement')).character.version, 2);
});

test('missing exact recovery evidence remains in the world barrier until the evidence returns', async () => {
  let missing = false;
  const { sessions } = await fixture({ operationStore: backing => wrap(backing, {
    loadOperation: async op => missing ? null : backing.loadOperation(op),
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a');
  await sessions.save('a', a.token, { ...a.character.data, name: 'Saved' });
  sessions.drain(() => { throw new Error('publication failed'); });
  missing = true; assert.equal((await sessions.recover('a')).why, 'pending');
  assert.equal(sessions.recoveryView().unresolved, 1);
  assert.equal((await sessions.recoverWorld()).ready, false);
  missing = false; assert.equal((await sessions.recoverWorld()).ready, true);
  await sessions.recover('a'); assert.deepEqual(sessions.drain(() => {}), ['a']);
});

test('an invalid generated save UUID cannot poison a ready session before any write', async () => {
  const uuids = ['bad-uuid', id(400)];
  const { sessions, store } = await fixture({ uuid: () => uuids.shift() });
  await sessions.recoverWorld(); const a = await sessions.open('a');
  assert.throws(() => sessions.save('a', a.token, a.character.data), error('input'));
  assert.equal(sessions.canMutate('a'), true);
  assert.equal((await sessions.save('a', a.token, a.character.data)).ok, true);
  assert.equal((await store.loadOperation(id(400))).state, 'complete');
});

test('a malformed current row cannot be published from a valid historical acknowledgement', async () => {
  let corrupt = false;
  const { sessions } = await fixture({ characterStore: backing => wrap(backing, {
    loadCharacter: async (...args) => {
      const current = await backing.loadCharacter(...args);
      if (corrupt) current.data.name = 'forged same revision';
      return current;
    },
  }) });
  await sessions.recoverWorld(); const a = await sessions.open('a'); corrupt = true;
  assert.equal((await sessions.save('a', a.token, { ...a.character.data, name: 'Saved' })).why, 'response');
  assert.deepEqual(sessions.drain(() => assert.fail('forged row published')), []);
  corrupt = false; await sessions.recover('a'); let event;
  sessions.drain(value => { event = value; }); assert.equal(event.character.data.name, 'Saved');
});

test('close or auth replacement during preflight prevents dispatching any journal write', async () => {
  for (const action of ['close', 'replace']) {
    const entered = deferred(), resume = deferred(); let prepares = 0;
    const { sessions, store, auth } = await fixture({ operationStore: backing => wrap(backing, {
      loadOperation: async op => { entered.resolve(); await resume.promise; return backing.loadOperation(op); },
      prepareOperation: async raw => { prepares++; return backing.prepareOperation(raw); },
    }) });
    await sessions.recoverWorld(); const a = await sessions.open('a');
    const pending = sessions.contribute('a', a.token, intent(500)); await entered.promise;
    if (action === 'close') sessions.close('a');
    else auth.set('a', Object.freeze({ accountId: id(102) }));
    resume.resolve(); assert.deepEqual(await pending,
      { ok: false, why: action === 'close' ? 'closed' : 'identity' });
    assert.equal(prepares, 0); assert.equal(sessions.recoveryView().ready, true);
    assert.equal((await store.loadCharacter(...Object.values(scope), id(2))).version, 1);
    assert.deepEqual(sessions.drain(() => assert.fail('revoked preflight published')), []);
    sessions.close('a'); assert.equal((await sessions.open('a')).character.version, 1);
  }
});

test('close or auth replacement during prepare leaves a pending request without dispatching commit', async () => {
  for (const action of ['close', 'replace']) {
    const entered = deferred(), resume = deferred(); let commits = 0;
    const { sessions, store, auth } = await fixture({ operationStore: backing => wrap(backing, {
      prepareOperation: async raw => {
        const prepared = await backing.prepareOperation(raw); entered.resolve(); await resume.promise; return prepared;
      },
      commitOperation: async raw => { commits++; return backing.commitOperation(raw); },
    }) });
    await sessions.recoverWorld(); const a = await sessions.open('a');
    const pending = sessions.save('a', a.token, { ...a.character.data, name: 'Prepared' }); await entered.promise;
    if (action === 'close') sessions.close('a');
    else auth.set('a', Object.freeze({ accountId: id(102) }));
    resume.resolve(); assert.deepEqual(await pending,
      { ok: false, why: action === 'close' ? 'closed' : 'identity' });
    assert.equal(commits, 0); assert.equal((await store.loadOperation(id(200))).state, 'pending');
    assert.equal((await store.loadCharacter(...Object.values(scope), id(2))).version, 1);
    sessions.close('a'); assert.equal((await sessions.recoverWorld()).ready, false);
    assert.equal((await sessions.recoverWorld({ retry: true })).ready, true);
    await sessions.recover('a'); assert.equal(commits, 1);
    assert.deepEqual(sessions.drain(() => assert.fail('closed pending request published')), []);
    assert.equal((await sessions.open('a')).character.version, 2);
  }
});
