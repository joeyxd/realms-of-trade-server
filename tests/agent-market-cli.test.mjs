import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG } from '../src/net/protocol.js';
import { TOWNS } from '../src/data/towns.js';

const WORLD = 'agent-market-cli-test';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-market-cli-fixture-token';
const TOKEN_ENV = 'MN_AGENT_MARKET_CLI_TEST_TOKEN';
const RUNNER = fileURLToPath(new URL('../tools/agent/run.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(10);
  }
  assert.fail(`${label} timeout`);
}

function runnerProcess({ url, files }) {
  const child = spawn(process.execPath, [RUNNER, '--url', url, '--files', files, '--owner', OWNER,
    '--character', CHARACTER, '--world', WORLD, '--account-token-env', TOKEN_ENV,
    '--mind', 'simulated', '--stay-open', '--capabilities', 'move,inventory_read,market_read'],
  { env: { ...process.env, [TOKEN_ENV]: AGENT_TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const exit = once(child, 'exit');
  child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
  return {
    child, exit,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    stderr: () => stderr,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
  };
}

async function ownerFiles(directory) {
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await writeFile(join(directory, 'personality.md'), 'Brisa.\n');
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
}

function entitySocket(server) {
  return [...server.game.sockets.values()].find((sock) => sock.agentIdentity === CHARACTER);
}

function placeInTown(world, entity, town = 'aldea') {
  const value = TOWNS[town], point = world.map.landmarks[value.landmark] || world.map[value.landmark];
  world.ecs.x[entity] = point.x; world.ecs.z[entity] = point.z;
  world.ecs.y[entity] = world.map.groundAt(point.x, point.z);
}

function pauseServer(game) {
  clearInterval(game.timer); game.timer = null;
  clearInterval(game.worldTimer); game.worldTimer = null;
  clearInterval(game.beat); game.beat = null;
}

async function waitRunnerAt(process, point) {
  await until(() => {
    process.send({ type: 'observe' });
    const current = process.events().filter((event) => event.type === 'current').at(-1)?.data?.observation;
    return current?.source === 'server' && Math.hypot(current.confirmed.self.position.x - point.x,
      current.confirmed.self.position.z - point.z) < 1 ? current : null;
  }, 'runner observation reaches current town');
}

async function cleanupRunner(runner) {
  if (!runner || runner.child.exitCode !== null) return;
  runner.send({ type: 'exit' });
  const didExit = await Promise.race([runner.exit.then(() => true), sleep(2500).then(() => false)]);
  if (!didExit) { runner.child.kill(); await runner.exit; }
}

function queryFor(grant, requestId, op, fields = {}) {
  return { v: 1, requestId, scope: grant.scope, controlRevision: grant.controlRevision, op, ...fields };
}

test('run.mjs exposes fresh private inventory and market context, then fences reads across stop and reentry',
  { timeout: 45000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-market-cli-'));
    const files = join(directory, 'owner-files'); await mkdir(files);
    await ownerFiles(files);
    const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 4,
      worldId: WORLD, saveSecret: 'agent-market-cli-test-secret', store: createMemoryStore(), log() {},
      resolvePlayer: async (_request, message) => message.token === AGENT_TOKEN ? CHARACTER : null,
      agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER,
        capabilities: ['move', 'inventory_read', 'market_read'] }] },
      agentPilot: { maxAgents: 1 } });
    const port = await server.listen();
    const process = runnerProcess({ url: `ws://127.0.0.1:${port}/ws`, files });
    t.after(async () => {
      await cleanupRunner(process);
      await server.close();
      await rm(directory, { recursive: true, force: true });
    });

    await until(() => process.events().some((event) => event.type === 'ready'), 'authenticated CLI runner ready');
    const ready = process.events().find((event) => event.type === 'ready').data;
    assert.equal(ready.authority, 'server_controller');
    assert.equal(ready.gameSpendingEnabled, false);
    assert.equal(ready.inferenceCalls, 0);
    assert.ok(ready.grant.scope.sessionId);
    const socket = await until(() => entitySocket(server), 'managed market agent socket');
    const world = server.game.server.world, entity = server.game.server.clients.get(socket.id).entity;
    placeInTown(world, entity, 'aldea');
    const town = TOWNS.aldea, landmark = world.map.landmarks[town.landmark] || world.map[town.landmark];
    const standPoint = { x: landmark.x + town.r - 1, z: landmark.z };
    world.ecs.x[entity] = standPoint.x; world.ecs.z[entity] = standPoint.z;
    world.ecs.y[entity] = world.map.groundAt(standPoint.x, standPoint.z);
    // Keep the integration fixture's perception small enough for the bounded mind context.
    for (let id = 1; id < world.ecs.cap; id++) if (id !== entity && world.ecs.alive[id]) world.ecs.x[id] += 10000;
    await waitRunnerAt(process, standPoint);
    pauseServer(server.game);
    world.profiles.get(entity).gold = 73;

    const inventoryId = 'cli-inventory-first';
    process.send({ type: 'inventory_read', query: { v: 1, requestId: inventoryId,
      scope: ready.grant.scope, controlRevision: ready.grant.controlRevision } });
    await until(() => process.events().some((event) => event.type === 'inventory_result' &&
      event.data.requestId === inventoryId && event.data.state === 'completed'), 'private inventory result');
    const inventory = process.events().filter((event) => event.type === 'inventory_result' &&
      event.data.requestId === inventoryId).at(-1).data.result;
    assert.equal(inventory.ok, true);
    assert.equal(inventory.inventory.gold, 73);

    const marketId = 'cli-market-quote';
    process.send({ type: 'market_read', query: queryFor(ready.grant, marketId, 'quote',
      { g: 'madera', n: 3, side: 'buy' }) });
    await until(() => process.events().some((event) => event.type === 'market_result' &&
      event.data.requestId === marketId && event.data.state === 'completed'), 'private market quote result');
    const marketRequest = process.events().filter((event) => event.type === 'market_result' &&
      event.data.requestId === marketId).at(-1).data;
    assert.equal(marketRequest.result.ok, true);
    assert.equal(marketRequest.result.market.town, 'aldea');

    process.send({ type: 'inventory' });
    await until(() => process.events().some((event) => event.type === 'inventory'), 'inventory ledger inspection');
    const inventoryState = process.events().filter((event) => event.type === 'inventory').at(-1).data;
    assert.equal(inventoryState.fresh, true);
    assert.equal(inventoryState.inventory.gold, 73);
    process.send({ type: 'market' });
    await until(() => process.events().some((event) => event.type === 'market'), 'market ledger inspection');
    const marketState = process.events().filter((event) => event.type === 'market').at(-1).data;
    assert.equal(marketState.fresh, true, JSON.stringify(marketState));
    assert.deepEqual(marketState.market, marketRequest.result.market);

    process.send({ type: 'context' });
    await until(() => process.events().some((event) => event.type === 'context'), 'actual mind context snapshot');
    const context = process.events().filter((event) => event.type === 'context').at(-1).data;
    assert.equal(context.ok, true, JSON.stringify(context));
    assert.equal(context.inferenceCalls, 0);
    assert.equal(context.document.required.rules.gameSpendingEnabled, false);
    assert.ok(context.document.required.tools.economy.market, JSON.stringify(context.document.required.tools));
    assert.deepEqual(context.document.required.tools.economy.inventory.inventory, inventoryState.inventory);
    assert.deepEqual(context.document.required.tools.economy.market.market, marketRequest.result.market);
    assert.equal(context.document.required.tools.economy.inventory.source, 'server_private');
    assert.equal(context.document.required.tools.economy.market.source, 'server_market');
    assert.equal(context.document.required.tools.reads.inventory.readOnly, true);
    assert.equal(context.document.required.tools.reads.market.readOnly, true);
    assert.equal(context.document.required.tools.reads.market.quote, 'advisory_only');

    const malformedBaseline = process.events().filter((event) => event.type === 'market_read_response').length;
    for (const [requestId, fields] of [
      ['cli-bad-selector', { ownerId: OWNER }],
      ['cli-bad-side', { g: 'madera', n: 1, side: 'transfer', op: 'quote', entity: entity }],
    ]) {
      const query = queryFor(ready.grant, requestId, fields.op ?? 'list', fields);
      process.send({ type: 'market_read', query });
    }
    await until(() => process.events().filter((event) => event.type === 'market_read_response').length >= malformedBaseline + 2,
      'malformed market reads rejected');
    const rejected = process.events().filter((event) => event.type === 'market_read_response').slice(-2);
    assert.ok(rejected.every((event) => event.data.ok === false && event.data.why === 'invalid_request'));

    server.game.start();
    process.send({ type: 'stop' });
    await until(() => process.events().some((event) => event.type === 'stopped'), 'self-stop complete');
    process.send({ type: 'market' });
    await until(() => process.events().filter((event) => event.type === 'market').length >= 2, 'market state after stop');
    assert.equal(process.events().filter((event) => event.type === 'market').at(-1).data.market, null);
    process.send({ type: 'context' });
    await until(() => process.events().filter((event) => event.type === 'context').length >= 2, 'context after stop');
    const stoppedContext = process.events().filter((event) => event.type === 'context').at(-1).data;
    assert.equal(stoppedContext.document.required.tools.economy, undefined);

    process.send({ type: 'reenter' });
    await until(() => process.events().some((event) => event.type === 'reenter_response'), 'authenticated fresh reentry');
    const reentered = process.events().find((event) => event.type === 'reenter_response').data;
    assert.equal(reentered.ok, true, JSON.stringify(reentered));
    assert.notEqual(reentered.grant?.scope?.sessionId, ready.grant.scope.sessionId);
    process.send({ type: 'market' });
    await until(() => process.events().filter((event) => event.type === 'market').length >= 3, 'market state after reentry');
    const currentMarketState = process.events().filter((event) => event.type === 'market').at(-1).data;
    assert.equal(currentMarketState.market, null);
    assert.notEqual(currentMarketState.scope.sessionId, ready.grant.scope.sessionId);
    const currentGrant = reentered.grant;
    process.send({ type: 'lifecycle' });
    await until(() => process.events().some((event) => event.type === 'lifecycle'), 'reentry lifecycle archive');
    const lifecycle = process.events().filter((event) => event.type === 'lifecycle').at(-1).data;
    assert.ok(lifecycle.archives.some((archive) => archive.marketRequests.some((request) => request.requestId === marketId)),
      JSON.stringify(lifecycle.archives.map((archive) => archive.marketRequests.map((request) => request.requestId))));
    const retiredBaseline = process.events().filter((event) => event.type === 'market_read_response').length;
    process.send({ type: 'market_read', query: queryFor(currentGrant, marketId, 'quote',
      { g: 'madera', n: 3, side: 'buy' }) });
    await until(() => process.events().filter((event) => event.type === 'market_read_response').length >= retiredBaseline + 1,
      'retired request ID rejected after reentry');
    const retired = process.events().filter((event) => event.type === 'market_read_response').at(-1).data;
    assert.equal(retired.ok, false, JSON.stringify({ currentGrant, currentMarketState, retired }));
    assert.equal(retired.why, 'retired_request_id', JSON.stringify({ currentGrant, currentMarketState, retired }));
    process.send({ type: 'context' });
    await until(() => process.events().filter((event) => event.type === 'context').length >= 3,
      'context after fresh reentry');
    const reenteredContext = process.events().filter((event) => event.type === 'context').at(-1).data;
    assert.equal(reenteredContext.inferenceCalls, 0);
    assert.equal(reenteredContext.document.required.tools.economy, undefined);
    assert.equal(process.events().some((event) => event.type === 'mind_result'), false);
    assert.equal(process.stderr(), '');
  });
