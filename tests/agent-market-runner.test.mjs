import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG } from '../src/net/protocol.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';

const copy = (value) => structuredClone(value);
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const WORLD = 'agent-market-runner';

async function until(predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} timeout`);
}

async function ownerFiles(directory, scope) {
  await writeFile(join(directory, 'personality.md'), 'Brisa observa el mercado con calma.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1,
    scope: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId }, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  return loadOwnerFiles({ directory, scope: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId } });
}

function readQuery(runner, requestId, op = 'list', fields = {}) {
  return { v: 1, requestId, scope: copy(runner.grant.scope), controlRevision: runner.grant.controlRevision,
    op, ...fields };
}
function inventoryQuery(runner, requestId) {
  return { v: 1, requestId, scope: copy(runner.grant.scope), controlRevision: runner.grant.controlRevision };
}

async function waitForRead(runner, ledger, requestId, label) {
  const request = await until(() => {
    const request = runner[ledger].find((entry) => entry.requestId === requestId);
    return request && ['completed', 'rejected', 'uncertain'].includes(request.state) ? request : null;
  }, label);
  assert.notEqual(request.state, 'uncertain', `${label} became uncertain: ${JSON.stringify(request)}`);
  return request;
}

test('managed runner reads live market and inventory, ages views, and fences stop/reentry results',
  { timeout: 30000 }, async (t) => {
    const capabilities = ['move', 'inventory_read', 'market_read'];
    const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, seed: 42, maxPlayers: 2,
      worldId: WORLD, store: createMemoryStore(), saveSecret: 'market-runner-fixture-only', log() {},
      resolvePlayer: async (_req, msg) => msg.token === 'market-fixture' ? CHARACTER : null,
      agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities }] },
      agentPilot: { maxAgents: 1 } });
    const port = await server.listen();

    const wireMarket = [], wireInventory = [], wireResults = [];
    const host = server.game;
    const marketMessage = host.agentMarketMessage.bind(host), inventoryMessage = host.agentInventoryMessage.bind(host),
      sendTo = host.sendTo.bind(host);
    host.agentMarketMessage = (sock, message) => { wireMarket.push(copy(message)); return marketMessage(sock, message); };
    host.agentInventoryMessage = (sock, message) => { wireInventory.push(copy(message)); return inventoryMessage(sock, message); };
    host.sendTo = (id, message) => {
      if (message.t === MSG.AGENT_INVENTORY_RESULT || message.t === MSG.AGENT_MARKET_RESULT) wireResults.push(copy(message));
      return sendTo(id, message);
    };

    const runner = new AgentNetworkRunner({ url: `ws://127.0.0.1:${port}/ws`, name: 'Brisa [IA]',
      authorization: { token: 'market-fixture' }, grant: { v: 1,
        scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'placeholder' },
        controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities } });
    t.after(async () => { runner.close(); await runner.waitClosed(3000); await server.close(); });
    await runner.connect();

    const socket = await until(() => [...host.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER), 'agent socket');
    const entity = host.server.clients.get(socket.id).entity;
    const world = host.server.world, landmark = world.map.landmarks.village;
    world.ecs.x[entity] = landmark.x; world.ecs.z[entity] = landmark.z;
    world.profiles.get(entity).gold = 73;
    await until(() => runner.observation?.source === 'server' &&
      Math.hypot(runner.observation.confirmed.self.position.x - landmark.x,
        runner.observation.confirmed.self.position.z - landmark.z) < 1 && runner.market.available,
    'fresh observation and active market authority');

    const oldScope = copy(runner.grant.scope), oldEpoch = runner.grant.controlRevision;
    const inventoryId = 'runner-inventory-first';
    assert.equal(runner.readInventory(inventoryQuery(runner, inventoryId)).ok, true);
    const inventoryRequest = await waitForRead(runner, 'inventoryRequests', inventoryId, 'first inventory read');
    assert.equal(inventoryRequest.result.ok, true);
    assert.equal(runner.inventory.inventory.gold, 73);

    const listId = 'runner-market-list';
    const listQuery = readQuery(runner, listId);
    assert.equal(runner.readMarket(listQuery).ok, true);
    const listRequest = await waitForRead(runner, 'marketRequests', listId, 'market list');
    assert.equal(listRequest.result.ok, true);
    assert.deepEqual(wireMarket.at(-1), { t: MSG.AGENT_MARKET, requestId: listId, epoch: oldEpoch,
      sessionId: oldScope.sessionId, op: 'list' }, 'wire uses only the authenticated session and the scoped local query identifiers');
    assert.equal(listQuery.scope.sessionId, wireMarket.at(-1).sessionId);
    assert.equal(listQuery.controlRevision, wireMarket.at(-1).epoch);
    assert.equal(Object.hasOwn(wireMarket.at(-1), 'town'), false);

    const quoteId = 'runner-market-quote';
    const quoteQuery = readQuery(runner, quoteId, 'quote', { g: 'madera', n: 3, side: 'buy' });
    assert.equal(runner.readMarket(quoteQuery).ok, true);
    const quoteRequest = await waitForRead(runner, 'marketRequests', quoteId, 'market quote');
    assert.equal(quoteRequest.result.ok, true);
    assert.deepEqual(wireMarket.at(-1), { t: MSG.AGENT_MARKET, requestId: quoteId, epoch: oldEpoch,
      sessionId: oldScope.sessionId, op: 'quote', g: 'madera', n: 3, side: 'buy' });
    assert.deepEqual(runner.market.market, quoteRequest.result.market);

    const directory = await mkdtemp(join(tmpdir(), 'agent-market-runner-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const files = await ownerFiles(directory, oldScope);
    let snapshot = runnerMindSnapshot(runner, files);
    assert.equal(snapshot.required.tools.economy.inventory.inventory.gold, 73);
    assert.deepEqual(snapshot.required.tools.economy.market.market, quoteRequest.result.market);
    assert.equal(Object.hasOwn(snapshot.required.tools.economy, 'marketRequests'), false);
    assert.equal(Object.hasOwn(snapshot.required, 'marketRequests'), false, 'the inference snapshot includes views but no request ledger');

    const priorMarketTime = runner.market.receivedAtMs, priorMarketTick = runner.market.tick;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(runner.market.fresh, true, 'ordinary newer snapshots retain a recent market view');
    assert.equal(runner.market.receivedAtMs, priorMarketTime);
    assert.equal(runner.market.tick, priorMarketTick);
    snapshot = runnerMindSnapshot(runner, files);
    assert.deepEqual(snapshot.required.tools.economy.market.market, quoteRequest.result.market);

    clearInterval(host.timer); clearInterval(host.worldTimer); clearInterval(host.beat);
    host.timer = host.worldTimer = host.beat = null;
    await new Promise((resolve) => setTimeout(resolve, 1550));
    assert.equal(runner.market.fresh, false);
    assert.equal(runner.market.market, null);
    assert.equal(runner.inventory.inventory, null);
    snapshot = runnerMindSnapshot(runner, files);
    assert.equal(snapshot.required.tools.economy, undefined, 'expired views leave the inference boundary');
    host.start();
    await until(() => runner.observation.receivedAtMs > priorMarketTime && runner.market.available,
      'fresh observations after host timer resumes');

    const freshQuoteId = 'runner-market-fresh-quote';
    assert.equal(runner.readMarket(readQuery(runner, freshQuoteId, 'quote', { g: 'madera', n: 1, side: 'sell' })).ok, true);
    assert.equal((await waitForRead(runner, 'marketRequests', freshQuoteId, 'fresh quote')).result.ok, true);
    assert.equal(runner.market.fresh, true);

    const sentMarketBeforeStop = wireMarket.length;
    const sentInventoryBeforeStop = wireInventory.length;
    assert.equal(runner.stop(OWNER).ok, true);
    assert.equal(runner.market.market, null);
    assert.equal(runner.inventory.inventory, null);
    await until(() => runner.state === 'stopped', 'self stop completion');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(wireMarket.length, sentMarketBeforeStop, 'stopped runner emits no further market reads');
    assert.equal(wireInventory.length, sentInventoryBeforeStop,
      'stopped runner emits no further inventory reads');
    assert.equal(runner.readMarket(readQuery(runner, listId)).why, 'retired_request_id');
    assert.equal(runner.readInventory(inventoryQuery(runner, inventoryId)).why, 'retired_request_id');

    assert.equal((await runner.reenter(OWNER)).ok, true);
    assert.notEqual(runner.grant.scope.sessionId, oldScope.sessionId);
    assert.ok(runner.grant.controlRevision > oldEpoch);
    assert.equal(runner.market.market, null);
    assert.equal(runner.inventory.inventory, null);
    const newSocket = await until(() => [...host.sockets.values()].find((entry) => entry.agentIdentity === CHARACTER &&
      entry.agentSessionId !== oldScope.sessionId), 'reentered socket');
    const oldMarketReply = wireResults.find((result) => result.t === MSG.AGENT_MARKET_RESULT && result.requestId === quoteId);
    const oldInventoryReply = wireResults.find((result) => result.t === MSG.AGENT_INVENTORY_RESULT && result.requestId === inventoryId);
    assert.ok(oldMarketReply && oldInventoryReply);
    host.sendTo(newSocket.id, oldMarketReply);
    host.sendTo(newSocket.id, oldInventoryReply);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runner.market.market, null, 'an old-epoch quote reply cannot populate the reentered session');
    assert.equal(runner.inventory.inventory, null, 'an old-session inventory reply cannot populate the reentered session');

    const newInventoryId = 'runner-inventory-reentered';
    assert.equal(runner.readInventory(inventoryQuery(runner, newInventoryId)).ok, true);
    assert.equal((await waitForRead(runner, 'inventoryRequests', newInventoryId, 'reentered inventory')).result.ok, true);
    assert.equal(runner.inventory.inventory.gold, 73, 'the authenticated profile remains current across a fresh session');
    const newListId = 'runner-market-reentered';
    assert.equal(runner.readMarket(readQuery(runner, newListId)).ok, true);
    assert.equal((await waitForRead(runner, 'marketRequests', newListId, 'reentered market list')).result.ok, true);
    assert.equal(runner.market.market.town, 'aldea');
  });
