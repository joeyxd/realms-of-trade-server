import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { mulberry32 } from '../../src/core/rng.js';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-pearl-mint-process', OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const never = () => new Promise(() => {}), turn = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
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

async function initialize() {
  const f = await database(path);
  try {
    const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
    const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
    const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources };
    await template.close();
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
    const profile = newProfile(); profile.pirateId = `account:${OWNER}`;
    assert.equal((await f.store.saveProfile(OWNER, profile, 0)).ok, true);
    const adopted = await f.adoptionClient.rpc('mn_adopt_ground_world', { p_operation_id: adoptionId(491),
      p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data } });
    assert.equal(adopted.error, null, adopted.error?.message); assert.equal(adopted.data.ok, true);
  } finally { await f.close(); }
}

function createHost(storage, holdAt = null) {
  let journal = storage.journal(WORLD), base = storage.store;
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      if (raw.request?.family === 'ground' && raw.request.operation?.uid?.startsWith('mint:')) {
        process.stdout.write(`READY ${phase}\n`); await never();
      }
      return result;
    } };
  }
  const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
    const result = await base.commitGroundTransaction(raw);
    if (holdAt === 'after-sql-commit' && raw.request?.family === 'ground' && raw.request.operation?.uid?.startsWith('mint:')) {
      process.stdout.write(`READY ${phase}\n`); await never();
    }
    return result;
  } };
  return new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
    resolvePlayer: async (_req, msg) => msg.token === 'owner' ? OWNER : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true,
    groundTransactions: { journal } });
}

async function join(host) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-mint-process' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'owner', token: 'owner' })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

async function hold() {
  await initialize();
  const storage = await reopenDatabase(path), host = createHost(storage, phase);
  try {
    host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints(); await host.prepare();
    const player = await join(host), w = host.server.world, point = w.map.cala;
    w.ecs.x[player.entity] = point.x; w.ecs.z[player.entity] = point.z;
    w.lootRng = mulberry32(5);
    const enemy = w.spawnEnemy('sentinel', point.x + 3, point.z);
    const original = w.stepWorld.bind(w); let injected = false;
    w.stepWorld = () => { if (!injected) { injected = true; w.killEnemy(enemy, player.entity); } original(); };
    assert.equal(host.server.step(), true);
    for (let i = 0; i < 100; i++) { host.server.step(); await turn(); }
    throw new Error('mint transaction never reached the requested crash point');
  } finally { await host.close().catch(() => {}); await storage.close(); }
}

async function recover() {
  const storage = await reopenDatabase(path), host = createHost(storage);
  let historical = 0;
  const { GroundTransactionSession } = await import('../../server/groundTransactionSession.mjs');
  const originalDrain = GroundTransactionSession.prototype.drain;
  GroundTransactionSession.prototype.drain = function(tick, apply = null) {
    if (apply) historical++; return originalDrain.call(this, tick, apply);
  };
  try {
    host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints(); await host.prepare();
    const rows = (await storage.db.query(`select operation_id,request from public.mn_ground_transactions
      where request::text like '%mint:%' order by operation_id`)).rows;
    assert.equal(rows.length, 1, 'recovery leaves one durable mint transaction');
    const operationId = rows[0].operation_id, request = rows[0].request;
    const uid = request.operation.uid;
    assert.equal(uid, `mint:${operationId}`, 'the mint UID is derived from the operation ID captured before the crash');
    assert.equal(request.operation.expectedVersion, 0);
    const unique = await storage.db.query('select public.mn_load_unique($1) as data', [uid]);
    assert.equal(unique.rows[0].data.version, 1);
    const location = await storage.db.query('select public.mn_load_pearl_location($1) as data', [uid]);
    assert.equal(location.rows[0].data.version, 1);
    assert.deepEqual(location.rows[0].data.ground, request.operation.ground);
    const drops = [...host.server.world.drops.values()].filter(d => d.kind === 'pearl' && d.pearl.uid === uid);
    assert.equal(drops.length, 1, 'startup hydrates the committed current pearl once');
    assert.equal(host.server.world.pearlLedger.get(uid).drop, drops[0].id);
    assert.equal(host.server.world.events.length, 0, 'recovery and hydration do not replay historical loot events');
    const historicalAtStartup = historical;
    assert.equal(historicalAtStartup, 0, 'recovery never calls the historical gameplay apply callback');

    const player = await join(host);
    while (host.server.world.tick < drops[0].pickAt) { host.server.step(); await turn(); }
    host.server.world.ecs.x[player.entity] = drops[0].x; host.server.world.ecs.z[player.entity] = drops[0].z;
    const profile = host.server.world.profiles.get(player.entity);
    const pickup = host.groundPearls.pickup({ dropId: drops[0].id,
      receiver: { clientId: player.clientId, entity: player.entity } });
    for (let i = 0; i < 100 && host.server.world.drops.has(drops[0].id); i++) {
      host.server.step(); await turn();
    }
    await host.groundAuthority.settle();
    if (host.server.world.drops.has(drops[0].id)) host.server.step();
    await pickup.result;
    assert.equal(host.server.world.drops.has(drops[0].id), false);
    assert.equal(profile.pearls.bag.filter(p => p.uid === uid).length, 1);
    assert.equal((await storage.store.loadProfile(OWNER)).data.pearls.bag.filter(p => p.uid === uid).length, 1);
    process.stdout.write(JSON.stringify({ phase, uid, operationId, hydrated: drops.length,
      ownerPearls: profile.pearls.bag.filter(p => p.uid === uid).length, historical: historicalAtStartup }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await storage.close(); }
  }
}

if (mode === 'hold') await hold(); else await recover();
