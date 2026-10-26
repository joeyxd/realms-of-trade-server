import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/ground-pearl-mint-process.mjs', import.meta.url));
function start(args) {
  const child = spawn(process.execPath, [helper, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, done, get stdout() { return stdout; }, get stderr() { return stderr; } };
}
function timed(promise, label, ms = 180000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); timer.unref?.();
  })]).finally(() => clearTimeout(timer));
}
async function kill(proc) {
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) return proc.done;
  assert.equal(proc.child.kill('SIGKILL'), true);
  return timed(proc.done, 'SIGKILL completion', 10000);
}
async function ready(proc, phase) {
  await timed(new Promise((resolve, reject) => {
    const poll = () => {
      if (proc.stdout.includes(`READY ${phase}\n`)) return resolve();
      if (proc.child.exitCode !== null || proc.child.signalCode !== null) return reject(new Error(proc.stderr));
      setTimeout(poll, 20);
    };
    poll();
  }), `READY ${phase}`);
}
async function safeTemp(dir) {
  const root = resolve(await realpath(tmpdir())), target = resolve(await realpath(dir)), rel = relative(root, target);
  assert.ok(target !== root && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert.ok(basename(target).startsWith('ground-pearl-mint-process-'));
  return target;
}

for (const phase of ['after-journal-prepare', 'after-sql-commit']) {
  test(`actual sentinel pearl mint recovers exactly once after SIGKILL ${phase}`, { timeout: 240000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ground-pearl-mint-process-')), path = join(dir, 'db');
    let proc, passed = false;
    t.after(async () => {
      if (proc) await kill(proc);
      if (passed) await rm(await safeTemp(dir), { recursive: true, force: true });
      else t.diagnostic(`Retained failed fixture: ${dir}`);
    });
    proc = start(['hold', path, phase]);
    await ready(proc, phase);
    assert.equal(proc.stdout.includes('APPLIED\n'), false, 'the crashed host never crossed its synchronous apply boundary');
    assert.equal((await kill(proc)).signal, 'SIGKILL');
    proc = start(['recover', path, phase]);
    assert.deepEqual(await timed(proc.done, 'ground pearl mint recovery'), { code: 0, signal: null }, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.phase, phase);
    assert.match(result.uid, /^mint:[0-9a-f-]{36}$/i);
    assert.equal(result.uid, `mint:${result.operationId}`);
    assert.equal(result.hydrated, 1);
    assert.equal(result.ownerPearls, 1, 'the recovered pearl can be picked up exactly once');
    assert.equal(result.historical, 0, 'startup does not replay the old gameplay apply callback');
    passed = true;
    t.diagnostic(`SIGKILL after ${phase}; reopened SQL018/019/023 without migrations, recovered the mint receipt, hydrated one current row, and picked it up once.`);
  });
}
