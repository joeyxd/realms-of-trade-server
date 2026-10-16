import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { groundOperation } from '../../server/pearlGround.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-pearl-process', OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID = 'ground-pearl-process-seed', SEED_ID = adoptionId(440);
const never = () => new Promise(() => {});

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

function createHost(storage, holdAt = null) {
  let journal = storage.journal(WORLD), base = storage.store;
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      if (raw.request?.family === 'ground' && raw.request.operation?.uid === UID) {
        process.stdout.write(`READY ${phase}\n`); await never();
      }
      return result;
    } };
  }
  const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
    const result = await base.commitGroundTransaction(raw);
    if (holdAt === 'after-sql-commit' && raw.request?.family === 'ground' && raw.request.operation?.uid === UID) {
      process.stdout.write(`READY ${phase}\n`); await never();
    }
    return result;
  } };
  return new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
    resolvePlayer: async (_req, message) => message.token === 'owner' ? OWNER : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true,
    groundTransactions: { journal } });
}

async function initialize() {
  const f = await database(path);
  try {
    const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
    const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
    const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources };
    await template.close();
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
    const owner = newProfile(); owner.pirateId = `account:${OWNER}`;
    assert.equal((await f.store.saveProfile(OWNER, owner, 0)).ok, true);
    const adoption = await f.adoptionClient.rpc('mn_adopt_ground_world', {
      p_operation_id: adoptionId(439), p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data },
    });
    assert.equal(adoption.error, null, adoption.error?.message); assert.equal(adoption.data.ok, true);
    const host = createHost(f); await host.prepare();
    const request = groundOperation({ operationId: SEED_ID, uid: UID, kind: 'brasa', from: null, to: null,
      expectedVersion: 0, profiles: [], world: WORLD,
      ground: { x: 3, z: -4, availableAt: 501, returnAt: 801 } }).request;
    const seedTask = host.groundAuthority.stageFamily({ operationId: SEED_ID, family: 'ground', operation: request }, () => true);
    for (let i = 0; i < 30 && host.groundAuthority.busy; i++) { await new Promise(resolve => setImmediate(resolve)); host.server.step(); }
    await host.groundAuthority.settle(); assert.equal((await seedTask).ok, true);
    await host.close();
  } finally { await f.close(); }
}

async function player(host) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-process' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'owner', token: 'owner' })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), client = host.server.clients.get(clientId);
  assert.ok(client?.entity); return { socket, clientId, entity: client.entity };
}

async function hold() {
  await initialize();
  const f = await reopenDatabase(path), host = createHost(f, phase);
  host.mountGroundPearls(); await host.prepare();
  const receiver = await player(host), drop = [...host.server.world.drops.values()].find(d => d.kind === 'pearl');
  assert.ok(drop); assert.ok(Number.isSafeInteger(drop.pickAt), JSON.stringify(drop));
  host.server.world.ecs.x[receiver.entity] = drop.x; host.server.world.ecs.z[receiver.entity] = drop.z;
  host.server.world.tick = drop.pickAt;
  const pending = host.groundPearls.pickup({ dropId: drop.id, receiver: { clientId: receiver.clientId, entity: receiver.entity } });
  pending.result.catch(() => {});
  await never();
}

async function recover() {
  const f = await reopenDatabase(path), host = createHost(f);
  let historical = 0;
  const { GroundTransactionSession } = await import('../../server/groundTransactionSession.mjs');
  const originalDrain = GroundTransactionSession.prototype.drain;
  GroundTransactionSession.prototype.drain = function(tick, apply = null) { if (apply) historical++; return originalDrain.call(this, tick, apply); };
  try {
    const wasCommitted = phase === 'after-sql-commit';
    const pickId = (await f.db.query('select operation_id from public.mn_ground_transactions where request::text like $1 and operation_id<>$2::uuid limit 1', [`%${UID}%`, SEED_ID])).rows[0]?.operation_id ?? null;
    const pre = { receipt: pickId ? await f.store.loadGroundTransaction(pickId) : null, owner: await f.store.loadProfile(OWNER),
      location: (await f.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data,
      world: await f.store.loadWorld(WORLD), clock: await f.store.loadGroundClock(WORLD) };
    assert.equal(!!pre.receipt, wasCommitted); assert.equal(pre.owner.version, wasCommitted ? 2 : 1);
    assert.equal(pre.world.version, wasCommitted ? 10 : 9); assert.equal(pre.clock.tick, 501);
    const lifecycle = host.mountGroundPearls();
    await host.prepare();
    assert.equal(lifecycle.status().ready, true);
    const drops = [...host.server.world.drops.values()].filter(d => d.kind === 'pearl' && d.pearl.uid === UID);
    assert.equal(drops.length, 0, 'common recovery completes the prepared pickup before current rows hydrate');
    const current = (await f.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data;
    assert.deepEqual(current, { world: WORLD, ground: null, version: 2 });
    assert.equal(host.server.world.events.filter(e => e.type === 'pickup').length, 0);
    const opened = await host.profiles.open(77, OWNER);
    assert.equal(opened.pearls.bag.filter(p => p.uid === UID).length, 1);
    const world = await f.store.loadWorld(WORLD), clock = await f.store.loadGroundClock(WORLD);
    assert.equal(world.data.resources.tick, clock.tick); assert.equal(clock.tick, 501);
    assert.equal(world.version, 10);
    assert.equal(historical, 0, 'common startup recovery never replays an old gameplay apply callback');
    const receipts = Number((await f.db.query('select count(*)::int n from public.mn_ground_transactions where request::text like $1 and operation_id<>$2::uuid', [`%${UID}%`, SEED_ID])).rows[0].n);
    assert.equal(receipts, 1);
    process.stdout.write(JSON.stringify({ phase, worldVersion: world.version, clockTick: clock.tick,
      groundRows: drops.length, ownerPearls: opened.pearls.bag.filter(p => p.uid === UID).length, historical }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await f.close(); }
  }
}

if (mode === 'hold') await hold(); else await recover();
