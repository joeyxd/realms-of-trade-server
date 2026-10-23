import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
import { createObjectiveStore } from '../tools/agent/objective-store.mjs';

const WORLD = 'mind-network-lab';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-goals-network-local-token';
const wait = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function until(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await wait(10);
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
      waiter.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('owner wire wait timeout')); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function grant() {
  return { v: 1, scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'expected-goal-session' },
    controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: ['move'] };
}

async function ownerFiles(directory) {
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await writeFile(join(directory, 'personality.md'), 'Compañera prudente de navegación.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [
    { id: 'sail-safely', status: 'active', text: 'Acompañar al dueño.', constraints: ['Use only granted capabilities'] },
  ] }) + '\n');
  await writeFile(join(directory, 'memory.jsonl'), '');
  return scope;
}

function makeAdapter({ hold = false } = {}) {
  let begin, release;
  const started = new Promise((resolvePromise) => { begin = resolvePromise; });
  const base = createSimulatedMind();
  return { started, release: () => release?.(), adapter: {
    ...base,
    async complete({ body }) {
      const packet = JSON.parse(body), context = packet.context;
      const turn = context.required.tools.goalRevision;
      const feedback = turn.feedback;
      begin({ packet, feedback });
      if (hold) await new Promise((resolvePromise) => { release = resolvePromise; });
      const decision = { type: 'revise_goals', args: { goals: [
        { id: 'sail-safely', status: 'active', text: `Ajuste de meta con revisión ${turn.expectedRevision + 1}.`, constraints: ['Use only granted capabilities'] },
      ], reason: 'Revisión acotada por el contexto recibido.', basis: [feedback[0].id] } };
      const text = JSON.stringify({ v: 1, decision });
      return { text, usage: { inputTokens: Buffer.byteLength(body), outputTokens: Buffer.byteLength(text), costUnits: 1 } };
    },
  } };
}

function cachedCommitSnapshot(runner, latestFiles) {
  return () => runnerMindSnapshot(runner, latestFiles.current);
}

function hashesOnDisk(directory) {
  const hash = (name) => createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
  return { personality: hash('personality.md'), objectives: hash('objectives.json'), memory: hash('memory.jsonl') };
}

function cli({ url, files }) {
  const child = spawn(process.execPath, ['tools/agent/run.mjs', '--url', url, '--files', files,
    '--owner', OWNER, '--character', CHARACTER, '--world', WORLD, '--account-token-env', 'MN_AGENT_GOALS_TEST_TOKEN',
    '--mind', 'simulated', '--mind-goals'],
  { cwd: resolve('.'), env: { ...process.env, MN_AGENT_GOALS_TEST_TOKEN: AGENT_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, text: () => stdout, stderr: () => stderr,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
  };
}

test('localhost runner feeds correlated body feedback into goal turns while the body keeps moving and commits real revisions', { timeout: 30000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = new OwnerWire(url); await owner.connect(); t.after(() => owner.close());
  const directory = await mkdtemp(join(tmpdir(), 'agent-goals-network-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = await ownerFiles(directory);
  const runner = new AgentNetworkRunner({ url, grant: grant(), authorization: { token: AGENT_TOKEN } });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const playerSocket = [...server.game.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER);
  const player = server.game.server.clients.get(playerSocket.id);
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 4, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 8 } });
  const latestFiles = { current: await loadOwnerFiles({ directory, scope }) };
  const store = createObjectiveStore({ directory, scope });
  const bodyOrder = { v: 1, actionId: 'goal-feedback-move', scope: runner.grant.scope,
    controlRevision: runner.grant.controlRevision, observationRevision: runner.observation.revision,
    type: 'move', args: { mx: 1, mz: 0, durationMs: 900 } };
  const admitted = runner.order(bodyOrder);
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  let lastPump = runner.pump();
  const pump = setInterval(() => { lastPump = runner.pump(); }, 30); t.after(() => clearInterval(pump));
  await until(() => runner.authority?.task?.actionId === bodyOrder.actionId, 'managed movement task');
  const xBeforeWait = server.game.server.world.ecs.x[player.entity];
  const tickBeforeWait = server.game.server.world.tick;
  const held = makeAdapter({ hold: true });
  const mind = new AgentMind({ adapter: held.adapter, budget,
    readSnapshot: async () => { latestFiles.current = await loadOwnerFiles({ directory, scope }); return runnerMindSnapshot(runner, latestFiles.current); },
    readCommitSnapshot: cachedCommitSnapshot(runner, latestFiles),
    commitGoals: (request) => store.commit(request), submitOrder: (order) => runner.order(order),
    limits: { timeoutMs: 7000 },
  });
  const firstPending = mind.reviseGoals();
  const { packet: firstPacket } = await held.started;
  const firstTurn = firstPacket.context.required.tools.goalRevision;
  assert.ok(firstTurn.feedback.some((item) => item.kind === 'observation' && item.source === 'server' && item.self.position),
    'the goal prompt receives the live server observation as feedback');
  assert.ok(firstTurn.feedback.some((item) => item.id === `action:${bodyOrder.actionId}`),
    'the bounded feedback projection includes the ongoing body action');
  await until(() => server.game.server.world.tick > tickBeforeWait + 10 &&
    server.game.server.world.ecs.x[player.entity] !== xBeforeWait && mind.state.inFlight,
  'authoritative body progress during held goal inference');
  held.release();
  const first = await firstPending;
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.objective.gameplaySuccess, false);
  assert.equal(first.objective.revision, 2);
  assert.equal(budget.snapshot.totals.calls, 1);
  assert.equal(budget.snapshot.totals.unknownEntries, 0);
  assert.equal((await loadOwnerFiles({ directory, scope })).files.objectives.revision, 2);

  const secondAdapter = makeAdapter();
  const secondMind = new AgentMind({ adapter: secondAdapter.adapter, budget,
    readSnapshot: async () => { latestFiles.current = await loadOwnerFiles({ directory, scope }); return runnerMindSnapshot(runner, latestFiles.current); },
    readCommitSnapshot: cachedCommitSnapshot(runner, latestFiles), commitGoals: (request) => store.commit(request),
    submitOrder: (order) => runner.order(order), limits: { timeoutMs: 7000 },
  });
  const secondPending = secondMind.reviseGoals();
  const { packet: secondPacket } = await secondAdapter.started;
  const secondTurn = secondPacket.context.required.tools.goalRevision;
  assert.equal(secondTurn.expectedRevision, 2);
  assert.equal(secondTurn.beforeGoals[0].text, 'Ajuste de meta con revisión 2.');
  const second = await secondPending;
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.objective.revision, 3);
  assert.equal((await loadOwnerFiles({ directory, scope })).files.objectives.revision, 3);
});

test('managed owner stop during objective commit rejects the final guard without writing the real owner file', { timeout: 25000 }, async (t) => {
  const { url } = await room(t);
  const owner = new OwnerWire(url); await owner.connect(); t.after(() => owner.close());
  const directory = await mkdtemp(join(tmpdir(), 'agent-goals-owner-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = await ownerFiles(directory);
  const beforeFiles = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(join(directory, name))));
  const runner = new AgentNetworkRunner({ url, grant: grant(), authorization: { token: AGENT_TOKEN } });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const latestFiles = { current: await loadOwnerFiles({ directory, scope }) };
  const store = createObjectiveStore({ directory, scope });
  let commitStarted, releaseCommit;
  const commitEntered = new Promise((resolvePromise) => { commitStarted = resolvePromise; });
  const held = new Promise((resolvePromise) => { releaseCommit = resolvePromise; });
  const scripted = makeAdapter();
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 2, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 4 } });
  const mind = new AgentMind({ adapter: scripted.adapter, budget,
    readSnapshot: async () => { latestFiles.current = await loadOwnerFiles({ directory, scope }); return runnerMindSnapshot(runner, latestFiles.current); },
    readCommitSnapshot: cachedCommitSnapshot(runner, latestFiles),
    commitGoals: async (request) => { commitStarted(request); await held; return store.commit(request); },
    submitOrder: (order) => runner.order(order), limits: { timeoutMs: 7000 },
  });
  const pending = mind.reviseGoals();
  const request = await commitEntered;
  assert.equal(budget.snapshot.totals.confirmedTokens > 0, true, 'provider usage is settled before commit gate');
  owner.ws.send(JSON.stringify({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER }));
  await until(() => runner.state === 'stopped', 'owner stop reaches managed runner');
  releaseCommit();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.why, 'not_ready');
  assert.equal(budget.snapshot.totals.unknownEntries, 0);
  assert.equal(request.expectedRevision, 1);
  const afterFiles = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(join(directory, name))));
  assert.deepEqual(afterFiles, beforeFiles, 'the actual objective file and other owner files remain byte-identical');
  assert.equal((await loadOwnerFiles({ directory, scope })).files.objectives.revision, 1);
});

test('CLI goal permission is opt-in, writes only objectives, keeps credentials private and exits on owner stop', { timeout: 30000 }, async (t) => {
  const { url } = await room(t);
  const directory = await mkdtemp(join(tmpdir(), 'agent-goals-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await ownerFiles(directory);
  const beforePersonality = await readFile(join(directory, 'personality.md'));
  const beforeMemory = await readFile(join(directory, 'memory.jsonl'));
  const process = cli({ url, files: directory });
  t.after(async () => { if (process.child.exitCode === null) { process.child.kill(); await once(process.child, 'exit').catch(() => {}); } });
  await until(() => process.events().some((event) => event.type === 'ready'), 'goal CLI ready');
  process.send({ type: 'revise_goals' });
  await until(() => process.events().some((event) => event.type === 'goals_result'), 'simulated objective commit');
  const result = process.events().find((event) => event.type === 'goals_result').data;
  assert.equal(result.ok, true, JSON.stringify(result));
  const saved = JSON.parse(await readFile(join(directory, 'objectives.json'), 'utf8'));
  assert.equal(saved.revision, 2);
  assert.equal(saved.goals[0].status, 'active');
  assert.deepEqual(await readFile(join(directory, 'personality.md')), beforePersonality);
  assert.deepEqual(await readFile(join(directory, 'memory.jsonl')), beforeMemory);
  assert.equal(process.text().includes(AGENT_TOKEN), false);
  process.send({ type: 'stop' });
  const [code] = await once(process.child, 'exit');
  assert.equal(code, 0);
  assert.ok(process.events().some((event) => event.type === 'stop_response'));
  assert.equal(process.stderr(), '');
});
