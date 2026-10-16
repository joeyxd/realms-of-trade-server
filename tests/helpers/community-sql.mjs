import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseContributionStore } from '../../server/community/supabaseContributionStore.mjs';

export const communitySql = (await readFile(
  new URL('../../server/migrations/community/001_contributions.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
export const communitySessionSql = (await readFile(
  new URL('../../server/migrations/community/002_character_saves.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
export const communityBindingsSql = (await readFile(
  new URL('../../server/migrations/community/003_character_bindings.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');

const routes = {
  mn_comm_initialize_character: ['public.mn_comm_initialize_character($1::jsonb)', ['p_character']],
  mn_comm_initialize_project: ['public.mn_comm_initialize_project($1::jsonb)', ['p_project']],
  mn_comm_save_character: ['public.mn_comm_save_character($1::jsonb)', ['p_character']],
  mn_comm_commit_contribution: ['public.mn_comm_commit_contribution($1::jsonb)', ['p_request']],
  mn_comm_load_character: ['public.mn_comm_load_character($1::text,$2::uuid,$3::uuid)',
    ['p_world_id', 'p_world_epoch', 'p_character_id']],
  mn_comm_load_project: ['public.mn_comm_load_project($1::text,$2::uuid,$3::text)',
    ['p_world_id', 'p_world_epoch', 'p_project_id']],
  mn_comm_load_receipt: ['public.mn_comm_load_receipt($1::uuid)', ['p_operation_id']],
  mn_comm_initialize_binding: ['public.mn_comm_initialize_binding($1::jsonb)', ['p_binding']],
  mn_comm_load_binding: ['public.mn_comm_load_binding($1::uuid,$2::text,$3::uuid)',
    ['p_account_id', 'p_world_id', 'p_world_epoch']],
};

export function adapters(db, calls = [], options = {}) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method, body: structuredClone(body), headers: Object.fromEntries(new Headers(init.headers)) });
    if (options.hangRequest?.(name, body)) return new Promise(() => {});
    let data;
    try {
      const route = routes[name];
      if (!route) throw new Error(`Unexpected Supabase route ${name}`);
      const rejection = options.rejectReply?.(name, body);
      if (rejection) return new Response(JSON.stringify({ message: 'Injected local RPC rejection', code: rejection }),
        { status: 400, headers: { 'content-type': 'application/json' } });
      data = (await db.query(`select ${route[0]} as data`, route[1].map((key) => body[key]))).rows[0].data;
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (options.loseReply?.(name, body)) throw new Error('Lost local reply');
    const altered = options.transformReply ? options.transformReply(name, data, body) : data;
    return new Response(JSON.stringify(altered), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { client, store: createSupabaseContributionStore(client), calls };
}

export async function database(path = undefined, { reapply = false, sessionSaves = false, bindings = false, adapterOptions = {} } = {}) {
  const db = new PGlite(path);
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
  END $$; GRANT USAGE ON SCHEMA public TO PUBLIC;`);
  await db.exec(communitySql);
  if (reapply) await db.exec(communitySql);
  if (sessionSaves || bindings) {
    await db.exec(communitySessionSql);
    if (reapply) await db.exec(communitySessionSql);
  }
  if (bindings) {
    await db.exec(communityBindingsSql);
    if (reapply) await db.exec(communityBindingsSql);
  }
  await db.exec('SET ROLE service_role');
  return { db, ...adapters(db, [], adapterOptions), close: () => db.close() };
}
