import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile), root = fileURLToPath(new URL('../../../', import.meta.url));
const tests = ['tests/ground-transaction-journal.test.mjs', 'tests/ground-transaction-journal-sql.test.mjs',
  'tests/ground-transaction-journal-process.test.mjs'];
const sources = [...tests, 'server/groundTransactionJournal.mjs', 'server/groundTransactionSession.mjs',
  'server/migrations/019_ground_transaction_journal.sql'];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async name => [name,
  createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')])));
const before = await hashes(), startedAt = new Date().toISOString();
const command = ['--test', '--test-reporter=tap', '--test-concurrency=2', ...tests];
let run;
try { run = await exec(process.execPath, command, { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 240000 }); }
catch (error) { run = error; }
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(key =>
  [key, Number((run.stdout ?? '').match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? -1)]));
const sourceStable = JSON.stringify(before) === JSON.stringify(await hashes());
const report = { startedAt, finishedAt: new Date().toISOString(), node: process.version,
  baseRevision: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim(),
  command, counts, sourceStable, sourceSha256: before,
  ok: run.code === undefined && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && sourceStable,
  scope: 'Dormant SQL019 upstream integration only; no live SQL activation or GameHost mounting.' };
await writeFile(new URL('./integration.tap', import.meta.url), run.stdout ?? '');
await writeFile(new URL('./integration.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ok: report.ok, counts, sourceStable }) + '\n');
if (!report.ok) process.exitCode = 1;
