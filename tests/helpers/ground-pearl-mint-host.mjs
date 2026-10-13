import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { newCommunityState } from '../../server/communityProject.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';

export const WORLD = 'ground-pearl-mint-host';
export const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const turn = () => new Promise(resolve => setImmediate(resolve));
export function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
export class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

function sqlPageStore(base, storage) {
  return { ...base,
    async loadUnique(uid) { return (await storage.db.query('select public.mn_load_unique($1) as data', [uid])).rows[0].data; },
    async loadPearlLocation(uid) { return (await storage.db.query('select public.mn_load_pearl_location($1) as data', [uid])).rows[0].data; },
    async listPearlGround(world, options = {}) {
      const page = { world, afterUid: options.afterUid ?? null, limit: options.limit ?? 64 };
      const raw = (await storage.db.query('select public.mn_list_pearl_ground($1,$2,$3::integer) as data',
        [page.world, page.afterUid, page.limit])).rows[0].data;
      const { checkedGroundPage } = await import('../../server/pearlGround.mjs');
      return checkedGroundPage(raw, page);
    },
    async listCurrentDeathDrops(world, options = {}) {
      const page = { world, after: options.after ?? null, limit: options.limit ?? 64 };
      const raw = (await storage.db.query('select public.mn_list_current_death_drops($1,$2::uuid,$3::integer,$4::integer) as data',
        [page.world, page.after?.operationId ?? null, page.after?.ordinal ?? null, page.limit])).rows[0].data;
      const { checkedCurrentDeathDropPage } = await import('../../server/deathDropOperation.mjs');
      return checkedCurrentDeathDropPage(raw, page);
    },
  };
}

export async function fixture(t, { commitHook = null, accounts = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ground-pearl-mint-host-')), path = join(dir, 'db');
  let db = await database(path);
  let host, restarted;
  t.after(async () => {
    try { await host?.close(); } catch {}
    try { await restarted?.close(); } catch {}
    await db.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-pearl-mint-host-'));
    await rm(target, { recursive: true, force: true });
  });
  const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
  const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
  const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources,
    community: newCommunityState(WORLD, { madera: 4, piedra: 2 }) };
  await template.close();
  await db.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
  const profile = newProfile(); profile.pirateId = `account:${OWNER}`;
  assert.equal((await db.store.saveProfile(OWNER, profile, 0)).ok, true);
  for (const key of new Set(Object.values(accounts))) {
    if (key === OWNER) continue;
    const extra = newProfile(); extra.pirateId = `account:${key}`;
    assert.equal((await db.store.saveProfile(key, extra, 0)).ok, true);
  }
  const adoption = await db.adoptionClient.rpc('mn_adopt_ground_world', { p_operation_id: adoptionId(471),
    p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data } });
  assert.equal(adoption.error, null, adoption.error?.message); assert.equal(adoption.data.ok, true);

  let transactions = [], hookEnabled = false;
  const familyErrors = [];
  const createHost = (storage = db) => {
    const base = storage.store;
    const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
      const result = await base.commitGroundTransaction(raw);
      transactions.push(structuredClone(raw));
      if (hookEnabled && commitHook && raw.request?.family === 'ground' && raw.request.operation?.uid?.startsWith('mint:'))
        await commitHook(raw, result);
      return result;
    } };
    const result = new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
      resolvePlayer: async (_req, msg) => msg.token === 'owner' ? OWNER : accounts[msg.token] ?? null,
      economicOperations: true, resourceOperations: true, loggingOperations: true,
      groundTransactions: { journal: storage.journal(WORLD) } });
    const stage = result.groundAuthority.stageFamily.bind(result.groundAuthority);
    result.groundAuthority.stageFamily = (...args) => { const task = stage(...args); task.catch(error => familyErrors.push(error)); return task; };
    return result;
  };
  host = createHost();
  const pearls = host.mountGroundPearls();
  const deaths = host.mountGroundDeaths();
  const mints = host.mountGroundPearlMints();
  await host.prepare();
  return { get db() { return db; }, setDb(value) { db = value; }, path, get host() { return restarted ?? host; }, rawHost: () => host, createHost,
    setRestarted(value) { restarted = value; }, pearls, deaths, mints, transactions, familyErrors,
    currentStore() { return sqlPageStore(db.store, db); },
    armCommitHook() { hookEnabled = true; },
    async restart() {
      await host.close(); await db.close();
      const reopened = await reopenDatabase(path); db = reopened;
      host = createHost(reopened); restarted = host;
      const pearls = host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints();
      await host.prepare();
      return { host, pearls };
    } };
}

export async function joinPlayer(host, token = 'owner') {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-mint-test' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

export function injectStep(host, fn) {
  const w = host.server.world, original = w.stepWorld.bind(w); let once = false;
  w.stepWorld = () => { if (!once) { once = true; fn(); } original(); };
}
