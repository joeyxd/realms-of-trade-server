import assert from 'node:assert/strict';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { batchOperation, batchResult } from '../../server/pearlBatch.mjs';

export const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const WORLD = 'batch:island';
export const op = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const pearls = [
  { uid: 'batch-a', kind: 'brasa' }, { uid: 'batch-b', kind: 'escarcha' },
  { uid: 'batch-c', kind: 'tormenta' }, { uid: 'batch-d', kind: 'tinta' },
];
export const ground = (i) => ({ x: i + 0.5, z: -i - 1, availableAt: 30, returnAt: 5400 });
export async function seed(store, tracked = true, count = 4) {
  const p = newProfile(); p.pirateId = `account:${A}`; p.gold = 37; p.xp = 21; p.mast[0] = [3, 123];
  p.stats.kills = 17;
  await store.saveProfile(A, p, 0); await store.saveProfile(B, newProfile(), 0);
  for (let i = 0; i < count; i++) {
    p.pearls.bag.push(pearls[i]);
    const raw = { operationId: op(i + 1), ...pearls[i], from: null, to: A, expectedVersion: 0,
      profiles: [{ id: A, expectedVersion: i + 1, data: p }] };
    assert.equal((await store[tracked ? 'commitPearlGround' : 'commitPearl'](
      tracked ? { ...raw, world: WORLD, ground: null } : raw)).ok, true);
  }
  // Ordinary profile save retains ownership and arranges the existing swallowed slot.
  p.pearls.swallowed = p.pearls.bag.pop();
  if (count > 1) p.pearls.bag.reverse();
  assert.equal((await store.saveProfile(A, p, count + 1)).ok, true);
  return { data: p, version: count + 2 };
}
export function request(p, mode = 'death', operationId = op(20)) {
  const data = structuredClone(p.data), selected = mode === 'death' ?
    [...data.pearls.bag, data.pearls.swallowed] : [data.pearls.bag[1], data.pearls.swallowed];
  const incoming = mode === 'replace' ? data.pearls.bag[1] : null;
  if (incoming) {
    data.pearls.bag = data.pearls.bag.filter((q) => q.uid !== incoming.uid);
    data.pearls.swallowed = incoming;
  } else data.pearls = { swallowed: null, bag: [] };
  const items = selected.sort((a,b) => a.uid < b.uid ? -1 : 1).map((q,i) => ({ ...q, expectedVersion: 1,
    ground: q.uid === incoming?.uid ? null : ground(i) }));
  return { operationId, world: WORLD, mode, profile: { id: A, expectedVersion: p.version, data }, items };
}
export const state = async (s) => ({ profiles: await Promise.all([A,B].map((id) => s.loadProfile(id))),
  uniques: await Promise.all(pearls.map((q) => s.loadUnique(q.uid))),
  locations: await Promise.all(pearls.map((q) => s.loadPearlLocation(q.uid))) });
export async function contract(t, setup) {
  for (const mode of ['death','replace']) for (const tracked of [true,false]) await t.test(`${mode}: ${tracked ? 'tracked' : 'legacy'} managed UIDs`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store, tracked), raw = request(p, mode), original = structuredClone(raw);
      const { request: payload } = batchOperation(raw), expected = batchResult(payload);
      assert.deepEqual(await f.store.commitPearlBatch(raw), expected);
      assert.deepEqual(await f.store.loadPearlBatchOperation(raw.operationId), { request: payload, result: expected });
      assert.equal(await f.store.loadPearlOperation(raw.operationId), null);
      assert.equal(await f.store.loadPearlGroundOperation(raw.operationId), null);
      assert.deepEqual((await f.store.loadProfile(A)).data, raw.profile.data);
      assert.equal((await f.store.loadProfile(A)).version, p.version + 1);
      assert.equal((await f.store.loadProfile(B)).version, 1);
      for (const q of raw.items) {
        assert.deepEqual(await f.store.loadUnique(q.uid), { kind: `pearl:${q.kind}`,
          holder: q.ground === null ? A : null, version: 2 });
        assert.deepEqual(await f.store.loadPearlLocation(q.uid), { world: WORLD, ground: q.ground, version: 2 });
      }
      for (const q of pearls.filter((q) => !raw.items.some((i) => i.uid === q.uid))) {
        assert.equal((await f.store.loadUnique(q.uid)).version, 1);
        assert.deepEqual(await f.store.loadPearlLocation(q.uid), tracked ? { world: WORLD, ground: null, version: 1 } : null);
      }
      assert.deepEqual((await f.store.listPearlGround(WORLD)).map((q) => q.uid), raw.items.filter((q) => q.ground !== null).map((q) => q.uid));
      raw.profile.data.xp = 999; raw.items[0].expectedVersion = 99;
      const before = await state(f.store);
      assert.deepEqual(await f.store.commitPearlBatch(original), { ...expected, replay: true });
      assert.deepEqual(await state(f.store), before);
      const changed = structuredClone(original); changed.items.find((q) => q.ground).ground.x++;
      assert.deepEqual(await f.store.commitPearlBatch(changed), { ok: false, why: 'operation' });
      const progress = structuredClone(original.profile.data); progress.xp += 11;
      assert.equal((await f.store.saveProfile(A, progress, p.version + 1)).ok, true);
      const advanced = await state(f.store);
      assert.equal((await f.store.commitPearlBatch(original)).replay, true);
      assert.deepEqual(await state(f.store), advanced, 'historical receipt cannot roll back later progress');
      // Shared UUID exclusivity works in both directions, including 004's provisional 003 child.
      assert.deepEqual(await f.store.commitPearlBatch({ ...original, operationId: op(1) }), { ok: false, why: 'operation' });
      const legacy = { operationId: original.operationId, ...pearls[0], from: A, to: B, expectedVersion: 1,
        profiles: [{ id: A, expectedVersion: p.version, data: p.data },
          { id: B, expectedVersion: 1, data: newProfile() }] };
      assert.deepEqual(await f.store.commitPearl(legacy), { ok: false, why: 'operation' });
      assert.deepEqual(await f.store.commitPearlGround({ ...legacy, world: WORLD, ground: null }), { ok: false, why: 'operation' });
      assert.deepEqual(await state(f.store), advanced);
      const dropped = original.items.find((q) => q.ground !== null), recipient = (await f.store.loadProfile(B)).data;
      recipient.pearls.bag.push({ uid: dropped.uid, kind: dropped.kind });
      assert.equal((await f.store.commitPearlGround({ operationId: op(21), uid: dropped.uid, kind: dropped.kind,
        from: null, to: B, expectedVersion: 2, world: WORLD, ground: null,
        profiles: [{ id: B, expectedVersion: 1, data: recipient }] })).ok, true);
      const picked = await state(f.store);
      assert.equal((await f.store.commitPearlBatch(original)).replay, true);
      assert.deepEqual(await state(f.store), picked, 'historical batch cannot resurrect a pearl picked up later');
    } finally { await f.close?.(); }
  });
  for (const mode of ['death','replace']) for (const [name, why, change] of [
    ['stale profile','conflict', (r) => r.profile.expectedVersion--],
    ['one stale UID','conflict', (r) => r.items.at(-1).expectedVersion++],
    ['wrong owner','conflict', (r) => { r.profile.id = B; r.profile.expectedVersion = 1; }],
    ['one wrong kind','kind', (r) => { r.items.at(-1).kind = 'brasa'; }],
    ['wrong world','ownership', (r) => { r.world = 'wrong:island'; }],
    ['gold edit','ownership', (r) => r.profile.data.gold++],
    ['XP edit','ownership', (r) => r.profile.data.xp++],
    ['mastery edit','ownership', (r) => r.profile.data.mast[0][1]++],
    ['quest edit','ownership', (r) => { r.profile.data.quests.unknown = [1,2]; }],
  ]) await t.test(`${mode}: ${name} rolls everything back`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), r = request(p, mode), before = await state(f.store); change(r);
      assert.deepEqual(await f.store.commitPearlBatch(r), { ok: false, why });
      assert.deepEqual(await state(f.store), before);
      assert.equal(await f.store.loadPearlBatchOperation(r.operationId), null);
    } finally { await f.close?.(); }
  });
  await t.test('death of a single swallowed managed pearl is a one-profile, one-UID batch', async () => {
    const f = await setup();
    try { const p = await seed(f.store, true, 1); assert.equal((await f.store.commitPearlBatch(request(p))).ok, true); }
    finally { await f.close?.(); }
  });
  await t.test('unmanaged UID is refused rather than adopted or partially spilled', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), extra = { uid: 'batch-unmanaged', kind: 'brasa' };
      p.data.pearls.bag.push(extra); await f.store.saveProfile(A, p.data, p.version++);
      const raw = request(p), before = await state(f.store);
      assert.deepEqual(await f.store.commitPearlBatch(raw), { ok: false, why: 'conflict' });
      assert.deepEqual(await state(f.store), before); assert.equal(await f.store.loadUnique(extra.uid), null);
    } finally { await f.close?.(); }
  });
}
