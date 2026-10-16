import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createBudgetAdministration } from '../tools/agent/persistent-budget.mjs';

const WORLD = 'persistent-budget-runner-test';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-persistent-budget-runner-test-token';
const TOKEN_ENV = 'MN_AGENT_PERSISTENT_BUDGET_TEST_TOKEN';
const RUNNER = fileURLToPath(new URL('../tools/agent/run.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(10);
  }
  assert.fail(`${label} timeout`);
}

async function room(t) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 23, bots: 0, maxPlayers: 8,
    dev: false, worldId: WORLD, saveSecret: 'persistent-budget-runner-test-secret', store: createMemoryStore(), log() {},
    resolvePlayer: async (_request, message) => message.token === 'owner-token' ? OWNER :
      message.token === AGENT_TOKEN ? CHARACTER : null,
    agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER,
      capabilities: ['move', 'aim'] }] },
  });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function ownerFiles(directory) {
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await writeFile(join(directory, 'personality.md'), 'Navega con cautela y habla con claridad.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope,
    goals: [{ id: 'stay-afloat', status: 'active', text: 'Keep the crew safe.', constraints: ['Use granted capabilities'] }] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  return scope;
}

function runnerProcess({ url, files, budget, extraArgs = [] }) {
  const child = spawn(process.execPath, [RUNNER, '--url', url, '--files', files, '--owner', OWNER,
    '--character', CHARACTER, '--world', WORLD, '--account-token-env', TOKEN_ENV,
    '--mind', 'simulated', ...(budget ? ['--mind-budget', budget] : []), ...extraArgs],
  { env: { ...process.env, [TOKEN_ENV]: AGENT_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const exit = once(child, 'exit');
  child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
  return {
    child,
    exit,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    stderr: () => stderr,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
  };
}

async function stop(process, t) {
  if (process.child.exitCode !== null) return;
  process.send({ type: 'exit' });
  const exited = await Promise.race([once(process.child, 'exit').then(() => true), sleep(3000).then(() => false)]);
  if (!exited) { process.child.kill(); await once(process.child, 'exit'); }
  assert.equal(exited, true, 'runner process exits on stdin exit');
}

async function rejectBeforeReady(process, label) {
  await until(() => process.events().some((event) => event.type === 'error'), `${label} startup error`);
  assert.equal(process.events().some((event) => event.type === 'ready'), false, `${label} must fail before ready`);
  const result = await Promise.race([process.exit, sleep(5000).then(() => null)]);
  assert.notEqual(result, null, `${label} must exit naturally after its startup error`);
  assert.equal(result[0], 1, `${label} exits with failure status`);
}

async function initialBudget(directory) {
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  const admin = createBudgetAdministration({ directory, scope });
  const now = Date.now();
  const limits = { maxCalls: 1, maxTokens: 50000, maxCostUnits: 50000, maxEntries: 8 };
  const result = await admin.initialize({ allowanceId: 'runner-test-allowance',
    period: { startsAtMs: now - 10000, endsAtMs: now + 3600000 }, limits });
  assert.equal(result.ok, true, JSON.stringify(result));
  return admin;
}

test('run.mjs uses durable budget across restarts, reports adapter usage, and keeps network body active on denial', { timeout: 30000 }, async (t) => {
  const { server, url } = await room(t);
  const root = await mkdtemp(join(tmpdir(), 'agent-budget-runner-'));
  const files = join(root, 'owner-files'); const budgetDirectory = join(root, 'budget');
  await mkdir(files);
  await mkdir(budgetDirectory);
  t.after(() => rm(root, { recursive: true, force: true }));
  const scope = await ownerFiles(files);
  const fileNames = ['personality.md', 'objectives.json', 'memory.jsonl'];
  const ownerBefore = new Map(await Promise.all(fileNames.map(async (name) => [name, await readFile(join(files, name))])));
  const admin = await initialBudget(budgetDirectory);

  const first = runnerProcess({ url, files, budget: budgetDirectory });
  t.after(async () => { if (first.child.exitCode === null) first.child.kill(); });
  await until(() => first.events().some((event) => event.type === 'ready'), 'first durable-budget runner ready');
  first.send({ type: 'think' });
  await until(() => first.events().some((event) => event.type === 'mind_result'), 'first durable-budget mind result');
  const firstResult = first.events().find((event) => event.type === 'mind_result').data;
  assert.equal(firstResult.ok, true, JSON.stringify(firstResult));
  first.send({ type: 'think' });
  await until(() => first.events().filter((event) => event.type === 'mind_result').length >= 2, 'durable cap denial');
  assert.equal(first.events().filter((event) => event.type === 'mind_result').at(-1).data.why, 'max_calls');
  await until(() => first.events().some((event) => event.type === 'inference_budget_notice' && event.data.why === 'max_calls'), 'max-calls budget notice');
  first.send({ type: 'inference_budget' });
  await until(() => first.events().some((event) => event.type === 'inference_budget'), 'fresh durable budget view');
  const fresh = first.events().find((event) => event.type === 'inference_budget').data.snapshot;
  assert.equal(fresh.totals.calls, 1);
  assert.equal(fresh.totals.confirmedTokens > 0, true);
  assert.equal(fresh.entries.find((entry) => entry.requestId === firstResult.requestId).usageSource, 'adapter_simulated');
  assert.equal(first.stderr(), '');
  await stop(first, t);

  const restarted = runnerProcess({ url, files, budget: budgetDirectory });
  t.after(async () => { if (restarted.child.exitCode === null) restarted.child.kill(); });
  await until(() => restarted.events().some((event) => event.type === 'ready'), 'restarted durable-budget runner ready');
  assert.equal((await admin.inspect()).snapshot.totals.calls, 1);
  restarted.send({ type: 'think' });
  await until(() => restarted.events().some((event) => event.type === 'mind_result'), 'restart retains exhausted call cap');
  assert.equal(restarted.events().find((event) => event.type === 'mind_result').data.why, 'max_calls');

  const beforeConfigure = (await admin.inspect()).snapshot.persistence.revision;
  const disabled = await admin.configure({ expectedRevision: beforeConfigure, enabled: false,
    limits: (await admin.inspect()).snapshot.limits });
  assert.equal(disabled.ok, true);
  const tickBefore = server.game.server.world.tick;
  restarted.send({ type: 'think' });
  await until(() => restarted.events().filter((event) => event.type === 'mind_result').length >= 2, 'revoked durable request result');
  assert.equal(restarted.events().filter((event) => event.type === 'mind_result').at(-1).data.why, 'budget_revoked');
  await until(() => restarted.events().some((event) => event.type === 'inference_budget_notice' && event.data.why === 'budget_revoked'), 'revocation budget notice');
  const notice = restarted.events().filter((event) => event.type === 'inference_budget_notice').at(-1);
  assert.equal(notice.data.why, 'budget_revoked');
  assert.equal(notice.data.bodyStoppedByBudget, false);
  restarted.send({ type: 'observe' });
  await until(() => restarted.events().some((event) => event.type === 'current'), 'runner observation after denial');
  await until(() => server.game.server.world.tick > tickBefore + 5, 'world continues ticking after budget denial');
  assert.equal(restarted.child.exitCode, null);
  assert.equal(restarted.stderr(), '');
  await stop(restarted, t);

  for (const name of fileNames) assert.deepEqual(await readFile(join(files, name)), ownerBefore.get(name));
  assert.equal(scope.worldId, WORLD);
});

test('missing durable budget and conflicting process-local limits fail before readiness without resetting files', { timeout: 30000 }, async (t) => {
  const { url } = await room(t);
  const root = await mkdtemp(join(tmpdir(), 'agent-budget-config-'));
  const files = join(root, 'owner-files'); const budgetDirectory = join(root, 'budget');
  await mkdir(files);
  await mkdir(budgetDirectory);
  t.after(() => rm(root, { recursive: true, force: true }));
  await ownerFiles(files);
  const admin = await initialBudget(budgetDirectory);
  const budgetPath = join(budgetDirectory, 'inference-budget.json');
  const before = await readFile(budgetPath);

  const missing = runnerProcess({ url, files, budget: join(root, 'missing-budget') });
  t.after(() => { if (missing.child.exitCode === null) missing.child.kill(); });
  missing.child.stdin.end();
  await rejectBeforeReady(missing, 'missing-budget startup');
  assert.equal(missing.events().some((event) => event.type === 'ready'), false);
  assert.equal(missing.events().at(-1).type, 'error');
  assert.equal(await readdir(root).then((names) => names.includes('missing-budget')), false);

  const mixed = runnerProcess({ url, files, budget: budgetDirectory, extraArgs: ['--mind-max-calls', '1'] });
  t.after(() => { if (mixed.child.exitCode === null) mixed.child.kill(); });
  mixed.child.stdin.end();
  await rejectBeforeReady(mixed, 'mixed-budget startup');
  assert.equal(mixed.events().some((event) => event.type === 'ready'), false);
  assert.equal(mixed.events().at(-1).type, 'error');
  assert.deepEqual(await readFile(budgetPath), before);
  assert.equal((await admin.inspect()).snapshot.persistence.revision, 0);
});
