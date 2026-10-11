import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, validateDocument } from '../src/editor/document.js';
import { installGmContent, projectGmContent } from '../src/editor/contentProjection.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { validateGmContentObstacles } from '../server/gmContentObstacles.mjs';
import { validateTerrainForMap } from '../src/editor/terrainData.js';
import { resourceLayout } from '../src/data/resources.js';

const BASE = 'terrain-s21-v1';
const WORLD = 'marea-negra';
const uuid = '00000000-0000-4000-8000-000000000001';
const emptyStore = () => ({
  async listGmContentProfiles({ after }) { return after ? [] : [{ accountId: uuid, profile: { eco: { ships: [] } } }]; },
  async listPearlGround() { return []; },
  async listCurrentDeathDrops() { return []; },
});

function fixture(seed = 20261011) {
  const base = generateWorld(seed);
  let sample = null;
  for (let z = -280; z <= 280 && sample === null; z++) for (let x = -280; x <= 280; x++) {
    const index = (z + 280) * 561 + x + 280;
    const h = base.groundAt(x, z);
    if (h >= 0.75 && h < 12 && Math.abs(x) > 100 && Math.abs(z) > 100) {
      try {
        const candidate = { version: 1, samples: [[index, 1000]] };
        validateTerrainForMap(base, candidate);
        sample = { x, z, index, terrain: candidate };
        break;
      } catch { /* protected point */ }
    }
  }
  assert.ok(sample, 'fixture should contain editable dry ground');
  return { base, sample };
}

function documentFor(base, terrain) {
  return validateDocument({ ...createDocument({ seed: base.seed, baseRevision: BASE }),
    version: 3, terrain });
}

test('terrain v3 projects the movement sampler and resets to the exact v2 baseline', () => {
  const { base, sample } = fixture(), doc = documentFor(base, sample.terrain);
  const originalHeights = base.heights, originalProps = base.props;
  const baseResources = resourceLayout(base);
  const projected = projectGmContent(base, doc, BASE);
  assert.notEqual(projected.heights, base.heights);
  assert.ok(Math.abs(projected.groundAt(sample.x, sample.z) - base.groundAt(sample.x, sample.z) - 1) < 1e-6);
  assert.equal(projected.groundAt(sample.x + 0.25, sample.z + 0.25),
    projected.heightAt(sample.x + 0.25, sample.z + 0.25));
  assert.equal(projected.materialAt(sample.x, sample.z), 'grass');
  assert.deepEqual(resourceLayout(projected), baseResources);
  assert.equal(base.heights, originalHeights);
  assert.equal(base.props, originalProps);

  const active = { ...base };
  installGmContent(active, base, doc, BASE);
  assert.equal(active.groundAt(sample.x, sample.z), projected.groundAt(sample.x, sample.z));
  assert.equal(active.groundAt(sample.x, sample.z), active.heightAt(sample.x, sample.z));
  installGmContent(active, base, null, BASE);
  assert.equal(active.heights, base.heights);
  assert.equal(active.groundAt, base.groundAt);
  assert.deepEqual(active.props, base.props);
  assert.equal(active.terrainProjection, undefined);
});

test('v2 documents retain their historical shape and projection without terrain fields', () => {
  const { base } = fixture();
  const legacy = createDocument({ seed: base.seed, baseRevision: BASE });
  assert.equal(legacy.version, 2);
  assert.deepEqual(Object.keys(legacy), ['schema', 'version', 'base', 'objects', 'baseOverrides']);
  const v1 = validateDocument({ schema: legacy.schema, version: 1, base: legacy.base, objects: [] });
  assert.deepEqual(v1, legacy);
  const active = { ...base };
  installGmContent(active, base, legacy, BASE);
  assert.equal(active.heights, base.heights);
  assert.equal(active.groundAt, base.groundAt);
});

test('client publication and server save reject samples in protected ground', () => {
  const { base, sample } = fixture();
  const validator = createGmDraftValidator({ map: base, baseRevision: BASE, manifest: [], editorCatalog: [] });
  const bad = { ...sample.terrain, samples: [[(base.landmarks.spawn.z + base.half | 0) * 561 +
    (base.landmarks.spawn.x + base.half | 0), 1000]] };
  const doc = documentFor(base, bad);
  assert.throws(() => validator(doc), (error) => error.code === 'protected_ground' || error.code === 'protected_area');
  assert.throws(() => validateGmPublication({ map: base, document: doc, baseRevision: BASE }),
    (error) => error.code === 'protected_ground' || error.code === 'protected_area');
});

test('publication checks object support against the projected ground height', () => {
  const { base, sample } = fixture();
  const terrain = { version: 1, samples: [[sample.index, 12000]] };
  const doc = validateDocument({ ...createDocument({ seed: base.seed, baseRevision: BASE,
    objects: [{ id: 'crate', assetId: 'prop:crate', transform: {
      position: { x: sample.x, y: base.groundAt(sample.x, sample.z) + 12.1, z: sample.z },
      rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none' }] }), version: 3, terrain: sample.terrain });
  doc.terrain = terrain;
  const result = validateGmPublication({ map: base, document: doc, baseRevision: BASE });
  assert.equal(result.valid, true);
  const raised = { ...doc, objects: doc.objects.map((item) => ({ ...item, transform: {
    ...item.transform, position: { ...item.transform.position, y: base.groundAt(sample.x, sample.z) + 0.1 } } })) };
  const rejected = validateGmPublication({ map: base, document: raised, baseRevision: BASE });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.issues.some((issue) => issue.code === 'unsupported_height'));
});

test('activation obstacle guard checks saved drops, checkpoint neighborhoods, and raft footprints even without new colliders', async () => {
  const { base, sample } = fixture();
  const currentMap = { ...base }, targetMap = projectGmContent(base, documentFor(base, sample.terrain), BASE);
  const checkpointMap = { ...base };
  const cases = [
    { map: base, targetMap, profile: { eco: { ships: [] } }, ground: [{ uid: 'pearl', world: WORLD, ground: { x: sample.x, z: sample.z } }] },
    { map: checkpointMap, targetMap: { ...base, heights: new Float32Array(base.heights),
      groundAt(x, z) { return Math.hypot(x - base.checkpoints.spawn.x, z - base.checkpoints.spawn.z) <= 2 ? base.groundAt(x, z) + 1 : base.groundAt(x, z); } },
      profile: { eco: { ships: [] }, cp: 'spawn' } },
    { map: base, targetMap, profile: { eco: { ships: [{ kind: 'raft', grid: { parts: [['foundation', 0, 0, 0, 0]] },
      voyage: { v: 1, seed: base.seed, pose: [sample.x, sample.z, 0] } }] } } },
  ];
  for (const { map, targetMap: destination, profile, ground = [] } of cases) {
    const store = {
      async listGmContentProfiles() { return [{ accountId: uuid, profile }]; },
      async listPearlGround() { return ground; },
      async listCurrentDeathDrops() { return []; },
    };
    await assert.rejects(validateGmContentObstacles({ store, map, currentMap, targetMap: destination, worldId: WORLD }),
      (error) => error.code === 'gm_content_occupied');
  }
});
