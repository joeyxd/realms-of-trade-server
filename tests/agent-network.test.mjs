import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { fixtureGrant, fixtureOrder, fixtureObservation, fixtureEvidence } from '../tools/agent/fixtures.mjs';
import { AgentSession, AgentLabSession } from '../tools/agent/session.mjs';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND, TEAM, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { enemyIndex } from '../src/data/enemies.js';
import { GAME } from '../src/data/meta.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createGameServer } from '../server/index.mjs';

const neutral = { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => structuredClone(value);
const ownId = 2;

function playerState(overrides = {}) {
  const state = { x: 0, y: 1, z: 0, facing: 0, hp: 100, maxHp: 100, atk: 10, speed: 6.5,
    moveMul: 1, dashT: -1, guardT: -1, dashMax: 1, dashCharges: 1, guardSt: 60,
    cdr: 1, ripMul: 1, reflMul: 1, fireMul: 1, potHeal: 1, xpMul: 1, level: 1, ...overrides };
  return PLAYER_FIELDS.map((field) => state[field] ?? 0);
}
function tuple(entityId, kind, { x = 0, y = 1, z = 0, hp = 100, maxHp = 100 } = {}) {
  const row = Array(19).fill(0);
  Object.assign(row, { [ENT.ID]: entityId, [ENT.KIND]: kind, [ENT.X]: x, [ENT.Y]: y, [ENT.Z]: z,
    [ENT.HP]: hp, [ENT.MAXHP]: maxHp, [ENT.LVL]: 1 });
  return row;
}
function snapshot(overrides = {}) {
  return { t: MSG.SNAPSHOT, tick: 10, ack: 0, you: playerState(),
    ents: [tuple(ownId, KIND.PLAYER), tuple(7, KIND.ENEMY, { x: 5, z: 8, hp: 40, maxHp: 40 })],
    rafts: [], resources: { nodes: [], bench: null }, ...overrides };
}

// This transport only models JSON delivered by a trusted test. It grants no server authority.
class FakeTransport {
  constructor({ version = PROTOCOL_VERSION, initialSnapshot = snapshot(), error = null } = {}) {
    this.opened = Promise.resolve(true);
    this.ws = { readyState: 1 };
    this.closed = false;
    this.sent = []; this.outbox = []; this.messageListeners = []; this.snapshotListeners = []; this.closeListeners = [];
    this.version = version; this.initialSnapshot = initialSnapshot; this.error = error;
  }
  start() {}
  onMessage(cb) { this.messageListeners.push(cb); }
  onSnapshot(cb) { this.snapshotListeners.push(cb); }
  onClose(cb) { this.closeListeners.push(cb); }
  message(message) { for (const cb of [...this.messageListeners]) cb(clone(message)); }
  snap(message) { for (const cb of [...this.snapshotListeners]) cb(clone(message)); }
  send(message) {
    this.sent.push(clone(message));
    if (message.t !== MSG.HELLO) return;
    queueMicrotask(() => {
      if (this.error) { this.message({ t: MSG.ERROR, code: this.error }); return; }
      this.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'Brisa [IA]', skin: 0, level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.SPAWN, e: { id: 7, kind: KIND.ENEMY, name: 'Practice', skin: 0, level: 1, enemy: enemyIndex('dummy'), maxHp: 40, team: TEAM.ENEMIES } });
      this.message({ t: MSG.WELCOME, v: this.version, you: ownId, tick: 10, seed: GAME.seed });
      if (this.initialSnapshot) this.snap(this.initialSnapshot);
    });
  }
  sendInput(_tick, input) { this.outbox.push(clone(input)); }
  flush() {
    if (!this.outbox.length) return;
    this.send({ t: MSG.INPUTS, cmds: this.outbox }); this.outbox = [];
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.ws.readyState = 3;
    for (const cb of [...this.closeListeners]) cb({ code: 1000, reason: 'test closed' });
  }
  get inputs() { return this.sent.filter((message) => message.t === MSG.INPUTS).flatMap((message) => message.cmds); }
}
async function fakeClient(options = {}) {
  const transport = new FakeTransport(options.fake);
  let currentTime = 0;
  const feedback = [];
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant(),
    now: () => currentTime, onFeedback: (event) => feedback.push(clone(event)),
    transportFactory: () => transport, ...options.client });
  await client.connect({ autoTick: false, timeoutMs: 100 });
  return { client, transport, feedback, setTime: (value) => { currentTime = value; } };
}
function orderFor(client, overrides = {}) {
  return fixtureOrder({ scope: client.observation.scope, controlRevision: client.observation.controlRevision,
    observationRevision: client.observation.revision, ...overrides });
}
function action(client, actionId = 'action-1') { return client.actions.find((entry) => entry.order.actionId === actionId); }
async function until(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(15);
  }
  throw new Error('Timed out waiting for normal network evidence');
}

test('guest handshake waits for a valid own snapshot and reports the real protocol identity', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  assert.equal(client.state, 'ready');
  assert.deepEqual(client.identity, { entityId: ownId, serverSeed: GAME.seed, protocol: PROTOCOL_VERSION, authorization: 'local', mode: 'guest' });
  const hello = transport.sent.find((message) => message.t === MSG.HELLO);
  assert.equal(hello.v, PROTOCOL_VERSION);
  assert.equal(hello.name, 'Brisa [IA]');
  assert.equal(Object.hasOwn(hello, 'token'), false);
  assert.equal(client.observation.source, 'server');
  assert.equal(client.observation.historyGap, 0);
  assert.deepEqual(client.viewReport, { policy: 'local_radius_filter', radius: 24, omittedEntities: 0, serverEnforced: false });
  assert.deepEqual(client.observation.confirmed.self.position, { x: 0, y: 1, z: 0 });
  assert.equal(client.observation.confirmed.self.hp, 100);
  assert.equal(client.client, undefined);
  assert.equal(client.transport, undefined);
  assert.equal(client.send, undefined);
  assert.equal(client.observe, undefined);
  assert.equal(client.recordEvidence, undefined);
});

test('fixture and server sources stay partitioned and a lab cannot opt into server receipts', () => {
  const fixture = fixtureObservation();
  const server = { ...fixture, source: 'server' };
  const lab = new AgentLabSession({ grant: fixtureGrant(), source: 'server' });
  assert.equal(lab.observe(server, 0).why, 'invalid_observation');
  assert.equal(lab.observe(fixture, 0).ok, true);
  const session = new AgentSession({ grant: fixtureGrant(), source: 'server' });
  assert.equal(session.observe(fixture, 0).why, 'invalid_observation');
  assert.equal(session.observe(server, 0).ok, true);
  assert.equal(session.accept(fixtureOrder(), 0).ok, true);
  session.markSent('action-1', { first: 1, last: 1 }, 0);
  assert.equal(session.recordEvidence(fixtureEvidence()).why, 'invalid_evidence');
  assert.equal(session.recordEvidence({ ...fixtureEvidence(), source: 'prediction' }).why, 'invalid_evidence');
  assert.equal(session.actions[0].result, null);
});

test('normal input uses sequence and projectile tick; prediction and ACK cannot confirm movement', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  assert.equal(client.order(orderFor(client)).ok, true);
  const pump = client.pump();
  assert.equal(pump.ok, true);
  assert.deepEqual(pump.input, { ...neutral, mx: 1, w: 0 });
  const input = transport.inputs.at(-1);
  assert.deepEqual(Object.keys(input).sort(), ['ax', 'az', 'btn', 'mx', 'mz', 'prs', 'pt', 'seq', 'w']);
  assert.equal(input.w, 0);
  assert.equal(input.seq, pump.sequence);
  assert.equal(Number.isInteger(input.pt), true);
  assert.deepEqual(client.observation.confirmed.self.position, { x: 0, y: 1, z: 0 });
  setTime(30);
  transport.snap(snapshot({ tick: 11, ack: input.seq }));
  assert.equal(action(client).result, null);
  assert.notEqual(action(client).state, 'confirmed');
  setTime(120);
  transport.snap(snapshot({ tick: 12, ack: input.seq, you: playerState({ x: 1 }) }));
  assert.notEqual(action(client).state, 'confirmed');
  assert.equal(action(client).result, null);
  const positionEffect = action(client).effects.find((effect) => effect.code === 'position_observed');
  assert.ok(positionEffect);
  assert.equal(positionEffect.outcome, 'partial');
  assert.equal(positionEffect.source, 'server');
});

test('zero displacement and full ACK remain unknown until timeout without inventing a cause', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  client.order(orderFor(client));
  const { sequence } = client.pump();
  setTime(120);
  transport.snap(snapshot({ tick: 11, ack: sequence }));
  assert.equal(action(client).result, null);
  assert.equal(action(client).effects.length, 0);
  setTime(3000);
  transport.snap(snapshot({ tick: 12, ack: sequence }));
  setTime(3100); client.pump();
  assert.equal(action(client).state, 'uncertain');
  assert.equal(action(client).why, 'result_timeout');
  assert.equal(action(client).result, null);
  assert.equal(action(client).effects.length, 0);
  assert.deepEqual(client.observation.confirmed.self.position, { x: 0, y: 1, z: 0 });
});

test('a failed flush preserves submitted uncertainty and stops without replaying an attack', async () => {
  const { client, transport } = await fakeClient();
  const target = client.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  const order = orderFor(client, { type: 'attack_pve', args: { target: target.ref } });
  client.order(order);
  let flushes = 0;
  transport.flush = () => { flushes++; throw new Error('ambiguous transport failure'); };
  assert.equal(client.pump().why, 'transport_or_prediction_error');
  assert.equal(client.state, 'stopped');
  assert.equal(action(client).state, 'uncertain');
  assert.deepEqual(action(client).inputRange, { first: 1, last: 1 });
  assert.equal(action(client).result, null);
  assert.equal(transport.outbox.length, 0);
  assert.equal(client.order(clone(order)).ok, false);
  assert.equal(client.pump().ok, false);
  assert.equal(flushes, 1);
  assert.equal(transport.inputs.length, 0);
  client.close();
});

test('invalid, unsupported, forbidden and wrong session orders emit no privileged command', async (t) => {
  const { client, transport } = await fakeClient({ client: { grant: fixtureGrant({ capabilities: ['move'] }) } });
  t.after(() => client.close());
  for (const order of [{}, orderFor(client, { type: 'commerce' }), orderFor(client, { type: 'aim' }),
    orderFor(client, { scope: { ...client.observation.scope, sessionId: 'old-session' } }),
    orderFor(client, { args: { mx: Infinity } })]) assert.equal(client.order(order).ok, false);
  assert.equal(transport.inputs.length, 0);
  assert.equal(transport.sent.some((message) => message.t === MSG.CMD), false);
});

test('wrong protocol and missing or malformed own snapshots cannot become ready', async () => {
  for (const fake of [{ version: PROTOCOL_VERSION + 1 }, { initialSnapshot: null },
    { initialSnapshot: snapshot({ you: [0, 0] }) },
    { initialSnapshot: snapshot({ you: playerState({ hp: NaN }) }) }]) {
    const transport = new FakeTransport(fake);
    const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant(), now: () => 0,
      transportFactory: () => transport });
    try { await assert.rejects(client.connect({ autoTick: false, timeoutMs: 30 })); }
    finally { client.close(); }
    assert.notEqual(client.state, 'ready');
  }
});

test('old and malformed snapshots do not replace confirmed state or freshness', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  const initial = client.observation;
  setTime(10);
  transport.snap(snapshot({ tick: 9, you: playerState({ x: 100 }) }));
  assert.deepEqual(client.observation, initial);
  transport.snap(snapshot({ tick: 11, you: [0] }));
  assert.deepEqual(client.observation, initial);
  setTime(1601);
  assert.equal(client.order(orderFor(client)).ok, false);
  transport.snap(snapshot({ tick: 12, you: playerState({ x: 2 }) }));
  assert.equal(client.observation.confirmed.self.position.x, 2);
  assert.equal(client.order(orderFor(client)).ok, true);
});

test('raw swing confirms only correlated attack execution, ignoring unrelated events', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  const target = client.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  assert.ok(target);
  client.order(orderFor(client, { type: 'attack_pve', args: { target: target.ref } }));
  const { sequence } = client.pump();
  transport.message({ t: MSG.EVENT, ev: { type: 'swing', e: ownId + 1, seq: sequence } });
  transport.message({ t: MSG.EVENT, ev: { type: 'swing', e: ownId, seq: sequence + 100 } });
  transport.message({ t: MSG.EVENT, ev: { type: 'damage', id: 7, by: ownId, seq: sequence, dmg: 10 } });
  assert.equal(action(client).result, null);
  transport.message({ t: MSG.EVENT, ev: { type: 'swing', e: ownId, seq: sequence } });
  assert.equal(action(client).state, 'confirmed');
  assert.equal(action(client).result.code, 'swing_started');
  assert.equal(action(client).result.source, 'server');
  assert.notEqual(action(client).result.code, 'damage_confirmed');
});

test('despawn and numeric entity reuse retire an old target without another attack', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  const target = client.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  client.order(orderFor(client, { type: 'attack_pve', args: { target: target.ref } }));
  client.pump();
  transport.message({ t: MSG.DESPAWN, id: 7 });
  transport.message({ t: MSG.SPAWN, e: { id: 7, kind: KIND.ENEMY, name: 'Replacement', enemy: enemyIndex('dummy'), maxHp: 40, level: 1 } });
  setTime(1); transport.snap(snapshot({ tick: 11 }));
  const replacement = client.observation.confirmed.entities.find((entity) => entity.ref.entityId === 7);
  assert.notEqual(replacement.ref.life, target.ref.life);
  assert.equal(action(client).state, 'uncertain');
  const next = client.pump();
  assert.equal(next.input.prs, 0);
  assert.equal(client.order(orderFor(client, { actionId: 'old-target', type: 'attack_pve', args: { target: target.ref } })).ok, false);
});

test('raw despawn and reused spawn cancel attack before any replacement snapshot arrives', async () => {
  for (const transmitted of [false, true]) {
    const { client, transport } = await fakeClient();
    try {
      const observation = client.observation;
      const target = observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
      const order = orderFor(client, { type: 'attack_pve', args: { target: target.ref } });
      assert.equal(client.order(order).ok, true);
      if (transmitted) client.pump();
      const pulsesBefore = transport.inputs.filter((input) => input.prs & 2).length;
      transport.message({ t: MSG.DESPAWN, id: target.ref.entityId });
      transport.message({ t: MSG.SPAWN, e: { id: target.ref.entityId, kind: KIND.ENEMY,
        name: 'Reused target', enemy: enemyIndex('dummy'), maxHp: 40, level: 1 } });
      assert.equal(client.observation.revision, observation.revision, 'No later snapshot repairs this race');
      assert.equal(action(client).state, transmitted ? 'uncertain' : 'cancelled');
      assert.equal(client.pump().input.prs, 0);
      assert.equal(transport.inputs.filter((input) => input.prs & 2).length, pulsesBefore);
      assert.equal(client.order(orderFor(client, { actionId: 'stale-lifecycle', type: 'attack_pve', args: { target: target.ref } })).ok, false);
    } finally { client.close(); }
  }
});

test('nearby human safety rejects PvE attack locally without claiming server policy', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  transport.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.PLAYER, name: 'Human', human: 1, skin: 0, level: 1, weapon: 0, team: TEAM.PLAYERS } });
  setTime(1);
  transport.snap(snapshot({ tick: 11, ents: [...snapshot().ents, tuple(9, KIND.PLAYER, { x: 1 })] }));
  const target = client.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  assert.equal(client.order(orderFor(client, { type: 'attack_pve', args: { target: target.ref } })).ok, false);
  assert.equal(transport.inputs.length, 0);
  assert.equal(client.identity.authorization, 'local');
});

test('a nearby human omitted by the visible entity cap still prevents PvE attack', async (t) => {
  const { client, transport, setTime } = await fakeClient({ client: { limits: { maxEntities: 1 } } });
  t.after(() => client.close());
  transport.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.PLAYER, name: 'Human', human: 1,
    skin: 0, level: 1, weapon: 0, team: TEAM.PLAYERS } });
  setTime(1);
  transport.snap(snapshot({ tick: 11, ents: [tuple(ownId, KIND.PLAYER),
    tuple(7, KIND.ENEMY, { x: 1, z: 0, hp: 40, maxHp: 40 }), tuple(9, KIND.PLAYER, { x: 2, z: 0 })] }));
  assert.equal(client.observation.confirmed.entities.length, 1);
  const target = client.observation.confirmed.entities[0];
  assert.equal(target.kind, 'enemy');
  assert.equal(client.viewReport.omittedEntities, 1);
  assert.equal(client.order(orderFor(client, { type: 'attack_pve', args: { target: target.ref } })).ok, false);
  assert.equal(transport.inputs.length, 0);
});

test('duplicate attacks do not pulse twice and cloning getters cannot alter live orders', async (t) => {
  const { client, transport, setTime } = await fakeClient(); t.after(() => client.close());
  const target = client.observation.confirmed.entities.find((entity) => entity.kind === 'enemy');
  const order = orderFor(client, { type: 'attack_pve', args: { target: target.ref } });
  assert.equal(client.order(order).ok, true);
  client.pump();
  const exposed = client.actions; exposed[0].order.args.target.entityId = 999;
  const observed = client.observation; observed.confirmed.entities.length = 0;
  setTime(1);
  assert.equal(client.order(clone(order)).replay, true);
  assert.equal(client.pump().input.prs, 0);
  assert.equal(transport.inputs.filter((input) => input.prs & 2).length, 1);
  assert.equal(client.observation.confirmed.entities.length > 0, true);
  assert.equal(action(client).order.args.target.entityId, target.ref.entityId);
});

test('owner stop and unexpected close neutralize the runner and preserve sent uncertainty', async () => {
  for (const closeInstead of [false, true]) {
    const { client, transport } = await fakeClient();
    client.order(orderFor(client)); client.pump();
    assert.equal(client.stop('intruder').ok, false);
    assert.equal(client.state, 'ready');
    if (closeInstead) transport.close(); else assert.equal(client.stop('owner-1').ok, true);
    assert.equal(client.state, 'stopped');
    assert.equal(action(client).state, 'uncertain');
    assert.equal(client.pump().ok, false);
    assert.equal(client.order(fixtureOrder({ actionId: 'late-answer' })).ok, false);
    if (!closeInstead) {
      const { seq, pt, w, ...input } = transport.inputs.at(-1);
      assert.deepEqual(input, neutral);
    }
    client.close();
  }
});

test('stop closes and retains uncertainty even if the final neutral flush throws', async () => {
  const { client, transport } = await fakeClient();
  client.order(orderFor(client)); client.pump();
  transport.flush = () => { throw new Error('neutral flush failed'); };
  let result;
  assert.doesNotThrow(() => { result = client.stop('owner-1'); });
  assert.equal(result.ok, true);
  assert.equal(client.state, 'stopped');
  assert.equal(action(client).state, 'uncertain');
  assert.equal(action(client).result, null);
  assert.equal(transport.closed, true);
  assert.equal(transport.outbox.length, 0);
  assert.equal(client.pump().ok, false);
  assert.equal(client.order(fixtureOrder({ actionId: 'late-after-stop' })).ok, false);
  client.close();
});

function guestGrant(characterId) {
  return fixtureGrant({ scope: { characterId, sessionId: `session-${characterId}`, worldId: 'l01-normal-network' }, expiresAtMs: Date.now() + 60000 });
}
async function realServer(t, maxPlayers = 2) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers, dev: false,
    worldId: 'l01-normal-network', saveSecret: 'l01-normal-network-test-secret-only', log: () => {} });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

test('real guests occupy normal slots and another normal client observes confirmed movement', { timeout: 15000 }, async (t) => {
  const { server, url } = await realServer(t);
  const runner = new AgentNetworkClient({ url, grant: guestGrant('runner'), name: 'Brisa [IA]' });
  const observer = new AgentNetworkClient({ url, grant: guestGrant('observer'), name: 'Observador' });
  const overflow = new AgentNetworkClient({ url, grant: guestGrant('overflow'), name: 'Overflow' });
  t.after(() => { runner.close(); observer.close(); overflow.close(); });
  await runner.connect(); await observer.connect();
  assert.notEqual(runner.identity.entityId, observer.identity.entityId);
  assert.equal(server.game.status().players, 2);
  await assert.rejects(overflow.connect({ timeoutMs: 1000 }));
  assert.equal(server.game.status().players, 2);
  const start = runner.observation.confirmed.self.position;
  assert.equal(runner.order(orderFor(runner, { args: { durationMs: 500 } })).ok, true);
  await until(() => action(runner)?.effects.some((effect) => effect.code === 'position_observed'));
  assert.equal(action(runner).result, null);
  assert.notEqual(action(runner).state, 'confirmed');
  const end = runner.observation.confirmed.self.position;
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > 0.1);
  const seen = await until(() => observer.observation.confirmed.entities.find((entity) => entity.ref.entityId === runner.identity.entityId));
  await until(() => {
    const current = observer.observation.confirmed.entities.find((entity) => entity.ref.entityId === runner.identity.entityId);
    return current && Math.hypot(current.position.x - end.x, current.position.z - end.z) < 0.3;
  });
  assert.equal(seen.kind, 'player');
});

test('real guest walks with bounded inputs to the normal practice dummy and receives a server swing', { timeout: 15000 }, async (t) => {
  const { server, url } = await realServer(t, 1);
  const runner = new AgentNetworkClient({ url, grant: guestGrant('pve-runner'), name: 'Brisa [IA]' });
  t.after(() => runner.close());
  await runner.connect();
  const practice = generateWorld(runner.identity.serverSeed).practice.dummy;
  let moves = 0;
  while (moves < 12) {
    const position = runner.observation.confirmed.self.position;
    const dx = practice.x - position.x, dz = practice.z - position.z, distance = Math.hypot(dx, dz);
    if (distance < 1.6) break;
    const actionId = `walk-${++moves}`;
    const durationMs = Math.max(80, Math.min(500, Math.floor((distance - 1.3) / 6.5 * 1000)));
    const accepted = runner.order(orderFor(runner, { actionId, args: { mx: dx / distance, mz: dz / distance, durationMs } }));
    assert.equal(accepted.ok, true);
    await until(() => action(runner, actionId)?.effects.some((effect) => effect.code === 'position_observed'));
    assert.equal(action(runner, actionId).result, null);
  }
  const position = runner.observation.confirmed.self.position;
  assert.ok(Math.hypot(practice.x - position.x, practice.z - position.z) < 1.8, 'Normal movement reached the existing practice target');
  const target = runner.observation.confirmed.entities.find((entity) => entity.kind === 'enemy' && Math.hypot(entity.position.x - practice.x, entity.position.z - practice.z) < 0.1);
  assert.ok(target, 'The normal snapshot exposes the nearby practice dummy');
  assert.equal(runner.order(orderFor(runner, { actionId: 'practice-attack', type: 'attack_pve', args: { target: target.ref, durationMs: 300 } })).ok, true);
  await until(() => action(runner, 'practice-attack')?.state === 'confirmed');
  const result = action(runner, 'practice-attack').result;
  assert.equal(result.source, 'server');
  assert.equal(result.code, 'swing_started');
  assert.equal(server.game.status().errors, 0);
  assert.equal(server.game.status().players, 1);
});
