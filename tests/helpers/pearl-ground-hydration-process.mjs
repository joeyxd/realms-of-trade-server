import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './pearl-batch-journal-sql.mjs';
import { seed, request, state, A, B, WORLD, op } from './pearl-batch.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { PearlGroundHydration } from '../../server/pearlGroundHydration.mjs';
import { World } from '../../src/sim/world.js';
import { installInventory, attachProfile } from '../../src/sim/systems/inventory.js';
import { attachPearls } from '../../src/sim/systems/pearls.js';
import { map } from '../helpers.mjs';

const [phase, path, mode] = process.argv.slice(2);
assert.ok(['prepare','restore','verify'].includes(phase));
assert.ok(['death','replace'].includes(mode));
let f;
try {
  if (phase === 'prepare') {
    f = await database();
    const original = await seed(f.store), raw = request(original, mode);
    const second = await f.store.loadProfile(B); second.data.pirateId = `account:${B}`;
    assert.equal((await f.store.saveProfile(B, second.data, second.version)).ok, true);
    await f.journal.prepare('batch', raw);
    assert.equal((await f.store.commitPearlBatch(raw)).ok, true);
    assert.equal((await f.journal.list()).length, 1, 'simulate crash after commit before journal resolution');
    await writeFile(join(path, 'seed.json'), JSON.stringify({ raw, state: await state(f.store) }), { flag: 'wx' });
    const image = await f.db.dumpDataDir();
    await writeFile(join(path, 'database.tar'), Buffer.from(await image.arrayBuffer()), { flag: 'wx' });
  } else {
    // Export/import actual Postgres state across process boundaries. Avoid the NodeFS initdb
    // timeout on this Windows machine; this verifies data reconstruction, not filesystem durability.
    const db = new PGlite({ loadDataDir: new Blob([await readFile(join(path, 'database.tar'))]) });
    await db.exec('SET ROLE service_role');
    f = { db, ...adapters(db), close: () => db.close() };
    const original = JSON.parse(await readFile(join(path, 'seed.json'), 'utf8'));
    const sessions = new ProfileSessions(f.store, null, { journal: f.journal });
    const outcomes = await sessions.recoverPearls();
    assert.deepEqual(outcomes, phase === 'restore' ? [{ operationId: original.raw.operationId, outcome: 'committed' }] : []);
    const stored = await state(f.store), rows = await f.store.listPearlGround(WORLD);
    const world = new World(42, { map, server: true }); installInventory(world, WORLD);
    world.tick = 1000; world.nextDrop = 7;
    const rng = [world.rng.state(), world.lootRng.state()];
    const hydration = new PearlGroundHydration({ sessions, world, worldId: WORLD, pageSize: 2,
      mapClock: (g) => ({ availableAt: g.availableAt + 500, returnAt: g.returnAt + 500 }) });
    const ready = await hydration.start();
    assert.deepEqual(ready, { state: 'ready', count: rows.length });
    assert.equal(world.drops.size, 0, 'reads never mutate World');
    assert.deepEqual(hydration.drain(), { state: 'applied', count: rows.length });
    assert.deepEqual(hydration.drain(), { state: 'applied', count: rows.length });
    assert.equal(world.drops.size, rows.length); assert.equal(world.nextDrop, 7 + rows.length);
    assert.equal(world.nextPearl, 1); assert.equal(world.events.length, 0);
    assert.equal(world.profileDirty.size, 0); assert.deepEqual([world.rng.state(), world.lootRng.state()], rng);
    for (const [i, row] of rows.entries()) {
      assert.deepEqual(world.drops.get(7 + i), { id: 7 + i, to: 0, kind: 'pearl',
        pearl: { uid: row.uid, kind: row.kind }, x: row.ground.x, z: row.ground.z,
        pickAt: row.ground.availableAt + 500, t: row.ground.returnAt + 500 });
      assert.deepEqual(world.pearlLedger.get(row.uid), { owner: '', entity: 0, place: 'ground', drop: 7 + i });
    }
    assert.deepEqual(await state(f.store), stored, 'hydration never changes durable data');
    assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length, 0);
    assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length, 0);
    const profile = await sessions.open(1, A), entity = world.spawnPlayer({ clientId: 1 });
    const spawnedEvents = structuredClone(world.events);
    attachProfile(world, entity, profile);
    assert.deepEqual(profile.pearls, stored.profiles[0].data.pearls);
    assert.deepEqual(world.events, spawnedEvents, 'current profile attaches without historical loot or pearlChanged');
    if (phase === 'restore') {
      const picked = rows[0], recipient = await f.store.loadProfile(B);
      recipient.data.pearls.bag.push({ uid: picked.uid, kind: picked.kind });
      assert.equal((await f.store.commitPearlGround({ operationId: op(80), uid: picked.uid, kind: picked.kind,
        expectedVersion: picked.version, from: null, to: B, world: WORLD, ground: null,
        profiles: [{ id: B, expectedVersion: recipient.version, data: recipient.data }] })).ok, true);
      await writeFile(join(path, 'advanced.json'), JSON.stringify({ state: await state(f.store), picked }), { flag: 'wx' });
      const image = await f.db.dumpDataDir();
      await writeFile(join(path, 'database.tar'), Buffer.from(await image.arrayBuffer()));
    } else {
      const advanced = JSON.parse(await readFile(join(path, 'advanced.json'), 'utf8'));
      assert.deepEqual(stored, advanced.state);
      assert.equal(world.drops.size, (mode === 'death' ? 4 : 1) - 1);
      assert.equal(world.pearlLedger.has(advanced.picked.uid), false, 'tombstone is not restored as ground');
      const received = await sessions.open(2, B), other = world.spawnPlayer({ clientId: 2 });
      attachProfile(world, other, received);
      assert.ok(received.pearls.bag.some((q) => q.uid === advanced.picked.uid));
      assert.equal(world.pearlLedger.get(advanced.picked.uid).owner, received.pirateId);
      if (rows.length) {
        const stale = structuredClone(profile);
        stale.pearls.bag.push({ uid: rows[0].uid, kind: rows[0].kind });
        attachPearls(world, entity, stale);
        assert.equal(stale.pearls.bag.some((q) => q.uid === rows[0].uid), false, 'ground authority rejects stale inventory');
        assert.equal(world.events.at(-1).why, 'stale');
      }
      assert.deepEqual(await state(f.store), advanced.state);
    }
    sessions.close(1); sessions.close(2); await sessions.flush();
  }
  process.stdout.write(JSON.stringify({ phase, mode, passed: true }) + '\n');
} finally { await f?.close(); }
