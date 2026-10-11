import test from 'node:test';
import assert from 'node:assert/strict';
import { database, adapters, assetRegistrySql } from './helpers/web3-asset-registry-sql.mjs';
import { database as gameDatabase } from './helpers/death-journal-sql.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const request = { operationId: id(700), action: 'register', assetId: id(701), worldId: 'boundary:world',
  worldGeneration: id(702), assetClass: 'plot', sourceKey: 'lot:0', contentId: 'lot',
  contentHash: 'a'.repeat(64), rightsHash: 'b'.repeat(64), to: id(703) };

test('claim checks and mutation RPCs reject transaction snapshots outside their supported isolation', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  await sql.registry.prepare(request);
  const attempts = [
    ['select public.mn_web3_prepare($1::jsonb)', [JSON.stringify(request)]],
    ['select public.mn_web3_commit($1::uuid)', [request.operationId]],
    ['select public.mn_web3_cancel($1::uuid)', [request.operationId]],
    ['select public.mn_web3_check_claim($1::uuid,$2::uuid,$3::integer)', [request.assetId, request.to, 1]],
  ];
  for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) for (const [statement, args] of attempts) {
    await sql.db.exec(`BEGIN ISOLATION LEVEL ${isolation}`);
    try { await assert.rejects(sql.db.query(statement, args), (error) => error.code === 'MNW02'); }
    finally { await sql.db.exec('ROLLBACK'); }
  }
  assert.equal((await sql.registry.loadOperation(request.operationId)).state, 'pending');
  assert.equal(await sql.registry.loadAsset(request.assetId), null);
  const committed = await sql.registry.commit(request.operationId);
  assert.equal(committed.asset.ownerId, request.to);
  assert.deepEqual(await sql.registry.checkClaim({ assetId: request.assetId, ownerId: request.to, version: 1 }), { ok: true });
});

test('optional W01 migration coexists with M5 SQL001-010 and keeps profile authority independent', async (t) => {
  const game = await gameDatabase(); t.after(() => game.close());
  const profile = newProfile(); profile.gold = 31;
  await game.db.query('select public.mn_initialize_profile($1::uuid,$2::jsonb,null::text)', [request.to, profile]);
  const before = await game.store.loadProfile(request.to);
  await game.db.exec('RESET ROLE'); await game.db.exec(assetRegistrySql); await game.db.exec('SET ROLE service_role');
  const registry = adapters(game.db).registry;
  await registry.prepare(request); await registry.commit(request.operationId);
  assert.deepEqual(await game.store.loadProfile(request.to), before);
  const move = { operationId: id(704), action: 'transfer', assetId: request.assetId,
    worldId: request.worldId, worldGeneration: request.worldGeneration, from: request.to, to: id(705), expectedVersion: 1 };
  await registry.prepare(move); await registry.commit(move.operationId);
  const legacy = structuredClone(before.data); legacy.gold = 32;
  assert.equal((await game.store.saveProfile(request.to, legacy, before.version)).ok, true);
  assert.equal((await game.store.loadProfile(request.to)).data.gold, 32);
  assert.equal((await registry.loadAsset(request.assetId)).ownerId, move.to);
  assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: request.to, version: 1 }),
    { ok: false, why: 'ownership' });
});
