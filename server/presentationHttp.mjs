import { resolveGmSession } from './gmSession.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff' };
const MAX_BODY = 8192;
function readBody(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const done = (error, value) => {
      clearTimeout(timer); req.removeListener('data', data); req.removeListener('end', end);
      req.removeListener('error', failed); req.removeListener('aborted', failed);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const failed = () => done(new Error('input'));
    const data = chunk => { size += chunk.length; if (size > MAX_BODY) done(new Error('size')); else chunks.push(chunk); };
    const end = () => { try { done(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { failed(); } };
    const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', failed);
  });
}
export function createPresentationHandler({ store, resolvePlayer, accountIds, timeoutMs = 10_000 }) {
  return async function handle(req, res, gm = false) {
    const send = (status, body, extra = {}) => {
      if (!res.destroyed && !res.writableEnded) res.writeHead(status, { ...HEADERS, ...extra }).end(body === undefined ? undefined : JSON.stringify(body));
    };
    const controller = new AbortController(), abort = () => controller.abort();
    req.once('aborted', abort); res.once('close', abort);
    try {
      if (!gm) {
        if (req.method !== 'GET') { send(405, { ok: false, code: 'method' }, { allow: 'GET' }); return; }
        const { revision, document } = await store.get(), etag = `"p${revision}"`;
        send(req.headers['if-none-match'] === etag ? 304 : 200,
          req.headers['if-none-match'] === etag ? undefined : { revision, document }, { etag }); return;
      }
      if (!accountIds?.length || typeof resolvePlayer !== 'function') { send(403, { ok: false, code: 'gm_unavailable' }); return; }
      const auth = await resolveGmSession({ authorization: req.headers.authorization, request: req,
        resolvePlayer, accountIds, timeoutMs, signal: controller.signal });
      if (auth.aborted || req.aborted || res.destroyed) return;
      if (auth.status !== 200) { send(auth.status, auth.body); return; }
      if (req.method !== 'PUT') { send(405, { ok: false, code: 'method' }, { allow: 'PUT' }); return; }
      if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); send(413, { error: 'invalid', why: 'size' }); return; }
      let body;
      try { body = await readBody(req, timeoutMs); }
      catch (error) { send(error.message === 'size' ? 413 : error.message === 'timeout' ? 408 : 400, { error: 'invalid', why: error.message }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'document,expectedRevision') {
        send(400, { error: 'invalid', why: 'shape' }); return;
      }
      const result = await store.put({ ...body, updatedBy: auth.body.accountId });
      if (result.ok) send(200, { revision: result.revision });
      else if (result.error === 'stale') send(409, { error: 'stale', revision: result.revision });
      else send(400, { error: 'invalid', why: result.why });
    } catch { send(503, { ok: false, code: 'presentation_unavailable' }); }
    finally { req.removeListener('aborted', abort); res.removeListener('close', abort); }
  };
}
