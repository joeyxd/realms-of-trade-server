import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { WsTransport } from '../src/net/wsTransport.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';

const WORLD = 'authority-lab';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'agent-runner-private-test-token';
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function until(check, label, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(10);
  }
  assert.fail(`${label} timeout`);
}

function placeholderGrant({ worldId = WORLD, characterId = CHARACTER, sessionId = 'expected-local-session' } = {}) {
  return { v: 1, scope: { ownerId: OWNER, characterId, worldId, sessionId }, controlRevision: 1,
    expiresAtMs: Date.now() + 60000, capabilities: ['move', 'aim'] };
}

function options({ worldId = WORLD, characterId = CHARACTER, authorization = true, feedback = () => {} } = {}) {
  return { url: 'ws://127.0.0.1:1/ws', grant: placeholderGrant({ worldId, characterId }),
    ...(authorization ? { authorization: { token: TOKEN } } : {}), onFeedback: feedback };
}

async function room(t, agentToken = TOKEN) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8, dev: false,
    worldId: WORLD, saveSecret: 'agent-authority-runner-test-secret', store: createMemoryStore(), log() {},
    resolvePlayer: async (_request, message) => message.token === 'owner-token' ? OWNER :
      message.token === agentToken ? CHARACTER : null,
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
    assert.equal(Object.hasOwn(ready, 'control'), false);
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
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

function orderFor(runner, actionId, args = { mx: 1, mz: 0, durationMs: 1000 }) {
  return { v: 1, actionId, scope: runner.grant.scope, controlRevision: runner.grant.controlRevision,
    observationRevision: runner.observation.revision, type: 'move', args };
}

test('authenticated runner adopts the server grant, validates scope, and waits for task acknowledgement before input', { timeout: 20000 }, async (t) => {
  const { server, url } = await room(t);
  const runner = new AgentNetworkRunner({ ...options(), url });
  t.after(() => runner.close());
  assert.equal(runner.authority, null);
  const ready = await runner.connect({ autoTick: false });
  assert.equal(ready.identity.mode, 'agent');
  assert.deepEqual(runner.grant.scope, { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD,
    sessionId: runner.authority.grant.scope.sessionId });
  assert.notEqual(runner.grant.scope.sessionId, 'expected-local-session');
  assert.equal(runner.authority.state, 'active');
  assert.equal(runner.lifecycle.authority, 'server_controller');
  assert.deepEqual(runner.grant.capabilities, ['move', 'aim']);
  assert.equal(JSON.stringify(runner.lifecycle).includes(TOKEN), false);

  clearInterval(server.game.timer); server.game.timer = null;
  const response = runner.order(orderFor(runner, 'goal-waiting'));
  assert.equal(response.ok, true);
  assert.deepEqual(runner.pump(), { ok: false, why: 'control_pending' });
  await until(() => runner.authority?.task?.actionId === 'goal-waiting', 'server task acknowledgement');
  assert.equal(runner.pump().ok, true);
  const connection = [...server.game.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER);
  const current = server.game.server.clients.get(connection.id);
  await until(() => current.queue.length === 1, 'authorized input reaches host queue');
  runner.close();
  await until(() => server.game.agentControl.byCharacter(CHARACTER)?.state === 'revoked', 'first authenticated lease retired');

  const mismatched = new AgentNetworkRunner({ ...options({ characterId: '55555555-5555-4555-8555-555555555555' }), url, maxSessions: 2 });
  await assert.rejects(mismatched.connect({ autoTick: false }), { code: 'invalid_server_grant' });
  await until(() => server.game.agentControl.byCharacter(CHARACTER)?.state === 'revoked', 'mismatched grant retired');
  assert.equal((await mismatched.reenter(OWNER)).why, 'invalid_server_grant');
  assert.equal(mismatched.lifecycle.sessionsUsed, 2);
  assert.equal((await mismatched.reenter(OWNER)).why, 'session_capacity');
});

test('owner direct movement outranks runner goals; owner revoke archives uncertainty and requires resume plus a fresh epoch', { timeout: 25000 }, async (t) => {
  const { url } = await room(t);
  const owner = new OwnerWire(url);
  await owner.connect();
  t.after(() => owner.close());
  const transports = [];
  const runner = new AgentNetworkRunner({ ...options(), url, transportFactory: (address) => {
    const transport = new WsTransport(address), realClose = transport.close.bind(transport);
    const receive = transport.ws.onmessage;
    transport.ws.onmessage = (event) => {
      receive(event);
      try {
        const message = JSON.parse(event.data);
        if (message.t === MSG.AGENT_STATE) transport.authorityMessages.push(message);
      } catch { /* malformed frames are ignored by the transport */ }
    };
    transport.authorityMessages = [];
    transport.realClose = realClose;
    transport.close = () => {}; // Keep the retired socket open long enough to deliver a stale task.
    transports.push(transport);
    return transport;
  } });
  t.after(() => runner.close());
  t.after(() => { for (const transport of transports) transport.realClose(); });
  await runner.connect({ autoTick: false });

  runner.order(orderFor(runner, 'goal-before-owner'));
  assert.equal(runner.pump().why, 'control_pending');
  await until(() => runner.authority?.task?.actionId === 'goal-before-owner', 'agent goal acknowledgement');
  const epoch = runner.grant.controlRevision;
  const taskRevision = runner.authority.taskRevision;
  owner.send({ t: MSG.AGENT_CONTROL, op: 'direct', characterId: CHARACTER, task: {
    epoch, expectedTaskRevision: taskRevision, actionId: 'owner-direct', type: 'move',
    args: { mx: 0, mz: 1, durationMs: 1000 },
  } });
  await until(() => runner.authority?.task?.actionId === 'owner-direct', 'owner direct task');
  assert.equal(runner.authority.task.priority, 'direct');
  assert.equal(runner.order(orderFor(runner, 'runner-under-direct')).why, 'priority');
  assert.equal(runner.cancel('owner-direct', OWNER).why, 'priority');
  assert.ok(runner.actions.some((action) => action.order.actionId === 'owner-direct'));
  assert.equal(runner.pump().ok, true);
  await until(() => runner.actions.find((action) => action.order.actionId === 'owner-direct')?.state === 'sent', 'direct input sent');

  owner.send({ t: MSG.AGENT_CONTROL, op: 'revoke', characterId: CHARACTER });
  await until(() => runner.state === 'stopped' && runner.lifecycle.archives.length === 1, 'owner revoke archived runner');
  const archive = runner.lifecycle.archives[0];
  assert.equal(archive.termination.serverQueueRevocation, 'confirmed');
  assert.ok(archive.actions.some((action) => action.order.actionId === 'owner-direct' && action.state === 'uncertain'));
  assert.equal(runner.order({ v: 1, actionId: 'old-control-order', scope: archive.scope,
    controlRevision: archive.controlRevision, observationRevision: 1, type: 'move',
    args: { mx: 1, mz: 0, durationMs: 1000 } }).why, 'not_ready');
  transports[0].closed = true; // Preserve only the wire for the deliberately late stale-task delivery.
  assert.equal((await runner.reenter(OWNER)).why, 'server_auth', 'server denies a fresh connection until owner resume');
  transports[1].closed = true;
  const staleTransport = transports[0];
  staleTransport.send({ t: MSG.AGENT_TASK, epoch, expectedTaskRevision: 2, actionId: 'delayed-old-epoch',
    type: 'move', args: { mx: 1, mz: 0, durationMs: 1000 }, priority: 'goal' });
  await until(() => staleTransport.authorityMessages.some((message) => message.why === 'disabled'), 'old epoch rejected by server');
  staleTransport.realClose();

  owner.send({ t: MSG.AGENT_CONTROL, op: 'resume', characterId: CHARACTER });
  await owner.waitFor((message) => message.t === MSG.AGENT_STATE && message.resumed === true);
  const fresh = await runner.reenter(OWNER);
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.ok(runner.grant.controlRevision > epoch);
  assert.notEqual(runner.grant.scope.sessionId, archive.scope.sessionId);
  assert.equal(runner.authority.task, null);
});

test('agent self-release receives a confirmed server receipt and does not disable the binding', { timeout: 20000 }, async (t) => {
  const { url } = await room(t);
  const runner = new AgentNetworkRunner({ ...options(), url });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false });
  const epoch = runner.grant.controlRevision;
  assert.equal(runner.stop(OWNER).serverQueueRevocation, 'pending');
  await until(() => runner.state === 'stopped' && runner.lifecycle.archives.length === 1, 'agent release confirmation');
  assert.equal(runner.lifecycle.archives[0].termination.serverQueueRevocation, 'confirmed');
  assert.equal(runner.authority.state, 'revoked');
  assert.equal(runner.authority.why, 'stop');
  const next = await runner.reenter(OWNER);
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.ok(runner.grant.controlRevision > epoch, 'a self-release is not an owner revocation and needs no owner resume');
});

test('CLI reads authenticated token only from the named environment variable and keeps it out of output and context', { timeout: 25000 }, async (t) => {
  const secret = 'never-print-this-agent-token';
  const { url } = await room(t, secret);
  const directory = await mkdtemp(join(tmpdir(), 'agent-authority-runner-'));
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await writeFile(join(directory, 'personality.md'), 'Agente de prueba.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  let child;
  let stdout = '', stderr = '';
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit').catch(() => {}); }
    await rm(directory, { recursive: true, force: true });
  });
  child = spawn(process.execPath, ['tools/agent/run.mjs', '--url', url, '--files', directory, '--owner', OWNER,
    '--character', CHARACTER, '--world', WORLD, '--account-token-env', 'MN_AGENT_RUNNER_TEST_TOKEN'],
  { cwd: resolve('.'), env: { ...process.env, MN_AGENT_RUNNER_TEST_TOKEN: secret }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const events = () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  await until(() => events().some((event) => event.type === 'ready') || child.exitCode !== null, 'authenticated CLI ready');
  assert.equal(child.exitCode, null, `CLI failed before ready: stdout=${stdout} stderr=${stderr}`);
  const ready = events().find((event) => event.type === 'ready').data;
  assert.equal(ready.identity.mode, 'agent');
  assert.equal(ready.authority, 'server_controller');
  assert.deepEqual(ready.grant.scope, { ...scope, sessionId: ready.grant.scope.sessionId });
  child.stdin.write('{"type":"context"}\n{"type":"files"}\n');
  await until(() => events().some((event) => event.type === 'owner_files') && events().some((event) => event.type === 'context'), 'CLI context and files');
  assert.equal(stdout.includes(secret), false);
  assert.equal(stderr.includes(secret), false);
  assert.equal(JSON.stringify(events()).includes(secret), false);
  child.stdin.end('{"type":"stop"}\n');
  await once(child, 'exit');
  assert.equal(child.exitCode, 0, `stdout=${stdout} stderr=${stderr}`);
  const stopped = events().find((event) => event.type === 'stopped')?.data;
  assert.equal(stopped?.termination?.serverQueueRevocation, 'confirmed', 'EOF must wait for the authenticated release receipt');
});
