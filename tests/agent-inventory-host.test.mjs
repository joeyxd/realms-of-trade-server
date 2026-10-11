import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { PACK_CAP } from '../src/sim/economy/cargo.js';

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
  throw new Error('Timed out waiting for inventory wire evidence');
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
    throw new Error(`Timed out waiting for inventory message; last messages: ${JSON.stringify(this.messages.slice(-8))}`);
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function hello(token, { agent = false, name = 'Inventory test' } = {}) {
  return { t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name, skin: 0, weapon: 0 };
}

async function connect(url, token, options = {}) {
  const client = new WireClient(url);
  await client.send(hello(token, options));
  const result = await client.waitFor((m) => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
  return { client, result };
}

async function room(t, { capabilities = ['move', 'aim', 'attack_pve', 'body_pve', 'chat', 'inventory_read'], maxAgents = 2, pilot = true } = {}) {
  const server = createGameServer({
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4,
    worldId: WORLD, saveSecret: 'agent-inventory-ws-test-secret', store: createMemoryStore(),
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

function request(agent, requestId, changes = {}) {
  const scope = agent.result.control.grant.scope;
  return { t: MSG.AGENT_INVENTORY, requestId, epoch: agent.result.control.grant.controlRevision,
    sessionId: scope.sessionId, ...changes };
}

async function query(agent, requestId, changes = {}) {
  const after = agent.client.messages.length;
  await agent.client.send(request(agent, requestId, changes));
  return agent.client.waitFor((m) => agent.client.messages.indexOf(m) >= after &&
    m.t === MSG.AGENT_INVENTORY_RESULT && m.requestId === requestId);
}

function exactResult(result) {
  assert.deepEqual(Object.keys(result).sort(),
    ['t', 'requestId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'inventory'].sort());
}

function pilotSocket(server, character = CHARACTER) {
  return [...server.game.sockets.values()].find((s) => s.agentIdentity === character);
}

test('inventory read is an exact scoped projection and never exposes raw profile/save frames to agents', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); });
  assert.equal(agent.result.t, MSG.WELCOME);
  assert.equal(agent.result.v, PROTOCOL_VERSION);
  await until(() => agent.client.messages.some((m) => m.t === MSG.SNAPSHOT));
  await until(() => owner.client.messages.some((m) => m.t === MSG.PROFILE));

  const sock = pilotSocket(server), entity = agent.result.you;
  const world = server.game.server.world, profile = world.profiles.get(entity), ecs = world.ecs;
  profile.gold = 314;
  profile.bag = [{ u: 900, b: 'sable', r: 1, l: 3, a: [], s: 1 }];
  ecs.potions[entity] = 4;
  profile.pot = 0; // The projection must use live ECS count rather than this stale snapshot field.
  profile.mast = [[7, 4000]];
  profile.quests = { hidden: [1, 99] };
  profile.tools = { hidden: true };
  profile.flags = { private: true };
  profile.pirateId = 'account:must-not-leak';
  await sleep(30);
  assert.equal(agent.client.messages.some((m) => [MSG.PROFILE, MSG.SAVE].includes(m.t)), false,
    'pilot receives neither raw PROFILE nor reusable SAVE frames');
  assert.equal(owner.client.messages.some((m) => m.t === MSG.PROFILE), true,
    'human retains the normal full PROFILE frame on a pilot-enabled host');

  const result = await query(agent, 'inventory-first');
  exactResult(result);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.why, null);
  assert.equal(result.epoch, agent.result.control.grant.controlRevision);
  assert.equal(result.sessionId, sock.agentSessionId);
  assert.equal(result.replay, false);
  assert.deepEqual(Object.keys(result.inventory).sort(), ['v', 'gold', 'bag', 'equipment', 'potions', 'pack'].sort());
  assert.equal(result.inventory.v, 1);
  assert.equal(result.inventory.gold, 314);
  assert.deepEqual(result.inventory.bag.items, profile.bag);
  assert.equal(result.inventory.bag.capacity, 24);
  assert.deepEqual(Object.keys(result.inventory.equipment).sort(), ['weapon', 'head', 'chest', 'boots', 'ring1', 'ring2'].sort());
  assert.equal(result.inventory.potions.count, 4);
  assert.equal(result.inventory.potions.capacity, 5);
  assert.equal(result.inventory.pack.capacity, PACK_CAP);
  assert.equal(result.inventory.pack.used, 0);
  assert.deepEqual(result.inventory.pack.goods, []);
  const encoded = JSON.stringify(result.inventory);
  for (const field of ['pearls', 'masteries', 'quests', 'ships', 'flags', 'account:', 'pirateId', 'uid']) {
    assert.equal(encoded.includes(field), false, `inventory projection omits ${field}`);
  }
  assert.equal(owner.client.messages.some((m) => m.t === MSG.AGENT_INVENTORY_RESULT), false,
    'the inventory result stays on the requesting agent connection');
});

test('reads isolate two admitted agents and replay an original snapshot while a new request sees current state', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t);
  const first = await connect(url, 'agent-token', { agent: true, name: 'First' });
  const second = await connect(url, 'other-agent-token', { agent: true, name: 'Second' });
  t.after(() => { first.client.close(); second.client.close(); });
  assert.equal(first.result.t, MSG.WELCOME);
  assert.equal(second.result.t, MSG.WELCOME);
  const world = server.game.server.world;
  const a = world.profiles.get(first.result.you), b = world.profiles.get(second.result.you);
  a.gold = 111; b.gold = 222;
  const original = await query(first, 'snapshot-one');
  assert.equal(original.inventory.gold, 111);
  const other = await query(second, 'snapshot-two');
  assert.equal(other.inventory.gold, 222);

  a.gold = 333;
  const updated = await query(first, 'snapshot-three');
  assert.equal(updated.inventory.gold, 333);
  assert.notEqual(updated.tick, original.tick);
  const replay = await query(first, 'snapshot-one');
  exactResult(replay);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.tick, original.tick);
  assert.deepEqual(replay.inventory, original.inventory);
  assert.equal(second.client.messages.some((m) => m.t === MSG.AGENT_INVENTORY_RESULT && m.sessionId === first.result.control.grant.scope.sessionId), false);
  assert.equal(first.client.messages.some((m) => m.t === MSG.AGENT_INVENTORY_RESULT && m.sessionId === second.result.control.grant.scope.sessionId), false);
});

test('exact request validation, capability and scope checks run before cached replay', { timeout: 15000 }, async (t) => {
  const { url } = await room(t);
  const owner = await connect(url, 'owner-token');
  const agent = await connect(url, 'agent-token', { agent: true });
  const noCapability = await room(t, { capabilities: ['move', 'aim'] });
  const noCap = await connect(noCapability.url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); noCap.client.close(); });

  const created = await query(agent, 'scope-check');
  assert.equal(created.ok, true);
  for (const [changes, why] of [
    [{ epoch: created.epoch + 1 }, 'control_mismatch'],
    [{ sessionId: 'foreign-session' }, 'control_mismatch'],
    [{ characterId: OTHER_CHARACTER }, 'invalid_request'],
    [{ selector: { clientId: 1, entity: agent.result.you } }, 'invalid_request'],
    [{ extra: true }, 'invalid_request'],
  ]) {
    const result = await query(agent, `invalid-${why}-${Object.keys(changes)[0]}`, changes);
    assert.equal(result.ok, false);
    assert.equal(result.why, why);
  }
  const humanResultAfter = owner.client.messages.length;
  await owner.client.send({ t: MSG.AGENT_INVENTORY, requestId: 'human-inventory', epoch: 1,
    sessionId: 'not-a-pilot-session' });
  const humanResult = await owner.client.waitFor((m) => owner.client.messages.indexOf(m) >= humanResultAfter &&
    m.t === MSG.AGENT_INVENTORY_RESULT && m.requestId === 'human-inventory');
  assert.equal(humanResult.ok, false);
  assert.equal(humanResult.why, 'forbidden');
  const noCapResult = await query(noCap, 'missing-capability');
  assert.equal(noCapResult.ok, false);
  assert.equal(noCapResult.why, 'forbidden');
  const noPilot = await room(t, { pilot: false });
  const legacyAgent = await connect(noPilot.url, 'agent-token', { agent: true });
  t.after(() => legacyAgent.client.close());
  const noPilotResult = await query(legacyAgent, 'pilot-disabled-inventory');
  assert.equal(noPilotResult.ok, false);
  assert.equal(noPilotResult.why, 'forbidden');
  assert.equal(noPilotResult.inventory, null);

  // A malformed, stale or foreign-scope request cannot consume or retrieve the successful cache row.
  const replay = await query(agent, 'scope-check', { sessionId: 'foreign-session' });
  assert.equal(replay.ok, false);
  assert.equal(replay.why, 'control_mismatch');
  const validReplay = await query(agent, 'scope-check');
  assert.equal(validReplay.ok, true);
  assert.equal(validReplay.replay, true);
});

test('busy profile gate denies reads without exposing inventory', { timeout: 15000 }, async (t) => {
  const { server, url } = await room(t);
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  const accountKey = server.game.profiles.clients.get(pilotSocket(server).id).key;
  const handle = pearlMutationGate(server.game.profiles).reserve({ accounts: [accountKey] });
  try {
    const denied = await query(agent, 'busy-inventory');
    assert.equal(denied.ok, false);
    assert.equal(denied.why, 'unavailable');
    assert.equal(denied.inventory, null);
  } finally {
    pearlMutationGate(server.game.profiles).release(handle);
  }
  const available = await query(agent, 'available-inventory');
  assert.equal(available.ok, true);
});

test('session budget caps distinct inventory reads at 64 while allowing duplicates', { timeout: 20000 }, async (t) => {
  const { url } = await room(t);
  const agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => agent.client.close());
  const first = await query(agent, 'budget-0');
  assert.equal(first.ok, true);
  for (let i = 1; i < 64; i++) {
    const result = await query(agent, `budget-${i}`);
    assert.equal(result.ok, true, `read ${i}: ${JSON.stringify(result)}`);
  }
  const duplicate = await query(agent, 'budget-0');
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.replay, true);
  const over = await query(agent, 'budget-64');
  assert.equal(over.ok, false);
  assert.equal(over.why, 'query_limit');
  assert.equal(over.inventory, null);
});

test('stop, death and reconnect retire old selectors; inventory reads and blocked commands have no simulation side effects',
  { timeout: 20000 }, async (t) => {
    const { server, url } = await room(t);
    const owner = await connect(url, 'owner-token');
    let agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); });
    assert.equal(agent.result.t, MSG.WELCOME);

    clearInterval(server.game.timer); server.game.timer = null;
    clearInterval(server.game.worldTimer); server.game.worldTimer = null;
    clearInterval(server.game.beat); server.game.beat = null;
    const world = server.game.server.world, entity = agent.result.you;
    const profile = world.profiles.get(entity), market = JSON.stringify(world.economy.serialize());
    const profileBefore = structuredClone(profile), tick = world.tick;
    world.events.length = 0;
    const beforeRead = await query(agent, 'read-no-side-effects');
    assert.equal(beforeRead.ok, true);
    assert.deepEqual(profile, profileBefore);
    assert.equal(JSON.stringify(world.economy.serialize()), market);
    assert.deepEqual(world.events, []);
    assert.equal(world.tick, tick);

    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER });
    await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.grant?.scope?.characterId === CHARACTER &&
      m.state.state !== 'active');
    const afterStop = await query(agent, 'after-stop');
    assert.equal(afterStop.ok, false);
    assert.equal(afterStop.why, 'control_mismatch');
    const stoppedReplay = await query(agent, 'read-no-side-effects');
    assert.equal(stoppedReplay.ok, false);
    assert.equal(stoppedReplay.why, 'control_mismatch');
    assert.equal(stoppedReplay.inventory, null);

    await owner.client.send({ t: MSG.AGENT_CONTROL, op: 'resume', characterId: CHARACTER });
    await owner.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.resumed === true);
    const retiredScope = agent.result.control.grant.scope;
    const retiredEpoch = agent.result.control.grant.controlRevision;
    agent.client.close();
    await until(() => !pilotSocket(server));
    let current = await connect(url, 'agent-token', { agent: true });
    assert.equal(current.result.t, MSG.WELCOME);
    assert.notEqual(current.result.control.grant.scope.sessionId, retiredScope.sessionId);
    const oldSelectors = await query(current, 'retired-selectors', { epoch: retiredEpoch, sessionId: retiredScope.sessionId });
    assert.equal(oldSelectors.ok, false);
    assert.equal(oldSelectors.why, 'control_mismatch');

    const ecs = server.game.server.world.ecs;
    ecs.hp[current.result.you] = 0;
    server.game.sweepAgentControl();
    await current.client.waitFor((m) => m.t === MSG.AGENT_STATE && m.state?.grant?.scope?.sessionId === current.result.control.grant.scope.sessionId &&
      m.state?.state !== 'active');
    const afterDeath = await query(current, 'after-death');
    assert.equal(afterDeath.ok, false);
    assert.equal(afterDeath.why, 'control_mismatch');

    current.client.close();
    await until(() => !pilotSocket(server));
    const old = await connect(url, 'agent-token', { agent: true });
    current = old;
    t.after(() => current.client.close());
    assert.equal(old.result.t, MSG.WELCOME);
    assert.notEqual(old.result.control.grant.scope.sessionId, retiredScope.sessionId);
    const fresh = await query(old, 'reconnected-fresh');
    assert.equal(fresh.ok, true);
    assert.equal(fresh.sessionId, old.result.control.grant.scope.sessionId);

    const currentEntity = old.result.you, currentProfile = world.profiles.get(currentEntity);
    const econBefore = JSON.stringify(world.economy.serialize()), stateBefore = structuredClone(currentProfile);
    const random = world.rng, lootRandom = world.lootRng;
    let randomCalls = 0, lootRandomCalls = 0;
    world.rng = () => { randomCalls++; return random(); };
    if (typeof lootRandom === 'function') world.lootRng = () => { lootRandomCalls++; return lootRandom(); };
    world.events.length = 0;
    await old.client.send({ t: MSG.CMD, type: 'commerce', cmd: 'commerce', op: 'buy', opId: 'blocked-buy',
      town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 });
    await query(old, 'read-after-blocked-command');
    assert.deepEqual(currentProfile, stateBefore);
    assert.equal(JSON.stringify(world.economy.serialize()), econBefore);
    assert.deepEqual(world.events, []);
    assert.equal(randomCalls, 0);
    assert.equal(lootRandomCalls, 0);
    assert.equal(server.game.status().errors, 0);
  });
