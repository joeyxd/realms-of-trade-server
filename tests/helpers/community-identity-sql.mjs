import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { database as baseDatabase } from './community-sql.mjs';
import { createSupabaseIdentityStore } from '../../server/community/supabaseIdentityStore.mjs';

export const communityIdentitySql = (await readFile(
  new URL('../../server/migrations/community/004_character_bootstrap.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');

const routes = {
  mn_comm_load_identity: ['public.mn_comm_load_identity($1::uuid,$2::text,$3::uuid)', ['p_account_id','p_world_id','p_world_epoch']],
  mn_comm_allocate_identity: ['public.mn_comm_allocate_identity($1::jsonb,$2::jsonb)', ['p_binding','p_data']],
};

function identityAdapter(db, calls = [], options = {}) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method, body: structuredClone(body) });
    if (options.hangRequest?.(name, body)) return new Promise(() => {});
    let data;
    try {
      const route = routes[name]; if (!route) throw new Error(`Unexpected identity RPC ${name}`);
      const reject = options.rejectReply?.(name, body);
      if (reject) return new Response(JSON.stringify({ message: 'Injected RPC rejection', code: reject }), { status: 400 });
      data = (await db.query(`select ${route[0]} as data`, route[1].map(key => body[key]))).rows[0].data;
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }), { status: 400 });
    }
    if (options.loseReply?.(name, body)) throw new Error('Lost local reply');
    const altered = options.transformReply ? options.transformReply(name, data, body) : data;
    return new Response(JSON.stringify(altered), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { client, store: createSupabaseIdentityStore(client), calls };
}

export async function identityDatabase(path = undefined, { reapply = false, adapterOptions = {} } = {}) {
  const base = await baseDatabase(path, { bindings: true });
  await base.db.exec('RESET ROLE');
  await base.db.exec(communityIdentitySql);
  if (reapply) await base.db.exec(communityIdentitySql);
  await base.db.exec('SET ROLE service_role');
  const identity = identityAdapter(base.db, [], adapterOptions);
  return { ...base, identityClient: identity.client, identityStore: identity.store, identityCalls: identity.calls,
    close: () => base.close() };
}
