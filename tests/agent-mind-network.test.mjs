import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { createSimulatedMind } from '../tools/agent/simulated-mind.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';

const WORLD = 'mind-network-lab';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-mind-network-local-token';
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 17, bots: 0, maxPlayers: 8,
    dev: false, worldId: WORLD, saveSecret: 'agent-mind-network-test-secret', store: createMemoryStore(), log() {},
    resolvePlayer: async (_request, message) => message.token === 'owner-token' ? OWNER :
      message.token === AGENT_TOKEN ? CHARACTER : null,
    agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER,
      capabilities: ['move', 'aim'] }] },
  });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

class OwnerWire {
  constructor(url) {
    this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.opened = new Promise((resolvePromise, reject) => {
      this.ws.once('open', resolvePromise); this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
  }
  async connect() {
    await this.opened;
    this.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'owner-token', name: 'Owner', skin: 0, weapon: 0 }));
    const ready = await this.waitFor((message) => message.t === MSG.WELCOME || message.t === MSG.ERROR);
    assert.equal(ready.t, MSG.WELCOME, JSON.stringify(ready));
  }
  waitFor(predicate, timeoutMs = 5000) {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('owner wire wait timeout'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function grant() {
  return { v: 1, scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'expected-session' },
    controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: ['move', 'aim'] };
}

async function ownerFiles(directory) {
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await writeFile(join(directory, 'personality.md'), 'A prudente compañera de navegación.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [
    { id: 'sail-safely', status: 'active', text: 'Acompañar al dueño.', constraints: ['Use only granted capabilities'] },
  ] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  return scope;
}

test('real managed body keeps ticking during mind wait; owner stop fences the late proposal after usage settles', { timeout: 25000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = new OwnerWire(url); await owner.connect(); t.after(() => owner.close());
  const directory = await mkdtemp(join(tmpdir(), 'agent-mind-network-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = await ownerFiles(directory);
  const runner = new AgentNetworkRunner({ url, grant: grant(), authorization: { token: AGENT_TOKEN } });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const decision = { type: 'move', args: { mx: 1, mz: 0, durationMs: 900 } };
  let completeStarted, releaseComplete;
  const started = new Promise((resolvePromise) => { completeStarted = resolvePromise; });
  const deferred = new Promise((resolvePromise) => { releaseComplete = resolvePromise; });
  const simulated = createSimulatedMind({ decision });
  const adapter = { ...simulated, async complete(args) {
    completeStarted(); await deferred; return simulated.complete(args);
  } };
  let submitted = 0;
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 3, maxTokens: 50000, maxCostUnits: 50000, maxEntries: 8 } });
  const mind = new AgentMind({ adapter, budget,
    readSnapshot: async () => runnerMindSnapshot(runner, await loadOwnerFiles({ directory, scope })),
    submitOrder: (order) => { submitted++; return runner.order(order); },
    limits: { timeoutMs: 5000 },
  });

  const bodyOrder = { v: 1, actionId: 'body-before-mind', scope: runner.grant.scope,
    controlRevision: runner.grant.controlRevision, observationRevision: runner.observation.revision,
    type: 'move', args: { mx: 1, mz: 0, durationMs: 900 } };
  const acceptedBody = runner.order(bodyOrder);
  assert.equal(acceptedBody.ok, true, JSON.stringify(acceptedBody));
  runner.pump();
  const bodyPump = setInterval(() => runner.pump(), 30);
  t.after(() => clearInterval(bodyPump));
  await until(() => runner.authority?.task?.actionId === bodyOrder.actionId, 'initial server body task');
  const playerSocket = [...server.game.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER);
  const player = server.game.server.clients.get(playerSocket.id);
  const xBefore = server.game.server.world.ecs.x[player.entity];
  const tickBefore = server.game.server.world.tick;
  const pending = mind.decide();
  await started;
  await until(() => server.game.server.world.tick > tickBefore + 10 &&
    server.game.server.world.ecs.x[player.entity] !== xBefore && mind.state.inFlight,
  'live host ticks and body movement while adapter remains pending');

  owner.ws.send(JSON.stringify({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER }));
  await until(() => runner.state === 'stopped' && runner.authority?.receipt?.neutralPending === true &&
    runner.authority.receipt.queueCleared >= 0 && player.queue.length === 0 && player.carry === 0,
  'owner stop receipt confirms cleared queue, zero carry, and neutral input');
  assert.equal(runner.authority.receipt.neutralPending, true);
  releaseComplete();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.why, 'not_ready');
  assert.equal(submitted, 0, 'late model response cannot submit a new body order');
  assert.equal(budget.snapshot.totals.confirmedTokens > 0, true, 'native usage was settled before owner-stop fence handling');
  assert.equal(budget.snapshot.totals.unknownEntries, 0);
  assert.equal(runner.actions.some((action) => action.order.actionId === result.requestId), false);
});

test('simulated structured move is admitted as an acknowledged server task and advances the body', { timeout: 20000 }, async (t) => {
  const { server, url } = await room(t);
  const directory = await mkdtemp(join(tmpdir(), 'agent-mind-move-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = await ownerFiles(directory);
  const runner = new AgentNetworkRunner({ url, grant: grant(), authorization: { token: AGENT_TOKEN } });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 2, maxTokens: 50000, maxCostUnits: 50000, maxEntries: 4 } });
  const mind = new AgentMind({ adapter: createSimulatedMind({ decision: {
    type: 'move', args: { mx: 1, mz: 0, durationMs: 900 },
  } }), budget,
  readSnapshot: async () => runnerMindSnapshot(runner, await loadOwnerFiles({ directory, scope })),
  submitOrder: (order) => runner.order(order),
  });
  const result = await mind.decide();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.action.ok, true);
  const bodyPump = setInterval(() => runner.pump(), 30);
  t.after(() => clearInterval(bodyPump));
  await until(() => runner.authority?.task?.actionId === result.requestId, 'server acknowledges model proposal');
  const playerSocket = [...server.game.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER);
  const player = server.game.server.clients.get(playerSocket.id);
  const xBefore = server.game.server.world.ecs.x[player.entity];
  await until(() => server.game.server.world.ecs.x[player.entity] !== xBefore, 'server movement from structured model order');
  assert.equal(budget.snapshot.totals.settledEntries, 1);
  assert.equal(runner.actions.some((action) => action.order.actionId === result.requestId), true);
});

function cli({ url, files, args = [] }) {
  const child = spawn(process.execPath, ['tools/agent/run.mjs', '--url', url, '--files', files,
    '--owner', OWNER, '--character', CHARACTER, '--world', WORLD, '--account-token-env', 'MN_AGENT_MIND_TEST_TOKEN', ...args],
  { cwd: resolve('.'), env: { ...process.env, MN_AGENT_MIND_TEST_TOKEN: AGENT_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, text: () => stdout, stderr: () => stderr,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
  };
}

test('CLI simulated mind is opt-in, settles one call under maxCalls, stays responsive, and leaves owner files untouched', { timeout: 30000 }, async (t) => {
  const { url } = await room(t);
  const directory = await mkdtemp(join(tmpdir(), 'agent-mind-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await ownerFiles(directory);
  const names = ['personality.md', 'objectives.json', 'memory.jsonl'];
  const before = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')])));
  const p = cli({ url, files: directory, args: ['--mind', 'simulated', '--mind-max-calls', '1'] });
  t.after(async () => { if (p.child.exitCode === null) { p.child.kill(); await once(p.child, 'exit').catch(() => {}); } });
  await until(() => p.events().some((event) => event.type === 'ready'), 'mind CLI ready');
  assert.equal(p.events().find((event) => event.type === 'ready').data.gameSpendingEnabled, false);
  p.send({ type: 'think' });
  await until(() => p.events().some((event) => event.type === 'mind_result'), 'first simulated mind response');
  p.send({ type: 'think' });
  await until(() => p.events().filter((event) => event.type === 'mind_result').length === 2, 'second mind admission result');
  p.send({ type: 'mind' });
  await until(() => p.events().filter((event) => event.type === 'mind').length >= 2, 'mind ledger inspection');
  const results = p.events().filter((event) => event.type === 'mind_result').map((event) => event.data);
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(results[1].why, 'max_calls');
  const view = p.events().filter((event) => event.type === 'mind').at(-1).data;
  assert.equal(view.ledger.totals.calls, 1);
  assert.equal(view.ledger.totals.settledEntries, 1);
  assert.equal(view.ledger.totals.confirmedTokens > 0, true);
  assert.equal(view.ledger.totals.unknownEntries, 0);
  assert.equal(p.text().includes(AGENT_TOKEN), false);
  assert.equal(p.stderr(), '');
  p.send({ type: 'stop' });
  const [code] = await once(p.child, 'exit');
  assert.equal(code, 0);
  assert.ok(p.events().some((event) => event.type === 'stop_response'));
  for (const name of names) assert.equal(await readFile(join(directory, name), 'utf8'), before.get(name));
});

test('CLI default rejects think, and simulated input budget rejects before dispatch', { timeout: 30000 }, async (t) => {
  const { url } = await room(t);
  const directory = await mkdtemp(join(tmpdir(), 'agent-mind-disabled-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await ownerFiles(directory);
  const disabled = cli({ url, files: directory });
  t.after(async () => { if (disabled.child.exitCode === null) { disabled.child.kill(); await once(disabled.child, 'exit').catch(() => {}); } });
  await until(() => disabled.events().some((event) => event.type === 'ready'), 'default CLI ready');
  disabled.send({ type: 'think' });
  await until(() => disabled.events().some((event) => event.type === 'rejected'), 'default mind rejection');
  assert.equal(disabled.events().find((event) => event.type === 'rejected').data.why, 'mind_disabled');
  disabled.send({ type: 'stop' });
  assert.equal((await once(disabled.child, 'exit'))[0], 0);

  const limited = cli({ url, files: directory, args: ['--mind', 'simulated', '--mind-max-tokens', '1'] });
  t.after(async () => { if (limited.child.exitCode === null) { limited.child.kill(); await once(limited.child, 'exit').catch(() => {}); } });
  await until(() => limited.events().some((event) => event.type === 'ready'), 'limited CLI ready');
  limited.send({ type: 'think' });
  await until(() => limited.events().some((event) => event.type === 'mind_result'), 'input budget rejection');
  const result = limited.events().find((event) => event.type === 'mind_result').data;
  assert.equal(result.why, 'max_tokens');
  limited.send({ type: 'mind' });
  await until(() => limited.events().filter((event) => event.type === 'mind').length >= 2, 'budget ledger inspection');
  const state = limited.events().filter((event) => event.type === 'mind').at(-1).data;
  assert.equal(state.ledger.totals.calls, 0);
  assert.equal(state.ledger.totals.entries, 0, 'no provider dispatch or reservation occurs when input exceeds budget');
  limited.send({ type: 'stop' });
  assert.equal((await once(limited.child, 'exit'))[0], 0);
});
