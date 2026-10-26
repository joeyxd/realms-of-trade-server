import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { createSupabasePearlJournal } from '../../server/pearlJournal.mjs';
import { WORLD } from './pearl-same-holder.mjs';

export const migrations = await Promise.all(['001_store.sql', '002_accounts.sql', '003_pearl_operations.sql',
  '004_pearl_ground.sql', '005_pearl_journal.sql', '006_pearl_same_holder.sql'].map((name) =>
  readFile(new URL(`../../server/migrations/${name}`, import.meta.url), 'utf8')));
const rpcQueries = {
  mn_load_profile: ['public.mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['public.mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['public.mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl: ['public.mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_ground: ['public.mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_location: ['public.mn_load_pearl_location($1)', ['p_uid']],
  mn_list_pearl_ground: ['public.mn_list_pearl_ground($1,$2,$3::integer)', ['p_world','p_after_uid','p_limit']],
  mn_load_pearl_ground_operation: ['public.mn_load_pearl_ground_operation($1::uuid)', ['p_operation_id']],
  mn_prepare_pearl_intent: ['public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)', ['p_scope','p_family','p_operation_id','p_request']],
  mn_resolve_pearl_intent: ['public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)', ['p_scope','p_family','p_operation_id','p_request','p_state']],
  mn_list_pearl_intents: ['public.mn_list_pearl_intents($1,$2::uuid,$3::integer)', ['p_scope','p_after_id','p_limit']],
};
export function adapters(db, calls = []) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method, body: structuredClone(body) });
    try {
      let data;
      if (name === 'mn_pearl_operations' && init.method === 'GET') {
        const id = url.searchParams.get('operation_id')?.slice(3);
        data = (await db.query('select request,result from public.mn_pearl_operations where operation_id=$1::uuid', [id])).rows[0] ?? null;
      } else {
        const route = rpcQueries[name];
        if (!route) throw new Error('Unknown local route');
        data = (await db.query(`select ${route[0]} as data`, route[1].map((key) => body[key]))).rows[0].data;
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message, code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { store: createSupabaseStore(client), journal: createSupabasePearlJournal(client, WORLD), calls };
}
export async function database(path) {
  const db = new PGlite(path);
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const sql of migrations) await db.exec(sql);
  await db.exec(migrations.at(-1)); // 006 reapplication must retain the prior 004 routes and privileges.
  await db.exec('SET ROLE service_role');
  return { db, ...adapters(db), close: () => db.close() };
}
