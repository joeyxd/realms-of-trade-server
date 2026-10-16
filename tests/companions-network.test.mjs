import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';

const WORLD = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const GUEST_OWNER = '44444444-4444-4444-8444-444444444444';
const UNMAPPED = '66666666-6666-4666-8666-666666666666';
const NEVER_ADMITTED = '77777777-7777-4777-8777-777777777777';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('Timed out waiting for agent authority wire evidence');
}

class WireClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.waiters = [];
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    });
  }
  async send(message) { await this.opened; this.ws.send(JSON.stringify(message)); }
  waitFor(predicate, timeoutMs = 4000) {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      this.waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        const evidence = this.messages.slice(-12).map(({ t, ok, why, resumed, state, receipt }) => ({
          t, ok, why, resumed, state: state ? { state: state.state, taskRevision: state.taskRevision,
            task: state.task && { actionId: state.task.actionId, priority: state.task.priority } } : null, receipt,
        }));
        reject(new Error(`Timed out waiting for wire message; recent authority messages: ${JSON.stringify(evidence)}`));
      }, timeoutMs);
      const done = waiter.resolve;
      waiter.resolve = (message) => { clearTimeout(timer); done(message); };
    });
  }
  waitForNew(predicate, timeoutMs = 4000) {
    const after = this.messages.length;
    return this.waitFor((message) => this.messages.indexOf(message) >= after && predicate(message), timeoutMs);
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function hello(token, { agent = false, name = 'Authority test' } = {}) {
  return { t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name, skin: 0, weapon: 0 };
}

async function connect(url, token, options = {}) {
  const client = new WireClient(url);
  await client.send(hello(token, options));
  const result = await client.waitFor((message) => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(message.t));
  return { client, result };
}

async function room(t, { agentControl = true, extraBindings = [], ttlMs = 60000, capabilities = ['move', 'aim', 'attack_pve', 'body_pve', 'chat'], dev = false,
  worldId = WORLD, store = createMemoryStore(), resolvePlayer = async (_req, message) => ({
  'owner-token': OWNER, 'guest-owner-token': GUEST_OWNER, 'agent-token': CHARACTER,
  'other-agent-token': GUEST_OWNER, 'unmapped-agent-token': UNMAPPED,
}[message.token] ?? null) } = {}) {
  const options = {
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8, dev,
    worldId, saveSecret: 'agent-authority-ws-test-secret', store,
    resolvePlayer, log() {},
    ...(agentControl ? { agentControl: { worldId, ttlMs, bindings: [
      { ownerId: OWNER, characterId: CHARACTER, capabilities }, ...extraBindings,
    ] } } : {}),
  };
  const server = createGameServer(options);
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function query(client, requestId, extra = {}) {
  await client.send({ t: MSG.AGENT_OWNER, requestId, op: 'list', ...extra });
  return client.waitFor((m) => m.t === MSG.AGENT_OWNER_RESULT && m.requestId === requestId);
}

test('owner list is private, bounded and available as an honest empty state when controls are off', async (t) => {
  const { url } = await room(t, { agentControl: false });
  const owner = await connect(url, 'owner-token'), guest = await connect(url, null);
  t.after(() => { owner.client.close(); guest.client.close(); });
  assert.deepEqual(await query(owner.client, 'disabled-list'), {
    t: MSG.AGENT_OWNER_RESULT, requestId: 'disabled-list', ok: true, why: null, enabled: false, companions: [],
  });
  const denied = await query(guest.client, 'guest-list');
  assert.equal(denied.why, 'forbidden'); assert.deepEqual(denied.companions, []);
  assert.equal((await query(owner.client, 'spoof', { ownerId: OWNER })).why, 'invalid_request');
});

test('two authenticated owners see only their configured characters, never grants/tasks or another account', async (t) => {
  const { server, url } = await room(t, { extraBindings: [{ ownerId: GUEST_OWNER, characterId: UNMAPPED, capabilities: ['chat'] }] });
  const owner = await connect(url, 'owner-token'), other = await connect(url, 'guest-owner-token');
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); other.client.close(); agent.client.close(); });
  const a = await query(owner.client, 'a-list'), b = await query(other.client, 'b-list');
  assert.deepEqual(a.companions.map((r) => r.characterKey), [CHARACTER]);
  assert.deepEqual(b.companions.map((r) => r.characterKey), [UNMAPPED]);
  assert.equal(a.companions[0].online, true); assert.equal(a.companions[0].active, true);
  assert.equal(b.companions[0].online, false); assert.equal(b.companions[0].epoch, null);
  assert.deepEqual(Object.keys(a.companions[0]).sort(), ['active','capabilities','characterKey','epoch','name','online','stopped']);
  const serialized = JSON.stringify(a);
  for (const secret of [OWNER, GUEST_OWNER, UNMAPPED, agent.result.control.grant.scope.sessionId, 'expiresAtMs', 'taskRevision'])
    assert.equal(serialized.includes(secret), false, secret);
  assert.equal((await query(agent.client, 'agent-list')).why, 'forbidden');
  assert.equal((await query(other.client, 'foreign-stop', { op: 'stop', characterKey: CHARACTER, epoch: a.companions[0].epoch })).why, 'forbidden');
  assert.equal(server.game.agentControl.byCharacter(CHARACTER).state, 'active');
  assert.equal(other.client.messages.some((m) => m.requestId === 'a-list'), false);
});

test('stop fences queued input and old epoch, stays idempotent, and refuses to stop a new session from stale UI', async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); });
  const initial = (await query(owner.client, 'before')).companions[0];
  await agent.client.send({ t: MSG.AGENT_TASK, epoch: initial.epoch, expectedTaskRevision: 0, actionId: 'moving',
    type: 'move', args: { mx: 1, mz: 0, durationMs: 1000 }, priority: 'goal' });
  const task = await agent.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.task?.actionId === 'moving');
  const sock = [...server.game.sockets.values()].find((s) => s.agentIdentity === CHARACTER);
  clearInterval(server.game.timer);
  server.game.server.step();
  await agent.client.send({ t: MSG.INPUTS, control: { epoch: initial.epoch, taskRevision: task.state.taskRevision },
    cmds: [{ seq: 100, mx: 1, mz: 0, ax: 1, az: 0, btn: 0, prs: 0, pt: server.game.server.world.tick + 10, w: 0 }] });
  await until(() => server.game.server.clients.get(sock.id).queue.length === 1);
  const stopped = await query(owner.client, 'stop', { op: 'stop', characterKey: CHARACTER, epoch: initial.epoch });
  assert.equal(stopped.ok, true); assert.equal(stopped.companions[0].stopped, true);
  assert.equal(stopped.companions[0].active, false);
  const control = server.game.agentControl.byCharacter(CHARACTER);
  assert.equal(control.task, null); assert.equal(server.game.agentControl.authorize(sock.id, initial.epoch), false);
  assert.equal(server.game.server.clients.get(sock.id).queue.length, 0);
  const again = await query(owner.client, 'stop-again', { op: 'stop', characterKey: CHARACTER, epoch: control.grant.controlRevision });
  assert.equal(again.ok, true); assert.equal(again.companions[0].epoch, control.grant.controlRevision);
  assert.equal(server.game.agentControl.resume(OWNER, CHARACTER), true);
  agent.client.close(); await until(() => !server.game.sockets.has(sock.id));
  const fresh = await connect(url, 'agent-token', { agent: true }); t.after(() => fresh.client.close());
  assert.equal(fresh.result.t, MSG.WELCOME);
  const stale = await query(owner.client, 'stale-stop', { op: 'stop', characterKey: CHARACTER, epoch: initial.epoch });
  assert.equal(stale.why, 'stale_control'); assert.equal(stale.companions[0].active, true);
});

test('a null baseline cannot stop a newly connected character', async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token'); t.after(() => owner.client.close());
  const offline = await query(owner.client, 'offline'); assert.equal(offline.companions[0].epoch, null);
  const agent = await connect(url, 'agent-token', { agent: true }); t.after(() => agent.client.close());
  assert.equal((await query(owner.client, 'null-stale', { op: 'stop', characterKey: CHARACTER, epoch: null })).why, 'stale_control');
  const epoch = server.game.agentControl.byCharacter(CHARACTER).grant.controlRevision;
  assert.equal((await query(owner.client, 'current-stop', { op: 'stop', characterKey: CHARACTER, epoch })).ok, true);
  assert.equal(server.game.agentControl.admit(CHARACTER, 100, 0).why, 'disabled');
});

test('owner can stop a configured character that has never been admitted with its null baseline', async (t) => {
  const { server, url } = await room(t, { extraBindings: [
    { ownerId: OWNER, characterId: NEVER_ADMITTED, capabilities: ['chat'] },
  ] });
  const owner = await connect(url, 'owner-token'); t.after(() => owner.client.close());
  const before = await query(owner.client, 'never-admitted-before');
  const row = before.companions.find((entry) => entry.characterKey === NEVER_ADMITTED);
  assert.ok(row); assert.equal(row.online, false); assert.equal(row.epoch, null); assert.equal(row.stopped, false);

  const stopped = await query(owner.client, 'never-admitted-stop', {
    op: 'stop', characterKey: NEVER_ADMITTED, epoch: null,
  });
  const after = stopped.companions.find((entry) => entry.characterKey === NEVER_ADMITTED);
  assert.equal(stopped.ok, true); assert.equal(after.stopped, true); assert.equal(after.active, false);
  assert.equal(server.game.agentControl.admit(NEVER_ADMITTED, 100, 0).why, 'disabled');
});

