import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const jsonCopy = (value, seen = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('not JSON');
  const array = Array.isArray(value);
  if (!array && !plain(value)) throw new TypeError('not JSON');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('not JSON');
  seen.add(value);
  let copy;
  if (array) {
    copy = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('not JSON');
      copy.push(jsonCopy(descriptor.value, seen));
    }
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('not JSON');
  } else {
    copy = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('not JSON');
      Object.defineProperty(copy, key, { value: jsonCopy(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
    }
  }
  seen.delete(value);
  return copy;
};
const safeWhy = (error) => {
  if (error?.code === 'EEXIST') return 'budget_lock_busy';
  if (error?.code === 'ENOENT') return 'budget_file_missing';
  return 'budget_file_unavailable';
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A bounded, local JSON store for cooperating inference-budget writers. */
export function createBudgetFile({ directory } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('directory must be absolute');
  const root = path.resolve(directory);
  const dataPath = path.join(root, 'inference-budget.json');
  const lockPath = path.join(root, '.inference-budget.lock');
  let initialRoot = null;
  let uncertain = false;

  const rootIdentity = () => {
    const lst = fs.lstatSync(root);
    if (!lst.isDirectory() || lst.isSymbolicLink()) throw new Error('invalid');
    const real = fs.realpathSync(root);
    if (real !== root) throw new Error('invalid');
    const stat = fs.statSync(root);
    const identity = `${stat.dev}:${stat.ino}:${real}`;
    if (initialRoot === null) initialRoot = identity;
    if (identity !== initialRoot) throw new Error('changed');
    return identity;
  };

  const readRaw = async () => {
    rootIdentity();
    let handle;
    try {
      const lst = fs.lstatSync(dataPath);
      if (!lst.isFile() || lst.isSymbolicLink() || lst.nlink !== 1) throw new Error('invalid');
      handle = await fsp.open(dataPath, fs.constants.O_RDONLY);
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.dev !== lst.dev || before.ino !== lst.ino) throw new Error('changed');
      if (before.size > MAX_BYTES) throw new Error('oversize');
      const bytes = await handle.readFile();
      if (bytes.length > MAX_BYTES) throw new Error('oversize');
      const afterFd = await handle.stat();
      if (afterFd.size !== before.size || afterFd.mtimeMs !== before.mtimeMs || afterFd.ctimeMs !== before.ctimeMs || bytes.length !== afterFd.size) throw new Error('changed');
      const after = fs.lstatSync(dataPath);
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino ||
          after.size !== afterFd.size || after.mtimeMs !== afterFd.mtimeMs || after.ctimeMs !== afterFd.ctimeMs) throw new Error('changed');
      rootIdentity();
      return { bytes, identity: { dev: before.dev, ino: before.ino, nlink: before.nlink, size: before.size } };
    } finally { await handle?.close(); }
  };

  const readState = async () => {
    if (uncertain) return { ok: false, why: 'budget_commit_uncertain' };
    try {
      rootIdentity();
      let raw;
      try { raw = await readRaw(); }
      catch (error) {
        if (error?.code === 'ENOENT') {
          rootIdentity();
          return { ok: true, value: null, sha256: null, identity: null };
        }
        throw error;
      }
      const { bytes } = raw;
      const value = JSON.parse(bytes.toString('utf8'));
      if (!plain(value)) return { ok: false, why: 'budget_invalid_state' };
      return { ok: true, value: jsonCopy(value), sha256: digest(bytes), identity: raw.identity };
    } catch (error) {
      if (error?.message === 'oversize') return { ok: false, why: 'budget_file_too_large' };
      if (error?.message === 'invalid' || error?.message === 'changed') return { ok: false, why: 'budget_file_identity' };
      if (error instanceof SyntaxError) return { ok: false, why: 'budget_invalid_state' };
      return { ok: false, why: safeWhy(error) };
    }
  };

  const read = async () => {
    const state = await readState();
    if (!state.ok) return state;
    return { ok: true, value: state.value, sha256: state.sha256 };
  };

  const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
  const identityOf = (stat) => ({ dev: stat.dev, ino: stat.ino, nlink: stat.nlink, size: stat.size });
  const assertLock = (lockHandle, lockIdentity) => {
    rootIdentity();
    const named = fs.lstatSync(lockPath);
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || named.size !== lockIdentity.size || !sameIdentity(identityOf(named), lockIdentity)) throw new Error('changed');
    const open = fs.fstatSync(lockHandle.fd);
    if (!open.isFile() || open.nlink !== 1 || open.size !== lockIdentity.size || !sameIdentity(identityOf(open), lockIdentity)) throw new Error('changed');
  };
  const assertTarget = (expected) => {
    rootIdentity();
    let named;
    try { named = fs.lstatSync(dataPath); }
    catch (error) { if (error?.code === 'ENOENT' && expected === null) return; throw error; }
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || fs.realpathSync(dataPath) !== dataPath || !sameIdentity(identityOf(named), expected)) throw new Error('changed');
    const bytes = fs.readFileSync(dataPath);
    if (bytes.length > MAX_BYTES || digest(bytes) !== expected.sha256) throw new Error('changed');
    const after = fs.lstatSync(dataPath);
    if (!sameIdentity(identityOf(after), expected) || after.nlink !== 1 || after.size !== bytes.length) throw new Error('changed');
    rootIdentity();
  };
  const assertTemp = (temp) => {
    rootIdentity();
    const named = fs.lstatSync(temp.path);
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || fs.realpathSync(temp.path) !== temp.path ||
        !sameIdentity(identityOf(named), temp.identity)) throw new Error('changed');
    const bytes = fs.readFileSync(temp.path);
    const after = fs.lstatSync(temp.path);
    if (digest(bytes) !== temp.sha256 || bytes.length !== temp.identity.size || !sameIdentity(identityOf(after), temp.identity)) throw new Error('changed');
    rootIdentity();
  };
  const assertFinal = (lockHandle, lockIdentity, expected, temp = null) => {
    rootIdentity();
    assertLock(lockHandle, lockIdentity);
    assertTarget(expected);
    if (temp) assertTemp(temp);
    rootIdentity();
  };

  const transact = async (mutator) => {
    if (uncertain) return { ok: false, why: 'budget_commit_uncertain' };
    if (typeof mutator !== 'function') return { ok: false, why: 'budget_invalid_state' };
    let lock;
    let tempPath = null;
    let tempIdentity = null;
    let tempSha256 = null;
    let expectedSnapshot = null;
    let lockIdentity = null;
    let lockOwned = false;
    try {
      rootIdentity();
      lock = await fsp.open(lockPath, 'wx', 0o600);
      lockOwned = true;
      lockIdentity = identityOf(await lock.stat());
      const current = await readState();
      if (!current.ok) return current;
      expectedSnapshot = current.identity ? { ...current.identity, sha256: current.sha256 } : null;
      let update;
      try { update = await mutator({ value: current.value, sha256: current.sha256 }); }
      catch { return { ok: false, why: 'budget_invalid_state' }; }
      if (!plain(update) || !Object.hasOwn(update, 'value') || !Object.hasOwn(update, 'result')) return { ok: false, why: 'budget_invalid_state' };
      let result;
      try { result = jsonCopy(update.result); }
      catch { return { ok: false, why: 'budget_invalid_state' }; }
      if (update.value === null) {
        assertFinal(lock, lockIdentity, expectedSnapshot);
        return { ok: true, result };
      }
      if (!plain(update.value)) return { ok: false, why: 'budget_invalid_state' };
      let serialized;
      try { serialized = Buffer.from(JSON.stringify(jsonCopy(update.value)), 'utf8'); }
      catch { return { ok: false, why: 'budget_invalid_state' }; }
      if (serialized.length > MAX_BYTES) return { ok: false, why: 'budget_file_too_large' };

      const tempName = `.inference-budget.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
      tempPath = path.join(root, tempName);
      tempSha256 = digest(serialized);
      rootIdentity();
      let temp = fs.openSync(tempPath, 'wx', 0o600);
      try {
        tempIdentity = identityOf(fs.fstatSync(temp));
        fs.writeFileSync(temp, serialized);
        const finished = fs.fstatSync(temp);
        if (!sameIdentity(tempIdentity, identityOf(finished)) || finished.size !== serialized.length) throw new Error('changed');
        tempIdentity = identityOf(finished);
        fs.fsyncSync(temp);
      } finally { fs.closeSync(temp); }

      // Recheck all names and identities synchronously immediately before replacement.
      const tempSnapshot = { path: tempPath, identity: tempIdentity, sha256: tempSha256 };
      assertFinal(lock, lockIdentity, expectedSnapshot, tempSnapshot);
      uncertain = true;
      fs.renameSync(tempPath, dataPath);
      tempPath = null;
      if (process.platform !== 'win32') {
        const dir = fs.openSync(root, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
      uncertain = false;
      return { ok: true, result };
    } catch (error) {
      return { ok: false, why: uncertain ? 'budget_commit_uncertain' : (error?.message === 'changed' || error?.message === 'invalid' ? 'budget_file_identity' : safeWhy(error)) };
    } finally {
      if (tempPath && tempIdentity) {
        try {
          rootIdentity();
          const tempStat = fs.lstatSync(tempPath);
          if (tempStat.isFile() && !tempStat.isSymbolicLink() && tempStat.nlink === 1 && sameIdentity(identityOf(tempStat), tempIdentity) &&
              tempStat.size === tempIdentity.size && digest(fs.readFileSync(tempPath)) === tempSha256) fs.unlinkSync(tempPath);
        } catch { /* Never remove a path that cannot be proven to be our temporary file. */ }
      }
      if (lockOwned) {
        try {
          rootIdentity();
          const lockStat = fs.lstatSync(lockPath);
          if (lockStat.isFile() && !lockStat.isSymbolicLink() && lockStat.nlink === 1 && lockStat.size === lockIdentity.size &&
              sameIdentity(identityOf(lockStat), lockIdentity)) fs.unlinkSync(lockPath);
        } catch { /* Never remove a lock that cannot be proven to be ours. */ }
      }
      try { await lock?.close(); } catch { /* Best effort close. */ }
    }
  };

  return Object.freeze({ read, transact });
}
