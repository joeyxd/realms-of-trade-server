import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { adapters as communityAdapters, communitySql } from './helpers/community-sql.mjs';
import { clockOp, clockRequest } from './helpers/ground-clock-contract.mjs';
import { database as gameplayDatabase } from './helpers/ground-clock-sql.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

test('optional community SQL coexists with gameplay migrations and preserves M5 profile, world, and clock receipts', async (t) => {
  const gameplay = await gameplayDatabase();
  t.after(() => gameplay.close());
  const community = communityAdapters(gameplay.db);
  const characterId = id(502), worldId = 'world:coexistence', epoch = id(501);

  const profile = newProfile();
  profile.pirateId = `account:${characterId}`;
  profile.gold = 417;
  profile.eco.pack.goods = { madera: 7, piedra: 2 };
  assert.deepEqual(await gameplay.store.saveProfile(characterId, profile, 0), { ok: true, version: 1 });
  const profileSnapshot = await gameplay.store.loadProfile(characterId);

  const worldData = { v: 1, seed: 502, clock: 90, rng: 101, markets: ['salty-shore'] };
  assert.deepEqual(await gameplay.store.saveWorld(worldId, worldData, 0), { ok: true, version: 1 });
  const worldSnapshot = await gameplay.store.loadWorld(worldId);
  const clockRequestRow = clockRequest(clockOp(502), { world: worldId, tick: 123 });
  const clockResult = await gameplay.store.commitGroundClock(clockRequestRow);
  const clockSnapshot = await gameplay.store.loadGroundClock(worldId);
  const clockReceipt = await gameplay.store.loadGroundClockOperation(clockRequestRow.operationId);

  await gameplay.db.exec('RESET ROLE');
  await gameplay.db.exec(communitySql);
  await gameplay.db.exec('SET ROLE service_role');
  const character = { worldId, worldEpoch: epoch, characterId, version: 1, data: {
    v: 1, eco: { tradeRev: 0, pack: { cap: 20, goods: { madera: 3 } } },
  } };
  const project = { worldId, worldEpoch: epoch, projectId: 'coexist:hall', version: 1,
    requirements: { madera: 3 }, contributed: { madera: 0 } };
  assert.deepEqual(await community.store.initializeCharacter(character), { ok: true, character });
  assert.deepEqual(await community.store.initializeProject(project), { ok: true, project });
  const request = { operationId: id(503), worldId, worldEpoch: epoch, characterId,
    projectId: project.projectId, good: 'madera', amount: 2,
    expectedCharacterVersion: 1, expectedProjectVersion: 1 };
  const contribution = await community.store.commitContribution(request);
  assert.equal(contribution.ok, true);
  assert.equal(contribution.accepted, 2);

  assert.deepEqual(await gameplay.store.loadProfile(characterId), profileSnapshot);
  assert.deepEqual(await gameplay.store.loadWorld(worldId), worldSnapshot);
  assert.deepEqual(await gameplay.store.loadGroundClock(worldId), clockSnapshot);
  assert.deepEqual(await gameplay.store.loadGroundClockOperation(clockRequestRow.operationId), clockReceipt);
  assert.deepEqual(await community.store.loadContributionReceipt(request.operationId),
    { request, result: contribution });

  await gameplay.db.exec('RESET ROLE');
  await gameplay.db.exec(communitySql);
  await gameplay.db.exec('SET ROLE service_role');
  assert.deepEqual(await community.store.loadCharacter(worldId, epoch, characterId), contribution.character);
  assert.deepEqual(await community.store.loadProject(worldId, epoch, project.projectId), contribution.project);
  assert.deepEqual(await community.store.loadContributionReceipt(request.operationId),
    { request, result: contribution });
  assert.deepEqual(await gameplay.store.loadProfile(characterId), profileSnapshot);
  assert.deepEqual(await gameplay.store.loadWorld(worldId), worldSnapshot);
  assert.deepEqual(await gameplay.store.loadGroundClock(worldId), clockSnapshot);
  assert.deepEqual(await gameplay.store.loadGroundClockOperation(clockRequestRow.operationId), clockReceipt);
});
