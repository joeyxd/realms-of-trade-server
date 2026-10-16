import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { openChest, spawnDrop, installInventory, newProfile, attachProfile, lootOnKill } from '../src/sim/systems/inventory.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { mulberry32 } from '../src/core/rng.js';
import { rollItem } from '../src/sim/items.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { MSG } from '../src/net/protocol.js';
import { fixture, joinPlayer, injectStep, deferred, turn } from './helpers/ground-pearl-mint-host.mjs';

const pearls = world => [...world.drops.values()].filter(d => d.kind === 'pearl');
const copy = structuredClone;
async function driveUntil(host, ready, label) {
  for (let i = 0; i < 100 && !ready(); i++) { host.server.step(); await turn(); }
  assert.ok(ready(), `${label} was not reached; mint=${JSON.stringify(host.groundPearlMints.status())}; ` +
    `death=${JSON.stringify(host.groundDeaths.status())}; authority=${JSON.stringify(host.groundAuthority.status())}`);
}

test('unmounted lootOnKill and openChest still insert rolled pearls immediately', () => {
  const w = new World(GAME.seed, { server: true }); installInventory(w, 'mint-default');
  const e = w.spawnPlayer({ x: w.map.cala.x, z: w.map.cala.z }); attachProfile(w, e, newProfile());
  w.lootRng = mulberry32(5);
  const sentinel = w.spawnEnemy('sentinel', w.ecs.x[e] + 3, w.ecs.z[e]);
  w.killEnemy(sentinel, e);
  assert.equal(pearls(w).length, 1, 'the actual sentinel loot route uses the legacy immediate path when unmounted');
  w.drops.clear(); w.events.length = 0; w.lootRng = mulberry32(13);
  const chest = spawnDrop(w, e, 'chest', { item: rollItem(mulberry32(145), { lvl: 2, uid: 78 }) });
  w.ecs.x[e] = chest.x; w.ecs.z[e] = chest.z;
  assert.equal(openChest(w, e, chest.id), true);
  assert.equal(pearls(w).length, 1, 'the actual chest route uses the legacy immediate path when unmounted');
});

test('real sentinel loot captures synchronously, retains its tick, commits SQL, then drains after same-tick death', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => { entered.resolve(copy(raw)); await release.promise; } });
  const host = f.host, player = await joinPlayer(host), w = host.server.world;
  try {
    const point = w.map.cala; w.ecs.x[player.entity] = point.x; w.ecs.z[player.entity] = point.z;
    w.lootRng = mulberry32(5);
    const sentinel = w.spawnEnemy('sentinel', point.x + 3, point.z);
    const startTick = w.tick, socketMessages = player.socket.messages.length;
    const hp = w.ecs.hp[player.entity];
    f.armCommitHook();
    injectStep(host, () => {
      w.killEnemy(sentinel, player.entity);
      hurtPlayer(w, player.entity, hp + 1000, { x: point.x, z: point.z, kind: 'test', seq: 1,
        by: sentinel, pierce: true, noInv: true, knock: 0 });
    });
    assert.equal(host.server.step(), true);
    await driveUntil(host, () => host.groundPearlMints.status().pending > 0 && f.transactions.some(tx =>
      tx.request?.family === 'ground' && tx.request.operation?.uid?.startsWith('mint:')), 'mint transaction');
    const raw = await entered.promise;
    assert.equal(raw.request.family, 'ground');
    assert.equal(raw.request.operation.expectedVersion, 0);
    const uid = raw.request.operation.uid, operationId = raw.operationId;
    assert.match(uid, /^mint:[0-9a-f-]{36}$/i);
    assert.equal(uid, `mint:${operationId}`);
    assert.equal(f.mints.status().pending, 1);
    assert.equal(w.tick, startTick + 1);
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false);
    assert.equal(w.pearlLedger.has(uid), false);
    assert.equal(w.events.some(e => e.type === 'loot' && e.drops?.some(d => d.kind === 'pearl')), false,
      'the minted pearl event is absent before the common boundary drains it');
    assert.equal(player.socket.messages.length, socketMessages, 'the held completed tick has not published socket messages');
    const heldTick = w.tick;
    assert.equal(host.server.step(), false, 'the committed-but-not-drained mint blocks the next simulation tick');
    assert.equal(w.tick, heldTick);

    release.resolve(); await host.groundAuthority.settle();
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false, 'a ready SQL receipt does not apply gameplay early');
    assert.equal(host.server.step(), true, 'the next common beforeTick drains the receipt');
    const drop = pearls(w).find(d => d.pearl.uid === uid);
    assert.ok(drop);
    assert.deepEqual(w.pearlLedger.get(uid), { owner: '', entity: 0, place: 'ground', drop: drop.id });
    assert.equal((await f.currentStore().loadUnique(uid)).version, 1);
    assert.deepEqual((await f.currentStore().loadPearlLocation(uid)).ground, drop.groundClock.ground);
    assert.equal(f.mints.status().pending, 0);
    assert.equal(f.mints.status().completed, 1);
    assert.ok(player.socket.messages.some(m => m.t === MSG.EVENT && m.ev.type === 'loot' &&
      m.ev.drops?.some(d => d.id === drop.id && d.kind === 'pearl')));
    assert.ok(player.socket.messages.length > socketMessages, 'publication resumes after every operation from the tick is applied');
    const deaths = f.transactions.filter(tx => tx.request?.family === 'death');
    const mints = f.transactions.filter(tx => tx.request?.family === 'ground' && tx.request.operation?.uid?.startsWith('mint:'));
    assert.equal(deaths.length, 1, 'the actual fatal hit in the same tick completed its death transaction');
    assert.equal(mints.length, 1);
    assert.ok(f.transactions.indexOf(deaths[0]) < f.transactions.indexOf(mints[0]), 'death is serialized before mint');
    assert.equal(host.groundDeaths.status().pending, 0);
    assert.equal(host.groundAuthority.status().failed, false);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('two real mint routes in one tick publish only after both SQL receipts drain', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => { entered.resolve(copy(raw)); await release.promise; } });
  const host = f.host, player = await joinPlayer(host), w = host.server.world;
  try {
    const sentinel = w.spawnEnemy('sentinel', w.ecs.x[player.entity] + 3, w.ecs.z[player.entity]);
    const chest = spawnDrop(w, player.entity, 'chest', { item: rollItem(mulberry32(144), { lvl: 2, uid: 77 }) });
    w.ecs.x[player.entity] = chest.x; w.ecs.z[player.entity] = chest.z;
    w.ecs.x[sentinel] = chest.x + 3; w.ecs.z[sentinel] = chest.z;
    w.lootRng = mulberry32(5); f.armCommitHook();
    injectStep(host, () => {
      w.killEnemy(sentinel, player.entity);
      w.lootRng = mulberry32(13);
      assert.equal(openChest(w, player.entity, chest.id), true);
    });
    assert.equal(host.server.step(), true);
    for (let i = 0; i < 100 && !f.transactions.some(tx => tx.request?.family === 'ground' &&
      tx.request.operation?.uid?.startsWith('mint:')) && !f.mints.status().failed; i++) { host.server.step(); await turn(); }
    assert.ok(f.transactions.some(tx => tx.request?.family === 'ground' && tx.request.operation?.uid?.startsWith('mint:')),
      `chest transaction not reached; errors=${f.familyErrors.map(e => `${e.code}:${e.message}:${e.stack}`).join('|')}; ` +
      `mint=${JSON.stringify(f.mints.status())}; authority=${JSON.stringify(host.groundAuthority.status())}`);
    const raw = await entered.promise, uid = raw.request.operation.uid;
    assert.equal(raw.request.operation.expectedVersion, 0);
    assert.equal(f.mints.status().pending, 2);
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false);
    assert.equal(w.pearlLedger.has(uid), false);
    assert.equal(player.socket.messages.some(m => m.t === MSG.EVENT && ['loot', 'chest', 'kill'].includes(m.ev.type)), false,
      'the chest, kill and mint tick is retained while persistence is unresolved');
    const heldTick = w.tick;
    assert.equal(host.server.step(), false); assert.equal(w.tick, heldTick);
    release.resolve(); await host.groundAuthority.settle();
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false);
    for (let i = 0; i < 8 && (f.mints.status().pending || f.mints.status().completed < 2); i++) {
      host.server.step(); await turn(); await host.groundAuthority.settle();
    }
    const minted = pearls(w).filter(d => d.pearl.uid.startsWith('mint:'));
    assert.equal(minted.length, 2);
    const mints = f.transactions.filter(tx => tx.request?.family === 'ground' && tx.request.operation?.uid?.startsWith('mint:'));
    assert.equal(mints.length, 2);
    assert.equal(new Set(mints.map(tx => tx.request.operation.uid)).size, 2);
    assert.equal(f.mints.status().pending, 0);
    assert.equal(f.mints.status().completed, 2);
    for (const drop of minted) assert.equal((await f.currentStore().loadUnique(drop.pearl.uid)).version, 1);
    assert.equal(player.socket.messages.filter(m => m.t === MSG.EVENT && m.ev.type === 'loot' &&
      m.ev.drops?.some(d => minted.some(pearl => pearl.id === d.id))).length, 2,
    'both minted public events publish after both operations complete');
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('closing with a captured mint before its first drain rejects flush without durable or local effects', async t => {
  const f = await fixture(t), host = f.host, player = await joinPlayer(f.host), w = host.server.world;
  const point = w.map.cala; w.ecs.x[player.entity] = point.x; w.ecs.z[player.entity] = point.z;
  w.lootRng = mulberry32(5);
  const sentinel = w.spawnEnemy('sentinel', point.x + 3, point.z);
  injectStep(host, () => w.killEnemy(sentinel, player.entity));
  assert.equal(host.server.step(), true);
  const uid = [...w.events].flatMap(e => e.drops ?? []).find(d => d.kind === 'pearl')?.pearl?.uid;
  assert.equal(f.mints.status().pending, 1);
  assert.equal(uid, undefined, 'the random pearl is not inserted into public events during capture');
  await assert.rejects(host.close(), { code: 'flush' });
  assert.equal(pearls(w).length, 0);
  assert.equal([...w.pearlLedger.keys()].some(key => key.startsWith('mint:')), false);
  assert.equal((await f.db.db.query("select count(*)::int n from public.mn_ground_transactions where request::text like '%mint:%'")).rows[0].n, 0);
  assert.equal(player.socket.messages.some(m => m.t === MSG.EVENT && m.ev.type === 'loot' &&
    m.ev.drops?.some(d => d.kind === 'pearl')), false);
});

test('closing after mint SQL commit fences the delayed apply and retains its current receipt', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => { entered.resolve(copy(raw)); await release.promise; } });
  const host = f.host, player = await joinPlayer(host), w = host.server.world;
  try {
    const point = w.map.cala; w.ecs.x[player.entity] = point.x; w.ecs.z[player.entity] = point.z;
    w.lootRng = mulberry32(5);
    const sentinel = w.spawnEnemy('sentinel', point.x + 3, point.z);
    f.armCommitHook(); injectStep(host, () => w.killEnemy(sentinel, player.entity));
    assert.equal(host.server.step(), true);
    await driveUntil(host, () => f.transactions.some(tx => tx.request?.family === 'ground' &&
      tx.request.operation?.uid?.startsWith('mint:')), 'mint SQL commit');
    const raw = await entered.promise, uid = raw.request.operation.uid;
    release.resolve(); await host.groundAuthority.settle();
    await assert.rejects(host.close(), { code: 'flush' });
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false);
    assert.equal(w.pearlLedger.has(uid), false);
    assert.equal(player.socket.messages.some(m => m.t === MSG.EVENT && m.ev.type === 'loot' &&
      m.ev.drops?.some(d => d.pearl?.uid === uid)), false);
    assert.equal((await f.currentStore().loadUnique(uid)).version, 1);
    assert.equal((await f.currentStore().loadPearlLocation(uid)).version, 1);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('replacing afterTick while a mint receipt is retained rejects late application', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => { entered.resolve(copy(raw)); await release.promise; } });
  const host = f.host, player = await joinPlayer(host), w = host.server.world;
  try {
    const point = w.map.cala; w.ecs.x[player.entity] = point.x; w.ecs.z[player.entity] = point.z;
    w.lootRng = mulberry32(5);
    const sentinel = w.spawnEnemy('sentinel', point.x + 3, point.z);
    f.armCommitHook(); injectStep(host, () => w.killEnemy(sentinel, player.entity));
    assert.equal(host.server.step(), true);
    await driveUntil(host, () => f.transactions.some(tx => tx.request?.family === 'ground' &&
      tx.request.operation?.uid?.startsWith('mint:')), 'mint SQL commit');
    const raw = await entered.promise, uid = raw.request.operation.uid;
    host.server.afterTick = () => true;
    release.resolve(); await host.groundAuthority.settle();
    assert.equal(host.server.step(), false, 'the replaced completion owner cannot authorize receipt apply');
    assert.equal(host.groundAuthority.status().failed, true);
    assert.equal(pearls(w).some(d => d.pearl.uid === uid), false);
    assert.equal(w.pearlLedger.has(uid), false);
    assert.equal((await f.currentStore().loadUnique(uid)).version, 1, 'the durable SQL receipt remains recoverable');
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('mint ownership is explicit and closing or hook takeover prevents late authority use', async t => {
  const legacy = new GameHost({ bots: 0, log() {} });
  try {
    assert.equal(legacy.groundPearlMints, null);
    assert.throws(() => legacy.mountGroundPearlMints(), { code: 'configuration' });
  } finally { await legacy.close(); }
  const f = await fixture(t), host = f.host, mints = f.mints;
  host.server.world.deferPearlMint = () => false;
  assert.throws(() => mints.assertOwner(), { code: 'cancelled' });
  host.server.world.deferPearlMint = mints.hook;
  await host.close();
  assert.throws(() => mints.assertOwner(), { code: 'cancelled' });
});
