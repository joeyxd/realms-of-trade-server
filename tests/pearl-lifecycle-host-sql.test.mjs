import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { GroundClockSession } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { database } from './helpers/ground-clock-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, KILLER } from './helpers/death-storage.mjs';
import { Socket, deferred } from './helpers/pearl-lifecycle-host.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { C } from '../src/sim/ecs.js';

const DURABLE = 2 ** 32 + 10000;
const clockOp = n => `77200000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function clock(store, initialize = false) {
  const session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(0);
  if (initialize) {
    assert.equal(session.drain(0).state, 'missing');
    await session.initialize({ operationId: clockOp(1), localTick: 0, tick: DURABLE });
  }
  assert.equal(session.drain(0).state, 'ready');
  return { session, deadline: new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1', epoch: session.epoch }) };
}

function host(db, deadline, wrap = s => s) {
  const h = new GameHost({ seed: 42, bots: 0, store: wrap(db.store), worldId: WORLD,
    pearlJournal: db.journal(WORLD), resolvePlayer: async (_req, msg) => msg.token === 'v' ? VICTIM : KILLER, log() {} });
  h.mountPearlStaging({ scope: WORLD, deadlineClock: deadline });
  h.mountDeathStaging({ scope: WORLD }); h.mountCombatDeaths(); h.mountDeathDrops(); h.mountPearlGround();
  h.mountPearlStartup({ accountPolicy: 'accounts-only', deathDrops: true, pageSize: 1 });
  return h;
}
async function join(h, token) {
  const socket = new Socket(), id = h.nextId;
  h.onConnection(socket, { headers: {}, socket: { remoteAddress: 'sql-host-fixture' } });
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
  await Promise.all([...h.joins]);
  const entity = h.server.clients.get(id).entity; assert.ok(entity);
  return { id, entity, socket };
}
function quiet(h) {
  const w = h.server.world;
  for (const e of w.profiles.keys()) { w.ecs.x[e] = 10000; w.ecs.z[e] = 10000; }
  for (let e = 1; e < w.ecs.cap; e++) if (w.ecs.mask[e] & C.ENEMY) { w.ecs.alive[e] = 0; w.ecs.mask[e] = 0; }
}
async function advance(h) {
  for (let n = 0; n < 50; n++) {
    if (h.server.step()) return;
    assert.equal(h.closing, false, 'held receipt must not silently fence a valid source');
    await Promise.all([h.pearlGround.settle(), h.deathDropStaging.settle(), h.deathStaging.settle()]);
  }
  assert.fail('completed-tick drain did not finish');
}

test('SDK/SQL001-013 whole death restores mixed ground in a fresh GameHost, then durable pickup survives another host', async () => {
  const db = await database(), hosts = [];
  try {
    const seed = makeDeath({ lawless: true, killer: true, pearlCount: 2, loot: true });
    const { request } = planRequest(seed); await seedDeathStore(db.store, seed, request);
    const origin = await clock(db.store, true), first = host(db, origin.deadline); hosts.push(first);
    await first.prepare();
    const v = await join(first, 'v'), k = await join(first, 'k'), w = first.server.world;
    quiet(first); w.ecs.x[v.entity] = w.map.cala.x; w.ecs.z[v.entity] = w.map.cala.z;
    const death = first.requestDeath({ victim: { clientId: v.id, entity: v.entity },
      killer: { clientId: k.id, entity: k.entity }, seq: 9 });
    await first.deathStaging.settle(); await advance(first);
    const receipt = await db.store.loadDeathOperation(death.operationId);
    assert.equal(receipt.result.ok, true);
    assert.equal(w.profiles.get(v.entity).pearls.swallowed, null);
    assert.equal(w.profiles.get(v.entity).pearls.bag.length, 0);
    assert.ok(w.profiles.get(v.entity).xp < seed.world.profiles.get(seed.entity).xp);
    assert.ok([...w.drops.values()].some(d => d.kind === 'item' && d.groundClock));
    assert.equal([...w.drops.values()].filter(d => d.kind === 'pearl' && d.groundClock).length, 2);
    quiet(first); w.tick = 30;
    await origin.session.checkpoint({ operationId: clockOp(2), localTick: 30 });
    assert.equal(origin.session.drain(30).state, 'ready'); await first.close();

    const restoredClock = await clock(db.store), second = host(db, restoredClock.deadline); hosts.push(second);
    assert.equal(second.healthy(), false); assert.equal(second.server.world.drops.size, 0);
    await second.prepare();
    const current = second.server.world, pearls = [...current.drops.values()].filter(d => d.kind === 'pearl');
    assert.equal(current.tick, 0); assert.equal(current.events.length, 0);
    assert.equal(current.drops.size, receipt.result.drops.length + 2);
    assert.equal(pearls.length, 2); assert.ok(pearls.every(d => d.pickAt === 0));
    for (const d of current.drops.values()) restoredClock.deadline.assertDrop(d, d.kind === 'pearl' ? 'pearl' : 'drop');
    const receiver = await join(second, 'k'); quiet(second);
    current.ecs.x[receiver.entity] = pearls[0].x; current.ecs.z[receiver.entity] = pearls[0].z;
    await advance(second);
    const uid = pearls[0].pearl.uid;
    assert.equal(current.drops.has(pearls[0].id), false);
    assert.equal((await db.store.loadUnique(uid)).holder, KILLER);
    assert.equal((await db.store.loadPearlLocation(uid)).ground, null);
    const item = [...current.drops.values()].find(d => d.kind === 'item');
    if (item) {
      quiet(second); current.tick += (3 - current.tick % 3) % 3;
      current.ecs.x[receiver.entity] = item.x; current.ecs.z[receiver.entity] = item.z;
      await advance(second);
      assert.equal((await db.store.loadDeathDrop(item.operationId, item.ordinal)).state, 'picked');
    }
    await second.close();
    const third = host(db, (await clock(db.store)).deadline); hosts.push(third); await third.prepare();
    assert.ok([...third.server.world.drops.values()].every(d => d.pearl?.uid !== uid));
    if (item) assert.ok([...third.server.world.drops.values()].every(d => d.operationId !== item.operationId || d.ordinal !== item.ordinal));
    const reopened = await join(third, 'k');
    assert.equal(third.server.world.profiles.get(reopened.entity).pearls.bag.filter(q => q.uid === uid).length, 1);
    assert.equal((await db.store.loadProfile(VICTIM)).data.stats.deaths, 1);
    assert.equal((await db.store.loadProfile(KILLER)).data.stats.pk, 1);
  } finally { for (const h of hosts) await h.close().catch(() => {}); await db.close(); }
});

test('SDK/SQL001-013 committed return closed before apply restores only its receipted beach destination', async () => {
  const db = await database(), hosts = [], entered = deferred(), release = deferred();
  try {
    const origin = await clock(db.store, true), journal = db.journal(WORLD);
    const source = { operationId: '77300000-0000-4000-8000-000000000001', uid: 'host-return-crash', kind: 'tinta',
      from: null, to: null, expectedVersion: 0, profiles: [], world: WORLD,
      ground: { x: 1, z: 2, availableAt: DURABLE, returnAt: DURABLE + 9 } };
    await journal.prepare('ground', source); assert.equal((await db.store.commitPearlGround(source)).ok, true);
    await journal.resolve('ground', source, 'committed');
    const calls = [], first = host(db, origin.deadline, s => ({ ...s, async commitPearlGround(r) {
      calls.push(structuredClone(r)); const result = await s.commitPearlGround(r); entered.resolve(); await release.promise; return result;
    } })); hosts.push(first); await first.prepare();
    const w = first.server.world, old = [...w.drops.values()][0], rngBefore = w.lootRng.state();
    w.tick = 12;
    await origin.session.checkpoint({ operationId: clockOp(2), localTick: 12 });
    assert.equal(origin.session.drain(12).state, 'ready');
    assert.equal(first.server.step(), false); await entered.promise;
    const destination = await db.store.loadPearlLocation(source.uid);
    assert.equal(destination.version, 2); assert.equal(w.drops.get(old.id), old);
    assert.equal(w.lootRng.state(), rngBefore); assert.equal(w.events.length, 0);
    const closing = first.close(), rejected = assert.rejects(closing, { code: 'flush' });
    release.resolve(); await rejected;
    assert.equal(w.drops.get(old.id), old); assert.equal(w.lootRng.state(), rngBefore);
    assert.equal(calls.length, 1);
    const evidence = await db.store.loadPearlGroundOperation(calls[0].operationId);
    assert.deepEqual(evidence.request.ground, destination.ground);
    assert.equal((await db.store.commitPearlGround(calls[0])).replay, true);
    const second = host(db, (await clock(db.store)).deadline); hosts.push(second); await second.prepare();
    const restored = [...second.server.world.drops.values()]; assert.equal(restored.length, 1);
    assert.deepEqual({ x: restored[0].x, z: restored[0].z }, { x: destination.ground.x, z: destination.ground.z });
    assert.equal(restored[0].pickAt, 30); assert.equal(restored[0].pearl.uid, source.uid);
    assert.equal(second.server.world.events.length, 0, 'startup does not replay return/loot events');
    assert.equal((await db.store.loadUnique(source.uid)).version, 2);
    assert.deepEqual((await db.store.loadPearlLocation(source.uid)), destination);
  } finally { release.resolve(); for (const h of hosts) await h.close().catch(() => {}); await db.close(); }
});
