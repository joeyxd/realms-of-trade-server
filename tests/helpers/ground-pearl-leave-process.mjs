import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { mulberry32 } from '../../src/core/rng.js';
import { PEARL } from '../../src/data/pearls.js';
import { KIND } from '../../src/sim/ecs.js';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-pearl-leave-process', OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
  const storage = await database(path);
  try {
    const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
    const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
    const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources };
    await template.close();
    await storage.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
    const profile = newProfile(); profile.pirateId = `account:${OWNER}`;
    assert.equal((await storage.store.saveProfile(OWNER, profile, 0)).ok, true);
    const adopted = await storage.adoptionClient.rpc('mn_adopt_ground_world', { p_operation_id: adoptionId(492),
      p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data } });
    assert.equal(adopted.error, null, adopted.error?.message); assert.equal(adopted.data.ok, true);
  } finally { await storage.close(); }
}

function createHost(storage, holdAt = null) {
  let journal = storage.journal(WORLD), base = storage.store;
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      if (raw.request?.family === 'ground' && raw.request.operation?.from && raw.request.operation?.to === null &&
          raw.request.operation?.expectedVersion > 0 && raw.request.operation?.ground) {
        process.stdout.write(`READY ${phase}\n`); await never();
      }
      return result;
    } };
  }
  const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
    const result = await base.commitGroundTransaction(raw);
    if (holdAt === 'after-sql-commit' && raw.request?.family === 'ground' &&
        raw.request.operation?.from && raw.request.operation?.to === null && raw.request.operation?.expectedVersion > 0 &&
        raw.request.operation?.ground) {
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
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-leave-process' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'owner', token: 'owner' })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

async function obtainPearl(host, player) {
  const world = host.server.world, point = world.map.cala;
  world.ecs.x[player.entity] = point.x; world.ecs.z[player.entity] = point.z;
  const sentinel = world.spawnEnemy('sentinel', point.x + 3, point.z);
  world.lootRng = mulberry32(5);
  const old = world.stepWorld.bind(world); let injected = false;
  world.stepWorld = () => { if (!injected) { injected = true; world.killEnemy(sentinel, player.entity); } old(); };
  assert.equal(host.server.step(), true);
  for (let i = 0; i < 100 && host.groundPearlMints.status().pending; i++) { host.server.step(); await turn(); }
  for (let i = 0; i < 100 && ![...world.drops.values()].some(drop => drop.kind === 'pearl'); i++) { host.server.step(); await turn(); }
  const drop = [...world.drops.values()].find(value => value.kind === 'pearl'); assert.ok(drop);
  while (world.tick < drop.pickAt) { host.server.step(); await turn(); }
  world.ecs.x[player.entity] = drop.x; world.ecs.z[player.entity] = drop.z;
  const pickup = host.groundPearls.pickup({ dropId: drop.id, receiver: { clientId: player.clientId, entity: player.entity } });
  for (let i = 0; i < 100 && world.drops.has(drop.id); i++) { host.server.step(); await turn(); await host.groundAuthority.settle(); }
  await pickup.result;
  world.ecs.regenT[player.entity] = PEARL.calm + 1;
  world.ecs.castK[player.entity] = 0; world.ecs.atkStage[player.entity] = 0; world.ecs.dashT[player.entity] = -1;
  for (let entity = 1; entity < world.ecs.cap; entity++) if (entity !== player.entity && world.ecs.kind[entity] === KIND.ENEMY) {
    world.ecs.alive[entity] = 0; world.ecs.brain[entity] = null;
  }
  return drop.pearl.uid;
}

async function hold() {
  await initialize();
  const storage = await reopenDatabase(path), host = createHost(storage, phase);
  try {
    host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints(); await host.prepare();
    const player = await join(host), uid = await obtainPearl(host, player);
    const operation = host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
    for (let i = 0; i < 100; i++) { host.server.step(); await turn(); }
    await operation.result;
    throw new Error('leave transaction never reached the requested crash point');
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
      where request->'operation'->>'from' is not null and request->'operation'->>'to' is null
        and (request->'operation'->>'expectedVersion')::integer>0 order by operation_id`)).rows;
    assert.equal(rows.length, 1, 'recovery retains exactly one committed leave transaction');
    const { operation_id: operationId, request } = rows[0], uid = request.operation.uid;
    assert.equal(request.operation.to, null);
    const unique = (await storage.db.query('select public.mn_load_unique($1) as data', [uid])).rows[0].data;
    assert.equal(unique.holder, null);
    const location = (await storage.db.query('select public.mn_load_pearl_location($1) as data', [uid])).rows[0].data;
    assert.equal(location.version, request.operation.expectedVersion + 1);
    assert.deepEqual(location.ground, request.operation.ground);
    const drops = [...host.server.world.drops.values()].filter(drop => drop.kind === 'pearl' && drop.pearl.uid === uid);
    assert.equal(drops.length, 1, 'startup hydrates the committed ground pearl once');
    assert.deepEqual(host.server.world.pearlLedger.get(uid), { owner: '', entity: 0, place: 'ground', drop: drops[0].id });
    const profile = (await storage.store.loadProfile(OWNER)).data;
    assert.equal(profile.pearls.bag.some(pearl => pearl.uid === uid), false, 'the durable profile no longer owns it');
    assert.equal(host.server.world.events.length, 0, 'hydration does not replay the historical leave event');
    assert.equal(historical, 0, 'recovery never invokes an old apply callback');
    const historicalAtStartup = historical;

    const player = await join(host);
    while (host.server.world.tick < drops[0].pickAt) { host.server.step(); await turn(); }
    host.server.world.ecs.x[player.entity] = drops[0].x; host.server.world.ecs.z[player.entity] = drops[0].z;
    const pickup = host.groundPearls.pickup({ dropId: drops[0].id,
      receiver: { clientId: player.clientId, entity: player.entity } });
    for (let i = 0; i < 100 && host.server.world.drops.has(drops[0].id); i++) {
      host.server.step(); await turn(); await host.groundAuthority.settle();
    }
    await pickup.result;
    assert.equal(host.server.world.drops.has(drops[0].id), false);
    assert.equal(host.server.world.profiles.get(player.entity).pearls.bag.filter(pearl => pearl.uid === uid).length, 1);
    assert.equal((await storage.store.loadProfile(OWNER)).data.pearls.bag.filter(pearl => pearl.uid === uid).length, 1);
    process.stdout.write(JSON.stringify({ phase, uid, operationId, hydrated: drops.length, ownerPearls: 1,
      historical: historicalAtStartup }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await storage.close(); }
  }
}

if (mode === 'hold') await hold(); else await recover();
