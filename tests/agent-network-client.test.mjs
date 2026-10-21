import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND, TEAM, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';

test('secure network client derives HTTPS Origin from the validated WSS endpoint', () => {
  let transportArgs;
  const transport = { ws: { readyState: 0 }, outbox: [], closed: false,
    onMessage() {}, onSnapshot() {}, onClose() {}, close() { this.closed = true; this.ws.readyState = 3; } };
  const client = new AgentNetworkClient({ url: 'wss://world.example:9443/ws', grant: fixtureGrant(),
    transportFactory: (...args) => { transportArgs = args; return transport; } });
  assert.deepEqual(transportArgs, ['wss://world.example:9443/ws', { origin: 'https://world.example:9443' }]);
  client.close();
  assert.equal(transport.closed, true);
});

// IC03b: a scriptable transport. Messages pushed through `deliver` reach the client like server frames.
function stubTransport() {
  const transport = { ws: { readyState: 1 }, outbox: [], closed: false, sent: [], opened: Promise.resolve(true),
    callbacks: { message: [], snapshot: [], close: [] },
    onMessage(cb) { this.callbacks.message.push(cb); }, onSnapshot(cb) { this.callbacks.snapshot.push(cb); },
    onClose(cb) { this.callbacks.close.push(cb); }, start() {}, sendInput() {}, flush() {},
    send(message) { this.sent.push(structuredClone(message)); },
    deliver(message) { for (const cb of this.callbacks.message) cb(message); },
    close() {
      if (this.closed) return;
      this.closed = true; this.ws.readyState = 3;
      for (const cb of this.callbacks.close) cb({ code: 1008, reason: 'pairing revoked' });
    } };
  return transport;
}
const SCOPE = { ownerId: 'owner-1', characterId: 'companion-1', worldId: 'lab-world', sessionId: 'local-session' };
const grant = (capabilities) => ({ v: 1, scope: SCOPE, controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities });
function presenceReceipt(requestId, overrides = {}) {
  return { t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId, ok: true, why: null, enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'wait', revision: 7, entity: 12, reason: null },
    ...overrides };
}
async function welcomed(t, { requested = ['chat', 'presence'], granted = ['chat', 'presence'], authorization = { token: 'paired-token' },
  presenceTimeoutMs = 10000 } = {}) {
  const transport = stubTransport(), feedback = [];
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: grant(requested), presenceTimeoutMs,
    ...(authorization ? { authorization } : {}), onFeedback: (event) => feedback.push(event), transportFactory: () => transport });
  t.after(() => client.close());
  const before = await client.presence('load');
  const connecting = client.connect({ autoTick: false, timeoutMs: 5000 }).catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.sent[0].t, MSG.HELLO);
  const control = authorization ? { control: { grant: { ...grant(granted), scope: { ...SCOPE, sessionId: 'server-session' } },
    state: 'active', taskRevision: 0, task: null } } : {};
  transport.deliver({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 12, seed: 42, tick: 1, ...control });
  return { client, transport, feedback, before, connecting };
}

test('IC03b presence requests: exact wire keys, receipt matching and the adopted grant', async (t) => {
  const { client, transport, feedback, before } = await welcomed(t);
  assert.deepEqual(before, { ok: false, why: 'not_connected' }, 'nothing is sent before WELCOME');
  assert.deepEqual(client.grant.capabilities, ['chat', 'presence']);
  assert.equal(client.presenceState, null, 'no body state until a receipt arrives');
  for (const [op, options] of [['join', {}], ['retire', { expectedRevision: 1 }], ['follow', {}], ['follow', { expectedRevision: -1 }],
    ['wait', { expectedRevision: 1.5 }], ['load', { expectedRevision: 1 }], ['return', { expectedRevision: 1, target: 3 }]])
    assert.deepEqual(await client.presence(op, options), { ok: false, why: 'invalid_request' }, `${op} ${JSON.stringify(options)}`);
  assert.equal(transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);

  const load = client.presence('load');
  const request = transport.sent.at(-1);
  assert.deepEqual(Object.keys(request).sort(), ['op', 'requestId', 't']);
  assert.equal(request.t, MSG.AGENT_COMPANION_PRESENCE); assert.match(request.requestId, /^[A-Za-z0-9:_-]{1,100}$/);
  transport.deliver(presenceReceipt('someone-else'));
  transport.deliver(presenceReceipt(request.requestId));
  assert.deepEqual(await load, { ok: true, why: null, enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'wait', revision: 7, entity: 12, reason: null } });
  assert.deepEqual(client.presenceState, { status: 'present', order: 'wait', revision: 7, reason: null });

  const follow = client.presence('follow', { expectedRevision: 7 });
  const order = transport.sent.at(-1);
  assert.deepEqual(Object.keys(order).sort(), ['expectedRevision', 'op', 'requestId', 't']);
  assert.equal(order.expectedRevision, 7); assert.equal(order.control, undefined, 'no control key: the server wants exact keys');
  transport.deliver(presenceReceipt(order.requestId, { ok: false, why: 'conflict',
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'return', revision: 9, entity: 12, reason: null } }));
  assert.deepEqual(await follow, { ok: false, why: 'conflict', enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'return', revision: 9, entity: 12, reason: null } });
  assert.equal(client.presenceState.revision, 9, 'a conflict receipt carries the current revision');

  const forged = client.presence('wait', { expectedRevision: 9 });
  transport.deliver(presenceReceipt(transport.sent.at(-1).requestId, { presence: { characterKey: 'another-companion', name: 'X',
    status: 'present', order: 'wait', revision: 99, entity: 3, reason: null } }));
  assert.deepEqual(await forged, { ok: false, why: 'invalid_receipt' });
  assert.equal(client.presenceState.revision, 9, 'an invalid receipt is never adopted');
  const reported = feedback.filter((event) => event.type === 'presence').map((event) => [event.data.op, event.data.ok, event.data.why]);
  assert.deepEqual(reported, [['load', true, null], ['follow', false, 'conflict'], ['wait', false, 'invalid_receipt']]);
});

test('IC03b presence requests time out, close with the socket, and need the adopted grant', async (t) => {
  const slow = await welcomed(t, { presenceTimeoutMs: 20 });
  assert.deepEqual(await slow.client.presence('load'), { ok: false, why: 'timeout' });
  const late = slow.transport.sent.at(-1).requestId;
  slow.transport.deliver(presenceReceipt(late));
  assert.equal(slow.client.presenceState, null, 'a receipt after the timeout is ignored');

  const closing = await welcomed(t);
  const pending = closing.client.presence('return', { expectedRevision: 4 });
  closing.transport.close();
  assert.deepEqual(await pending, { ok: false, why: 'closed' });
  assert.deepEqual(await closing.client.presence('load'), { ok: false, why: 'closed' });
  assert.ok(closing.feedback.some((event) => event.type === 'stopped'), 'the close is reported as before');

  const chatOnly = await welcomed(t, { granted: ['chat'] });
  assert.deepEqual(chatOnly.client.grant.capabilities, ['chat'], 'WELCOME adopts the intersection');
  assert.deepEqual(await chatOnly.client.presence('load'), { ok: false, why: 'forbidden' });
  assert.equal(chatOnly.transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);

  const guest = await welcomed(t, { authorization: null });
  assert.deepEqual(guest.client.grant.capabilities, ['chat'], 'a guest connection never holds presence');
  assert.deepEqual(await guest.client.presence('load'), { ok: false, why: 'forbidden' });
  assert.equal(guest.transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);
});

// IC04: the SNAPSHOT `world` block becomes observation.confirmed.world. A guest wire is enough: the
// normalization does not depend on the managed-pilot handshake.
const OWN = 2;
function youState(overrides = {}) {
  const values = { x: 0, y: 1, z: 0, hp: 100, maxHp: 100, atk: 10, speed: 6.5, moveMul: 1, dashT: -1, guardT: -1, dashMax: 1,
    dashCharges: 1, guardSt: 60, cdr: 1, ripMul: 1, reflMul: 1, fireMul: 1, potHeal: 1, xpMul: 1, level: 1, ...overrides };
  return PLAYER_FIELDS.map((field) => values[field] ?? 0);
}
function ownRow() {
  const value = Array(19).fill(0);
  Object.assign(value, { [ENT.ID]: OWN, [ENT.KIND]: KIND.PLAYER, [ENT.X]: 0, [ENT.Y]: 1, [ENT.Z]: 0, [ENT.HP]: 100, [ENT.MAXHP]: 100, [ENT.LVL]: 1 });
  return value;
}
const worldSnap = (tick, world) => ({ t: MSG.SNAPSHOT, tick, ack: 0, you: youState(), ents: [ownRow()], rafts: [],
  ...(world === undefined ? {} : { world }) });
const wireNode = (id, x, z, extra = {}) => ({ id, kind: 'wood', x, y: 1, z, ready: true, wait: 0, ...extra });
const wireWorld = (overrides = {}) => ({ v: 1, tick: 10, hours: 14.2, nodes: [wireNode('coast-1', 3, 4)], truncated: false,
  water: null, bench: null, ...overrides });
async function worldClient(t, first) {
  const transport = stubTransport(), send = transport.send;
  transport.send = function (message) {
    send.call(this, message);
    if (message.t !== MSG.HELLO) return;
    queueMicrotask(() => {
      this.deliver({ t: MSG.SPAWN, e: { id: OWN, kind: KIND.PLAYER, name: 'Brisa', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.deliver({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: OWN, tick: 10, seed: GAME.seed });
      this.snapshot(first);
    });
  };
  transport.snapshot = function (value) { for (const cb of this.callbacks.snapshot) cb(structuredClone(value)); };
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant({ capabilities: ['move'] }),
    now: () => 0, transportFactory: () => transport });
  t.after(() => client.close());
  await client.connect({ autoTick: false, timeoutMs: 200 });
  return { client, transport };
}

test('IC04 a SNAPSHOT world becomes confirmed.world; nodes beyond the radius are dropped locally', async (t) => {
  const { client } = await worldClient(t, worldSnap(10, wireWorld({ nodes: [
    wireNode('far-1', 30, 0), wireNode('palm-1', 10, 0, { kind: 'palm', ready: false, wait: 4.5, remaining: 2 }),
    wireNode('edge-1', 24.05, 0), wireNode('out-1', 24.2, 0), wireNode('coast-1', 3, 4)],
    water: { x: -5, y: 1, z: 2, distance: 5.4 }, bench: { x: 40, y: 1, z: 0, distance: 40 } })));
  const world = client.observation.confirmed.world;
  assert.deepEqual(world, { hours: 14.2, truncated: false,
    nodes: [
      { ref: { nodeId: 'coast-1' }, kind: 'wood', position: { x: 3, y: 1, z: 4 }, ready: true, wait: 0 },
      { ref: { nodeId: 'palm-1' }, kind: 'palm', position: { x: 10, y: 1, z: 0 }, ready: false, wait: 4.5, remaining: 2 },
      { ref: { nodeId: 'edge-1' }, kind: 'wood', position: { x: 24.05, y: 1, z: 0 }, ready: true, wait: 0 }],
    water: { position: { x: -5, y: 1, z: 2 }, distance: 5.4 }, bench: null });
  assert.equal(client.observation.confirmed.combat !== undefined, true, 'the rest of the observation is unaffected');
});

test('IC04 a missing or malformed world yields no world key and a later valid one is adopted', async (t) => {
  const { client, transport } = await worldClient(t, worldSnap(10));
  assert.equal(Object.hasOwn(client.observation.confirmed, 'world'), false);
  assert.equal(client.observation.tick, 10);
  const node = wireNode('coast-1', 3, 4);
  const malformed = [null, 'world', [], wireWorld({ v: 2 }), wireWorld({ v: undefined }), wireWorld({ hours: 'noon' }),
    wireWorld({ hours: 31 }), wireWorld({ nodes: 'x' }), wireWorld({ nodes: [{ id: 'a' }] }), wireWorld({ nodes: [node, node] }),
    wireWorld({ nodes: [{ ...node, id: 'bad id' }] }), wireWorld({ nodes: [{ ...node, x: NaN }] }), wireWorld({ truncated: 'no' }),
    wireWorld({ water: { x: 1, y: 1, z: 1 } }), wireWorld({ bench: 7 }), wireWorld({ nodes: Array.from({ length: 65 }, (_, i) => wireNode(`n-${i}`, 1, 1)) }),
    { v: 1, tick: 10 }];
  let tick = 11;
  for (const world of malformed) {
    transport.snapshot(worldSnap(tick, world));
    assert.equal(client.observation.tick, tick, `the observation still advances for ${JSON.stringify(world)?.slice(0, 60)}`);
    assert.equal(Object.hasOwn(client.observation.confirmed, 'world'), false, JSON.stringify(world)?.slice(0, 80));
    tick++;
  }
  transport.snapshot(worldSnap(tick, wireWorld()));
  assert.equal(client.observation.confirmed.world.nodes.length, 1);
  transport.snapshot(worldSnap(tick + 1));
  assert.equal(Object.hasOwn(client.observation.confirmed, 'world'), false, 'a snapshot without world clears it');
});

test('IC04 the runner caps confirmed.world at 16 nodes, nearest first', async (t) => {
  const nodes = Array.from({ length: 20 }, (_, i) => wireNode(`stone-${String(i).padStart(2, '0')}`, 20 - i, 0));
  const { client } = await worldClient(t, worldSnap(10, wireWorld({ nodes, truncated: false })));
  const world = client.observation.confirmed.world;
  assert.equal(world.nodes.length, 16);
  assert.equal(world.truncated, true);
  assert.equal(world.nodes[0].ref.nodeId, 'stone-19');
  assert.equal(world.nodes.at(-1).ref.nodeId, 'stone-04');
});

test('IC04 a managed pilot over a real server sees the nodes and the bench around its body', { timeout: 15000 }, async (t) => {
  const OWNER = '22222222-2222-4222-8222-222222222222', CHARACTER = '33333333-3333-4333-8333-333333333333', WORLD = 'ic04-world';
  const caps = ['move', 'aim', 'attack_pve', 'chat'];
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, seed: 42, maxPlayers: 2, worldId: WORLD,
    store: createMemoryStore(), saveSecret: 'ic04-fixture-only', log() {},
    resolvePlayer: async (_req, msg) => msg.token === 'pilot-fixture' ? CHARACTER : null,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: caps }] },
    agentPilot: { maxAgents: 1 } });
  const port = await server.listen(); t.after(() => server.close());
  const runner = new AgentNetworkRunner({ url: `ws://127.0.0.1:${port}/ws`, name: 'Brisa', authorization: { token: 'pilot-fixture' },
    grant: { v: 1, scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'placeholder' },
      controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: caps } });
  t.after(() => runner.close());
  await runner.connect();
  const end = Date.now() + 6000;
  while (!runner.observation.confirmed.world && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
  const world = runner.observation.confirmed.world;
  assert.ok(world, 'the server world block reaches the observation');
  assert.ok(world.nodes.length > 0 && world.nodes.length <= 16);
  assert.ok(world.bench, 'the crafting bench is near the spawn');
  assert.ok(world.hours >= 0 && world.hours <= 24);
  assert.equal(world.water, null, 'freshwater is off in this world');
  const self = runner.observation.confirmed.self.position;
  for (const n of world.nodes) assert.ok(Math.hypot(n.position.x - self.x, n.position.y - self.y, n.position.z - self.z) <= 24.1);
  assert.ok(JSON.stringify(world).length <= 2400);
});
