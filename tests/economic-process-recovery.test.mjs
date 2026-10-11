import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./helpers/economic-process.mjs', import.meta.url));

function start(mode, dbPath) {
  const child = spawn(process.execPath, [helper, mode, dbPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  return { child, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

function withTimeout(promise, label, ms = 12_000) {
  return Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  })]);
}

async function waitReady(process, stage) {
  try { await withTimeout(new Promise((resolve, reject) => {
    const check = () => {
      if (process.stdout.includes(`READY ${stage}\n`)) return resolve();
      if (process.child.exitCode !== null || process.child.signalCode !== null) {
        return reject(new Error(`fixture child exited early (${process.child.exitCode ?? process.child.signalCode}): ${process.stderr}`));
      }
      setTimeout(check, 10);
    };
    check();
  }), `fixture ${stage}`); }
  catch (error) {
    if (process.child.exitCode === null && process.child.signalCode === null) {
      process.child.kill('SIGTERM');
      await new Promise(resolve => process.child.once('exit', resolve));
    }
    throw error;
  }
}

async function stopNormally(process) {
  const exited = withTimeout(new Promise(resolve => {
    process.child.once('exit', (code, signal) => resolve({ code, signal }));
  }), 'fixture termination');
  assert.equal(process.child.kill('SIGTERM'), true, 'SIGTERM is sent to the held child process');
  return exited;
}

async function runAudit(mode, dbPath) {
  const proc = start(mode, dbPath);
  let exit;
  try {
    exit = await withTimeout(new Promise(resolve => {
      proc.child.once('exit', (code, signal) => resolve({ code, signal }));
    }), `audit ${mode}`);
  } catch (error) {
    if (proc.child.exitCode === null && proc.child.signalCode === null) {
      proc.child.kill('SIGTERM');
      await new Promise(resolve => proc.child.once('exit', resolve));
    }
    throw error;
  }
  assert.deepEqual(exit, { code: 0, signal: null }, `audit child failed: ${proc.stderr}`);
  return JSON.parse(proc.stdout);
}

for (const stage of ['before', 'after']) {
  test(`economic operation ${stage === 'before' ? 'without commit' : 'after commit'} survives abrupt process exit`, async t => {
    t.diagnostic('File-backed PGlite process restart proof only; this does not simulate VM/power loss or production PostgreSQL durability.');
    const dir = await mkdtemp(join(tmpdir(), 'economic-process-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'db');
    const proc = start(stage, dbPath);
    await waitReady(proc, stage);
    assert.equal(proc.stdout.trim(), `READY ${stage}`, 'child emits only its sanitized readiness stage');
    const terminated = await stopNormally(proc);
    assert.equal(terminated.signal, 'SIGTERM', 'the held fixture process exits from the requested signal');

    const audit = await runAudit(`inspect-${stage}`, dbPath);
    assert.equal(audit.stage, `inspect-${stage}`);
    if (stage === 'before') {
      assert.deepEqual(audit, { stage: 'inspect-before', receiptCount: 0, replay: false,
        profileVersion: 1, worldVersion: 1, remainingMadera: 3, contributedMadera: 0 });
    } else {
      assert.deepEqual(audit, { stage: 'inspect-after', receiptCount: 1, replay: true,
        profileVersion: 2, worldVersion: 2, remainingMadera: 1, contributedMadera: 2 });
    }
  });
}
