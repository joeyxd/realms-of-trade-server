import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { GameHost } from '../../server/host.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { CRAFT_RECIPES } from '../../src/data/resources.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { database } from './ground-clock-sql.mjs';

const [mode, operationKind, dataPath, phase] = process.argv.slice(2);
if (!['before', 'after', 'inspect'].includes(mode) || !['gather', 'craft'].includes(operationKind) || !dataPath ||
    (mode !== 'inspect' && !['before-commit', 'after-commit'].includes(phase))) {
  throw new Error('mode, operation kind, database path, and crash phase are required');
}

const WORLD = 'resource-crash';
const ACCOUNT = '00000000-0000-4000-8000-000000000097';
const SEED = 97;
const OP_ID = `resource-crash-${operationKind}`;
const MIGRATION_014 = await readFile(new URL('../../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const MIGRATION_015 = await readFile(new URL('../../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

function profileSeed(kind = operationKind) {
  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.pack.goods = kind === 'craft' ? { ...CRAFT_RECIPES.hacha_piedra.inputs } : { tronco: 1, piedra: 2 };
  return profile;
}

function localStore(db) {
  const fetch = async (input, init = {}) => {
    const name = new URL(input).pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    try {
      let data;
      if (name === 'mn_load_profile') data = (await db.query(
        'select public.mn_load_profile($1::uuid) as data', [body.p_player_id])).rows[0].data;
      else if (name === 'mn_save_profile') data = (await db.query(
        'select public.mn_save_profile($1::uuid,$2::jsonb,$3::integer) as data',
        [body.p_player_id, body.p_data, body.p_expected_version])).rows[0].data;
      else if (name === 'mn_load_world') data = (await db.query(
        'select public.mn_load_world($1) as data', [body.p_world])).rows[0].data;
      else if (name === 'mn_save_world') data = (await db.query(
        'select public.mn_save_world($1,$2::jsonb,$3::integer) as data',
        [body.p_world, body.p_data, body.p_expected_version])).rows[0].data;
      else if (name === 'mn_resource_operations_ready') data = (await db.query(
        'select public.mn_resource_operations_ready() as data')).rows[0].data;
      else if (name === 'mn_load_economic_operation') data = (await db.query(
        'select public.mn_load_economic_operation($1::uuid) as data', [body.p_operation_id])).rows[0].data;
      else if (name === 'mn_commit_economic_operation') data = (await db.query(
        'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data',
        [body.p_operation_id, body.p_request])).rows[0].data;
      else throw new Error(`unexpected local RPC ${name}`);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return createSupabaseStore(client);
}

async function openDatabase(path, migrate) {
  if (migrate) {
    const fixture = await database(path); // SQL001–013, already applied by the shared PGlite fixture.
    try {
      await fixture.db.exec('RESET ROLE');
      await fixture.db.exec(MIGRATION_014);
      await fixture.db.exec(MIGRATION_015);
      await fixture.db.exec('SET ROLE service_role');
      return fixture.db;
    } catch (error) { await fixture.close(); throw error; }
  }
  const db = new PGlite(path);
  await db.exec('SET ROLE service_role');
  return db;
}

function resourceCommand(kind, host) {
  if (kind === 'craft') return { type: 'resource', op: 'craft', opId: OP_ID,
    recipe: CRAFT_RECIPES.hacha_piedra.id, expectedRev: 0, n: 1 };
  const node = [...host.server.world.resources.nodes.values()].find(entry => entry.kind === 'wood');
  if (!node) throw new Error('seed 97 has no wood node');
  return { type: 'resource', op: 'gather', opId: OP_ID, node: node.id, expectedRev: node.rev };
}

async function hostAndClient(db, store, { start = true } = {}) {
  const host = new GameHost({ seed: SEED, bots: 0, store, resolvePlayer: async () => ACCOUNT,
    worldId: WORLD, resourceOperations: true, economicOperations: true, log() {} });
  await host.prepare();
  if (start) host.start();
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'process-test' } });
  const clientId = host.nextId - 1;
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Recovery tester' })), false);
  await Promise.all([...host.joins]);
  const entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity, 'the existing account joins the restarted GameHost');
  return { host, socket, clientId, entity };
}

function moveToNode(host, entity, command) {
  const ecs = host.server.world.ecs;
  if (command.op === 'gather') {
    const node = host.server.world.resources.nodes.get(command.node);
    ecs.x[entity] = node.x; ecs.y[entity] = node.y; ecs.z[entity] = node.z;
  } else {
    const bench = host.server.world.resources.bench;
    if (!bench) throw new Error('seed 97 has no resource crafting bench');
    ecs.x[entity] = bench.x; ecs.y[entity] = bench.y; ecs.z[entity] = bench.z;
  }
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

function sendCommand(socket, command) {
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false);
}

function assertRestoredResourceClock(host, saved) {
  const world = host.server.world;
  assert.equal(world.tick, 0, 'the local simulation tick starts at zero after process restart');
  assert.equal(host.worldState.resourceTick(), saved.tick, 'the durable resource clock resumes at its stored tick');
  for (const row of saved.nodes) {
    const node = world.resources.nodes.get(row.id);
    assert.ok(node, `restored world contains saved resource node ${row.id}`);
    const expectedRemaining = Math.max(0, row.readyAt - saved.tick);
    const actualRemaining = Math.max(0, node.readyTick - world.tick);
    assert.equal(actualRemaining, expectedRemaining, `node ${row.id} preserves remaining logical respawn ticks`);
  }
}

async function seedAndHold() {
  const db = await openDatabase(dataPath, true);
  await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [ACCOUNT, profileSeed(operationKind)]);
  const originalStore = localStore(db);
  const store = { ...originalStore };
  const { host, socket, entity } = await hostAndClient(db, store);
  const command = resourceCommand(operationKind, host);
  moveToNode(host, entity, command);
  const commit = store.commitEconomicOperation.bind(store);
  store.commitEconomicOperation = async operation => {
    if (phase === 'before-commit') {
      process.stdout.write(`READY ${mode} ${operationKind} ${phase}\n`);
      await new Promise(() => {});
    }
    const result = await commit(operation);
    if (phase === 'after-commit') {
      assert.equal(result?.ok, true, 'the SQL transaction commits before the child reports the crash boundary');
      assert.equal(result?.ack?.ok, true, 'the crash boundary follows a successful resource operation');
      process.stdout.write(`READY ${mode} ${operationKind} ${phase}\n`);
      await new Promise(() => {});
    }
    return result;
  };
  sendCommand(socket, command);
  // The commit hook and host timer keep this child alive until the parent sends SIGKILL.
  await new Promise(() => {});
}

async function inspectRestart() {
  const db = await openDatabase(dataPath, false);
  let host = null;
  try {
    const store = localStore(db);
    assert.deepEqual(await store.checkResourceOperations(), { version: 1 });
    const connected = await hostAndClient(db, store, { start: false });
    host = connected.host;
    let receiptRows = (await db.query('select operation_id,request,result from public.mn_economic_operations')).rows;
    const committedBeforeRestart = phase === 'after-commit';
    assert.equal(receiptRows.length, committedBeforeRestart ? 1 : 0,
      committedBeforeRestart ? 'the commit and receipt survived the process kill' : 'the pre-commit kill left no receipt');
    let receipt = receiptRows.length ? await store.loadEconomicOperation(receiptRows[0].operation_id) : null;
    if (committedBeforeRestart) {
      assert.ok(receipt);
      assert.equal(receipt.request.world, WORLD);
      assert.equal(receipt.request.account, ACCOUNT);
      assert.equal(receipt.request.command.type, 'resource');
      assert.equal(receipt.request.command.op, operationKind);
      assert.equal(receipt.request.command.opId, OP_ID);
      if (operationKind === 'craft') assert.deepEqual(receipt.request.command, {
        type: 'resource', op: 'craft', opId: OP_ID, recipe: CRAFT_RECIPES.hacha_piedra.id, expectedRev: 0, n: 1,
      });
      else {
        const node = host.server.world.resources.nodes.get(receipt.request.command.node);
        assert.equal(node.kind, 'wood');
        assert.equal(receipt.request.command.expectedRev + 1, node.rev);
      }
    } else {
      const row = (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
      assert.equal(row.version, 2, 'joining synchronizes the profile before an economic command');
      assert.deepEqual(row.data.eco.pack.goods, profileSeed(operationKind).eco.pack.goods);
      assert.equal(host.worldState.version, 2, 'only the resource-layout bootstrap is durable before the command');
      assert.equal(host.server.world.profiles.get(connected.entity).tools.axe, 0);
    }
    const before = {
      profile: (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0],
      world: (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0],
      joined: structuredClone(host.server.world.profiles.get(connected.entity)),
      resources: structuredClone(host.worldState.resources),
      accountVersion: host.profiles.clients.get(connected.clientId).version,
      worldVersion: host.worldState.version,
    };
    if (committedBeforeRestart) {
      assert.deepEqual(before.joined, before.profile.data, 'the admitted profile matches the committed SQL row');
      assert.deepEqual(before.resources, before.world.economy.resources, 'the restarted host restored the committed resource snapshot');
    }
    assertRestoredResourceClock(host, before.resources);

    const retryCommand = committedBeforeRestart ? receipt.request.command : resourceCommand(operationKind, host);
    moveToNode(host, connected.entity, retryCommand);
    sendCommand(connected.socket, retryCommand);
    await host.economicAuthority.settle();
    assert.equal(host.server.beforeTick(), true,
      'the actual economic drain applies at the tick boundary without advancing unrelated quest gameplay');
    const replayAck = connected.socket.messages.findLast(message => message.t === MSG.EVENT && message.ev?.opId === OP_ID)?.ev;
    assert.equal(replayAck.ok, true);
    assert.equal(replayAck.replay === true, committedBeforeRestart);
    const afterProfile = (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
    const afterWorld = (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0];
    const afterReceiptCount = Number((await db.query('select count(*)::integer as n from public.mn_economic_operations')).rows[0].n);
    if (committedBeforeRestart) {
      assert.deepEqual(afterProfile, before.profile, 'replay leaves the committed profile and tools untouched');
      assert.deepEqual(afterWorld, before.world, 'replay leaves the committed resource node untouched');
      assert.deepEqual(host.server.world.profiles.get(connected.entity), before.joined);
      assert.deepEqual(host.worldState.resources, before.resources);
      assert.equal(host.profiles.clients.get(connected.clientId).version, before.accountVersion);
      assert.equal(host.worldState.version, before.worldVersion);
    }
    assert.equal(afterReceiptCount, 1, 'replay does not create a second receipt');
    receiptRows = (await db.query('select operation_id from public.mn_economic_operations')).rows;
    receipt = await store.loadEconomicOperation(receiptRows[0].operation_id);
    assert.equal(receipt.request.command.opId, OP_ID);

    const profile = afterProfile.data, resources = afterWorld.economy.resources;
    assert.deepEqual(resources, receipt.request.worldData.resources,
      'the durable tick, node deadlines and account cooldowns match the operation receipt');
    const expectedProfile = operationKind === 'craft' ? { axe: 1 } : { tronco: 2, piedra: 2, axe: 0 };
    if (operationKind === 'craft') {
      for (const good of Object.keys(CRAFT_RECIPES.hacha_piedra.inputs))
        assert.equal(profile.eco.pack.goods[good], undefined, `${good} is consumed exactly once`);
      assert.equal(profile.tools.axe, expectedProfile.axe);
    } else {
      assert.equal(profile.eco.pack.goods.tronco, expectedProfile.tronco);
      assert.equal(profile.eco.pack.goods.piedra, expectedProfile.piedra);
      assert.equal(profile.tools.axe, expectedProfile.axe);
      const savedNode = resources.nodes.find(node => node.id === receipt.request.command.node);
      assert.equal(savedNode.rev, receipt.request.worldData.resources.nodes.find(node => node.id === savedNode.id).rev);
      assert.equal(savedNode.readyAt, receipt.request.worldData.resources.nodes.find(node => node.id === savedNode.id).readyAt);
    }
    process.stdout.write(JSON.stringify({ mode, operation: operationKind, profileVersion: afterProfile.version,
      worldVersion: afterWorld.version, profile, tools: profile.tools, resources, receiptCount: afterReceiptCount,
      replay: replayAck.replay === true, replayWhy: replayAck.why }));
  } finally {
    if (host) await host.close();
    await db.close();
  }
}

if (mode === 'inspect') await inspectRestart();
else await seedAndHold();
