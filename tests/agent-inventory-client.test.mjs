import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentInventory } from '../tools/agent/inventory.mjs';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { labLimits } from '../tools/agent/contract.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { SLOTS, ITEMS, CONSUMABLES } from '../src/data/items.js';
import { PACK_CAP } from '../src/sim/economy/cargo.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { PLAYER_FIELDS, KIND, TEAM } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';

const copy = (value) => structuredClone(value);
const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'world-1', sessionId: 'session-1' };
const grant = (capabilities = ['move', 'inventory_read']) => fixtureGrant({ scope, controlRevision: 5,
  expiresAtMs: 100000, capabilities });
const observation = (overrides = {}) => fixtureObservation({ scope, controlRevision: 5, revision: 2,
  tick: 10, receivedAtMs: 100, source: 'server', ...overrides });
const authority = (g = grant()) => ({ state: 'active', taskRevision: 0, grant: copy(g), task: null });
const emptyInventory = () => ({ v: 1, gold: 0, bag: { capacity: ITEMS.bag, items: [] },
  equipment: Object.fromEntries(SLOTS.map((slot) => [slot, null])),
  potions: { count: 0, capacity: CONSUMABLES.potion.max },
  pack: { capacity: PACK_CAP, used: 0, goods: [] } });
function result(request, overrides = {}) {
  return { t: MSG.AGENT_INVENTORY_RESULT, requestId: request.requestId, epoch: request.epoch,
    sessionId: request.sessionId, ok: true, why: null, tick: 11, replay: false,
    inventory: emptyInventory(), ...overrides };
}
function query(g = grant(), requestId = 'read-1') {
  return { v: 1, requestId, scope: copy(g.scope), controlRevision: g.controlRevision };
}
function managerHarness({ currentTime = 100, onSend, capabilities } = {}) {
  let now = currentTime;
  const sent = [], feedback = [];
  const g = grant(capabilities);
  const manager = new AgentInventory({ now: () => now, limits: labLimits(), timeoutMs: 100,
    send: (m) => { sent.push(copy(m)); onSend?.(m); }, onFeedback: (type, data) => feedback.push({ type, data }) });
  const update = (overrides = {}) => manager.updateContext({ ready: true, authenticated: true, grant: g,
    authority: authority(g), observation: observation({ receivedAtMs: now, ...overrides }) });
  update();
  return { manager, sent, feedback, grant: g, update, setNow: (v) => { now = v; } };
}

test('inventory client requires a live authenticated grant, fresh observation, and exact query', () => {
  const { manager, sent, grant: g, update } = managerHarness();
  assert.equal(manager.read({ ...query(g), extra: true }).why, 'invalid_request');
  assert.equal(manager.read({ ...query(g), controlRevision: 4 }).why, 'control_mismatch');
  assert.equal(manager.read({ ...query(g), scope: { ...g.scope, characterId: 'other-agent' } }).why, 'control_mismatch');
  const stale = managerHarness(); stale.setNow(2000); stale.update({ receivedAtMs: 100 });
  assert.equal(stale.manager.read(query(stale.grant)).why, 'unavailable');
  update({ receivedAtMs: 100, confirmed: { self: { hp: 0, dead: true } } });
  assert.equal(manager.read(query(g)).why, 'dead');
  const denied = managerHarness({ capabilities: ['move'] });
  assert.equal(denied.manager.read(query(denied.grant)).why, 'forbidden');
  assert.equal(sent.length, 0);
  assert.equal(denied.sent.length, 0);
});

test('inventory request is single-flight, duplicate local IDs never resend, and only fresh valid results update view', () => {
  const h = managerHarness(), { manager, grant: g } = h;
  assert.equal(manager.read(query(g)).ok, true);
  assert.deepEqual(h.sent, [{ t: MSG.AGENT_INVENTORY, requestId: 'read-1', epoch: 5, sessionId: scope.sessionId }]);
  assert.equal(manager.read(query(g)).replay, true);
  assert.equal(manager.read(query(g, 'read-2')).why, 'request_pending');
  const req = h.sent[0];
  assert.equal(manager.receive(result(req, { inventory: { ...emptyInventory(), secrets: [] } })), false);
  assert.equal(manager.receive(result(req)), true);
  assert.equal(manager.receive(result(req)), false, 'duplicate wire result is ignored');
  const current = manager.state;
  assert.equal(current.fresh, true);
  assert.equal(current.tick, 11);
  assert.deepEqual(current.inventory, emptyInventory());
  h.setNow(1601);
  assert.equal(manager.state.fresh, false);
  assert.equal(manager.state.inventory, null, 'expired cache is not exposed as the current view');
  assert.deepEqual(manager.requests[0].result.inventory, emptyInventory(), 'the historical read ledger remains available for review');
  assert.equal(h.feedback.filter((event) => event.type === 'inventory_request').length, 1);
  assert.equal(h.feedback.filter((event) => event.type === 'inventory_result').length, 1);
  h.setNow(1600);
  h.update({ revision: 3, tick: 12, receivedAtMs: 1600 });
  const replayQuery = query(g, 'read-2');
  assert.equal(manager.read(replayQuery).ok, true);
  assert.equal(manager.receive(result(h.sent.at(-1), { tick: 12, replay: true })), true);
  h.setNow(1601);
  assert.equal(manager.state.receivedAtMs, 100, 'a cached replay does not refresh the prior view');
  assert.equal(manager.state.fresh, false);
});

test('inventory timeouts become uncertain, ignore late results, and never retry', () => {
  const h = managerHarness(), request = query(h.grant);
  assert.equal(h.manager.read(request).ok, true);
  h.setNow(200); h.manager.expire();
  assert.equal(h.manager.requests[0].state, 'uncertain');
  assert.equal(h.manager.read(request).replay, true);
  assert.equal(h.sent.length, 1);
  assert.equal(h.manager.receive(result(h.sent[0])), false);
  assert.equal(h.manager.state.inventory, null);
  assert.equal(h.feedback.filter((event) => event.type === 'inventory_uncertain').length, 1);
});

test('an inventory denial retires the current view while preserving the historical ledger', () => {
  const h = managerHarness();
  h.manager.read(query(h.grant, 'before-gate'));
  assert.equal(h.manager.receive(result(h.sent.at(-1))), true);
  assert.equal(h.manager.state.fresh, true);
  h.manager.read(query(h.grant, 'gate-closed'));
  assert.equal(h.manager.receive(result(h.sent.at(-1), { ok: false, why: 'unavailable', inventory: null })), true);
  assert.equal(h.manager.state.inventory, null);
  assert.equal(h.manager.state.fresh, false);
  assert.equal(h.manager.requests[0].result.ok, true);
  assert.equal(h.manager.requests[1].state, 'rejected');
});

test('inventory request ledger hard-stops at the shared 64-query session limit', () => {
  const h = managerHarness();
  for (let i = 0; i < 64; i++) {
    const id = `bounded-${i + 1}`;
    assert.equal(h.manager.read(query(h.grant, id)).ok, true);
    assert.equal(h.manager.receive(result(h.sent.at(-1))), true);
  }
  assert.equal(h.manager.requests.length, 64);
  assert.equal(h.manager.read(query(h.grant, 'bounded-65')).why, 'query_limit');
  assert.equal(h.sent.length, 64);
});

test('inventory receive enforces deadline and distinguishes delayed stale snapshots from current views', () => {
  const h = managerHarness(), q = query(h.grant);
  h.manager.read(q);
  h.setNow(200);
  assert.equal(h.manager.receive(result(h.sent[0])), false, 'receipt itself expires the timed-out request');
  assert.equal(h.manager.requests[0].state, 'uncertain');

  const fresh = managerHarness();
  fresh.manager.read(query(fresh.grant));
  fresh.setNow(110);
  const nextObservation = observation({ revision: 3, tick: 12, receivedAtMs: 110 });
  fresh.manager.updateContext({ ready: true, authenticated: true, grant: fresh.grant,
    authority: authority(fresh.grant), observation: nextObservation });
  assert.equal(fresh.manager.receive(result(fresh.sent[0], { tick: 11 })), true,
    'a result newer than the request observation can be reported despite later snapshot jitter');
  assert.equal(fresh.manager.requests[0].result.stale, true);
  assert.equal(fresh.manager.state.inventory, null, 'older result is not promoted to the current view');
});

test('inventory view and unresolved request are invalidated on epoch or session change', () => {
  const h = managerHarness(), q = query(h.grant);
  h.manager.read(q); h.manager.receive(result(h.sent[0]));
  const nextGrant = { ...h.grant, scope: { ...h.grant.scope, sessionId: 'session-2' }, controlRevision: 6 };
  h.manager.updateContext({ ready: true, authenticated: true, grant: nextGrant, authority: authority(nextGrant),
    observation: fixtureObservation({ scope: nextGrant.scope, controlRevision: 6, revision: 3, tick: 12,
      receivedAtMs: 100, source: 'server' }) });
  assert.equal(h.manager.state.inventory, null);
  assert.equal(h.manager.receive(result(h.sent[0])), false);

  const pending = managerHarness(); pending.manager.read(query(pending.grant));
  pending.manager.updateContext(null);
  assert.equal(pending.manager.requests[0].state, 'uncertain');
  assert.equal(pending.manager.receive(result(pending.sent[0])), false);

  const revoked = managerHarness();
  revoked.manager.read(query(revoked.grant));
  const noRead = { ...revoked.grant, capabilities: ['move'] };
  revoked.manager.updateContext({ ready: true, authenticated: true, grant: noRead,
    authority: authority(noRead), observation: observation({ receivedAtMs: 100 }) });
  assert.equal(revoked.manager.requests[0].state, 'uncertain', 'revoking inventory_read fences the pending private read');
  assert.equal(revoked.manager.state.available, false);
  assert.equal(revoked.manager.receive(result(revoked.sent[0])), false);
});

class FakeTransport {
  constructor(g, now) { this.grant = g; this.now = now; this.opened = Promise.resolve(true); this.ws = { readyState: 1 };
    this.closed = false; this.sent = []; this.outbox = []; this.messageListeners = []; this.snapshotListeners = []; this.closeListeners = []; }
  start() {}
  onMessage(cb) { this.messageListeners.push(cb); }
  onSnapshot(cb) { this.snapshotListeners.push(cb); }
  onClose(cb) { this.closeListeners.push(cb); }
  message(m) { for (const cb of [...this.messageListeners]) cb(copy(m)); }
  snap(m) { for (const cb of [...this.snapshotListeners]) cb(copy(m)); }
  send(m) {
    this.sent.push(copy(m));
    if (m.t !== MSG.HELLO) return;
    queueMicrotask(() => {
      this.message({ t: MSG.SPAWN, e: { id: 2, kind: KIND.PLAYER, name: 'Agent', skin: 0, level: 1, weapon: 0,
        human: 1, team: TEAM.PLAYERS, life: 'self-life' } });
      this.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 2, tick: 10, seed: GAME.seed,
        control: authority(this.grant) });
      const you = Object.fromEntries(PLAYER_FIELDS.map((field) => [field, 0]));
      Object.assign(you, { hp: 100, maxHp: 100, weapon: 0, potions: 0, guardSt: 60, guardT: -1, potCd: 0 });
      this.snap({ t: MSG.SNAPSHOT, tick: 10, ack: 0, you: PLAYER_FIELDS.map((field) => you[field]), ents: [] });
    });
  }
  sendInput() {}
  flush() {}
  close() { if (this.closed) return; this.closed = true; this.ws.readyState = 3;
    for (const cb of [...this.closeListeners]) cb({ code: 1000, reason: 'test' }); }
}

test('AgentNetworkClient exposes only the private inventory lane to an authenticated server grant', async (t) => {
  let now = 100; const g = grant(), transport = new FakeTransport(g, () => now), events = [];
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: g,
    authorization: { token: 'fixture-token' }, now: () => now,
    onFeedback: (event) => events.push(copy(event)), transportFactory: () => transport });
  t.after(() => client.close());
  await client.connect({ autoTick: false, timeoutMs: 100 });
  const q = query(client.grant, 'client-read');
  assert.equal(client.readInventory(q).ok, true);
  assert.deepEqual(transport.sent.at(-1), { t: MSG.AGENT_INVENTORY, requestId: 'client-read', epoch: 5, sessionId: scope.sessionId });
  transport.message(result(transport.sent.at(-1)));
  assert.equal(client.inventory.fresh, true);
  assert.deepEqual(client.inventory.inventory, emptyInventory());
  assert.equal(events.some((event) => event.type === 'inventory_result'), true);
  assert.equal(client.readInventory(query(client.grant, 'stop-read')).ok, true);
  transport.message(result(transport.sent.at(-1)));
  assert.equal(client.inventory.fresh, true);
  assert.equal(client.readInventory(query(client.grant, 'pending-pump-timeout')).ok, true);
  now = 3100;
  assert.equal(client.pump().why, 'control_pending', 'inventory expiry is serviced before task-control early return');
  assert.equal(client.inventoryRequests.at(-1).state, 'uncertain');
  assert.equal(events.some((event) => event.type === 'inventory_uncertain'), true);
  client.stop(scope.ownerId);
  assert.equal(client.inventory.inventory, null, 'owner stop invalidates the private inventory view immediately');
  client.close();
});

test('managed runner reads current inventory through the real host and never carries it across stop/reentry',
  { timeout: 20000 }, async (t) => {
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const characterId = '33333333-3333-4333-8333-333333333333';
    const worldId = 'agent-inventory-runner';
    const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, seed: 42, maxPlayers: 2,
      worldId, store: createMemoryStore(), saveSecret: 'inventory-runner-fixture-only', log() {},
      resolvePlayer: async (_req, msg) => msg.token === 'inventory-fixture' ? characterId : null,
      agentControl: { worldId, ttlMs: 60000, bindings: [{ ownerId, characterId,
        capabilities: ['move', 'inventory_read'] }] }, agentPilot: { maxAgents: 1 } });
    const port = await server.listen(); t.after(() => server.close());
    const runner = new AgentNetworkRunner({ url: `ws://127.0.0.1:${port}/ws`, name: 'Inventory [IA]',
      authorization: { token: 'inventory-fixture' }, grant: { v: 1,
        scope: { ownerId, characterId, worldId, sessionId: 'placeholder' }, controlRevision: 1,
        expiresAtMs: Date.now() + 60000, capabilities: ['move', 'inventory_read'] } });
    t.after(() => runner.close());
    await runner.connect();
    const first = runner.readInventory({ v: 1, requestId: 'first-read', scope: runner.grant.scope,
      controlRevision: runner.grant.controlRevision });
    assert.equal(first.ok, true);
    const firstState = await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const value = runner.inventory;
        if (value.inventory) return resolve(value);
        if (Date.now() - started > 3000) return reject(new Error('inventory read timeout'));
        setTimeout(poll, 10);
      };
      poll();
    });
    assert.equal(firstState.fresh, true);
    assert.equal(firstState.inventory.gold, 0);
    const sock = [...server.game.sockets.values()].find((entry) => entry.agentIdentity === characterId);
    const entity = server.game.server.clients.get(sock.id).entity;
    server.game.server.world.profiles.get(entity).gold = 42;
    const next = runner.readInventory({ v: 1, requestId: 'second-read', scope: runner.grant.scope,
      controlRevision: runner.grant.controlRevision });
    assert.equal(next.ok, true);
    const changed = await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const value = runner.inventory;
        if (value.inventory?.gold === 42) return resolve(value);
        if (Date.now() - started > 3000) return reject(new Error('updated inventory read timeout'));
        setTimeout(poll, 10);
      };
      poll();
    });
    assert.equal(changed.fresh, true);
    assert.equal(runner.stop(ownerId).ok, true);
    assert.equal(runner.inventory.inventory, null);
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => runner.state === 'stopped' ? resolve() : Date.now() - started > 4000
        ? reject(new Error('runner stop timeout')) : setTimeout(poll, 10);
      poll();
    });
    const reentry = await runner.reenter(ownerId);
    assert.equal(reentry.ok, true);
    assert.equal(runner.inventory.inventory, null, 'new epoch starts without the archived private view');
    const again = runner.readInventory({ v: 1, requestId: 'third-read', scope: runner.grant.scope,
      controlRevision: runner.grant.controlRevision });
    assert.equal(again.ok, true);
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => runner.inventory.inventory ? resolve() : Date.now() - started > 3000
        ? reject(new Error('reentered inventory read timeout')) : setTimeout(poll, 10);
      poll();
    });
    assert.equal(runner.inventory.inventory.gold, 42);
  });
