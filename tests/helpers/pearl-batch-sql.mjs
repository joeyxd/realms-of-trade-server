import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { migrations as previous } from './pearl-same-holder-sql.mjs';

export const batchSql = await readFile(new URL('../../server/migrations/007_pearl_batch.sql', import.meta.url), 'utf8');
const routes = {
  mn_load_profile: ['public.mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['public.mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['public.mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl: ['public.mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_ground: ['public.mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_location: ['public.mn_load_pearl_location($1)', ['p_uid']],
  mn_list_pearl_ground: ['public.mn_list_pearl_ground($1,$2,$3::integer)', ['p_world','p_after_uid','p_limit']],
  mn_load_pearl_ground_operation: ['public.mn_load_pearl_ground_operation($1::uuid)', ['p_operation_id']],
  mn_commit_pearl_batch: ['public.mn_commit_pearl_batch($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_batch_operation: ['public.mn_load_pearl_batch_operation($1::uuid)', ['p_operation_id']],
};
export function adapters(db, calls = []) {
  let dropReply = false, corruptReply = null;
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, body: structuredClone(body) });
    let data;
    try {
      if (name === 'mn_pearl_operations' && init.method === 'GET') {
        data = (await db.query('select request,result from public.mn_pearl_operations where operation_id=$1::uuid',
          [url.searchParams.get('operation_id')?.slice(3)])).rows[0] ?? null;
      } else {
        const route = routes[name];
        if (!route) throw new Error('Unknown local route');
        data = (await db.query(`select ${route[0]} as data`, route[1].map((k) => body[k]))).rows[0].data;
      }
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (name === 'mn_commit_pearl_batch' && dropReply) { dropReply = false; throw new Error('Lost local reply'); }
    if (corruptReply) data = corruptReply(name, data);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { store: createSupabaseStore(client), calls,
    loseNextReply: () => { dropReply = true; }, corrupt: (fn) => { corruptReply = fn; } };
}
export async function database(path) {
  const db = new PGlite(path);
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const sql of [...previous, batchSql, batchSql]) await db.exec(sql);
  await db.exec('SET ROLE service_role');
  return { db, ...adapters(db), close: () => db.close() };
}
