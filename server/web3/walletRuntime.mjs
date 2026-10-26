// Explicit operator policy only. A player's bearer never enters this service-role client.
import { createClient } from '@supabase/supabase-js';
import { publicAuthConfig } from '../auth.mjs';
import { createSupabaseWalletStore } from './walletStore.mjs';
import { createWalletLinkService } from './walletLink.mjs';
import { fail } from './walletContract.mjs';

function decimal(value, min, max) {
  const number = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || String(number) !== value || number < min || number > max) fail('configuration');
  return number;
}

function walletSetup(env, factory, auth) {
  try {
    if (typeof factory !== 'function') fail('configuration');
    const config = publicAuthConfig({ enabled: true, url: env.SUPABASE_URL, publicKey: env.SUPABASE_PUBLIC_KEY });
    const current = auth ? publicAuthConfig(auth.publicConfig) : config, serviceKey = env.SUPABASE_SERVICE_KEY;
    const url = new URL(config.url);
    if (current.url !== config.url || current.publicKey !== config.publicKey
      || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      || typeof serviceKey !== 'string' || !serviceKey || serviceKey.length > 8192 || /\s/.test(serviceKey)
      || serviceKey === config.publicKey) fail('configuration');
    const chainId = decimal(env.MN_WEB3_WALLET_CHAIN_ID, 1, 2147483647);
    const ttlMs = env.MN_WEB3_WALLET_TTL_MS === undefined ? 300000 : decimal(env.MN_WEB3_WALLET_TTL_MS, 30000, 600000);
    // Validate the complete SIWE policy before creating a credentialed client; these methods
    // forward only to the durable adapter assigned below, never to memory or a user's session.
    let store;
    const service = createWalletLinkService({ origin: env.MN_WEB3_WALLET_ORIGIN, chainId, ttlMs, store: {
      durable: true,
      issue: (...args) => store.issue(...args), complete: (...args) => store.complete(...args),
      loadChallenge: (...args) => store.loadChallenge(...args), loadLink: (...args) => store.loadLink(...args),
    } });
    const client = factory(config.url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init = {}) => fetch(input, { ...init, redirect: 'error',
        signal: AbortSignal.any([init.signal, AbortSignal.timeout(10000)].filter(Boolean)),
      }) },
    });
    store = createSupabaseWalletStore(client);
    return { ...service, prepare: () => store.checkReady() };
  } catch { fail('configuration'); }
}

export function walletLinkFromEnv(env = process.env, { auth, gameStore, factory = createClient } = {}) {
  const flag = env.MN_WEB3_WALLET_ENABLED;
  if (flag === undefined || flag === '0') return null;
  if (flag !== '1' || typeof auth?.resolvePlayer !== 'function' || auth?.publicConfig?.enabled !== true
    || gameStore?.durable !== true) fail('configuration');
  return walletSetup(env, factory, auth);
}

// Operator diagnostics expose only the read-only check, never account or world capabilities.
export function walletReadinessFromEnv(env = process.env, { factory = createClient } = {}) {
  if (env.MN_WEB3_WALLET_ENABLED !== '1') fail('configuration');
  const service = walletSetup(env, factory);
  return { origin: service.origin, chainId: service.chainId, prepare: service.prepare };
}
