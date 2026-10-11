import test from 'node:test';
import assert from 'node:assert/strict';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture() {
  const store = createMemoryStore(), journal = createMemoryPearlJournals(store)('startup:test');
  const sessions = new ProfileSessions(store, null, { journal });
  return { sessions, gate: pearlMutationGate(sessions) };
}

test('recovery capability crosses journal readiness without opening any gameplay or snapshot lane', async () => {
  const { sessions, gate } = fixture(), handle = gate.beginRecovery();
  assert.equal(Object.isFrozen(handle), true);
  assert.throws(() => gate.beginHydration(handle), { code: 'recovery' });
  assert.throws(() => gate.releaseHydration(handle), { code: 'operation' });
  assert.throws(() => gate.assertStorageAuthorized({ uids: ['not-yet-scanned'] }), { code: 'busy' });
  assert.throws(() => gate.assertSnapshotAvailable({ accounts: [account] }), { code: 'busy' });
  await sessions.recoverPearls();
  assert.throws(() => gate.reserve({ accounts: [account] }), { code: 'busy' });
  assert.equal(gate.beginHydration(handle), handle);
  assert.throws(() => gate.assertRecovery(handle), { code: 'operation' });
  assert.throws(() => gate.beginHydration(handle), { code: 'operation' });
  gate.releaseHydration(handle);
  gate.assertAvailable({ accounts: [account], uids: ['not-yet-scanned'] });
  assert.throws(() => gate.beginHydration(handle), { code: 'operation' });
});

test('copied and foreign recovery capabilities cannot transfer or release the startup barrier', async () => {
  const { sessions, gate } = fixture(), other = fixture().gate, handle = gate.beginRecovery();
  await sessions.recoverPearls();
  for (const fake of [{ ...handle }, {}, 'token', false]) {
    assert.throws(() => gate.beginHydration(fake), { code: 'operation' });
  }
  assert.throws(() => other.beginHydration(handle), { code: 'operation' });
  assert.throws(() => gate.beginRecovery(), { code: 'busy' });
  assert.throws(() => gate.beginHydration(), { code: 'busy' });
  gate.assertRecovery(handle);
  gate.fenceHydration(handle);
  assert.throws(() => gate.assertRecovery(handle), { code: 'cancelled' });
  assert.throws(() => gate.beginHydration(handle), { code: 'cancelled' });
  assert.throws(() => gate.beginRecovery(), { code: 'busy' });
});

for (const resource of ['accounts', 'clients', 'tasks', 'uids', 'operationIds', 'unresolved', 'accountIds']) {
  test(`recovery cannot acquire global ownership with existing ${resource}`, async () => {
    const { sessions, gate } = fixture(), collection = sessions[resource] ?? sessions.pearls[resource];
    if (collection instanceof Set) collection.add({}); else collection.set('existing', {});
    assert.throws(() => gate.beginRecovery(), { code: 'busy' });
    collection.clear();
    const handle = gate.beginRecovery();
    await sessions.recoverPearls();
    gate.beginHydration(handle); gate.releaseHydration(handle);
  });
}

test('recovery and hydration cannot displace an existing gameplay reservation', async () => {
  const { sessions, gate } = fixture(); await sessions.recoverPearls();
  const held = gate.reserve({ accounts: [account], uids: ['held-pearl'] });
  assert.throws(() => gate.beginRecovery(), { code: 'busy' });
  assert.throws(() => gate.beginHydration(), { code: 'busy' });
  assert.equal(gate.active(held), true);
  gate.release(held);
  const recovery = gate.beginRecovery(); gate.beginHydration(recovery); gate.releaseHydration(recovery);
});
