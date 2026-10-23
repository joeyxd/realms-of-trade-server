import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/ground-family-process.mjs', import.meta.url));
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
  assert.ok(basename(target).startsWith('ground-family-process-'));
  return target;
}

for (const phase of ['after-journal-prepare', 'after-sql-commit']) {
  test(`ground family mint recovers atomically after SIGKILL ${phase}`, { timeout: 180000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ground-family-process-'));
    const path = join(dir, 'db'); let proc, passed = false;
    t.after(async () => {
      if (proc) await kill(proc);
      if (passed) await rm(await safeTemp(dir), { recursive: true, force: true });
      else t.diagnostic(`Retained failed fixture: ${dir}`);
    });
    proc = start(['hold', path, phase]);
    await ready(proc, `READY ${phase}`);
    assert.equal(proc.stdout.includes('APPLIED\n'), false, 'host apply has not run at either kill boundary');
    assert.equal((await kill(proc)).signal, 'SIGKILL');
    proc = start(['recover', path, phase]);
    assert.deepEqual(await timed(proc.done, 'ground family recovery audit'), { code: 0, signal: null }, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.phase, phase);
    assert.equal(result.committed, 1);
    assert.equal(result.operationReceipts, 1);
    assert.equal(result.worldVersion, 2);
    assert.equal(result.clockTick, 500);
    assert.equal(result.uid, 'ground-family-process-pearl');
    assert.equal(result.locationVersion, 1);
    assert.equal(result.historicalApplyCalls, 0);
    passed = true;
    t.diagnostic('Actual SIGKILL around GroundHostAuthority.stageFamily on an adopted file-backed PGlite world; SQL018/019/023 reopen without migrations; no lifecycle mount implied.');
  });
}
