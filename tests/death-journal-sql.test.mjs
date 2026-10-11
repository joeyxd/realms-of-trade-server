import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/death-journal-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, deathOp, WORLD } from './helpers/death-storage.mjs';

const clone = structuredClone;

function groundRequest(operationId) {
  return { operationId, uid: `death-journal-ground-${operationId.slice(-2)}`, kind: 'brasa',
    from: null, to: null, expectedVersion: 0, world: WORLD,
    ground: { x: 0, z: 0, availableAt: 1, returnAt: 2 }, profiles: [] };
}

async function deathFixture(db, id) {
  const f = makeDeath();
  const { request } = planRequest(f, id);
  await seedDeathStore(db.store, f, request);
  return request;
}

test('death intent prepares, commits, resolves and replays as one exact journal identity', async () => {
  const db = await database(), request = await deathFixture(db, deathOp(301)), journal = db.journal(WORLD);
  try {
    const { operationId, ...persistedRequest } = request;
    const prepared = await journal.prepare('death', request);
    assert.deepEqual(prepared, { operationId, scope: WORLD, family: 'death', request: persistedRequest, state: 'pending' });
    assert.deepEqual(await journal.list(), [prepared]);

    const receipt = await db.store.commitDeath(request);
    assert.equal(receipt.ok, true);
    const resolved = await journal.resolve('death', request, 'committed');
    assert.deepEqual(resolved, { ...prepared, state: 'committed' });
    assert.deepEqual(await journal.list(), []);
    assert.deepEqual(await db.store.loadDeathOperation(operationId), { request: persistedRequest, result: receipt });
    assert.deepEqual(await journal.prepare('death', request), resolved);
  } finally { await db.close(); }
});

test('death journal binds operation UUID, scope, request, family and terminal state', async () => {
  const db = await database(), request = await deathFixture(db, deathOp(302)), journal = db.journal(WORLD);
  try {
    await journal.prepare('death', request);
    const changed = clone(request); changed.drops = [{ ordinal: 1, kind: 'item', item: null,
      ground: { x: 0, z: 0, availableAt: 1, expiresAt: 2 } }];
    await assert.rejects(journal.prepare('death', changed), { code: 'operation' });
    await assert.rejects(journal.resolve('death', changed, 'committed'), { code: 'operation' });
    await assert.rejects(db.journal('other:world').prepare('death', request), { code: 'operation' });
    await assert.rejects(db.journal('other:world').resolve('death', request, 'committed'), { code: 'operation' });
    await assert.rejects(journal.resolve('death', request, 'pending'), { code: 'operation' });

    const row = (await db.db.query('select family,scope,request,state from public.mn_pearl_intents where operation_id=$1::uuid',
      [request.operationId])).rows[0];
    assert.deepEqual(row, { family: 'death', scope: WORLD, request: (() => { const p = clone(request); delete p.operationId; return p; })(), state: 'pending' });
  } finally { await db.close(); }
});

test('death receipt and death intent reject every legacy receipt family in both directions, including UUID updates', async () => {
  const tables = ['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations'];
  const db = await database(), pending = await deathFixture(db, deathOp(303)), journal = db.journal(WORLD);
  try {
    await journal.prepare('death', pending);
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i], oldId = deathOp(310 + i);
      await assert.rejects(db.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`,
        [pending.operationId]), undefined, `${table} insert colliding with death intent`);
      await db.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [oldId]);
      await assert.rejects(journal.prepare('death', { ...pending, operationId: oldId }), { code: 'operation' });
      assert.deepEqual(await db.store.commitDeath({ ...pending, operationId: oldId }), { ok: false, why: 'operation' });
      await assert.rejects(db.db.query(`update public.${table} set operation_id=$1::uuid where operation_id=$2::uuid`,
        [pending.operationId, oldId]), undefined, `${table} UUID update colliding with death intent`);
    }
    const oldIntent = groundRequest(deathOp(318));
    const { operationId: oldIntentId, ...oldIntentRequest } = oldIntent;
    await db.db.query("insert into public.mn_pearl_intents(operation_id,scope,family,request,state) values($1::uuid,$2,'ground',$3::jsonb,'pending')",
      [oldIntentId, WORLD, oldIntentRequest]);
    await assert.rejects(db.db.query('update public.mn_pearl_intents set operation_id=$1::uuid where operation_id=$2::uuid',
      [pending.operationId, oldIntentId]), undefined, 'legacy-family journal UUID update colliding with death intent');
  } finally { await db.close(); }

  const db2 = await database(), request = await deathFixture(db2, deathOp(304));
  try {
    assert.equal((await db2.store.commitDeath(request)).ok, true);
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i], oldId = deathOp(320 + i);
      await assert.rejects(db2.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`,
        [request.operationId]), undefined, `${table} insert colliding with death receipt`);
      await db2.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [oldId]);
      await assert.rejects(db2.db.query(`update public.${table} set operation_id=$1::uuid where operation_id=$2::uuid`,
        [request.operationId, oldId]), undefined, `${table} UUID update colliding with death receipt`);
    }
    const oldIntent = groundRequest(deathOp(329));
    const { operationId: oldIntentId, ...oldIntentRequest } = oldIntent;
    await db2.db.query("insert into public.mn_pearl_intents(operation_id,scope,family,request,state) values($1::uuid,$2,'ground',$3::jsonb,'pending')",
      [oldIntentId, WORLD, oldIntentRequest]);
    await assert.rejects(db2.db.query('update public.mn_pearl_intents set operation_id=$1::uuid where operation_id=$2::uuid',
      [request.operationId, oldIntentId]), undefined, 'legacy-family journal UUID update colliding with death receipt');
  } finally { await db2.close(); }
});

test('death receipt may coexist only with its matching pending death intent', async () => {
  const db = await database(), request = await deathFixture(db, deathOp(305)), journal = db.journal(WORLD);
  try {
    await journal.prepare('death', request);
    assert.equal((await db.store.commitDeath(request)).ok, true);
    const changed = clone(request); changed.world = 'other:world';
    assert.deepEqual(await db.store.commitDeath(changed), { ok: false, why: 'operation' });
    await assert.rejects(db.db.query("update public.mn_pearl_intents set family='ground' where operation_id=$1::uuid",
      [request.operationId]), undefined, 'death intent cannot change family after receipt');
    await assert.rejects(db.db.query('update public.mn_pearl_intents set operation_id=$1::uuid where operation_id=$2::uuid',
      [deathOp(306), request.operationId]), undefined, 'death intent cannot move away from its receipt UUID');
    assert.deepEqual(await db.store.loadDeathOperation(request.operationId), {
      request: (() => { const p = clone(request); delete p.operationId; return p; })(),
      result: await db.store.commitDeath(request).then((r) => ({ ...r, replay: false })),
    });
  } finally { await db.close(); }
});

test('intent tables and RPCs remain inaccessible to anon and authenticated roles', async () => {
  const db = await database(), request = await deathFixture(db, deathOp(307)), journal = db.journal(WORLD);
  try {
    await journal.prepare('death', request);
    for (const role of ['anon', 'authenticated']) {
      await db.db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(db.db.query('select * from public.mn_pearl_intents'));
      await assert.rejects(db.db.query("select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)",
        [WORLD, 'death', request.operationId, (() => { const p = clone(request); delete p.operationId; return p; })()]));
      await assert.rejects(db.db.query("select public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)",
        [WORLD, 'death', request.operationId, (() => { const p = clone(request); delete p.operationId; return p; })(), 'committed']));
    }
    await db.db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await db.db.query('select count(*)::int as n from public.mn_pearl_intents where family=\'death\'')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('raw death journal validation rejects changed loss delta, noncanonical UUID and wrong scope',async()=>{
  const db=await database();try{const request=await deathFixture(db,deathOp(350));
    for(const mutate of [r=>{r.profiles[0].data.gold++;},r=>{r.victim=r.victim.toUpperCase();},r=>{r.world='other:world';},r=>{r.rules.xpBefore=null;}]){
      const bad=clone(request);mutate(bad);delete bad.operationId;
      await assert.rejects(db.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',[WORLD,'death',request.operationId,bad]),{code:'MNP02'});
    }
    assert.equal((await db.db.query('select count(*)::int as n from public.mn_pearl_intents')).rows[0].n,0);
  }finally{await db.close();}
});
