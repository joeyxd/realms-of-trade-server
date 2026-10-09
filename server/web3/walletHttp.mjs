// Same-origin, bearer-authenticated HTTP boundary. Account identity never comes from JSON.
import { WalletLinkError, fail, uuid } from './walletContract.mjs';

const ROUTES = new Map([['/web3/wallet/config', 'GET'], ['/web3/wallet/link', 'GET'], ['/web3/wallet/challenge', 'POST'], ['/web3/wallet/verify', 'POST']]);
const STATUS = { chain: 400, identity: 409, busy: 409, linked: 409, expired: 410,
  missing: 404, used: 409, signature: 403, conflict: 409 };
function body(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, settled = false;
    const done = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', failed); req.removeListener('aborted', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const failed = () => done(new WalletLinkError('input'));
    const aborted = () => done(new WalletLinkError('input'));
    const data = (chunk) => { bytes += chunk.length; if (bytes > 4096) done(new WalletLinkError('size')); else chunks.push(chunk); };
    const end = () => {
      try { done(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { done(new WalletLinkError('input')); }
    };
    const timer = setTimeout(() => done(new WalletLinkError('timeout')), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}
export function createWalletHttpHandler({ service, resolvePlayer, bodyTimeoutMs = 5000, operationTimeoutMs = 12000 } = {}) {
  if (!service || typeof service.origin !== 'string' || ['issue', 'verify', 'loadLink'].some((k) => typeof service[k] !== 'function')
    || typeof resolvePlayer !== 'function' || !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 10 || bodyTimeoutMs > 10000
    || !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 10 || operationTimeoutMs > 60000) fail('configuration');
  const origin = service.origin;
  const bounded = async (pending) => {
    let timer;
    try { return await Promise.race([pending, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new WalletLinkError('storage')), operationTimeoutMs);
    })]); } finally { clearTimeout(timer); }
  };
  return {
    handles: (path) => ROUTES.has(path),
    async handle(req, res, path) {
      req.on('error', () => {}); // A peer abort can emit error after the body listeners have been removed.
      const send = (status, value, close = false) => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', ...(close ? { connection: 'close' } : {}) });
        res.end(JSON.stringify(value));
      };
      try {
        const method = ROUTES.get(path);
        if (!method) { send(404, { ok: false, why: 'missing' }); return; }
        if (req.method !== method) { send(405, { ok: false, why: 'method' }, true); return; }
        if ((method === 'POST' && req.headers.origin !== origin)
          || (req.headers.origin !== undefined && req.headers.origin !== origin)
          || (method === 'GET' && req.headers['sec-fetch-site'] === 'cross-site')) {
          send(403, { ok: false, why: 'origin' }, true); return;
        }
        if (path === '/web3/wallet/config') {
          if (!Number.isSafeInteger(service.chainId) || service.chainId < 1 || service.chainId > 2147483647) fail('configuration');
          send(200, { enabled: true, origin, chainId: service.chainId, proof: 'eoa' }); return;
        }
        const authorization = req.headers.authorization;
        const match = typeof authorization === 'string' && /^Bearer ([^\s,]{1,8192})$/.exec(authorization);
        if (!match) { send(401, { ok: false, why: 'auth' }, true); return; }
        let accountId;
        try { accountId = uuid(await bounded(resolvePlayer(req, { token: match[1] })), 'auth'); }
        catch { send(401, { ok: false, why: 'auth' }, true); return; }
        if (method === 'GET') { send(200, { ok: true, link: await bounded(service.loadLink(accountId)) }); return; }
        if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) {
          send(415, { ok: false, why: 'content_type' }, true); return;
        }
        if (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > 4096) {
          send(413, { ok: false, why: 'size' }, true); return;
        }
        const input = await body(req, bodyTimeoutMs);
        const result = await bounded(path === '/web3/wallet/challenge' ? service.issue(accountId, input) : service.verify(accountId, input));
        send(result.ok ? 200 : (STATUS[result.why] ?? 503), result);
      } catch (error) {
        const code = error instanceof WalletLinkError ? error.code : 'storage';
        if (code === 'input') send(400, { ok: false, why: 'input' }, true);
        else if (code === 'size') send(413, { ok: false, why: 'size' }, true);
        else if (code === 'timeout') send(408, { ok: false, why: 'timeout' }, true);
        else send(503, { ok: false, why: 'unavailable' }, true);
      }
    },
  };
}
