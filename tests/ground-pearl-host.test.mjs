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
import { newResourceState, upgradeLoggingState } from '../server/resourceState.mjs';
import { newCommunityState } from '../server/communityProject.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { EventEmitter } from 'node:events';
import { makeDeath, planRequest, VICTIM, deathOp } from './helpers/death-storage.mjs';
import { database, reopenDatabase, adoptionId } from './helpers/ground-world-adoption-sql.mjs';

const SEED = 91, WORLD = 'ground-pearl-host';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = n => `af240000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = structuredClone, turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
  ping() {}
}

async function fixture(t, { commitHook = null, seedDeathRows = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ground-pearl-host-')), path = join(dir, 'db');
  let db = await database(path), host, restarted;
  t.after(async () => {
    try { await host?.close(); } catch { /* A fenced fixture cannot flush. */ }
    try { await restarted?.close(); } catch { /* A fenced fixture cannot flush. */ }
    await db.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-pearl-host-'));
    await rm(target, { recursive: true, force: true });
  });
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
  const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources,
    community: newCommunityState(WORLD, { madera: 4, piedra: 2 }) };
  await template.close();
  await db.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
  let deathSeed = null, ownerProfile = newProfile(); ownerProfile.pirateId = `account:${OWNER}`;
  ownerProfile.lvl = 3; ownerProfile.attr = { v: 1, carga: 2, re: 0 };
  ownerProfile.eco.pack.maxMass = 60;
  if (seedDeathRows) {
    const scene = makeDeath({ lawless: true, killer: false, loot: true, seed: 73 }); scene.world.tick = 500;
    const { request } = planRequest(scene, deathOp(780)); request.world = WORLD;
    const parsed = deathOperation({ ...request, operationId: request.operationId });
    ownerProfile = parsed.request.profiles.find(p => p.id === VICTIM).before;
    deathSeed = { operationId: request.operationId, family: 'death', operation: parsed.request };
  }
  assert.equal((await db.store.saveProfile(OWNER, ownerProfile, 0)).ok, true);
  const otherProfile = newProfile(); otherProfile.pirateId = `account:${OTHER}`;
  assert.equal((await db.store.saveProfile(OTHER, otherProfile, 0)).ok, true);
  const adoption = createSupabaseGroundWorldAdoption(db.adoptionClient);
  assert.equal((await adoption.adopt({ operationId: adoptionId(401), request: { world: WORLD,
    expectedWorldVersion: 7, worldData: data } })).ok, true);
  let transaction = null, hookEnabled = false;
  const sqlPageStore = (base, storage) => ({ ...base,
    async loadUnique(uid) {
      return (await storage.db.query('select public.mn_load_unique($1) as data', [uid])).rows[0].data;
    },
    async loadPearlLocation(uid) {
      return (await storage.db.query('select public.mn_load_pearl_location($1) as data', [uid])).rows[0].data;
    },
    async listPearlGround(world, options = {}) {
      const page = { world, afterUid: options.afterUid ?? null, limit: options.limit ?? 64 };
      const raw = (await storage.db.query('select public.mn_list_pearl_ground($1,$2,$3::integer) as data',
        [page.world, page.afterUid, page.limit])).rows[0].data;
      const { checkedGroundPage } = await import('../server/pearlGround.mjs');
      return checkedGroundPage(raw, page);
    },
    async listCurrentDeathDrops(world, options = {}) {
      const page = { world, after: options.after ?? null, limit: options.limit ?? 64 };
      const raw = (await storage.db.query('select public.mn_list_current_death_drops($1,$2::uuid,$3::integer,$4::integer) as data',
        [page.world, page.after?.operationId ?? null, page.after?.ordinal ?? null, page.limit])).rows[0].data;
      const { checkedCurrentDeathDropPage } = await import('../server/deathDropOperation.mjs');
      return checkedCurrentDeathDropPage(raw, page);
    },
  });
  const createHost = (storage = db) => {
    const base = storage.store;
    const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
      transaction = copy(raw);
      const result = await base.commitGroundTransaction(raw);
      if (commitHook && hookEnabled) await commitHook(raw, result);
      return result;
    } };
    return new GameHost({ seed: SEED, bots: 0, store, worldId: WORLD, log() {},
      resolvePlayer: async (_req, message) => message.token === 'owner' ? OWNER : message.token === 'other' ? OTHER : null,
      economicOperations: true, resourceOperations: true, loggingOperations: true,
      groundTransactions: { journal: storage.journal(WORLD) } });
  };
  host = createHost(); await host.prepare();
  if (deathSeed) await stageSeed(host, deathSeed);
  return { get db() { return db; }, setDb: value => { db = value; }, path, get host() { return restarted ?? host; },
    rawHost: () => host, createHost, setRestarted: value => { restarted = value; },
    armCommitHook: () => { hookEnabled = true; }, world: WORLD, transaction: () => transaction,
    currentStore: () => sqlPageStore(db.store, db) };
}

function pearlSeed(world, n = 50, { x = 1, z = -2, availableAt = 500, returnAt = 800 } = {}) {
  const operationId = ID(n), uid = `ground-pearl-seed-${n}`;
  const operation = groundOperation({ operationId, uid, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world, ground: { x, z, availableAt, returnAt }, profiles: [] }).request;
  return { operationId, family: 'ground', operation };
}

async function stageSeed(host, raw, apply = () => true) {
  const task = host.groundAuthority.stageFamily(raw, apply);
  for (let i = 0; i < 30 && host.groundAuthority.busy; i++) { await turn(); host.server.step(); }
  await host.groundAuthority.settle();
  if (host.groundAuthority.busy) host.server.step();
  return task;
}

function stepUntilHeld(host, limit = 2000, beforeStep = () => {}) {
  for (let i = 0; i < limit; i++) { beforeStep(); if (!host.server.step()) return; }
  const world = host.server.world;
  assert.fail(`ground pearl selector did not hold a step: tick=${world.tick}; drops=${JSON.stringify(managedPearls(world))}; ` +
    `status=${JSON.stringify(host.groundPearls.status())}`);
}

async function restartAndMount(f, { seed = true, pearlOptions = {} } = {}) {
  const first = f.rawHost();
  if (seed) await stageSeed(first, pearlSeed(WORLD, 50, pearlOptions));
  await first.close();
  const clock = await f.db.store.loadGroundClock(WORLD);
  await f.db.close();
  const reopened = await reopenDatabase(f.path); f.setDb(reopened);
  const host = f.createHost(reopened); f.setRestarted(host);
  const lifecycle = host.mountGroundPearls();
  await host.prepare();
  f.armCommitHook();
  return { host, lifecycle, clock };
}

async function joinPlayer(host, token = 'owner') {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-test' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

function managedPearls(world) { return [...world.drops.values()].filter(drop => drop.kind === 'pearl'); }

test('ordinary host stays unmounted; mount requires recovered GHA owner and empty tick-zero server', async t => {
  const h = new GameHost({ bots: 0, log() {} });
  try { assert.equal(h.groundPearls, null); assert.throws(() => h.mountGroundPearls(), { code: 'configuration' }); }
  finally { await h.close(); }
  const f = await fixture(t);
  const adoptedHost = f.rawHost();
  try {
    adoptedHost.server.connect(1);
    assert.throws(() => adoptedHost.mountGroundPearls(), { code: 'configuration' });
    assert.equal(adoptedHost.groundPearls, null);
  } finally { adoptedHost.server.disconnect(1); }
});

test('startup hydrates durable ground pearl rows after recovery and uses durable-to-local zero clock anchor', async t => {
  const f = await fixture(t), { host, lifecycle, clock } = await restartAndMount(f);
  try {
    assert.equal(lifecycle.status().ready, true);
    assert.equal(lifecycle.status().failed, false);
    assert.equal(host.groundAuthority.status().clock.tick, clock.tick);
    const drops = managedPearls(host.server.world);
    assert.equal(drops.length, 1);
    assert.equal(drops[0].groundClock.ground.availableAt, 500);
    assert.equal(drops[0].groundClock.ground.returnAt, 800);
    assert.equal(drops[0].t, 800 - clock.tick, 'the hosted deadline is projected from the local tick-zero anchor');
  } finally { await host.close().catch(() => {}); }
});

test('SQL current death-drop rows are checked but fail closed before host startup installs any rows', async t => {
  const f = await fixture(t, { seedDeathRows: true });
  const first = f.rawHost();
  await first.close(); await f.db.close();
  const reopened = await reopenDatabase(f.path); f.setDb(reopened);
  const host = f.createHost(reopened); f.setRestarted(host);
  const lifecycle = host.mountGroundPearls();
  try {
    await assert.rejects(host.prepare());
    assert.equal(lifecycle.status().ready, false);
    assert.equal(lifecycle.status().failed, true);
    assert.equal(host.server.world.drops.size, 0, 'current death-drop rows never become playable without their owner');
    assert.equal(host.server.world.pearlLedger.size, 0);
    assert.equal(host.status().storage.groundPearls.failed, true);
  } finally { await host.close().catch(() => {}); }
});

test('authenticated pickup waits for common SQL receipt and applies once at boundary with session/profile CAS', async t => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  const { host, lifecycle } = await restartAndMount(f);
  try {
    const player = await joinPlayer(host); const drop = managedPearls(host.server.world)[0];
    const profile = host.server.world.profiles.get(player.entity); const before = copy(profile);
    host.server.world.ecs.x[player.entity] = drop.x; host.server.world.ecs.z[player.entity] = drop.z;
    stepUntilHeld(host); await entered.promise;
    assert.equal(lifecycle.status().pending, 1); assert.deepEqual(profile, before);
    assert.equal(host.server.world.drops.has(drop.id), true);
    assert.equal(player.socket.messages.filter(m => m.t === MSG.EVENT && m.ev.type === 'pickup').length, 0);
    assert.equal(host.server.step(), false);
    gate.resolve(); await host.groundAuthority.settle();
    assert.deepEqual(profile, before, 'SQL completion does not mutate profile before the synchronous drain');
    assert.equal(host.server.step(), true);
    assert.equal(host.server.world.drops.has(drop.id), false);
    assert.equal(profile.pearls.bag.at(-1).uid, drop.pearl.uid);
    assert.equal(host.groundAuthority.status().clock.tick, f.transaction().request.clock.tick);
    const saved = await f.db.store.loadProfile(OWNER);
    assert.equal(saved.version, 2); assert.equal(saved.data.pearls.bag.at(-1).uid, drop.pearl.uid);
    assert.deepEqual(profile.attr, before.attr); assert.deepEqual(saved.data.attr, before.attr);
    assert.deepEqual(saved.data.carry, before.carry);
    assert.equal(saved.data.eco.pack.cap, 18); assert.equal(saved.data.eco.pack.maxMass, 60);
    assert.equal(saved.data.lvl, 3, 'pickup preserves the merged INV02b attribute budget');
    assert.equal(f.transaction().request.family, 'ground');
  } finally { gate.resolve(); await host.close(); }
});

test('pickup rejects early, distant and full receivers without a family journal operation', async t => {
  const f = await fixture(t), { host, lifecycle } = await restartAndMount(f,
    { pearlOptions: { availableAt: 503, returnAt: 800 } });
  try {
    const player = await joinPlayer(host), drop = managedPearls(host.server.world)[0];
    const transactionBefore = f.transaction()?.operationId;
    host.server.world.ecs.x[player.entity] = drop.x; host.server.world.ecs.z[player.entity] = drop.z;
    assert.equal(host.server.world.tick, 0); assert.equal(host.server.step(), true, 'too early leaves the pearl untouched');
    host.server.world.ecs.x[player.entity] = drop.x + 100;
    host.server.world.ecs.z[player.entity] = drop.z;
    while (host.server.world.tick <= drop.pickAt) assert.equal(host.server.step(), true);
    assert.equal(host.server.world.drops.has(drop.id), true);
    const full = host.server.world.profiles.get(player.entity);
    full.pearls.bag = Array.from({ length: 8 }, (_, i) => ({ uid: `full-${i}`, kind: 'brasa' }));
    host.server.world.ecs.x[player.entity] = drop.x; host.server.world.ecs.z[player.entity] = drop.z;
    while (host.server.world.tick % 3 || host.server.world.tick < drop.pickAt + 1) assert.equal(host.server.step(), true);
    assert.equal(host.server.step(), true);
    assert.equal(host.server.world.drops.has(drop.id), true);
    assert.equal(f.transaction()?.operationId, transactionBefore);
    assert.equal(lifecycle.status().pending, 0);
  } finally { await host.close().catch(() => {}); }
});

test('automatic return then restart hydration maps current row version into the next pickup', async t => {
  const f = await fixture(t), { host, lifecycle } = await restartAndMount(f,
    { pearlOptions: { availableAt: 500, returnAt: 501 } });
  try {
    const original = managedPearls(host.server.world)[0], originalId = original.id;
    stepUntilHeld(host);
    await host.groundAuthority.settle();
    assert.equal(host.server.step(), true);
    assert.equal(host.server.world.drops.has(originalId), false);
    let returned = managedPearls(host.server.world)[0];
    assert.ok(returned); assert.notEqual(returned.id, originalId);
    assert.equal((await f.currentStore().loadUnique(original.pearl.uid)).version, 2);
    const returnedLocation = await f.currentStore().loadPearlLocation(original.pearl.uid);
    assert.equal(returnedLocation.version, 2);
    assert.equal(returned.groundClock.ground.returnAt, returnedLocation.ground.returnAt);

    await host.close(); await f.db.close();
    const reopened = await reopenDatabase(f.path); f.setDb(reopened);
    const resumed = f.createHost(reopened); f.setRestarted(resumed);
    const resumedLifecycle = resumed.mountGroundPearls(); await resumed.prepare();
    assert.equal(resumedLifecycle.status().ready, true);
    returned = managedPearls(resumed.server.world)[0];
    assert.equal(returned.pearl.uid, original.pearl.uid);
    assert.equal(returnedLocation.version, 2, 'restart hydrates the returned generation, not the earlier row');

    while (resumed.server.world.tick < returned.pickAt) assert.equal(resumed.server.step(), true);
    const player = await joinPlayer(resumed), profile = resumed.server.world.profiles.get(player.entity);
    resumed.server.world.ecs.x[player.entity] = returned.x;
    resumed.server.world.ecs.z[player.entity] = returned.z;
    const pickup = resumedLifecycle.pickup({ dropId: returned.id,
      receiver: { clientId: player.clientId, entity: player.entity } });
    let applied = false;
    for (let i = 0; i < 20; i++) {
      if (resumed.server.step()) { applied = true; break; }
      await resumed.groundAuthority.settle();
    }
    assert.equal(applied, true); await pickup.result;
    assert.equal(profile.pearls.bag.at(-1).uid, original.pearl.uid);
    assert.equal((await f.currentStore().loadUnique(original.pearl.uid)).version, 3);
    assert.deepEqual(await f.currentStore().loadPearlLocation(original.pearl.uid), { world: WORLD, ground: null, version: 3 });
    assert.equal(f.transaction().request.operation.expectedVersion, 2);
  } finally { await host.close().catch(() => {}); }
});

test('rejoin at a checkpoint retains hydrated source without replaying an old world snapshot', async t => {
  const f = await fixture(t), { host, lifecycle } = await restartAndMount(f);
  try {
    assert.equal(lifecycle.status().ready, true);
    await joinPlayer(host);
    const drop = managedPearls(host.server.world)[0];
    host.server.world.economy.acc += 0.1;
    host.worldState.save(host.server.world.economy);
    const beforeCheckpoint = host.worldState.version;
    for (let i = 0; i < 30 && host.worldState.version === beforeCheckpoint; i++) { await turn(); host.server.step(); }
    await host.worldState.flush();
    assert.equal(host.worldState.failed, false);
    assert.equal((await f.db.store.loadWorld(WORLD)).version, host.worldState.version);
    assert.equal(managedPearls(host.server.world)[0].pearl.uid, drop.pearl.uid);
  } finally { await host.close(); }
});

test('disconnecting the pickup receiver while SQL is pending fences apply', async t => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  const { host } = await restartAndMount(f);
  try {
    const player = await joinPlayer(host), drop = managedPearls(host.server.world)[0];
    host.server.world.ecs.x[player.entity] = drop.x; host.server.world.ecs.z[player.entity] = drop.z;
    stepUntilHeld(host); await entered.promise;
    host.server.disconnect(player.clientId); gate.resolve(); await host.groundAuthority.settle();
    assert.equal(host.server.step(), false);
    assert.equal(host.groundPearls.status().failed, true);
    assert.equal(host.server.world.drops.has(drop.id), true);
    assert.equal((await f.db.store.loadProfile(OWNER)).version, 2, 'the already committed SQL receipt remains durable');
  } finally { gate.resolve(); await host.close().catch(() => {}); }
});

test('shutdown after SQL commit but before the prepared receipt drain never applies pickup', async t => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(t, { commitHook: async () => { entered.resolve(); await gate.promise; } });
  const { host } = await restartAndMount(f);
  const player = await joinPlayer(host), drop = managedPearls(host.server.world)[0];
  const profile = host.server.world.profiles.get(player.entity), before = copy(profile);
  try {
    host.server.world.ecs.x[player.entity] = drop.x; host.server.world.ecs.z[player.entity] = drop.z;
    stepUntilHeld(host); await entered.promise;
    const shutdown = host.close();
    await turn(); gate.resolve(); await assert.rejects(shutdown, { code: 'flush' });
    assert.deepEqual(profile, before);
    assert.equal(host.server.world.drops.has(drop.id), true);
    assert.equal(host.server.world.events.filter(event => event.type === 'pickup').length, 0);
    assert.equal(host.groundPearls.status().failed, true);
    const persisted = await f.currentStore().loadProfile(OWNER);
    assert.equal(persisted.version, 2, 'SQL receipt may be durable although shutdown suppresses gameplay apply');
  } finally { gate.resolve(); await host.close().catch(() => {}); }
});

test('replacing the GHA before mounting cannot install or activate lifecycle ownership', async t => {
  const f = await fixture(t), host = f.rawHost();
  try {
    host.server.beforeTick = () => true;
    assert.throws(() => host.mountGroundPearls(), { code: 'configuration' });
    assert.equal(host.groundPearls, null);
  } finally { await host.close().catch(() => {}); }
});
