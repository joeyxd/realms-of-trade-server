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
    const opened = fstatSync(fd); let bytes;
    try { bytes = readBoundedSync(fd, expected.length); } catch { throw new Error('memory_temp_changed'); }
    const after = lstatSync(file);
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
        const hasBom = originalBytes.length >= 3 && originalBytes[0] === 0xef && originalBytes[1] === 0xbb && originalBytes[2] === 0xbf;
        const lines = [];
        let start = hasBom ? 3 : 0;
        for (let i = 0; i < originalBytes.length; i += 1) if (originalBytes[i] === 0x0a) { lines.push(originalBytes.subarray(start, i + 1)); start = i + 1; }
        if (start < originalBytes.length) lines.push(originalBytes.subarray(start));
        const removeIds = new Set(fixedPlan.removeIds), kept = [];
        let row = 0;
        for (const bytes of lines) {
          let text = decode(bytes);
          if (text.endsWith('\n')) text = text.slice(0, -1);
          if (text.endsWith('\r')) text = text.slice(0, -1);
          if (!text) continue;
          let entry; try { entry = JSON.parse(text); } catch { return fail('invalid_memory_journal'); }
          if (removeIds.has(entry.id)) { row += 1; continue; }
          kept.push(bytes); row += 1;
        }
        const retainedBytes = Buffer.concat(kept);
        const nextBytes = fixedPlan.affectedRecords === 0 ? originalBytes
          : hasBom && kept.length ? Buffer.concat([originalBytes.subarray(0, 3), retainedBytes]) : retainedBytes;
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
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          const { hashes: finalHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => finalHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          return { ok: true, replay: true, revision: nextJournal.revision, sha256: sha256(nextBytes), removedIds: fixedPlan.removeIds, derivedIds: fixedPlan.derivedIds, affectedRecords: 0 };
        }

        tempToken = randomBytes(24).toString('hex'); tempPath = path.join(root, `.memory-${randomBytes(16).toString('hex')}.tmp`);
        tempHandle = await fs.open(tempPath, 'wx', 0o600); tempIdentity = await tempHandle.stat();
        await tempHandle.writeFile(nextBytes); tempToken = nextBytes.toString('utf8'); await tempHandle.sync().catch(() => {}); await tempHandle.close(); tempHandle = undefined;
        try {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          directoryFence(ownerDirectory, original); readSafeTempSync(tempPath, tempIdentity, nextBytes);
          const { bytes: beforeBytes, hashes: beforeHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => beforeHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          let verified; try { verified = parseMemoryJournal(decode(beforeBytes.memory), fixedScope); } catch { return fail('invalid_memory_journal'); }
          if (verified.revision !== expectedRevision) return fail('memory_revision_conflict');
          const freshProposal = fixedPlan.retention === null
            ? proposeMemoryRemoval({ journal: verified, scope: fixedScope, ids: fixedPlan.requestedIds, nowMs: fixedPlan.nowMs })
            : proposeMemoryRemoval({ journal: verified, scope: fixedScope, retention: fixedPlan.retention, nowMs: fixedPlan.nowMs });
          if (!freshProposal.ok || canonicalJson(freshProposal.plan) !== canonicalJson(fixedPlan)) return fail('memory_plan_conflict');
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          const { hashes: finalHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => finalHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          directoryFence(ownerDirectory, original); readSafeTempSync(tempPath, tempIdentity, nextBytes);
          renameAttempted = true; renameSync(tempPath, path.join(root, FILES.memory)); renamed = true;
          return { ok: true, replay: false, revision: nextJournal.revision, sha256: sha256(nextBytes), removedIds: fixedPlan.removeIds, derivedIds: fixedPlan.derivedIds, affectedRecords: fixedPlan.affectedRecords };
        } catch (error) {
          if (renameAttempted) return { ...fail('memory_commit_uncertain'), uncertain: true };
          if (['owner_file_changed', 'unsafe_owner_file'].includes(error?.message)) return fail('owner_hash_conflict');
          if (error?.message === 'memory_temp_changed') return fail('memory_temp_changed');
          if (error?.message === 'unsafe_directory') return fail('unsafe_directory');
          return fail('memory_precommit_failed');
        }
      } catch (error) { return fail(error?.code === 'EEXIST' ? 'memory_locked' : 'memory_prepare_failed'); }
      finally {
        await lockHandle?.close().catch(() => {}); await tempHandle?.close().catch(() => {});
        if (!renamed) cleanupOwned(tempPath, tempIdentity, tempToken);
        cleanupOwned(lockPath, lockIdentity, lockToken);
      }
    },
    async migrate({ expectedRevision, expectedHashes, guard } = {}) {
      if (!validateHashes(expectedHashes)) return fail('invalid_expected_hashes');
      const fixedHashes = Object.fromEntries(KEYS.map((key) => [key, expectedHashes[key]]));
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return fail('invalid_memory_revision');
      if (guard !== undefined && typeof guard !== 'function') return fail('invalid_memory_entry');
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
        const journal = current.files.memory.journal;
        if (journal.revision !== expectedRevision) return fail('memory_revision_conflict');
        const nextBytes = Buffer.from(journal.entries.map((entry) => JSON.stringify(entry)).join('\n') + (journal.entries.length ? '\n' : ''), 'utf8');
        if (nextBytes.length > MEMORY_MAX_BYTES) return fail('memory_too_large');
        const nextJournal = parseMemoryJournal(decode(nextBytes), fixedScope);
        if (canonicalJson(nextJournal.entries) !== canonicalJson(journal.entries) || canonicalJson(nextJournal.pending) !== canonicalJson(journal.pending)) return fail('invalid_memory_journal');
        const replay = nextBytes.equals(readSafeSync(root, FILES.memory, LIMITS.memory));
        if (replay) {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          const { hashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => hashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          const { hashes: finalHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => finalHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          return { ok: true, migration: 'canonical_jsonl', fromRevision: journal.revision, revision: journal.revision, sha256: sha256(nextBytes), replay: true };
        }
        tempToken = randomBytes(24).toString('hex'); tempPath = path.join(root, `.memory-${randomBytes(16).toString('hex')}.tmp`);
        tempHandle = await fs.open(tempPath, 'wx', 0o600); tempIdentity = await tempHandle.stat();
        await tempHandle.writeFile(nextBytes); tempToken = nextBytes.toString('utf8'); await tempHandle.sync().catch(() => {}); await tempHandle.close(); tempHandle = undefined;
        try {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          const { bytes: beforeBytes, hashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => hashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          const verified = parseMemoryJournal(decode(beforeBytes.memory), fixedScope);
          if (verified.revision !== expectedRevision || canonicalJson(verified.entries) !== canonicalJson(journal.entries)) return fail('memory_revision_conflict');
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          const { hashes: finalHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => finalHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          directoryFence(ownerDirectory, original); readSafeTempSync(tempPath, tempIdentity, nextBytes);
          renameAttempted = true; renameSync(tempPath, path.join(root, FILES.memory)); renamed = true;
          return { ok: true, migration: 'canonical_jsonl', fromRevision: journal.revision, revision: nextJournal.revision, sha256: sha256(nextBytes), replay: false };
        } catch (error) {
          if (renameAttempted) return { ...fail('memory_commit_uncertain'), uncertain: true };
          if (['owner_file_changed', 'unsafe_owner_file'].includes(error?.message)) return fail('owner_hash_conflict');
          if (error?.message === 'memory_temp_changed') return fail('memory_temp_changed');
          if (error?.message === 'unsafe_directory') return fail('unsafe_directory');
          return fail('memory_precommit_failed');
        }
      } catch (error) { return fail(error?.code === 'EEXIST' ? 'memory_locked' : 'memory_prepare_failed'); }
      finally {
        await lockHandle?.close().catch(() => {}); await tempHandle?.close().catch(() => {});
        if (!renamed) cleanupOwned(tempPath, tempIdentity, tempToken);
        cleanupOwned(lockPath, lockIdentity, lockToken);
      }
    },
    async append({ expectedRevision, expectedHashes, entry, guard } = {}) {
      if (!validateHashes(expectedHashes)) return fail('invalid_expected_hashes');
      let fixedEntry, fixedHashes;
      try { fixedEntry = copyJsonData(entry); fixedHashes = Object.fromEntries(KEYS.map((key) => [key, expectedHashes[key]])); }
      catch { return fail('invalid_memory_input'); }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return fail('invalid_memory_revision');
      if (!validateHashes(fixedHashes)) return fail('invalid_expected_hashes');
      if (!fixedEntry || !['episode', 'summary'].includes(fixedEntry.kind) || guard !== undefined && typeof guard !== 'function') return fail('invalid_memory_entry');

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
        let parsed;
        try { parsed = parseMemoryJournal(current.files.memory.content, fixedScope); }
        catch { return fail('invalid_memory_journal'); }
        const found = parsed.entries.find((e) => e.id === fixedEntry.id);
        if (found) {
          if (canonicalJson(found) === canonicalJson(fixedEntry)) {
            const rejected = checkGuard(guard); if (rejected) return rejected;
            let latest;
            try { latest = syncOwnerHashes(root, ownerDirectory, original); }
            catch (error) { return fail(error?.message === 'unsafe_directory' ? 'unsafe_directory' : 'owner_hash_conflict'); }
            if (KEYS.some((key) => latest.hashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
            let latestJournal;
            try { latestJournal = parseMemoryJournal(decode(latest.bytes.memory), fixedScope); }
            catch { return fail('invalid_memory_journal'); }
            if (!latestJournal.entries.some((e) => e.id === fixedEntry.id && canonicalJson(e) === canonicalJson(fixedEntry))) return fail('memory_revision_conflict');
            const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
            return { ok: true, replay: true, revision: latestJournal.revision, sha256: latest.hashes.memory, entryId: fixedEntry.id };
          }
          return fail('memory_entry_collision');
        }
        if (parsed.revision !== expectedRevision) return fail('memory_revision_conflict');

        // Decode validation may strip a BOM; preserve the exact original file bytes.
        const originalBytes = readSafeSync(root, FILES.memory, LIMITS.memory);
        if (sha256(originalBytes) !== initialHashes.memory) return fail('owner_hash_conflict');
        const prefix = originalBytes.length && originalBytes.at(-1) !== 0x0a ? Buffer.concat([originalBytes, Buffer.from('\n')]) : originalBytes;
        const line = Buffer.from(`${JSON.stringify(fixedEntry)}\n`, 'utf8'), nextBytes = Buffer.concat([prefix, line]);
        if (nextBytes.length > MEMORY_MAX_BYTES) return fail('memory_too_large');
        try {
          const nextText = decode(nextBytes), nextJournal = parseMemoryJournal(nextText, fixedScope);
          if (nextJournal.revision !== expectedRevision + 1 || nextJournal.entries.at(-1)?.id !== fixedEntry.id) return fail('invalid_memory_entry');
        } catch { return fail('invalid_memory_entry'); }

        tempToken = randomBytes(24).toString('hex'); tempPath = path.join(root, `.memory-${randomBytes(16).toString('hex')}.tmp`);
        tempHandle = await fs.open(tempPath, 'wx', 0o600); tempIdentity = await tempHandle.stat();
        await tempHandle.writeFile(nextBytes); tempToken = nextBytes.toString('utf8'); await tempHandle.sync().catch(() => {}); await tempHandle.close(); tempHandle = undefined;

        // Final owner checks, guard evaluations, and rename stay synchronous as one commit window.
        try {
          const rejected = checkGuard(guard); if (rejected) return rejected;
          const { bytes: beforeBytes, hashes: beforeHashes } = syncOwnerHashes(root, ownerDirectory, original);
          if (KEYS.some((key) => beforeHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          let verified;
          try { verified = parseMemoryJournal(decode(beforeBytes.memory), fixedScope); } catch { return fail('invalid_memory_journal'); }
          if (verified.revision !== expectedRevision) return fail('memory_revision_conflict');
          directoryFence(ownerDirectory, original); readSafeTempSync(tempPath, tempIdentity, nextBytes);
          const rejectedAgain = checkGuard(guard); if (rejectedAgain) return rejectedAgain;
          renameAttempted = true; renameSync(tempPath, path.join(root, FILES.memory)); renamed = true;
          return { ok: true, replay: false, revision: expectedRevision + 1, sha256: sha256(nextBytes), entryId: fixedEntry.id };
        } catch (error) {
          if (renameAttempted) return { ...fail('memory_commit_uncertain'), uncertain: true };
          if (['owner_file_changed', 'unsafe_owner_file'].includes(error?.message)) return fail('owner_hash_conflict');
          if (error?.message === 'memory_temp_changed') return fail('memory_temp_changed');
          if (error?.message === 'unsafe_directory') return fail('unsafe_directory');
          return fail('memory_precommit_failed');
        }
      } catch (error) { return fail(error?.code === 'EEXIST' ? 'memory_locked' : 'memory_prepare_failed'); }
      finally {
        await lockHandle?.close().catch(() => {}); await tempHandle?.close().catch(() => {});
        if (!renamed) cleanupOwned(tempPath, tempIdentity, tempToken);
        cleanupOwned(lockPath, lockIdentity, lockToken);
      }
    },
  };
}
