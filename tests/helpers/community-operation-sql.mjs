import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { identityDatabase } from './community-identity-sql.mjs';
import { createSupabaseOperationStore } from '../../server/community/supabaseOperationStore.mjs';

export const communityOperationSql = (await readFile(
  new URL('../../server/migrations/community/005_operation_journal.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');

const routes = {
  mn_comm_prepare_operation: ['public.mn_comm_prepare_operation($1::jsonb)', ['p_intent']],
  mn_comm_commit_operation: ['public.mn_comm_commit_operation($1::jsonb)', ['p_intent']],
  mn_comm_load_operation: ['public.mn_comm_load_operation($1::uuid)', ['p_operation_id']],
  mn_comm_list_pending_operations: ['public.mn_comm_list_pending_operations($1::text,$2::uuid,$3::uuid,$4::integer)',
    ['p_world_id', 'p_world_epoch', 'p_after_operation_id', 'p_limit']],
};

export function operationAdapter(db, calls = [], options = {}) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method, body: structuredClone(body) });
    if (options.hangRequest?.(name, body)) return new Promise(() => {});
    let data;
    try {
      const route = routes[name];
      if (!route) throw new Error(`Unexpected operation RPC ${name}`);
      const rejection = options.rejectReply?.(name, body);
      if (rejection) return new Response(JSON.stringify({ message: 'Injected RPC rejection', code: rejection }), { status: 400 });
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
  return { client, store: createSupabaseOperationStore(client, options.storeOptions), calls };
}

export async function operationDatabase(path = undefined, { reapply = false, adapterOptions = {} } = {}) {
  const base = await identityDatabase(path);
  try {
    await base.db.exec('RESET ROLE');
    await base.db.exec(communityOperationSql);
    if (reapply) await base.db.exec(communityOperationSql);
    await base.db.exec('SET ROLE service_role');
    const operation = operationAdapter(base.db, [], adapterOptions);
    return { ...base, operationClient: operation.client, operationStore: operation.store,
      operationCalls: operation.calls, close: () => base.close() };
  } catch (error) {
    await base.close();
    throw error;
  }
}
