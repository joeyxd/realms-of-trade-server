import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { createSupabaseGroundWorldAdoption } from '../../server/groundWorldAdoption.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { newCommunityState } from '../../server/communityProject.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, sanitizeCmd } from '../../src/net/protocol.js';
import { C } from '../../src/sim/ecs.js';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { makeDeath, planRequest, deathOp, VICTIM, KILLER } from './death-storage.mjs';

export const WORLD = 'ground-death-host';
export const SEED = 91;
export const OWNER = VICTIM;
export const OTHER = KILLER;
export const turn = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const command = n => sanitizeCmd({ seq: n, pt: n, mx: 1, mz: 1, ax: 10, az: 10, btn: 0x3ff, prs: 0x3ff, w: 1 });

export class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

export async function fixture(t, { commitHook = null, pearlCount = 2, thirdPlayer = false,
  lawless = true, killer = true, loot = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ground-death-host-')), path = join(dir, 'db');
  let db = await database(path), host, restarted;
  t.after(async () => {
    try { await host?.close(); } catch { /* A fenced host can retain failed profile writes. */ }
    try { await restarted?.close(); } catch { /* Startup recovery fixtures can be fenced too. */ }
    await db.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-death-host-'));
    await rm(target, { recursive: true, force: true });
  });

  const scene = makeDeath({ lawless, killer, loot, pearlCount, seed: 73 });
  scene.world.tick = 500;
  const planned = planRequest(scene);
  planned.request.world = WORLD;
  const third = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if (thirdPlayer) {
    const profile = newProfile(); profile.pirateId = `account:${third}`;
    assert.equal((await db.store.saveProfile(third, profile, 0)).ok, true);
  }
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
  const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources,
    community: newCommunityState(WORLD, { madera: 4, piedra: 2 }) };
  await template.close();
  await db.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
  const adoption = createSupabaseGroundWorldAdoption(db.adoptionClient);
  const adopted = await adoption.adopt({ operationId: adoptionId(451), request: {
    world: WORLD, expectedWorldVersion: 7, worldData: data } });
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  const seeded = await seedDeathProfiles(db, planned.request);

  let lastTransaction = null, transactions = [], hold = false;
  const createHost = (storage = db) => {
    const base = composedStore(storage);
    const store = { ...base, async commitGroundTransaction(raw) {
      lastTransaction = structuredClone(raw); transactions.push(lastTransaction);
      const result = await base.commitGroundTransaction(raw);
      if (hold && commitHook && raw.request?.family === 'death') await commitHook(raw, result);
      return result;
    } };
    return new GameHost({ seed: SEED, bots: 0, store, worldId: WORLD, log() {},
      resolvePlayer: async (_req, msg) => msg.token === 'owner' ? OWNER : msg.token === 'other' ? OTHER :
        msg.token === 'third' ? third : null,
      economicOperations: true, resourceOperations: true, loggingOperations: true,
      groundTransactions: { journal: storage.journal(WORLD) } });
  };
  host = createHost();
  host.mountGroundPearls();
  host.mountGroundDeaths();
  await host.prepare();
  return { get db() { return db; }, setDb: value => { db = value; }, path,
    get host() { return restarted ?? host; }, rawHost: () => host, createHost,
    setRestarted: value => { restarted = value; }, armCommitHook: () => { hold = true; },
    lastTransaction: () => lastTransaction, transactions, world: WORLD, seeded, third,
    async close() { await host?.groundAuthority?.settle(); await host?.close().catch(() => {}); await db.close(); } };
}

export async function restart(f) {
  const first = f.rawHost();
  await first.close(); await f.db.close();
  const reopened = await reopenDatabase(f.path); f.setDb(reopened);
  const host = f.createHost(reopened); f.setRestarted(host);
  const pearls = host.mountGroundPearls();
  const deaths = host.mountGroundDeaths();
  await host.prepare();
  return { host, pearls, deaths };
}

export async function joinPlayer(host, token = 'owner') {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-death-test' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

export function placeInCala(host, ...players) {
  const w = host.server.world, point = w.map.cala;
  players.forEach((p, i) => { w.ecs.x[p.entity] = point.x + i * 8; w.ecs.z[p.entity] = point.z; });
  for (let id = 1; id < w.ecs.cap; id++) if (w.ecs.mask[id] & C.ENEMY) { w.ecs.alive[id] = 0; w.ecs.mask[id] = 0; }
  w.events.length = 0; w.profileDirty.clear(); players.forEach(p => { p.socket.messages.length = 0; });
}

export const events = (player, type) => player.socket.messages.filter(m => m.t === MSG.EVENT && m.ev.type === type);
export const neutral = n => sanitizeCmd({ seq: n, pt: n, mx: 0, mz: 0, ax: 20, az: 20, btn: 0, prs: 0 });

export function composedStore(storage) {
  const query = async (sql, args) => (await storage.db.query(sql, args)).rows[0].data;
  return { ...storage.store,
    async loadUnique(uid) { return query('select public.mn_load_unique($1) as data', [uid]); },
    async loadPearlLocation(uid) { return query('select public.mn_load_pearl_location($1) as data', [uid]); },
    async listPearlGround(world, { afterUid = null, limit = 128 } = {}) {
      return query('select public.mn_list_pearl_ground($1,$2,$3) as data', [world, afterUid, limit]);
    },
    async listCurrentDeathDrops(world, options = {}) {
      const after = options.after ?? null, limit = options.limit ?? 64;
      const raw = await query('select public.mn_list_current_death_drops($1,$2::uuid,$3::integer,$4::integer) as data',
        [world, after?.operationId ?? null, after?.ordinal ?? null, limit]);
      const { checkedCurrentDeathDropPage } = await import('../../server/deathDropOperation.mjs');
      return checkedCurrentDeathDropPage(raw, { world, after, limit });
    },
    async commitPearlGround(raw) {
      const { operationId, ...operation } = raw;
      const world = await storage.store.loadWorld(WORLD), clock = await query('select public.mn_load_ground_clock($1) as data', [WORLD]);
      const request = { world: WORLD, expectedWorldVersion: world.version, worldData: world.data, family: 'ground', operation,
        clock: { operationId: clock.operationId, expectedVersion: clock.version, expectedTick: clock.tick, tick: clock.tick } };
      const result = await storage.store.commitGroundTransaction({ operationId, request });
      return result?.ok ? { ok: true, version: operation.expectedVersion + 1 } : result;
    },
    async loadDeathDrop(operationId, ordinal) {
      const raw = await query('select public.mn_load_death_drop($1::uuid,$2::integer) as data', [operationId, ordinal]);
      const { checkedCurrentDeathDrop } = await import('../../server/deathDropOperation.mjs');
      return checkedCurrentDeathDrop(raw, { operationId, ordinal });
    },
    async loadDeathOperation(operationId) {
      const raw = await query('select public.mn_load_death_operation($1::uuid) as data', [operationId]);
      const { checkedDeathReceipt } = await import('../../server/deathOperation.mjs');
      return checkedDeathReceipt(raw, operationId);
    },
  };
}

async function seedDeathProfiles(storage, request) {
  const victim = request.profiles.find(p => p.id === VICTIM);
  const base = structuredClone(victim.before); base.pearls = { bag: [], swallowed: null };
  assert.equal((await storage.store.saveProfile(VICTIM, base, 0)).ok, true);
  const killer = request.profiles.find(p => p.id === KILLER);
  if (killer) assert.equal((await storage.store.saveProfile(KILLER, killer.before, 0)).ok, true);
  const store = composedStore(storage);
  for (let i = 0; i < request.pearls.length; i++) {
    const pearl = request.pearls[i], current = (await store.loadProfile(VICTIM)).data;
    if (current.pearls.bag.length < 8) current.pearls.bag.push({ uid: pearl.uid, kind: pearl.kind });
    else current.pearls.swallowed = { uid: pearl.uid, kind: pearl.kind };
    assert.equal((await store.commitPearlGround({ operationId: deathOp(100 + i + 1), uid: pearl.uid, kind: pearl.kind,
      from: null, to: VICTIM, expectedVersion: 0, world: WORLD, ground: null,
      profiles: [{ id: VICTIM, expectedVersion: (await store.loadProfile(VICTIM)).version, data: current }] })).ok, true);
  }
  const current = await store.loadProfile(VICTIM);
  if (request.pearls.length) assert.equal((await store.saveProfile(VICTIM, victim.before, current.version)).ok, true);
  for (const pearl of request.pearls) pearl.expectedVersion = (await store.loadUnique(pearl.uid)).version;
  for (const profile of request.profiles) profile.expectedVersion = 1;
  const row = await storage.store.loadProfile(VICTIM), killerRow = killer ? await storage.store.loadProfile(KILLER) : null;
  request.profiles.find(p => p.id === VICTIM).expectedVersion = row.version;
  if (killerRow) request.profiles.find(p => p.id === KILLER).expectedVersion = killerRow.version;
  return { victim: row, killer: killerRow };
}

export function injectStep(host, fn) {
  const w = host.server.world, original = w.stepWorld.bind(w); let once = false;
  w.stepWorld = () => { if (!once) { once = true; fn(); } original(); };
}
