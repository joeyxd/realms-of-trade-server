import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupabaseGmDraftMethods } from '../server/gmDraftStore.mjs';
import { database as baseDatabase, reopenDatabase as reopenBaseDatabase } from './helpers/ground-transaction-sql.mjs';

const migration = await readFile(new URL('../server/migrations/020_gm_drafts.sql', import.meta.url), 'utf8');
const journalMigration = await readFile(new URL('../server/migrations/019_ground_transaction_journal.sql', import.meta.url), 'utf8');
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const document = (revision = 'map-v1', seed = 42) => ({ schema: 'marea.gm.map-draft', version: 2,
  base: { seed, revision }, objects: [], baseOverrides: [] });

function methods(db) {
  const rpc = async (name, args) => {
    try {
      let data;
      if (name === 'mn_gm_drafts_ready') data = (await db.query('select public.mn_gm_drafts_ready() as data')).rows[0].data;
      else if (name === 'mn_load_gm_draft') data = (await db.query(
        'select public.mn_load_gm_draft($1,$2::uuid) as data', [args.p_world, args.p_owner])).rows[0].data;
      else if (name === 'mn_save_gm_draft') data = (await db.query(
        'select public.mn_save_gm_draft($1::uuid,$2::jsonb) as data', [args.p_operation_id, args.p_request])).rows[0].data;
      else throw new Error('unexpected rpc');
      return { data, error: null };
    } catch (error) { return { data: null, error: { code: error.code ?? 'XX000' } }; }
  };
  return createSupabaseGmDraftMethods({ rpc });
}

async function database(t, path) {
  const base = await baseDatabase(path);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await base.close(); } };
  t.after(close);
  await base.db.exec('RESET ROLE');
  await base.db.exec(journalMigration);
  await base.db.exec(migration);
  await base.db.exec(migration);
  await base.db.exec('SET ROLE service_role');
  return { ...base, close, gm: methods(base.db) };
}

test('SQL020 is reappliable, service-only and exposes CAS save/load through the Supabase adapter', async t => {
  const f = await database(t);
  assert.deepEqual(await f.gm.checkGmDrafts(), { version: 1 });
  assert.deepEqual(await f.gm.loadGmDraft({ world: 'salty-shore', owner }), { revision: 0, document: null, savedAt: null });
  const request = { world: 'salty-shore', owner, expectedRevision: 0, document: document() };
  const [one, two] = await Promise.all([
    f.gm.saveGmDraft({ ...request, operationId: operation(1) }),
    f.gm.saveGmDraft({ ...request, operationId: operation(2) }),
  ]);
  assert.equal([one, two].filter(result => result.ok).length, 1);
  const winnerId = one.ok ? operation(1) : operation(2);
  const winner = one.ok ? one : two;
  assert.equal(winner.head.revision, 1);
  assert.deepEqual(await f.gm.saveGmDraft({ ...request, operationId: winnerId }), { ...winner, replay: true });
  assert.deepEqual(await f.gm.saveGmDraft({ ...request, operationId: winnerId, document: document('different-map') }),
    { ok: false, why: 'operation' });
  const loser = one.ok ? two : one;
  assert.deepEqual(loser, { ok: false, why: 'conflict', revision: 1 });
  const loserId = one.ok ? operation(2) : operation(1);
  assert.deepEqual(await f.gm.saveGmDraft({ ...request, operationId: loserId }), loser);
  assert.deepEqual(await f.gm.saveGmDraft({ ...request, operationId: loserId, document: document('other-map') }),
    { ok: false, why: 'operation' });
  assert.deepEqual(await f.gm.loadGmDraft({ world: 'salty-shore', owner }), winner.head);

  const acl = (await f.db.query(`SELECT has_table_privilege('anon','public.mn_gm_drafts','SELECT') AS anon_read,
    has_table_privilege('authenticated','public.mn_gm_drafts','SELECT') AS user_read,
    has_table_privilege('service_role','public.mn_gm_drafts','SELECT') AS service_read,
    has_table_privilege('service_role','public.mn_gm_drafts','UPDATE') AS service_write,
    has_table_privilege('service_role','public.mn_gm_drafts','DELETE') AS service_delete,
    has_table_privilege('service_role','public.mn_gm_drafts','TRUNCATE') AS service_truncate,
    has_table_privilege('anon','public.mn_gm_draft_operations','INSERT') AS anon_receipt_insert,
    has_table_privilege('authenticated','public.mn_gm_draft_operations','DELETE') AS user_receipt_delete,
    has_table_privilege('service_role','public.mn_gm_draft_operations','TRUNCATE') AS service_receipt_truncate,
    has_function_privilege('anon','public.mn_save_gm_draft(uuid,jsonb)','EXECUTE') AS anon_rpc,
    has_function_privilege('authenticated','public.mn_save_gm_draft(uuid,jsonb)','EXECUTE') AS user_rpc,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.mn_gm_drafts'::regclass) AS draft_rls,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.mn_gm_draft_operations'::regclass) AS receipt_rls`)).rows[0];
  assert.deepEqual(acl, { anon_read: false, user_read: false, service_read: true, service_write: false,
    service_delete: false, service_truncate: false, anon_receipt_insert: false, user_receipt_delete: false,
    service_receipt_truncate: false, anon_rpc: false, user_rpc: false, draft_rls: true, receipt_rls: true });
  await f.db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(f.db.query('select public.mn_save_gm_draft($1::uuid,$2::jsonb)', [operation(9), request]));
  await f.db.exec('RESET ROLE; SET ROLE service_role');
  await f.db.exec('RESET ROLE; ALTER TABLE public.mn_gm_drafts DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(f.gm.checkGmDrafts());
  await f.db.exec('RESET ROLE; ALTER TABLE public.mn_gm_drafts ENABLE ROW LEVEL SECURITY; GRANT UPDATE ON public.mn_gm_drafts TO service_role; SET ROLE service_role');
  await assert.rejects(f.gm.checkGmDrafts());
  await f.db.exec('RESET ROLE; REVOKE UPDATE ON public.mn_gm_drafts FROM service_role; REVOKE EXECUTE ON FUNCTION public.mn_save_gm_draft(uuid,jsonb) FROM service_role; SET ROLE service_role');
  await assert.rejects(f.gm.checkGmDrafts());
  await f.db.exec('RESET ROLE; GRANT EXECUTE ON FUNCTION public.mn_save_gm_draft(uuid,jsonb) TO service_role; SET ROLE service_role');
  await f.gm.checkGmDrafts();
  await f.db.exec('RESET ROLE; ALTER TABLE public.mn_gm_draft_operations DISABLE TRIGGER mn_gm_draft_operation_guard; SET ROLE service_role');
  await assert.rejects(f.gm.checkGmDrafts());
  await f.db.exec('RESET ROLE; ALTER TABLE public.mn_gm_draft_operations ENABLE TRIGGER mn_gm_draft_operation_guard; SET ROLE service_role');
  assert.deepEqual(await f.gm.checkGmDrafts(), { version: 1 });
  await f.db.exec('RESET ROLE');
  await assert.rejects(f.db.query('UPDATE public.mn_gm_draft_operations SET result=result'));
  await f.db.exec('SET ROLE service_role');
});

test('committed SQL020 receipt replays the exact saved head after database reopen and a lost reply', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mn-gm-drafts-'));
  const path = join(dir, 'db');
  let f;
  try {
    f = await database(t, path);
    const request = { world: 'salty-shore', owner, expectedRevision: 0, document: document() };
    const committed = (await f.db.query('select public.mn_save_gm_draft($1::uuid,$2::jsonb) as data',
      [operation(20), { ...request }])).rows[0].data;
    assert.equal(committed.ok, true);
    // Deliberately discard the first response, then use a fresh connection/store after restart.
    await f.close();
    const reopened = await reopenBaseDatabase(path);
    t.after(() => reopened.close());
    const gm = methods(reopened.db);
    assert.deepEqual(await gm.saveGmDraft({ ...request, operationId: operation(20) }),
      { ...committed, replay: true });
    assert.deepEqual(await gm.loadGmDraft({ world: 'salty-shore', owner }), committed.head);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('SQL validator rejects invalid scope, non-v2 document and document over size budget', async t => {
  const f = await database(t);
  const requests = [
    null,
    { world: 'invalid world', owner, expectedRevision: 0, document: document() },
    { world: 'salty-shore', owner, expectedRevision: 0, document: { ...document(), version: 1 } },
    { world: 'salty-shore', owner, expectedRevision: 0,
      document: { ...document(), base: { seed: -1, revision: 'map-v1' } } },
    { world: 'salty-shore', owner, expectedRevision: 0,
      document: { ...document(), base: { seed: 42, revision: 'x'.repeat(129) } } },
    { world: 'salty-shore', owner, expectedRevision: 0,
      document: { ...document(), base: { seed: 42, revision: 'map-v1', extra: true } } },
    { world: 'salty-shore', owner, expectedRevision: 0, document: { ...document(), extra: true } },
    { world: 'salty-shore', owner, expectedRevision: 0,
      document: { ...document(), filler: 'x'.repeat(5 * 1024 * 1024) } },
  ];
  for (const request of requests) {
    const result = (await f.db.query('select public.mn_save_gm_draft($1::uuid,$2::jsonb) as data',
      [operation(30), JSON.stringify(request)])).rows[0].data;
    assert.deepEqual(result, { ok: false, why: 'operation' });
  }
});
