import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { CharacterProvisioning } from '../server/community/characterProvisioning.mjs';
import { BoundProfileSessions } from '../server/community/boundProfileSessions.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = uuid(1), ACCOUNT = uuid(100), CHAR = uuid(200);
const auth = accountId => Object.freeze({ accountId });
const dataFor = binding => {
  const data = newProfile(); data.pirateId = `character:${binding.characterId}`;
  data.gold = 123; data.eco.pack.goods = { madera: 6 };
  return data;
};
function provisioner({ store = createMemoryContributionStore(), accounts = new Map([['c1', auth(ACCOUNT)]]),
  worldId = WORLD, worldEpoch = EPOCH, ids = [CHAR], initializeProfile = dataFor } = {}) {
  let next = 0;
  return { store, accounts, provisioner: new CharacterProvisioning(store, {
    worldId, worldEpoch, resolveIdentity: clientId => accounts.get(clientId),
    uuid: () => ids[next++], initializeProfile,
  }), idsUsed: () => next };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wrap(target, overrides) {
  const result = Object.create(target);
  for (const [name, value] of Object.entries(overrides)) result[name] = value;
  return result;
}
async function project(store, worldId = WORLD, worldEpoch = EPOCH) {
  await store.initializeProject({ worldId, worldEpoch, projectId: 'salty:hall', version: 1,
    requirements: { madera: 20 }, contributed: { madera: 0 } });
}
const intent = n => ({ operationId: uuid(n), projectId: 'salty:hall', good: 'madera', amount: 2,
  expectedProjectVersion: 1 });
function bound(store, accounts, worldId = WORLD, worldEpoch = EPOCH) {
  return new BoundProfileSessions(store, { worldId, worldEpoch, resolveIdentity: id => accounts.get(id) });
}

test('provisioning uses only the frozen authenticated account and server profile factory', async () => {
  const { provisioner: owner, store } = provisioner();
  const opened = await owner.provision('c1', { accountId: uuid(101), characterId: uuid(999), worldId: 'spoof' },
    { pirateId: 'account:spoof', gold: 999, eco: { pack: { goods: { madera: 999 } } } });
  assert.deepEqual(opened.binding, { accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR });
  assert.equal(opened.character.data.pirateId, `character:${CHAR}`);
  assert.equal(opened.character.data.gold, 123);
  assert.equal((await store.loadIdentity({ accountId: uuid(101), worldId: WORLD, worldEpoch: EPOCH })), null);
  assert.equal(owner.inspect('c1'), null);
});

test('one account keeps one character in each world generation, with world and epoch scoped independently', async () => {
  const store = createMemoryContributionStore(), accounts = new Map([['a', auth(ACCOUNT)], ['b', auth(ACCOUNT)]]);
  const first = provisioner({ store, accounts, ids: [uuid(201), uuid(202), uuid(203)] });
  const a = await first.provisioner.provision('a');
  const otherWorld = provisioner({ store, accounts, worldId: 'world:other', ids: [uuid(202)] });
  const b = await otherWorld.provisioner.provision('b');
  const nextEpoch = provisioner({ store, accounts, worldEpoch: uuid(2), ids: [uuid(203)] });
  const c = await nextEpoch.provisioner.provision('a');
  assert.equal(a.binding.characterId, uuid(201));
  assert.equal(b.binding.characterId, uuid(202));
  assert.equal(c.binding.characterId, uuid(203));
  assert.notDeepEqual(a.binding, b.binding);
  assert.notDeepEqual(a.binding, c.binding);
});

test('duplicate account is reserved while the durable identity lookup is pending', async () => {
  const store = createMemoryContributionStore(), gate = deferred(), started = deferred();
  const identityStore = wrap(store, { loadIdentity: async (...args) => {
    started.resolve(); await gate.promise; return store.loadIdentity(...args);
  } });
  const accounts = new Map([['a', auth(ACCOUNT)], ['b', auth(ACCOUNT)]]);
  const owner = provisioner({ store: identityStore, accounts }).provisioner;
  const pending = owner.provision('a'); await started.promise;
  await assert.rejects(owner.provision('b'), e => e.code === 'session');
  gate.resolve(); await pending;
});

test('provision then bound save and contribution reopen from the current same character row', async () => {
  const store = createMemoryContributionStore(); await project(store);
  const accounts = new Map([['c1', auth(ACCOUNT)]]);
  const bootstrap = provisioner({ store, accounts, ids: [CHAR, uuid(201)] });
  const created = await bootstrap.provisioner.provision('c1');
  let sessions = bound(store, accounts), opened = await sessions.open('c1');
  await sessions.save('c1', opened.token, { ...opened.character.data, gold: 456 });
  sessions.drain(() => {});
  const current = sessions.view('c1');
  const contributed = await sessions.contribute('c1', current.token, intent(300));
  assert.equal(contributed.ok, true); sessions.drain(() => {}); sessions.close('c1');
  const once = await bootstrap.provisioner.provision('c1');
  sessions = bound(store, accounts); opened = await sessions.open('c1');
  assert.equal(opened.binding.characterId, created.binding.characterId);
  assert.equal(opened.character.version, 3);
  assert.equal(opened.character.data.gold, 456);
  assert.equal(opened.character.data.eco.pack.goods.madera, 4);
  assert.equal(once.character.version, 3);
  assert.equal(bootstrap.idsUsed(), 1, 'reentry must load the binding without allocating a candidate');
});

test('lost committed allocation reply recovers by read without allocating a second character', async () => {
  const store = createMemoryContributionStore(); let allocations = 0, lose = true;
  const identityStore = wrap(store, { allocateIdentity: async request => {
    allocations++; const result = await store.allocateIdentity(request);
    if (lose) { lose = false; throw new Error('reply lost after commit'); }
    return result;
  } });
  const owner = provisioner({ store: identityStore });
  await assert.rejects(owner.provisioner.provision('c1'), e => e.code === 'unavailable');
  assert.deepEqual(owner.provisioner.inspect('c1'), { phase: 'fenced', uncertain: true, reason: 'unavailable',
    pending: { binding: { accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR } } });
  const recovered = await owner.provisioner.recover('c1');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.identity.binding.characterId, CHAR);
  assert.equal(allocations, 1);
  assert.equal(owner.idsUsed(), 1);
  assert.equal(owner.provisioner.inspect('c1'), null);
});

test('missing evidence keeps account reserved until explicit retry of the identical frozen allocation', async () => {
  const store = createMemoryContributionStore(); let calls = [], first = true;
  const identityStore = wrap(store, { allocateIdentity: async request => {
    calls.push(structuredClone(request));
    if (first) { first = false; throw new Error('request outcome unknown'); }
    return store.allocateIdentity(request);
  } });
  const accounts = new Map([['a', auth(ACCOUNT)], ['b', auth(ACCOUNT)]]);
  const owner = provisioner({ store: identityStore, accounts, ids: [CHAR, uuid(201)] }).provisioner;
  await assert.rejects(owner.provision('a'), e => e.code === 'unavailable');
  assert.deepEqual(await owner.recover('a'), { ok: false, why: 'pending' });
  await assert.rejects(owner.provision('b'), e => e.code === 'session');
  assert.equal(calls.length, 1);
  const retried = await owner.recover('a', { retry: true });
  assert.equal(retried.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(owner.inspect('a'), null);
});

test('close during lookup or allocation never returns an old identity as provisioned', async t => {
  for (const stage of ['loadIdentity', 'allocateIdentity']) {
    const store = createMemoryContributionStore(), gate = deferred(), started = deferred();
    const identityStore = wrap(store, { [stage]: async (...args) => {
      started.resolve(); await gate.promise; return store[stage](...args);
    } });
    const owner = provisioner({ store: identityStore }).provisioner;
    const pending = owner.provision('c1'); await started.promise; owner.close('c1'); gate.resolve();
    await assert.rejects(pending, e => e.code === 'identity', stage);
    assert.equal(owner.inspect('c1'), null);
    assert.equal(await store.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH }) !== null,
      stage === 'allocateIdentity');
  }
});

test('replaced frozen auth reference invalidates pending provisioning even for the same account string', async () => {
  const store = createMemoryContributionStore(), gate = deferred(), started = deferred();
  const identityStore = wrap(store, { loadIdentity: async (...args) => {
    started.resolve(); await gate.promise; return store.loadIdentity(...args);
  } });
  const accounts = new Map([['c1', auth(ACCOUNT)]]);
  const owner = provisioner({ store: identityStore, accounts }).provisioner;
  const pending = owner.provision('c1'); await started.promise; accounts.set('c1', auth(ACCOUNT)); gate.resolve();
  await assert.rejects(pending, e => e.code === 'identity');
  assert.equal(owner.inspect('c1'), null);
});

test('malformed durable identity response is rejected without allocating or returning it', async () => {
  let allocations = 0;
  const identityStore = { loadIdentity: async () => ({ binding: { accountId: ACCOUNT, worldId: WORLD,
    worldEpoch: EPOCH, characterId: CHAR }, character: { worldId: 'world:other', worldEpoch: EPOCH,
    characterId: CHAR, version: 1, data: dataFor({ characterId: CHAR }) } }),
    allocateIdentity: async () => { allocations++; throw new Error('must not allocate'); } };
  const owner = provisioner({ store: identityStore }).provisioner;
  await assert.rejects(owner.provision('c1'), e => e.code === 'response');
  assert.equal(owner.inspect('c1'), null);
  assert.equal(allocations, 0);
});

test('anonymous, mutable, or invalid auth subjects are rejected before any identity store access; default factory is fresh', async () => {
  let reads = 0, writes = 0;
  const identityStore = {
    loadIdentity: async () => { reads++; return null; },
    allocateIdentity: async () => { writes++; throw new Error('invalid subject reached allocation'); },
  };
  for (const subject of [null, undefined, { accountId: ACCOUNT }, Object.freeze({ accountId: 'not-a-uuid' })]) {
    const owner = new CharacterProvisioning(identityStore, { worldId: WORLD, worldEpoch: EPOCH,
      resolveIdentity: () => subject, uuid: () => CHAR });
    await assert.rejects(owner.provision('anonymous'), e => e.code === 'identity');
  }
  assert.equal(reads, 0);
  assert.equal(writes, 0);

  const store = createMemoryContributionStore();
  const defaultAuth = auth(ACCOUNT);
  const owner = new CharacterProvisioning(store, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: () => defaultAuth, uuid: () => CHAR });
  const created = await owner.provision('verified');
  assert.equal(created.character.data.pirateId, `character:${CHAR}`);
  assert.deepEqual(created.character.data.eco.pack.goods, {});
  assert.deepEqual(created.character.data.eco.pack, newProfile().eco.pack);
});

test('closed ambiguous allocation recovers by read before a new connection can provision that account', async () => {
  const store = createMemoryContributionStore(); let allocations = 0, lose = true;
  const identityStore = wrap(store, { allocateIdentity: async request => {
    allocations++; const result = await store.allocateIdentity(request);
    if (lose) { lose = false; throw new Error('reply lost after commit'); }
    return result;
  } });
  const accounts = new Map([['old', auth(ACCOUNT)], ['next', auth(ACCOUNT)]]);
  const owner = new CharacterProvisioning(identityStore, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: id => accounts.get(id), uuid: () => CHAR });
  await assert.rejects(owner.provision('old'), e => e.code === 'unavailable');
  owner.close('old');
  await assert.rejects(owner.provision('next'), e => e.code === 'session');
  const recovered = await owner.recover('old');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.identity.binding.characterId, CHAR);
  assert.equal(owner.inspect('old'), null);
  const next = await owner.provision('next');
  assert.equal(next.binding.characterId, CHAR);
  assert.equal(Object.hasOwn(next, 'token'), false);
  assert.equal(allocations, 1);
});

test('recovery cannot return identity to a connection closed or replaced while its read is pending', async () => {
  for (const change of ['close', 'replace']) {
    const store = createMemoryContributionStore(); let lose = true;
    const base = wrap(store, { allocateIdentity: async request => {
      const result = await store.allocateIdentity(request);
      if (lose) { lose = false; throw new Error('reply lost'); }
      return result;
    } });
    const gate = deferred(), started = deferred();
    let pauseReads = false;
    const identityStore = wrap(base, { loadIdentity: async (...args) => {
      const result = await base.loadIdentity(...args);
      if (pauseReads) { started.resolve(); await gate.promise; }
      return result;
    } });
    const accounts = new Map([['c1', auth(ACCOUNT)]]);
    const owner = new CharacterProvisioning(identityStore, { worldId: WORLD, worldEpoch: EPOCH,
      resolveIdentity: id => accounts.get(id), uuid: () => CHAR });
    await assert.rejects(owner.provision('c1'), e => e.code === 'unavailable');
    pauseReads = true;
    const recovery = owner.recover('c1'); await started.promise;
    if (change === 'close') owner.close('c1');
    else accounts.set('c1', auth(ACCOUNT));
    gate.resolve();
    const result = await recovery;
    if (change === 'close') {
      assert.equal(result.ok, true);
      assert.equal(result.identity.binding.characterId, CHAR);
    } else {
      assert.deepEqual(result, { ok: false, why: 'identity' });
      assert.equal(Object.hasOwn(result, 'identity'), false);
    }
  }
});

test('observed auth revocation stays latched until trusted closed recovery confirms and releases the account', async () => {
  const store = createMemoryContributionStore(); let lose = true, allocations = 0;
  const identityStore = wrap(store, { allocateIdentity: async request => {
    allocations++;
    const result = await store.allocateIdentity(request);
    if (lose) { lose = false; throw new Error('reply lost after commit'); }
    return result;
  } });
  const original = auth(ACCOUNT), accounts = new Map([['old', original], ['next', auth(ACCOUNT)]]);
  const owner = new CharacterProvisioning(identityStore, { worldId: WORLD, worldEpoch: EPOCH,
    resolveIdentity: id => accounts.get(id), uuid: () => CHAR });
  await assert.rejects(owner.provision('old'), e => e.code === 'unavailable');

  accounts.set('old', auth(ACCOUNT));
  await assert.rejects(owner.recover('old'), e => e.code === 'identity');
  accounts.set('old', original);
  await assert.rejects(owner.recover('old'), e => e.code === 'identity');

  owner.close('old');
  const recovered = await owner.recover('old');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.identity.binding.characterId, CHAR);
  const next = await owner.provision('next');
  assert.equal(next.binding.characterId, CHAR);
  assert.equal(Object.hasOwn(next, 'token'), false);
  assert.equal(allocations, 1);
});

test('initialized memory binding loads current character and allocation replay cannot reset it', async () => {
  const initial = { worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, version: 1,
    data: dataFor({ characterId: CHAR }) };
  const store = createMemoryContributionStore({ characters: [initial] });
  const binding = { accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR };
  assert.deepEqual(await store.initializeBinding(binding), { ok: true, binding });
  await store.saveCharacter({ ...initial, data: { ...initial.data, gold: 777 } });
  const loaded = await store.loadIdentity({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH });
  assert.equal(loaded.binding.characterId, CHAR);
  assert.equal(loaded.character.version, 2);
  assert.equal(loaded.character.data.gold, 777);
  const replay = await store.allocateIdentity({ binding: { ...binding, characterId: uuid(201) },
    data: dataFor({ characterId: uuid(201) }) });
  assert.equal(replay.binding.characterId, CHAR);
  assert.equal(replay.character.version, 2);
  assert.equal(replay.character.data.gold, 777);
  assert.equal(await store.loadCharacter(WORLD, EPOCH, uuid(201)), null);
});

test('occupied preexisting unbound character cannot be adopted or overwritten', async () => {
  const character = { worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, version: 1, data: dataFor({ characterId: CHAR }) };
  const store = createMemoryContributionStore({ characters: [character] });
  const owner = provisioner({ store });
  await assert.rejects(owner.provisioner.provision('c1'), e => e.code === 'occupied');
  assert.equal(owner.provisioner.inspect('c1'), null);
  assert.equal((await store.loadCharacter(WORLD, EPOCH, CHAR)).data.gold, 123);
});
