import { playerKey } from './store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GM_ACCOUNTS = 32;
const DEFAULT_RESOLVER_TIMEOUT_MS = 10_000;
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'pragma': 'no-cache',
  'vary': 'authorization',
  'x-content-type-options': 'nosniff',
});

export class GmConfigurationError extends Error {
  constructor() { super('GM account allowlist configuration is invalid'); this.name = 'GmConfigurationError'; }
}

function normalizeGmAccountIds(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_GM_ACCOUNTS) throw new GmConfigurationError();
  const normalized = value.map((id) => playerKey(id));
  if (new Set(normalized).size !== normalized.length) throw new GmConfigurationError();
  return Object.freeze(normalized);
}

export function parseGmAccountIds(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new GmConfigurationError();
  const ids = value.split(',').map((part) => part.trim());
  if (ids.length > MAX_GM_ACCOUNTS || ids.some((id) => !UUID.test(id))) throw new GmConfigurationError();
  return normalizeGmAccountIds(ids);
}

function bearerToken(value) {
  if (typeof value !== 'string' || value.length > 8200) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  return match && match[1].length <= 8192 ? match[1] : null;
}

async function boundedResolvePlayer({ request, resolvePlayer, token, signal, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  let abortListener;
  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortListener);
      resolve(result);
    };
    abortListener = () => {
      controller.abort();
      finish({ kind: 'aborted' });
    };
    if (signal?.aborted) return abortListener();
    signal?.addEventListener('abort', abortListener, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish({ kind: 'timeout' });
    }, timeoutMs);
    Promise.resolve().then(() => resolvePlayer(request, { token }, { signal: controller.signal }))
      .then((identity) => finish({ kind: 'resolved', identity }), (error) => finish({ kind: 'failed', error }));
  });
  return outcome;
}

export async function resolveGmSession({ authorization, request, resolvePlayer, accountIds, signal, timeoutMs = DEFAULT_RESOLVER_TIMEOUT_MS }) {
  let allowed;
  try { allowed = normalizeGmAccountIds(accountIds); } catch { allowed = null; }
  if (!allowed || typeof resolvePlayer !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    return { status: 503, body: { ok: false, code: 'gm_unavailable' } };
  }
  const token = bearerToken(authorization);
  if (!token) return { status: 401, body: { ok: false, code: 'auth' } };

  const resolved = await boundedResolvePlayer({ request, resolvePlayer, token, signal, timeoutMs });
  if (resolved.kind === 'aborted') return { status: 0, body: null, aborted: true };
  if (resolved.kind === 'timeout') return { status: 503, body: { ok: false, code: 'gm_auth_timeout' } };
  if (resolved.kind === 'failed') return { status: 401, body: { ok: false, code: 'auth' } };
  let identity;
  try { identity = resolved.identity === null ? null : playerKey(resolved.identity); }
  catch { return { status: 401, body: { ok: false, code: 'auth' } }; }
  if (identity === null) return { status: 401, body: { ok: false, code: 'auth' } };
  if (!allowed.includes(identity)) return { status: 403, body: { ok: false, code: 'forbidden' } };

  return {
    status: 200,
    body: { ok: true, accountId: identity, capabilities: ['gm-editor'], expiresIn: 60 },
  };
}

export function createGmSessionHandler({ resolvePlayer, accountIds, timeoutMs = DEFAULT_RESOLVER_TIMEOUT_MS }) {
  const allowed = normalizeGmAccountIds(accountIds);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new GmConfigurationError();
  return async function handleGmSession(request, response) {
    if (response.destroyed || response.writableEnded || request.aborted) return true;
    if (request.method !== 'GET') {
      response.writeHead(405, { ...JSON_HEADERS, allow: 'GET' });
      response.end(JSON.stringify({ ok: false, code: 'method' }));
      return true;
    }
    const controller = new AbortController();
    const abortOnRequest = () => controller.abort();
    const abortOnResponse = () => { if (!response.writableEnded) controller.abort(); };
    request.once?.('aborted', abortOnRequest);
    response.once?.('close', abortOnResponse);
    try {
      const result = await resolveGmSession({
        authorization: request.headers?.authorization,
        request,
        resolvePlayer,
        accountIds: allowed,
        signal: controller.signal,
        timeoutMs,
      });
      if (result.aborted || response.destroyed || response.writableEnded || request.aborted) return true;
      response.writeHead(result.status, JSON_HEADERS);
      response.end(JSON.stringify(result.body));
    } finally {
      request.removeListener?.('aborted', abortOnRequest);
      response.removeListener?.('close', abortOnResponse);
    }
    return true;
  };
}
