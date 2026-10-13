import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/ground-pearl-swallow-process.mjs', import.meta.url));
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
      if (proc.stdout.includes(`READY ${phase} `)) return resolve();
      if (proc.child.exitCode !== null || proc.child.signalCode !== null) return reject(new Error(proc.stderr));
      setTimeout(poll, 20);
    };
    poll();
  }), `READY ${phase}`);
}
async function safeTemp(dir) {
  const root = resolve(await realpath(tmpdir())), target = resolve(await realpath(dir)), rel = relative(root, target);
  assert.ok(target !== root && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert.ok(basename(target).startsWith('ground-pearl-swallow-process-'));
  return target;
}

for (const phase of ['after-journal-prepare', 'after-sql-commit']) {
  test(`authenticated pearl swallow recovers exact ownership after SIGKILL ${phase}`, { timeout: 240000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'ground-pearl-swallow-process-')), path = join(dir, 'db');
    let proc, passed = false;
    t.after(async () => {
      if (proc) await kill(proc);
      if (passed) await rm(await safeTemp(dir), { recursive: true, force: true });
      else t.diagnostic(`Retained failed fixture: ${dir}`);
    });
    proc = start(['hold', path, phase]);
    await ready(proc, phase);
    assert.equal(proc.stdout.includes('APPLIED\n'), false, 'the crashed host never crossed its synchronous apply boundary');
    const match = proc.stdout.match(new RegExp(`READY ${phase} ([0-9a-f-]{36})`));
    assert.ok(match, `the prepared swallow exposes its frozen UUID: ${proc.stderr}`);
    const operationId = match[1];
    assert.equal((await kill(proc)).signal, 'SIGKILL');
    proc = start(['recover', path, phase, operationId]);
    assert.deepEqual(await timed(proc.done, 'ground pearl swallow recovery'), { code: 0, signal: null }, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.phase, phase);
    assert.equal(result.operationId, operationId);
    assert.equal(result.uid, 'ground-pearl-swallow-process-pearl');
    assert.equal(result.holder, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(result.generation, 2);
    assert.equal(result.profileVersion, result.profileExpectedVersion + 1);
    assert.equal(result.profileCas, 1);
    assert.equal(result.recoveredPower, 'escarcha');
    assert.equal(result.deniedCommands, 4);
    assert.equal(result.receipts, 2);
    assert.equal(result.historical, 0);
    passed = true;
    t.diagnostic(`SIGKILL ${phase}; reopened SQL006/018/019/023 without migrations, reconciled the exact swallow UUID, and verified the same holder at generation 2 with one profile CAS.`);
  });
}
