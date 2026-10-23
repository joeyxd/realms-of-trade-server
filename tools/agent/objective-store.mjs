import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs, openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync, readSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { loadOwnerFiles } from './owner-files.mjs';

const FILES = Object.freeze({ personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl' });
const STAT_LIMITS = Object.freeze({ personality: 64 * 1024, objectives: 256 * 1024, memory: 1024 * 1024 });
const STATUSES = new Set(['active', 'paused', 'completed', 'blocked']);
const SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/i;
const CONTROL = /\p{Cc}/u;
const SCOPE_KEYS = ['ownerId', 'characterId', 'worldId'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameFile = (a, b) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const fail = (why) => ({ ok: false, why });

function validGoals(goals) {
  if (!plainArray(goals) || goals.length > 32) return false;
  const ids = new Set();
  for (const goal of goals) {
    if (!goal || typeof goal !== 'object' || Array.isArray(goal)
      || !plainDataObject(goal, ['id', 'status', 'text', 'constraints'])) return false;
    if (typeof goal.id !== 'string' || !goal.id.length || goal.id.length > 128 || ids.has(goal.id)
      || !normalizedText(goal.id, false) || !STATUSES.has(goal.status) || typeof goal.text !== 'string' || !goal.text.length || goal.text.length > 2000
      || !normalizedText(goal.text, false)
      || !plainArray(goal.constraints) || goal.constraints.length > 32
      || goal.constraints.some((item) => typeof item !== 'string' || !item.length || item.length > 500 || !normalizedText(item, false))) return false;
    if (SECRET.test(goal.id) || SECRET.test(goal.text) || goal.constraints.some((item) => SECRET.test(item))) return false;
    ids.add(goal.id);
  }
  return true;
}

function plainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function plainDataObject(value, keys) {
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function normalizedText(value, allowEmpty = true) {
  return typeof value === 'string' && (allowEmpty || value.length > 0)
    && value === value.normalize('NFC') && !CONTROL.test(value);
}

function validateScope(scope) {
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    && plainDataObject(scope, SCOPE_KEYS) && SCOPE_KEYS.every((key) =>
      Object.hasOwn(scope, key) && typeof scope[key] === 'string' && scope[key].length > 0
      && scope[key].length <= 160 && normalizedText(scope[key], false));
}

function readSafeTempSync(file, identity, expectedBytes) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || !sameFile(identity, before)) throw new Error('objective_temp_changed');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFile(identity, opened)) throw new Error('objective_temp_changed');
    const bytes = readBoundedSync(fd, expectedBytes.length);
    const after = lstatSync(file);
    if (!sameFile(opened, after) || after.isSymbolicLink() || !bytes.equals(expectedBytes)) throw new Error('objective_temp_changed');
  } finally { closeSync(fd); }
}

function readSafeSync(root, filename, maxBytes) {
  const file = path.join(root, filename);
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('unsafe_owner_file');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFile(before, opened)) throw new Error('owner_file_changed');
    const bytes = readBoundedSync(fd, maxBytes);
    if (bytes.length > maxBytes) throw new Error('owner_file_changed');
    const after = lstatSync(file);
    const real = realpathSync(file);
    if (!sameFile(opened, after) || after.isSymbolicLink() || path.dirname(real) !== root) throw new Error('owner_file_changed');
    return bytes;
  } finally { closeSync(fd); }
}

function readBoundedSync(fd, maxBytes) {
  const buffer = Buffer.alloc(maxBytes + 1);
  let total = 0;
  while (total < buffer.length) {
    const count = readSync(fd, buffer, total, buffer.length - total, null);
    if (!count) break;
    total += count;
  }
  if (total > maxBytes) throw new Error('owner_file_changed');
  return buffer.subarray(0, total);
}

function directoryFence(directory, original) {
  const now = lstatSync(directory);
  const real = realpathSync(directory);
  if (!now.isDirectory() || now.isSymbolicLink() || !sameIdentity(original.stat, now) || real !== original.real || path.dirname(real) === real) {
    throw new Error('unsafe_directory');
  }
}

function cleanupOwned(file, identity, token) {
  if (!file || !identity) return;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !sameFile(identity, stat)) return;
    if (readFileSync(file, 'utf8') !== token) return;
    unlinkSync(file);
  } catch { /* Preserve anything whose ownership cannot be proven. */ }
}

export function createObjectiveStore({ directory, scope } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('directory_must_be_absolute');
  if (!validateScope(scope)) throw new TypeError('invalid_scope');
  const ownerDirectory = path.resolve(directory);
  const fixedScope = structuredClone(scope);

  return {
    async commit({ expectedRevision, expectedHashes, goals, guard } = {}) {
      let fixedGoals, fixedHashes;
      try {
        if (!validGoals(goals)) return fail('invalid_goals');
        if (!expectedHashes || typeof expectedHashes !== 'object' || Array.isArray(expectedHashes)
          || !plainDataObject(expectedHashes, Object.keys(FILES))) return fail('invalid_expected_hashes');
        fixedGoals = structuredClone(goals);
        fixedHashes = structuredClone(expectedHashes);
      } catch { return fail('invalid_commit_input'); }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= Number.MAX_SAFE_INTEGER) return fail('invalid_expected_revision');
      if (!fixedHashes || typeof fixedHashes !== 'object' || Array.isArray(fixedHashes)
        || Object.keys(fixedHashes).length !== 3 || !Object.keys(FILES).every((key) => typeof fixedHashes[key] === 'string' && /^[a-f0-9]{64}$/.test(fixedHashes[key]))) return fail('invalid_expected_hashes');
      if (!validGoals(fixedGoals)) return fail('invalid_goals');
      if (guard !== undefined && typeof guard !== 'function') return fail('invalid_guard');

      let root, original;
      try {
        const supplied = await fs.lstat(ownerDirectory);
        if (!supplied.isDirectory() || supplied.isSymbolicLink()) return fail('unsafe_directory');
        root = await fs.realpath(ownerDirectory);
        original = { stat: supplied, real: root };
        directoryFence(ownerDirectory, original);
      } catch (error) { return fail(error?.message === 'unsafe_directory' ? 'unsafe_directory' : 'directory_unavailable'); }

      let lockPath, lockIdentity, lockToken, lockHandle, tempPath, tempIdentity, tempToken, tempHandle, renamed = false, renameAttempted = false;
      try {
        const lock = path.join(root, '.objectives.lock');
        lockToken = randomBytes(24).toString('hex');
        try { lockHandle = await fs.open(lock, 'wx', 0o600); }
        catch (error) { return fail(error?.code === 'EEXIST' ? 'objective_locked' : 'objective_lock_unavailable'); }
        lockPath = lock;
        lockIdentity = await lockHandle.stat();
        await lockHandle.writeFile(lockToken, 'utf8');
        await lockHandle.sync().catch(() => {});
        await lockHandle.close();
        lockHandle = undefined;

        const current = await loadOwnerFiles({ directory: ownerDirectory, scope: fixedScope });
        const actualHashes = Object.fromEntries(Object.keys(FILES).map((key) => [key, current.files[key].sha256]));
        if (current.files.objectives.revision !== expectedRevision) return fail('objective_revision_conflict');
        if (Object.keys(FILES).some((key) => actualHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');

        const next = { v: 1, revision: expectedRevision + 1, scope: structuredClone(fixedScope), goals: structuredClone(fixedGoals) };
        const bytes = Buffer.from(`${JSON.stringify(next)}\n`, 'utf8');
        if (bytes.length > STAT_LIMITS.objectives) return fail('objectives_too_large');
        tempToken = randomBytes(24).toString('hex');
        tempPath = path.join(root, `.objectives-${randomBytes(16).toString('hex')}.tmp`);
        tempHandle = await fs.open(tempPath, 'wx', 0o600);
        tempIdentity = await tempHandle.stat();
        await tempHandle.writeFile(bytes);
        tempToken = bytes.toString('utf8');
        await tempHandle.sync().catch(() => {});
        await tempHandle.close();
        tempHandle = undefined;

        // From the final revalidation through rename, all operations are synchronous.
        try {
          if (guard) {
            let verdict;
            try { verdict = guard(); } catch { return fail('objective_guard_rejected'); }
            if (verdict && typeof verdict.then === 'function') return fail('objective_guard_invalid');
            if (!verdict || verdict.ok !== true) return fail(typeof verdict?.why === 'string' ? verdict.why : 'objective_guard_rejected');
          }
          directoryFence(ownerDirectory, original);
          const finalBytes = Object.fromEntries(Object.keys(FILES).map((key) => [key, readSafeSync(root, FILES[key], STAT_LIMITS[key])]));
          const finalHashes = Object.fromEntries(Object.entries(finalBytes).map(([key, value]) => [key, sha256(value)]));
          if (Object.keys(FILES).some((key) => finalHashes[key] !== fixedHashes[key])) return fail('owner_hash_conflict');
          let finalDoc;
          try { finalDoc = JSON.parse(finalBytes.objectives.toString('utf8')); } catch { return fail('invalid_objectives'); }
          if (finalDoc?.revision !== expectedRevision) return fail('objective_revision_conflict');
          directoryFence(ownerDirectory, original);
          readSafeTempSync(tempPath, tempIdentity, bytes);
          // The trusted guard must be pure and idempotent. Check time/authority again after hashing.
          if (guard) {
            let verdict;
            try { verdict = guard(); } catch { return fail('objective_guard_rejected'); }
            if (verdict && typeof verdict.then === 'function') return fail('objective_guard_invalid');
            if (!verdict || verdict.ok !== true) return fail(typeof verdict?.why === 'string' ? verdict.why : 'objective_guard_rejected');
          }
          renameAttempted = true;
          renameSync(tempPath, path.join(root, FILES.objectives));
          renamed = true;
          return { ok: true, revision: next.revision, sha256: sha256(bytes), goals: structuredClone(next.goals) };
        } catch (error) {
          if (renameAttempted) return { ...fail('objective_commit_uncertain'), uncertain: true };
          if (error?.message === 'owner_file_changed' || error?.message === 'unsafe_owner_file') return fail('owner_hash_conflict');
          if (error?.message === 'objective_temp_changed') return fail('objective_temp_changed');
          if (error?.message === 'unsafe_directory') return fail('unsafe_directory');
          return fail('objective_precommit_failed');
        }
      } catch (error) {
        return fail(error?.code === 'EEXIST' ? 'objective_locked' : 'objective_prepare_failed');
      } finally {
        await lockHandle?.close().catch(() => {});
        await tempHandle?.close().catch(() => {});
        if (!renamed) cleanupOwned(tempPath, tempIdentity, tempToken);
        cleanupOwned(lockPath, lockIdentity, lockToken);
      }
    },
  };
}
