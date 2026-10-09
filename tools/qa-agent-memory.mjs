import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reproducible local acceptance. Full TAP plus source fingerprints, no external dispatch.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/delivery/l04a-agent-memory');
const suites = {
  agents: ['agent-interface', 'agent-context', 'agent-lab', 'agent-owner-files', 'agent-network', 'agent-runner',
    'agent-chat', 'agent-runner-context', 'agent-lifecycle', 'agent-lifecycle-runner', 'agent-movement',
    'agent-movement-network', 'agent-movement-runner', 'agent-pve', 'agent-pve-network', 'agent-pve-runner',
    'agent-authority', 'agent-authority-network', 'agent-authority-runner', 'agent-inference-budget',
    'agent-mind', 'agent-mind-context', 'agent-mind-network', 'agent-conversation-policy', 'agent-conversation-mind', 'agent-conversation-network', 'agent-objective-store', 'agent-goals-mind', 'agent-goals-network', 'agent-goals-pve',
    'agent-memory-journal', 'agent-memory-store', 'agent-memory-retrieval', 'agent-memory-mind', 'agent-memory-context', 'agent-memory-network', 'agent-memory-recovery'],
  regression: ['server', 'accounts-server', 'account-auth', 'account-import', 'naval-pilot-authority',
    'naval-crew-authority', 'pearl-input-boundary', 'pearl-host-mount', 'death-host-mount', 'combat-death-host',
    'death-drop-host', 'chat', 'chat-bubbles', 'net', 'combat', 'weapons', 'lawless', 'items'],
};
const sha = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(mjs|js|sql)$/.test(entry.name)) files.push(path);
  }
  return files;
}
async function hashes(tests) {
  // Fingerprint core gameplay/auth/storage plus the actual relative import graph of the tests.
  // Visual/UI work outside that graph may change independently in this shared checkout.
  const paths = [...(await Promise.all(['src/net', 'src/client', 'src/sim', 'src/data', 'server', 'tests/helpers', 'tools/agent'].map((dir) => walk(join(root, dir))))).flat(),
    ...await importGraph(tests.map((file) => join(root, file))), join(root, 'package.json'), join(root, 'package-lock.json')];
  return Object.fromEntries(await Promise.all([...new Set(paths)].sort().map(async (path) =>
    [relative(root, path).replaceAll('\\', '/'), sha(await readFile(path))])));
}
async function importGraph(entries) {
  const seen = new Set(), pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) pending.push(resolve(dirname(file), match[1]));
    }
  }
  return [...seen];
}
async function run(name) {
  const tests = suites[name].map((test) => `tests/${test}.test.mjs`);
  const before = await hashes(tests), startedAt = new Date().toISOString(), headBefore = git('rev-parse', 'HEAD');
  const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=30000', ...tests];
  let stdout = '', stderr = '';
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true });
    child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject); child.on('close', (exitCode, signal) => done({ exitCode, signal }));
  });
  const finishedAt = new Date().toISOString(), after = await hashes(tests);
  const changedDuringSuite = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]);
  const number = (key) => Number(stdout.match(new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)$`, 'm'))?.[1] ?? NaN);
  const report = { command: `node ${args.join(' ')}`, hashScope: 'core gameplay/auth/storage/agent modules plus relative test import graph and package lock', headBefore, headAfter: git('rev-parse', 'HEAD'), startedAt, finishedAt, ...result,
    tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'), cancelled: number('cancelled'),
    durationMs: number('duration_ms'), stderr, log: `${name}-tests.tap`, before, after, changedDuringSuite };
  await writeFile(join(output, report.log), stdout); await writeFile(join(output, `${name}-tests.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ suite: name, ...result, tests: report.tests, pass: report.pass, fail: report.fail, skipped: report.skipped, changedDuringSuite }));
  if (result.exitCode !== 0 || report.fail || report.cancelled || changedDuringSuite.length) process.exitCode = 1;
}
const selected = process.argv[2] ?? 'all';
if (!['all', 'baseline', ...Object.keys(suites)].includes(selected)) throw new Error('Choose baseline, agents, regression or all');
await mkdir(output, { recursive: true });
if (selected === 'baseline') {
  const plan = await readFile(join(root, 'PLAN-EXTRA-LLM.md'), 'utf8');
  const directions = plan.split(/\r?\n/).filter((line) => /^\| L0[0-6][a-e] \|/.test(line)).map((line) => line.split('|').slice(0, 4).join('|'));
  const da3 = plan.split(/\r?\n/).find((line) => line.startsWith('| D-A3 '));
  if (directions.length !== 22 || !da3) throw new Error('Invalid agreement baseline');
  await writeFile(join(output, 'baseline.json'), JSON.stringify({ capturedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), directions, da3 }, null, 2) + '\n');
  console.log(JSON.stringify({ rows: directions.length, head: git('rev-parse', 'HEAD') }));
} else for (const name of selected === 'all' ? Object.keys(suites) : [selected]) await run(name);
