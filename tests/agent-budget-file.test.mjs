import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBudgetFile } from '../tools/agent/budget-file.mjs';

const fixture = async (fn) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marea-budget-'));
  try { await fn(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
};
const update = (value, result = true) => ({ value, result });

test('empty read and atomic transaction round trip detached plain JSON with raw-byte hash', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  assert.deepEqual(await store.read(), { ok: true, value: null, sha256: null });
  const value = { calls: 1, nested: { held: 2 } };
  assert.deepEqual(await store.transact(() => update(value, { accepted: true })), { ok: true, result: { accepted: true } });
  value.nested.held = 99;
  const read = await store.read();
  assert.deepEqual(read.value, { calls: 1, nested: { held: 2 } });
  assert.match(read.sha256, /^[a-f0-9]{64}$/);
  read.value.nested.held = 100;
  assert.equal((await store.read()).value.nested.held, 2);
}));

test('exclusive lock serializes instances and a busy instance can safely retry', async () => fixture(async (directory) => {
  const first = createBudgetFile({ directory });
  const second = createBudgetFile({ directory });
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  const writer = first.transact(async ({ value }) => {
    entered(); await wait;
    return update({ count: (value?.count ?? 0) + 1 });
  });
  await enteredPromise;
  assert.deepEqual(await second.transact(({ value }) => update({ count: (value?.count ?? 0) + 1 })),
    { ok: false, why: 'budget_lock_busy' });
  release();
  assert.equal((await writer).ok, true);
  assert.equal((await second.transact(({ value }) => update({ count: value.count + 1 }))).ok, true);
  assert.equal((await first.read()).value.count, 2);
}));

test('mutator rejection, invalid results, malformed JSON, and oversized bytes do not write', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  assert.deepEqual(await store.transact(() => { throw new Error('secret path'); }), { ok: false, why: 'budget_invalid_state' });
  assert.equal((await fs.readdir(directory)).includes('inference-budget.json'), false);
  assert.deepEqual(await store.transact(() => ({ value: { ok: true } })), { ok: false, why: 'budget_invalid_state' });
  await fs.writeFile(path.join(directory, 'inference-budget.json'), '{');
  assert.deepEqual(await store.read(), { ok: false, why: 'budget_invalid_state' });
  await fs.writeFile(path.join(directory, 'inference-budget.json'), Buffer.alloc(1024 * 1024 + 1, 0x20));
  assert.deepEqual(await store.read(), { ok: false, why: 'budget_file_too_large' });
}));

test('symlink and hard-linked budget files are rejected', async (t) => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const outside = path.join(directory, '..', `${path.basename(directory)}-outside.json`);
  await fs.writeFile(outside, '{"safe":true}');
  try {
    await fs.symlink(outside, path.join(directory, 'inference-budget.json'));
    assert.deepEqual(await store.read(), { ok: false, why: 'budget_file_identity' });
    await fs.rm(path.join(directory, 'inference-budget.json'));
    await fs.link(outside, path.join(directory, 'inference-budget.json'));
    assert.deepEqual(await store.read(), { ok: false, why: 'budget_file_identity' });
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
    throw error;
  } finally { await fs.rm(outside, { force: true }); }
}));

test('hard-linked budget files are rejected', async (t) => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const outside = path.join(directory, '..', `${path.basename(directory)}-hardlink.json`);
  await fs.writeFile(outside, '{"safe":true}');
  try {
    await fs.link(outside, path.join(directory, 'inference-budget.json'));
    assert.deepEqual(await store.read(), { ok: false, why: 'budget_file_identity' });
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('hard link creation unavailable'); return; }
    throw error;
  } finally { await fs.rm(outside, { force: true }); }
}));

test('external target insertion during a transaction fails identity guards without overwriting it', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const result = await store.transact(async () => {
    await fs.writeFile(path.join(directory, 'inference-budget.json'), '{"external":true}');
    return update({ shouldNotLand: true });
  });
  assert.deepEqual(result, { ok: false, why: 'budget_file_identity' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'inference-budget.json'), 'utf8')), { external: true });
}));

test('in-place target rewrite fails hash guards for both writes and no-op transactions', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const dataPath = path.join(directory, 'inference-budget.json');
  assert.equal((await store.transact(() => update({ stable: true }))).ok, true);
  const rewrite = async () => {
    await fs.writeFile(dataPath, '{"external":true}');
    return update({ ignored: true });
  };
  assert.deepEqual(await store.transact(rewrite), { ok: false, why: 'budget_file_identity' });
  assert.deepEqual(JSON.parse(await fs.readFile(dataPath, 'utf8')), { external: true });
  assert.deepEqual(await store.transact(async () => {
    await fs.writeFile(dataPath, '{"changedAgain":true}');
    return update(null, { replay: true });
  }), { ok: false, why: 'budget_file_identity' });
  assert.deepEqual(JSON.parse(await fs.readFile(dataPath, 'utf8')), { changedAgain: true });
}));

test('directory identity change during a transaction fails closed', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const originalRealpath = fsSync.realpathSync;
  let changed = false;
  fsSync.realpathSync = (target, ...args) => {
    const resolved = originalRealpath(target, ...args);
    return changed && typeof target === 'string' && path.resolve(target) === path.resolve(directory)
      ? `${resolved}-changed` : resolved;
  };
  try {
    const result = await store.transact(async () => {
      changed = true;
      return update({ shouldNotLand: true });
    });
    assert.deepEqual(result, { ok: false, why: 'budget_file_identity' });
    assert.deepEqual(await fs.readdir(directory), ['.inference-budget.lock']);
  } finally {
    fsSync.realpathSync = originalRealpath;
    await fs.rm(path.join(directory, '.inference-budget.lock'), { force: true });
  }
}));

test('rename followed by an exception latches uncertain commit for this instance', async () => fixture(async (directory) => {
  const store = createBudgetFile({ directory });
  const originalRename = fsSync.renameSync;
  fsSync.renameSync = (...args) => {
    originalRename(...args);
    throw new Error('uncertain after rename');
  };
  try {
    assert.deepEqual(await store.transact(() => update({ committed: true })),
      { ok: false, why: 'budget_commit_uncertain' });
    assert.deepEqual(await store.read(), { ok: false, why: 'budget_commit_uncertain' });
    assert.deepEqual(await store.transact(() => update({ committed: false })),
      { ok: false, why: 'budget_commit_uncertain' });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'inference-budget.json'), 'utf8')), { committed: true });
  } finally { fsSync.renameSync = originalRename; }
}));

test('factory requires an absolute real directory', async (t) => {
  assert.throws(() => createBudgetFile({ directory: 'relative' }));
  await fixture(async (directory) => {
    const link = `${directory}-link`;
    try { await fs.symlink(directory, link, 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    try {
      const store = createBudgetFile({ directory: link });
      assert.deepEqual(await store.read(), { ok: false, why: 'budget_file_identity' });
    } finally { await fs.rm(link, { force: true }); }
  });
});
