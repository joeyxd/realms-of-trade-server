import { playerKey } from './store.mjs';
import { resolveGmSession } from './gmSession.mjs';
import { validateDocument } from '../src/editor/document.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 5 * 1024 * 1024 + 2048;
const MAX_REVISION = 2147483647;
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  pragma: 'no-cache', vary: 'authorization', 'x-content-type-options': 'nosniff' });

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function bounded(promise, timeoutMs) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}
function readBody(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, settled = false;
    const done = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end);
      req.removeListener('error', failed); req.removeListener('aborted', aborted);
      if (error) { req.resume?.(); reject(error); } else resolve(value);
    };
    const data = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY) done(Object.assign(new Error('size'), { code: 'size' }));
      else chunks.push(buffer);
    };
    const end = () => {
      try { done(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { done(Object.assign(new Error('input'), { code: 'input' })); }
    };
    const failed = () => done(Object.assign(new Error('input'), { code: 'input' }));
    const aborted = () => done(Object.assign(new Error('input'), { code: 'input' }));
    const timer = setTimeout(() => done(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}
function checkedHead(raw) {
  if (raw === null) return null;
  if (!exactKeys(raw, ['revision', 'document', 'savedAt']) || !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 || raw.revision > MAX_REVISION) {
    throw new Error('response');
  }
  if (raw.revision === 0 && raw.document === null && raw.savedAt === null) return { revision: 0, document: null, savedAt: null };
  if (raw.revision < 1 || typeof raw.savedAt !== 'string' || raw.savedAt.length > 64) throw new Error('response');
  return { revision: raw.revision, document: validateDocument(raw.document), savedAt: raw.savedAt };
}

export function createGmDraftHandler({ store, resolvePlayer, accountIds, worldId, seed, baseRevision = 'terrain-s21-v1',
  validateReferences, publication = null, allowMemory = false, timeoutMs = 10_000 } = {}) {
  if (!store || typeof resolvePlayer !== 'function' || typeof worldId !== 'string' || !worldId.trim() || worldId.length > 100 ||
      !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || typeof baseRevision !== 'string' ||
      !baseRevision || baseRevision.length > 128 || typeof validateReferences !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('Invalid GM draft handler configuration');

  const requests = new Map();
  let ready = false;
  let preparationReady = false, preparing = false;
  const scope = Object.freeze({ worldId, seed, baseRevision });
  const send = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(value));
  };
  const unavailable = () => ({ ok: false, code: 'gm_drafts_unavailable' });
  const noteRequest = (accountId) => {
    const now = Date.now();
    for (const [id, state] of requests) if (now - state.started >= 60_000) requests.delete(id);
    const state = requests.get(accountId);
    if (!state && requests.size >= 32) return false;
    if (!state || now - state.started >= 60_000) { requests.set(accountId, { started: now, count: 1 }); return true; }
    if (state.count >= 30) return false;
    state.count++; return true;
  };
  return {
    async prepare() {
      ready = false;
      try {
        if (store.durable !== true && !allowMemory) return false;
        if (typeof store.checkGmDrafts !== 'function') return false;
        const result = await bounded(store.checkGmDrafts(), timeoutMs);
        ready = result?.version === 1;
      } catch { ready = false; }
      preparationReady = false;
      if (ready && publication) {
        try { await bounded(publication.prepare(), timeoutMs); preparationReady = true; } catch { /* Draft saves stay available. */ }
      }
      return ready;
    },
    async handle(req, res, { prepareRevision = false } = {}) {
      req.on?.('error', () => {});
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.once?.('aborted', abort); res.once?.('close', abort);
      try {
        const auth = await resolveGmSession({ authorization: req.headers?.authorization, request: req,
          resolvePlayer, accountIds, signal: controller.signal, timeoutMs });
        if (auth.aborted || res.destroyed || res.writableEnded || req.aborted) return true;
        if (auth.status !== 200) { send(res, auth.status, auth.body); return true; }
        const method = req.method;
        const allowed = prepareRevision ? ['POST'] : ['GET', 'PUT'];
        if (!allowed.includes(method)) { res.writeHead(405, { ...JSON_HEADERS, allow: allowed.join(', ') }); res.end(JSON.stringify({ ok: false, code: 'method' })); return true; }
        if (!ready) { send(res, 503, unavailable()); return true; }
        let accountId;
        try { accountId = playerKey(auth.body.accountId); } catch { send(res, 503, unavailable()); return true; }
        if (!noteRequest(accountId)) { send(res, 429, { ok: false, code: 'gm_draft_rate' }); return true; }
        if (method === 'GET') {
          const loaded = await bounded(store.loadGmDraft({ world: worldId, owner: accountId }), timeoutMs);
          const head = checkedHead(loaded ?? { revision: 0, document: null, savedAt: null });
          send(res, 200, { ok: true, durable: store.durable === true, scope, head }); return true;
        }
        if (typeof req.headers?.['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) {
          send(res, 415, { ok: false, code: 'content_type' }); return true;
        }
        const length = req.headers?.['content-length'];
        if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_BODY)) {
          send(res, 413, { ok: false, code: 'size' }); return true;
        }
        let input;
        try { input = await readBody(req, timeoutMs); }
        catch (error) {
          const code = error?.code;
          send(res, code === 'size' ? 413 : code === 'timeout' ? 408 : 400,
            { ok: false, code: code === 'size' ? 'size' : code === 'timeout' ? 'timeout' : 'input' }); return true;
        }
        if (prepareRevision) {
          if (!exactKeys(input, ['expectedRevision']) || !Number.isSafeInteger(input.expectedRevision) ||
              input.expectedRevision < 1 || input.expectedRevision > MAX_REVISION) {
            send(res, 400, { ok: false, code: 'operation' }); return true;
          }
          if (!preparationReady) { send(res, 503, { ok: false, code: 'gm_preparation_unavailable' }); return true; }
          if (preparing) { send(res, 503, { ok: false, code: 'gm_preparation_busy' }); return true; }
          if (controller.signal.aborted || req.aborted) return true;
          preparing = true;
          let buildStarted = false;
          try {
            const head = checkedHead(await bounded(store.loadGmDraft({ world: worldId, owner: accountId }), timeoutMs));
            if (!head?.document || head.revision !== input.expectedRevision) {
              send(res, 409, { ok: false, code: 'gm_draft_conflict', revision: head?.revision ?? 0 }); return true;
            }
            let document;
            try { document = validateReferences(head.document); }
            catch { send(res, 400, { ok: false, code: 'document' }); return true; }
            if (controller.signal.aborted || req.aborted) return true;
            // Keep exclusion until the build actually finishes, including after HTTP timeout.
            buildStarted = true;
            const building = Promise.resolve().then(() => publication.build({ document, draftRevision: head.revision }));
            building.finally(() => { preparing = false; }).catch(() => {});
            let preparation;
            try { preparation = await bounded(building, timeoutMs); }
            catch { send(res, 503, { ok: false, code: 'gm_preparation_unavailable' }); return true; }
            if (controller.signal.aborted || req.aborted) return true;
            const current = checkedHead(await bounded(store.loadGmDraft({ world: worldId, owner: accountId }), timeoutMs));
            if (current?.revision !== head.revision) {
              send(res, 409, { ok: false, code: 'gm_draft_conflict', revision: current?.revision ?? 0 }); return true;
            }
            send(res, 200, { ok: true, durable: store.durable === true, scope, headRevision: head.revision, preparation });
          } finally { if (!buildStarted) preparing = false; }
          return true;
        }
        if (!exactKeys(input, ['operationId', 'expectedRevision', 'document']) || typeof input.operationId !== 'string' ||
            !UUID.test(input.operationId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(input.operationId) ||
            !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
            input.expectedRevision >= MAX_REVISION) { send(res, 400, { ok: false, code: 'operation' }); return true; }
        let document;
        try {
          document = validateDocument(input.document);
          if (document.version !== 2 || document.base.seed !== seed || document.base.revision !== baseRevision) throw new Error('document');
          const referenced = validateReferences(document);
          if (referenced === false) throw new Error('document');
          if (referenced !== undefined && referenced !== true) document = validateDocument(referenced);
          if (document.base.seed !== seed || document.base.revision !== baseRevision) throw new Error('document');
        } catch { send(res, 400, { ok: false, code: 'document' }); return true; }
        if (controller.signal.aborted || res.destroyed || res.writableEnded || req.aborted) return true;
        const result = await bounded(store.saveGmDraft({ world: worldId, owner: accountId,
          operationId: input.operationId.toLowerCase(), expectedRevision: input.expectedRevision, document }), timeoutMs);
        if (result?.ok === false && result.why === 'conflict' && Number.isSafeInteger(result.revision) && result.revision >= 0) {
          send(res, 409, { ok: false, code: 'gm_draft_conflict', revision: result.revision }); return true;
        }
        if (result?.ok === false && result.why === 'operation') { send(res, 400, { ok: false, code: 'operation' }); return true; }
        if (!result || result.ok !== true || typeof result.replay !== 'boolean') throw new Error('response');
        const head = checkedHead(result.head);
        if (!head) throw new Error('response');
        send(res, 200, { ok: true, durable: store.durable === true, scope, head, replay: result.replay });
      } catch {
        send(res, 503, unavailable());
      } finally {
        req.removeListener?.('aborted', abort); res.removeListener?.('close', abort);
      }
      return true;
    },
  };
}
