import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { AgentPerception, AGENT_PILOT_POLICY } from '../server/agentPerception.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND } from '../src/sim/ecs.js';
import { World } from '../src/sim/world.js';

const WORLD = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER_OWNER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '55555555-5555-4555-8555-555555555555';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('Timed out waiting for agent pilot wire evidence');
}

class WireClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      try { this.messages.push(JSON.parse(data.toString())); } catch { /* malformed server frame */ }
    });
  }
  async send(message) { await this.opened; this.ws.send(JSON.stringify(message)); }
  async waitFor(predicate, timeoutMs = 4000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await sleep(10);
    }
    throw new Error(`Timed out waiting for pilot message; last messages: ${JSON.stringify(this.messages.slice(-8))}`);
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function hello(token, { agent = false, name = 'Pilot test' } = {}) {
  return { t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name, skin: 0, weapon: 0 };
}

async function connect(url, token, options = {}) {
  const client = new WireClient(url);
  await client.send(hello(token, options));
  const result = await client.waitFor((m) => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
  return { client, result };
}

async function room(t, { pilot = true, maxAgents = 2, maxPlayers = 4, bindings, resolvePlayer } = {}) {
  const playerResolver = resolvePlayer ?? (async (_req, message) => ({
    'owner-token': OWNER, 'agent-token': CHARACTER,
    'other-owner-token': OTHER_OWNER, 'other-agent-token': OTHER_CHARACTER,
  })[message.token] ?? null);
  const options = {
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers,
    worldId: WORLD, saveSecret: 'agent-pilot-ws-test-secret', store: createMemoryStore(),
    resolvePlayer: playerResolver, log() {},
    agentControl: { worldId: WORLD, bindings: bindings ?? [
      { ownerId: OWNER, characterId: CHARACTER, capabilities: ['move', 'aim', 'attack_pve', 'body_pve', 'chat'] },
      { ownerId: OTHER_OWNER, characterId: OTHER_CHARACTER, capabilities: ['move', 'aim', 'attack_pve', 'body_pve', 'chat'] },
    ] },
    ...(pilot ? { agentPilot: { maxAgents } } : {}),
  };
  const server = createGameServer(options);
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

const byAgent = (server, character = CHARACTER) => [...server.game.sockets.values()].find((s) => s.agentIdentity === character);
const snap = (client) => client.messages.filter((m) => m.t === MSG.SNAPSHOT).at(-1);

test('agent pilot configuration is opt-in, bounded, and requires the existing identity gate', async () => {
  assert.throws(() => createGameServer({ port: 0, bots: 0, worldId: WORLD,
    agentPilot: { maxAgents: 1 }, log() {} }));
  assert.throws(() => createGameServer({ port: 0, bots: 0, worldId: WORLD, maxPlayers: 5,
    resolvePlayer: async () => OWNER,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }] },
    agentPilot: { maxAgents: 1 }, log() {} }));
  for (const maxAgents of [0, 3, 1.5, '1', null]) assert.throws(() => createGameServer({
    port: 0, bots: 0, worldId: WORLD, maxPlayers: 4, resolvePlayer: async () => OWNER,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }] },
    agentPilot: { maxAgents }, log() {},
  }));
  const valid = createGameServer({ port: 0, bots: 0, worldId: WORLD, maxPlayers: 4,
    resolvePlayer: async () => OWNER,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }] },
    agentPilot: { maxAgents: 1 }, log() {} });
  try {
    assert.ok(valid.game);
  } finally {
    await valid.close();
  }
});

test('server perception exposes only nearby unoccluded live targets with fresh life references', () => {
  const world = new World(42, { server: true });
  const { ecs } = world;
  world.map.colliders = [];
  const self = world.spawnPlayer({ name: 'Pilot', clientId: 1, x: 0, z: 0 });
  const enemy = world.spawnEnemy('dummy', 3, 0);
  const human = world.spawnPlayer({ name: 'Human', clientId: 2, x: 4, z: 0 });
  const view = new AgentPerception();
  view.project({ t: MSG.SPAWN, e: { id: self } }, world, self);
  const first = view.project({ t: MSG.SNAPSHOT, tick: 1, ack: 0, ents: [], you: world.playerState(self) }, world, self);
  const enemySpawn = first.find((m) => m.t === MSG.SPAWN && m.e.id === enemy);
  const humanSpawn = first.find((m) => m.t === MSG.SPAWN && m.e.id === human);
  assert.ok(enemySpawn && humanSpawn, 'nearby enemy and player are exposed through SPAWN first');
  const enemyRef = { entityId: enemy, life: enemySpawn.e.life };
  const humanRef = { entityId: human, life: humanSpawn.e.life };
  assert.equal(view.target(enemyRef, world, self, KIND.ENEMY), true);
  assert.equal(view.target(humanRef, world, self, KIND.ENEMY), false, 'wrong entity kind is unavailable');
  assert.equal(view.target({ ...enemyRef, life: 'stale-life' }, world, self, KIND.ENEMY), false, 'old life is unavailable');

  world.map.colliders = [{ x: 1.5, z: 0, r: 0.6 }];
  assert.equal(view.target(enemyRef, world, self, KIND.ENEMY), false, 'static circle blocks line of sight');
  world.map.colliders = [];
  ecs.x[enemy] = 26;
  assert.equal(view.target(enemyRef, world, self, KIND.ENEMY), false, 'targets beyond radius are hidden');
  ecs.x[enemy] = 3;
  ecs.hp[enemy] = 0;
  assert.equal(view.target(enemyRef, world, self, KIND.ENEMY), false, 'dead targets are unavailable');
  ecs.hp[enemy] = 20;
  ecs.x[enemy] = 26;

  const exit = view.project({ t: MSG.SNAPSHOT, tick: 2, ack: 0, ents: [], you: world.playerState(self) }, world, self);
  assert.ok(exit.some((m) => m.t === MSG.DESPAWN && m.id === enemy), 'leaving perception emits DESPAWN');
  ecs.x[enemy] = 3;
  const reentry = view.project({ t: MSG.SNAPSHOT, tick: 3, ack: 0, ents: [], you: world.playerState(self) }, world, self);
  const fresh = reentry.find((m) => m.t === MSG.SPAWN && m.e.id === enemy);
  assert.ok(fresh);
  assert.notEqual(fresh.e.life, enemyRef.life, 'reentry issues a fresh life token');
  assert.equal(view.target(enemyRef, world, self, KIND.ENEMY), false);
  assert.equal(view.target({ entityId: enemy, life: fresh.e.life }, world, self, KIND.ENEMY), true);
});

test('pending identity and unauthenticated sockets receive no world frames; legacy and agent snapshots differ only by pilot contract',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t);
    const pending = new WireClient(url);
    await pending.opened;
    await sleep(40);
    assert.equal(pending.messages.some((m) => [MSG.SPAWN, MSG.SNAPSHOT, MSG.EVENT, MSG.CHAT_STATE].includes(m.t)), false);
    await pending.send(hello('owner-token', { name: 'Human' }));
    const humanWelcome = await pending.waitFor((m) => m.t === MSG.WELCOME);
    const human = pending;
    const pilot = await connect(url, 'agent-token', { agent: true, name: 'Sailor [IA]' });
    t.after(() => { human.close(); pilot.client.close(); });
    assert.equal(pilot.result.t, MSG.WELCOME, JSON.stringify(pilot.result));
    assert.deepEqual(pilot.result.perception, AGENT_PILOT_POLICY);
    assert.equal(Object.hasOwn(humanWelcome, 'perception'), false);
    // Resource state is sent on change, not repeated in every routine snapshot.
    const humanResources = () => human.messages.find((m) => m.t === MSG.SNAPSHOT &&
      m.resources && typeof m.resources === 'object');
    await until(() => humanResources() && snap(pilot.client));
    const humanSnapshot = humanResources(), agentSnapshot = snap(pilot.client);
    assert.equal(Object.hasOwn(humanSnapshot, 'perception'), false, 'legacy clients retain their full snapshot envelope');
    assert.ok(humanSnapshot.resources && typeof humanSnapshot.resources === 'object');
    assert.equal(agentSnapshot.perception.policy, 'server_radius_colliders');
    for (const field of ['resources', 'naval', 'deck', 'voyage', 'capacity', 'encounters', 'hazards']) {
      assert.equal(Object.hasOwn(agentSnapshot, field), false, `pilot snapshot omits global ${field}`);
    }
    assert.ok(agentSnapshot.ents.some((e) => e[0] === pilot.result.you && e[1] === KIND.PLAYER), 'self remains observable');
    assert.equal(agentSnapshot.perception.tick, agentSnapshot.tick);
    assert.equal(server.game.status().errors, 0);
  });

test('omitting agentPilot preserves the prior managed-agent wire contract', { timeout: 12000 }, async (t) => {
  const { url } = await room(t, { pilot: false, maxPlayers: 4 });
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.WELCOME);
  assert.equal(Object.hasOwn(agent.result, 'perception'), false);
  assert.equal(agent.result.control.state, 'active');
  const snapshot = await agent.client.waitFor((m) => m.t === MSG.SNAPSHOT);
  assert.equal(Object.hasOwn(snapshot, 'perception'), false);
  assert.ok(Object.hasOwn(snapshot, 'enc'));
  assert.ok(Object.hasOwn(snapshot, 'resources'));
});

test('concurrent pilot admission is atomic and respects the configured agent ceiling', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t, { maxAgents: 1 });
  const attempts = await Promise.all([
    connect(url, 'agent-token', { agent: true, name: 'First' }),
    connect(url, 'other-agent-token', { agent: true, name: 'Second' }),
  ]);
  t.after(() => attempts.forEach(({ client }) => client.close()));
  assert.equal(attempts.filter((a) => a.result.t === MSG.WELCOME).length, 1);
  assert.equal(attempts.filter((a) => a.result.t === MSG.FULL || a.result.t === MSG.ERROR).length, 1);
  assert.equal(server.game.status().players, 1);
  assert.equal([...server.game.sockets.values()].filter((s) => s.agentIdentity).length, 1);
  attempts.find((a) => a.result.t === MSG.WELCOME).client.close();
  await until(() => server.game.status().players === 0);
  const retry = await connect(url, 'other-agent-token', { agent: true, name: 'Second retry' });
  t.after(() => retry.client.close());
  assert.equal(retry.result.t, MSG.WELCOME, 'disconnect releases its admission slot');
});

test('agent names gain the server marker, human names remain ordinary, and chat follows common world and whisper routing',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t, { maxPlayers: 4, maxAgents: 1 });
    const owner = await connect(url, 'owner-token', { name: 'Mate [IA]' });
    const agent = await connect(url, 'agent-token', { agent: true, name: 'Pilot' });
    const other = await connect(url, 'other-owner-token', { name: 'Other human' });
    t.after(() => { owner.client.close(); agent.client.close(); other.client.close(); });
    assert.equal(owner.result.t, MSG.WELCOME);
    assert.equal(agent.result.t, MSG.WELCOME);
    await until(() => [owner.client, agent.client, other.client].every((c) => c.messages.some((m) => m.t === MSG.CHAT_STATE)));
    const pilotSpawn = owner.client.messages.find((m) => m.t === MSG.SPAWN && m.e?.id === agent.result.you);
    const humanSpawn = other.client.messages.find((m) => m.t === MSG.SPAWN && m.e?.id === owner.result.you);
    assert.match(pilotSpawn.e.name, /\[IA\]$/);
    assert.equal(humanSpawn.e.name, 'Mate [IA]', 'the marker is only authoritative metadata for an agent');
    assert.equal(pilotSpawn.e.controller, 'agent');
    assert.equal(Object.hasOwn(humanSpawn.e, 'controller'), false);

    const epoch = agent.result.control.grant.controlRevision;
    const ownerPeer = agent.client.messages.find((m) => m.t === MSG.CHAT_STATE)?.peers.find((p) => p.entity === owner.result.you);
    assert.ok(ownerPeer);
    await agent.client.send({ t: MSG.CHAT_SEND, id: 'pilot-world-chat', channel: 'world', text: 'A pilot greeting', control: { epoch } });
    const result = await agent.client.waitFor((m) => m.t === MSG.CHAT_RESULT && m.requestId === 'pilot-world-chat');
    assert.equal(result.ok, true);
    const delivered = await other.client.waitFor((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'pilot-world-chat');
    assert.equal(delivered.channel, 'world');
    assert.equal(delivered.text, 'A pilot greeting');
    await agent.client.send({ t: MSG.CHAT_SEND, id: 'pilot-whisper', channel: 'whisper', target: ownerPeer.id,
      text: 'Private?', control: { epoch } });
    const whisper = await owner.client.waitFor((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'pilot-whisper');
    assert.equal(whisper.channel, 'whisper');
    assert.equal(other.client.messages.some((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'pilot-whisper'), false,
      'the third party does not receive the whisper');

    const ecs = server.game.server.world.ecs;
    ecs.x[other.result.you] = ecs.x[owner.result.you] + 1; ecs.z[other.result.you] = ecs.z[owner.result.you];
    server.game.server.chat.publishState();
    const ownerState = await owner.client.waitFor((m) => m.t === MSG.CHAT_STATE && m.peers.some((p) => p.entity === other.result.you));
    const otherPeer = ownerState.peers.find((p) => p.entity === other.result.you);
    await owner.client.send({ t: MSG.CHAT_SEND, id: 'human-whisper-private', channel: 'whisper', target: otherPeer.id, text: 'Human private message' });
    await other.client.waitFor((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'human-whisper-private');
    await sleep(25);
    assert.equal(agent.client.messages.some((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'human-whisper-private'), false,
      'an agent is not copied on a third-party human whisper');
  });

test('task target references reject wrong life, far, occluded, dead and wrong-kind entities, then revalidate at tick consumption',
  { timeout: 18000 }, async (t) => {
    const { server, url } = await room(t, { maxPlayers: 4, maxAgents: 2 });
    const owner = await connect(url, 'owner-token', { name: 'Owner' });
    const wrongOwner = await connect(url, 'other-owner-token', { name: 'Different owner' });
    const agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); wrongOwner.client.close(); agent.client.close(); });
    assert.equal(agent.result.t, MSG.WELCOME);
    clearInterval(server.game.timer); server.game.timer = null;
    const sock = byAgent(server), id = sock.id, world = server.game.server.world, ecs = world.ecs;
    const entity = agent.result.you, x = ecs.x[entity], z = ecs.z[entity];
    ecs.x[owner.result.you] = x + 100; ecs.x[wrongOwner.result.you] = x - 100;
    world.map.colliders = [];
    const discardSpawnEvent = (spawned) => {
      const index = world.events.findIndex((ev) => ev.type === 'spawn' && ev.id === spawned);
      if (index >= 0) world.events.splice(index, 1);
    };
    const enemy = world.spawnEnemy('dummy', x + 3, z);
    discardSpawnEvent(enemy);
    const sendFrame = () => server.game.sendTo(id, { t: MSG.SNAPSHOT, tick: world.tick, ack: 0,
      ents: [], you: world.playerState(entity) });
    sendFrame();
    const targetSpawn = await agent.client.waitFor((m) => m.t === MSG.SPAWN && m.e?.id === enemy);
    const ref = { entityId: enemy, life: targetSpawn.e.life };
    assert.equal(sock.agentView.target(ref, world, entity, KIND.ENEMY), true,
      JSON.stringify({ ref, spawn: targetSpawn, position: [ecs.x[enemy], ecs.y[enemy], ecs.z[enemy]], self: [ecs.x[entity], ecs.y[entity], ecs.z[entity]],
        colliders: world.map.colliders }));
    const epoch = agent.result.control.grant.controlRevision;
    let taskRevision = 0, serial = 0;
    const rejectTarget = async (target, label) => {
      const after = agent.client.messages.length;
      await agent.client.send({ t: MSG.AGENT_TASK, epoch, expectedTaskRevision: taskRevision,
        actionId: `unavailable-${++serial}-${label}`, type: 'attack_pve', args: { target, durationMs: 1000 }, priority: 'goal' });
      const result = await agent.client.waitFor((m) => agent.client.messages.indexOf(m) >= after && m.t === MSG.AGENT_STATE);
      assert.equal(result.ok, false, label);
      assert.equal(result.why, 'target_unavailable', label);
    };

    await rejectTarget({ ...ref, life: 'wrong-life' }, 'wrong life');
    ecs.x[enemy] = x + 26;
    sendFrame();
    await agent.client.waitFor((m) => m.t === MSG.DESPAWN && m.id === enemy);
    await rejectTarget(ref, 'far target');
    ecs.x[enemy] = x + 3;
    sendFrame();
    const reentered = await agent.client.waitFor((m) => m.t === MSG.SPAWN && m.e?.id === enemy && m.e.life !== ref.life);
    const currentRef = { entityId: enemy, life: reentered.e.life };
    world.map.colliders = [{ x: x + 1.5, z, r: 0.6 }];
    await rejectTarget(currentRef, 'static circle hides target');
    world.map.colliders = [];
    ecs.hp[enemy] = 0;
    await rejectTarget(currentRef, 'dead target');
    sendFrame();
    await agent.client.waitFor((m) => m.t === MSG.DESPAWN && m.id === enemy);
    ecs.hp[enemy] = ecs.maxHp[enemy];
    const otherPlayer = world.spawnPlayer({ name: 'Nearby human', clientId: 1000, x: x + 4, z });
    discardSpawnEvent(otherPlayer);
    sendFrame();
    const playerSpawn = await agent.client.waitFor((m) => m.t === MSG.SPAWN && m.e?.id === otherPlayer);
    await rejectTarget({ entityId: otherPlayer, life: playerSpawn.e.life }, 'wrong kind');

    server.game.sendTo(id, { t: MSG.SPAWN, e: world.describe(enemy) });
    await agent.client.waitFor((m) => m.t === MSG.DESPAWN && m.id === enemy);
    const afterFreshFrame = agent.client.messages.length;
    sendFrame();
    const freshSpawn = await agent.client.waitFor((m) => agent.client.messages.indexOf(m) >= afterFreshFrame &&
      m.t === MSG.SPAWN && m.e?.id === enemy);
    const validRef = { entityId: enemy, life: freshSpawn.e.life };
    assert.equal(sock.agentView.target(validRef, world, entity, KIND.ENEMY), true,
      JSON.stringify({ validRef, freshSpawn, x: ecs.x[enemy], y: ecs.y[enemy], z: ecs.z[enemy], hp: ecs.hp[enemy], dead: ecs.dead[enemy], kind: ecs.kind[enemy], mask: ecs.mask[enemy], alive: ecs.alive[enemy], near: Math.hypot(ecs.x[enemy] - x, ecs.z[enemy] - z), colliders: world.map.colliders }));
    const acceptedAfter = agent.client.messages.length;
    await agent.client.send({ t: MSG.AGENT_TASK, epoch, expectedTaskRevision: taskRevision,
      actionId: 'visible-target', type: 'attack_pve', args: { target: validRef, durationMs: 1000 }, priority: 'goal' });
    const accepted = await agent.client.waitFor((m) => agent.client.messages.indexOf(m) >= acceptedAfter && m.t === MSG.AGENT_STATE);
    assert.equal(accepted.state?.task?.actionId, 'visible-target', JSON.stringify(accepted));
    assert.equal(accepted.ok, true);
    taskRevision = accepted.state.taskRevision;

    await wrongOwner.client.send({ t: MSG.AGENT_CONTROL, op: 'direct', characterId: CHARACTER,
      task: { epoch, expectedTaskRevision: taskRevision, actionId: 'wrong-owner-direct', type: 'attack_pve',
        args: { target: validRef, durationMs: 1000 } } });
    const forged = await wrongOwner.client.waitFor((m) => m.t === MSG.AGENT_STATE);
    assert.equal(forged.ok, false);
    assert.ok(['forbidden', 'unmapped'].includes(forged.why));
    assert.equal(forged.state, null, 'a different owner receives no agent state');

    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'direct', characterId: CHARACTER,
      task: { epoch, expectedTaskRevision: taskRevision, actionId: 'owner-direct', type: 'attack_pve',
        args: { target: validRef, durationMs: 1000 } } });
    const direct = await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.task?.actionId === 'owner-direct');
    assert.equal(direct.ok, true);
    assert.equal(direct.state.task.priority, 'direct');
    taskRevision = direct.state.taskRevision;

    const connection = server.game.server.clients.get(id);
    server.game.server.last = performance.now() - 50;
    server.game.server.pump(); // Consume the task replacement's neutral boundary.
    server.game.server.receive(id, { t: MSG.INPUTS, control: { epoch, taskRevision }, cmds: [
      { seq: 1, mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: world.tick + 1, w: 0 },
    ] });
    assert.equal(connection.queue.length, 1, 'target is valid at enqueue');
    ecs.x[enemy] = x + 26;
    server.game.server.last = performance.now() - 50;
    server.game.server.pump();
    assert.equal(connection.queue.length, 0, 'target invalidation removes queued input at the authoritative tick');
    assert.equal(connection.ack, 0, 'rejected queued input is not acknowledged');
    assert.equal(server.game.status().errors, 0);
  });

test('agent chat capability is required before pilot chat reaches shared routing', { timeout: 12000 }, async (t) => {
  const { url } = await room(t, { maxPlayers: 2, maxAgents: 1,
    bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] }] });
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); });
  assert.equal(agent.result.t, MSG.WELCOME);
  const epoch = agent.result.control.grant.controlRevision;
  await agent.client.send({ t: MSG.CHAT_SEND, id: 'chat-cap-denied', channel: 'world', text: 'Must be denied', control: { epoch } });
  await sleep(40);
  assert.equal(owner.client.messages.some((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'chat-cap-denied'), false);
  assert.equal(agent.client.messages.some((m) => m.t === MSG.CHAT_RESULT && m.requestId === 'chat-cap-denied'), false);
  assert.equal(agent.client.messages.some((m) => m.t === MSG.AGENT_STATE && m.why === 'control_mismatch'), false);
});

test('pilot does not gain CMD, ship, or deck privileges from its perception or chat session', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t, { maxPlayers: 2, maxAgents: 1 });
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  assert.equal(agent.result.t, MSG.WELCOME);
  clearInterval(server.game.timer); server.game.timer = null;
  const socket = byAgent(server), connection = server.game.server.clients.get(socket.id);
  const world = server.game.server.world, ecs = world.ecs;
  const before = { x: ecs.x[connection.entity], z: ecs.z[connection.entity] };
  let navalCalls = 0;
  world.navalPilot = { input() { navalCalls++; }, deckInput() { navalCalls++; } };
  await agent.client.send({ t: MSG.CMD, type: 'debug_teleport', x: 900, z: 900 });
  await agent.client.send({ t: MSG.SHIP_INPUT, epoch: 1, seq: 1, throttle: 1, brake: 0, steer: 0 });
  await agent.client.send({ t: MSG.DECK_INPUT, epoch: 1, seq: 1, mx: 1, mz: 0 });
  await sleep(25);
  assert.deepEqual({ x: ecs.x[connection.entity], z: ecs.z[connection.entity] }, before);
  assert.equal(navalCalls, 0);
  assert.equal(server.game.status().errors, 0);
  world.navalPilot = null;
});
