import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { groundOperation } from '../../server/pearlGround.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { PEARL } from '../../src/data/pearls.js';
import { KIND } from '../../src/sim/ecs.js';

const [mode, path, phase, expectedOperationId] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-pearl-give-process';
const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIVER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'ground-pearl-give-process-pearl';
const never = () => new Promise(() => {});
const turn = () => new Promise(resolve => setImmediate(resolve));

class Socket extends EventEmitter {
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

function createHost(storage, holdAt = null) {
  let journal = storage.journal(WORLD), base = storage.store;
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      if (raw.request?.family === 'ground' && raw.request.operation?.uid === UID &&
          raw.request.operation?.from === SOURCE && raw.request.operation?.to === RECEIVER) {
        process.stdout.write(`READY ${phase} ${raw.operationId}\n`); await never();
      }
      return result;
    } };
  }
  const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
    const result = await base.commitGroundTransaction(raw);
    if (holdAt === 'after-sql-commit' && raw.request?.family === 'ground' && raw.request.operation?.uid === UID &&
        raw.request.operation?.from === SOURCE && raw.request.operation?.to === RECEIVER) {
      process.stdout.write(`READY ${phase} ${raw.operationId}\n`); await never();
    }
    return result;
  } };
  return new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
    resolvePlayer: async (_req, message) => message.token === 'source' ? SOURCE : message.token === 'receiver' ? RECEIVER : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true,
    groundTransactions: { journal } });
}

async function initialize() {
  const storage = await database(path);
  try {
    const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
    const resources = upgradeLoggingState(newResourceState(template.server.world)); resources.tick = 500;
    const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources };
    await template.close();
    await storage.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [WORLD, data]);
    const source = newProfile(); source.pirateId = `account:${SOURCE}`;
    const sourceOwned = structuredClone(source); sourceOwned.pearls.bag.push({ uid: UID, kind: 'brasa' });
    const receiver = newProfile(); receiver.pirateId = `account:${RECEIVER}`;
    assert.equal((await storage.store.saveProfile(SOURCE, source, 0)).ok, true);
    assert.equal((await storage.store.saveProfile(RECEIVER, receiver, 0)).ok, true);
    const adopted = await storage.adoptionClient.rpc('mn_adopt_ground_world', { p_operation_id: adoptionId(494),
      p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data } });
    assert.equal(adopted.error, null, adopted.error?.message); assert.equal(adopted.data.ok, true);
    const seedHost = createHost(storage);
    await seedHost.prepare();
    const operationId = adoptionId(495), operation = groundOperation({ operationId, uid: UID, kind: 'brasa',
      from: null, to: SOURCE, expectedVersion: 0, world: WORLD, ground: null,
      profiles: [{ id: SOURCE, expectedVersion: 1, data: sourceOwned }] }).request;
    const registered = seedHost.groundAuthority.stageFamily({ operationId, family: 'ground', operation }, () => true);
    for (let i = 0; i < 100 && seedHost.groundAuthority.busy; i++) { seedHost.server.step(); await turn(); }
    assert.equal((await registered).ok, true);
    await seedHost.close();
  } finally { await storage.close(); }
}

async function join(host, token) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-give-process' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

function mount(host) {
  host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints();
}

function positionPair(host, source, receiver) {
  const w = host.server.world, point = w.map.cala, ecs = w.ecs;
  for (let entity = 1; entity < ecs.cap; entity++) if (entity !== source.entity && entity !== receiver.entity &&
      ecs.kind[entity] === KIND.ENEMY) { ecs.alive[entity] = 0; ecs.brain[entity] = null; }
  for (const player of [source, receiver]) {
    ecs.x[player.entity] = point.x + (player === receiver ? 1 : 0); ecs.z[player.entity] = point.z;
    ecs.y[player.entity] = w.map.groundAt(ecs.x[player.entity], ecs.z[player.entity]);
    ecs.regenT[player.entity] = PEARL.calm + 1;
    ecs.castK[player.entity] = 0; ecs.atkStage[player.entity] = 0; ecs.dashT[player.entity] = -1;
  }
}

async function hold() {
  await initialize();
  const storage = await reopenDatabase(path), host = createHost(storage, phase);
  try {
    mount(host); await host.prepare();
    const source = await join(host, 'source'), receiver = await join(host, 'receiver');
    const w = host.server.world;
    const emit = w.emit.bind(w);
    w.emit = event => {
      if (event?.type === 'pearlChanged' && event.op === 'give') process.stdout.write('APPLIED\n');
      return emit(event);
    };
    positionPair(host, source, receiver);
    source.socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, type: 'pearl', op: 'give',
      target: receiver.entity, uid: UID })), false);
    for (let i = 0; i < 200; i++) { host.server.step(); await turn(); }
    const denied = source.socket.messages.filter(message => message.t === MSG.EVENT).map(message => message.ev)
      .filter(event => ['pearlDenied', 'commandDenied'].includes(event?.type));
    const sessions = [...host.profiles.accounts.values()].map(session => ({ key: session.key, version: session.version,
      pending: !!session.pending, running: !!session.running, closed: session.closed, failed: session.failed }));
    throw new Error(`give transaction never reached the requested crash point: denied=${JSON.stringify(denied)}; pending=${host.groundPearls.pending}; authority=${JSON.stringify(host.groundAuthority.status())}; sessions=${JSON.stringify(sessions)}; tasks=${host.profiles.tasks.size}`);
  } finally { await host.close().catch(() => {}); await storage.close(); }
}

async function finishGive(host, source, receiver) {
  positionPair(host, source, receiver);
  source.socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, type: 'pearl', op: 'give',
    target: receiver.entity, uid: UID })), false);
  for (let i = 0; i < 200; i++) {
    host.server.step(); await turn();
    if (!host.groundPearls.pending && !host.groundAuthority.busy) break;
  }
  await host.groundAuthority.settle();
}

async function recover() {
  assert.match(expectedOperationId ?? '', /^[0-9a-f-]{36}$/i);
  const storage = await reopenDatabase(path), host = createHost(storage);
  let historical = 0;
  const { GroundTransactionSession } = await import('../../server/groundTransactionSession.mjs');
  const originalDrain = GroundTransactionSession.prototype.drain;
  GroundTransactionSession.prototype.drain = function(tick, apply = null) {
    if (apply) historical++; return originalDrain.call(this, tick, apply);
  };
  try {
    mount(host); await host.prepare();
    const row = (await storage.db.query(`select operation_id,request,result from public.mn_ground_transactions
      where operation_id=$1::uuid`, [expectedOperationId])).rows[0];
    assert.ok(row, 'recovery commits the exact prepared operation UUID');
    const operation = row.request.operation;
    assert.equal(operation.uid, UID); assert.equal(operation.from, SOURCE); assert.equal(operation.to, RECEIVER);
    assert.equal(operation.expectedVersion, 1); assert.equal(operation.ground, null);
    assert.deepEqual(operation.profiles.map(p => [p.id, p.expectedVersion]), [[SOURCE, 3], [RECEIVER, 2]]);
    assert.equal(row.request.expectedWorldVersion + 1, row.result.worldVersion);
    assert.equal(row.request.worldData.resources.tick, row.request.clock.tick);
    assert.equal(row.result.clock.tick, row.request.clock.tick);
    assert.equal(row.result.clock.version, row.request.clock.expectedVersion +
      Number(row.request.clock.tick > row.request.clock.expectedTick));
    const durableWorld = await storage.store.loadWorld(WORLD), durableClock = await storage.store.loadGroundClock(WORLD);
    assert.equal(durableWorld.version, row.result.worldVersion);
    assert.equal(durableWorld.data.resources.tick, durableClock.tick);
    assert.deepEqual(durableClock, row.result.clock);
    const journal = (await storage.db.query(`select operation_id,state,request,result
      from public.mn_ground_transaction_intents where operation_id=$1::uuid`, [expectedOperationId])).rows[0];
    assert.equal(journal.operation_id, expectedOperationId);
    assert.equal(journal.state, 'committed');
    assert.deepEqual(journal.request, row.request);
    assert.deepEqual(journal.result, row.result);
    const unique = (await storage.db.query('select public.mn_load_unique($1) as data', [UID])).rows[0].data;
    assert.deepEqual(unique, { holder: RECEIVER, kind: 'pearl:brasa', version: 2 });
    const location = (await storage.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data;
    assert.deepEqual(location, { world: WORLD, ground: null, version: 2 }, 'give writes a current tombstone at the next generation');
    const sourceRow = await storage.store.loadProfile(SOURCE), receiverRow = await storage.store.loadProfile(RECEIVER);
    const sourceProfile = sourceRow.data, receiverProfile = receiverRow.data;
    assert.equal(sourceRow.version, 4); assert.equal(receiverRow.version, 3);
    assert.equal(sourceProfile.pearls.bag.filter(p => p.uid === UID).length, 0);
    assert.equal(receiverProfile.pearls.bag.filter(p => p.uid === UID).length, 1);
    assert.equal(host.server.world.events.length, 0, 'recovery does not replay historical gameplay events');
    assert.equal(historical, 0, 'startup reconciliation never invokes the old apply callback');
    const historicalAtStartup = historical;

    const source = await join(host, 'receiver'), receiver = await join(host, 'source');
    await finishGive(host, source, receiver);
    const sourceAfter = await storage.store.loadProfile(SOURCE), receiverAfter = await storage.store.loadProfile(RECEIVER);
    assert.equal(sourceAfter.data.pearls.bag.filter(p => p.uid === UID).length, 1);
    assert.equal(receiverAfter.data.pearls.bag.filter(p => p.uid === UID).length, 0);
    const after = (await storage.db.query(`select operation_id,request,result from public.mn_ground_transactions
      where request->'operation'->>'uid'=$1 and request->'operation'->>'from'=$2 and request->'operation'->>'to'=$3
      order by (request->'operation'->>'expectedVersion')::integer`, [UID, RECEIVER, SOURCE])).rows;
    assert.equal(after.length, 1);
    assert.notEqual(after[0].operation_id, expectedOperationId);
    assert.equal(after[0].request.operation.expectedVersion, 2, 'the next give starts from the recovered holder generation');
    assert.deepEqual(after[0].request.operation.profiles.map(p => [p.id, p.expectedVersion]), [[SOURCE, 4], [RECEIVER, 3]]);
    assert.equal(after[0].request.expectedWorldVersion + 1, after[0].result.worldVersion,
      'the second give also advances the world CAS exactly once');
    const worldAfter = await storage.store.loadWorld(WORLD), clockAfter = await storage.store.loadGroundClock(WORLD);
    assert.equal(worldAfter.version, after[0].result.worldVersion);
    assert.equal(worldAfter.data.resources.tick, clockAfter.tick);
    assert.deepEqual(clockAfter, after[0].result.clock);
    assert.equal(sourceAfter.version, 5); assert.equal(receiverAfter.version, 4);
    const finalUnique = (await storage.db.query('select public.mn_load_unique($1) as data', [UID])).rows[0].data;
    const finalLocation = (await storage.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data;
    assert.deepEqual(finalUnique, { holder: SOURCE, kind: 'pearl:brasa', version: 3 });
    assert.deepEqual(finalLocation, { world: WORLD, ground: null, version: 3 });
    process.stdout.write(JSON.stringify({ phase, operationId: expectedOperationId, uid: UID,
      firstHolder: RECEIVER, firstGeneration: location.version, nextGeneration: finalLocation.version,
      historical: historicalAtStartup, sourceCopies: 1, receiverCopies: 0 }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await storage.close(); }
  }
}

if (mode === 'hold') await hold(); else await recover();
