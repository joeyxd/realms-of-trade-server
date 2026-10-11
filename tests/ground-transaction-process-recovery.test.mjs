import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/ground-transaction-process.mjs', import.meta.url));
function start(args) {
  const child = spawn(process.execPath, [helper, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, done, get stdout() { return stdout; }, get stderr() { return stderr; } };
}
function timed(promise, label, ms = 120000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); timer.unref?.();
  })]).finally(() => clearTimeout(timer));
}
async function kill(proc) {
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) return proc.done;
  assert.equal(proc.child.kill('SIGKILL'), true);
  return timed(proc.done, 'process kill', 10000);
}
async function ready(proc, expected) {
  await timed(new Promise((resolve, reject) => {
    const check = () => {
      if (proc.stdout.includes(`${expected}\n`)) return resolve();
      if (proc.child.exitCode !== null || proc.child.signalCode !== null) return reject(new Error(proc.stderr));
      setTimeout(check, 20);
    };
    check();
  }), expected);
}
async function safeTemp(dir) {
  const root = resolve(await realpath(tmpdir())), target = resolve(await realpath(dir)), rel = relative(root, target);
  assert.ok(target !== root && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert.ok(basename(target).startsWith('ground-transaction-process-'));
  return target;
}
for (const phase of ['before-commit', 'after-commit']) {
  test(`clock, pearl, profile, world and receipts recover together after SIGKILL ${phase}`, { timeout: 180000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ground-transaction-process-'));
    const path = join(dir, 'db'); let proc, passed = false;
    t.after(async () => {
      if (proc) await kill(proc);
      if (passed) await rm(await safeTemp(dir), { recursive: true, force: true });
      else t.diagnostic(`Retained failed fixture: ${dir}`);
    });
    proc = start(['hold', path, phase]);
    await ready(proc, `READY ${phase}`);
    const killed = await kill(proc);
    assert.equal(killed.signal, 'SIGKILL');
    proc = start(['inspect', path, phase]);
    assert.deepEqual(await timed(proc.done, 'recovery audit'), { code: 0, signal: null }, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.replay, phase === 'after-commit');
    assert.equal(result.profileVersion, 2); assert.equal(result.worldVersion, 2);
    assert.equal(result.clockVersion, 2); assert.equal(result.familyReceipts, 1);
    assert.equal(result.pearls, 1); assert.equal(result.remainingTicks, 590);
    passed = true;
    t.diagnostic('PGlite file-backed SQL001-018 process proof; no GameHost mounting, power loss or live VPS claim.');
  });
}
