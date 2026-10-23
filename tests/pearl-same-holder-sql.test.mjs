import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { database } from './helpers/pearl-same-holder-sql.mjs';
import { A, B, UID, WORLD, op, pearl, seed, request, state, contract } from './helpers/pearl-same-holder.mjs';

const commit = async (db, raw) => {
  const { operationId, ...payload } = raw;
  return (await db.query('select public.mn_commit_pearl_ground($1::uuid,$2::jsonb) as data', [operationId, payload])).rows[0].data;
};
test('SQL006 SDK implements exact same-holder CAS, conservation and receipt replay', (t) => contract(t, database));

test('SQL006 direct service RPC rejects malformed and out-of-scope same-holder requests with no writes', async (t) => {
  const f = await database();
  try {
    const p = await seed(f.store, true), raw = request(p), before = await state(f.store);
    const since = (await f.db.query('select since from public.mn_unique_items where uid=$1', [UID])).rows[0].since;
    for (const [name, change] of [
      ['duplicate profile', (r) => { r.profiles.push(structuredClone(r.profiles[0])); }],
      ['wrong profile account', (r) => { r.profiles[0].id = B; }],
      ['extra request key', (r) => { r.fake = true; }],
      ['fractional UID version', (r) => { r.expectedVersion = 1.4; }],
      ['fractional profile version', (r) => { r.profiles[0].expectedVersion = 2.1; }],
      ['zero UID version', (r) => { r.expectedVersion = 0; }],
      ['profile overflow', (r) => { r.profiles[0].expectedVersion = 2147483647; }],
      ['UID overflow', (r) => { r.expectedVersion = 2147483647; }],
      ['null holder', (r) => { r.to = null; }],
      ['invalid holder UUID', (r) => { r.from = r.to = 'broken'; }],
      ['ground payload', (r) => { r.ground = { x: 1, z: 1, availableAt: 1, returnAt: 2 }; }],
    ]) await t.test(name, async () => {
      const bad = structuredClone(raw); change(bad);
      assert.deepEqual(await commit(f.db, bad), { ok: false, why: 'operation' });
      assert.deepEqual(await state(f.store), before);
      assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
    });
    for (const [name, change] of [
      ['no-op', (r) => { r.profiles[0].data = structuredClone(p); }],
      ['duplicate target', (r) => { r.profiles[0].data.pearls.bag.push(pearl); }],
      ['remove unrelated UID', (r) => { r.profiles[0].data.pearls.bag.pop(); }],
      ['reorder bag', (r) => { r.profiles[0].data.pearls.bag.reverse(); }],
      ['gold edit', (r) => { r.profiles[0].data.gold++; }],
      ['profile edit', (r) => { r.profiles[0].data.xp++; }],
    ]) await t.test(name, async () => {
      const bad = structuredClone(raw); change(bad);
      assert.deepEqual(await commit(f.db, bad), { ok: false, why: 'ownership' });
      assert.deepEqual(await state(f.store), before);
      assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
    });
    const accepted = await commit(f.db, raw); assert.equal(accepted.ok, true);
    assert.deepEqual((await f.db.query('select since from public.mn_unique_items where uid=$1', [UID])).rows[0].since, since);
    assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id=$1::uuid', [op(2)])).rows[0].n, 0);
  } finally { await f.close(); }
});

test('SQL006 refuses replacement and already-swallowed no-op; ordinary profile CAS remains ownership-only', async () => {
  const f = await database();
  try {
    const p = await seed(f.store, true);
    p.pearls.swallowed = p.pearls.bag.pop();
    assert.equal((await f.store.saveProfile(A, p, 2)).ok, true);
    const before = await state(f.store), raw = request(p); raw.profiles[0].expectedVersion = 3;
    assert.deepEqual(await commit(f.db, raw), { ok: false, why: 'ownership' });
    assert.deepEqual(await state(f.store), before);
    // Legacy save can still perform a layout edit, but it does not create an operation receipt.
    const layout = request(p).profiles[0].data;
    layout.pearls.bag.push(p.pearls.swallowed);
    assert.equal((await f.store.saveProfile(A, layout, 3)).ok, true);
    const swallowed = await state(f.store), noop = { ...raw, profiles: [{ id: A, expectedVersion: 4, data: layout }] };
    assert.deepEqual(await commit(f.db, noop), { ok: false, why: 'ownership' });
    assert.deepEqual(await state(f.store), swallowed);
    assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
  } finally { await f.close(); }
});

test('SQL006 late location failure rolls profile, ledger, location and receipt back together', async () => {
  const f = await database();
  try {
    const p = await seed(f.store, true), raw = request(p), before = await state(f.store);
    await f.journal.prepare('ground', raw);
    await f.db.exec(`RESET ROLE;
      CREATE FUNCTION public.mn_test_reject_location() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test late failure' USING ERRCODE='MNP01'; END $$;
      CREATE TRIGGER mn_test_reject_location BEFORE INSERT OR UPDATE ON public.mn_pearl_locations
        FOR EACH ROW EXECUTE FUNCTION public.mn_test_reject_location(); SET ROLE service_role;`);
    assert.deepEqual(await commit(f.db, raw), { ok: false, why: 'ownership' });
    assert.deepEqual(await state(f.store), before);
    assert.equal(await f.store.loadPearlGroundOperation(op(2)), null);
    assert.equal((await f.journal.list())[0].state, 'pending', 'journal prepare is a separate transaction');
    await f.db.exec('RESET ROLE; DROP TRIGGER mn_test_reject_location ON public.mn_pearl_locations; DROP FUNCTION public.mn_test_reject_location(); SET ROLE service_role;');
    assert.equal((await commit(f.db, raw)).ok, true);
  } finally { await f.close(); }
});

test('SQL006 remains service-only, uses READ COMMITTED and preserves deferred ownership guards', async () => {
  const f = await database();
  try {
    const p = await seed(f.store, true), raw = request(p), before = await state(f.store);
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`RESET ROLE; SET ROLE ${role};`);
      await assert.rejects(commit(f.db, raw), { code: '42501' });
      await assert.rejects(f.db.query('select public.mn_valid_pearl_swallow($1::jsonb,$2::jsonb,$3,$4)',
        [p, raw.profiles[0].data, UID, 'brasa']), { code: '42501' });
      await assert.rejects(f.db.query('select * from public.mn_pearl_ground_operations'), { code: '42501' });
      await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
        [WORLD, 'ground', op(2), { ...raw, operationId: undefined }]), { code: '42501' });
    }
    await f.db.exec('RESET ROLE; SET ROLE service_role;');
    assert.deepEqual(await state(f.store), before);
    await f.db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE;');
    assert.deepEqual(await commit(f.db, raw), { ok: false, why: 'operation' });
    await f.db.exec('ROLLBACK;');
    const broken = structuredClone(p); broken.pearls.bag = broken.pearls.bag.filter((q) => q.uid !== UID);
    await assert.rejects(f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [broken, A]), { code: 'MNP01' });
    assert.deepEqual(await state(f.store), before);
    assert.equal((await commit(f.db, raw)).ok, true);
  } finally { await f.close(); }
});

test('SQL006 SDK sessions journal and read-only recovery settle one frozen same-holder receipt', async () => {
  const f = await database();
  try {
    const p = await seed(f.store, true), concrete = request(p);
    await f.journal.prepare('ground', concrete);
    assert.equal((await f.store.commitPearlGround(concrete)).ok, true);
    f.calls.length = 0;
    const sessions = new ProfileSessions(f.store, null, { journal: f.journal });
    assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(2), outcome: 'committed' }]);
    assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length, 0);
    const loaded = await sessions.open(7, A);
    assert.equal(loaded.pearls.swallowed.uid, UID); assert.equal(loaded.gold, 27);
    assert.deepEqual(await f.journal.list(), []);
    assert.equal(sessions.pearls.accountIds.size, 0);
    assert.equal(sessions.pearls.uids.size, 0); await sessions.flush();
  } finally { await f.close(); }
});
