import { createHash } from 'node:crypto';
import { playerKey } from './store.mjs';
import { resolveGmSession } from './gmSession.mjs';
import { MAX_TILE_BATCH, MAX_TILE_BATCH_BYTES } from './gmDraftStore.mjs';
import { validateDocument } from '../src/editor/document.js';
import { TERRAIN_TILES_NOT_READY, TILE_MAX_BYTES, isTerrainTilesDocument } from '../src/editor/terrainTiles.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BODY = 5 * 1024 * 1024 + 2048;
// GM07b2 S4: a tile upload body is at most 64 frames of (u32 length + at most 64 KiB), so 4 MiB of tile bytes.
const MAX_TILE_BODY = MAX_TILE_BATCH * 4 + MAX_TILE_BATCH_BYTES;
const MAX_REVISION = 2147483647;
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  pragma: 'no-cache', vary: 'authorization', 'x-content-type-options': 'nosniff' });
const TILE_HEADERS = Object.freeze({ 'content-type': 'application/octet-stream', 'cache-control': 'no-store',
  pragma: 'no-cache', vary: 'authorization', 'x-content-type-options': 'nosniff' });
const TILE_CODES = Object.freeze(['tile_invalid', 'tile_batch', 'tile_hash']);
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

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
// A bounded request body as one Buffer: over `max` bytes it stops with code 'size' (413), on timeout 'timeout'.
function readBytes(req, timeoutMs, max) {
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
      if (bytes > max) done(Object.assign(new Error('size'), { code: 'size' }));
      else chunks.push(buffer);
    };
    const end = () => done(null, Buffer.concat(chunks));
    const failed = () => done(Object.assign(new Error('input'), { code: 'input' }));
    const aborted = () => done(Object.assign(new Error('input'), { code: 'input' }));
    const timer = setTimeout(() => done(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}
async function readBody(req, timeoutMs) {
  const bytes = await readBytes(req, timeoutMs, MAX_BODY);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Object.assign(new Error('input'), { code: 'input' }); }
}
// GM07b2 S4/S5: tiles travel as repeated (u32 little-endian length + bytes). Parsing an upload returns { tiles } in
// request order (private copies) or { code }: 'input' for a truncated or empty body, 'tile_batch' over 64 tiles or
// 4 MiB of tile bytes, 'tile_invalid' for a frame of 0 or more than 64 KiB.
function tileFrames(body) {
  const tiles = [];
  let offset = 0, total = 0;
  while (offset < body.length) {
    if (tiles.length >= MAX_TILE_BATCH) return { code: 'tile_batch' };
    if (body.length - offset < 4) return { code: 'input' };
    const length = body.readUInt32LE(offset);
    offset += 4;
    if (length > body.length - offset) return { code: 'input' };
    if (length < 1 || length > TILE_MAX_BYTES) return { code: 'tile_invalid' };
    total += length;
    if (total > MAX_TILE_BATCH_BYTES) return { code: 'tile_batch' };
    tiles.push(new Uint8Array(body.subarray(offset, offset + length)));
    offset += length;
  }
  return tiles.length > 0 ? { tiles } : { code: 'input' };
}
function encodeTileFrames(tiles) {
  const body = Buffer.allocUnsafe(tiles.reduce((size, bytes) => size + 4 + bytes.length, 0));
  let offset = 0;
  for (const bytes of tiles) {
    body.writeUInt32LE(bytes.length, offset); offset += 4;
    body.set(bytes, offset); offset += bytes.length;
  }
  return body;
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

/**
 * GM draft routes. The world is the server's configured `worldId` for every route (drafts, prepare, terrain tiles):
 * no request names it. `validateTile` (createGmTerrainTileValidator) checks each uploaded terrain tile against the map
 * rules of the base revision; without it, or without a tile store, the tile routes answer 503 gm_drafts_unavailable.
 */
export function createGmDraftHandler({ store, resolvePlayer, accountIds, worldId, seed, baseRevision = 'terrain-s21-v1',
  validateReferences, validateTile = null, publication = null, content = null, allowMemory = false, timeoutMs = 10_000 } = {}) {
  if (!store || typeof resolvePlayer !== 'function' || typeof worldId !== 'string' || !worldId.trim() || worldId.length > 100 ||
      !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || typeof baseRevision !== 'string' ||
      !baseRevision || baseRevision.length > 128 || typeof validateReferences !== 'function' ||
      (validateTile !== null && typeof validateTile !== 'function') ||
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
  const notReady = () => ({ ok: false, code: TERRAIN_TILES_NOT_READY });
  // S9: every v5 save, tile upload and tile read probes SQL042 first; v2-v4 drafts never do.
  const tilesReady = async () => {
    if (typeof store.checkGmTerrainTiles !== 'function') return false;
    try { return (await bounded(store.checkGmTerrainTiles(), timeoutMs))?.version === 1; } catch { return false; }
  };
  const tileStore = () => typeof store.putTerrainTiles === 'function' && typeof store.getTerrainTiles === 'function';
  // S6: the tiles of a document v5 from the store, at most MAX_TILE_BATCH hashes per call, into one Map sha256 -> bytes
  // (absent hashes stay absent; the caller answers tiles_missing).
  const readDocumentTiles = async (document) => {
    const hashes = [...new Set(document.terrain.tiles.map((reference) => reference[2]))], tiles = new Map();
    for (let start = 0; start < hashes.length; start += MAX_TILE_BATCH) {
      const batch = hashes.slice(start, start + MAX_TILE_BATCH);
      const found = await bounded(store.getTerrainTiles({ world: worldId, hashes: batch }), timeoutMs);
      if (!(found instanceof Map)) throw new Error('response');
      for (const hash of batch) if (found.get(hash) instanceof Uint8Array) tiles.set(hash, found.get(hash));
    }
    return tiles;
  };
  const failed = (error) => {
    const code = typeof error?.code === 'string' ? error.code : null;
    return { status: code === 'size' ? 413 : code === 'timeout' ? 408 : 400, body: { ok: false,
      code: code === 'size' ? 'size' : code === 'timeout' ? 'timeout' : 'input' } };
  };
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
    async handle(req, res, { prepareRevision = false, registerRevision = false, activateRevision = false,
      uploadTiles = false, readTiles = false } = {}) {
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
        const allowed = prepareRevision || activateRevision || uploadTiles || readTiles ? ['POST']
          : registerRevision ? ['GET', 'POST'] : ['GET', 'PUT'];
        if (!allowed.includes(method)) { res.writeHead(405, { ...JSON_HEADERS, allow: allowed.join(', ') }); res.end(JSON.stringify({ ok: false, code: 'method' })); return true; }
        if (!ready) { send(res, 503, unavailable()); return true; }
        let accountId;
        try { accountId = playerKey(auth.body.accountId); } catch { send(res, 503, unavailable()); return true; }
        if (!noteRequest(accountId)) { send(res, 429, { ok: false, code: 'gm_draft_rate' }); return true; }
        if ((registerRevision || activateRevision) && !content?.ready) { send(res, 503, { ok: false, code: 'gm_content_unavailable' }); return true; }
        if ((uploadTiles || readTiles) && (!tileStore() || uploadTiles && !validateTile)) { send(res, 503, unavailable()); return true; }
        if (registerRevision && method === 'GET') {
          send(res, 200, { ok: true, ...await content.list() }); return true;
        }
        if (uploadTiles) {
          // S4: POST /api/gm/terrain-tiles, body = frames (u32 LE length + MNT1 bytes), at most 64 tiles and 4 MiB.
          if (typeof req.headers?.['content-type'] !== 'string' || !/^application\/octet-stream$/i.test(req.headers['content-type'])) {
            send(res, 415, { ok: false, code: 'content_type' }); return true;
          }
          const length = req.headers?.['content-length'];
          if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_TILE_BODY)) {
            send(res, 413, { ok: false, code: 'size' }); return true;
          }
          if (!await tilesReady()) { send(res, 503, notReady()); return true; }
          let body;
          try { body = await readBytes(req, timeoutMs, MAX_TILE_BODY); }
          catch (error) { const { status, body: answer } = failed(error); send(res, status, answer); return true; }
          const frames = tileFrames(body);
          if (frames.code) { send(res, 400, { ok: false, code: frames.code }); return true; }
          // Every tile passes the map rules before anything is stored: one bad tile refuses the whole request.
          for (let n = 0; n < frames.tiles.length; n++) {
            try { validateTile(frames.tiles[n]); }
            catch (error) {
              send(res, 400, { ok: false, code: 'tile_invalid', index: n,
                ...(typeof error?.reason === 'string' ? { reason: error.reason } : {}) }); return true;
            }
            // A whole-map upload decodes and checks 64 tiles: let the game loop run between them.
            await nextTurn();
            if (controller.signal.aborted || res.destroyed || res.writableEnded) return true;
          }
          const hashes = frames.tiles.map(sha256Hex);
          const result = await bounded(store.putTerrainTiles({ world: worldId, tiles: frames.tiles }), timeoutMs);
          if (!result || result.ok !== true || !Number.isSafeInteger(result.stored) || result.stored < 0) throw new Error('response');
          send(res, 200, { ok: true, stored: result.stored, hashes }); return true;
        }
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
        catch (error) { const { status, body: answer } = failed(error); send(res, status, answer); return true; }
        if (readTiles) {
          // S5: POST /api/gm/terrain-tiles/read {hashes} answers the frames in request order, or 404 with the missing.
          if (!exactKeys(input, ['hashes']) || !Array.isArray(input.hashes) || input.hashes.length < 1) {
            send(res, 400, { ok: false, code: 'input' }); return true;
          }
          const hashes = input.hashes;
          if (hashes.length > MAX_TILE_BATCH) { send(res, 400, { ok: false, code: 'tile_batch' }); return true; }
          if (hashes.some((hash) => typeof hash !== 'string' || !SHA256.test(hash)) || new Set(hashes).size !== hashes.length) {
            send(res, 400, { ok: false, code: 'tile_hash' }); return true;
          }
          if (!await tilesReady()) { send(res, 503, notReady()); return true; }
          const found = await bounded(store.getTerrainTiles({ world: worldId, hashes }), timeoutMs);
          if (!(found instanceof Map)) throw new Error('response');
          const missing = hashes.filter((hash) => !(found.get(hash) instanceof Uint8Array));
          if (missing.length > 0) {
            send(res, 404, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing }); return true;
          }
          const body = encodeTileFrames(hashes.map((hash) => found.get(hash)));
          if (res.destroyed || res.writableEnded) return true;
          res.writeHead(200, { ...TILE_HEADERS, 'content-length': body.length }); res.end(body);
          return true;
        }
        if (activateRevision) {
          if (!exactKeys(input, ['operationId', 'expectedGeneration', 'revisionId']) || typeof input.operationId !== 'string' ||
              !UUID.test(input.operationId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(input.operationId) ||
              !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0 || input.expectedGeneration >= MAX_REVISION ||
              input.revisionId !== null && !/^[a-f0-9]{64}$/.test(input.revisionId)) {
            send(res, 400, { ok: false, code: 'operation' }); return true;
          }
          if (controller.signal.aborted || req.aborted) return true;
          // A disconnect after this point is not cancellation of the durable operation.
          const result = await content.activate({ ...input, operationId: input.operationId.toLowerCase() });
          if (result?.ok === false) { send(res, 409, { ok: false, code: 'gm_content_conflict' }); return true; }
          send(res, 200, result); return true;
        }
        if (prepareRevision || registerRevision) {
          if (!exactKeys(input, registerRevision ? ['expectedRevision', 'revisionId'] : ['expectedRevision']) ||
              registerRevision && !/^[a-f0-9]{64}$/.test(input.revisionId) || !Number.isSafeInteger(input.expectedRevision) ||
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
            // GM07b2c S6: a document v5 is built from its tiles, read from the store once (at most 64 per call) into
            // one Map that the build compiles and the registry retains; nothing reads them again in this request.
            let tiles = null;
            if (isTerrainTilesDocument(document)) {
              if (!tileStore()) { send(res, 503, unavailable()); return true; }
              if (!await tilesReady()) { send(res, 503, notReady()); return true; }
              tiles = await readDocumentTiles(document);
              const missing = document.terrain.tiles.map((reference) => reference[2]).filter((hash) => !tiles.has(hash));
              if (missing.length > 0) {
                send(res, 409, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing }); return true;
              }
            }
            if (controller.signal.aborted || req.aborted) return true;
            // Keep exclusion until the build actually finishes, including after HTTP timeout.
            buildStarted = true;
            const building = Promise.resolve().then(() => publication.build({ document, draftRevision: head.revision,
              ...(tiles ? { tiles } : {}) }));
            building.finally(() => { preparing = false; }).catch(() => {});
            let preparation;
            try { preparation = await bounded(building, timeoutMs); }
            catch (error) {
              // The whole-map terrain rules of a v5 run here (draft saves check each tile alone): a refusal names the rule.
              if (error?.code === 'gm_terrain_invalid') {
                send(res, 400, { ok: false, code: 'document', reason: typeof error.reason === 'string' ? error.reason : 'terrain' });
              } else send(res, 503, { ok: false, code: 'gm_preparation_unavailable' });
              return true;
            }
            if (controller.signal.aborted || req.aborted) return true;
            const current = checkedHead(await bounded(store.loadGmDraft({ world: worldId, owner: accountId }), timeoutMs));
            if (current?.revision !== head.revision) {
              send(res, 409, { ok: false, code: 'gm_draft_conflict', revision: current?.revision ?? 0 }); return true;
            }
            if (registerRevision) {
              if (preparation.revision?.revisionId !== input.revisionId) {
                send(res, 409, { ok: false, code: 'gm_content_changed' }); return true;
              }
              const registered = tiles ? await content.register(preparation.revision, { tiles }) : await content.register(preparation.revision);
              send(res, 200, { ok: true, ...registered }); return true;
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
          if (![2, 3, 4, 5].includes(document.version) || document.base.seed !== seed || document.base.revision !== baseRevision) throw new Error('document');
          const referenced = validateReferences(document);
          if (referenced === false) throw new Error('document');
          if (referenced !== undefined && referenced !== true) document = validateDocument(referenced);
          if (document.base.seed !== seed || document.base.revision !== baseRevision) throw new Error('document');
        } catch { send(res, 400, { ok: false, code: 'document' }); return true; }
        // GM07b2: a document v5 is saved with tile references; its tiles must already be uploaded (S4).
        if (isTerrainTilesDocument(document) && !await tilesReady()) { send(res, 503, notReady()); return true; }
        if (controller.signal.aborted || res.destroyed || res.writableEnded || req.aborted) return true;
        const result = await bounded(store.saveGmDraft({ world: worldId, owner: accountId,
          operationId: input.operationId.toLowerCase(), expectedRevision: input.expectedRevision, document }), timeoutMs);
        if (result?.ok === false && result.why === 'conflict' && Number.isSafeInteger(result.revision) && result.revision >= 0) {
          send(res, 409, { ok: false, code: 'gm_draft_conflict', revision: result.revision }); return true;
        }
        // A refused precondition answers 409 like a revision conflict: nothing was written (no receipt), so the client
        // uploads the listed tiles and retries the same operation id.
        if (result?.ok === false && result.why === 'tiles_missing' && Array.isArray(result.missing)) {
          send(res, 409, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing: result.missing }); return true;
        }
        if (result?.ok === false && result.why === 'operation') { send(res, 400, { ok: false, code: 'operation' }); return true; }
        if (!result || result.ok !== true || typeof result.replay !== 'boolean') throw new Error('response');
        const head = checkedHead(result.head);
        if (!head) throw new Error('response');
        send(res, 200, { ok: true, durable: store.durable === true, scope, head, replay: result.replay });
      } catch (error) {
        const code = error?.code;
        const known = ['gm_content_busy', 'gm_content_conflict', 'gm_content_changed', 'gm_content_missing',
          'gm_content_incompatible', 'gm_content_candidate', 'gm_content_routes', 'gm_content_occupied',
          'gm_content_operation', 'gm_content_limit', 'gm_resource_unavailable', 'gm_resource_roster'];
        if (known.includes(code)) send(res, 409, { ok: false, code });
        else if (code === TERRAIN_TILES_NOT_READY && !registerRevision && !activateRevision) send(res, 503, notReady());
        else if (TILE_CODES.includes(code) && (uploadTiles || readTiles)) send(res, 400, { ok: false, code });
        else send(res, 503, registerRevision || activateRevision ? { ok: false, code: 'gm_content_unavailable' } : unavailable());
      } finally {
        req.removeListener?.('aborted', abort); res.removeListener?.('close', abort);
      }
      return true;
    },
  };
}
