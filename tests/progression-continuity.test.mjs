import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { TOWNS } from '../src/data/towns.js';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { GameHost } from '../server/host.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const migration = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const account = id(701), worldId = 'progression-continuity', seed = 704;
const worldData = () => ({ v: 1, seed, economy: new Economy(seed).serialize() });
const command = opId => ({ type: 'commerce', op: 'buy', opId,
  town: 'aldea', g: 'madera', n: 1, expectedTotal: 1 });
const deniedAck = cmd => ({ type: cmd.type, op: cmd.op, opId: cmd.opId, ok: false, why: 'price', rev: 0 });
const operation = ({ operationId, profile, profileVersion = 1, worldVersion = 1, data = worldData(), cmd }) => ({
  operationId,
  request: { world: worldId, account, command: cmd, expectedProfileVersion: profileVersion,
    expectedWorldVersion: worldVersion, profile, worldData: data, ack: deniedAck(cmd) },
});

function connect(host, name) {
  const ws = new EventEmitter();
  ws.readyState = 1; ws.messages = [];
  ws.send = data => ws.messages.push(JSON.parse(data));
  ws.ping = () => {};
  ws.close = () => {
    if (ws.readyState !== 1) return;
    ws.readyState = 3; ws.emit('close');
  };
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const send = message => ws.emit('message', Buffer.from(JSON.stringify(message)), false);
  return { id, ws, hello: () => send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name }),
    send: command => send({ t: MSG.CMD, ...command }),
    of: type => ws.messages.filter(message => message.t === type),
    events: opId => ws.messages.filter(message => message.t === MSG.EVENT && message.ev?.opId === opId)
      .map(message => message.ev) };
}

function calmAt(host, entity, point) {
  const world = host.server.world, ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = world.map.groundAt(point.x, point.z);
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0;
  ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

async function submitAndApply(host, client, command) {
  client.send(command);
  await new Promise(resolve => setImmediate(resolve));
  await host.economicAuthority.settle();
  host.server.step();
  return client.events(command.opId).at(-1);
}

function sqlAdapter(db) {
  return createSupabaseStore({ async rpc(name, args) {
    const routes = {
      mn_commit_economic_operation: ['public.mn_commit_economic_operation($1::uuid,$2::jsonb)',
        [args.p_operation_id, args.p_request]],
      mn_load_economic_operation: ['public.mn_load_economic_operation($1::uuid)', [args.p_operation_id]],
      mn_load_profile: ['public.mn_load_profile($1::uuid)', [args.p_player_id]],
      mn_save_profile: ['public.mn_save_profile($1::uuid,$2::jsonb,$3::integer)',
        [args.p_player_id, args.p_data, args.p_expected_version]],
    };
    const route = routes[name];
    if (!route) throw new Error(`Unexpected RPC ${name}`);
    const data = (await db.query(`select ${route[0]} as data`, route[1])).rows[0].data;
    return { data, error: null };
  } });
}

test('legacy profile sanitation keeps the old shape while absent progression reads as zero', () => {
  const legacy = newProfile(); delete legacy.progression;
  const clean = sanitizeProfile(legacy);
  assert.ok(clean);
  assert.equal(Object.hasOwn(clean, 'progression'), false);
  assert.deepEqual(readProgression(clean.progression), {
    v: 1, practice: { logging: 0 }, milestones: [], knowledge: [],
  });
  assert.ok(Object.hasOwn(newProfile(), 'progression'));
});

test('memory store round-trips progression and current economic commands preserve it', async () => {
  const store = createMemoryStore(), p = newProfile();
  p.pirateId = `account:${account}`;
  p.progression.practice.logging = 60;
  p.progression.milestones.push('logging_steady');
  await store.initializeProfile(account, p);
  await store.saveWorld(worldId, worldData(), 0);
  assert.deepEqual((await store.loadProfile(account)).data.progression, p.progression);

  const cmd = command(id(702)), raw = operation({ operationId: id(702), profile: structuredClone(p), cmd });
  const result = await store.commitEconomicOperation(raw);
  assert.equal(result.ok, true);
  assert.deepEqual((await store.loadProfile(account)).data.progression, p.progression);
});

test('SQL014 keeps a legacy immutable receipt replayable after newer progression is saved', async t => {
  const f = await database();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE'); await f.db.exec(migration); await f.db.exec(migration); await f.db.exec('SET ROLE service_role');
  const store = sqlAdapter(f.db), legacy = newProfile();
  delete legacy.progression;
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, legacy]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, worldData()]);

  const firstId = id(703), firstCommand = command('legacy-commerce');
  const first = operation({ operationId: firstId, profile: legacy, cmd: firstCommand });
  assert.equal((await store.commitEconomicOperation(first)).ok, true);
  const receipt = await store.loadEconomicOperation(firstId);
  assert.equal(Object.hasOwn(receipt.request.profile, 'progression'), false,
    'receipt reconstruction preserves the historical request shape');

  // Test-only server-side snapshot staging. This is not evidence that gameplay awarded logging practice.
  const current = structuredClone(legacy);
  current.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  assert.deepEqual(await store.saveProfile(account, current, 2), { ok: true, version: 3 });
  assert.deepEqual((await store.loadProfile(account)).data.progression, current.progression,
    'the Supabase adapter round-trips the current profile field');

  const replay = await store.commitEconomicOperation(first);
  assert.equal(replay.replay, true);
  assert.equal(Object.hasOwn((await store.loadEconomicOperation(firstId)).request.profile, 'progression'), false);
  assert.deepEqual(await store.loadProfile(account), { data: current, version: 3 },
    'replaying a historical receipt cannot install its old profile or lower the profile version');

  const next = structuredClone(current), nextCommand = command('current-commerce');
  const nextOperation = operation({ operationId: id(704), profile: next, profileVersion: 3,
    worldVersion: 2, data: worldData(), cmd: nextCommand });
  assert.equal((await store.commitEconomicOperation(nextOperation)).ok, true);
  assert.deepEqual((await store.loadProfile(account)).data.progression, current.progression,
    'a new existing M5 command preserves current progression');
});

test('malformed and future progression reject session admission without saving over the row', async () => {
  const corruptions = [
    { v: 1, practice: { logging: -1 }, milestones: [], knowledge: [] },
    { v: 2, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] },
  ];
  for (const progression of corruptions) {
    const raw = newProfile(); raw.progression = progression;
    let saves = 0;
    const store = {
      async loadProfile() { return { data: structuredClone(raw), version: 7 }; },
      async saveProfile() { saves++; throw new Error('must not overwrite a corrupt profile'); },
      async loadUnique() { return null; },
    };
    const sessions = new ProfileSessions(store);
    await assert.rejects(sessions.open(1, account), { code: 'profile' });
    assert.equal(saves, 0);
    assert.deepEqual(raw.progression, progression, 'the invalid stored row remains untouched');
  }
});

test('GameHost preserves current progression through an economic buy and historical replay after reopen', async t => {
  const store = createMemoryStore(), profile = newProfile();
  profile.pirateId = `account:${account}`;
  profile.gold = 1000;
  profile.eco.pack.goods.fruta = 2;
  profile.progression.practice.logging = 60;
  profile.progression.milestones.push('logging_steady');
  await store.initializeProfile(account, profile);
  assert.equal(store.durable, false, 'memory fixture cannot establish process-crash durability');

  const makeHost = () => new GameHost({ seed: 71, bots: 0, log: () => {}, store,
    saves: hmacSaves('progression-continuity-test-key'), resolvePlayer: async () => account,
    initializeAccounts: true, worldId, economicOperations: true });
  const host1 = makeHost();
  let host2 = null;
  t.after(async () => {
    for (const host of [host1, host2]) if (host && !host.closePromise) {
      try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    }
  });
  await host1.prepare();
  const client1 = connect(host1, 'Progression continuity'); client1.hello(); await Promise.all([...host1.joins]);
  const entity1 = host1.server.clients.get(client1.id).entity;
  const before = structuredClone(profile.progression);
  assert.deepEqual(host1.server.world.profiles.get(entity1).progression, before);
  const town = TOWNS.aldea, market = host1.server.world.map.landmarks[town.landmark] || host1.server.world.map[town.landmark];
  calmAt(host1, entity1, market);
  const quote = host1.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  const buy = { type: 'commerce', op: 'buy', opId: 'continuity-buy', town: 'aldea', g: 'fruta', n: 1,
    expectedTotal: quote.total };
  assert.equal((await submitAndApply(host1, client1, buy))?.ok, true);
  assert.equal(host1.server.world.profiles.get(entity1).eco.pack.goods.fruta, 3);
  assert.deepEqual(host1.server.world.profiles.get(entity1).progression, before);
  assert.deepEqual(client1.of(MSG.PROFILE).at(-1)?.p?.progression, before,
    'the authoritative profile publication contains the preserved progression');
  assert.deepEqual((await store.loadProfile(account)).data.progression, before);
  await host1.close();

  host2 = makeHost();
  await host2.prepare();
  const client2 = connect(host2, 'Progression continuity'); client2.hello(); await Promise.all([...host2.joins]);
  const entity2 = host2.server.clients.get(client2.id).entity;
  const storedBeforeReplay = await store.loadProfile(account);
  assert.deepEqual(host2.server.world.profiles.get(entity2).progression, before);
  const replay = await submitAndApply(host2, client2, buy);
  assert.equal(replay?.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.historical, true);
  assert.equal(host2.server.world.profiles.get(entity2).eco.pack.goods.fruta, 3,
    'historical replay cannot award the purchased good twice');
  assert.deepEqual(host2.server.world.profiles.get(entity2).progression, before);
  assert.deepEqual(await store.loadProfile(account), storedBeforeReplay,
    'replay does not rewrite the current profile or advance its version');
  t.diagnostic('Memory-store host reopen/replay only; this is not durable crash-recovery evidence.');
});
