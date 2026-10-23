import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseGroundTransactionJournal } from '../../server/groundTransactionJournal.mjs';
import { createSupabaseStore } from '../../server/store.mjs';
import { database as databaseWithJournal, reopenDatabase as reopenWithJournal } from './ground-transaction-journal-sql.mjs';

const migration020 = await readFile(new URL('../../server/migrations/020_gm_drafts.sql', import.meta.url), 'utf8');
const migration021 = await readFile(new URL('../../server/migrations/021_artisan_operations.sql', import.meta.url), 'utf8');

async function applyAuthorityMigrations(fixture, migrate) {
  if (migrate) {
    await fixture.db.exec('RESET ROLE');
    for (const sql of [migration020, migration021, migration020, migration021]) await fixture.db.exec(sql);
    await fixture.db.exec('SET ROLE service_role');
  }
  let loseCommitReply = false;
  const queries = {
    mn_load_profile: ['select public.mn_load_profile($1::uuid) as data', a => [a.p_player_id]],
    mn_save_profile: ['select public.mn_save_profile($1::uuid,$2::jsonb,$3::integer) as data', a => [a.p_player_id, a.p_data, a.p_expected_version]],
    mn_load_world: ['select public.mn_load_world($1) as data', a => [a.p_world]],
    mn_save_world: ['select public.mn_save_world($1,$2::jsonb,$3::integer) as data', a => [a.p_world, a.p_data, a.p_expected_version]],
    mn_resource_operations_ready: ['select public.mn_resource_operations_ready() as data', () => []],
    mn_logging_operations_ready: ['select public.mn_logging_operations_ready() as data', () => []],
    mn_artisan_operations_ready: ['select public.mn_artisan_operations_ready() as data', () => []],
    mn_load_economic_operation: ['select public.mn_load_economic_operation($1::uuid) as data', a => [a.p_operation_id]],
    mn_commit_economic_operation: ['select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', a => [a.p_operation_id, a.p_request]],
    mn_ground_transactions_ready: ['select public.mn_ground_transactions_ready() as data', () => []],
    mn_load_ground_transaction: ['select public.mn_load_ground_transaction($1::uuid) as data', a => [a.p_operation_id]],
    mn_commit_ground_transaction: ['select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data', a => [a.p_operation_id, a.p_request]],
    mn_load_ground_clock: ['select public.mn_load_ground_clock($1) as data', a => [a.p_world]],
    mn_commit_ground_clock: ['select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data', a => [a.p_operation_id, a.p_request]],
    mn_load_ground_clock_operation: ['select public.mn_load_ground_clock_operation($1::uuid) as data', a => [a.p_operation_id]],
  };
  const fetch = async (input, init = {}) => {
    const name = new URL(input).pathname.split('/').at(-1), args = JSON.parse(init.body ?? '{}');
    const entry = queries[name];
    if (!entry) return new Response(JSON.stringify({ code: '42883', message: 'Unexpected local SQL RPC' }), { status: 400 });
    let data, lost = false;
    try {
      const result = await fixture.db.query(entry[0], entry[1](args));
      data = result.rows[0].data;
      if (name === 'mn_commit_ground_transaction' && loseCommitReply) {
        loseCommitReply = false;
        lost = true;
      }
    } catch (error) {
      return new Response(JSON.stringify({ code: error.code ?? 'XX000', message: 'Local SQL rejection' }), { status: 400 });
    }
    if (lost) throw new Error('Lost local ground-transaction reply');
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  const store = createSupabaseStore(client);
  return { ...fixture, store, journal: world => createSupabaseGroundTransactionJournal(fixture.journalClient, world),
    loseNextReply: () => { loseCommitReply = true; } };
}

export async function database(path) {
  const fixture = await databaseWithJournal(path);
  try { return await applyAuthorityMigrations(fixture, true); }
  catch (error) { await fixture.close(); throw error; }
}

export async function reopenDatabase(path) {
  return applyAuthorityMigrations(await reopenWithJournal(path), false);
}
