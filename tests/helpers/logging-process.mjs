import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { GameHost } from '../../server/host.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { database } from './ground-clock-sql.mjs';

const [mode, dataPath, phase] = process.argv.slice(2);
if (!['before', 'after', 'inspect'].includes(mode) || !dataPath ||
    (mode !== 'inspect' && !['before-commit', 'after-commit'].includes(phase))) {
  throw new Error('mode, database path, and crash phase are required');
}

const WORLD = 'logging-process';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP_ID = 'logging-process-final-hit';
const SEED = 97;
const MIGRATIONS = await Promise.all(['014_economic_operations.sql', '015_resource_operations.sql', '016_logging_operations.sql']
  .map(name => readFile(new URL(`../../server/migrations/${name}`, import.meta.url), 'utf8')));

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

function profileSeed(account, logging, gold) {
  const profile = newProfile();
  profile.pirateId = `account:${account}`;
  profile.tools.axe = 1;
  profile.gold = gold;
  profile.progression.practice.logging = logging;
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
      else if (name === 'mn_logging_operations_ready') data = (await db.query(
        'select public.mn_logging_operations_ready() as data')).rows[0].data;
      else if (name === 'mn_load_economic_operation') data = (await db.query(
        'select public.mn_load_economic_operation($1::uuid) as data', [body.p_operation_id])).rows[0].data;
      else if (name === 'mn_commit_economic_operation') {
        data = (await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data',
          [body.p_operation_id, body.p_request])).rows[0].data;
      }
      else throw new Error(`unexpected local RPC ${name}`);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message ?? 'Local SQL rejection', code: error.code ?? 'XX000' }),
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
    const fixture = await database(path); // SQL001–013 from the shared PGlite fixture.
    try {
      await fixture.db.exec('RESET ROLE');
      for (const sql of MIGRATIONS) await fixture.db.exec(sql);
      await fixture.db.exec('SET ROLE service_role');
      return fixture.db;
    } catch (error) { await fixture.close(); throw error; }
  }
  const db = new PGlite(path);
  await db.exec('SET ROLE service_role');
  return db;
}

async function connectAccount(host, account) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'logging-process-test' } });
  const clientId = host.nextId - 1;
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Recovery tester' })), false);
  await Promise.all([...host.joins]);
  const entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity, `account ${account} joins the restarted GameHost`);
  return { socket, clientId, entity };
}

function moveToNode(host, entity, nodeId) {
  const ecs = host.server.world.ecs, node = host.server.world.resources.nodes.get(nodeId);
  assert.ok(node);
  ecs.x[entity] = node.x; ecs.y[entity] = node.y; ecs.z[entity] = node.z;
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

function sendCommand(socket, command) {
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false);
}

async function createHost(store, { start = true } = {}) {
  const host = new GameHost({ seed: SEED, bots: 0, store, resolvePlayer: async () => B,
    worldId: WORLD, resourceOperations: true, economicOperations: true, loggingOperations: true, log() {} });
  await host.prepare();
  if (start) host.start();
  return host;
}

async function seedAndHold() {
  const db = await openDatabase(dataPath, true);
  await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
    [A, profileSeed(A, 53, 137), B, profileSeed(B, 0, 241)]);
  const store = localStore(db), host = await createHost(store, { start: false });
  try {
    const world = host.server.world, resources = upgradeLoggingState(newResourceState(world));
    const target = resources.nodes.find(row => row.kind === 'palm');
    assert.ok(target, 'the deterministic seed contains a palm');
    target.rev = 3; target.hits = 2;
    resources.logging[target.id] = { cycle: 1, contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
    host.worldState.resources = resources;
    const live = world.resources.nodes.get(target.id); live.rev = 3; live.hits = 2; live.readyTick = 0;
    const seedData = host.worldState.snapshot(world.economy), expectedVersion = host.worldState.version;
    seedData.resources = resources;
    const seeded = await db.query('update public.mn_worlds set economy=$1::jsonb, version=version+1 '
      + 'where world=$2 and version=$3 returning version', [seedData, WORLD, expectedVersion]);
    assert.equal(seeded.rows.length, 1, 'the SQL test fixture seeds a valid v2 partial cooperative palm before connections');
    host.worldState.version = seeded.rows[0].version;
    host.worldState.last = JSON.stringify(seedData);
    host.start();
    const connected = await connectAccount(host, B);
    moveToNode(host, connected.entity, target.id);
    const command = { type: 'resource', op: 'gather', opId: OP_ID, node: target.id, expectedRev: 3 };
    const commit = store.commitEconomicOperation.bind(store);
    store.commitEconomicOperation = async operation => {
      if (phase === 'before-commit') {
        process.stdout.write(`READY ${mode} ${phase}\n`);
        await new Promise(() => {});
      }
      const result = await commit(operation);
      if (phase === 'after-commit') {
        assert.equal(result?.ok, true, 'SQL commits the multibeneficiary operation before the signal');
        assert.equal(result?.ack?.ok, true, 'the crash boundary follows a successful palm harvest');
        process.stdout.write(`READY ${mode} ${phase}\n`);
        await new Promise(() => {});
      }
      return result;
    };
    sendCommand(connected.socket, command);
    await new Promise(() => {});
  } finally {
    // The parent intentionally kills the child before this finally can run.
  }
}

async function readAccount(db, account) {
  return (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [account])).rows[0];
}

async function inspectRestart() {
  const db = await openDatabase(dataPath, false), store = localStore(db);
  let host = null;
  try {
    assert.deepEqual(await store.checkResourceOperations(), { version: 1 });
    assert.deepEqual(await store.checkLoggingOperations(), { version: 1 });
    host = await createHost(store, { start: false });
    const connected = await connectAccount(host, B);
    const receiptsBefore = (await db.query('select operation_id,request,result from public.mn_economic_operations')).rows;
    const committedBeforeRestart = phase === 'after-commit';
    assert.equal(receiptsBefore.length, committedBeforeRestart ? 1 : 0,
      committedBeforeRestart ? 'commit and receipt survived SIGKILL' : 'precommit kill left no receipt');
    const receipt = receiptsBefore.length ? await store.loadEconomicOperation(receiptsBefore[0].operation_id) : null;
    if (receipt) {
      assert.equal(receipt.request.account, B);
      assert.equal(receipt.request.command.opId, OP_ID);
      assert.deepEqual(receipt.request.beneficiaries.map(row => row.account), [A, B]);
    }
    const before = { A: await readAccount(db, A), B: await readAccount(db, B),
      world: (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0] };
    const targetId = (receipt?.request.command.node) ??
      host.worldState.resources.nodes.find(row => row.kind === 'palm' && row.hits === 2)?.id;
    assert.ok(targetId);
    const beforeNode = before.world.economy.resources.nodes.find(row => row.id === targetId);
    const beforeLedger = before.world.economy.resources.logging[targetId];
    assert.equal(beforeNode.hits, committedBeforeRestart ? 3 : 2);
    if (committedBeforeRestart) {
      assert.equal(before.A.data.progression.practice.logging, 56);
      assert.equal(before.B.data.progression.practice.logging, 7);
      assert.equal(before.A.data.gold, 137); assert.equal(before.B.data.gold, 241);
      assert.deepEqual(beforeLedger.contributors, [{ actor: A, hits: 1 }, { actor: B, hits: 2 }]);
    } else {
      assert.equal(before.A.data.progression.practice.logging, 53);
      assert.equal(before.B.data.progression.practice.logging, 0);
      assert.equal(before.A.data.gold, 137); assert.equal(before.B.data.gold, 241);
      assert.deepEqual(beforeLedger.contributors, [{ actor: A, hits: 1 }, { actor: B, hits: 1 }]);
    }

    const command = receipt?.request.command ?? { type: 'resource', op: 'gather', opId: OP_ID,
      node: targetId, expectedRev: beforeNode.rev };
    moveToNode(host, connected.entity, targetId);
    const commit = store.commitEconomicOperation.bind(store);
    store.commitEconomicOperation = async operation => {
      try {
        const result = await commit(operation);
        return result;
      } catch (error) {
        throw error;
      }
    };
    sendCommand(connected.socket, command);
    await host.economicAuthority.settle();
    assert.equal(host.server.beforeTick(), true, `the confirmed/retried operation drains at the tick boundary: ${JSON.stringify(host.status())}`);
    const ack = connected.socket.messages.findLast(message => message.t === MSG.EVENT && message.ev?.opId === OP_ID)?.ev;
    assert.equal(ack?.ok, true);
    assert.equal(ack.replay === true, committedBeforeRestart);
    assert.equal(ack.loggingStatus.practice, committedBeforeRestart ? 0 : 0);

    const after = { A: await readAccount(db, A), B: await readAccount(db, B),
      world: (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0] };
    const count = Number((await db.query('select count(*)::integer as n from public.mn_economic_operations')).rows[0].n);
    assert.equal(count, 1, 'exact retry leaves one immutable receipt');
    const node = after.world.economy.resources.nodes.find(row => row.id === targetId);
    const ledger = after.world.economy.resources.logging[targetId];
    assert.equal(node.hits, 3);
    assert.equal(after.A.data.progression.practice.logging, 56);
    assert.equal(after.B.data.progression.practice.logging, 7);
    assert.equal(after.A.data.gold, 137); assert.equal(after.B.data.gold, 241);
    assert.deepEqual(ledger.contributors, [{ actor: A, hits: 1 }, { actor: B, hits: 2 }]);
    assert.equal(after.A.version, before.A.version + (committedBeforeRestart ? 0 : 1));
    assert.equal(after.B.version, before.B.version + (committedBeforeRestart ? 0 : 1));
    if (committedBeforeRestart) {
      assert.deepEqual(after.A, before.A); assert.deepEqual(after.B, before.B);
      assert.deepEqual(after.world, before.world, 'historical replay cannot reapply the node or either progression award');
    }
    const finalReceipt = await store.loadEconomicOperation((await db.query(
      'select operation_id from public.mn_economic_operations')).rows[0].operation_id);
    assert.equal(finalReceipt.request.command.opId, OP_ID);
    assert.deepEqual(finalReceipt.request.worldData.resources, after.world.economy.resources);
    process.stdout.write(JSON.stringify({ mode, phase, receiptCount: count, replay: ack.replay === true,
      A: after.A.data, B: after.B.data, node, ledger, profileVersions: { A: after.A.version, B: after.B.version },
      worldVersion: after.world.version }));
  } finally {
    if (host) {
      try { await host.close(); }
      catch (error) {
        process.stderr.write(`${JSON.stringify({ closeError: error.code ?? error.message, status: host.status(),
          profileTasks: host.profiles.tasks.size, economicFailed: host.economicAuthority?.failed })}\n`);
      }
    }
    await db.close();
  }
}

if (mode === 'inspect') await inspectRestart();
else await seedAndHold();
