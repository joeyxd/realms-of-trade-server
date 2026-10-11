import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, integer } from './contract.mjs';
import { validMemoryScope, MEMORY_MAX_BYTES } from './memory-journal.mjs';
import { loadOwnerFiles } from './owner-files.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { inspectMemoryArchive, proposeMemoryRemoval } from './memory-management.mjs';

const names = { personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl' };
const keys = Object.keys(names);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (why) => ({ ok: false, why });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const hashes = (files) => Object.fromEntries(keys.map((key) => [key, files.files[key].sha256]));
const policy = Object.freeze({ historyOnly: true, revalidateCurrentState: true, automaticRetention: false,
  retentionDefault: 'keep_history_until_explicit_owner_removal', maxMemoryBytes: MEMORY_MAX_BYTES,
  capacity: 'reject_writes_without_silent_deletion', legacyIds: 'all_revisions_removed_together',
  derivedRemoval: 'source_reference_closure', unresolvedOperations: 'preserve_exact_pending_evidence',
  migration: 'explicit_jsonl_encoding_only_no_semantic_upgrade', index: 'derived_in_memory_no_persisted_index',
  authority: 'local_filesystem_owner_access_not_remote_authentication', providerCalls: 0 });

// Public requests must be detached data, never executable descriptors or prototype state.
function detached(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('invalid_request');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('invalid_request');
    for (let index = 0; index < value.length; index++) {
      const d = Object.getOwnPropertyDescriptor(value, String(index));
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('invalid_request');
      result.push(detached(d.value, seen));
    }
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('invalid_request');
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !d?.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('invalid_request');
      Object.defineProperty(result, key, { value: detached(d.value, seen), enumerable: true, writable: true, configurable: true });
    }
  }
  seen.delete(value);
  return result;
}
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
const code = (error) => error?.code && /^[a-z_]+$/.test(error.code) ? error.code :
  ['invalid_memory_inspection', 'invalid_memory_journal', 'owner_snapshot_changed', 'unsafe_directory', 'invalid_now'].includes(error?.message)
    ? error.message : 'owner_files_unavailable';

/** Local owner administration. No model is allowed to choose or invoke archive destruction. */
export function createMemoryAdministration({ directory, scope, now = Date.now } = {}) {
  const fixedScope = detached(scope);
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('directory_must_be_absolute');
  if (!validMemoryScope(fixedScope) || typeof now !== 'function') throw new TypeError('invalid_scope');
  const fixedDirectory = path.resolve(directory), store = createMemoryStore({ directory: fixedDirectory, scope: fixedScope });
  let pending = null, preparing = false, writing = false, uncertain = false;
  function time() { const result = now(); if (!integer(result)) throw new TypeError('invalid_now'); return result; }
  async function snapshot() {
    const before = await lstat(fixedDirectory), originalPath = await realpath(fixedDirectory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new TypeError('unsafe_directory');
    const first = await loadOwnerFiles({ directory: fixedDirectory, scope: fixedScope, includeRawBytes: true });
    const second = await loadOwnerFiles({ directory: fixedDirectory, scope: fixedScope, includeRawBytes: true });
    const after = await lstat(fixedDirectory), finalPath = await realpath(fixedDirectory);
    if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || originalPath !== finalPath)
      throw new TypeError('unsafe_directory');
    if (!same(hashes(first), hashes(second))) throw new TypeError('owner_snapshot_changed');
    return second;
  }
  function prepare(kind, files, plan) {
    const data = { kind, scope: structuredClone(fixedScope), expectedRevision: files.files.memory.revision, expectedHashes: hashes(files), plan };
    pending = { ...data, id: sha(canonicalJson(data)) };
    return { ok: true, preview: structuredClone(pending), policy: { ...policy } };
  }
  async function preview(kind, options) {
    // A new attempt supersedes the previous preview, including a rejected attempt.
    if (preparing || writing) return fail('memory_admin_busy');
    pending = null;
    if (uncertain) return fail('memory_commit_uncertain');
    preparing = true;
    try {
      const request = detached(options);
      const files = await snapshot(), journal = files.files.memory.journal, nowMs = time();
      if (kind === 'remove') {
        if (!exact(request, ['ids']) && !exact(request, ['retention'])) return fail('invalid_selector');
        const result = proposeMemoryRemoval({ journal, scope: fixedScope, nowMs, ...request });
        return result.ok ? prepare(kind, files, result.plan) : result;
      }
      if (!exact(request, [])) return fail('invalid_request');
      const target = Buffer.from(journal.entries.map((entry) => JSON.stringify(entry) + '\n').join(''));
      return prepare(kind, files, { mode: 'canonical_jsonl', beforeRevision: journal.revision, afterRevision: journal.revision,
        entries: journal.entries.length, legacyRecords: journal.entries.filter((entry) => entry.v !== 2).length,
        changesEncoding: files.files.memory.rawBase64 !== target.toString('base64'), canonicalBytes: target.length, canonicalSha256: sha(target) });
    } catch (error) { return fail(code(error)); }
    finally { preparing = false; }
  }
  async function commit(kind, input) {
    if (uncertain) return fail('memory_commit_uncertain');
    if (preparing || writing) return fail('memory_admin_busy');
    let request;
    try { request = detached(input); } catch { return fail('invalid_request'); }
    if (!exact(request, ['previewId']) || typeof request.previewId !== 'string' || !/^[a-f0-9]{64}$/.test(request.previewId)) return fail('invalid_preview');
    if (!pending || pending.kind !== kind || request.previewId !== pending.id) return fail('memory_preview_mismatch');
    const selected = pending; pending = null; writing = true;
    try {
      const args = { expectedRevision: selected.expectedRevision, expectedHashes: selected.expectedHashes };
      const result = kind === 'remove' ? await store.remove({ ...args, plan: selected.plan }) : await store.migrate(args);
      if (result?.uncertain) { uncertain = true; return { ...fail('memory_commit_uncertain'), uncertain: true, retryAllowed: false }; }
      if (!result || typeof result.ok !== 'boolean') throw new Error('unknown_commit');
      if (result.ok && (!/^[a-f0-9]{64}$/.test(result.sha256) || result.revision !== selected.plan.afterRevision || typeof result.replay !== 'boolean' ||
          kind === 'remove' && (!same(result.removedIds, selected.plan.removeIds) || !same(result.derivedIds, selected.plan.derivedIds) || result.affectedRecords !== selected.plan.affectedRecords) ||
          kind === 'migrate' && result.sha256 !== selected.plan.canonicalSha256)) throw new Error('unknown_commit');
      return { ...result, previewId: selected.id, providerCalls: 0 };
    } catch {
      uncertain = true;
      return { ...fail('memory_commit_uncertain'), uncertain: true, retryAllowed: false };
    } finally { writing = false; }
  }
  return {
    async inspect(options = {}) {
      try {
        const request = detached(options);
        if (!request || Array.isArray(request) || typeof request !== 'object' || Object.keys(request).some((key) => !['query', 'limit', 'offset'].includes(key))) return fail('invalid_request');
        const files = await snapshot();
        const archive = inspectMemoryArchive({ journal: files.files.memory.journal, scope: fixedScope, nowMs: time(), ...request });
        return { ok: true, ...archive, ownerFileHashes: hashes(files), policy: { ...policy } };
      } catch (error) { return fail(code(error)); }
    },
    async files() {
      try { const files = await snapshot(); for (const file of Object.values(files.files)) delete file.rawBase64; return files; }
      catch (error) { return fail(code(error)); }
    },
    async exportFiles() {
      try {
        const files = await snapshot();
        return { ok: true, bundle: { schema: 'agent-owner-files-export/v1', scope: structuredClone(fixedScope), exportedAtMs: time(),
          files: Object.fromEntries(keys.map((key) => {
            const file = files.files[key];
            return [key, { filename: names[key], bytes: file.bytes, sha256: file.sha256, encoding: 'base64', content: file.rawBase64,
              ...(key !== 'personality' ? { revision: file.revision } : {}) }];
          })), policy: { ...policy } } };
      } catch (error) { return fail(code(error)); }
    },
    previewRemoval: (options) => preview('remove', options),
    commitRemoval: (input) => commit('remove', input),
    previewMigration: () => preview('migrate', {}),
    commitMigration: (input) => commit('migrate', input),
  };
}
