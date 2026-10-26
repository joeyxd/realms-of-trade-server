import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDecoration, createDocument } from '../src/editor/document.js';
import { projectGmContent, installGmContent } from '../src/editor/contentProjection.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createGmPublicationAssets } from '../server/gmPublicationAssets.mjs';
import { loadGmWorldContent, gmContentHash } from '../src/editor/activeContent.js';
import { gmResourceId, resourceDescriptor, sourceAssetId } from '../src/editor/resourceAdapters.js';
import { canonicalJson } from '../src/editor/publicationArtifact.js';
import { resourceLayout } from '../src/data/resources.js';
import { canScatterAt } from '../src/editor/terrainData.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1';
const WORLD = 'gm-functional-layout-test';
const UUID = '01234567-89ab-4cde-8012-3456789abcde';

function site(map) {
  const baseline = resourceLayout({ ...map, gmResources: [] });
  for (let z = -250; z <= 250; z += 3) for (let x = -250; x <= 250; x += 3) {
    const y = map.groundAt(x, z);
    if (!Number.isFinite(y) || y <= 0.65 || map.onDock?.(x, z) || map.lawlessAt?.(x, z)) continue;
    const dx = map.groundAt(x + 1, z) - map.groundAt(x - 1, z);
    const dz = map.groundAt(x, z + 1) - map.groundAt(x, z - 1);
    if (Math.hypot(dx, dz) / 2 > 0.55) continue;
    if (!canScatterAt(map, x, z, 1)) continue;
    if (baseline.nodes.some((node) => Math.hypot(x - node.x, z - node.z) < 5) ||
        baseline.bench && Math.hypot(x - baseline.bench.x, z - baseline.bench.z) < 6) continue;
    return { x, y, z };
  }
  throw new Error('no safe authored resource site');
}

function resource(map, alias, id = `gm-${UUID}`, at = site(map), patch = {}) {
  return createDecoration({ id, assetId: alias, position: at, collider: 'none', ...patch });
}

test('resource aliases resolve only to the pinned physical assets and stable simulation IDs', () => {
  assert.equal(resourceDescriptor('prop:gm-resource-palm-v1')?.kind, 'palm');
  assert.equal(resourceDescriptor('prop:gm-resource-stone-v1')?.kind, 'stone');
  assert.equal(resourceDescriptor('prop:gm-resource-arbitrary-v1'), null);
  assert.equal(sourceAssetId('prop:gm-resource-palm-v1'), 'model:palm-tall-v1');
  assert.equal(sourceAssetId('prop:gm-resource-stone-v1'), 'model:coast-rock-v1');
  assert.equal(sourceAssetId('model:palm-tall-v1'), 'model:palm-tall-v1');
  assert.equal(gmResourceId(`gm-${UUID}`), 'gm_0123456789ab4cde80123456789abcde');
  assert.throws(() => gmResourceId('palm-1'), { code: 'id' });
});

test('authored resources compile to stable grounded nodes and install as a separate projection', () => {
  const map = generateWorld(123456), at = site(map);
  const palm = resource(map, 'prop:gm-resource-palm-v1', `gm-${UUID}`, at,
    { rotation: { x: 0, y: 1.25, z: 0 }, scale: 1.1 });
  const stone = resource(map, 'prop:gm-resource-stone-v1', `gm-11234567-89ab-4cde-8012-3456789abcde`,
    { ...at, x: at.x + 8, z: at.z + 1, y: map.groundAt(at.x + 8, at.z + 1) });
  const document = createDocument({ seed: map.seed, baseRevision: BASE, objects: [palm, stone] });
  const first = projectGmContent(map, document, BASE), again = projectGmContent(map, document, BASE);
  assert.deepEqual(first.gmResources, again.gmResources);
  assert.deepEqual(first.gmResources.map(({ id, kind }) => ({ id, kind })), [
    { id: 'gm_0123456789ab4cde80123456789abcde', kind: 'palm' },
    { id: 'gm_1123456789ab4cde80123456789abcde', kind: 'stone' },
  ]);
  assert.ok(Math.abs(first.gmResources[0].y - map.groundAt(at.x, at.z)) <= 0.0005);
  assert.equal(first.gmResources[0].rot, 1.25);
  const active = { ...map };
  installGmContent(active, map, document, BASE);
  assert.deepEqual(active.gmResources, first.gmResources);
  assert.deepEqual(map.gmResources, undefined);
});

test('shared publication validation enforces resource transform, spacing and authored collider limits', () => {
  const map = generateWorld(123456), at = site(map);
  const valid = createDocument({ seed: map.seed, baseRevision: BASE,
    objects: [resource(map, 'prop:gm-resource-palm-v1', `gm-${UUID}`, at)] });
  const result = validateGmPublication({ map, document: valid, baseRevision: BASE });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.issues.some((issue) => issue.code === 'visual_only_objects'), false);

  const badScale = createDocument({ seed: map.seed, baseRevision: BASE,
    objects: [resource(map, 'prop:gm-resource-palm-v1', `gm-${UUID}`, at, { scale: 1.5 })] });
  assert.ok(validateGmPublication({ map, document: badScale, baseRevision: BASE }).issues
    .some((issue) => issue.code === 'resource_transform'));
  const collider = createDocument({ seed: map.seed, baseRevision: BASE,
    objects: [resource(map, 'prop:gm-resource-stone-v1', `gm-${UUID}`, at, { collider: { type: 'circle', radius: 1 } })] });
  assert.ok(validateGmPublication({ map, document: collider, baseRevision: BASE }).issues
    .some((issue) => issue.code === 'resource_collider'));
});

test('draft and publication admission pin physical assets and hash the compiled functional layout', async () => {
  const map = generateWorld(123456), at = site(map);
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8'));
  const editorCatalog = JSON.parse(await readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8'));
  const document = createDocument({ seed: map.seed, baseRevision: BASE,
    objects: [resource(map, 'prop:gm-resource-palm-v1', `gm-${UUID}`, at)] });
  const validateReferences = createGmDraftValidator({ map, baseRevision: BASE, manifest, editorCatalog });
  assert.doesNotThrow(() => validateReferences(document));
  const assets = createGmPublicationAssets({ root: ROOT });
  await assets.prepare();
  const resolved = await assets.resolve(document);
  assert.deepEqual(resolved.map((asset) => asset.id), ['model:palm-tall-v1']);

  const publication = createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: WORLD,
    validateReferences, gameVersion: 'test', protocolVersion: 99 });
  await publication.prepare();
  const built = await publication.build({ document, draftRevision: 7 });
  assert.equal(built.report.valid, true, JSON.stringify(built.report.issues));
  const nodes = projectGmContent(map, document, BASE).gmResources;
  assert.deepEqual(built.revision.content.resources, {
    count: nodes.length,
    sha256: (await import('node:crypto')).createHash('sha256').update(canonicalJson(nodes)).digest('hex'),
  });
  assert.ok(built.revision.content.assets.some((asset) => asset.id === 'model:palm-tall-v1'));

  const clientBase = generateWorld(map.seed), clientMap = { ...clientBase };
  await loadGmWorldContent({ httpBase: 'https://example.test/', map: clientMap, baseMap: clientBase,
    gameVersion: 'test', protocolVersion: 99,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, generation: 1,
      revisionId: built.revision.revisionId, revision: built.revision }) }) });
  assert.deepEqual(clientMap.gmResources, nodes);

  const forged = structuredClone(built.revision);
  forged.content.resources.sha256 = '0'.repeat(64);
  forged.revisionId = await gmContentHash(forged.content);
  const guardedBase = generateWorld(map.seed), guardedMap = { ...guardedBase };
  await assert.rejects(loadGmWorldContent({ httpBase: 'https://example.test/', map: guardedMap, baseMap: guardedBase,
    gameVersion: 'test', protocolVersion: 99,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, generation: 1,
      revisionId: forged.revisionId, revision: forged }) }) }), { code: 'content_resources' });
  assert.equal(guardedMap.gmResources, undefined, 'resource mismatch fails before installation');
});
