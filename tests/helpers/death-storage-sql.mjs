import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { migrations as previous } from './pearl-same-holder-sql.mjs';
import { batchSql } from './pearl-batch-sql.mjs';
import { batchJournalSql } from './pearl-batch-journal-sql.mjs';

export const deathSql = await readFile(new URL('../../server/migrations/009_death_operations.sql', import.meta.url), 'utf8');
const routes = {
  mn_load_profile: ['public.mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['public.mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['public.mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl_ground: ['public.mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl: ['public.mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_batch: ['public.mn_commit_pearl_batch($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_prepare_pearl_intent: ['public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)', ['p_scope','p_family','p_operation_id','p_request']],
  mn_load_pearl_location: ['public.mn_load_pearl_location($1)', ['p_uid']],
  mn_load_death_operation: ['public.mn_load_death_operation($1::uuid)', ['p_operation_id']],
  mn_commit_death: ['public.mn_commit_death($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_list_death_drops: ['public.mn_list_death_drops($1,$2::uuid,$3::integer,$4::integer)',
    ['p_world','p_after_operation_id','p_after_ordinal','p_limit']],
};

export function adapters(db, calls = []) {
  let loseReply = false;
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, body: structuredClone(body) });
    try {
      const route = routes[name]; if (!route) throw new Error(`Unknown local route: ${name}`);
      const data = (await db.query(`select ${route[0]} as data`, route[1].map((key) => body[key]))).rows[0].data;
      if (name === 'mn_commit_death' && loseReply) { loseReply = false; throw new Error('Lost local reply'); }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { store: createSupabaseStore(client), client, calls, loseNextReply: () => { loseReply = true; } };
}

export async function database(path) {
  const db = new PGlite(path);
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const sql of [...previous, batchSql, batchJournalSql, deathSql, deathSql]) await db.exec(sql);
  await db.exec('SET ROLE service_role');
  return { db, ...adapters(db), close: () => db.close() };
}
