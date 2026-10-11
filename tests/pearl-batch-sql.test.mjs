import test from 'node:test';
import assert from 'node:assert/strict';
import { batchResult, batchOperation } from '../server/pearlBatch.mjs';
import { database, adapters } from './helpers/pearl-batch-sql.mjs';
import { contract, seed, request, state, A, B, WORLD, op, pearls, ground } from './helpers/pearl-batch.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const commit = async (db, raw) => {
  const { operationId, ...payload } = raw;
  return (await db.query('select public.mn_commit_pearl_batch($1::uuid,$2::jsonb) as data', [operationId,payload])).rows[0].data;
};
test('SQL007 SDK implements atomic death/replacement and preserves 003/004 receipt families', (t) => contract(t, database));

test('SQL007 direct RPC validates exact bounded metadata with no partial writes', async (t) => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), before = await state(f.store);
    for (const [name, change] of [
      ['empty', (r) => { r.items = []; }], ['null items', (r) => { r.items = null; }],
      ['duplicate', (r) => { r.items[1] = r.items[0]; }], ['unsorted', (r) => r.items.reverse()],
      ['too many', (r) => { r.items = Array.from({ length: 10 }, (_,i) => ({ ...r.items[0], uid: `p-${i}` })); }],
      ['missing request field', (r) => { delete r.mode; }], ['extra request key', (r) => { r.extra = true; }],
      ['missing item field', (r) => { delete r.items[0].ground; }], ['extra item key', (r) => { r.items[0].extra = true; }],
      ['string generation', (r) => { r.items[0].expectedVersion = '1'; }],
      ['fractional UID generation', (r) => { r.items[0].expectedVersion = 1.5; }],
      ['zero UID generation', (r) => { r.items[0].expectedVersion = 0; }],
      ['overflow UID generation', (r) => { r.items[0].expectedVersion = 2147483647; }],
      ['fractional profile version', (r) => { r.profile.expectedVersion = 1.5; }],
      ['overflow profile version', (r) => { r.profile.expectedVersion = 2147483647; }],
      ['invalid mode', (r) => { r.mode = 'mint'; }], ['invalid world', (r) => { r.world = ''; }],
      ['invalid UUID', (r) => { r.profile.id = 'broken'; }], ['noncanonical UUID', (r) => { r.profile.id = A.toUpperCase(); }],
      ['extra profile key', (r) => { r.profile.secondId = B; }],
      ['invalid pearl kind', (r) => { r.items[0].kind = 'fire'; }], ['invalid UID', (r) => { r.items[0].uid = '?'; }],
      ['ground equal times', (r) => { r.items[0].ground.returnAt = 30; }],
      ['ground fractional time', (r) => { r.items[0].ground.availableAt = 1.1; }],
      ['ground unsafe time', (r) => { r.items[0].ground.returnAt = 9007199254740992; }],
      ['ground large coordinate', (r) => { r.items[0].ground.x = 1000001; }],
      ['ground extra key', (r) => { r.items[0].ground.extra = 1; }],
      ['death held item', (r) => { r.items[0].ground = null; }],
      ['replace too many items', (r) => { r.mode = 'replace'; r.items[0].ground = null; }],
      ['replace no held item', (r) => { r.mode = 'replace'; r.items = r.items.slice(0,2); }],
      ['replace two held items', (r) => { r.mode = 'replace'; r.items = r.items.slice(0,2); r.items.forEach((q) => { q.ground = null; }); }],
      ['oversized profile', (r) => { r.profile.data.padding = 'a'.repeat(131072); }],
    ]) await t.test(name, async () => {
      const bad = structuredClone(raw); change(bad);
      assert.deepEqual(await commit(f.db,bad), { ok: false, why: 'operation' });
      assert.deepEqual(await state(f.store), before); assert.equal(await f.store.loadPearlBatchOperation(op(20)), null);
    });
    assert.deepEqual(await commit(f.db,{ ...raw, operationId: null }), { ok: false, why: 'operation' });
  } finally { await f.close(); }
});

test('SQL007 conserves the exact selected set, slot order and all non-pearl fields', async (t) => {
  const f = await database();
  try {
    const p = await seed(f.store), before = await state(f.store);
    for (const [name, mode, change] of [
      ['partial death','death', (r) => r.items.pop()],
      ['death keeps swallowed','death', (r) => { r.profile.data.pearls.swallowed = p.data.pearls.swallowed; }],
      ['death added UID','death', (r) => { r.profile.data.pearls.bag.push(pearls[0]); }],
      ['profile field removed','death', (r) => { delete r.profile.data.stats; }],
      ['profile field added','death', (r) => { r.profile.data.affinity = { brasa: 100 }; }],
      ['replacement no-op','replace', (r) => { r.profile.data = p.data; }],
      ['replacement swaps sources','replace', (r) => { r.items[0].ground = r.items[1].ground; r.items[1].ground = null; }],
      ['replacement reorders other bag','replace', (r) => r.profile.data.pearls.bag.reverse()],
      ['replacement removes other bag','replace', (r) => r.profile.data.pearls.bag.pop()],
      ['replacement changes unrelated pearl','replace', (r) => { r.profile.data.pearls.bag[0].kind = 'tinta'; }],
    ]) await t.test(name, async () => {
      const r = request(p,mode); change(r);
      assert.deepEqual(await commit(f.db,r), { ok: false, why: 'ownership' });
      assert.deepEqual(await state(f.store), before); assert.equal(await f.store.loadPearlBatchOperation(op(20)), null);
    });
    // Storage must conserve future character learning too. Raw SQL here deliberately bypasses the
    // current sanitizer; this verifies full JSON conservation, not an implemented affinity schema.
    const richer = structuredClone(p.data); richer.affinity = { brasa: { xp: 333 }, escarcha: { xp: 88 } };
    await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid',[richer,A]);
    const raw = request({ ...p, data: richer },'replace');
    assert.equal((await commit(f.db,raw)).ok,true);
    const after = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid',[A])).rows[0].data;
    assert.deepEqual(after.affinity,richer.affinity);
    const death = request({ data:after,version:p.version+1 },'death',op(21));
    for (const q of death.items) q.expectedVersion = q.uid === raw.items.find((i) => i.ground === null).uid ? 2 : 1;
    assert.equal((await commit(f.db,death)).ok,true);
    const spilled = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid',[A])).rows[0].data;
    assert.deepEqual(spilled.affinity,richer.affinity,'death also preserves future learning outside pearls');
  } finally { await f.close(); }
});

test('SQL007 maximum nine-UID death uses each independent generation and leaves zero pearls', async () => {
  const f = await database();
  try {
    const p = newProfile(); await f.store.saveProfile(A,p,0);
    for (let i = 0; i < 9; i++) {
      const pearl = { uid:`max-${i}`,kind:pearls[i%4].kind };
      if (i === 8) p.pearls.swallowed = pearl; else p.pearls.bag.push(pearl);
      assert.equal((await f.store.commitPearlGround({ operationId:op(i+1),...pearl,from:null,to:A,
        expectedVersion:0,world:WORLD,ground:null,profiles:[{ id:A,expectedVersion:i+1,data:p }] })).ok,true);
    }
    // Replace and reacquire the old pearl so a full inventory contains generations 1, 2 and 3.
    const target = p.pearls.bag[0], older = p.pearls.swallowed;
    const replacement = structuredClone(p); replacement.pearls.bag.shift(); replacement.pearls.swallowed = target;
    assert.equal((await f.store.commitPearlBatch({ operationId:op(20),world:WORLD,mode:'replace',
      profile:{ id:A,expectedVersion:10,data:replacement },items:[
        { ...target,expectedVersion:1,ground:null },{ ...older,expectedVersion:1,ground:ground(8) },
      ] })).ok,true);
    replacement.pearls.bag.push(older);
    assert.equal((await f.store.commitPearlGround({ operationId:op(21),...older,from:null,to:A,expectedVersion:2,
      world:WORLD,ground:null,profiles:[{ id:A,expectedVersion:11,data:replacement }] })).ok,true);
    const original = (await f.store.loadProfile(A)).data;
    const after = structuredClone(original); after.pearls = { bag:[],swallowed:null };
    const raw = { operationId:op(22),world:WORLD,mode:'death',profile:{ id:A,expectedVersion:12,data:after },
      items:[...original.pearls.bag,original.pearls.swallowed].sort((a,b) => a.uid < b.uid ? -1:1)
        .map((q,i) => ({ ...q,expectedVersion:q.uid === target.uid ? 2:q.uid === older.uid ? 3:1,ground:ground(i) })) };
    const result = await f.store.commitPearlBatch(raw); assert.equal(result.ok,true); assert.equal(result.uniques.length,9);
    assert.equal((await f.store.loadProfile(A)).version,13); assert.equal((await f.store.listPearlGround(WORLD)).length,9);
    for (const q of raw.items) assert.equal((await f.store.loadUnique(q.uid)).version,q.expectedVersion+1);
  } finally { await f.close(); }
});

test('SQL007 rejects late writes atomically after earlier UIDs and locations have changed', async (t) => {
  for (const table of ['mn_profiles','mn_unique_items','mn_pearl_locations','mn_pearl_batch_operations']) await t.test(table, async () => {
    const f = await database();
    try {
      const p = await seed(f.store), raw = request(p), before = await state(f.store);
      const condition = table === 'mn_profiles' ? 'true' : table === 'mn_pearl_batch_operations' ?
        'NEW.result IS NOT NULL' : "NEW.uid = 'batch-d'";
      await f.db.exec(`RESET ROLE;
        CREATE FUNCTION public.mn_test_batch_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF ${condition} THEN RAISE EXCEPTION 'late failure' USING ERRCODE='MNP01'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER mn_test_batch_failure BEFORE INSERT OR UPDATE ON public.${table}
          FOR EACH ROW EXECUTE FUNCTION public.mn_test_batch_failure(); SET ROLE service_role;`);
      assert.deepEqual(await commit(f.db,raw), { ok: false, why: 'ownership' });
      assert.deepEqual(await state(f.store),before); assert.equal(await f.store.loadPearlBatchOperation(op(20)),null);
      await f.db.exec(`RESET ROLE; DROP TRIGGER mn_test_batch_failure ON public.${table};
        DROP FUNCTION public.mn_test_batch_failure(); SET ROLE service_role;`);
      assert.equal((await f.store.commitPearlBatch(raw)).ok,true,'failed provisional receipt leaves the same UUID retryable');
    } finally { await f.close(); }
  });
});

test('SQL007 service-only boundary and shared UUIDs include the existing intent journal', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), before = await state(f.store);
    for (const role of ['anon','authenticated']) {
      await f.db.exec(`RESET ROLE; SET ROLE ${role};`);
      await assert.rejects(commit(f.db,raw),{ code:'42501' });
      await assert.rejects(f.db.query('select public.mn_load_pearl_batch_operation($1::uuid)',[op(20)]),{ code:'42501' });
      await assert.rejects(f.db.query('select public.mn_valid_pearl_batch($1::jsonb)',[{ ...raw, operationId:undefined }]),{ code:'42501' });
      await assert.rejects(f.db.query('select * from public.mn_pearl_batch_operations'),{ code:'42501' });
    }
    await f.db.exec('RESET ROLE; SET ROLE service_role; BEGIN ISOLATION LEVEL SERIALIZABLE;');
    assert.deepEqual(await commit(f.db,raw),{ ok:false,why:'operation' }); await f.db.exec('ROLLBACK; SET ROLE service_role;');
    assert.deepEqual(await state(f.store),before);
    const journalRequest = { ...pearls[0], from:A,to:null,expectedVersion:1,
      profiles:[{ id:A,expectedVersion:p.version,data:p.data }],world:WORLD,
      ground:{ x:1,z:2,availableAt:30,returnAt:100 } };
    await f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',[WORLD,'ground',op(30),journalRequest]);
    assert.deepEqual(await commit(f.db,{ ...raw,operationId:op(30) }),{ ok:false,why:'operation' });
    assert.equal((await f.store.commitPearlBatch(raw)).ok,true);
    await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
      [WORLD,'ground',op(20),journalRequest]),{ code:'MNP02' });
    for (const table of ['mn_pearl_operations','mn_pearl_ground_operations']) {
      await assert.rejects(f.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,$2::jsonb)`,
        [op(20),journalRequest]),{ code:'MNP02' });
    }
  } finally { await f.close(); }
});

test('SQL007 SDK resolves a lost reply by read-only receipt and exact replay in a new adapter', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p,'replace');
    const since = (await f.db.query('select uid,since from public.mn_unique_items order by uid')).rows;
    f.loseNextReply(); await assert.rejects(f.store.commitPearlBatch(raw),{ code:'unavailable' });
    const fresh = adapters(f.db), { request: payload } = batchOperation(raw), wanted = batchResult(payload);
    assert.deepEqual(await fresh.store.loadPearlBatchOperation(op(20)),{ request:payload,result:wanted });
    assert.equal(fresh.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length,0);
    const before = await state(fresh.store);
    assert.deepEqual(await fresh.store.commitPearlBatch(raw),{ ...wanted,replay:true });
    assert.deepEqual(await state(fresh.store),before);
    const afterSince = (await f.db.query('select uid,since from public.mn_unique_items order by uid')).rows;
    for (const q of since) assert.deepEqual(afterSince.find((v) => v.uid === q.uid).since,
      raw.items.some((i) => i.uid === q.uid && i.ground !== null) ? null : q.since);
    fresh.corrupt((name,data) => name === 'mn_load_pearl_batch_operation' ? { ...data,result:{ ...data.result,locations:[] } } : data);
    await assert.rejects(fresh.store.loadPearlBatchOperation(op(20)),{ code:'response' });
  } finally { await f.close(); }
});
