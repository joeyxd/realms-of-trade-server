import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createSupabaseGroundWorldAdoption } from '../server/groundWorldAdoption.mjs';
import { groundOperation } from '../server/pearlGround.mjs';
import { deathOperation } from '../server/deathOperation.mjs';
import { deathDropOperation } from '../server/deathDropOperation.mjs';
import { batchOperation } from '../server/pearlBatch.mjs';
import { newResourceState, upgradeLoggingState } from '../server/resourceState.mjs';
import { newCommunityState } from '../server/communityProject.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { makeDeath, planRequest, VICTIM, KILLER, WORLD as DEATH_WORLD, deathOp, seedDeathStore } from './helpers/death-storage.mjs';
import { expectedPickupProfile } from './helpers/death-drop-storage.mjs';
import { database, reopenDatabase, adoptionId } from './helpers/ground-world-adoption-sql.mjs';

const SEED = 91;
const ID = n => `af230000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const turn = () => new Promise(resolve => setImmediate(resolve));
const copy = structuredClone;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function setup(t, { world = 'ground-family-host', account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', commitHook = null, seedProfile = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ground-family-host-')), path = join(dir, 'db');
  let db = await database(path);
  let host, restarted;
  t.after(async () => {
    try { await host?.close(); } catch { /* A fenced test host cannot flush. */ }
    try { await restarted?.close(); } catch { /* A fenced test host cannot flush. */ }
    await db.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-family-host-'));
    await rm(target, { recursive: true, force: true });
  });
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
  const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources,
    community: newCommunityState(world, { madera: 4, piedra: 2 }) };
  await template.close();
  await db.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [world, data]);
  const profile = newProfile(); profile.pirateId = `account:${account}`;
  if (seedProfile) assert.equal((await db.store.saveProfile(account, profile, 0)).ok, true);
  const adoption = createSupabaseGroundWorldAdoption(db.adoptionClient);
  assert.equal((await adoption.adopt({ operationId: adoptionId(301), request: { world, expectedWorldVersion: 7, worldData: data } })).ok, true);
  let lastTransaction = null;
  const createHost = (storage = db) => {
    const baseStore = storage.store;
    const store = storage === db ? { ...baseStore, async commitGroundTransaction(raw) {
      lastTransaction = copy(raw);
      if (commitHook) await commitHook(raw);
      return baseStore.commitGroundTransaction(raw);
    } } : baseStore;
    return new GameHost({ seed: SEED, bots: 0, store, worldId: world, log() {},
      resolvePlayer: async () => account, economicOperations: true, resourceOperations: true, loggingOperations: true,
      groundTransactions: { journal: storage.journal(world) } });
  };
  host = createHost(); await host.prepare();
  return { get db() { return db; }, setDb: value => { db = value; }, path, host, world, account, profile, data, createHost, setRestarted: value => { restarted = value; },
    transaction: () => lastTransaction };
}

function mint(world, n = 10) {
  const operationId = ID(n), uid = `family-pearl-${n}`;
  const operation = groundOperation({ operationId, uid, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world, ground: { x: 2, z: 3, availableAt: 500, returnAt: 800 }, profiles: [] }).request;
  return { operationId, family: 'ground', operation };
}

test('ground family waits for the sole tick boundary, commits SQL023 atomically, and checkpoint follows its version', async t => {
  const gate = deferred(), entered = deferred();
  const f = await setup(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  let applied = 0, settled = false;
  const task = f.host.groundAuthority.stageFamily(mint(f.world), effect => { applied++; assert.equal(effect.location.uid, 'family-pearl-10'); return true; });
  task.finally(() => { settled = true; }).catch(() => {});
  await entered.promise;
  assert.equal(f.host.worldState.operationBusy, true);
  assert.equal(f.host.server.step(), false, 'pending storage holds the simulation before the receipt is applied');
  assert.equal(f.host.server.world.tick, 0); assert.equal(applied, 0); assert.equal(settled, false);
  gate.resolve(); await f.host.groundAuthority.settle();
  assert.equal(applied, 0, 'SQL completion only prepares the apply');
  assert.equal(f.host.server.step(), true, 'the prepared family applies at the boundary, then simulation advances');
  const effect = await task;
  assert.equal(effect.location.uid, 'family-pearl-10'); assert.equal(applied, 1);
  assert.equal(f.host.worldState.operationBusy, false); assert.equal(f.host.worldState.version, 8);
  const savedWorld = await f.db.store.loadWorld(f.world), savedClock = await f.db.store.loadGroundClock(f.world);
  assert.equal(savedWorld.version, 8); assert.deepEqual(savedWorld.data.resources, f.data.resources);
  assert.equal(savedClock.tick, 500); assert.equal(savedClock.version, 1);

  const rawTx = f.transaction(); assert.equal(rawTx.request.family, 'ground');
  assert.equal((await f.db.store.commitGroundTransaction(rawTx)).replay, true, 'the exact frozen transaction replays once');
  const standalone = (await f.db.db.query('select public.mn_commit_pearl_ground($1::uuid,$2::jsonb) as data',
    [ID(10), { ...mint(f.world).operation, operationId: ID(10) }])).rows[0].data;
  assert.deepEqual(standalone, { ok: false, why: 'operation' }, 'SQL023 rejects a parallel legacy writer');

  f.host.server.world.economy.acc += 0.25;
  const checkpointAcc = f.host.server.world.economy.acc;
  f.host.worldState.save(f.host.server.world.economy);
  for (let i = 0; i < 12 && f.host.worldState.version === 8; i++) {
    await turn(); f.host.server.step();
  }
  await f.host.worldState.flush();
  assert.equal(f.host.worldState.failed, false); assert.equal(f.host.worldState.version, 9);
  assert.equal((await f.db.store.loadWorld(f.world)).data.economy.acc, checkpointAcc,
    'the following checkpoint uses the family transaction version, avoiding a stale CAS');

  await f.host.close(); const clock = await f.db.store.loadGroundClock(f.world); await f.db.close();
  const reopened = await reopenDatabase(f.path); f.setDb(reopened);
  const restarted = f.createHost(reopened); f.setRestarted(restarted); await restarted.prepare();
  assert.equal(restarted.groundAuthority.status().clock.tick, clock.tick);
  assert.deepEqual(restarted.worldState.snapshot(restarted.server.world.economy), (await f.db.store.loadWorld(f.world)).data,
    'restart loads the current committed world instead of a historical family snapshot');
});

test('whole-death and managed-drop families share the same adopted-world transaction boundary', async t => {
  const f = await setup(t, { world: DEATH_WORLD, account: VICTIM, seedProfile: false });
  const scene = makeDeath({ lawless: true, killer: true, loot: true, seed: 73 }); scene.world.tick = 500;
  const planned = planRequest(scene, deathOp(40));
  const seeded = await seedDeathStore(f.db.store, scene, planned.request);
  const death = deathOperation(planned.request).request;
  const deathRaw = { operationId: planned.request.operationId, family: 'death', operation: death };
  let deathApplied = 0;
  const deathEffect = await drainFamily(f.host, deathRaw, effect => { deathApplied++; assert.ok(effect.drops.length); return true; });
  assert.equal(deathApplied, 1); assert.ok(deathEffect.drops.length);
  for (const p of planned.request.profiles) {
    const stored = await f.db.store.loadProfile(p.id); assert.deepEqual(stored.data, p.data);
  }
  const rows = (await f.db.db.query('select public.mn_list_current_death_drops($1,null,null,64) as data', [DEATH_WORLD])).rows[0].data;
  const item = rows.find(row => row.kind === 'item'); assert.ok(item);
  const receiver = await f.db.store.loadProfile(KILLER);
  const dropOperation = deathDropOperation({ operationId: ID(41), world: DEATH_WORLD, mode: 'pickup', at: f.host.groundAuthority.logicalTick(),
    drop: { operationId: item.operationId, ordinal: item.ordinal, world: item.world, victim: item.victim,
      kind: item.kind, item: item.item, ground: item.ground, expectedVersion: item.version },
    profile: { id: KILLER, expectedVersion: receiver.version, before: receiver.data,
      data: expectedPickupProfile(item, receiver.data) } }).request;
  let dropApplied = 0;
  const dropEffect = await drainFamily(f.host, { operationId: ID(41), family: 'drop', operation: dropOperation },
    effect => { dropApplied++; assert.equal(effect.drop.state, 'picked'); return true; });
  assert.equal(dropApplied, 1); assert.equal(dropEffect.drop.state, 'picked');
  const state = (await f.db.db.query('select state from public.mn_death_drop_states where operation_id=$1::uuid and ordinal=$2',
    [item.operationId, item.ordinal])).rows[0].state;
  assert.equal(state, 'picked');
  assert.equal(seeded.victim.version, planned.request.profiles.find(p => p.id === VICTIM).expectedVersion);
});

test('batch family moves an owned pearl through the adopted transaction writer', async t => {
  const f = await setup(t), uid = 'batch-family-held';
  const before = await f.db.store.loadProfile(f.account), held = copy(before.data);
  held.pearls.bag.push({ uid, kind: 'brasa' });
  const pickup = groundOperation({ operationId: ID(50), uid, kind: 'brasa', from: null, to: f.account,
    expectedVersion: 0, world: f.world, ground: null,
    profiles: [{ id: f.account, expectedVersion: before.version, data: held }] }).request;
  await drainFamily(f.host, { operationId: ID(50), family: 'ground', operation: pickup }, () => true);

  const current = await f.db.store.loadProfile(f.account), spilled = copy(current.data);
  spilled.pearls.bag = [];
  const batch = batchOperation({ operationId: ID(51), world: f.world, mode: 'death',
    profile: { id: f.account, expectedVersion: current.version, data: spilled },
    items: [{ uid, kind: 'brasa', expectedVersion: 1,
      ground: { x: 4, z: 5, availableAt: 501, returnAt: 900 } }] }).request;
  let applied = 0;
  const effect = await drainFamily(f.host, { operationId: ID(51), family: 'batch', operation: batch }, value => {
    applied++; assert.equal(value.uniques[0].holder, null); return true;
  });
  assert.equal(applied, 1); assert.equal(effect.locations[0].ground.availableAt, 501);
  assert.deepEqual((await f.db.store.loadProfile(f.account)).data.pearls, { bag: [], swallowed: null });
});

async function drainFamily(host, raw, apply) {
  const task = host.groundAuthority.stageFamily(raw, apply);
  for (let i = 0; i < 30; i++) {
    await turn();
    if (!host.server.step() && host.groundAuthority.status().failed) break;
    if (!host.groundAuthority.busy) break;
  }
  await host.groundAuthority.settle();
  if (host.groundAuthority.busy) host.server.step();
  const effect = await task;
  const world = await host.store.loadWorld(host.worldState.id), clock = await host.store.loadGroundClock(host.worldState.id);
  assert.equal(world.version, host.worldState.version, `${raw.family} effect and snapshot commit share one world version`);
  assert.equal(world.data.resources.tick, clock.tick, `${raw.family} effect and resource snapshot share one durable clock`);
  assert.deepEqual(clock, host.groundAuthority.status().clock);
  return effect;
}

for (const [label, apply] of [
  ['false result', () => false], ['throw', () => { throw new Error('apply fault'); }],
  ['async result', () => Promise.resolve(true)],
]) test(`a ${label} callback fences the family reservation and never resolves as applied`, async t => {
  const f = await setup(t), task = f.host.groundAuthority.stageFamily(mint(f.world, 20 + label.length), apply);
  const rejected = assert.rejects(task, error => ['effect', 'operation', 'unavailable'].includes(error.code));
  for (let i = 0; i < 20 && f.host.groundAuthority.busy; i++) { await turn(); f.host.server.step(); }
  await f.host.groundAuthority.settle(); f.host.server.step();
  await rejected;
  assert.equal(f.host.groundAuthority.status().failed, true); assert.equal(f.host.worldState.failed, true);
  assert.equal(f.host.worldState.operationBusy, true, 'fenced state stays unavailable until restart');
  assert.equal(f.host.server.step(), false);
});

test('stop while SQL is completing rejects the family result without applying gameplay', async t => {
  const gate = deferred(), entered = deferred();
  const f = await setup(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  let applied = 0;
  const task = f.host.groundAuthority.stageFamily(mint(f.world, 30), () => { applied++; return true; });
  const rejected = assert.rejects(task, { code: 'cancelled' });
  await entered.promise;
  f.host.groundAuthority.stop();
  gate.resolve(); await f.host.groundAuthority.settle(); await rejected;
  assert.equal(applied, 0); assert.equal(f.host.server.step(), false);
  assert.equal(f.host.worldState.version, 7, 'shutdown never advances the in-memory world for a prepared family');
});

test('replacing the boundary owner fences an active family before its callback can run', async t => {
  const gate = deferred(), entered = deferred();
  const f = await setup(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  let applied = 0;
  const task = f.host.groundAuthority.stageFamily(mint(f.world, 31), () => { applied++; return true; });
  const rejected = assert.rejects(task);
  await entered.promise;
  f.host.server.beforeTick = () => true;
  gate.resolve(); await f.host.groundAuthority.settle(); await rejected;
  assert.equal(applied, 0); assert.equal(f.host.worldState.failed, true);
  assert.equal(f.host.groundAuthority.status().failed, true);
});
