import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunityOperationRecovery } from '../server/community/operationRecovery.mjs';
import { operationDatabase, operationAdapter, communityOperationSql } from './helpers/community-operation-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = { worldId: 'salty', worldEpoch: id(1) };
const binding = n => ({ ...scope, accountId: id(100 + n), characterId: id(n) });
const row = n => ({ ...scope, characterId: id(n), version: 1,
  data: { v: 1, xp: 8, eco: { pack: { goods: { madera: 7 } } } } });
const save = (op, n = 2) => ({ operationId: id(op), binding: binding(n), kind: 'save',
  request: { ...row(n), data: { ...row(n).data, xp: 20 } } });
const contribution = op => ({ operationId: id(op), binding: binding(2), kind: 'contribution', request: {
  ...scope, operationId: id(op), characterId: id(2), projectId: 'carpentry', good: 'madera', amount: 2,
  expectedCharacterVersion: 1, expectedProjectVersion: 1 } });
async function fixture(t) {
  const sql = await operationDatabase(); t.after(() => sql.close());
  for (const n of [2, 3]) { await sql.store.initializeCharacter(row(n)); await sql.store.initializeBinding(binding(n)); }
  await sql.store.initializeProject({ ...scope, projectId: 'carpentry', version: 1,
    requirements: { madera: 10 }, contributed: { madera: 0 } });
  return sql;
}
const isCode = code => e => e?.code === code;

test('SQL startup recovery discovers multiple characters and requires explicit exact retries', async t => {
  const sql = await fixture(t), a = save(10), b = save(11, 3);
  await sql.operationStore.prepareOperation(a); await sql.operationStore.prepareOperation(b);
  const owner = new CommunityOperationRecovery(sql.operationStore, { ...scope, pageSize: 1 });
  const observed = await owner.recover();
  assert.deepEqual(observed, { phase: 'closed', ready: false, unresolved: 2, active: 0, reason: 'pending' });
  assert.equal(sql.operationCalls.filter(c => c.name === 'mn_comm_commit_operation').length, 0);
  assert.equal((await owner.recover({ retry: true })).ready, true);
  const commits = sql.operationCalls.filter(c => c.name === 'mn_comm_commit_operation').map(c => c.body.p_intent);
  assert.deepEqual(commits, [a, b]);
  assert.equal((await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2))).data.xp, 20);
  assert.equal((await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(3))).version, 2);
});

test('SQL lost commit closes the gate; another owner resolves by read and keeps current state', async t => {
  const sql = await fixture(t); let lose = true;
  const lossy = operationAdapter(sql.db, [], { loseReply: name => {
    if (name !== 'mn_comm_commit_operation' || !lose) return false;
    lose = false; return true;
  } });
  const old = new CommunityOperationRecovery(lossy.store, scope); await old.recover();
  assert.deepEqual(await old.execute(contribution(20)), { ok: false, why: 'unavailable' });
  assert.equal(old.canAdmit(), false);
  const current = await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2));
  await sql.store.saveCharacter({ ...current, data: { ...current.data, xp: 99 } });
  const fresh = new CommunityOperationRecovery(sql.operationStore, scope);
  assert.equal((await fresh.recover()).ready, true);
  assert.equal((await old.recover()).ready, true);
  assert.equal(lossy.calls.filter(c => c.name === 'mn_comm_commit_operation').length, 1);
  const loaded = await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2));
  assert.equal(loaded.version, 3); assert.equal(loaded.data.xp, 99); assert.equal(loaded.data.eco.pack.goods.madera, 5);
  assert.equal((await sql.operationStore.loadOperation(id(20))).result.character.version, 2);
});

test('failed save journal closure rolls back the profile and blocks startup until repaired', async t => {
  const sql = await fixture(t);
  await sql.db.exec(`RESET ROLE;
    CREATE FUNCTION public.reject_test_save_closure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected closure failure'; END $$;
    CREATE TRIGGER reject_test_save_closure BEFORE UPDATE ON public.mn_comm_operation_intents
      FOR EACH ROW EXECUTE FUNCTION public.reject_test_save_closure(); SET ROLE service_role;`);
  const owner = new CommunityOperationRecovery(sql.operationStore, scope); await owner.recover();
  assert.deepEqual(await owner.execute(save(30)), { ok: false, why: 'unavailable' });
  assert.deepEqual(await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2)), row(2));
  assert.equal((await owner.recover()).ready, false);
  await sql.db.exec('RESET ROLE; DROP TRIGGER reject_test_save_closure ON public.mn_comm_operation_intents; SET ROLE service_role;');
  assert.equal((await owner.recover({ retry: true })).ready, true);
  assert.equal((await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2))).version, 2);
});

test('SQL rejects null families, invalid scans, forged mirror/result rows and public journal access', async t => {
  const sql = await fixture(t);
  const malformed = [null, { ...save(40), kind: null }, { ...contribution(41), kind: 1 },
    { ...save(42), request: { ...row(3) } }];
  for (const raw of malformed) await assert.rejects(sql.db.query(
    'SELECT public.mn_comm_prepare_operation($1::jsonb)', [JSON.stringify(raw)]), isCode('CMI01'));
  for (const args of [[null, scope.worldEpoch, null, 1], [scope.worldId, null, null, 1],
    [scope.worldId, scope.worldEpoch, null, 0], [scope.worldId, scope.worldEpoch, id(0), 129]]) {
    await assert.rejects(sql.db.query('SELECT public.mn_comm_list_pending_operations($1::text,$2::uuid,$3::uuid,$4::integer)', args), isCode('CMI01'));
  }
  await assert.rejects(sql.db.query('SELECT public.mn_comm_load_operation(NULL)'), isCode('CMI01'));
  await sql.operationStore.prepareOperation(save(43));
  await sql.db.exec('RESET ROLE');
  await assert.rejects(sql.db.query(`INSERT INTO public.mn_comm_operation_intents
    (operation_id,world_id,world_epoch,character_id,account_id,intent)
    VALUES($1::uuid,'other',$2::uuid,$3::uuid,$4::uuid,$5::jsonb)`,
  [id(44), scope.worldEpoch, id(3), binding(3).accountId, JSON.stringify(save(44, 3))]), isCode('CMI01'));
  await assert.rejects(sql.db.query(`UPDATE public.mn_comm_operation_intents SET result=$1::jsonb WHERE operation_id=$2::uuid`,
    [JSON.stringify({ ok: true, character: row(2) }), id(43)]), isCode('CMI02'));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await sql.db.exec(`SET ROLE ${role}`);
    await assert.rejects(sql.db.query('DELETE FROM public.mn_comm_operation_intents'), isCode('42501'));
    if (role !== 'service_role') {
      await assert.rejects(sql.db.query('SELECT public.mn_comm_load_operation($1::uuid)', [id(43)]), isCode('42501'));
      await assert.rejects(sql.db.query('SELECT * FROM public.mn_comm_operation_intents'), isCode('42501'));
    }
    await sql.db.exec('RESET ROLE');
  }
});

test('SQL integer-valued decimals and migration reapply preserve pending and immutable completed evidence', async t => {
  const sql = await fixture(t);
  const source = JSON.stringify(save(50)).replace('"version":1', '"version":1.0');
  assert.equal((await sql.db.query('SELECT public.mn_comm_prepare_operation($1::jsonb) AS entry', [source])).rows[0].entry.state, 'pending');
  assert.equal((await sql.db.query('SELECT public.mn_comm_commit_operation($1::jsonb) AS entry', [source])).rows[0].entry.state, 'complete');
  await sql.operationStore.prepareOperation(save(51, 3));
  const before = await sql.operationStore.loadOperation(id(50));
  await sql.db.exec('RESET ROLE'); await sql.db.exec(communityOperationSql); await sql.db.exec('SET ROLE service_role');
  assert.deepEqual(await sql.operationStore.loadOperation(id(50)), before);
  assert.deepEqual((await sql.operationStore.listPendingOperations(scope.worldId, scope.worldEpoch)).map(e => e.intent.operationId), [id(51)]);
  const signature = (await sql.db.query(`SELECT proargnames FROM pg_catalog.pg_proc
    WHERE proname='mn_comm_list_pending_operations' AND pronamespace='public'::regnamespace`)).rows[0].proargnames;
  assert.deepEqual(signature, ['p_world_id', 'p_world_epoch', 'p_after_operation_id', 'p_limit']);
});

test('terminal save and contribution conflicts are durable and never overwrite a competing current row', async t => {
  const sql = await fixture(t), s = save(60);
  await sql.operationStore.prepareOperation(s);
  const saved = await sql.store.saveCharacter({ ...row(2), data: { ...row(2).data, xp: 77 } });
  const denied = await sql.operationStore.commitOperation(s);
  assert.deepEqual(denied, { intent: s, state: 'complete', result: { ok: false, why: 'conflict' } });
  assert.deepEqual(await sql.operationStore.commitOperation(s), denied);
  assert.deepEqual(await sql.store.loadCharacter(scope.worldId, scope.worldEpoch, id(2)), saved.character);
  const c = { ...contribution(61), binding: binding(3), request: { ...contribution(61).request, characterId: id(3) } };
  await sql.operationStore.prepareOperation(c);
  await sql.store.saveCharacter({ ...row(3), data: { ...row(3).data, xp: 88 } });
  const rejected = await sql.operationStore.commitOperation(c);
  assert.deepEqual(rejected.result, { ok: false, why: 'conflict', replay: false });
  assert.deepEqual(await sql.operationStore.commitOperation(c), rejected);
  assert.deepEqual((await sql.store.loadContributionReceipt(id(61))).result, rejected.result);
  assert.equal((await sql.store.loadProject(scope.worldId, scope.worldEpoch, 'carpentry')).contributed.madera, 0);
  const gate = new CommunityOperationRecovery(sql.operationStore, scope);
  assert.equal((await gate.recover()).ready, true);
});
