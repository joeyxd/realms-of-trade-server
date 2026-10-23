import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local acceptance only. Keep the complete TAP output and detect concurrent source changes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/delivery/l02c-agent-authority');
const suites = {
  agents: [
    'agent-interface', 'agent-context', 'agent-lab', 'agent-owner-files', 'agent-network',
    'agent-runner', 'agent-chat', 'agent-runner-context', 'agent-lifecycle', 'agent-lifecycle-runner',
    'agent-movement', 'agent-movement-network', 'agent-movement-runner', 'agent-pve',
    'agent-pve-network', 'agent-pve-runner', 'agent-authority', 'agent-authority-network', 'agent-authority-runner',
  ],
  regression: [
    'server', 'accounts-server', 'account-auth', 'account-import', 'naval-pilot-authority',
    'naval-crew-authority', 'pearl-input-boundary', 'pearl-host-mount', 'death-host-mount',
    'combat-death-host', 'death-drop-host', 'chat', 'chat-bubbles', 'net', 'combat', 'weapons', 'lawless', 'items',
  ],
};
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(mjs|js|sql)$/.test(entry.name)) files.push(path);
  }
  return files;
}
async function hashes(name, tests) {
  const directories = ['src', 'server', 'tests/helpers', ...(name === 'agents' ? ['tools/agent'] : [])];
  const paths = [...(await Promise.all(directories.map((dir) => walk(join(root, dir))))).flat(),
    ...tests.map((file) => join(root, file)), join(root, 'package.json'), join(root, 'package-lock.json')];
  return Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async (path) =>
    [relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex')])));
}
async function run(name) {
  const tests = suites[name].map((test) => `tests/${test}.test.mjs`);
  const before = await hashes(name, tests), startedAt = new Date().toISOString();
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=30000', ...tests];
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  let stdout = '', stderr = '';
  const result = await new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, args, { cwd: root, windowsHide: true });
    process.stdout.on('data', (data) => { stdout += data; });
    process.stderr.on('data', (data) => { stderr += data; });
    process.on('error', reject);
    process.on('close', (exitCode, signal) => done({ exitCode, signal }));
  });
  const finishedAt = new Date().toISOString(), after = await hashes(name, tests);
  const changedDuringSuite = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path]);
  const number = (key) => Number(stdout.match(new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)$`, 'm'))?.[1] ?? NaN);
  const report = { command: `node ${args.join(' ')}`, head, startedAt, finishedAt, ...result,
    tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'),
    cancelled: number('cancelled'), durationMs: number('duration_ms'), stderr,
    log: `${name}-tests.tap`, before, after, changedDuringSuite };
  await writeFile(join(output, report.log), stdout);
  await writeFile(join(output, `${name}-tests.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ suite: name, ...result, tests: report.tests, pass: report.pass,
    fail: report.fail, skipped: report.skipped, changedDuringSuite }));
  if (result.exitCode !== 0 || report.fail || report.cancelled || changedDuringSuite.length) globalThis.process.exitCode = 1;
}
const selected = process.argv[2] ?? 'all';
if (!['all', ...Object.keys(suites)].includes(selected)) throw new Error('Choose agents, regression or all');
await mkdir(output, { recursive: true });
for (const name of selected === 'all' ? Object.keys(suites) : [selected]) await run(name);
