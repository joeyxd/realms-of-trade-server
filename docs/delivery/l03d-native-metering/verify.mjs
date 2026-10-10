import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./', import.meta.url));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(name));
    else if (entry.isFile() && /\.(?:mjs|js|json)$/.test(entry.name)) result.push(name);
  }
  return result;
}
const tests = (await readdir(path.join(root, 'tests'))).filter((name) => /^agent-.*\.test\.mjs$/.test(name))
  .sort().map((name) => `tests/${name}`);
const sourceFiles = [...await files('tools/agent'), ...await files('server'), ...await files('src'),
  ...await files('tests'), 'package.json', 'package-lock.json'].sort();
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (name) =>
  [name, createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')])));
const before = await hashes(), startedAt = new Date().toISOString();
const baseRevision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim();
let run;
try { run = await exec(process.execPath, ['--test', '--test-concurrency=4', '--test-reporter=tap', ...tests],
  { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 600000 }); }
catch (error) { run = error; }
const after = await hashes(), stable = JSON.stringify(before) === JSON.stringify(after);
await writeFile(path.join(output, 'verification.tap'), run.stdout ?? '');
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((key) =>
  [key, Number((run.stdout ?? '').match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? -1)]));
const report = { schema: 'l03d-native-metering-verification/v1', startedAt, finishedAt: new Date().toISOString(),
  node: process.version, baseRevision, workingTreeEvidence: true, tests, counts, sourceStable: stable,
  sourceSha256: before, ok: run.code === undefined && stable && counts.fail === 0 && counts.cancelled === 0,
  externalProviderCalls: 0, inferenceSpend: 0,
  scope: 'Local contract fixtures, durable filesystem/CLI, localhost WebSocket/HTTP and PGlite only. No real provider or semantic memory quality acceptance.' };
await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ok: report.ok, counts, sourceStable: stable, files: tests.length }) + '\n');
if (!report.ok) process.exitCode = 1;
