#!/usr/bin/env node
// Local, offline focal/regression TAP run for the SQL025 private companion-config cut.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TAP_URL = new URL('./local.tap', import.meta.url);
const REPORT_URL = new URL('./local-tests.json', import.meta.url);
const TEST_FILES = [
  'tests/companion-config-store.test.mjs',
  'tests/companion-config-sql.test.mjs',
  'tests/companion-config-network.test.mjs',
  'tests/companion-config-client.test.mjs',
  'tests/companion-config-ui.test.mjs',
  'tests/companions-network.test.mjs',
  'tests/companions-client.test.mjs',
  'tests/companions-ui.test.mjs',
  'tests/store.test.mjs',
  'tests/store-host.test.mjs',
  'tests/accounts-server.test.mjs',
  'tests/agent-network.test.mjs',
  'tests/agent-interface.test.mjs',
  'tests/agent-owner-panel.test.mjs',
];
const SOURCE_FILES = [
  'server/agentControl.mjs',
  'server/companionConfig.mjs',
  'server/companionConfigStore.mjs',
  'server/host.mjs',
  'server/migrations/025_companion_config.sql',
  'server/store.mjs',
  'src/client/companionConfig.js',
  'src/client/companions.js',
  'src/main.js',
  'src/net/companionConfig.js',
  'src/net/protocol.js',
  'src/ui/companionConfig.js',
  'src/ui/companions.js',
];
const HASH_FILES = [...SOURCE_FILES, ...TEST_FILES];
const startedAt = new Date().toISOString();
const startedMs = Date.now();

function parseCounts(tap) {
  const counts = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) {
    const matches = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    assert.ok(matches.length, `TAP summary missing # ${name}`);
    counts[name] = Number(matches.at(-1)[1]);
  }
  return counts;
}

function sanitizedEnv() {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'];
  return Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

async function hashSources() {
  const hashes = {};
  for (const file of HASH_FILES) {
    const bytes = await readFile(resolve(ROOT, file));
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
  }
  return hashes;
}

function runNodeTests() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', ...TEST_FILES],
      { cwd: ROOT, env: sanitizedEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    const timer = setTimeout(() => child.kill(), 600000);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

let processResult, counts = null, hashes = {}, error = null;
try {
  hashes = await hashSources();
  processResult = await runNodeTests();
  counts = parseCounts(processResult.stdout);
} catch (caught) { error = caught.stack || String(caught); }

const finishedAt = new Date().toISOString();
const durationMs = Date.now() - startedMs;
const tapText = processResult
  ? processResult.stdout + (processResult.stderr ? `\n# runner stderr follows\n${processResult.stderr}` : '')
  : `Runner failed before TAP output: ${error}\n`;
await writeFile(TAP_URL, tapText, 'utf8');
const passed = Boolean(processResult && counts && processResult.code === 0 &&
  counts.pass === counts.tests && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0);
const report = {
  schema: 'mn.l03d.companion-config.local-tests.v1',
  startedAt,
  finishedAt,
  durationMs,
  runtime: { node: process.version, platform: process.platform, environment: 'sanitized; no .env loaded' },
  command: ['node', '--test', '--test-concurrency=1', '--test-reporter=tap', ...TEST_FILES],
  tests: TEST_FILES,
  sourceFiles: SOURCE_FILES,
  sha256: hashes,
  counts,
  process: processResult ? { exitCode: processResult.code, signal: processResult.signal } : null,
  pass: passed,
  error,
  tap: 'local.tap',
};
await writeFile(REPORT_URL, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ pass: report.pass, counts: report.counts, durationMs, tap: 'local.tap', report: 'local-tests.json' }));
if (!passed) process.exitCode = 1;
