import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const exec = promisify(execFile);
const expected = process.argv[2] ?? (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim();
assert.match(expected, /^[0-9a-f]{40}$/);
const child = spawn('ssh', ['-o', 'BatchMode=yes', 'root@62.171.136.148', 'python3 - ' + expected],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.setEncoding('utf8').on('data', part => { stdout += part; });
child.stderr.setEncoding('utf8').on('data', part => { stderr += part; });
const closed = once(child, 'close'), timer = setTimeout(() => child.kill(), 30000);
child.stdin.end(await readFile(new URL('./deployment-snapshot.py', import.meta.url)));
const [code] = await closed; clearTimeout(timer); assert.equal(code, 0, stderr);
const deployment = JSON.parse(stdout);
assert.equal(deployment.schema, 'mn.l03d.companion-control.deployment-snapshot.v1');
assert.equal(deployment.revision, expected); assert.equal(deployment.running, true);
assert.ok(deployment.currentRelease.endsWith('/releases/' + expected), 'updater handover is not finalized');
assert.equal(deployment.health, 'healthy');
const allowPausedTimer = process.argv.includes('--allow-paused-timer');
if (allowPausedTimer) assert.ok(['active', 'inactive'].includes(deployment.timer));
else assert.equal(deployment.timer, 'active');
assert.equal(deployment.authorities.length, 1);
assert.equal(deployment.offlineCounts.pass, deployment.offlineCounts.tests);
assert.equal(deployment.offlineCounts.fail, 0);
const response = await fetch('https://marea.62.171.136.148.sslip.io/status',
  { cache: 'no-store', signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
const { game, version, players, sockets, errors, storage } = await response.json();
assert.equal(version, deployment.version); assert.equal(errors, 0);
assert.equal(storage.kind, 'supabase'); assert.equal(storage.durable, true);
assert.equal(storage.tickBlocked, false); assert.equal(storage.unsaved, 0);
assert.equal(storage.economic.failed, false); assert.equal(storage.resources.ready, true);
const report = { schema: 'mn.l03d.companion-control.deployment.v1', ...deployment,
  expectedRevision: expected, recordedAt: new Date().toISOString(), timerPausedAtCapture: deployment.timer !== 'active',
  publicStatus: { game, version, players, sockets, errors, storage },
  scope: 'Private durable SQL027 stop/control state for existing account/character bindings, with SQL025 configuration regressions retained. No binding provisioning, provider/model, credentials, activation, inference, or agent budgets.',
  limits: ['Public owner stop/resume acceptance remains pending; this capture verifies active image identity, public health, and existing storage status only.',
    'This capture does not inspect private SQL027 control rows or prove authenticated public stop/resume.',
    'Gameplay durability remains represented by the existing M5 storage status and is not inferred from companion control state.'] };
await writeFile(new URL('./deployment.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ revision: expected, health: deployment.health, authorities: deployment.authorities.length,
  offlineCounts: deployment.offlineCounts, publicErrors: errors, scope: 'SQL027 durable stop/control for existing bindings; public owner acceptance pending' }));
