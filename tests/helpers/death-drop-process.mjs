import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './death-drop-sql.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, KILLER, WORLD, deathOp } from './death-drop-storage.mjs';
const [mode, dataPath, evidencePath] = process.argv.slice(2);
if (mode === 'seed') {
  const f = await database(dataPath);
  try {
    const source = await seedDeathDropScenario(f.store), pickup = await pickupRequest(f.store, source);
    f.loseNextReply();
    await assert.rejects(f.store.commitDeathDrop(pickup), { code: 'unavailable' });
    const receipt = await f.store.loadDeathDropOperation(pickup.operationId);
    assert.equal(receipt.result.ok, true);
    const expSource = { ...source, itemDrop: source.potionDrop }, expiry = await expiryRequest(expSource, { operation: 955 });
    assert.equal((await f.store.commitDeathDrop(expiry)).ok, true);
    const profile = await f.store.loadProfile(KILLER), advanced = structuredClone(profile.data); advanced.gold++;
    await f.store.saveProfile(KILLER, advanced, profile.version);
    await writeFile(evidencePath, JSON.stringify({ source, pickup, expiry, receipt,
      profile: await f.store.loadProfile(KILLER), ground: await f.store.listCurrentDeathDrops(WORLD) }));
  } finally { await f.close(); }
} else if (mode === 'read') {
  const db = new PGlite(dataPath);
  try {
    await db.exec('SET ROLE service_role');
    const f = adapters(db), e = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.deepEqual(await f.store.loadDeathDropOperation(e.pickup.operationId), e.receipt);
    assert.deepEqual(await f.store.commitDeathDrop(e.pickup), { ...e.receipt.result, replay: true });
    assert.deepEqual(await f.store.loadProfile(KILLER), e.profile);
    assert.deepEqual(await f.store.listCurrentDeathDrops(WORLD), e.ground);
    assert.equal((await f.store.loadDeathDrop(e.pickup.drop.operationId, e.pickup.drop.ordinal)).state, 'picked');
    assert.equal((await f.store.loadDeathDrop(e.expiry.drop.operationId, e.expiry.drop.ordinal)).state, 'expired');
    assert.equal((await f.store.listDeathDrops(WORLD)).length, e.source.death.drops.length);
    assert.equal(e.ground.length, e.source.death.drops.length - 2);
    assert.equal(await f.store.loadDeathDropOperation(deathOp(12345)), null);
  } finally { await db.close(); }
} else throw new Error('Unknown subprocess mode');
console.log('death-drop subprocess ' + mode + ' passed');
