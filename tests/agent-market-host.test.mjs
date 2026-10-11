import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { readCommerce } from '../src/sim/systems/commerce.js';
import { TOWNS } from '../src/data/towns.js';

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
  throw new Error('Timed out waiting for market wire evidence');
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
    throw new Error(`Timed out waiting for market message; last messages: ${JSON.stringify(this.messages.slice(-8))}`);
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function hello(token, { agent = false, name = 'Market test' } = {}) {
  return { t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name, skin: 0, weapon: 0 };
}

async function connect(url, token, options = {}) {
  const client = new WireClient(url);
  await client.send(hello(token, options));
  const result = await client.waitFor((m) => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
  return { client, result };
}

async function room(t, { capabilities = ['move', 'aim', 'attack_pve', 'body_pve', 'chat', 'inventory_read', 'market_read'],
  maxAgents = 2, pilot = true } = {}) {
  const server = createGameServer({
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4,
    worldId: WORLD, saveSecret: 'agent-market-ws-test-secret', store: createMemoryStore(),
    resolvePlayer: async (_req, message) => ({
      'owner-token': OWNER, 'agent-token': CHARACTER,
      'other-owner-token': OTHER_OWNER, 'other-agent-token': OTHER_CHARACTER,
    })[message.token] ?? null,
    log() {},
    agentControl: { worldId: WORLD, bindings: [
      { ownerId: OWNER, characterId: CHARACTER, capabilities },
      { ownerId: OTHER_OWNER, characterId: OTHER_CHARACTER, capabilities },
    ] },
    ...(pilot ? { agentPilot: { maxAgents } } : {}),
  });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

function pause(server) {
  clearInterval(server.game.timer); server.game.timer = null;
  clearInterval(server.game.worldTimer); server.game.worldTimer = null;
  clearInterval(server.game.beat); server.game.beat = null;
}

function pilotSocket(server, character = CHARACTER) {
  return [...server.game.sockets.values()].find((sock) => sock.agentIdentity === character);
}

function locate(world, entity, town = 'aldea') {
  const target = TOWNS[town], point = world.map.landmarks[target.landmark] || world.map[target.landmark];
  const ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = world.map.groundAt(point.x, point.z);
}

function request(agent, requestId, changes = {}) {
  const scope = agent.result.control.grant.scope;
  return { t: MSG.AGENT_MARKET, requestId, epoch: agent.result.control.grant.controlRevision,
    sessionId: scope.sessionId, op: 'list', ...changes };
}

async function rawQuery(agent, message) {
  const after = agent.client.messages.length;
  await agent.client.send(message);
  return agent.client.waitFor((m) => agent.client.messages.indexOf(m) >= after && m.t === MSG.AGENT_MARKET_RESULT);
}

async function query(agent, requestId, changes = {}) {
  const result = await rawQuery(agent, request(agent, requestId, changes));
  return result;
}

function exactResult(result) {
  assert.deepEqual(Object.keys(result).sort(),
    ['t', 'requestId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'market'].sort());
}

test('private market reads isolate two agent accounts and expose only current-town market data',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t);
    const first = await connect(url, 'agent-token', { agent: true, name: 'First market agent' });
    const second = await connect(url, 'other-agent-token', { agent: true, name: 'Second market agent' });
    t.after(() => { first.client.close(); second.client.close(); });
    assert.equal(first.result.t, MSG.WELCOME);
    assert.equal(second.result.t, MSG.WELCOME);
    pause(server);

    const world = server.game.server.world;
    locate(world, first.result.you, 'aldea'); locate(world, second.result.you, 'cala');
    const ownerA = await query(first, 'market-a', { op: 'list' });
    const ownerB = await query(second, 'market-b', { op: 'list' });
    exactResult(ownerA); exactResult(ownerB);
    assert.equal(ownerA.ok, true); assert.equal(ownerA.market.op, 'list');
    assert.equal(ownerA.market.town, 'aldea');
    assert.equal(ownerB.ok, true); assert.equal(ownerB.market.town, 'cala');
    assert.deepEqual(Object.keys(ownerA.market).sort(), ['v', 'op', 'town', 'rows'].sort());
    assert.ok(ownerA.market.rows.every((row) =>
      Object.keys(row).sort().join(',') === ['buy', 'g', 'illegal', 'sell', 'stock', 'trend'].sort().join(',')));
    assert.equal(JSON.stringify(ownerA.market).includes('gold'), false);
    assert.equal(JSON.stringify(ownerA.market).includes('pack'), false);
    assert.equal(JSON.stringify(ownerA.market).includes('profile'), false);
    assert.equal(JSON.stringify(ownerA.market).includes('save'), false);
    assert.equal(first.client.messages.some((m) => [MSG.PROFILE, MSG.SAVE].includes(m.t)), false);
    assert.equal(second.client.messages.some((m) => [MSG.PROFILE, MSG.SAVE].includes(m.t)), false);
    assert.equal(second.client.messages.some((m) => m.t === MSG.AGENT_MARKET_RESULT && m.requestId === 'market-a'), false);

    const selectedTown = await query(first, 'no-town-selector', { op: 'list', town: 'cala' });
    assert.equal(selectedTown.ok, false);
    assert.equal(selectedTown.why, 'invalid_request');
    assert.equal(selectedTown.market, null);

    const quote = await query(first, 'quote-aldea', { op: 'quote', g: 'fruta', n: 3, side: 'buy' });
    assert.equal(quote.ok, true, JSON.stringify(quote));
    assert.deepEqual(Object.keys(quote.market).sort(), ['v', 'op', 'town', 'g', 'n', 'side', 'total', 'avg', 'law'].sort());
    assert.equal(quote.market.town, 'aldea');
    assert.equal(quote.market.total, world.economy.quote('aldea', 'fruta', 3, 'buy').total);

    locate(world, first.result.you, 'cala');
    const moved = await query(first, 'list-cala', { op: 'list' });
    assert.equal(moved.ok, true);
    assert.equal(moved.market.town, 'cala', 'the host derives location from this actor each time');
  });

test('quote projection matches the shared commerce helper and rejects unavailable physical service',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t);
    const agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => agent.client.close());
    pause(server);
    const world = server.game.server.world, entity = agent.result.you;
    locate(world, entity, 'aldea');
    const expected = readCommerce(world, entity, { op: 'quote', town: 'aldea', g: 'ron', n: 4, side: 'sell' });
    const result = await query(agent, 'shared-quote', { op: 'quote', g: 'ron', n: 4, side: 'sell' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.market, { v: 1, op: 'quote', town: 'aldea', g: 'ron', n: expected.n,
      side: expected.side, total: expected.total, avg: expected.avg, law: expected.law });

    locate(world, entity, 'cala');
    const changedTown = await query(agent, 'shared-quote-cala', { op: 'quote', g: 'ron', n: 4, side: 'sell' });
    assert.equal(changedTown.ok, true);
    assert.equal(changedTown.market.town, 'cala');
    locate(world, entity, 'aldea');
    const noSelector = await rawQuery(agent, { ...request(agent, 'selector'), town: 'cala' });
    assert.equal(noSelector.ok, false); assert.equal(noSelector.why, 'invalid_request');
  });

test('market query replay preserves original data, conflicts on changed args, and rechecks location first',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t);
    const agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => agent.client.close());
    pause(server);
    const world = server.game.server.world, entity = agent.result.you;
    locate(world, entity, 'aldea');
    const original = await query(agent, 'replay-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
    assert.equal(original.ok, true);

    world.economy.markets.aldea.stock.fruta = Math.max(0, world.economy.markets.aldea.stock.fruta - 80);
    world.tick += 1;
    const replay = await query(agent, 'replay-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
    exactResult(replay);
    assert.equal(replay.ok, true); assert.equal(replay.replay, true);
    assert.equal(replay.tick, original.tick); assert.deepEqual(replay.market, original.market);
    const conflict = await query(agent, 'replay-quote', { op: 'quote', g: 'fruta', n: 2, side: 'buy' });
    assert.equal(conflict.ok, false); assert.equal(conflict.why, 'request_id_conflict');
    assert.equal(conflict.market, null);

    locate(world, entity, 'cala');
    const moved = await query(agent, 'replay-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
    assert.equal(moved.ok, false); assert.equal(moved.why, 'far');
    locate(world, entity, 'aldea');
    const fresh = await query(agent, 'fresh-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
    assert.equal(fresh.ok, true); assert.equal(fresh.replay, false);
    assert.notEqual(fresh.market.total, original.market.total);
    assert.equal(fresh.tick, world.tick);
  });

test('exact requests and identifiers are validated and only managed market_read agents can use the lane',
  { timeout: 15000 }, async (t) => {
    const { server, url } = await room(t);
    const owner = await connect(url, 'owner-token');
    const agent = await connect(url, 'agent-token', { agent: true });
    const noCapabilityRoom = await room(t, { capabilities: ['move', 'aim'] });
    const noCapability = await connect(noCapabilityRoom.url, 'agent-token', { agent: true });
    const noPilotRoom = await room(t, { pilot: false });
    const noPilot = await connect(noPilotRoom.url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); noCapability.client.close(); noPilot.client.close(); });
    pause(server);
    const bad = await rawQuery(agent, { ...request(agent, 'bad-town-selector'), town: 'aldea' });
    assert.equal(bad.ok, false); assert.equal(bad.why, 'invalid_request');
    for (const fields of [
      { requestId: 'bad id' }, { requestId: '' }, { epoch: 0 }, { sessionId: 'foreign-session' },
      { ownerId: OWNER }, { characterId: CHARACTER }, { entity: agent.result.you },
      { account: OWNER }, { extra: true }, { op: 'buy' }, { op: 'quote', g: 'fruta', n: 0, side: 'buy' },
      { op: 'quote', g: 'unknown', n: 1, side: 'buy' }, { op: 'quote', g: 'fruta', n: 1.2, side: 'buy' },
      { op: 'quote', g: 'fruta', n: 1, side: 'transfer' },
    ]) {
      const requestId = `invalid-${agent.client.messages.length}`;
      const message = { ...request(agent, requestId), ...fields };
      const result = await rawQuery(agent, message);
      assert.equal(result.ok, false, JSON.stringify(fields));
      assert.equal(result.why, fields.sessionId === 'foreign-session' ? 'control_mismatch' : 'invalid_request', JSON.stringify(fields));
      assert.equal(result.market, null);
    }
    const missing = await query(noCapability, 'missing-market-capability');
    assert.equal(missing.ok, false); assert.equal(missing.why, 'forbidden');
    const disabled = await query(noPilot, 'market-pilot-disabled');
    assert.equal(disabled.ok, false); assert.equal(disabled.why, 'forbidden');
    const human = await rawQuery(owner,
      { t: MSG.AGENT_MARKET, requestId: 'human-market', epoch: 1, sessionId: 'not-agent', op: 'list' });
    assert.equal(human.ok, false); assert.equal(human.why, 'forbidden');
  });

test('busy and naval service gates deny reads before cached replay', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t);
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  pause(server);
  const world = server.game.server.world, entity = agent.result.you;
  locate(world, entity, 'aldea');
  const first = await query(agent, 'gated-market', { op: 'list' });
  assert.equal(first.ok, true);
  const accountKey = server.game.profiles.clients.get(pilotSocket(server).id).key;
  const gate = pearlMutationGate(server.game.profiles), handle = gate.reserve({ accounts: [accountKey] });
  try {
    const unavailable = await query(agent, 'gated-market', { op: 'list' });
    assert.equal(unavailable.ok, false); assert.equal(unavailable.why, 'unavailable');
  } finally { gate.release(handle); }
  const pilot = world.navalPilot, hadOwnLocked = Object.hasOwn(pilot, 'locked'), originalLocked = pilot.locked;
  pilot.locked = (candidate) => candidate === entity;
  try {
    const locked = await query(agent, 'gated-market', { op: 'list' });
    assert.equal(locked.ok, false); assert.equal(locked.why, 'busy');
  } finally {
    if (hadOwnLocked) pilot.locked = originalLocked;
    else delete pilot.locked;
  }
});

test('64-query session cap includes denied quotes; invalid requests do not consume a slot', { timeout: 20000 }, async (t) => {
  const { server, url } = await room(t);
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  pause(server);
  const world = server.game.server.world;
  locate(world, agent.result.you, 'aldea');
  world.economy.markets.aldea.stock.fruta = 0;
  const denied = await query(agent, 'budget-denied-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
  assert.equal(denied.ok, false); assert.equal(denied.why, 'stock');
  const malformed = await query(agent, 'budget-invalid', { op: 'quote', g: 'fruta', n: 0, side: 'buy' });
  assert.equal(malformed.ok, false); assert.equal(malformed.why, 'invalid_request');
  for (let i = 0; i < 63; i++) {
    const result = await query(agent, `budget-market-${i}`, { op: 'list' });
    assert.equal(result.ok, true, `read ${i}: ${JSON.stringify(result)}`);
  }
  const duplicate = await query(agent, 'budget-denied-quote', { op: 'quote', g: 'fruta', n: 1, side: 'buy' });
  assert.equal(duplicate.ok, false); assert.equal(duplicate.why, 'stock'); assert.equal(duplicate.replay, true);
  const over = await query(agent, 'budget-market-over', { op: 'list' });
  assert.equal(over.ok, false); assert.equal(over.why, 'query_limit'); assert.equal(over.market, null);
});

test('stop, revoke, death, resume and reconnect reject retired selectors and generic writes have no effects',
  { timeout: 20000 }, async (t) => {
    const { server, url } = await room(t);
    const owner = await connect(url, 'owner-token');
    let agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); });
    assert.equal(agent.result.t, MSG.WELCOME);
    pause(server);
    const world = server.game.server.world;
    locate(world, agent.result.you, 'aldea');
    const sock = pilotSocket(server), entity = agent.result.you;
    const profile = world.profiles.get(entity), before = structuredClone(profile);
    const marketBefore = JSON.stringify(world.economy.serialize()), tick = world.tick;
    const receipts = world.commerceReceipts;
    const random = world.rng, lootRandom = world.lootRng;
    let randomCalls = 0, lootCalls = 0;
    world.rng = () => { randomCalls++; return random(); };
    if (typeof lootRandom === 'function') world.lootRng = () => { lootCalls++; return lootRandom(); };
    world.events.length = 0;
    const read = await query(agent, 'no-side-effects', { op: 'list' });
    assert.equal(read.ok, true);
    await agent.client.send({ t: MSG.CMD, type: 'commerce', op: 'buy', town: 'aldea', g: 'fruta', n: 1,
      expectedTotal: 0, opId: 'blocked-market-buy' });
    await agent.client.send({ t: MSG.CMD, type: 'commerce', op: 'list', town: 'aldea', opId: 'blocked-market-list' });
    await sleep(60);
    assert.deepEqual(profile, before);
    assert.equal(JSON.stringify(world.economy.serialize()), marketBefore);
    assert.equal(world.commerceReceipts, receipts);
    assert.deepEqual(world.events, []);
    assert.equal(world.tick, tick);
    assert.equal(randomCalls, 0); assert.equal(lootCalls, 0);
    assert.equal(agent.client.messages.some((m) => m.t === MSG.PROFILE || m.t === MSG.SAVE), false);

    const oldScope = agent.result.control.grant.scope, oldEpoch = agent.result.control.grant.controlRevision;
    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER });
    await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.grant?.scope?.characterId === CHARACTER &&
      m.state.state !== 'active');
    const stopped = await query(agent, 'after-stop');
    assert.equal(stopped.ok, false); assert.equal(stopped.why, 'control_mismatch');
    const stopReplay = await query(agent, 'no-side-effects', { op: 'list' });
    assert.equal(stopReplay.ok, false); assert.equal(stopReplay.why, 'control_mismatch');

    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'resume', characterId: CHARACTER });
    await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.resumed === true);
    agent.client.close(); await until(() => !pilotSocket(server));
    agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => agent.client.close());
    assert.notEqual(agent.result.control.grant.scope.sessionId, oldScope.sessionId);
    const oldSelector = await query(agent, 'old-after-reconnect', { epoch: oldEpoch, sessionId: oldScope.sessionId });
    assert.equal(oldSelector.ok, false); assert.equal(oldSelector.why, 'control_mismatch');

    const currentEntity = agent.result.you;
    locate(world, currentEntity, 'aldea');
    world.ecs.hp[currentEntity] = 0;
    server.game.sweepAgentControl();
    await agent.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.grant?.scope?.sessionId ===
      agent.result.control.grant.scope.sessionId && m.state?.state !== 'active');
    const afterDeath = await query(agent, 'after-death');
    assert.equal(afterDeath.ok, false); assert.equal(afterDeath.why, 'control_mismatch');

    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'revoke', characterId: CHARACTER });
    await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.grant?.scope?.characterId === CHARACTER &&
      m.state?.state === 'revoked');
  });
