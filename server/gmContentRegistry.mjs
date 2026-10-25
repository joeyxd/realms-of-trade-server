import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, PREPARATION_SCHEMA, PREPARATION_VERSION } from '../src/editor/publicationArtifact.js';
import { createGmContentLock } from './gmContentLock.mjs';
import { DOMAIN_DOCUMENT_VERSION, TILE_MAX_BYTES, decodeTile, documentDomain, encodeTile, isTerrainTilesDocument,
  validateTileReferences } from '../src/editor/terrainTiles.js';

const MAX_REVISIONS = 100;
const MAX_BLOB_BYTES = 1024 * 1024 * 1024;
const MAX_OPERATIONS = 4096;
const HASH = /^[a-f0-9]{64}$/;
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ALLOWED_TOP = new Set(['index.html', 'package.json', 'package-lock.json']);

export class GmContentRegistryError extends Error {
  constructor(code) { super(`GM content registry unavailable: ${code}`); this.name = 'GmContentRegistryError'; this.code = code; }
}

function fail(code) { throw new GmContentRegistryError(code); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function bytes(value) { return Buffer.from(canonicalJson(value), 'utf8'); }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') ||
      value.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  return ALLOWED_TOP.has(value) || value.startsWith('assets/') || value.startsWith('src/') ||
    /^server\/gmPublication[^/]*\.mjs$/.test(value) ||
    ['server/gmDraftValidation.mjs', 'server/gmContentObstacles.mjs'].includes(value);
}

// GM07b2c S7: the terrain of a document v5 revision (gmPublication.mjs builds it): this fixed key set, the
// document's own tile references, and the sha256 of the compiled heights and weights.
const TILE_TERRAIN_FORMAT = 'marea.gm.terrain-tiles';
const TILE_TERRAIN_KEYS = 'format,heightsSha256,materialsSha256,tileSize,tiles,version';

// GM11b3: a v6 revision's terrain is version 2 and also names the document's domain; the tiles are checked over it.
const DOMAIN_TERRAIN_KEYS = 'domain,format,heightsSha256,materialsSha256,tileSize,tiles,version';

function tileTerrainReferences(content) {
  const document = content.document, terrain = content.terrain, grown = document.version === DOMAIN_DOCUMENT_VERSION;
  try {
    const references = validateTileReferences(document.terrain?.tiles, grown ? documentDomain(document) : document.base?.revision);
    if (isObject(terrain) && Object.keys(terrain).sort().join(',') === (grown ? DOMAIN_TERRAIN_KEYS : TILE_TERRAIN_KEYS) &&
        terrain.format === TILE_TERRAIN_FORMAT && (!grown || canonicalJson(terrain.domain) === canonicalJson(document.terrain.domain)) &&
        terrain.version === (grown ? 2 : 1) && terrain.tileSize === document.terrain.tileSize && HASH.test(terrain.heightsSha256) &&
        HASH.test(terrain.materialsSha256) && canonicalJson(terrain.tiles) === canonicalJson(references)) return references;
  } catch { /* refused below */ }
  return fail('artifact');
}

// S8: a retained terrain tile is canonical MNT1 for its reference: it decodes in the domain of the document's base
// revision, its own key is the reference's key, and encoding the decoded tile gives the same bytes.
function canonicalTile(body, file) {
  try {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const tile = decodeTile(bytes, file.baseRevision);
    if (tile.tx !== file.tx || tile.tz !== file.tz) return false;
    return Buffer.compare(Buffer.from(encodeTile(tile, file.baseRevision)), Buffer.from(bytes)) === 0;
  } catch { return false; }
}

function contained(base, target) {
  const rel = path.relative(base, target);
  return rel !== '' && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function normalizeState(value, worldId) {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'generation,operations,revisionId,version,worldId' ||
      value.version !== 1 || value.worldId !== worldId || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
      !(value.revisionId === null || HASH.test(value.revisionId)) || !isObject(value.operations) ||
      Object.keys(value.operations).length > MAX_OPERATIONS) fail('state');
  for (const [id, receipt] of Object.entries(value.operations)) {
    if (!OPERATION.test(id) || !isObject(receipt) || !Number.isSafeInteger(receipt.expectedGeneration) ||
        !(receipt.revisionId === null || HASH.test(receipt.revisionId)) || !isObject(receipt.result) ||
        typeof receipt.result.ok !== 'boolean' || typeof receipt.result.replay !== 'boolean' ||
        !Number.isSafeInteger(receipt.result.generation) || !(receipt.result.revisionId === null || HASH.test(receipt.result.revisionId))) fail('state');
  }
  return structuredClone(value);
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Windows does not support opening/syncing directories through Node's file API.
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
  } finally { await handle?.close().catch(() => {}); }
}

export function createGmContentRegistry({ directory, root, worldId, lock = null, fault = async () => {} } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof root !== 'string' || !path.isAbsolute(root) ||
      typeof worldId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(worldId) || typeof fault !== 'function') {
    throw new TypeError('invalid GM content registry configuration');
  }
  const dir = path.resolve(directory), releaseRoot = path.resolve(root);
  const revisionDir = path.join(dir, 'revisions'), blobDir = path.join(dir, 'blobs'), statePath = path.join(dir, 'state.json');
  const lockService = lock ?? createGmContentLock({ directory: dir });
  if (!lockService || typeof lockService.run !== 'function') throw new TypeError('lock.run required');
  let ready = false, prepareTask = null;
  let activeLockAssertion = null;

  async function runLock(callback) {
    try {
      return await lockService.run(async (context = {}) => {
        const assertHeld = typeof context.assertHeld === 'function' ? context.assertHeld : () => {};
        activeLockAssertion = assertHeld;
        try { return await callback({ assertHeld }); }
        finally { activeLockAssertion = null; }
      });
    } catch (error) {
      if (['gm_content_lock_busy', 'gm_content_lock_lost'].includes(error?.code)) fail('gm_content_busy');
      if (error?.code === 'gm_content_lock_unavailable') fail('gm_content_unavailable');
      throw error;
    }
  }

  async function atomicJson(file, value, hook, assertHeld = () => {}) {
    const parent = path.dirname(file), temp = path.join(parent, `.tmp-${randomUUID()}`), body = bytes(value);
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
      await fault(hook);
      assertHeld();
      await rename(temp, file);
      if (hook === 'beforeStateRename') await fault('afterStateRename');
      await syncDirectory(parent);
    } catch (error) {
      await handle?.close().catch(() => {});
      const { unlink } = await import('node:fs/promises');
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async function readState() {
    let text;
    try { text = await readFile(statePath, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') fail('state_missing'); fail('state'); }
    try { return normalizeState(JSON.parse(text), worldId); }
    catch (error) { if (error instanceof GmContentRegistryError) throw error; fail('state'); }
  }

  async function sourceBytes(relative, expectedHash, expectedBytes) {
    if (!safePath(relative) || !HASH.test(expectedHash) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > MAX_BLOB_BYTES) fail('artifact');
    const file = path.resolve(releaseRoot, ...relative.split('/'));
    if (!contained(releaseRoot, file)) fail('artifact');
    try {
      const real = await import('node:fs/promises').then((fs) => fs.realpath(file));
      if (!contained(releaseRoot, real)) fail('artifact');
      const info = await stat(real);
      if (!info.isFile() || info.size !== expectedBytes) fail('dependency');
      const body = await readFile(real);
      if (body.length !== expectedBytes || hash(body) !== expectedHash) fail('dependency');
      return body;
    } catch (error) {
      if (error instanceof GmContentRegistryError) throw error;
      fail('dependency');
    }
  }

  function revisionFiles(revision) {
    const content = revision?.content;
    if (!content || !Array.isArray(content.assets) || !Array.isArray(content.baselineAssets) ||
        !Array.isArray(content.runtime?.files) || !isObject(content.document) ||
        !Array.isArray(content.document.objects) || !Array.isArray(content.document.baseOverrides)) fail('artifact');
    const files = new Map();
    const add = (relative, digest, size) => {
      if (!safePath(relative) || !HASH.test(digest) || !Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB_BYTES) fail('artifact');
      if (files.has(relative)) {
        const old = files.get(relative);
        if (old.sha256 !== digest || old.bytes !== size) fail('artifact');
      } else files.set(relative, { path: relative, sha256: digest, bytes: size });
    };
    // Schema 2 keeps the release's runtime files and manifest files in its audit record; they are retained
    // like every other dependency, as schema 1 retains them from its content.
    const audit = revision.preparedWith;
    for (const item of [...content.assets, ...content.baselineAssets, ...(audit?.baselineAssets ?? [])]) {
      if (!isObject(item) || typeof item.src !== 'string' || !item.src.startsWith('assets/')) fail('artifact');
      add(item.src, item.sha256, item.bytes);
    }
    for (const item of [...content.runtime.files, ...(audit?.runtime.files ?? [])]) {
      if (!isObject(item)) fail('artifact');
      add(item.path, item.sha256, item.bytes);
    }
    const listed = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    // GM07b2c S8: the terrain tiles of a document v5 join the same blobs/<sha256> store and the same budget, with
    // kind 'terrain-tile' and no release path: their bytes come from the caller at retain, never from the release.
    if (isTerrainTilesDocument(content.document)) {
      const baseRevision = content.document.version === DOMAIN_DOCUMENT_VERSION ? documentDomain(content.document) : content.document.base.revision, tiles = new Map();
      for (const [tx, tz, digest, size] of tileTerrainReferences(content)) {
        if (!Number.isSafeInteger(size) || size < 1 || size > TILE_MAX_BYTES) fail('artifact');
        if (!tiles.has(digest)) tiles.set(digest, { kind: 'terrain-tile', baseRevision, tx, tz, sha256: digest, bytes: size });
      }
      listed.push(...tiles.values());
    }
    return listed;
  }

  function validPreparedWith(value) {
    return isObject(value) && Object.keys(value).sort().join(',') === 'baselineAssets,gameVersion,protocolVersion,runtime' &&
      typeof value.gameVersion === 'string' && value.gameVersion.length <= 64 && Number.isSafeInteger(value.protocolVersion) &&
      isObject(value.runtime) && HASH.test(value.runtime.sha256) && Array.isArray(value.runtime.files) &&
      Array.isArray(value.baselineAssets);
  }

  function validateRevision(revision) {
    const current = revision?.version === PREPARATION_VERSION;
    if (!isObject(revision) || Object.keys(revision).sort().join(',') !==
          (current ? 'content,preparedWith,revisionId,schema,version' : 'content,revisionId,schema,version') ||
        revision.schema !== PREPARATION_SCHEMA || ![1, PREPARATION_VERSION].includes(revision.version) ||
        (current && !validPreparedWith(revision.preparedWith)) || !HASH.test(revision.revisionId) ||
        !isObject(revision.content) || revision.content.worldId !== worldId || hash(bytes(revision.content)) !== revision.revisionId) fail('artifact');
    const files = revisionFiles(revision);
    const total = files.reduce((sum, item) => sum + item.bytes, 0);
    if (!Number.isSafeInteger(total) || total > MAX_BLOB_BYTES) fail('gm_content_limit');
    return files;
  }

  async function verifyBlob(file) {
    try {
      const body = await readFile(path.join(blobDir, file.sha256));
      if (body.length !== file.bytes || hash(body) !== file.sha256) fail('dependency');
      if (file.kind === 'terrain-tile' && !canonicalTile(body, file)) fail('dependency');
      return body;
    } catch (error) { if (error instanceof GmContentRegistryError) throw error; fail('dependency'); }
  }

  // `tiles` (a Map) receives the verified bytes of every terrain tile of the revision, sha256 -> Uint8Array.
  async function loadRevision(id, tiles = null) {
    if (!HASH.test(id)) fail('revision');
    let revision;
    try { revision = JSON.parse(await readFile(path.join(revisionDir, `${id}.json`), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') fail('revision_missing'); fail('revision'); }
    const files = validateRevision(revision);
    if (revision.revisionId !== id) fail('artifact');
    for (const file of files) {
      const body = await verifyBlob(file);
      if (tiles && file.kind === 'terrain-tile') tiles.set(file.sha256, new Uint8Array(body));
    }
    return structuredClone(revision);
  }

  // S8: the bytes of a missing terrain tile come from the Map the caller passes (the tiles prepare read from the
  // draft store), checked by length, sha256 and canonical decode before they are written.
  function tileBytes(file, tiles) {
    const bytes = tiles instanceof Map ? tiles.get(file.sha256) : undefined;
    if (!(bytes instanceof Uint8Array) || bytes.length !== file.bytes) fail('dependency');
    const body = Buffer.from(bytes);
    if (hash(body) !== file.sha256 || !canonicalTile(body, file)) fail('dependency');
    return body;
  }

  async function prepare() {
    if (ready) return;
    if (prepareTask) return prepareTask;
    prepareTask = (async () => {
      await mkdir(dir, { recursive: true });
      await mkdir(revisionDir, { recursive: true }); await mkdir(blobDir, { recursive: true });
      try { await readState(); }
      catch (error) {
        if (!(error instanceof GmContentRegistryError) || error.code !== 'state_missing') throw error;
        await runLock(async ({ assertHeld }) => {
          try { await readState(); }
          catch (currentError) {
            if (!(currentError instanceof GmContentRegistryError) || currentError.code !== 'state_missing') throw currentError;
            await atomicJson(statePath, { version: 1, worldId, generation: 0, revisionId: null, operations: {} },
              'beforeInitialStateRename', assertHeld);
          }
        });
      }
      const state = await readState();
      const entries = (await readdir(revisionDir)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      if (entries.length > MAX_REVISIONS) fail('gm_content_limit');
      for (const entry of entries) await loadRevision(entry.slice(0, -5));
      if (state.revisionId !== null) await loadRevision(state.revisionId);
      ready = true;
    })();
    try { await prepareTask; } catch (error) { prepareTask = null; throw error; }
  }

  async function list() {
    if (!ready) fail('not_ready');
    const names = (await readdir(revisionDir)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    const output = [];
    for (const name of names) {
      const revision = await loadRevision(name.slice(0, -5));
      output.push({ revisionId: revision.revisionId, objects: revision.content.document.objects.length,
        baseChanges: revision.content.document.baseOverrides.length });
    }
    return output;
  }

  async function load(id) {
    if (!ready) fail('not_ready');
    return loadRevision(id);
  }

  /** GM07b2c: a revision and its terrain tiles (Map sha256 -> bytes, empty unless a document v5), all verified. */
  async function loadWithTiles(id) {
    if (!ready) fail('not_ready');
    const tiles = new Map();
    const revision = await loadRevision(id, tiles);
    return { revision, tiles };
  }

  async function retainUnderLock(revision, tiles = null) {
    if (!ready) fail('not_ready');
    const files = validateRevision(revision);
    const id = revision.revisionId, target = path.join(revisionDir, `${id}.json`);
    try {
      const existing = await loadRevision(id);
      // A schema 2 id names the content only: the same content prepared by another release is already retained,
      // and the first audit record stays.
      if (existing.version === PREPARATION_VERSION && revision.version === PREPARATION_VERSION
        ? canonicalJson(existing.content) !== canonicalJson(revision.content) : canonicalJson(existing) !== canonicalJson(revision)) fail('artifact');
      return { revisionId: id, objects: revision.content.document.objects.length, baseChanges: revision.content.document.baseOverrides.length };
    } catch (error) {
      if (!(error instanceof GmContentRegistryError) || error.code !== 'revision_missing') throw error;
    }

    const existingRevisions = (await readdir(revisionDir)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    if (existingRevisions.length >= MAX_REVISIONS) fail('gm_content_limit');
    let used = 0;
    for (const name of [...await readdir(blobDir).then((names) => names.map((entry) => path.join(blobDir, entry))),
      ...existingRevisions.map((entry) => path.join(revisionDir, entry))]) {
      try { const info = await stat(name); if (info.isFile()) used += info.size; }
      catch { fail('storage'); }
    }
    const missingByHash = new Map();
    for (const file of files) {
      const blob = path.join(blobDir, file.sha256);
      try {
        const info = await stat(blob);
        if (!info.isFile() || info.size !== file.bytes || hash(await readFile(blob)) !== file.sha256) fail('dependency');
      } catch (error) {
        if (error instanceof GmContentRegistryError) throw error;
        if (error?.code !== 'ENOENT') fail('storage');
        if (!missingByHash.has(file.sha256)) missingByHash.set(file.sha256, file);
      }
    }
    const missing = [...missingByHash.values()];
    // Every missing terrain tile is checked against its source before any blob is written: a revision whose tiles
    // are missing or corrupt leaves nothing behind.
    const tileBodies = new Map(missing.filter((file) => file.kind === 'terrain-tile').map((file) => [file.sha256, tileBytes(file, tiles)]));
    const addedBytes = missing.reduce((sum, file) => sum + file.bytes, 0);
    const revisionBytes = bytes(revision).length;
    if (used + addedBytes + revisionBytes > MAX_BLOB_BYTES) fail('gm_content_limit');
    for (const file of missing) {
      const body = file.kind === 'terrain-tile' ? tileBodies.get(file.sha256) : await sourceBytes(file.path, file.sha256, file.bytes);
      const temp = path.join(blobDir, `.tmp-${randomUUID()}`);
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600); await handle.writeFile(body); await handle.sync(); await handle.close(); handle = null;
        await fault('beforeBlobRename'); await rename(temp, path.join(blobDir, file.sha256)); await syncDirectory(blobDir);
      } catch (error) {
        await handle?.close().catch(() => {});
        const { unlink } = await import('node:fs/promises'); await unlink(temp).catch(() => {});
        if (error?.code === 'EEXIST') {
          const stored = await readFile(path.join(blobDir, file.sha256));
          if (hash(stored) !== file.sha256 || stored.length !== file.bytes) fail('dependency');
        } else throw error;
      }
    }
    for (const file of files) await verifyBlob(file);
    await atomicJson(target, revision, 'beforeRevisionRename');
    return { revisionId: id, objects: revision.content.document.objects.length, baseChanges: revision.content.document.baseOverrides.length };
  }

  // `tiles` (GM07b2c): Map sha256 -> bytes, the source of the terrain tiles of a document v5 not yet in blobs/.
  async function retain(revision, { tiles = null } = {}) {
    if (!ready) fail('not_ready');
    return runLock(() => retainUnderLock(revision, tiles));
  }

  async function state() {
    if (!ready) fail('not_ready');
    const current = await readState();
    return { generation: current.generation, revisionId: current.revisionId, operations: current.operations };
  }

  async function switchRevision({ operationId, expectedGeneration, revisionId } = {}) {
    if (!ready || !OPERATION.test(operationId ?? '') || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 ||
        !(revisionId === null || HASH.test(revisionId))) fail('operation');
    if (revisionId !== null) await loadRevision(revisionId);
    const current = await readState(), existing = current.operations[operationId];
    if (existing) {
      if (existing.expectedGeneration !== expectedGeneration || existing.revisionId !== revisionId) fail('operation');
      return { ...structuredClone(existing.result), replay: true };
    }
    if (Object.keys(current.operations).length >= MAX_OPERATIONS) fail('gm_content_limit');
    let result;
    if (current.generation !== expectedGeneration) {
      result = { ok: false, replay: false, generation: current.generation, revisionId: current.revisionId };
    } else {
      if (current.generation >= Number.MAX_SAFE_INTEGER) fail('gm_content_limit');
      result = { ok: true, replay: false, generation: current.generation + 1, revisionId };
    }
    const next = structuredClone(current);
    if (result.ok) { next.generation = result.generation; next.revisionId = revisionId; }
    next.operations[operationId] = { expectedGeneration, revisionId, result };
    if (!activeLockAssertion) fail('gm_content_busy');
    await atomicJson(statePath, next, 'beforeStateRename', activeLockAssertion);
    return structuredClone(result);
  }

  return { prepare, withLock: (callback) => runLock(callback), list, load, loadWithTiles, retain, state,
    switch: switchRevision };
}
