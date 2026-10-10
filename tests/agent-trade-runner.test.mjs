import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { TOWNS } from '../src/data/towns.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';

const WORLD = 'agent-trade-runner-world';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const BUDGET = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'agent-trade-runner-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = check(); if (value) return value; await sleep(10); }
  assert.fail(`${label} timeout`);
}
function placeInAldea(world, entity) {
  const town = TOWNS.aldea, point = world.map.landmarks[town.landmark] || world.map[town.landmark];
  world.ecs.x[entity] = point.x; world.ecs.z[entity] = point.z;
  world.ecs.y[entity] = world.map.groundAt(point.x, point.z);
  Object.assign(world.ecs.regenT, { [entity]: 100 });
  for (const field of ['moveMag', 'vx', 'vz', 'dashBuffer', 'castK', 'castLock', 'atkStage']) world.ecs[field][entity] = 0;
  world.ecs.dashT[entity] = -1;
}

test('managed runner trades explicitly, clears current reads on confirmed spend, and recovers a lost durable receipt after reentry',
  { timeout: 40000 }, async (t) => {
    const store = createMemoryStore(), profile = newProfile();
    profile.gold = 1000; profile.pirateId = `account:${CHARACTER}`;
    await store.initializeProfile(CHARACTER, profile);
    await store.initializeProfile(OWNER, Object.assign(newProfile(), { pirateId: `account:${OWNER}` }));
    await store.createAgentGoodsBudget({ world: WORLD, ownerId: OWNER, characterId: CHARACTER, budgetId: BUDGET,
      limits: { buyGold: 1000, buyGoldPerTrade: 500, sellUnits: { fruta: 5 }, sellUnitsPerTrade: 5 } });
    const capabilities = ['move', 'inventory_read', 'market_read', 'trade_buy', 'trade_sell'];
    const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 2,
      worldId: WORLD, saveSecret: 'agent-trade-runner-fixture', store, economicOperations: true,
      resolvePlayer: async (_req, message) => message.token === TOKEN ? CHARACTER : null,
      agentControl: { worldId: WORLD, ttlMs: 60000,
        bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities }] },
      agentPilot: { maxAgents: 1 }, agentTrade: true, log() {} });
    const port = await server.listen();
    const sentTradeResults = [], initialSend = server.game.sendTo.bind(server.game);
    let injectOldDespawnOnNextWelcome = false;
    const injectedOldDespawns = [];
    server.game.sendTo = (id, message) => {
      if (message.t === MSG.AGENT_TRADE_RESULT) sentTradeResults.push(structuredClone(message));
      const result = initialSend(id, message);
      if (injectOldDespawnOnNextWelcome && message.t === MSG.WELCOME) {
        injectOldDespawnOnNextWelcome = false;
        const stale = { t: MSG.DESPAWN, id: entity };
        injectedOldDespawns.push({ targetId: id, entityId: entity, oldSessionId: sock.agentSessionId,
          afterWelcome: true, projected: !!server.game.sockets.get(id)?.agentView });
        server.game.sendTo(id, stale);
      }
      return result;
    };
    const tradeFeedback = [];
    const runner = new AgentNetworkRunner({ url: `ws://127.0.0.1:${port}/ws`, authorization: { token: TOKEN },
      onFeedback: (event) => { if (event.type.startsWith('trade_') || ['authority', 'stopped', 'admitted'].includes(event.type)) tradeFeedback.push(event); },
      tradeTimeoutMs: 5000, grant: { v: 1, scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'placeholder' },
        controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities } });
    t.after(async () => { runner.close(); await runner.waitClosed(3000); await server.close(); });
    await runner.connect();
    const host = server.game, sock = await until(() => [...host.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER), 'agent socket');
    const entity = host.server.clients.get(sock.id).entity, world = host.server.world, liveProfile = world.profiles.get(entity);
    placeInAldea(world, entity);
    await until(() => runner.observation?.source === 'server' && runner.tradeState.available,
      `active trade grant and current observation (${JSON.stringify({ state: runner.state, grant: runner.grant, authority: runner.authority, trade: runner.tradeState, observation: runner.observation })})`);

    const inventoryId = 'trade-inventory-before';
    runner.readInventory({ v: 1, requestId: inventoryId, scope: runner.grant.scope,
      controlRevision: runner.grant.controlRevision });
    await until(() => runner.inventoryRequests.some((entry) => entry.requestId === inventoryId && entry.state === 'completed'), 'inventory read');
    const marketId = 'trade-market-before';
    runner.readMarket({ v: 1, requestId: marketId, scope: runner.grant.scope,
      controlRevision: runner.grant.controlRevision, op: 'list' });
    await until(() => runner.marketRequests.some((entry) => entry.requestId === marketId && entry.state === 'completed'), 'market read');
    assert.equal(runner.inventory.fresh, true); assert.equal(runner.market.fresh, true);

    placeInAldea(world, entity);
    const firstTotal = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    const first = runner.trade({ opId: 'runner-buy-1', op: 'buy', g: 'fruta', n: 1, expectedTotal: firstTotal });
    assert.equal(first.ok, true); assert.equal(Object.hasOwn(first.operation.body, 'town'), false);
    const firstOperation = await until(() => {
      const entry = runner.tradeOperations.find((candidate) => candidate.opId === 'runner-buy-1');
      return entry && ['completed', 'rejected', 'uncertain'].includes(entry.state) ? entry : null;
    }, 'first durable trade result');
    assert.equal(firstOperation.state, 'completed', JSON.stringify({ operation: firstOperation, tradeFeedback, sentTradeResults,
      economic: server.game.economicAuthority?.status(), budget: await store.loadAgentGoodsBudget({ world: WORLD, ownerId: OWNER, characterId: CHARACTER }) }));
    assert.equal(runner.tradeOperations[0].result.receipt.total, firstTotal);
    assert.equal(runner.inventory.inventory, null, 'confirmed spend retires the prior inventory snapshot');
    assert.equal(runner.market.market, null, 'confirmed spend retires the prior market snapshot');
    assert.equal(runner.tradeState.fresh, true);
    const goldAfterFirst = liveProfile.gold;

    const originalSend = host.sendTo.bind(host); let drop = true;
    host.sendTo = (id, message) => {
      if (drop && message.t === MSG.AGENT_TRADE_RESULT && message.opId === 'runner-buy-lost') { drop = false; return; }
      return originalSend(id, message);
    };
    const retryTotal = world.economy.quote('aldea', 'fruta', 1, 'buy').total;
    placeInAldea(world, entity);
    runner.trade({ opId: 'runner-buy-lost', op: 'buy', g: 'fruta', n: 1, expectedTotal: retryTotal });
    await until(() => runner.tradeOperations.find((entry) => entry.opId === 'runner-buy-lost')?.state === 'uncertain', 'lost response becomes uncertain');
    assert.equal(liveProfile.gold, goldAfterFirst - retryTotal, 'server committed before the response was lost');
    assert.equal(runner.stop(OWNER).ok, true);
    await until(() => runner.state === 'stopped', 'runner stop before recovery');
    injectOldDespawnOnNextWelcome = true;
    const reentered = await runner.reenter(OWNER);
    assert.deepEqual(injectedOldDespawns, [{ targetId: [...host.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER)?.id,
      entityId: entity, oldSessionId: sock.agentSessionId, afterWelcome: true, projected: true }],
    'the old-life self-despawn was injected after reentry WELCOME through the managed-agent projector');
    assert.equal(reentered.ok, true, JSON.stringify({ reentered, tradeFeedback, health: server.game.healthy(), sockets: server.game.sockets.size }));
    assert.notEqual(runner.grant.scope.sessionId, sock.agentSessionId);
    await until(() => runner.tradeState.available && runner.observation?.source === 'server', 'fresh trade session');
    const recovered = runner.trade({ opId: 'runner-buy-lost', op: 'buy', g: 'fruta', n: 1, expectedTotal: retryTotal });
    assert.equal(recovered.ok, true); assert.equal(recovered.replay, false, 'recovery is sent again, not locally synthesized');
    await until(() => runner.tradeOperations.find((entry) => entry.opId === 'runner-buy-lost')?.state === 'completed', 'historical durable receipt');
    const operation = runner.tradeOperations.find((entry) => entry.opId === 'runner-buy-lost');
    assert.equal(operation.result.historical, true);
    assert.equal(liveProfile.gold, goldAfterFirst - retryTotal, 'durable replay does not charge twice');
    assert.equal(runner.tradeState.budget, null, 'historical replay cannot hydrate a fresh budget view');
  });
