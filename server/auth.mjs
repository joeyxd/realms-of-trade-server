// Account verification uses a separate stateless public-key client. The storage client's
// service credentials never inherit a player's session or authorization header.
import { createClient } from '@supabase/supabase-js';
import { playerKey, StoreError } from './store.mjs';

export function publicAuthConfig(config = { enabled: false }) {
  if (config.enabled !== true) return { enabled: false };
  const { url, publicKey } = config;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error();
    if (typeof publicKey !== 'string' || publicKey.length > 4096) throw new Error();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
      const parts = publicKey.split('.');
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role !== 'anon') throw new Error();
    }
    return { enabled: true, url: u.origin, publicKey };
  } catch { throw new StoreError('configuration'); }
}

export function createAccountResolver(client) {
  if (typeof client?.auth?.getUser !== 'function') throw new StoreError('configuration');
  return async (_request, hello) => {
    // Absence is the only guest route. A supplied empty/invalid token must not downgrade.
    if (!Object.hasOwn(hello, 'token')) return null;
    if (typeof hello.token !== 'string' || !hello.token || hello.token.length > 8192 || /\s/.test(hello.token)) throw new StoreError('auth');
    try {
      const result = await client.auth.getUser(hello.token);
      if (result?.error || !result?.data?.user || result.data.user.is_anonymous === true) throw new Error();
      return playerKey(result.data.user.id);
    } catch { throw new StoreError('auth'); }
  };
}

export function accountAuthFromEnv(env = process.env, factory = createClient) {
  if (!env.SUPABASE_PUBLIC_KEY) return { publicConfig: { enabled: false }, resolvePlayer: null };
  if (!env.SUPABASE_SERVICE_KEY || env.SUPABASE_PUBLIC_KEY === env.SUPABASE_SERVICE_KEY) throw new StoreError('configuration');
  const publicConfig = publicAuthConfig({ enabled: true, url: env.SUPABASE_URL, publicKey: env.SUPABASE_PUBLIC_KEY });
  try {
    const client = factory(publicConfig.url, publicConfig.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
    return { publicConfig, resolvePlayer: createAccountResolver(client) };
  } catch { throw new StoreError('configuration'); }
}
