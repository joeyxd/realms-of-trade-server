import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { TOWNS } from '../src/data/towns.js';

const WORLD = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER_OWNER = '44444444-4444-4444-8444-444444444444';
const OTHER_CHARACTER = '55555555-5555-4555-8555-555555555555';
const BUDGET = '66666666-6666-4666-8666-666666666666';
const HOSTS = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const economyProfile = (profile) => ({ gold: profile.gold, eco: structuredClone(profile.eco) });

async function until(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('Timed out waiting for agent trade wire evidence');
}

class WireClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.drop = null;
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve); this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      try { const message = JSON.parse(data.toString()); if (!this.drop?.(message)) this.messages.push(message); } catch { /* malformed server frame */ }
    });
  }
  async send(message) { await this.opened; this.ws.send(JSON.stringify(message)); }
  async waitFor(predicate, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await sleep(10);
    }
    throw new Error(`Timed out waiting for agent trade response; last messages: ${JSON.stringify(this.messages.slice(-8))}`);
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function hello(token, { agent = false, name = 'Trade test' } = {}) {
  return { t: MSG.HELLO, v: PROTOCOL_VERSION, token, ...(agent ? { agent: true } : {}), name, skin: 0, weapon: 0 };
}

async function connect(url, token, options = {}) {
  const client = new WireClient(url);
  await client.send(hello(token, options));
  const result = await client.waitFor((m) => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t));
  return { client, result, server: HOSTS.get(url) };
}

const DEFAULT_CAPABILITIES = ['move', 'aim', 'attack_pve', 'body_pve', 'chat', 'inventory_read', 'market_read', 'trade_buy', 'trade_sell'];

async function room(t, { capabilities = DEFAULT_CAPABILITIES, store: suppliedStore, agentTrade = true, includeAgentTrade = true } = {}) {
  const store = suppliedStore || createMemoryStore();
  for (const [account, goods, gold] of [[CHARACTER, { fruta: 2 }, 1000], [OTHER_CHARACTER, { fruta: 2 }, 1000], [OWNER, {}, 1000], [OTHER_OWNER, {}, 1000]]) {
    const profile = newProfile(); profile.gold = gold; profile.pirateId = `account:${account}`; profile.eco.pack.goods = goods;
    await store.initializeProfile(account, profile);
  }
  const server = createGameServer({
    port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4,
    worldId: WORLD, saveSecret: 'agent-trade-ws-test-secret', store, initializeAccounts: true,
    resolvePlayer: async (_req, message) => ({
      'owner-token': OWNER, 'agent-token': CHARACTER,
      'other-owner-token': OTHER_OWNER, 'other-agent-token': OTHER_CHARACTER,
    })[message.token] ?? null,
    log() {}, economicOperations: true, ...(includeAgentTrade ? { agentTrade } : {}),
    agentControl: { worldId: WORLD, bindings: [
      { ownerId: OWNER, characterId: CHARACTER, capabilities },
      { ownerId: OTHER_OWNER, characterId: OTHER_CHARACTER, capabilities },
    ] },
    agentPilot: { maxAgents: 2 },
  });
  const port = await server.listen();
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await server.close(); };
  t.after(close);
  const url = `ws://127.0.0.1:${port}/ws`; HOSTS.set(url, server);
  return { server, store, url, close };
}

function pause(server) {
  clearInterval(server.game.timer); server.game.timer = null;
  clearInterval(server.game.worldTimer); server.game.worldTimer = null;
  clearInterval(server.game.beat); server.game.beat = null;
}

function locate(world, entity, town = 'aldea') {
  const target = TOWNS[town], point = world.map.landmarks[target.landmark] || world.map[target.landmark];
  world.ecs.x[entity] = point.x; world.ecs.z[entity] = point.z;
  world.ecs.y[entity] = world.map.groundAt(point.x, point.z);
  world.ecs.regenT[entity] = 100; world.ecs.moveMag[entity] = 0; world.ecs.vx[entity] = 0; world.ecs.vz[entity] = 0;
  world.ecs.dashT[entity] = -1; world.ecs.dashBuffer[entity] = 0; world.ecs.castK[entity] = 0;
  world.ecs.castLock[entity] = 0; world.ecs.atkStage[entity] = 0;
}

function tradeRequest(agent, opId, changes = {}) {
  const scope = agent.result.control.grant.scope;
  return { t: MSG.AGENT_TRADE, opId, epoch: agent.result.control.grant.controlRevision,
    sessionId: scope.sessionId, op: 'buy', ...changes };
}

async function trade(agent, opId, changes = {}) {
  const after = agent.client.messages.length;
  await agent.client.send(tradeRequest(agent, opId, changes));
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    agent.server.game.server.step();
    const found = agent.client.messages.find((m, i) => i >= after && m.t === MSG.AGENT_TRADE_RESULT && m.opId === opId);
    if (found) return found;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for trade ${opId}; authority=${JSON.stringify(agent.server.game.economicAuthority?.status())}; messages=${JSON.stringify(agent.client.messages.slice(-8))}`);
}

async function budget(owner, op, characterId = CHARACTER, changes = {}) {
  const after = owner.client.messages.length;
  await owner.client.send({ t: MSG.AGENT_GOODS_BUDGET, op, characterId, ...changes });
  return owner.client.waitFor((m) => owner.client.messages.indexOf(m) >= after &&
    m.t === MSG.AGENT_GOODS_BUDGET_RESULT && m.op === op && m.characterId === characterId);
}

async function createBudget(owner, characterId = CHARACTER, budgetId = BUDGET, limits = {
  buyGold: 10000, buyGoldPerTrade: 5000, sellUnits: { fruta: 2 }, sellUnitsPerTrade: 2,
}) {
  return budget(owner, 'create', characterId, { budgetId, limits });
}

function exactTradeResult(result) {
  assert.deepEqual(Object.keys(result).sort(),
    ['t', 'opId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'historical', 'receipt', 'budget'].sort());
}

test('authenticated owner budget debits only successful own-character buy and sell receipts', { timeout: 20000 }, async (t) => {
  const { server, url } = await room(t);
  const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
  t.after(() => { owner.client.close(); agent.client.close(); });
  assert.equal(owner.result.t, MSG.WELCOME); assert.equal(agent.result.t, MSG.WELCOME); pause(server);
  const made = await createBudget(owner);
  assert.equal(made.ok, true, JSON.stringify(made)); assert.equal(made.budget.enabled, true);
  const read = await budget(owner, 'read'); assert.deepEqual(read.budget, made.budget);

  const world = server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
  locate(world, entity, 'aldea');
  const beforeGold = profile.gold, beforeFruit = profile.eco.pack.goods.fruta;
  const buyTotal = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
  const bought = await trade(agent, 'aaaaaaaa-0000-4000-8000-000000000001', { op: 'buy', g: 'fruta', n: 1, expectedTotal: buyTotal });
  exactTradeResult(bought); assert.equal(bought.ok, true, JSON.stringify(bought));
  assert.deepEqual(Object.keys(bought.receipt).sort(), ['op', 'g', 'n', 'total', 'rev', 'ok', 'why'].sort());
  assert.equal(bought.receipt.op, 'buy'); assert.equal(bought.receipt.g, 'fruta');
  assert.equal(bought.receipt.n, 1); assert.equal(bought.receipt.total, buyTotal);
  assert.ok(Number.isSafeInteger(bought.receipt.rev)); assert.equal(bought.receipt.ok, true);
  assert.equal(profile.gold, beforeGold - buyTotal); assert.equal(profile.eco.pack.goods.fruta, beforeFruit + 1);
  assert.equal(bought.budget.buyGoldUsed, buyTotal); assert.equal(bought.budget.sellUnitsUsed.fruta ?? 0, 0);

  const changedDuplicate = await trade(agent, 'aaaaaaaa-0000-4000-8000-000000000001',
    { op: 'buy', g: 'fruta', n: 2, expectedTotal: buyTotal * 2 });
  assert.equal(changedDuplicate.ok, false); assert.equal(changedDuplicate.why, 'duplicate');
  assert.equal(changedDuplicate.receipt, null, 'one immutable operation ID cannot be reused with a changed body');
  assert.equal(profile.gold, beforeGold - buyTotal); assert.equal(profile.eco.pack.goods.fruta, beforeFruit + 1);
  assert.equal(changedDuplicate.budget, null);

  const sellTotal = world.economy.quote('aldea', 'fruta', 1, 'sell').total;
  const sold = await trade(agent, 'aaaaaaaa-0000-4000-8000-000000000002', { op: 'sell', g: 'fruta', n: 1, expectedTotal: sellTotal });
  assert.equal(sold.ok, true, JSON.stringify(sold)); assert.equal(profile.eco.pack.goods.fruta, beforeFruit);
  assert.equal(profile.gold, beforeGold - buyTotal + sellTotal);
  assert.equal(sold.budget.buyGoldUsed, buyTotal); assert.equal(sold.budget.sellUnitsUsed.fruta, 1);

  locate(world, entity, 'cala');
  const aldeaGalleta = world.economy.quote('aldea', 'galleta', 1, 'buy').total;
  const calaTotal = world.economy.quote('cala', 'galleta', 1, 'buy').total;
  assert.notEqual(calaTotal, aldeaGalleta, 'fixture markets have town-specific prices for the same good');
  const calaBuy = await trade(agent, 'aaaaaaaa-0000-4000-8000-000000000004',
    { op: 'buy', g: 'galleta', n: 1, expectedTotal: calaTotal });
  assert.equal(calaBuy.ok, true, JSON.stringify(calaBuy));
  assert.equal(calaBuy.receipt.total, calaTotal);
  assert.equal(calaBuy.budget.buyGoldUsed, buyTotal + calaTotal,
    'the host prices the operation at the agent’s current town, derived from position');

  const otherAgent = await connect(url, 'other-agent-token', { agent: true });
  t.after(() => otherAgent.client.close()); locate(world, otherAgent.result.you, 'aldea');
  const foreign = await trade(otherAgent, 'aaaaaaaa-0000-4000-8000-000000000003', { op: 'buy', g: 'fruta', n: 1, expectedTotal: buyTotal });
  assert.equal(foreign.ok, false, 'another owner’s character cannot spend this owner budget');
  assert.equal(foreign.receipt, null); assert.equal(foreign.budget, null);
});

test('trade lane is opt-in, capability-gated, exact-schema, location-bound, and generic commerce CMD stays blocked',
  { timeout: 20000 }, async (t) => {
    const { server, store, url } = await room(t);
    const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
    const deniedRoom = await room(t, { capabilities: ['move', 'aim'] });
    const noCapability = await connect(deniedRoom.url, 'agent-token', { agent: true });
    const otherOwner = await connect(url, 'other-owner-token');
    const disabledRoom = await room(t, { includeAgentTrade: false });
    const disabled = await connect(disabledRoom.url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); otherOwner.client.close(); noCapability.client.close(); disabled.client.close(); });
    pause(server); pause(deniedRoom.server); pause(disabledRoom.server);
    const world = server.game.server.world, entity = agent.result.you; locate(world, entity, 'aldea');
    const profile = world.profiles.get(entity), before = economyProfile(profile), markets = structuredClone(world.economy.serialize().markets);
    const total = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    for (const [opId, fields] of [
      ['bbbbbbbb-0000-4000-8000-000000000001', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total, town: 'cala' }],
      ['bbbbbbbb-0000-4000-8000-000000000002', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total, characterId: CHARACTER }],
      ['bbbbbbbb-0000-4000-8000-000000000003', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total, extra: true }],
    ]) {
      const result = await trade(agent, opId, fields);
      assert.equal(result.ok, false); assert.equal(result.why, 'command');
    }
    const noBudget = await trade(agent, 'bbbbbbbb-0000-4000-8000-000000000004', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total });
    assert.equal(noBudget.ok, false); assert.equal(noBudget.why, 'budget');
    assert.deepEqual(economyProfile(profile), before); assert.deepEqual(world.economy.serialize().markets, markets);
    assert.equal(await store.loadEconomicOperation(economicOperationId(WORLD, CHARACTER,
      'bbbbbbbb-0000-4000-8000-000000000004')), null, 'budget denial creates no durable economic receipt');

    const made = await createBudget(owner); assert.equal(made.ok, true);
    const foreignCreate = await createBudget(otherOwner, CHARACTER, 'abababab-abab-4bab-8bab-abababababab');
    assert.equal(foreignCreate.ok, false, 'a different authenticated owner cannot create this character budget');
    const foreignRevoke = await budget(otherOwner, 'revoke', CHARACTER, { budgetId: BUDGET });
    assert.equal(foreignRevoke.ok, false, 'a different authenticated owner cannot revoke this character budget');

    await agent.client.send({ t: MSG.CMD, type: 'commerce', op: 'buy', town: 'aldea', g: 'fruta', n: 1,
      expectedTotal: total, opId: 'generic-agent-buy' });
    await sleep(100);
    assert.deepEqual(economyProfile(profile), before); assert.deepEqual(world.economy.serialize().markets, markets);
    const denied = await trade(noCapability, 'bbbbbbbb-0000-4000-8000-000000000005', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total });
    assert.equal(denied.ok, false); assert.equal(denied.why, 'forbidden');
    const off = await trade(disabled, 'bbbbbbbb-0000-4000-8000-000000000006', { op: 'buy', g: 'fruta', n: 1, expectedTotal: total });
    assert.equal(off.ok, false); assert.equal(off.why, 'forbidden');
  });

test('agent-trade readiness checks required store operations before world open or admission',
  { timeout: 20000 }, async () => {
    const options = (store) => ({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4,
      worldId: WORLD, saveSecret: 'agent-trade-readiness-test-secret', store,
      resolvePlayer: async () => null, log() {}, economicOperations: true, agentTrade: true,
      agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: DEFAULT_CAPABILITIES }] },
      agentPilot: { maxAgents: 1 } });

    const missing = createMemoryStore();
    delete missing.checkAgentTradeOperations;
    assert.throws(() => createGameServer(options(missing)), /configuration/,
      'a store without the required migration readiness API is rejected during host construction');

    for (const [label, check] of [
      ['version mismatch', async () => ({ version: 2 })],
      ['readiness error', async () => { throw new Error('migration probe failed'); }],
    ]) {
      const base = createMemoryStore(); let loadWorldCalls = 0;
      const store = { ...base, checkAgentTradeOperations: check,
        async loadWorld(...args) { loadWorldCalls++; return base.loadWorld(...args); } };
      const gameServer = createGameServer(options(store));
      try {
        await assert.rejects(gameServer.listen(), /configuration|migration probe failed/, label);
        assert.equal(loadWorldCalls, 0, `${label}: world storage must not open before migration readiness`);
        assert.equal(gameServer.game.worldState.ready, false, `${label}: world remains unready`);
        assert.equal(gameServer.game.server.clients.size, 0, `${label}: no client can be admitted`);
      } finally { await gameServer.close(); }
    }
  });

test('response-lost receipt replays after same-store host restart and agent reentry without a second debit',
  { timeout: 25000 }, async (t) => {
    const first = await room(t);
    const owner = await connect(first.url, 'owner-token'), agent = await connect(first.url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); }); pause(first.server);
    assert.equal((await createBudget(owner)).ok, true);
    const world = first.server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
    locate(world, entity, 'aldea');
    const amount = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const opId = 'eeeeeeee-0000-4000-8000-000000000001';
    const command = tradeRequest(agent, opId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: amount });
    agent.client.drop = (m) => m.t === MSG.AGENT_TRADE_RESULT && m.opId === opId;
    await agent.client.send(command);
    const operationId = economicOperationId(WORLD, CHARACTER, opId);
    await until(() => { first.server.game.server.step(); return first.server.game.economicAuthority.status().completed === 1; });
    const receipt = await first.store.loadAgentTradeOperation(operationId);
    assert.equal(receipt.result.ack.ok, true);
    assert.equal(agent.client.messages.some((m) => m.t === MSG.AGENT_TRADE_RESULT && m.opId === opId), false,
      'the test client deliberately loses the committed response');
    assert.equal(profile.gold, 1000 - amount);
    agent.client.close();
    await until(() => ![...first.server.game.sockets.values()].some((sock) => sock.agentIdentity === CHARACTER));
    await first.close();

    const restarted = await room(t, { store: first.store });
    const owner2 = await connect(restarted.url, 'owner-token'), agent2 = await connect(restarted.url, 'agent-token', { agent: true });
    t.after(() => { owner2.client.close(); agent2.client.close(); }); pause(restarted.server);
    assert.equal(agent2.result.t, MSG.WELCOME);
    assert.notEqual(agent2.result.control.grant.scope.sessionId, agent.result.control.grant.scope.sessionId);
    const entity2 = agent2.result.you, profile2 = restarted.server.game.server.world.profiles.get(entity2);
    locate(restarted.server.game.server.world, entity2, 'aldea');
    const before = economyProfile(profile2), markets = structuredClone(restarted.server.game.server.world.economy.serialize().markets);
    const replay = await trade(agent2, opId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: amount });
    assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.replay, true); assert.equal(replay.historical, true);
    assert.deepEqual(economyProfile(profile2), before); assert.deepEqual(restarted.server.game.server.world.economy.serialize().markets, markets);
    assert.equal(replay.budget.buyGoldUsed, amount, 'the allowance remains charged once across restart/reentry');
    const ownerState = await budget(owner2, 'read'); assert.equal(ownerState.budget.buyGoldUsed, amount);
  });

test('historical receipt with a different budget identity is rejected instead of replayed',
  { timeout: 20000 }, async (t) => {
    const base = createMemoryStore(); let mismatchBudget = false;
    const store = { ...base, async loadAgentTradeOperation(operationId) {
      const receipt = await base.loadAgentTradeOperation(operationId);
      return mismatchBudget && receipt ? { ...receipt, budgetId: 'abababab-abab-4bab-8bab-abababababab' } : receipt;
    } };
    const { server, store: wiredStore, url } = await room(t, { store });
    assert.equal(wiredStore, store);
    const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); }); pause(server);
    assert.equal((await createBudget(owner)).ok, true);
    const world = server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
    locate(world, entity, 'aldea');
    const opId = 'abababab-0000-4000-8000-000000000001';
    const amount = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const committed = await trade(agent, opId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: amount });
    assert.equal(committed.ok, true, JSON.stringify(committed));
    const afterCommit = economyProfile(profile), marketsAfterCommit = structuredClone(world.economy.serialize().markets);

    mismatchBudget = true;
    const replay = await trade(agent, opId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: amount });
    assert.equal(replay.ok, false); assert.equal(replay.why, 'duplicate');
    assert.equal(replay.receipt, null, 'budget identity mismatch must not expose a replayable receipt');
    assert.deepEqual(economyProfile(profile), afterCommit);
    assert.deepEqual(world.economy.serialize().markets, marketsAfterCommit);
    assert.equal((await budget(owner, 'read')).budget.buyGoldUsed, amount,
      'the mismatch neither adds nor removes allowance debit evidence');
  });

test('zero spend and sell caps fail before EconomicAuthority writes while commerce failures keep zero-cost receipts',
  { timeout: 20000 }, async (t) => {
    const { server, store, url } = await room(t);
    const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
    const otherOwner = await connect(url, 'other-owner-token'), otherAgent = await connect(url, 'other-agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); otherOwner.client.close(); otherAgent.client.close(); }); pause(server);
    const limits = { buyGold: 0, buyGoldPerTrade: 0, sellUnits: { fruta: 0 }, sellUnitsPerTrade: 0 };
    const created = await createBudget(owner, CHARACTER, '77777777-7777-4777-8777-777777777777', limits);
    assert.equal(created.ok, true, JSON.stringify(created));
    const world = server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
    locate(world, entity, 'aldea');
    const before = economyProfile(profile), markets = structuredClone(world.economy.serialize().markets);
    for (const [opId, op, total] of [
      ['cccccccc-0000-4000-8000-000000000001', 'buy', world.economy.quote('aldea', 'fruta', 1, 'buy').total],
      ['cccccccc-0000-4000-8000-000000000002', 'sell', world.economy.quote('aldea', 'fruta', 1, 'sell').total],
    ]) {
      const result = await trade(agent, opId, { op, g: 'fruta', n: 1, expectedTotal: total });
      assert.equal(result.ok, false); assert.equal(result.receipt, null);
      assert.equal(await store.loadEconomicOperation(economicOperationId(WORLD, CHARACTER, opId)), null);
    }
    assert.deepEqual(economyProfile(profile), before); assert.deepEqual(world.economy.serialize().markets, markets);

    const normalBudget = await createBudget(otherOwner, OTHER_CHARACTER, '88888888-8888-4888-8888-888888888888');
    assert.equal(normalBudget.ok, true, JSON.stringify(normalBudget));
    const otherEntity = otherAgent.result.you, otherProfile = world.profiles.get(otherEntity);
    locate(world, otherEntity, 'aldea');
    const priced = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const beforeDenied = economyProfile(otherProfile), beforeDeniedMarkets = structuredClone(world.economy.serialize().markets);
    const deniedId = 'cccccccc-0000-4000-8000-000000000003';
    const denied = await trade(otherAgent, deniedId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: priced + 1 });
    assert.equal(denied.ok, false); assert.ok(denied.receipt, 'ordinary commerce denial has a durable economic receipt');
    assert.equal(denied.receipt.ok, false);
    const persisted = await store.loadAgentTradeOperation(economicOperationId(WORLD, OTHER_CHARACTER, deniedId));
    assert.ok(persisted); assert.equal(persisted.result.ack.ok, false);
    assert.deepEqual(economyProfile(otherProfile), beforeDenied);
    assert.deepEqual(world.economy.serialize().markets, beforeDeniedMarkets);
    const afterBudget = await budget(otherOwner, 'read', OTHER_CHARACTER);
    assert.equal(afterBudget.budget.buyGoldUsed, 0); assert.deepEqual(afterBudget.budget.sellUnitsUsed, {});
  });

test('full pack and empty market are durable zero-cost denials; dead and navigation-locked agents cannot trade',
  { timeout: 20000 }, async (t) => {
    const { server, store, url } = await room(t);
    const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); }); pause(server);
    assert.equal((await createBudget(owner)).ok, true);
    const world = server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
    locate(world, entity, 'aldea');
    const marketBefore = structuredClone(world.economy.serialize().markets), goldBefore = profile.gold;

    profile.eco.pack.goods = { fruta: profile.eco.pack.cap };
    const fullId = 'cacacaca-0000-4000-8000-000000000001';
    const fruitPrice = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const full = await trade(agent, fullId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: fruitPrice });
    assert.equal(full.ok, false); assert.equal(full.receipt?.why, 'room');
    assert.ok(await store.loadAgentTradeOperation(economicOperationId(WORLD, CHARACTER, fullId)));
    assert.equal(profile.gold, goldBefore); assert.deepEqual(world.economy.serialize().markets, marketBefore);
    assert.equal((await budget(owner, 'read')).budget.buyGoldUsed, 0);

    profile.eco.pack.goods = {};
    world.economy.markets.aldea.stock.galleta = 0;
    const stockBefore = structuredClone(world.economy.serialize().markets), stockId = 'cacacaca-0000-4000-8000-000000000002';
    const noStock = await trade(agent, stockId, { op: 'buy', g: 'galleta', n: 1, expectedTotal: 0 });
    assert.equal(noStock.ok, false); assert.equal(noStock.receipt?.ok, false);
    assert.ok(await store.loadAgentTradeOperation(economicOperationId(WORLD, CHARACTER, stockId)));
    assert.equal(profile.gold, goldBefore); assert.deepEqual(world.economy.serialize().markets, stockBefore);
    assert.equal((await budget(owner, 'read')).budget.buyGoldUsed, 0);

    const quote = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const originalLocked = world.navalPilot.locked;
    world.navalPilot.locked = () => true;
    const lockedId = 'cacacaca-0000-4000-8000-000000000003';
    const locked = await trade(agent, lockedId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: quote });
    assert.equal(locked.ok, false); assert.equal(locked.why, 'busy'); assert.equal(locked.receipt, null);
    assert.equal(await store.loadAgentTradeOperation(economicOperationId(WORLD, CHARACTER, lockedId)), null);
    world.navalPilot.locked = originalLocked;

    world.ecs.hp[entity] = 0;
    const deadId = 'cacacaca-0000-4000-8000-000000000004';
    const dead = await trade(agent, deadId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: quote });
    assert.equal(dead.ok, false); assert.ok(['dead', 'stale_session'].includes(dead.why), `unexpected death denial: ${dead.why}`);
    assert.equal(dead.receipt, null);
    assert.equal(await store.loadAgentTradeOperation(economicOperationId(WORLD, CHARACTER, deadId)), null);
    assert.equal(profile.gold, goldBefore);
  });

test('revocation during preparation aborts before write; revocation after durable dispatch preserves the accepted commit',
  { timeout: 20000 }, async (t) => {
    const base = createMemoryStore();
    let releaseLoad, enterLoad; const loadGate = new Promise(r => { releaseLoad = r; }), loadEntered = new Promise(r => { enterLoad = r; });
    let holdLoad = true;
    const store = { ...base, async loadAgentGoodsBudget(input) {
      const snapshot = await base.loadAgentGoodsBudget(input);
      if (holdLoad) { holdLoad = false; enterLoad(); await loadGate; }
      return snapshot;
    } };
    const { server, url } = await room(t, { store });
    const owner = await connect(url, 'owner-token'), agent = await connect(url, 'agent-token', { agent: true });
    const otherOwner = await connect(url, 'other-owner-token'), otherAgent = await connect(url, 'other-agent-token', { agent: true });
    t.after(() => { owner.client.close(); agent.client.close(); otherOwner.client.close(); otherAgent.client.close(); }); pause(server);
    const made = await createBudget(owner); assert.equal(made.ok, true, JSON.stringify(made));
    const world = server.game.server.world, entity = agent.result.you, profile = world.profiles.get(entity);
    locate(world, entity, 'aldea');
    const before = economyProfile(profile), quote = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const precommitId = 'dddddddd-0000-4000-8000-000000000001';
    const precommit = trade(agent, precommitId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: quote });
    await loadEntered;
    const revoked = await budget(owner, 'revoke', CHARACTER, { budgetId: BUDGET });
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
    releaseLoad();
    const denied = await precommit;
    assert.equal(denied.ok, false); assert.equal(denied.receipt, null);
    assert.equal(await base.loadAgentTradeOperation(economicOperationId(WORLD, CHARACTER, precommitId)), null);
    assert.deepEqual(economyProfile(profile), before);

    const otherBudgetId = '99999999-9999-4999-8999-999999999999';
    const otherBudget = await createBudget(otherOwner, OTHER_CHARACTER, otherBudgetId);
    assert.equal(otherBudget.ok, true, JSON.stringify(otherBudget));
    const otherProfile = world.profiles.get(otherAgent.result.you); locate(world, otherAgent.result.you, 'aldea');
    const otherBefore = structuredClone(otherProfile), otherQuote = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    let releaseCommit, enterCommit; const commitGate = new Promise(r => { releaseCommit = r; }), commitEntered = new Promise(r => { enterCommit = r; });
    store.commitAgentTrade = async (input) => {
      const result = await base.commitAgentTrade(input); // the atomic durable commit has completed
      enterCommit(); await commitGate; return result;
    };
    const dispatchedId = 'dddddddd-0000-4000-8000-000000000002';
    const dispatched = trade(otherAgent, dispatchedId, { op: 'buy', g: 'fruta', n: 1, expectedTotal: otherQuote });
    await commitEntered;
    const postDispatchRevoke = await budget(otherOwner, 'revoke', OTHER_CHARACTER, { budgetId: otherBudgetId });
    assert.equal(postDispatchRevoke.ok, true, JSON.stringify(postDispatchRevoke));
    releaseCommit();
    const committed = await dispatched;
    assert.equal(committed.ok, true, JSON.stringify(committed));
    assert.equal(otherProfile.gold, otherBefore.gold - otherQuote);
    assert.equal(committed.budget.buyGoldUsed, otherQuote);
    assert.equal((await budget(otherOwner, 'read', OTHER_CHARACTER)).budget.enabled, false);
  });
