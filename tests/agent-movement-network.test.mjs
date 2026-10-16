import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND, TEAM, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';
import { createGameServer } from '../server/index.mjs';

const ownId = 2;
const neutral = { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, w: 0 };
const clone = (value) => structuredClone(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function state(overrides = {}) {
  const values = { x: 0, y: 1, z: 0, facing: 0, hp: 100, maxHp: 100, atk: 10, speed: 6.5,
    moveMul: 1, dashT: -1, guardT: -1, dashMax: 1, dashCharges: 1, guardSt: 60,
    cdr: 1, ripMul: 1, reflMul: 1, fireMul: 1, potHeal: 1, xpMul: 1, level: 1, ...overrides };
  return PLAYER_FIELDS.map((field) => values[field] ?? 0);
}
function row(id, kind, { x = 0, y = 1, z = 0, hp = 100 } = {}) {
  const value = Array(19).fill(0);
  Object.assign(value, { [ENT.ID]: id, [ENT.KIND]: kind, [ENT.X]: x, [ENT.Y]: y, [ENT.Z]: z,
    [ENT.HP]: hp, [ENT.MAXHP]: 100, [ENT.LVL]: 1 });
  return value;
}
function snap({ tick = 10, ack = 0, you = state(), entities = [] } = {}) {
  return { t: MSG.SNAPSHOT, tick, ack, you, ents: [row(ownId, KIND.PLAYER), ...entities], rafts: [],
    resources: { nodes: [], bench: null } };
}
class FakeTransport {
  constructor() {
    this.opened = Promise.resolve(true); this.ws = { readyState: 1 }; this.closed = false;
    this.sent = []; this.outbox = []; this.messages = []; this.snapshots = []; this.closes = [];
  }
  start() {}
  onMessage(fn) { this.messages.push(fn); }
  onSnapshot(fn) { this.snapshots.push(fn); }
  onClose(fn) { this.closes.push(fn); }
  message(value) { for (const fn of [...this.messages]) fn(clone(value)); }
  snapshot(value) { for (const fn of [...this.snapshots]) fn(clone(value)); }
  send(value) {
    this.sent.push(clone(value));
    if (value.t !== MSG.HELLO) return;
    queueMicrotask(() => {
      this.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'Brisa', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.PLAYER, name: 'Ana', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: ownId, tick: 10, seed: GAME.seed });
      this.snapshot(snap({ entities: [row(9, KIND.PLAYER, { x: 10 })] }));
    });
  }
  sendInput(tick, input) { this.outbox.push({ t: MSG.INPUTS, cmds: [{ tick, ...clone(input) }] }); }
  flush() { this.sent.push(...this.outbox); this.outbox.length = 0; }
  close() {
    if (this.closed) return;
    this.closed = true; this.ws.readyState = 3;
    for (const fn of [...this.closes]) fn({ code: 1000, reason: 'test closed' });
  }
  get inputs() { return this.sent.filter((m) => m.t === MSG.INPUTS).flatMap((m) => m.cmds); }
}
function orderFor(client, actionId, type, args) {
  return { v: 1, actionId, scope: client.grant.scope, controlRevision: client.grant.controlRevision,
    observationRevision: client.observation.revision, type, args };
}
function action(client, id) { return client.actions.find((entry) => entry.order.actionId === id); }
async function until(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await sleep(15); }
  throw new Error('Timed out waiting for movement evidence');
}
async function fakeClient({ now = () => 0, transport = new FakeTransport() } = {}) {
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant({ capabilities: ['move'] }),
    now, transportFactory: () => transport });
  await client.connect({ autoTick: false, timeoutMs: 100 });
  return { client, transport };
}

test('fake wire go_to emits bounded ordinary inputs and only confirmed arrival ends the task', async (t) => {
  let now = 0;
  const { client, transport } = await fakeClient({ now: () => now }); t.after(() => client.close());
  const order = orderFor(client, 'go-east', 'go_to', { x: 4, z: 0, tolerance: 0.5, durationMs: 5000 });
  assert.equal(client.order(order).ok, true);
  const sent = client.pump();
  assert.equal(sent.ok, true);
  assert.deepEqual({ mx: sent.input.mx, mz: sent.input.mz }, { mx: 1, mz: 0 });
  assert.ok(Math.hypot(sent.input.mx, sent.input.mz) <= 1);
  assert.equal(transport.inputs.at(-1).mx, 1);
  assert.equal(action(client, 'go-east').navigation.status, 'moving');
  now = 20;
  transport.snapshot(snap({ tick: 11, ack: sent.sequence - 1, you: state({ x: 3.7 }) }));
  assert.equal(action(client, 'go-east').navigation.status, 'arrived', 'spatial arrival can be observed before input ACK');
  assert.equal(action(client, 'go-east').result, null, 'destination observation without ACK cannot confirm the action');
  assert.deepEqual(client.pump().input, neutral, 'arrival stops creating movement ranges while ACK is pending');
  now = 40;
  transport.snapshot(snap({ tick: 12, ack: sent.sequence, you: state({ x: 3.7 }) }));
  assert.equal(action(client, 'go-east').navigation.status, 'arrived');
  assert.equal(action(client, 'go-east').result?.code, 'destination_observed');
  assert.equal(action(client, 'go-east').result?.source, 'server');
  assert.deepEqual(client.pump().input, neutral);
});

test('fake wire cancellation sends neutral, preserves submitted uncertainty, and prevents old movement', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  const order = orderFor(client, 'cancel-me', 'go_to', { x: 20, z: 0, tolerance: 0.5, durationMs: 8000 });
  assert.equal(client.order(order).ok, true);
  const sent = client.pump();
  assert.equal(sent.actionId, 'cancel-me');
  assert.equal(client.cancel('cancel-me', 'intruder').why, 'owner_mismatch');
  assert.equal(action(client, 'cancel-me').navigation.status, 'moving');
  assert.equal(client.pump().input.mx, 1, 'wrong-owner cancellation leaves the active intent untouched');
  assert.equal(client.cancel('cancel-me', 'owner-1').ok, true);
  assert.equal(action(client, 'cancel-me').state, 'uncertain');
  assert.equal(action(client, 'cancel-me').navigation.status, 'cancelled');
  assert.equal(action(client, 'cancel-me').result, null);
  assert.deepEqual(transport.inputs.at(-1), { ...transport.inputs.at(-1), mx: 0, mz: 0, btn: 0, prs: 0 });
  const count = transport.inputs.length;
  assert.deepEqual(client.pump().input, neutral);
  assert.equal(transport.inputs.length, count + 1);
  assert.equal(transport.inputs.at(-1).mx, 0);
  assert.equal(transport.inputs.at(-1).mz, 0);
});

test('fake wire follow and keep_distance require the same observable target life', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  const target = client.observation.confirmed.entities.find((entry) => entry.ref.entityId === 9);
  assert.equal(client.order(orderFor(client, 'follow-ana', 'follow', {
    target: target.ref, distance: 3, tolerance: 0.5, durationMs: 5000,
  })).ok, true);
  assert.equal(client.pump().input.mx, 1);
  transport.message({ t: MSG.DESPAWN, id: 9 });
  transport.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.PLAYER, name: 'Otra Ana', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
  assert.equal(action(client, 'follow-ana').navigation.status, 'cancelled');
  assert.deepEqual(client.pump().input, neutral, 'raw target retirement neutralizes before another snapshot can arrive');
  transport.snapshot(snap({ tick: 11, entities: [row(9, KIND.PLAYER, { x: 10 })] }));
  assert.notEqual(client.observation.confirmed.entities[0].ref.life, target.ref.life);
  assert.equal(action(client, 'follow-ana').navigation.status, 'cancelled');
  assert.equal(action(client, 'follow-ana').why, 'target_unavailable');
  assert.deepEqual(client.pump().input, neutral);
  const staleRef = target.ref;
  assert.equal(client.order(orderFor(client, 'stale-distance', 'keep_distance', {
    target: staleRef, distance: 4, tolerance: 0.5, durationMs: 5000,
  })).why, 'target_unavailable');
  assert.equal(transport.inputs.at(-1).mx, 0);
});

test('fake wire holding neutral ranges stay attached to follow when the target moves away again', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  const target = client.observation.confirmed.entities.find((entry) => entry.ref.entityId === 9);
  assert.equal(client.order(orderFor(client, 'resume-follow', 'follow', {
    target: target.ref, distance: 3, tolerance: 0.5, durationMs: 7000,
  })).ok, true);
  const first = client.pump();
  assert.equal(first.actionId, 'resume-follow');
  assert.equal(first.input.mx, 1);
  const firstRange = action(client, 'resume-follow').inputRange;
  assert.deepEqual(firstRange, { first: first.sequence, last: first.sequence });

  transport.snapshot(snap({ tick: 11, ack: first.sequence, you: state({ x: 7.2 }),
    entities: [row(9, KIND.PLAYER, { x: 10 })] }));
  assert.equal(action(client, 'resume-follow').navigation.status, 'holding');
  const neutralOne = client.pump(), neutralTwo = client.pump();
  assert.deepEqual(neutralOne.input, neutral);
  assert.deepEqual(neutralTwo.input, neutral);
  assert.equal(client.state, 'ready');
  assert.deepEqual(action(client, 'resume-follow').inputRange,
    { first: first.sequence, last: neutralTwo.sequence }, 'holding inputs remain contiguous under the same action');

  transport.snapshot(snap({ tick: 12, ack: neutralTwo.sequence, you: state({ x: 7.2 }),
    entities: [row(9, KIND.PLAYER, { x: 15 })] }));
  assert.equal(action(client, 'resume-follow').navigation.status, 'moving');
  const resumed = client.pump();
  assert.equal(resumed.actionId, 'resume-follow');
  assert.equal(resumed.input.mx, 1);
  assert.equal(client.state, 'ready', 'resuming after holding does not disconnect on a range gap');
  assert.deepEqual(action(client, 'resume-follow').inputRange,
    { first: first.sequence, last: resumed.sequence });
  assert.equal(action(client, 'resume-follow').why, null);
  assert.equal(transport.inputs.at(-1).mx, 1);
});

test('fake wire reentry starts with no prior task or retained movement input', async (t) => {
  const old = new FakeTransport(), fresh = new FakeTransport(), transports = [old, fresh];
  const runner = new AgentNetworkRunner({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant({ capabilities: ['move'] }),
    now: () => 0, transportFactory: () => transports.shift() });
  t.after(() => runner.close());
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  assert.equal(runner.order(orderFor(runner, 'old-task', 'go_to', {
    x: 30, z: 0, tolerance: 0.5, durationMs: 8000,
  })).ok, true);
  runner.pump();
  assert.equal(old.inputs.at(-1).mx, 1);
  assert.equal(runner.stop('owner-1').ok, true);
  const archived = runner.lifecycle.archives[0].actions.find((entry) => entry.order.actionId === 'old-task');
  assert.equal(archived.state, 'uncertain');
  const reentered = await runner.reenter('owner-1');
  assert.equal(reentered.ok, true);
  assert.equal(runner.actions.length, 0);
  assert.equal(runner.order(orderFor(runner, 'old-task', 'go_to', {
    x: 30, z: 0, tolerance: 0.5, durationMs: 8000,
  })).why, 'retired_action_id');
  assert.deepEqual(runner.pump().input, neutral);
  assert.equal(fresh.inputs.at(-1).mx, 0);
  assert.equal(fresh.inputs.at(-1).mz, 0);
  assert.equal(old.inputs.at(-1).mx, 0, 'the prior session ends with a neutral input');
  assert.equal(old.inputs.filter((input) => input.mx !== 0 || input.mz !== 0).length, 1,
    'reentry cannot append movement to the retired connection');
});

function guestGrant(characterId) {
  return fixtureGrant({ capabilities: ['move'], scope: { characterId, sessionId: `session-${characterId}`, worldId: 'l02a-network' },
    expiresAtMs: Date.now() + 60000 });
}
async function realServer(t, maxPlayers = 2) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers, dev: false,
    worldId: null, saveSecret: 'l02a-test-secret-only', log: () => {} });
  // Controlled map fixture is installed before listen/JOIN, leaving normal LocalServer movement authoritative.
  const map = server.game.server.world.map;
  const groundAt = map.groundAt.bind(map);
  const spawnX = map.landmarks.spawn.x;
  map.groundAt = (x, z) => x > spawnX + 0.45 ? -20 : 0;
  map.queryColliders = () => [];
  t.after(() => server.close());
  const port = await server.listen();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

test('real WS go_to, follow and keep_distance use ordinary inputs; terrain collision reports blocked without teleporting', { timeout: 20000 }, async (t) => {
  const { server, url } = await realServer(t, 2);
  const observedPositions = [];
  const runner = new AgentNetworkClient({ url, grant: guestGrant('l02a-runner'), name: 'L02a',
    limits: { movementBlockedAfterMs: 1200, movementMinProgressMm: 100 },
    onFeedback: (event) => { if (event.type === 'observation') observedPositions.push(event.data.observation.confirmed.self.position); } });
  const observer = new AgentNetworkClient({ url, grant: guestGrant('l02a-observer'), name: 'Ana' });
  t.after(() => { runner.close(); observer.close(); });
  await runner.connect(); await observer.connect();
  const start = runner.observation.confirmed.self.position;
  const destination = { x: start.x - 4, z: start.z };
  assert.equal(runner.order(orderFor(runner, 'real-go-to', 'go_to', {
    ...destination, tolerance: 0.5, durationMs: 5000,
  })).ok, true);
  await until(() => action(runner, 'real-go-to')?.result?.code === 'destination_observed', 6000);
  const arrived = runner.observation.confirmed.self.position;
  assert.ok(Math.hypot(arrived.x - start.x, arrived.z - start.z) > 2, 'server confirmed several meters of real movement');

  const target = await until(() => runner.observation.confirmed.entities.find((entry) =>
    entry.kind === 'player' && entry.ref.entityId === observer.identity.entityId), 5000);
  assert.equal(runner.order(orderFor(runner, 'real-follow', 'follow', {
    target: target.ref, distance: 1, tolerance: 0.3, durationMs: 5000,
  })).ok, true);
  assert.equal(action(runner, 'real-follow').navigation.status, 'moving');
  const followInput = runner.pump().input;
  assert.ok(followInput.mx > 0, 'follow input points toward the observed player at the spawn');
  await until(() => action(runner, 'real-follow')?.navigation?.status === 'holding', 6000);
  assert.ok(action(runner, 'real-follow').navigation.observationTick > 0);
  assert.ok(action(runner, 'real-follow').navigation.distance <= 1.3);
  assert.ok(action(runner, 'real-follow').navigation.distance > 0.7);
  const latestTarget = runner.observation.confirmed.entities.find((entry) => entry.ref.entityId === target.ref.entityId);
  assert.ok(latestTarget && latestTarget.ref.life === target.ref.life);
  assert.equal(runner.order(orderFor(runner, 'real-keep-distance', 'keep_distance', {
    target: latestTarget.ref, distance: 3, tolerance: 0.5, durationMs: 5000,
  })).ok, true);
  assert.equal(action(runner, 'real-keep-distance').navigation.status, 'moving');
  const keepInput = runner.pump().input;
  assert.ok(Math.hypot(keepInput.mx, keepInput.mz) <= 1);
  assert.ok(Math.hypot(keepInput.mx, keepInput.mz) > 0, 'keep_distance uses a normal movement vector');
  const beforeKeep = runner.observation.confirmed.self.position;
  await until(() => action(runner, 'real-keep-distance')?.navigation?.status === 'holding', 6000);
  const afterKeep = runner.observation.confirmed.self.position;
  assert.ok(Math.hypot(afterKeep.x - beforeKeep.x, afterKeep.z - beforeKeep.z) > 1, 'keep_distance moves the body away before holding');
  assert.ok(action(runner, 'real-keep-distance').navigation.distance >= 2.5);
  assert.ok(action(runner, 'real-keep-distance').navigation.distance <= 3.5);

  const beforeBlock = runner.observation.confirmed.self.position;
  const spawnX = server.game.server.world.map.landmarks.spawn.x;
  const order = orderFor(runner, 'blocked-east', 'go_to', { x: spawnX + 4, z: beforeBlock.z, tolerance: 0.35, durationMs: 10000 });
  assert.equal(runner.order(order).ok, true);
  await until(() => action(runner, 'blocked-east')?.navigation?.status === 'blocked', 7000);
  const end = runner.observation.confirmed.self.position;
  assert.ok(end.x <= spawnX + 0.45 + 1e-6, 'server collision kept the player on the walkable side of the fixture boundary');
  assert.ok(Math.hypot(end.x - (spawnX + 4), end.z - beforeBlock.z) > 3, 'the authoritative body remains far from the requested goal');
  assert.equal(action(runner, 'blocked-east').navigation.source, 'server');
  const halted = runner.pump().input;
  assert.equal(halted.mx, 0); assert.equal(halted.mz, 0, 'blocked goal emits no continuing movement');
  for (let index = 1; index < observedPositions.length; index++) {
    const a = observedPositions[index - 1], b = observedPositions[index];
    assert.ok(Math.hypot(b.x - a.x, b.z - a.z) < 1, 'successive authoritative observations show no teleport');
  }
  assert.equal(server.game.status().errors, 0);
});
