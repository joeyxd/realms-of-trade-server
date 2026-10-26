import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { ENT, MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND, PLAYER_FIELDS, TEAM } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';
import { createGameServer } from '../server/index.mjs';

const clone = (v) => structuredClone(v);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await sleep(15); }
  throw new Error('Timed out waiting for lifecycle evidence');
}
const ownId = 2;

function playerState(overrides = {}) {
  const state = { x: 0, y: 1, z: 0, facing: 0, hp: 100, maxHp: 100, atk: 10, speed: 6.5,
    moveMul: 1, dashT: -1, guardT: -1, dashMax: 1, dashCharges: 1, guardSt: 60,
    cdr: 1, ripMul: 1, reflMul: 1, fireMul: 1, potHeal: 1, xpMul: 1, level: 1, ...overrides };
  return PLAYER_FIELDS.map((field) => state[field] ?? 0);
}
function tuple(id, kind, { x = 0, y = 1, z = 0, hp = 100, maxHp = 100 } = {}) {
  const row = Array(19).fill(0);
  Object.assign(row, { [ENT.ID]: id, [ENT.KIND]: kind, [ENT.X]: x, [ENT.Y]: y, [ENT.Z]: z,
    [ENT.HP]: hp, [ENT.MAXHP]: maxHp, [ENT.LVL]: 1 });
  return row;
}
function snapshot(overrides = {}) {
  return { t: MSG.SNAPSHOT, tick: 10, ack: 0, you: playerState(),
    ents: [tuple(ownId, KIND.PLAYER), tuple(7, KIND.ENEMY, { x: 5, z: 8, hp: 40, maxHp: 40 })],
    rafts: [], resources: { nodes: [], bench: null }, ...overrides };
}
const chatState = () => ({ t: MSG.CHAT_STATE, self: 'chat-self-session', peers: [
  { id: 'chat-self-session', entity: ownId, name: 'Brisa [IA]' },
], config: { enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5,
  historyLimit: 100, receiptLimit: 128 }, history: [] });

class FakeTransport {
  constructor({ error = null, initialSnapshot = snapshot(), deferClose = false } = {}) {
    this.opened = Promise.resolve(true); this.ws = { readyState: 1 }; this.closed = false;
    this.sent = []; this.outbox = []; this.messageListeners = []; this.snapshotListeners = []; this.closeListeners = [];
    this.error = error; this.initialSnapshot = initialSnapshot; this.deferClose = deferClose; this.closeRequested = false;
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
      this.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'Brisa [IA]', skin: 0,
        level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.SPAWN, e: { id: 7, kind: KIND.ENEMY, name: 'Practice', skin: 0,
        level: 1, enemy: 0, maxHp: 40, team: TEAM.ENEMIES } });
      this.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: ownId, tick: 10, seed: GAME.seed });
      this.message(chatState());
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
    if (this.deferClose) { this.closeRequested = true; return; }
    this.finishClose();
  }
  finishClose() {
    if (this.closed) return;
    this.closed = true; this.ws.readyState = 3;
    for (const cb of [...this.closeListeners]) cb({ code: 1000, reason: 'test closed' });
  }
  get inputs() { return this.sent.filter((m) => m.t === MSG.INPUTS).flatMap((m) => m.cmds); }
}
function grant(overrides = {}) {
  return fixtureGrant({ capabilities: ['move', 'aim', 'attack_pve', 'chat'], expiresAtMs: 100000,
    scope: { worldId: 'l01-lifecycle-world', ...overrides.scope }, ...overrides });
}
function orderFor(runner, actionId, overrides = {}) {
  const observation = runner.observation;
  return { v: 1, actionId, scope: observation.scope, controlRevision: observation.controlRevision,
    observationRevision: observation.revision, type: 'move', args: { mx: 1, mz: 0, durationMs: 900 }, ...overrides };
}
function chatOrder(runner, actionId) {
  const observation = runner.observation;
  return { v: 1, actionId, scope: observation.scope, controlRevision: observation.controlRevision,
    observationRevision: observation.revision, type: 'chat_send', args: { channel: 'world', text: 'Hola', target: null } };
}
function makeFakeRunner({ now = () => 0, maxSessions = 8, firstTransport, transports = [] } = {}) {
  const created = [];
  const runner = new AgentNetworkRunner({ url: 'ws://127.0.0.1:1/ws', grant: grant(), maxSessions, now,
    chatTimeoutMs: 10, transportFactory: () => {
      const transport = created.length === 0 && firstTransport ? firstTransport : (transports.shift() ?? new FakeTransport());
      created.push(transport); return transport;
    } });
  return { runner, created };
}

test('death archives sent uncertainty, cancels unsent work, and explicit reentry starts with fresh state and retired IDs', async () => {
  let time = 0;
  const { runner, created } = makeFakeRunner({ now: () => time });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const oldGrant = runner.grant, oldTarget = runner.observation.confirmed.entities.find((e) => e.kind === 'enemy').ref;
  assert.equal(runner.order(orderFor(runner, 'body-unsent')).ok, true);
  assert.equal(runner.sendChat(chatOrder(runner, 'chat-uncertain')).ok, true);
  time = 11; runner.chat; // expire the sent request without fabricating a server receipt
  const oldTransport = created[0];
  oldTransport.flush = () => { throw new Error('neutral flush failed'); };
  oldTransport.message({ t: MSG.EVENT, ev: { type: 'death', id: ownId } });

  assert.equal(runner.state, 'stopped');
  assert.equal(runner.lifecycle.archives.length, 1);
  const archive = runner.lifecycle.archives[0];
  assert.equal(archive.termination.reason, 'death');
  assert.equal(archive.controlRevision, oldGrant.controlRevision + 1, 'death interrupts the session once');
  assert.equal(archive.actions.find((a) => a.order.actionId === 'body-unsent').state, 'cancelled');
  assert.equal(runner.priorUncertainty.some((a) => a.actionId === 'chat-uncertain' && a.kind === 'chat' && !a.retryAllowed), true);
  const frozenArchive = runner.lifecycle;
  frozenArchive.archives[0].actions[0].state = 'confirmed';
  frozenArchive.archives[0].scope.sessionId = 'tampered';
  assert.notEqual(runner.lifecycle.archives[0].actions[0].state, 'confirmed', 'lifecycle snapshots are detached');
  assert.notEqual(runner.lifecycle.archives[0].scope.sessionId, 'tampered');
  const detachedAfterMutation = runner.lifecycle;
  oldTransport.snap(snapshot({ tick: 99, you: playerState({ x: 500 }) }));
  oldTransport.message({ t: MSG.CHAT_RESULT, requestId: 'chat-uncertain', ok: true, messageId: 'old:1' });
  assert.deepEqual(runner.lifecycle, detachedAfterMutation, 'late old-session messages cannot mutate archives');

  const result = await runner.reenter(oldGrant.scope.ownerId);
  assert.equal(result.ok, true);
  assert.notEqual(result.grant.scope.sessionId, oldGrant.scope.sessionId);
  assert.equal(result.grant.controlRevision, oldGrant.controlRevision + 2);
  assert.equal(result.taskResume, 'none');
  assert.equal(result.observation.tick, 10, 'new readiness is based on the new session snapshot');
  assert.notEqual(result.observation.confirmed.entities.find((e) => e.kind === 'enemy').ref.life, oldTarget.life);
  assert.equal(created.length, 2);
  assert.equal(created[1].inputs.length, 0, 'no old input is replayed on reentry');

  const reusedBodyId = orderFor(runner, 'body-unsent');
  assert.equal(runner.order(reusedBodyId).why, 'retired_action_id');
  assert.equal(runner.sendChat(chatOrder(runner, 'chat-uncertain')).why, 'retired_action_id');
  assert.equal(runner.retryChat('chat-uncertain').why, 'retired_action_id');
  assert.equal(runner.sendChat(chatOrder(runner, 'body-unsent')).why, 'retired_action_id', 'body ID cannot cross into chat');
  assert.equal(runner.order(orderFor(runner, 'chat-uncertain')).why, 'retired_action_id', 'chat ID cannot cross into body');
  const staleTarget = orderFor(runner, 'new-action-old-target', { type: 'attack_pve', args: { target: oldTarget, durationMs: 100 } });
  assert.equal(runner.order(staleTarget).why, 'target_unavailable');
  assert.equal(runner.actions.length, 0);
  runner.close();
});

test('zero HP snapshot halts once; death callback cannot allow a post-death decision', async () => {
  const transports = [new FakeTransport(), new FakeTransport()];
  const { runner, created } = makeFakeRunner({ transports });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const prior = runner.grant;
  assert.equal(runner.order(orderFor(runner, 'sent-before-death')).ok, true);
  assert.equal(runner.pump().ok, true);
  const staleDecision = orderFor(runner, 'after-death');
  created[0].snap(snapshot({ tick: 11, you: playerState({ hp: 0 }) }));
  assert.equal(runner.state, 'stopped');
  assert.equal(runner.lifecycle.archives[0].termination.reason, 'death');
  assert.equal(runner.lifecycle.archives[0].controlRevision, prior.controlRevision + 1);
  assert.equal(runner.lifecycle.archives[0].actions.find((a) => a.order.actionId === 'sent-before-death').state, 'uncertain');
  assert.equal(runner.order(staleDecision).ok, false);
  const late = runner.reenter(prior.scope.ownerId);
  assert.equal((await late).ok, true);
  assert.equal(created[1].inputs.length, 0);
  runner.close();
});

test('reentry enforces owner, session cap, expiry, and fresh handshake before ready', async () => {
  let time = 0;
  const held = new FakeTransport({ initialSnapshot: null });
  const { runner, created } = makeFakeRunner({ now: () => time, maxSessions: 2, transports: [new FakeTransport(), held] });
  await runner.connect({ autoTick: false, timeoutMs: 1000 });
  const owner = runner.grant.scope.ownerId;
  runner.stop('wrong-owner');
  assert.equal(runner.state, 'ready');
  runner.stop(owner);
  assert.equal((await runner.reenter('wrong-owner')).why, 'owner_mismatch');

  const pending = runner.reenter(owner);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runner.state, 'connecting');
  assert.equal(runner.order({ actionId: 'too-early' }).why, 'not_ready');
  held.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'Brisa [IA]', human: 1, team: TEAM.PLAYERS } });
  held.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: ownId, seed: GAME.seed });
  assert.equal(runner.state, 'connecting', 'WELCOME alone is insufficient');
  held.snap(snapshot());
  assert.equal((await pending).ok, true);
  assert.equal(created.length, 2);
  runner.stop(owner);
  assert.equal((await runner.reenter(owner)).why, 'session_capacity');
  runner.close();

  let now = 0;
  const expiring = new AgentNetworkRunner({ url: 'ws://127.0.0.1:1/ws',
    grant: fixtureGrant({ expiresAtMs: 5, scope: { worldId: 'l01-lifecycle-world' } }), now: () => now,
    transportFactory: () => new FakeTransport() });
  await expiring.connect({ autoTick: false, timeoutMs: 100 });
  expiring.stop(expiring.grant.scope.ownerId); now = 5;
  assert.equal((await expiring.reenter(expiring.grant.scope.ownerId)).why, 'authorization_expired');
  expiring.close();
});

test('failed fresh admission remains stopped and retains prior uncertainty without retry', async () => {
  const { runner, created } = makeFakeRunner({ transports: [new FakeTransport(), new FakeTransport({ error: 'FULL' })] });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const owner = runner.grant.scope.ownerId;
  assert.equal(runner.order(orderFor(runner, 'sent-before-failure')).ok, true);
  assert.equal(runner.pump().ok, true);
  runner.stop(owner);
  const result = await runner.reenter(owner);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'server_FULL');
  assert.equal(runner.state, 'stopped');
  assert.equal(runner.priorUncertainty.some((a) => a.actionId === 'sent-before-failure' && a.retryAllowed === false), true);
  assert.equal(created[1].inputs.length, 0);
  runner.close();
});

test('unexpected socket close preserves sent uncertainty, clears queues, and reentry ignores stale scope', async () => {
  let time = 0;
  const { runner, created } = makeFakeRunner({ now: () => time, transports: [new FakeTransport(), new FakeTransport()] });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const oldGrant = runner.grant;
  assert.equal(runner.order(orderFor(runner, 'lost-body')).ok, true);
  assert.equal(runner.pump().ok, true);
  assert.equal(runner.sendChat(chatOrder(runner, 'lost-chat')).ok, true);
  time = 11; runner.chat;
  const old = created[0];
  old.outbox.push({ mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
  old.finishClose();
  assert.equal(runner.state, 'stopped');
  assert.equal(old.outbox.length, 0);
  const archive = runner.lifecycle.archives[0];
  assert.equal(archive.termination.reason, 'disconnect');
  assert.equal(archive.termination.neutralAttempted, false);
  assert.equal(archive.actions.find((a) => a.order.actionId === 'lost-body').state, 'uncertain');
  assert.equal(runner.priorUncertainty.some((entry) => entry.actionId === 'lost-chat' && entry.kind === 'chat'), true);
  const sentBeforeLate = old.sent.length;
  old.message({ t: MSG.EVENT, ev: { type: 'death', id: ownId } });
  old.snap(snapshot({ tick: 99, you: playerState({ x: 700 }) }));
  assert.equal(old.sent.length, sentBeforeLate);
  assert.equal(runner.priorUncertainty.length, 2);

  const fresh = await runner.reenter(oldGrant.scope.ownerId);
  assert.equal(fresh.ok, true);
  const staleBody = { ...orderFor(runner, 'late-old-scope'), scope: oldGrant.scope,
    controlRevision: oldGrant.controlRevision, observationRevision: runner.observation.revision };
  assert.equal(runner.order(staleBody).why, 'control_mismatch');
  assert.equal(created[1].inputs.length, 0);
  runner.close();
});

test('self DESPAWN is a terminal disconnect and cannot leave a reusable session', async () => {
  const { runner, created } = makeFakeRunner({ transports: [new FakeTransport(), new FakeTransport()] });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const oldScope = runner.grant.scope;
  assert.equal(runner.order(orderFor(runner, 'despawn-sent')).ok, true);
  assert.equal(runner.pump().ok, true);
  created[0].message({ t: MSG.DESPAWN, id: ownId });
  assert.equal(runner.state, 'stopped');
  assert.equal(runner.lifecycle.archives[0].termination.reason, 'disconnect');
  assert.equal(runner.lifecycle.archives[0].actions[0].state, 'uncertain');
  const fresh = await runner.reenter(oldScope.ownerId);
  assert.equal(fresh.ok, true);
  assert.notEqual(fresh.grant.scope.sessionId, oldScope.sessionId);
  runner.close();
});

test('owner stop cancels a close-wait transition and a stop during admission cannot resume it', async () => {
  const deferred = new FakeTransport({ deferClose: true });
  const { runner, created } = makeFakeRunner({ firstTransport: deferred });
  await runner.connect({ autoTick: false, timeoutMs: 100 });
  const owner = runner.grant.scope.ownerId;
  runner.stop(owner);
  const waiting = runner.reenter(owner);
  await sleep(20);
  assert.equal(deferred.closeRequested, true);
  assert.equal(created.length, 1, 'reentry waits for the original close callback');
  assert.equal(runner.stop('wrong-owner').ok, false, 'a nonowner cannot cancel transition');
  assert.equal(runner.stop(owner).ok, true, 'owner stop cancels pending transition');
  deferred.finishClose();
  assert.equal((await waiting).why, 'reentry_cancelled');
  assert.equal(created.length, 1, 'cancelled transition did not construct a new transport');
  runner.close();

  const heldAdmission = new FakeTransport({ initialSnapshot: null });
  const next = makeFakeRunner({ transports: [new FakeTransport(), heldAdmission] });
  await next.runner.connect({ autoTick: false, timeoutMs: 1000 });
  const nextOwner = next.runner.grant.scope.ownerId;
  next.runner.stop(nextOwner);
  const opening = next.runner.reenter(nextOwner);
  await until(() => next.created.length === 2 && next.runner.state === 'connecting');
  assert.equal(next.runner.stop(nextOwner).ok, true);
  const failed = await opening;
  assert.equal(failed.ok, false);
  assert.equal(next.runner.state, 'stopped');
  assert.equal(next.created.length, 2);
  heldAdmission.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'late', human: 1, team: TEAM.PLAYERS } });
  heldAdmission.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: ownId, seed: GAME.seed });
  heldAdmission.snap(snapshot());
  assert.equal(next.runner.state, 'stopped', 'late admission callbacks cannot resume a stopped runner');
  assert.equal(next.created[1].inputs.length, 0);
  next.runner.close();
});

test('real WebSocket reentry frees a normal slot and idle fresh body does not replay old movement', { timeout: 15000 }, async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 2, dev: false,
    worldId: 'l01-lifecycle-world', saveSecret: 'agent-lifecycle-test-secret', log() {} });
  t.after(() => server.close());
  const port = await server.listen(), url = `ws://127.0.0.1:${port}/ws`;
  const makeGrant = (characterId) => fixtureGrant({ scope: { ownerId: `owner-${characterId}`, characterId,
    worldId: 'l01-lifecycle-world', sessionId: `session-${characterId}` }, expiresAtMs: Date.now() + 60000 });
  const runner = new AgentNetworkRunner({ url, grant: makeGrant('runner') });
  const observer = new AgentNetworkRunner({ url, grant: makeGrant('observer') });
  t.after(() => { runner.close(); observer.close(); });
  await runner.connect({ autoTick: false }); await observer.connect({ autoTick: false });
  assert.equal(server.game.status().players, 2);
  const oldScope = runner.grant.scope;
  assert.equal(runner.order(orderFor(runner, 'real-move')).ok, true);
  assert.equal(runner.pump().ok, true);
  runner.stop(runner.grant.scope.ownerId);
  assert.equal(runner.priorUncertainty[0].actionId, 'real-move');
  const observerTickBeforeReentry = observer.observation.tick;
  await until(() => server.game.status().players === 1, 5000);
  const fresh = await runner.reenter(runner.grant.scope.ownerId);
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.notEqual(fresh.grant.scope.sessionId, oldScope.sessionId);
  assert.notEqual(fresh.grant.controlRevision, 1);
  assert.equal(server.game.status().players, 2);
  assert.equal(fresh.priorUncertainty[0].retryAllowed, false);
  const visibleFreshBody = await until(() => observer.observation.tick > observerTickBeforeReentry && observer.observation.confirmed.entities
    .find((entity) => entity.ref.entityId === runner.identity.entityId && entity.kind === 'player'));
  assert.equal(visibleFreshBody.kind, 'player', 'the reentered guest is visible as a normal player');
  const before = fresh.observation.confirmed.self.position;
  await sleep(300);
  const after = runner.observation.confirmed.self.position;
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.05, 'fresh idle guest receives no old movement');
  assert.equal(runner.actions.length, 0);
  assert.equal(server.game.status().errors, 0);
});
