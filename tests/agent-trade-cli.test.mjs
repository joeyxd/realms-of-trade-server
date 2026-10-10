import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { TOWNS } from '../src/data/towns.js';

const WORLD = 'agent-trade-cli-world';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const BUDGET = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'agent-trade-cli-token';
const TOKEN_ENV = 'MN_AGENT_TRADE_CLI_TEST_TOKEN';
const RUNNER = fileURLToPath(new URL('../tools/agent/run.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = check(); if (value) return value; await sleep(10); }
  assert.fail(`${label} timeout`);
}
function launch(url, files) {
  const child = spawn(process.execPath, [RUNNER, '--url', url, '--files', files, '--owner', OWNER,
    '--character', CHARACTER, '--world', WORLD, '--account-token-env', TOKEN_ENV, '--mind', 'simulated',
    '--stay-open', '--capabilities', 'move,inventory_read,market_read,trade_buy'],
  { env: { ...process.env, [TOKEN_ENV]: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const exit = once(child, 'exit');
  child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
  return { child, exit, events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    stderr: () => stderr, send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`) };
}
async function cleanup(runner) {
  if (!runner || runner.child.exitCode !== null) return;
  runner.send({ type: 'exit' });
  const exited = await Promise.race([runner.exit.then(() => true), sleep(2500).then(() => false)]);
  if (!exited) { runner.child.kill(); await runner.exit; }
}

test('CLI spends only after an explicit trade command; capability is opt-in and mind stays non-spending',
  { timeout: 35000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-trade-cli-')), files = join(directory, 'owner-files');
    await mkdir(files);
    const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
    await writeFile(join(files, 'personality.md'), 'Brisa.\n');
    await writeFile(join(files, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope, goals: [] }));
    await writeFile(join(files, 'memory.jsonl'), '');
    const store = createMemoryStore();
    for (const id of [OWNER, CHARACTER]) {
      const profile = newProfile(); profile.gold = 1000; profile.pirateId = `account:${id}`;
      await store.initializeProfile(id, profile);
    }
    await store.createAgentGoodsBudget({ world: WORLD, ownerId: OWNER, characterId: CHARACTER, budgetId: BUDGET,
      limits: { buyGold: 1000, buyGoldPerTrade: 500, sellUnits: { fruta: 3 }, sellUnitsPerTrade: 3 } });
    const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 2,
      worldId: WORLD, saveSecret: 'agent-trade-cli-fixture', store, economicOperations: true,
      resolvePlayer: async (_request, message) => message.token === TOKEN ? CHARACTER : null,
      agentControl: { worldId: WORLD, ttlMs: 60000,
        bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move', 'inventory_read', 'market_read', 'trade_buy'] }] },
      agentPilot: { maxAgents: 1 }, agentTrade: true, log() {} });
    const port = await server.listen(), process = launch(`ws://127.0.0.1:${port}/ws`, files);
    t.after(async () => { await cleanup(process); await server.close(); await rm(directory, { recursive: true, force: true }); });

    const readyEvent = await until(() => process.events().find((event) => event.type === 'ready'), 'CLI ready');
    const ready = readyEvent.data;
    assert.equal(ready.authority, 'server_controller');
    assert.equal(ready.gameSpendingEnabled, true, 'an explicit effective trade grant opts this runner in');
    assert.equal(ready.gameSpendingRequiresEnabledBudget, true, 'the grant does not imply a usable budget or guaranteed transaction');
    assert.equal(ready.inferenceCalls, 0);
    assert.equal(process.events().some((event) => event.type.startsWith('trade_')), false,
      'a spending capability does not start a trade or a mind action');
    const host = server.game;
    await until(() => [...host.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER), 'agent socket');
    const entity = [...host.sockets.values()].find((socket) => socket.agentIdentity === CHARACTER);
    const actor = host.server.clients.get(entity.id).entity, world = host.server.world, town = TOWNS.aldea;
    const point = world.map.landmarks[town.landmark] || world.map[town.landmark];
    Object.assign(world.ecs.x, { [actor]: point.x }); Object.assign(world.ecs.z, { [actor]: point.z });
    world.ecs.y[actor] = world.map.groundAt(point.x, point.z);
    world.ecs.regenT[actor] = 100; world.ecs.moveMag[actor] = 0; world.ecs.vx[actor] = 0; world.ecs.vz[actor] = 0;
    world.ecs.dashT[actor] = -1; world.ecs.dashBuffer[actor] = 0; world.ecs.castK[actor] = 0; world.ecs.castLock[actor] = 0;
    process.send({ type: 'observe' });
    await until(() => process.events().some((event) => event.type === 'current' && event.data.observation?.source === 'server'), 'CLI observation');
    const total = world.economy.quote('aldea', 'fruta', 1, 'buy').total, gold = world.profiles.get(actor).gold;
    const opId = 'cli-explicit-buy-1';
    process.send({ type: 'trade', opId, op: 'buy', g: 'fruta', n: 1, expectedTotal: total });
    const response = await until(() => process.events().find((event) => event.type === 'trade_response'), 'CLI explicit trade admission');
    assert.equal(response.data.ok, true);
    const result = await until(() => process.events().find((event) => event.type === 'trade_result' && event.data.opId === opId), 'CLI trade receipt');
    assert.equal(result.data.state, 'completed');
    assert.equal(result.data.result.receipt.total, total);
    assert.equal(world.profiles.get(actor).gold, gold - total);
    assert.equal(result.data.result.budget.buyGoldUsed, total);
    assert.equal(result.data.result.historical, false);
    assert.equal(process.stderr(), '');
  });
