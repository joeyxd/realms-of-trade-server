import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/ground-host-authority-process.mjs', import.meta.url));
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
function timed(promise, label, ms = 150000) {
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
  assert.ok(basename(target).startsWith('ground-host-authority-process-'));
  return target;
}

for (const phase of ['after-journal-prepare', 'after-sql-commit']) {
  test(`GameHost resource transaction recovers and replays once after SIGKILL ${phase}`, { timeout: 180000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ground-host-authority-process-'));
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
    proc = start(['recover', path, phase]);
    assert.deepEqual(await timed(proc.done, 'GameHost recovery and retry'), { code: 0, signal: null }, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.phase, phase);
    assert.equal(result.recoveredPending, Number(phase === 'after-journal-prepare'));
    assert.equal(result.profileVersion, 3);
    assert.equal(result.worldVersion, 2);
    assert.equal(result.clockTick, 1000);
    assert.equal(result.resourceTick, 1000);
    assert.equal(result.wood, 1);
    assert.equal(result.economicReceipts, 1);
    assert.equal(result.outerReceipts, 1);
    assert.equal(result.acks, 1);
    assert.equal(result.replay, true);
    passed = true;
    t.diagnostic('File-backed PGlite, actual GameHost command, SQL018/019 recovery, and process SIGKILL; reopen applies no migrations.');
  });
}
