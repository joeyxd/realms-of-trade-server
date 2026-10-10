import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, PREPARATION_SCHEMA } from '../src/editor/publicationArtifact.js';
import { createGmContentLock } from './gmContentLock.mjs';

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
    /^server\/gmPublication[^/]*\.mjs$/.test(value);
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
    for (const item of [...content.assets, ...content.baselineAssets]) {
      if (!isObject(item) || typeof item.src !== 'string' || !item.src.startsWith('assets/')) fail('artifact');
      add(item.src, item.sha256, item.bytes);
    }
    for (const item of content.runtime.files) {
      if (!isObject(item)) fail('artifact');
      add(item.path, item.sha256, item.bytes);
    }
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  function validateRevision(revision) {
    if (!isObject(revision) || Object.keys(revision).sort().join(',') !== 'content,revisionId,schema,version' ||
        revision.schema !== PREPARATION_SCHEMA || revision.version !== 1 || !HASH.test(revision.revisionId) ||
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
      return body;
    } catch (error) { if (error instanceof GmContentRegistryError) throw error; fail('dependency'); }
  }

  async function loadRevision(id) {
    if (!HASH.test(id)) fail('revision');
    let revision;
    try { revision = JSON.parse(await readFile(path.join(revisionDir, `${id}.json`), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') fail('revision_missing'); fail('revision'); }
    const files = validateRevision(revision);
    if (revision.revisionId !== id) fail('artifact');
    for (const file of files) await verifyBlob(file);
    return structuredClone(revision);
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

  async function retainUnderLock(revision) {
    if (!ready) fail('not_ready');
    const files = validateRevision(revision);
    const id = revision.revisionId, target = path.join(revisionDir, `${id}.json`);
    try {
      const existing = await loadRevision(id);
      if (canonicalJson(existing) !== canonicalJson(revision)) fail('artifact');
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
    const addedBytes = missing.reduce((sum, file) => sum + file.bytes, 0);
    const revisionBytes = bytes(revision).length;
    if (used + addedBytes + revisionBytes > MAX_BLOB_BYTES) fail('gm_content_limit');
    for (const file of missing) {
      const body = await sourceBytes(file.path, file.sha256, file.bytes);
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

  async function retain(revision) {
    if (!ready) fail('not_ready');
    return runLock(() => retainUnderLock(revision));
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

  return { prepare, withLock: (callback) => runLock(callback), list, load, retain, state,
    switch: switchRevision };
}
