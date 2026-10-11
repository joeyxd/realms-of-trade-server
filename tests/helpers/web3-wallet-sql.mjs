import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseWalletStore } from '../../server/web3/walletStore.mjs';

export const walletSql = (await readFile(
  new URL('../../server/migrations/web3/002_wallet_link.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');

const routes = {
  mn_web3_wallet_issue: ['public.mn_web3_wallet_issue($1::jsonb)', ['p_request']],
  mn_web3_wallet_complete: ['public.mn_web3_wallet_complete($1::uuid,$2::uuid,$3::boolean)',
    ['p_challenge_id', 'p_account_id', 'p_verified']],
  mn_web3_wallet_challenge: ['public.mn_web3_wallet_challenge($1::uuid)', ['p_challenge_id']],
  mn_web3_wallet_link: ['public.mn_web3_wallet_link($1::uuid)', ['p_account_id']],
};

export function adapters(db, calls = [], options = {}) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method, body: structuredClone(body), headers: Object.fromEntries(new Headers(init.headers)) });
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
  return { client, store: createSupabaseWalletStore(client), calls };
}

export async function database(path = undefined, { reapply = false, coexistWithW01 = false, adapterOptions = {} } = {}) {
  const db = new PGlite(path);
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
  END $$; GRANT USAGE ON SCHEMA public TO PUBLIC;`);
  if (coexistWithW01) {
    const assetSql = (await readFile(new URL('../../server/migrations/web3/001_asset_registry.sql', import.meta.url), 'utf8')).replace(/^\uFEFF/, '');
    await db.exec(assetSql);
  }
  await db.exec(walletSql);
  if (reapply) await db.exec(walletSql);
  await db.exec('SET ROLE service_role');
  return { db, ...adapters(db, [], adapterOptions), close: () => db.close() };
}
