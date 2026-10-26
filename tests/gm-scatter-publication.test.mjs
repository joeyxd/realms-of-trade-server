import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GAME } from '../src/data/meta.js';
import { resourceLayout } from '../src/data/resources.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDecoration, createDocument, validateDocument } from '../src/editor/document.js';
import { canonicalJson, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { applyScatter, planScatter, scatterParameters } from '../src/editor/scatterBrush.js';
import { measureModelCost } from '../src/editor/modelCost.js';
import { canScatterAt } from '../src/editor/terrainData.js';
import { shrubGeometry } from '../src/render/shrubGeometry.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_REVISION = 'terrain-s21-v1';
const WORLD_ID = 'gm-scatter-publication-test';
const ASSET_ID = 'model:shrub-round-v1';
const hashJson = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function shrubMetrics() {
  const parts = shrubGeometry(0), root = new THREE.Group();
  root.add(new THREE.Mesh(parts.stems, new THREE.MeshBasicMaterial()),
    new THREE.Mesh(parts.leaves, new THREE.MeshBasicMaterial()));
  return measureModelCost(root);
}

function safeCenter(map) {
  const origin = map.landmarks.village;
  for (let radius = 10; radius <= 48; radius += 4) for (let angleIndex = 0; angleIndex < 64; angleIndex++) {
    const angle = angleIndex * Math.PI / 32;
    const x = origin.x + Math.cos(angle) * radius, z = origin.z + Math.sin(angle) * radius;
    if (map.groundAt(x, z) > 1 && canScatterAt(map, x, z, 1.5)) return { x, z };
  }
  throw new Error('Could not find a flat, unprotected scatter patch in the generated world');
}

test('real shrub scatter survives document and publication compilation without duplicating assets or world state', async () => {
  const map = generateWorld(GAME.seed);
  const [manifest, editorCatalog, thumbnailIndex] = await Promise.all([
    readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8').then(JSON.parse),
    readFile(path.join(ROOT, 'assets/editor/thumbnails.json'), 'utf8').then(JSON.parse),
  ]);
  assert.ok(manifest.assets.some((asset) => asset.id === ASSET_ID && asset.kind === 'model'), 'the scatter ref is shipped in the runtime manifest');
  assert.equal(thumbnailIndex.assets[ASSET_ID].stats.triangles, 424, 'catalog geometry stats match the real generated shrub model');

  const metrics = shrubMetrics();
  assert.equal(metrics.triangles, thumbnailIndex.assets[ASSET_ID].stats.triangles);
  assert.equal(metrics.primitives, 2);
  assert.ok(metrics.radius > 0);
  const validateReferences = createGmDraftValidator({ map, baseRevision: BASE_REVISION, manifest, editorCatalog });
  const service = createGmPublicationService({ root: ROOT, map, baseRevision: BASE_REVISION, worldId: WORLD_ID,
    validateReferences, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
  await service.prepare();

  const collidersBefore = structuredClone(map.colliders);
  const resourcesBefore = resourceLayout(map);
  const resourceHashBefore = hashJson(resourcesBefore);
  const center = safeCenter(map), points = [center];
  const parameters = scatterParameters({ radius: 2, strength: 1, falloff: 0, spacing: .5,
    scaleMin: .5, scaleMax: .6, seed: 987 });

  // Brush policy and per-gesture budgets constrain the scatter tool. GM-authorized manual placement
  // continues to use the existing document/publication contract, which has its own validation rules.
  const sourceV2 = createDocument({ seed: map.seed, baseRevision: BASE_REVISION });
  const planV2 = planScatter({ map, document: sourceV2, assetId: ASSET_ID, points, parameters, metrics,
    isAllowed: (x, z, radius) => canScatterAt(map, x, z, radius) });
  assert.ok(planV2.placements.length >= 5, `expected several safe copies, got ${planV2.placements.length}`);
  const appliedV2 = applyScatter(sourceV2, planV2, (index) => `scatter-v2-${index}`);
  const checkedV2 = validateDocument(appliedV2.document);
  assert.equal(canonicalJson(checkedV2), canonicalJson(appliedV2.document), 'document v2 roundtrips canonically');
  assert.equal(validateReferences(checkedV2).objects.length, planV2.placements.length);
  assert.ok(checkedV2.objects.every((item) => item.assetId === ASSET_ID && item.collider === 'none'));

  const firstV1 = await service.build({ document: checkedV2, draftRevision: 1 });
  const repeatedV1 = await service.build({ document: checkedV2, draftRevision: 1 });
  assert.equal(firstV1.report.valid, true, JSON.stringify(firstV1.report.issues));
  assert.ok(firstV1.revision);
  assert.equal(firstV1.revision.content.compilerVersion, PUBLICATION_COMPILER_VERSION);
  assert.equal(firstV1.revision.content.sourceRevision, 1);
  assert.deepEqual(firstV1.revision.content.assets.map((asset) => asset.id), [ASSET_ID], 'many copies pin the source GLB once');
  assert.equal(firstV1.revision.revisionId, repeatedV1.revision.revisionId, 'same canonical document and draft revision hash identically');
  assert.equal(firstV1.revision.revisionId, hashJson(firstV1.revision.content));
  assert.equal(firstV1.revision.content.collision.count, collidersBefore.length);
  assert.equal(firstV1.revision.content.collision.sha256, hashJson(collidersBefore));
  assert.equal(firstV1.revision.content.base.resourcesHash, resourceHashBefore);

  const sourceV4 = createDocument({ seed: map.seed, baseRevision: BASE_REVISION,
    terrain: { version: 2, samples: [], materials: [] } });
  const planV4 = planScatter({ map, document: sourceV4, assetId: ASSET_ID, points, parameters, metrics,
    isAllowed: (x, z, radius) => canScatterAt(map, x, z, radius) });
  assert.deepEqual(planV4.placements, planV2.placements, 'same seed and gesture produce the same placement list for both document versions');
  const appliedV4 = applyScatter(sourceV4, planV4, (index) => `scatter-v4-${index}`);
  const checkedV4 = validateDocument(appliedV4.document);
  assert.equal(canonicalJson(validateReferences(checkedV4)), canonicalJson(checkedV4));
  const preparedV2 = await service.build({ document: checkedV4, draftRevision: 2 });
  assert.equal(preparedV2.report.valid, true, JSON.stringify(preparedV2.report.issues));
  assert.ok(preparedV2.revision);
  assert.equal(preparedV2.revision.content.compilerVersion, 2);
  assert.equal(preparedV2.revision.content.sourceRevision, 2);
  assert.equal(preparedV2.revision.content.document.version, 4);
  assert.deepEqual(preparedV2.revision.content.assets.map((asset) => asset.id), [ASSET_ID]);

  // Existing server rules allow a GM-authorized visual-only manual placement at an anchor;
  // canScatterAt still rejects that spot for decorative brush placement.
  const spawn = map.landmarks.spawn;
  assert.equal(canScatterAt(map, spawn.x, spawn.z, .8), false);
  const manualAtSpawn = createDocument({ seed: map.seed, baseRevision: BASE_REVISION, objects: [createDecoration({
    id: 'manual-shrub-spawn', assetId: ASSET_ID,
    position: { x: spawn.x, y: map.groundAt(spawn.x, spawn.z), z: spawn.z }, collider: 'none',
  })] });
  assert.doesNotThrow(() => validateReferences(manualAtSpawn));
  const manualPrepared = await service.build({ document: manualAtSpawn, draftRevision: 3 });
  assert.equal(manualPrepared.report.valid, true, JSON.stringify(manualPrepared.report.issues));

  assert.deepEqual(map.colliders, collidersBefore, 'scatter/publication preparation does not mutate map colliders');
  assert.deepEqual(resourceLayout(map), resourcesBefore, 'scatter/publication preparation does not mutate functional resources');
});
