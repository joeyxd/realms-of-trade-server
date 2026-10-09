import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs, openSync, closeSync, fstatSync, lstatSync, realpathSync, readSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { loadOwnerFiles } from './owner-files.mjs';
import { parseMemoryJournal, validMemoryScope, MEMORY_MAX_BYTES } from './memory-journal.mjs';
import { canonicalJson } from './contract.mjs';
import { proposeMemoryRemoval } from './memory-management.mjs';

const FILES = Object.freeze({ personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl' });
const LIMITS = Object.freeze({ personality: 64 * 1024, objectives: 256 * 1024, memory: MEMORY_MAX_BYTES });
const KEYS = Object.keys(FILES);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const fail = (why) => ({ ok: false, why });

function plainDataObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every((k) => typeof k === 'string' && keys.includes(k)) && keys.every((k) => {
    const d = Object.getOwnPropertyDescriptor(value, k); return d?.enumerable === true && Object.hasOwn(d, 'value');
  });
}
function validateHashes(value) {
  return plainDataObject(value, KEYS) && KEYS.every((key) => {
    const hash = Object.getOwnPropertyDescriptor(value, key)?.value;
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  });
}
function directoryFence(directory, original) {
  const now = lstatSync(directory), real = realpathSync(directory);
  if (!now.isDirectory() || now.isSymbolicLink() || !sameIdentity(original.stat, now) || real !== original.real || path.dirname(real) === real) throw new Error('unsafe_directory');
}
function readBoundedSync(fd, maxBytes) {
  const buffer = Buffer.alloc(maxBytes + 1); let total = 0;
  while (total < buffer.length) { const count = readSync(fd, buffer, total, buffer.length - total, null); if (!count) break; total += count; }
  if (total > maxBytes) throw new Error('owner_file_changed');
  return buffer.subarray(0, total);
}
function readSafeSync(root, filename, maxBytes) {
  const file = path.join(root, filename), before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('unsafe_owner_file');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd); if (!same(before, opened)) throw new Error('owner_file_changed');
    const bytes = readBoundedSync(fd, maxBytes), after = lstatSync(file), real = realpathSync(file);
    if (!same(opened, after) || after.isSymbolicLink() || path.dirname(real) !== root) throw new Error('owner_file_changed');
    return bytes;
  } finally { closeSync(fd); }
}
function readSafeTempSync(file, identity, expected) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || !same(identity, before)) throw new Error('memory_temp_changed');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd), bytes = readBoundedSync(fd, expected.length), after = lstatSync(file);
    if (!same(identity, opened) || !same(opened, after) || after.isSymbolicLink() || !bytes.equals(expected)) throw new Error('memory_temp_changed');
  } finally { closeSync(fd); }
}
function cleanupOwned(file, identity, token) {
  if (!file || !identity) return;
  try {
    const stat = lstatSync(file), expected = Buffer.from(token);
    if (!stat.isFile() || stat.isSymbolicLink() || !same(identity, stat) || stat.size > expected.length) return;
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd), bytes = readBoundedSync(fd, expected.length), after = lstatSync(file);
      if (same(identity, opened) && same(opened, after) && !after.isSymbolicLink() && bytes.equals(expected)) unlinkSync(file);
    } finally { closeSync(fd); }
  } catch { /* Preserve unproven files. */ }
}
function checkGuard(guard) {
  if (!guard) return null;
  let verdict;
  try { verdict = guard(); } catch { return fail('memory_guard_rejected'); }
  if (verdict && typeof verdict.then === 'function') return fail('memory_guard_invalid');
  if (!verdict || verdict.ok !== true) return fail(typeof verdict?.why === 'string' ? verdict.why : 'memory_guard_rejected');
  return null;
}
function decode(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
function copyJsonData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('invalid_memory_entry');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('invalid_memory_entry');
    result = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('invalid_memory_entry');
      result.push(copyJsonData(descriptor.value, seen));
    }
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('invalid_memory_entry');
    result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError('invalid_memory_entry');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('invalid_memory_entry');
      result[key] = copyJsonData(descriptor.value, seen);
    }
  }
  seen.delete(value);
  return result;
}
function syncOwnerHashes(root, directory, original) {
  directoryFence(directory, original);
  const bytes = Object.fromEntries(KEYS.map((key) => [key, readSafeSync(root, FILES[key], LIMITS[key])]));
  return { bytes, hashes: Object.fromEntries(KEYS.map((key) => [key, sha256(bytes[key])])) };
}

export function createMemoryStore({ directory, scope } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('directory_must_be_absolute');
  if (!validMemoryScope(scope)) throw new TypeError('invalid_scope');
  const ownerDirectory = path.resolve(directory), fixedScope = structuredClone(scope);

  return {
    async remove({ expectedRevision, expectedHashes, plan, guard } = {}) {
      if (!validateHashes(expectedHashes)) return fail('invalid_expected_hashes');
      let fixedPlan, fixedHashes;
      try { fixedPlan = copyJsonData(plan); fixedHashes = Object.fromEntries(KEYS.map((key) => [key, expectedHashes[key]])); }
      catch { return fail('invalid_memory_input'); }
      if (!fixedPlan || guard !== undefined && typeof guard !== 'function') return fail('invalid_memory_plan');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return fail('invalid_memory_revision');
      if (!validateHashes(fixedHashes)) return fail('invalid_expected_hashes');

      let root, original;
      try {
        const supplied = await fs.lstat(ownerDirectory);
        if (!supplied.isDirectory() || supplied.isSymbolicLink()) return fail('unsafe_directory');
        root = await fs.realpath(ownerDirectory); original = { stat: supplied, real: root }; directoryFence(ownerDirectory, original);
      } catch (error) { return fail(error?.message === 'unsafe_directory' ? 'unsafe_directory' : 'directory_unavailable'); }

      let lockPath, lockIdentity, lockToken, lockHandle, tempPath, tempIdentity, tempToken, tempHandle, renamed = false, renameAttempted = false;
      try {
        lockPath = path.join(root, '.memory.lock'); lockToken = randomBytes(24).toString('hex');
        try { lockHandle = await fs.open(lockPath, 'wx', 0o600); }
        catch (error) { return fail(error?.code === 'EEXIST' ? 'memory_locked' : 'memory_lock_unavailable'); }
        lockIdentity = await lockHandle.stat(); await lockHandle.writeFile(lockToken, 'utf8'); await lockHandle.sync().catch(() => {}); await lockHandle.close(); lockHandle = undefined;

        let current;
        try { current = await loadOwnerFiles({ directory: ownerDirectory, scope: fixedScope }); }
        catch (error) { return fail(error?.code === 'likely_secret_detected' ? 'likely_secret_detected' : 'owner_files_invalid'); }
        const initialHashes = Object.fromEntries(KEYS.map((key) => [key, current.files[key].sha256]));
        if (KEYS.some((key) => initialHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
        const currentJournal = current.files.memory.journal;
        if (currentJournal.revision !== expectedRevision) return fail('memory_revision_conflict');
        const proposed = fixedPlan.retention === null
          ? proposeMemoryRemoval({ journal: currentJournal, scope: fixedScope, ids: fixedPlan.requestedIds, nowMs: fixedPlan.nowMs })
          : proposeMemoryRemoval({ journal: currentJournal, scope: fixedScope, retention: fixedPlan.retention, nowMs: fixedPlan.nowMs });
        if (!proposed.ok || canonicalJson(proposed.plan) !== canonicalJson(fixedPlan)) return fail('memory_plan_conflict');

        const originalBytes = readSafeSync(root, FILES.memory, LIMITS.memory);
        if (sha256(originalBytes) !== initialHashes.memory) return fail('owner_hash_conflict');
        const rawText = decode(originalBytes), lines = [];
        let start = 0;
        for (let i = 0; i < originalBytes.length; i += 1) if (originalBytes[i] === 0x0a) { lines.push(originalBytes.subarray(start, i + 1)); start = i + 1; }
        if (start < originalBytes.length) lines.push(originalBytes.subarray(start));
        const removeIds = new Set(fixedPlan.removeIds), kept = [];
        let row = 0;
        for (const bytes of lines) {
          let text = decode(bytes);
          if (row === 0 && text.startsWith('\ufeff')) text = text.slice(1);
          if (text.endsWith('\n')) text = text.slice(0, -1);
          if (text.endsWith('\r')) text = text.slice(0, -1);
          if (!text) continue;
          let entry; try { entry = JSON.parse(text); } catch { return fail('invalid_memory_journal'); }
          if (removeIds.has(entry.id)) { row += 1; continue; }
          kept.push(bytes); row += 1;
        }
        const nextBytes = Buffer.concat(kept);
        if (nextBytes.length > MEMORY_MAX_BYTES) return fail('memory_too_large');
        let nextJournal;
        try { nextJournal = parseMemoryJournal(decode(nextBytes), fixedScope); }
        catch { return fail('invalid_memory_journal'); }
        if (nextJournal.revision !== fixedPlan.afterRevision || nextJournal.entries.length !== fixedPlan.retainedRecords) return fail('memory_plan_conflict');
        if (nextJournal.pending.length !== currentJournal.pending.length || canonicalJson(nextJournal.pending) !== canonicalJson(currentJournal.pending)) return fail('memory_pending_evidence');

        if (nextBytes.equals(originalBytes)) {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          const { hashes: latestHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => latestHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          return { ok: true, replay: true, revision: nextJournal.revision, sha256: sha256(nextBytes), removedIds: fixedPlan.removeIds, derivedIds: fixedPlan.derivedIds, affectedRecords: 0 };
        }

        tempToken = randomBytes(24).toString('hex'); tempPath = path.join(root, `.memory-${randomBytes(16).toString('hex')}.tmp`);
        tempHandle = await fs.open(tempPath, 'wx', 0o600); tempIdentity = await tempHandle.stat();
        await tempHandle.writeFile(nextBytes); tempToken = nextBytes.toString('utf8'); await tempHandle.sync().catch(() => {}); await tempHandle.close(); tempHandle = undefined;
        try {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          const { bytes: beforeBytes, hashes: beforeHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => beforeHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          let verified; try { verified = parseMemoryJournal(decode(beforeBytes.memory), fixedScope); } catch { return fail('invalid_memory_journal'); }
          if (verified.revision !== expectedRevision) return fail('memory_revision_conflict');
          const freshProposal = fixedPlan.retention === null
            ? proposeMemoryRemoval({ journal: verified, scope: fixedScope, ids: fixedPlan.requestedIds, nowMs: fixedPlan.nowMs })
            : proposeMemoryRemoval({ journal: verified, scope: fixedScope, retention: fixedPlan.retention, nowMs: fixedPlan.nowMs });
          if (!freshProposal.ok || canonicalJson(freshProposal.plan) !== canonicalJson(fixedPlan)) return fail('memory_plan_conflict');
          directoryFence(ownerDirectory, original); readSafeTempSync(tempPath, tempIdentity, nextBytes);
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          renameAttempted = true; renameSync(tempPath, path.join(root, FILES.memory)); renamed = true;
          return { ok: true, replay: false, revision: nextJournal.revision, sha256: sha256(nextBytes), removedIds: fixedPlan.removeIds, derivedIds: fixedPlan.der