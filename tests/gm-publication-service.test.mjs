import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { verifyPreparedRevision } from '../src/editor/publicationArtifact.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 123456;
const BASE = 'terrain-s21-v1';
const WORLD = 'gm-publication-service-test';
const GAME_VERSION = '0.6.0-test';
const PROTOCOL_VERSION = 99;
const TRANSFORM = (prop) => ({ position: { x: prop.x, y: prop.y, z: prop.z },
  rotation: { x: 0, y: prop.rot, z: 0 }, scale: prop.scale });

async function fixture() {
  const map = generateWorld(SEED);
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8'));
  const editorCatalog = JSON.parse(await readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8'));
  const validateReferences = createGmDraftValidator({ map, baseRevision: BASE, manifest, editorCatalog });
  const service = createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: WORLD,
    validateReferences, gameVersion: GAME_VERSION, protocolVersion: PROTOCOL_VERSION });
  await service.prepare();
  return { map, service };
}

function documentFor(map, { objects = [], baseOverrides = [] } = {}) {
  return createDocument({ seed: map.seed, baseRevision: BASE, objects, baseOverrides });
}

test('empty preparation is stable, scoped, hashed, and verifiable', async () => {
  const { map, service } = await fixture();
  const document = documentFor(map);
  const first = await service.build({ document, draftRevision: 7 });
  const second = await service.build({ document, draftRevision: 7 });
  assert.equal(first.report.valid, true);
  assert.equal(first.revision.schema, 'marea.gm.prepared-revision');
  assert.equal(first.revision.revisionId, second.revision.revisionId);
  assert.equal(first.revision.content.worldId, WORLD);
  assert.equal(first.revision.content.sourceRevision, 7);
  assert.equal(first.revision.content.documentHash.length, 64);
  assert.equal(first.revision.content.runtime.gameVersion, GAME_VERSION);
  assert.equal(first.revision.content.runtime.protocolVersion, PROTOCOL_VERSION);
  const coast = first.revision.content.baselineAssets.find((asset) => asset.id === 'model:coast-rock-v1');
  assert.ok(coast, 'an empty draft still pins the coastal models rendered by its base map');
  assert.equal(coast.sha256, (await import('node:crypto')).createHash('sha256').update(await readFile(path.join(ROOT, coast.src))).digest('hex'));
  assert.ok(first.revision.content.baselineAssets.some((asset) => asset.variant === 'mobile'));
  await assert.doesNotReject(verifyPreparedRevision(first.revision, {
    scope: { worldId: WORLD, seed: map.seed, baseRevision: BASE }, draftRevision: 7, document,
  }));
});

test('storage crate at a safe point builds a valid visual-only artifact with actual asset digest', async () => {
  const { map, service } = await fixture();
  const spawn = map.landmarks.spawn;
  const x = spawn.x + 8, z = spawn.z + 8;
  const document = documentFor(map, { objects: [createDecoration({ id: 'crate-safe', assetId: 'prop:storage-crate',
    position: { x, y: map.groundAt(x, z), z }, collider: 'none' })] });
  const result = await service.build({ document, draftRevision: 3 });
  assert.equal(result.report.valid, true, JSON.stringify(result.report.issues));
  assert.ok(result.report.issues.some((issue) => issue.code === 'visual_only_objects' && issue.severity === 'warning'));
  const [asset] = result.revision.content.assets;
  const bytes = await readFile(path.join(ROOT, asset.src));
  assert.equal(asset.id, 'prop:storage-crate');
  assert.equal(asset.sha256.length, 64);
  assert.equal(asset.sha256, (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(asset.loader.props, ['crate']);
});

test('optimized candidate model warns while remaining a valid prepared revision', async () => {
  const { map, service } = await fixture();
  const spawn = map.landmarks.spawn, x = spawn.x + 9, z = spawn.z + 9;
  const document = documentFor(map, { objects: [createDecoration({ id: 'rock-candidate', assetId: 'model:gm-rock-1k',
    position: { x, y: map.groundAt(x, z), z }, collider: 'none' })] });
  const result = await service.build({ document, draftRevision: 4 });
  assert.equal(result.report.valid, true, JSON.stringify(result.report.issues));
  assert.ok(result.report.issues.some((issue) => issue.code === 'candidate_assets' && issue.severity === 'warning'));
  assert.ok(result.revision.content.assets.some((asset) => asset.id === 'model:gm-rock-1k' && asset.status === 'candidate'));
});

test('spawn collider fails validation and produces no artifact', async () => {
  const { map, service } = await fixture();
  const spawn = map.landmarks.spawn;
  const document = documentFor(map, { objects: [createDecoration({ id: 'spawn-block', assetId: 'prop:storage-crate',
    position: { x: spawn.x, y: map.groundAt(spawn.x, spawn.z), z: spawn.z }, collider: { type: 'circle', radius: 3 } })] });
  const result = await service.build({ document, draftRevision: 1 });
  assert.equal(result.report.valid, false);
  assert.equal(result.revision, null);
  assert.ok(result.report.issues.some((issue) => issue.code === 'protected_anchor_collision'));
});

test('coastal base overrides and base clones resolve the coast dependency', async () => {
  const { map, service } = await fixture();
  const coast = gmEditableBaseProps(map, BASE).find((entry) => entry.coastal);
  assert.ok(coast, 'generated map exposes an editable coastal rock');
  const overrideDocument = documentFor(map, { baseOverrides: [{ id: coast.id, transform: TRANSFORM(coast.prop), hidden: true }] });
  const override = await service.build({ document: overrideDocument, draftRevision: 2 });
  assert.equal(override.report.valid, true, JSON.stringify(override.report.issues));
  assert.ok(override.revision.content.assets.some((asset) => asset.id === 'model:coast-rock-v1'));

  const cloneDocument = documentFor(map, { objects: [createDecoration({ id: 'coast-clone', assetId: coast.id,
    position: { x: coast.prop.x + 5, y: coast.prop.y, z: coast.prop.z + 5 }, collider: 'none' })] });
  const clone = await service.build({ document: cloneDocument, draftRevision: 2 });
  assert.equal(clone.report.valid, true, JSON.stringify(clone.report.issues));
  assert.ok(clone.revision.content.assets.some((asset) => asset.id === 'model:coast-rock-v1'));
});

test('tampered source document, asset metadata, or artifact hash fails client verification', async () => {
  const { map, service } = await fixture();
  const spawn = map.landmarks.spawn, x = spawn.x + 8, z = spawn.z + 8;
  const document = documentFor(map, { objects: [createDecoration({ id: 'crate-tamper', assetId: 'prop:storage-crate',
    position: { x, y: map.groundAt(x, z), z }, collider: 'none' })] });
  const result = await service.build({ document, draftRevision: 9 });
  const options = { scope: { worldId: WORLD, seed: map.seed, baseRevision: BASE }, draftRevision: 9, document };
  const changedDocument = documentFor(map);
  await assert.rejects(verifyPreparedRevision(result.revision, { ...options, document: changedDocument }));
  const changedAsset = structuredClone(result.revision); changedAsset.content.assets[0].sha256 = 'c'.repeat(64);
  await assert.rejects(verifyPreparedRevision(changedAsset, options), /hash mismatch/);
  const tampered = structuredClone(result.revision); tampered.content.runtime.gameVersion = 'tampered';
  await assert.rejects(verifyPreparedRevision(tampered, options), /hash mismatch/);
});
