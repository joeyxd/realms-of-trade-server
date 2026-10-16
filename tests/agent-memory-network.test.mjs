import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore as createGameStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { createSimulatedMind } from '../tools/agent/simulated-mind.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { createMemoryStore as createOwnerMemoryStore } from '../tools/agent/memory-store.mjs';
import { parseMemoryJournal } from '../tools/agent/memory-journal.mjs';

const WORLD = 'memory-network-lab';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-memory-network-local-token';
const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
const wait = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function until(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = check(); if (value) return value; await wait(10); }
  assert.fail(`${label} timeout`);
}

async function room(t) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 19, bots: 0, maxPlayers: 8, dev: false,
    worldId: WORLD, saveSecret: 'agent-memory-network-test-secret', store: createGameStore(), log() {},
    resolvePlayer: async (_request, message) => message.token === 'owner-token' ? OWNER : message.token === AGENT_TOKEN ? CHARACTER : null,
    agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move', 'aim'] }] },
  });
  const port = await server.listen(); t.after(() => server.close()); return { server, url: `ws://127.0.0.1:${port}/ws` };
}

class OwnerWire {
  constructor(url) {
    this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.opened = new Promise((resolvePromise, reject) => { this.ws.once('open', resolvePromise); this.ws.once('error', reject); });
    this.ws.on('message', (data) => {
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
  }
  async connect() {
    await this.opened;
    this.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: 'owner-token', name: 'Owner', skin: 0, weapon: 0 }));
    const response = await this.waitFor((message) => message.t === MSG.WELCOME || message.t === MSG.ERROR);
    assert.equal(response.t, MSG.WELCOME, JSON.stringify(response));
  }
  waitFor(predicate, timeoutMs = 5000) {
    const prior = this.messages.find(predicate); if (prior) return Promise.resolve(prior);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, reject, timer: null };
      waiter.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('owner wire wait timeout')); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function grant(sessionId = 'memory-network-session-1') {
  return { v: 1, scope: { ...scope, sessionId }, controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: ['move'] };
}
async function ownerFiles(directory) {
  await writeFile(join(directory, 'personality.md'), 'Compañera prudente de navegación.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [
    { id: 'sail-safely', status: 'active', text: 'Acompañar al dueño.', constraints: ['Use only granted capabilities'] },
  ] }) + '\n');
  await writeFile(join(directory, 'memory.jsonl'), '', 'utf8');
  return loadOwnerFiles({ directory, scope });
}
const budgetFor = () => new InferenceBudget({ scope, limits: { maxCalls: 4, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 8 } });
function snapshotFor(runner, files) {
  const snapshot = runnerMindSnapshot(runner, files);
  return { ...snapshot, memoryJournal: files.files.memory.journal };
}
function runCli({ url, files }) {
  const child = spawn(process.execPath, ['tools/agent/run.mjs', '--url', url, '--files', files, '--owner', OWNER, '--character', CHARACTER,
    '--world', WORLD, '--account-token-env', 'MN_AGENT_MEMORY_TEST_TOKEN', '--mind', 'simulated', '--mind-memory'],
  { cwd: resolve('.'), env: { ...process.env, MN_AGENT_MEMORY_TEST_TOKEN: AGENT_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, text: () => stdout, stderr: () => stderr,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`), };
}
async function stopCli(process) {
  process.send({ type: 'stop' }); const [code] = await once(process.child, 'exit'); return code;
}

test('a server sourced episode survives a fresh managed session and compaction retains uncertainty without replaying orders', { timeout: 30000 }, async (t) => {
  const { url } = await room(t), owner = new OwnerWire(url); await owner.connect(); t.after(() => owner.close());
  const directory = await mkdtemp(join(tmpdir(), 'agent-memory-network-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let files = await ownerFiles(directory);
  const store = createOwnerMemoryStore({ directory, scope }), runner = new AgentNetworkRunner({ url, grant: grant(), authorization: { token: AGENT_TOKEN } });
  t.after(() => runner.close()); await runner.connect({ autoTick: false });
  assert.equal(runner.observation.source, 'server');
  const oldSession = runner.grant.scope.sessionId;
  const sourceAction = { actionId: 'remembered-uncertain-move', state: 'uncertain' };
  let current = snapshotFor(runner, files);
  current.required.pending.push(sourceAction);
  const firstMind = new AgentMind({ adapter: createSimulatedMind(), budget: budgetFor(), readSnapshot: async () => current,
    readCommitSnapshot: () => snapshotFor(runner, files), appendMemory: (request) => store.append(request), submitOrder: () => ({ ok: false }) });
  const captured = await firstMind.remember();
  assert.equal(captured.ok, true, JSON.stringify(captured));
  files = await loadOwnerFiles({ directory, scope });
  const original = files.files.memory.journal.entries[0];
  assert.equal(original.kind, 'episode');
  assert.equal(original.payload.observation.revision, current.observation.revision);
  assert.deepEqual(original.payload.pending, [sourceAction]);
  assert.deepEqual(files.files.memory.journal.pending.map((item) => ({ actionId: item.actionId, retryAllowed: item.retryAllowed })),
    [{ actionId: `${oldSession}:${sourceAction.actionId}`, retryAllowed: false }]);

  runner.stop(OWNER); await until(() => runner.state === 'stopped', 'first managed session stops');
  const reentered = await runner.reenter(OWNER); assert.equal(reentered.ok, true, JSON.stringify(reentered));
  assert.notEqual(runner.grant.scope.sessionId, oldSession);
  files = await loadOwnerFiles({ directory, scope });
  let capturedCompaction;
  const base = createSimulatedMind({ decision: { type: 'summarize_memory', args: { text: 'The earlier movement remains unresolved.', tags: [], basis: [original.id] } } });
  const compactionAdapter = { ...base, async complete(request) {
    capturedCompaction = JSON.parse(request.body).context.required.tools.memoryCompaction;
    return base.complete(request);
  } };
  let submittedOrders = 0;
  const freshMind = new AgentMind({ adapter: compactionAdapter, budget: budgetFor(),
    readSnapshot: async () => { files = await loadOwnerFiles({ directory, scope }); return snapshotFor(runner, files); },
    readCommitSnapshot: () => snapshotFor(runner, files), appendMemory: (request) => store.append(request),
    submitOrder: () => { submittedOrders += 1; return { ok: true }; } });
  const compacted = await freshMind.compactMemory({ sourceIds: [original.id] });
  assert.equal(compacted.ok, true, JSON.stringify(compacted));
  assert.deepEqual(capturedCompaction.sources.map((entry) => entry.id), [original.id]);
  assert.equal(capturedCompaction.policy.preserveUncertainty, true);
  assert.equal(compacted.memory.certainty, 'uncertain');
  files = await loadOwnerFiles({ directory, scope });
  assert.equal(files.files.memory.journal.revision, 2);
  assert.deepEqual(files.files.memory.journal.entries.map((entry) => entry.kind), ['episode', 'summary']);
  assert.deepEqual(files.files.memory.journal.entries[1].payload.sources, [{ id: original.id, sha256: original.sha256 }]);
  assert.equal(runner.actions.length, 0);
  assert.equal(submittedOrders, 0);
});

test('owner stop during a waiting memory writer fails the final guard with known zero usage and no file changes', { timeout: 30000 }, async (t) => {
  const { url } = await room(t), owner = new OwnerWire(url); await owner.connect(); t.after(() => owner.close());
  const directory = await mkdtemp(join(tmpdir(), 'agent-memory-owner-stop-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let files = await ownerFiles(directory);
  const before = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(join(directory, name))));
  const runner = new AgentNetworkRunner({ url, grant: grant('memory-stop-session'), authorization: { token: AGENT_TOKEN } }); t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const store = createOwnerMemoryStore({ directory, scope });
  let entered, release; const waiting = new Promise((resolvePromise) => { entered = resolvePromise; });
  const hold = new Promise((resolvePromise) => { release = resolvePromise; });
  const mind = new AgentMind({ adapter: createSimulatedMind(), budget: budgetFor(),
    readSnapshot: async () => { files = await loadOwnerFiles({ directory, scope }); return snapshotFor(runner, files); },
    readCommitSnapshot: () => snapshotFor(runner, files),
    appendMemory: async (request) => { entered(request); await hold; return store.append(request); }, submitOrder: () => ({ ok: true }) });
  const pending = mind.remember(); await waiting;
  owner.ws.send(JSON.stringify({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER }));
  await until(() => runner.state === 'stopped', 'owner stop reaches managed memory writer');
  release();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.why, 'not_ready');
  assert.equal(mind.state.ledger.totals.unknownEntries, 0);
  assert.equal(mind.state.ledger.totals.calls, 0);
  assert.equal(mind.state.ledger.totals.confirmedTokens, 0);
  assert.deepEqual(await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl'].map((name) => readFile(join(directory, name)))), before);
});

test('CLI memory permission requires its flag, persists remember and compaction across restart, keeps credentials private, and stops cleanly', { timeout: 35000 }, async (t) => {
  const { url } = await room(t), directory = await mkdtemp(join(tmpdir(), 'agent-memory-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true })); await ownerFiles(directory);
  const process = runCli({ url, files: directory });
  t.after(async () => { if (process.child.exitCode === null) { process.child.kill(); await once(process.child, 'exit').catch(() => {}); } });
  await until(() => process.events().some((event) => event.type === 'ready'), 'memory CLI ready');
  const before = await loadOwnerFiles({ directory, scope });
  assert.equal(before.files.memory.journal.revision, 0);
  process.send({ type: 'remember' });
  await until(() => process.events().some((event) => event.type === 'memory_result'), 'CLI remember completion');
  const remembered = process.events().find((event) => event.type === 'memory_result').data;
  assert.equal(remembered.ok, true, JSON.stringify(remembered));
  process.send({ type: 'files' });
  await until(() => process.events().filter((event) => event.type === 'owner_files').length >= 2, 'refreshed CLI owner files after remember');
  const refreshedFiles = process.events().filter((event) => event.type === 'owner_files').at(-1).data;
  const episode = refreshedFiles.files.memory.journal.entries[0]; assert.equal(episode.kind, 'episode');
  assert.equal(episode.payload.observation.revision > 0, true);
  process.send({ type: 'compact_memory', sourceIds: [episode.id] });
  await until(() => process.events().some((event) => event.type === 'compaction_result'), 'CLI compaction completion');
  const compacted = process.events().find((event) => event.type === 'compaction_result').data;
  assert.equal(compacted.ok, true, JSON.stringify(compacted));
  process.send({ type: 'files' });
  await until(() => process.events().filter((event) => event.type === 'owner_files').length >= 3, 'refreshed CLI owner files after compaction');
  const refreshedAfterCompaction = process.events().filter((event) => event.type === 'owner_files').at(-1).data;
  assert.equal(refreshedAfterCompaction.files.memory.journal.revision, 2);
  const saved = await loadOwnerFiles({ directory, scope });
  assert.equal(saved.files.memory.journal.revision, 2);
  assert.deepEqual(saved.files.memory.journal.entries.map((entry) => entry.kind), ['episode', 'summary']);
  assert.equal(process.text().includes(AGENT_TOKEN), false);
  assert.equal(await stopCli(process), 0);
  assert.ok(process.events().some((event) => event.type === 'stop_response'));
  assert.equal(process.stderr(), '');

  const fresh = runCli({ url, files: directory });
  t.after(async () => { if (fresh.child.exitCode === null) { fresh.child.kill(); await once(fresh.child, 'exit').catch(() => {}); } });
  await until(() => fresh.events().some((event) => event.type === 'ready'), 'fresh CLI process ready');
  const visible = fresh.events().find((event) => event.type === 'owner_files').data;
  assert.equal(parseMemoryJournal(visible.files.memory.content, scope).revision, 2);
  assert.equal(fresh.text().includes(AGENT_TOKEN), false);
  assert.equal(await stopCli(fresh), 0);
  assert.ok(fresh.events().some((event) => event.type === 'stop_response'));
  assert.equal(fresh.stderr(), '');
});
