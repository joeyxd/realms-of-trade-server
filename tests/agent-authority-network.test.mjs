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

async function room(t, { agentControl = true, ttlMs = 60000, capabilities = ['move', 'aim', 'attack_pve', 'body_pve', 'chat'], dev = false,
  worldId = WORLD, store = createMemoryStore(), resolvePlayer = async (_req, message) => ({
  'owner-token': OWNER, 'guest-owner-token': GUEST_OWNER, 'agent-token': CHARACTER,
  'other-agent-token': GUEST_OWNER, 'unmapped-agent-token': UNMAPPED,
}[message.token] ?? null) } = {}) {
  const options = {
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8, dev,
    worldId, saveSecret: 'agent-authority-ws-test-secret', store,
    resolvePlayer, log() {},
    ...(agentControl ? { agentControl: { worldId, ttlMs, bindings: [
      { ownerId: OWNER, characterId: CHARACTER, capabilities },
    ] } } : {}),
  };
  const server = createGameServer(options);
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

const move = { mx: 1, mz: 0, durationMs: 1000 };
function task(epoch, expectedTaskRevision, actionId, priority = 'goal') {
  return { epoch, expectedTaskRevision, actionId, type: 'move', args: move, priority };
}
const defensiveBody = { mode: 'defensive', protect: null, retreatHpFraction: 0.25, allowPotion: true, durationMs: 30000 };

test('opt-in real WebSocket authority separates owner and character identity and denies unmapped or duplicate agents', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true, name: 'Bound agent' });
  t.after(() => { owner.client.close(); agent.client.close(); });
  assert.equal(owner.result.t, MSG.WELCOME, JSON.stringify(owner.result));
  assert.equal(Object.hasOwn(owner.result, 'control'), false, 'the authenticated avatar does not become the agent controller');
  assert.equal(agent.result.t, MSG.WELCOME);
  assert.equal(agent.result.control.state, 'active');
  assert.deepEqual(agent.result.control.grant.scope, {
    ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: agent.result.control.grant.scope.sessionId,
  });
  assert.notEqual(agent.result.control.grant.scope.ownerId, agent.result.control.grant.scope.characterId);
  assert.equal(agent.result.control.grant.expiresAtMs > Date.now(), true);
  assert.equal(Number.isSafeInteger(agent.result.you), true);

  const malformed = [
    undefined,
    null,
    { epoch: agent.result.control.grant.controlRevision },
    { epoch: agent.result.control.grant.controlRevision, taskRevision: 0, extra: true },
    { epoch: agent.result.control.grant.controlRevision + 1, taskRevision: 0 },
    { epoch: agent.result.control.grant.controlRevision, taskRevision: null },
  ];
  let seq = 1;
  for (const control of malformed) {
    const after = agent.client.messages.length;
    await agent.client.send({ t: MSG.INPUTS, ...(control === undefined ? {} : { control }), cmds: [
      { seq: seq++, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: 1, w: 0 },
    ] });
    const denial = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= after &&
      message.t === MSG.AGENT_STATE && message.why === 'control_mismatch');
    assert.equal(denial.ok, false);
    assert.equal(denial.state.state, 'active');
  }
  const sock = [...server.game.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER);
  assert.equal(server.game.server.clients.get(sock.id).queue.length, 0, 'invalid envelopes enqueue no gameplay input');
  assert.equal(server.game.status().errors, 0, 'malformed control envelopes are denied without crashing the host');

  const duplicate = await connect(url, 'agent-token', { agent: true, name: 'Competing controller' });
  t.after(() => duplicate.client.close());
  assert.equal(duplicate.result.t, MSG.ERROR);
  assert.equal(duplicate.result.code, 'auth');

  const unmapped = await connect(url, 'unmapped-agent-token', { agent: true });
  t.after(() => unmapped.client.close());
  assert.equal(unmapped.result.t, MSG.ERROR);
  assert.equal(unmapped.result.code, 'auth');

  const ordinaryManaged = await connect(url, 'agent-token', { agent: false, name: 'Forged normal avatar' });
  t.after(() => ordinaryManaged.client.close());
  assert.equal(ordinaryManaged.result.t, MSG.ERROR, 'a normal HELLO cannot claim an agent-managed character');
  assert.equal(ordinaryManaged.result.code, 'auth');

  const forgedAgent = await connect(url, 'owner-token', { agent: true, name: 'Owner token as agent' });
  t.after(() => forgedAgent.client.close());
  assert.equal(forgedAgent.result.t, MSG.ERROR, 'owner identity is not the bound character identity');
  assert.equal(forgedAgent.result.code, 'auth');
});

test('owner direct control and revoke dominate agent tasks; stale epoch and task revisions cannot return after resume', { timeout: 20000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true, name: 'Bound agent' });
  const wrongOwner = await connect(url, 'guest-owner-token');
  t.after(() => { owner.client.close(); agent.client.close(); wrongOwner.client.close(); });
  assert.equal(owner.result.t, MSG.WELCOME, JSON.stringify(owner.result));
  assert.equal(agent.result.t, MSG.WELCOME);
  assert.equal(wrongOwner.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;
  const epoch = agent.result.control.grant.controlRevision;

  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'goal-1', 'goal'), type: 'body_pve', args: defensiveBody });
  const goal = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE);
  assert.equal(goal.state?.task?.actionId, 'goal-1', JSON.stringify(goal));
  assert.equal(goal.ok, true);
  assert.equal(goal.state.task.priority, 'goal');
  server.game.server.step(); // Consume the neutral tick inserted when the goal replaced prior input.

  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'same-epoch-stale', 'goal') });
  const staleTask = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.why === 'stale_task');
  assert.equal(staleTask.ok, false);
  assert.equal(staleTask.state.task.actionId, 'goal-1');

  const controller = [...server.game.sockets.values()].find((sock) => sock.agentIdentity === CHARACTER);
  const connection = server.game.server.clients.get(controller.id);
  const world = server.game.server.world;
  const ecs = world.ecs;
  const sendInputs = (taskRevision, ...commands) => agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision }, cmds: commands });
  await sendInputs(1, { seq: 1, mx: 0, mz: 0, ax: 1, az: 0, btn: BTN.AIM, prs: 0, pt: world.tick + 10, w: 0 });
  await until(() => connection.queue.length === 1);
  server.game.server.step();
  assert.equal(connection.ack, 1);
  assert.equal(connection.last.seq, 1);
  const facingAfterAppliedInput = ecs.facing[connection.entity];

  // Hold a valid, late press in the carry lane; the owner replacement must clear it too.
  connection.fillPt = world.tick + 2;
  await sendInputs(1, { seq: 2, mx: 0, mz: 0, ax: 0, az: 1, btn: 0, prs: BTN.AIM, pt: world.tick, w: 0 });
  await until(() => connection.queue.length === 1);
  server.game.server.step();
  assert.equal(connection.ack, 2);
  assert.equal(connection.carry, BTN.AIM);
  connection.fillPt = 0;

  await sendInputs(1,
    { seq: 3, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: world.tick + 10, w: 0 },
    { seq: 4, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: world.tick + 10, w: 0 },
  );
  await until(() => connection.queue.length === 2);

  await wrongOwner.client.send({ t: MSG.AGENT_CONTROL, op: 'direct', characterId: CHARACTER,
    task: { epoch, expectedTaskRevision: 1, actionId: 'forged-direct', type: 'move', args: move } });
  const forged = await wrongOwner.client.waitFor((message) => message.t === MSG.AGENT_STATE);
  assert.equal(forged.ok, false);
  assert.equal(['forbidden', 'unmapped'].includes(forged.why), true);
  assert.equal(forged.state, null, 'a different owner receives no private agent state');

  await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'direct', characterId: CHARACTER,
    task: { epoch, expectedTaskRevision: 1, actionId: 'owner-direct', type: 'go_to',
      args: { x: 0, z: 0, tolerance: 1, durationMs: 30000 } } });
  const direct = await owner.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'owner-direct');
  assert.equal(direct.ok, true);
  assert.equal(direct.state.task.priority, 'direct');
  assert.equal(direct.state.taskRevision, 2);
  assert.equal(direct.receipt.queueCleared, 2, 'a task replacement removes commands already waiting in the host queue');
  assert.equal(direct.receipt.neutralPending, true);
  assert.equal(connection.carry, 0, 'replacement also clears a carried press from an older late command');
  assert.equal(connection.last, null, 'replacement removes the last-input fallback');

  const ackBeforeDeniedAim = connection.ack;
  await sendInputs(2, { seq: 5, mx: 0, mz: 0, ax: 0, az: 0, btn: BTN.AIM, prs: 0, pt: world.tick + 10, w: 0 });
  await sleep(15);
  assert.equal(connection.queue.length, 0, 'a direct move task cannot smuggle an AIM press authorized by the prior body task');
  assert.equal(connection.ack, ackBeforeDeniedAim, 'capability rejection does not acknowledge an invalid input');
  const directStateAfterDeniedAim = server.game.agentControl.byClient(controller.id);
  assert.equal(directStateAfterDeniedAim.taskRevision, 2);
  assert.equal(directStateAfterDeniedAim.task.actionId, 'owner-direct', 'capability rejection leaves the active task intact');

  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 2, 'reflex-under-direct', 'reflex') });
  const lower = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.why === 'priority');
  assert.equal(lower.ok, false);
  assert.equal(lower.state.task.actionId, 'owner-direct');

  const beforeAgentCancel = agent.client.messages.length;
  await agent.client.send({ t: MSG.AGENT_CANCEL, epoch, expectedTaskRevision: 2 });
  const agentCancel = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= beforeAgentCancel &&
    message.t === MSG.AGENT_STATE && message.why === 'priority');
  assert.equal(agentCancel.ok, false, 'the agent cannot cancel a direct task owned by the human');
  assert.equal(agentCancel.state.task.actionId, 'owner-direct');

  await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'cancel', characterId: CHARACTER,
    task: { epoch, expectedTaskRevision: 2 } });
  const ownerCancel = await owner.client.waitFor((message) => message.t === MSG.AGENT_STATE &&
    message.state?.taskRevision === 3 && message.state.task === null);
  assert.equal(ownerCancel.ok, true, 'the authenticated owner can cancel its direct task');
  assert.equal(ownerCancel.receipt.neutralPending, true);

  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 3, 'goal-after-owner-cancel', 'goal') });
  const nextGoal = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE &&
    message.state?.task?.actionId === 'goal-after-owner-cancel');
  assert.equal(nextGoal.ok, true);
  assert.equal(nextGoal.state.taskRevision, 4);

  await sendInputs(4, { seq: 6, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: world.tick + 10, w: 0 });
  await until(() => connection.queue.length === 1);
  controller.in.ms = 160;
  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 4, 'lagged-old-response', 'goal') });
  await until(() => controller.in.q.length === 1);

  await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'revoke', characterId: CHARACTER });
  const revoked = await owner.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.state === 'revoked');
  assert.equal(revoked.ok, true);
  assert.equal(revoked.state.task, null);
  assert.ok(revoked.receipt);
  assert.equal(revoked.receipt.queueCleared, 1);
  assert.equal(revoked.receipt.neutralPending, true);
  server.game.server.step();
  assert.equal(connection.controlNeutral, false, 'the next authoritative tick consumes the neutral control boundary');
  assert.equal(connection.ack, 2, 'the neutral boundary does not acknowledge a command removed from the queue');
  assert.equal(connection.queue.length, 0);
  assert.equal(connection.carry, 0);
  assert.equal(connection.last, null);
  assert.equal(ecs.facing[connection.entity], facingAfterAppliedInput,
    'clearing pending input does not rewind an earlier applied body effect');

  const late = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.why === 'disabled');
  assert.equal(late.ok, false);
  assert.equal(server.game.agentControl.authorize(controller.id, epoch), false, 'a retired socket id is no longer authorized');

  agent.client.close();
  await until(() => server.game.status().players === 2);

  await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'resume', characterId: CHARACTER });
  const resumed = await owner.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.ok === true && message.state?.state === 'revoked');
  assert.equal(resumed.state.task, null);
  assert.equal(agent.result.control.grant.controlRevision, epoch, 'resume never rewrites the grant already issued to a socket');
  const fresh = await connect(url, 'agent-token', { agent: true, name: 'Fresh controller' });
  t.after(() => fresh.client.close());
  assert.equal(fresh.result.t, MSG.WELCOME);
  assert.notEqual(fresh.result.control.grant.controlRevision, epoch);
  assert.notEqual(fresh.result.control.grant.scope.sessionId, agent.result.control.grant.scope.sessionId);
  assert.equal(fresh.result.control.task, null);
});

test('agent authority gate requires authenticated identity resolution and a matching configured world', () => {
  assert.throws(() => createGameServer({ port: 0, bots: 0, worldId: WORLD, agentControl: {
    worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }],
  }, log() {} }));
  assert.throws(() => createGameServer({ port: 0, bots: 0, worldId: 'another-test-world',
    resolvePlayer: async () => OWNER, agentControl: { worldId: WORLD,
      bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }]
    }, log() {} }));
});

test('agent HELLO remains denied when the opt-in server gate is absent', { timeout: 10000 }, async (t) => {
  const { url } = await room(t, { agentControl: false });
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.ERROR);
  assert.equal(agent.result.code, 'auth');
});

test('partial agent admission failure closes the managed socket and leaves no entity or active grant', { timeout: 12000 }, async (t) => {
  const store = createMemoryStore();
  store.loadProfile = async () => { throw new StoreError('response'); };
  const { server, url } = await room(t, { store });
  const agent = new WireClient(url);
  const closed = new Promise((resolve) => agent.ws.once('close', (code) => resolve(code)));
  await agent.send(hello('agent-token', { agent: true, name: 'Partial admission' }));
  assert.equal(await closed, 1008);
  assert.equal(server.game.status().players, 0, 'profile failure after registry admission never leaves an entity');
  const lease = server.game.agentControl.byCharacter(CHARACTER);
  assert.equal(lease.state, 'revoked');
  assert.equal(lease.why, 'disconnect');
  assert.equal(lease.task, null);
  assert.equal(server.game.sockets.size, 0, 'host catch runs the normal socket detachment path');
  assert.equal(server.game.status().errors, 0);
});

test('a missing body capability blocks body tasks and protected buttons; agent sockets cannot dispatch CMD or naval messages', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t, { capabilities: ['move', 'aim'], dev: true });
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;
  const epoch = agent.result.control.grant.controlRevision;
  const sock = [...server.game.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER);
  const connection = server.game.server.clients.get(sock.id);
  const body = { mode: 'defensive', protect: null, retreatHpFraction: 0.25, allowPotion: false, durationMs: 30000 };
  const taskStart = agent.client.messages.length;
  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'body-without-capability'), type: 'body_pve', args: body });
  const bodyDenied = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= taskStart &&
    message.t === MSG.AGENT_STATE);
  assert.equal(bodyDenied.ok, false);
  assert.equal(bodyDenied.why, 'forbidden');

  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'move-only'), priority: 'goal' });
  const goal = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'move-only');
  assert.equal(goal.ok, true);
  server.game.server.step();
  const deniedBits = [BTN.AIM, BTN.DASH, BTN.ATTACK, BTN.GUARD, BTN.Q, BTN.E, BTN.R, BTN.INTERACT, BTN.POTION, BTN.G];
  let seq = 1;
  for (const bit of deniedBits) {
    await agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: goal.state.taskRevision }, cmds: [
      { seq: seq++, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: bit, pt: server.game.server.world.tick + 10, w: 0 },
    ] });
    await sleep(5);
    assert.equal(connection.queue.length, 0, `press bit ${bit} is outside the move capability`);
  }
  await agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: goal.state.taskRevision }, cmds: [
    { seq: seq++, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: 1, w: 1 },
  ] });
  await sleep(5);
  assert.equal(connection.queue.length, 0, 'weapon selection is unavailable to the movement-only task');

  server.game.server.pausable = true;
  const ecs = server.game.server.world.ecs, entity = connection.entity;
  const before = { x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity] };
  let navalCalls = 0;
  server.game.server.world.navalPilot = { input() { navalCalls++; }, deckInput() { navalCalls++; } };
  await agent.client.send({ t: MSG.CMD, type: 'pause', on: true });
  await agent.client.send({ t: MSG.CMD, type: 'debug_teleport', x: 900, z: 900 });
  await agent.client.send({ t: MSG.SHIP_INPUT, epoch: 1, seq: 1, throttle: 1, brake: 0, steer: 0 });
  await agent.client.send({ t: MSG.DECK_INPUT, epoch: 1, seq: 1, mx: 1, mz: 0 });
  await sleep(20);
  assert.equal(connection.paused, false, 'agent CMD never reaches the game command handler');
  assert.deepEqual({ x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity] }, before, 'debug teleport is not an agent capability');
  assert.equal(navalCalls, 0, 'agent ship and deck messages do not reach naval control');
  assert.equal(server.game.status().errors, 0);
  server.game.server.world.navalPilot = null;
});

test('PvE ATTACK carried from a late command is revalidated after merge if a live player enters range before the tick', { timeout: 12000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); });
  assert.equal(owner.result.t, MSG.WELCOME);
  assert.equal(agent.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;

  const epoch = agent.result.control.grant.controlRevision;
  const agentSock = [...server.game.sockets.values()].find((sock) => sock.agentIdentity === CHARACTER);
  const agentConnection = server.game.server.clients.get(agentSock.id);
  const ownerSock = [...server.game.sockets.values()].find((sock) => sock.id !== agentSock.id && sock.id !== undefined &&
    server.game.server.clients.get(sock.id)?.entity === owner.result.you);
  assert.ok(ownerSock);
  const world = server.game.server.world, ecs = world.ecs;
  ecs.x[owner.result.you] = ecs.x[agent.result.you] + 40;
  ecs.z[owner.result.you] = ecs.z[agent.result.you];

  const target = { entityId: 999, life: 'pve-target-life' };
  await agent.client.send({ t: MSG.AGENT_TASK, epoch, expectedTaskRevision: 0, actionId: 'pve-action',
    type: 'attack_pve', args: { target, durationMs: 1000 }, priority: 'goal' });
  const accepted = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'pve-action');
  assert.equal(accepted.ok, true);
  server.game.server.step();
  agentConnection.fillPt = world.tick + 2;
  await agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: accepted.state.taskRevision }, cmds: [
    { seq: 1, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: BTN.ATTACK, pt: world.tick, w: 0 },
  ] });
  await until(() => agentConnection.queue.length === 1);
  server.game.server.step();
  assert.equal(agentConnection.ack, 1);
  assert.equal(agentConnection.carry, BTN.ATTACK, 'the late press is retained in the carry lane');

  // Queue a neutral current input while the human is still far away; the retained press
  // becomes effective only when the host merges carry, after the human enters range.
  agentConnection.fillPt = 0;
  await agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: accepted.state.taskRevision }, cmds: [
    { seq: 2, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: world.tick + 10, w: 0 },
  ] });
  await until(() => agentConnection.queue.length === 1);
  assert.equal(agentConnection.ack, 1);

  ecs.x[owner.result.you] = ecs.x[agent.result.you] + 1;
  server.game.server.step();
  assert.equal(agentConnection.queue.length, 0);
  assert.equal(agentConnection.ack, 1, 'the merged carry attack is rejected before the neutral command is acknowledged');
  assert.equal(agentConnection.carry, 0, 'the denied post-merge attack cannot remain carried');
  assert.equal(agentConnection.last, null);
  assert.equal(world.events.some((event) => event.type === 'swing' && event.e === agent.result.you), false);
  assert.equal(server.game.status().errors, 0);
});

test('task and grant expiration are swept with the host timer stopped', { timeout: 10000 }, async (t) => {
  const { server, url } = await room(t, { ttlMs: 5000 });
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;
  const stoppedTick = server.game.status().tick;
  const epoch = agent.result.control.grant.controlRevision;
  const afterTask = agent.client.messages.length;
  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'expires-first', 'goal'),
    args: { ...move, durationMs: 60 } });
  const accepted = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= afterTask &&
    message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'expires-first');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.task.args.durationMs, 60, 'the short task expires before the longer grant');
  await sleep(Math.max(0, accepted.state.task.expiresAtMs - Date.now() + 5));
  const afterTaskSweep = agent.client.messages.length;
  server.game.sweepAgentControl();
  const taskExpired = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= afterTaskSweep &&
    message.t === MSG.AGENT_STATE && message.state?.state === 'active' && message.state.task === null);
  assert.equal(taskExpired.state.taskRevision, 2);
  assert.equal(server.game.status().tick, stoppedTick, 'the game timer was stopped; only the explicit authority sweep ran');

  await sleep(Math.max(0, accepted.state.grant.expiresAtMs - Date.now() + 5));
  const afterLeaseSweep = agent.client.messages.length;
  server.game.sweepAgentControl();
  const leaseExpired = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= afterLeaseSweep &&
    message.t === MSG.AGENT_STATE && message.state?.state === 'revoked' && message.state.why === 'expired');
  assert.equal(leaseExpired.state.task, null);
  assert.equal(server.game.agentControl.authorize(
    [...server.game.sockets.values()].find((sock) => sock.agentIdentity === CHARACTER)?.id, epoch), false);
});

test('death invalidates an active grant, task, and queued input before any next tick', { timeout: 12000 }, async (t) => {
  const { server, url } = await room(t);
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;
  const epoch = agent.result.control.grant.controlRevision;
  await agent.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'dies-with-body', 'goal') });
  const accepted = await agent.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'dies-with-body');
  assert.equal(accepted.ok, true);
  const sock = [...server.game.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER);
  const connection = server.game.server.clients.get(sock.id);
  await agent.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: accepted.state.taskRevision }, cmds: [
    { seq: 1, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: server.game.server.world.tick + 10, w: 0 },
  ] });
  await until(() => connection.queue.length === 1);
  server.game.server.world.ecs.hp[connection.entity] = 0;
  const after = agent.client.messages.length;
  server.game.sweepAgentControl();
  const dead = await agent.client.waitFor((message) => agent.client.messages.indexOf(message) >= after &&
    message.t === MSG.AGENT_STATE && message.state?.state === 'revoked');
  assert.equal(dead.state.why, 'death');
  assert.equal(dead.state.task, null);
  assert.equal(dead.receipt.queueCleared, 1);
  assert.equal(dead.receipt.neutralPending, true);
  assert.equal(server.game.agentControl.authorize(sock.id, epoch), false);
  assert.equal(connection.queue.length, 0);
});

test('disconnect retires its queue and a reentered agent receives a different grant', { timeout: 12000 }, async (t) => {
  const { server, url } = await room(t);
  const old = await connect(url, 'agent-token', { agent: true, name: 'First session' });
  assert.equal(old.result.t, MSG.WELCOME);
  clearInterval(server.game.timer);
  server.game.timer = null;
  const epoch = old.result.control.grant.controlRevision;
  const sessionId = old.result.control.grant.scope.sessionId;
  const oldSock = [...server.game.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER);
  const connection = server.game.server.clients.get(oldSock.id);
  await old.client.send({ t: MSG.AGENT_TASK, ...task(epoch, 0, 'disconnect-task', 'goal') });
  const accepted = await old.client.waitFor((message) => message.t === MSG.AGENT_STATE && message.state?.task?.actionId === 'disconnect-task');
  assert.equal(accepted.ok, true);
  await old.client.send({ t: MSG.INPUTS, control: { epoch, taskRevision: accepted.state.taskRevision }, cmds: [
    { seq: 1, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: server.game.server.world.tick + 10, w: 0 },
  ] });
  await until(() => connection.queue.length === 1);

  old.client.close();
  await until(() => server.game.status().players === 0);
  const retired = server.game.agentControl.byCharacter(CHARACTER);
  assert.equal(retired.state, 'revoked');
  assert.equal(retired.why, 'disconnect');
  assert.equal(retired.task, null);
  assert.equal(server.game.agentControl.authorize(oldSock.id, epoch), false);

  const fresh = await connect(url, 'agent-token', { agent: true, name: 'Second session' });
  t.after(() => fresh.client.close());
  assert.equal(fresh.result.t, MSG.WELCOME);
  assert.notEqual(fresh.result.control.grant.controlRevision, epoch);
  assert.notEqual(fresh.result.control.grant.scope.sessionId, sessionId);
  const oldEpochReplyIndex = fresh.client.messages.length;
  await fresh.client.send({ t: MSG.AGENT_TASK, ...task(epoch, accepted.state.taskRevision, 'disconnect-task', 'goal') });
  const oldEpochReply = await fresh.client.waitFor((message) => fresh.client.messages.indexOf(message) >= oldEpochReplyIndex &&
    message.t === MSG.AGENT_STATE);
  assert.equal(oldEpochReply.ok, false);
  assert.equal(oldEpochReply.why, 'disabled');
  assert.equal(server.game.agentControl.byCharacter(CHARACTER).task, null);
  assert.equal(server.game.status().errors, 0);
});
