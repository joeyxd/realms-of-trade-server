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
const WORLD = 'ground-pearl-swallow-process';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'ground-pearl-swallow-process-pearl';
const KIND_NAME = 'escarcha';
const BASELINE = Object.freeze({ xp: 912, gold: 317, masteryLevel: 3, masteryXp: 77, kills: 14 });
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
  const matches = raw => raw.request?.family === 'ground' && raw.request.operation?.uid === UID &&
    raw.request.operation?.from === OWNER && raw.request.operation?.to === OWNER;
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      if (matches(raw)) { process.stdout.write(`READY ${phase} ${raw.operationId}\n`); await never(); }
      return result;
    } };
  }
  const store = { ...sqlPageStore(base, storage), async commitGroundTransaction(raw) {
    const result = await base.commitGroundTransaction(raw);
    if (holdAt === 'after-sql-commit' && matches(raw)) {
      process.stdout.write(`READY ${phase} ${raw.operationId}\n`); await never();
    }
    return result;
  } };
  return new GameHost({ seed: 91, bots: 0, store, worldId: WORLD, log() {},
    resolvePlayer: async (_req, message) => message.token === 'owner' ? OWNER :
      message.token === 'other' ? OTHER : null,
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
    const owner = newProfile(); owner.pirateId = `account:${OWNER}`;
    owner.xp = BASELINE.xp; owner.gold = BASELINE.gold;
    owner.mast[0] = [BASELINE.masteryLevel, BASELINE.masteryXp]; owner.stats.kills = BASELINE.kills;
    const withPearl = structuredClone(owner); withPearl.pearls.bag.push({ uid: UID, kind: KIND_NAME });
    const other = newProfile(); other.pirateId = `account:${OTHER}`;
    assert.equal((await storage.store.saveProfile(OWNER, owner, 0)).ok, true);
    assert.equal((await storage.store.saveProfile(OTHER, other, 0)).ok, true);
    const adopted = await storage.adoptionClient.rpc('mn_adopt_ground_world', { p_operation_id: adoptionId(496),
      p_request: { world: WORLD, expectedWorldVersion: 7, worldData: data } });
    assert.equal(adopted.error, null, adopted.error?.message); assert.equal(adopted.data.ok, true);
    const seedHost = createHost(storage);
    await seedHost.prepare();
    const seedOperation = groundOperation({ operationId: adoptionId(497), uid: UID, kind: KIND_NAME,
      from: null, to: OWNER, expectedVersion: 0, world: WORLD, ground: null,
      profiles: [{ id: OWNER, expectedVersion: 1, data: withPearl }] }).request;
    const registered = seedHost.groundAuthority.stageFamily({ operationId: adoptionId(497), family: 'ground',
      operation: seedOperation }, () => true);
    for (let i = 0; i < 100 && seedHost.groundAuthority.busy; i++) { seedHost.server.step(); await turn(); }
    assert.equal((await registered).ok, true);
    await seedHost.close();
  } finally { await storage.close(); }
}

async function join(host, token) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-pearl-swallow-process' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...host.joins]);
  const clientId = [...host.server.clients.keys()].at(-1), entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity); return { socket, clientId, entity };
}

function mount(host) {
  host.mountGroundPearls(); host.mountGroundDeaths(); host.mountGroundPearlMints();
}

function calmAndAlone(host, player) {
  const w = host.server.world, ecs = w.ecs, point = w.map.cala;
  for (let entity = 1; entity < ecs.cap; entity++) if (entity !== player.entity && ecs.kind[entity] === KIND.ENEMY) {
    ecs.alive[entity] = 0; ecs.brain[entity] = null;
  }
  ecs.x[player.entity] = point.x; ecs.z[player.entity] = point.z;
  ecs.y[player.entity] = w.map.groundAt(ecs.x[player.entity], ecs.z[player.entity]);
  ecs.regenT[player.entity] = PEARL.calm + 1;
  ecs.castK[player.entity] = 0; ecs.atkStage[player.entity] = 0; ecs.dashT[player.entity] = -1;
}

async function sendCommand(host, socket, command) {
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, type: 'pearl', ...command })), false);
  for (let i = 0; i < 10; i++) { host.server.step(); await turn(); }
}

async function hold() {
  await initialize();
  const storage = await reopenDatabase(path), host = createHost(storage, phase);
  try {
    mount(host); await host.prepare();
    const owner = await join(host, 'owner'); calmAndAlone(host, owner);
    const w = host.server.world, emit = w.emit.bind(w);
    w.emit = event => {
      if (event?.type === 'pearlChanged' && event.op === 'swallow' && event.pearl?.uid === UID) {
        process.stdout.write('APPLIED\n');
      }
      return emit(event);
    };
    await sendCommand(host, owner.socket, { op: 'swallow', uid: UID });
    for (let i = 0; i < 200; i++) { host.server.step(); await turn(); }
    const denied = owner.socket.messages.filter(message => message.t === MSG.EVENT).map(message => message.ev)
      .filter(event => ['pearlDenied', 'commandDenied'].includes(event?.type));
    throw new Error(`swallow transaction never reached the requested crash point: denied=${JSON.stringify(denied)}; pending=${host.groundPearls.pending}; authority=${JSON.stringify(host.groundAuthority.status())}`);
  } finally { await host.close().catch(() => {}); await storage.close(); }
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
    assert.equal(operation.uid, UID); assert.equal(operation.kind, KIND_NAME);
    assert.equal(operation.from, OWNER); assert.equal(operation.to, OWNER);
    assert.equal(operation.expectedVersion, 1); assert.equal(operation.ground, null);
    assert.deepEqual(operation.profiles.map(p => p.id), [OWNER]);
    const committedProfile = operation.profiles[0].data;
    assert.deepEqual(committedProfile.pearls, { bag: [], swallowed: { uid: UID, kind: KIND_NAME } });
    assert.deepEqual([committedProfile.xp, committedProfile.gold, committedProfile.mast[0], committedProfile.stats.kills],
      [BASELINE.xp, BASELINE.gold, [BASELINE.masteryLevel, BASELINE.masteryXp], BASELINE.kills]);
    assert.equal(row.request.expectedWorldVersion + 1, row.result.worldVersion);
    assert.equal(row.request.worldData.resources.tick, row.request.clock.tick);
    assert.equal(row.result.clock.tick, row.request.clock.tick);
    assert.equal(row.result.clock.version, row.request.clock.expectedVersion +
      Number(row.request.clock.tick > row.request.clock.expectedTick));
    assert.equal(row.result.effect.profiles.length, 1, 'the same-account swallow commits one profile CAS');
    const durableWorld = await storage.store.loadWorld(WORLD), durableClock = await storage.store.loadGroundClock(WORLD);
    assert.equal(durableWorld.version, row.result.worldVersion);
    assert.equal(durableWorld.data.resources.tick, durableClock.tick);
    assert.deepEqual(durableClock, row.result.clock);
    const journal = (await storage.db.query(`select operation_id,state,request,result
      from public.mn_ground_transaction_intents where operation_id=$1::uuid`, [expectedOperationId])).rows[0];
    assert.equal(journal.operation_id, expectedOperationId); assert.equal(journal.state, 'committed');
    assert.deepEqual(journal.request, row.request); assert.deepEqual(journal.result, row.result);
    const unique = (await storage.db.query('select public.mn_load_unique($1) as data', [UID])).rows[0].data;
    assert.deepEqual(unique, { holder: OWNER, kind: `pearl:${KIND_NAME}`, version: 2 });
    const location = (await storage.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data;
    assert.deepEqual(location, { world: WORLD, ground: null, version: 2 }, 'swallow advances the null ground tombstone generation');
    const profileRow = await storage.store.loadProfile(OWNER), saved = profileRow.data;
    assert.equal(profileRow.version, operation.profiles[0].expectedVersion + 1,
      'the swallow advances its one captured profile CAS exactly once');
    assert.deepEqual(saved.pearls, committedProfile.pearls);
    assert.deepEqual([saved.xp, saved.gold, saved.mast[0], saved.stats.kills],
      [BASELINE.xp, BASELINE.gold, [BASELINE.masteryLevel, BASELINE.masteryXp], BASELINE.kills]);
    assert.equal(host.server.world.events.length, 0, 'recovery does not replay historical gameplay events');
    assert.equal(historical, 0, 'startup reconciliation never invokes an old apply callback');
    const historicalAtStartup = historical;

    const owner = await join(host, 'owner'), other = await join(host, 'other');
    const live = host.server.world.profiles.get(owner.entity);
    assert.deepEqual(live.pearls, { bag: [], swallowed: { uid: UID, kind: KIND_NAME } });
    assert.equal(host.server.world.ecs.elem[owner.entity], 2, 'fresh login derives the swallowed escarcha power from the current profile');
    assert.equal(owner.socket.messages.some(message => message.ev?.type === 'pearlChanged' && message.ev.op === 'swallow'), false,
      'fresh login does not replay a swallow notification');
    calmAndAlone(host, owner);
    const deniedBefore = owner.socket.messages.length;
    await sendCommand(host, owner.socket, { op: 'swallow', uid: UID });
    await sendCommand(host, owner.socket, { op: 'spit', uid: UID });
    await sendCommand(host, owner.socket, { op: 'leave', uid: UID });
    await sendCommand(host, owner.socket, { op: 'give', target: other.entity, uid: UID });
    const denied = owner.socket.messages.slice(deniedBefore).filter(message => message.t === MSG.EVENT).map(message => message.ev)
      .filter(event => ['pearlDenied', 'commandDenied'].includes(event?.type));
    assert.ok(denied.length >= 4, `all bound UID mutation commands are denied: ${JSON.stringify(denied)}`);
    for (let i = 0; i < 20; i++) { host.server.step(); await turn(); }
    const transactions = (await storage.db.query(`select operation_id,request from public.mn_ground_transactions
      where request->'operation'->>'uid'=$1`, [UID])).rows;
    assert.equal(transactions.length, 2, 'the seed registration and one swallow are the only UID receipts');
    assert.deepEqual(transactions.filter(q => q.request.operation.from === OWNER && q.request.operation.to === OWNER)
      .map(q => q.operation_id), [expectedOperationId], 'denied commands produce no receipt or duplicate swallow');
    assert.deepEqual((await storage.store.loadProfile(OWNER)).data.pearls, committedProfile.pearls);
    assert.deepEqual((await storage.db.query('select public.mn_load_unique($1) as data', [UID])).rows[0].data, unique);
    assert.deepEqual((await storage.db.query('select public.mn_load_pearl_location($1) as data', [UID])).rows[0].data, location);
    assert.equal(host.server.world.events.filter(event => event.type === 'pearlChanged' && event.op === 'swallow').length, 0,
      'recovery and denials do not publish historical swallow events');
    process.stdout.write(JSON.stringify({ phase, operationId: expectedOperationId, uid: UID, holder: unique.holder,
      generation: location.version, profileVersion: profileRow.version,
      profileExpectedVersion: operation.profiles[0].expectedVersion, profileCas: row.result.effect.profiles.length,
      recoveredPower: KIND_NAME, deniedCommands: denied.length, receipts: transactions.length, historical: historicalAtStartup }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await storage.close(); }
  }
}

if (mode === 'hold') await hold(); else await recover();
