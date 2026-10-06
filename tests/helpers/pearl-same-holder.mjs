import assert from 'node:assert/strict';
import { newProfile } from '../../src/sim/systems/inventory.js';

export const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const UID = 'same-holder-pearl';
export const WORLD = 'same-holder:island';
export const op = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const pearl = { uid: UID, kind: 'brasa' };
export const swallow = (raw) => {
  const p = structuredClone(raw);
  p.pearls.bag = p.pearls.bag.filter((q) => q.uid !== UID);
  p.pearls.swallowed = structuredClone(pearl); return p;
};
export async function seed(store, tracked = false) {
  const p = newProfile(); p.gold = 27;
  p.pearls.bag = [{ uid: 'other-z', kind: 'tinta' }, { uid: 'other-a', kind: 'escarcha' }];
  assert.equal((await store.saveProfile(A, p, 0)).ok, true);
  assert.equal((await store.saveProfile(B, newProfile(), 0)).ok, true);
  p.pearls.bag.splice(1, 0, structuredClone(pearl));
  const grant = { operationId: op(1), ...pearl, from: null, to: A, expectedVersion: 0,
    profiles: [{ id: A, expectedVersion: 1, data: p }] };
  assert.equal((await store[tracked ? 'commitPearlGround' : 'commitPearl'](
    tracked ? { ...grant, world: WORLD, ground: null } : grant)).ok, true);
  return p;
}
export const meta = (patch = {}) => ({ operationId: op(2), ...pearl, from: A, to: A,
  expectedVersion: 1, world: WORLD, ground: null, ...patch });
export const request = (p, patch = {}) => ({ ...meta(),
  profiles: [{ id: A, expectedVersion: 2, data: swallow(p) }], ...patch });
export const state = async (store) => ({ profiles: await Promise.all([A, B].map((id) => store.loadProfile(id))),
  unique: await store.loadUnique(UID), location: await store.loadPearlLocation(UID) });

// Exercise the same conservation/CAS/replay contract against memory and the real SDK's local SQL transport.
export async function contract(t, setup) {
  for (const tracked of [false, true]) await t.test(tracked ? 'tracked held tombstone' : 'legacy managed held UID', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store, tracked), wanted = request(p), original = structuredClone(wanted);
      const result = await f.store.commitPearlGround(wanted);
      assert.deepEqual(result, { ok: true, replay: false, profiles: [{ id: A, version: 3 }],
        unique: { uid: UID, kind: 'pearl:brasa', holder: A, version: 2 },
        location: { uid: UID, world: WORLD, ground: null, version: 2 } });
      assert.deepEqual((await f.store.loadProfile(A)).data, swallow(p));
      assert.equal((await f.store.loadProfile(B)).version, 1);
      assert.deepEqual(await f.store.listPearlGround(WORLD), []);
      const receipt = await f.store.loadPearlGroundOperation(op(2));
      const { operationId: _id, ...payload } = original;
      assert.deepEqual(receipt, { request: payload, result });
      assert.equal(await f.store.loadPearlOperation(op(2)), null, 'no invalid 003 child receipt');
      wanted.profiles[0].data.gold = 999;
      assert.deepEqual((await f.store.loadProfile(A)).data, swallow(p), 'detached request');
      const before = await state(f.store);
      assert.deepEqual(await f.store.commitPearlGround(original), { ...result, replay: true });
      assert.deepEqual(await state(f.store), before);
      assert.deepEqual(await f.store.commitPearlGround({ ...original, world: 'other-world' }), { ok: false, why: 'operation' });
      assert.deepEqual(await f.store.commitPearlGround({ ...original, operationId: op(1) }), { ok: false, why: 'operation' }, '003 grant or completed 004 grant owns that UUID');
      const legacyCollision = { ...original, from: A, to: B,
        profiles: [{ id: A, expectedVersion: 3, data: { ...swallow(p), pearls: { ...p.pearls, bag: p.pearls.bag.filter((q) => q.uid !== UID), swallowed: null } } },
          { id: B, expectedVersion: 1, data: { ...newProfile(), pearls: { bag: [pearl], swallowed: null } } }] };
      assert.deepEqual(await f.store.commitPearl(legacyCollision), { ok: false, why: 'operation' });
      assert.deepEqual(await state(f.store), before);
      // The old receipt is historical after ordinary progress or a later managed transfer.
      const progress = swallow(p); progress.xp = 9;
      assert.equal((await f.store.saveProfile(A, progress, 3)).ok, true);
      const empty = structuredClone(progress); empty.pearls.swallowed = null;
      assert.equal((await f.store.commitPearlGround({ ...meta({ operationId: op(3), to: B, expectedVersion: 2 }),
        profiles: [{ id: A, expectedVersion: 4, data: empty },
          { id: B, expectedVersion: 1, data: { ...newProfile(), pearls: { swallowed: null, bag: [pearl] } } }] })).ok, true);
      const advanced = await state(f.store);
      assert.equal((await f.store.commitPearlGround(original)).replay, true);
      assert.deepEqual(await state(f.store), advanced);
    } finally { await f.close?.(); }
  });
  for (const [name, code, change] of [
    ['stale profile', 'conflict', (r) => { r.profiles[0].expectedVersion = 1; }],
    ['stale UID', 'conflict', (r) => { r.expectedVersion = 2; }],
    ['wrong kind', 'kind', (r) => { r.kind = 'tinta'; r.profiles[0].data.pearls.swallowed.kind = 'tinta'; }],
    ['wrong kind with stale UID', 'kind', (r) => { r.kind = 'tinta'; r.expectedVersion = 99; r.profiles[0].data.pearls.swallowed.kind = 'tinta'; }],
    ['different world', 'ownership', (r) => { r.world = 'other-world'; }],
    ['gold credit', 'ownership', (r) => { r.profiles[0].data.gold++; }],
    ['progress edit', 'ownership', (r) => { r.profiles[0].data.xp++; }],
    ['bag reorder', 'ownership', (r) => { r.profiles[0].data.pearls.bag.reverse(); }],
    ['other pearl removed', 'ownership', (r) => { r.profiles[0].data.pearls.bag.pop(); }],
    ['other pearl moved', 'ownership', (r) => { r.profiles[0].data.pearls.bag[0].kind = 'tormenta'; }],
    ['different owner', 'conflict', (r) => { r.from = B; r.to = B; r.profiles[0].id = B; r.profiles[0].expectedVersion = 1; }],
  ]) await t.test(name, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store, true), raw = request(p); change(raw);
      const before = await state(f.store);
      assert.deepEqual(await f.store.commitPearlGround(raw), { ok: false, why: code });
      assert.deepEqual(await state(f.store), before);
      assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
    } finally { await f.close?.(); }
  });
  await t.test('unregistered pearl is not adopted', async () => {
    const f = await setup();
    try {
      const p = newProfile(); p.pearls.bag = [pearl];
      await f.store.saveProfile(A, p, 0);
      const raw = request(p); raw.profiles[0].expectedVersion = 1;
      const before = await state(f.store);
      assert.deepEqual(await f.store.commitPearlGround(raw), { ok: false, why: 'conflict' });
      assert.deepEqual(await state(f.store), before);
      assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
    } finally { await f.close?.(); }
  });
}
