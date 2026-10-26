import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScatter, planScatter, scatterParameters,
  MAX_SCATTER_CANDIDATES, MAX_SCATTER_TRIANGLES, MAX_AUTHORED_TRIANGLES, MAX_AUTHORED_PRIMITIVES,
} from '../src/editor/scatterBrush.js';
import { createDocument, createDocumentHistory, createDecoration, validateDocument } from '../src/editor/document.js';

const map = { half: 100, groundAt: () => 2 };
const metrics = { triangles: 100, primitives: 2, radius: .4 };
const assetId = 'model:decorative-palm-v1';
const allowed = () => true;
const document = () => createDocument({ seed: 7, baseRevision: 'base-v1' });
const plan = (overrides = {}) => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
  parameters: scatterParameters({ radius: 8, strength: 1, spacing: 2, seed: 44, ...overrides }), metrics, isAllowed: allowed });

test('scatter is reproducible and uses only explicit seed and input data', () => {
  const doc = document(), before = structuredClone(doc);
  const first = planScatter({ map, document: doc, assetId, points: [{ x: -2, z: 1 }, { x: 5, z: 4 }],
    parameters: scatterParameters({ radius: 7, strength: .8, seed: 92, spacing: 2.5 }), metrics, isAllowed: allowed });
  const second = planScatter({ map, document: doc, assetId, points: [{ x: -2, z: 1 }, { x: 5, z: 4 }],
    parameters: scatterParameters({ radius: 7, strength: .8, seed: 92, spacing: 2.5 }), metrics, isAllowed: allowed });
  assert.deepEqual(first, second);
  assert.ok(first.placements.length > 0);
  assert.deepEqual(doc, before);
});

test('circle, square, and rotated ellipse constrain candidates to their brush footprint', () => {
  for (const shape of ['circle', 'square', 'ellipse']) {
    const result = plan({ shape, radius: 9, aspect: .5, rotation: 37, seed: 3 });
    assert.ok(result.placements.length > 0, shape);
    for (const placement of result.placements) {
      const { x, z } = placement.position;
      const angle = 37 * Math.PI / 180, dx = x * Math.cos(angle) + z * Math.sin(angle);
      const dz = -x * Math.sin(angle) + z * Math.cos(angle);
      if (shape === 'circle') assert.ok(Math.hypot(dx, dz) <= 9);
      if (shape === 'square') assert.ok(Math.max(Math.abs(dx), Math.abs(dz)) <= 9);
      if (shape === 'ellipse') assert.ok(Math.hypot(dx / 9, dz / 4.5) <= 1);
    }
  }
});

test('rotated square includes its corner footprint beyond the unrotated radius', () => {
  const result = planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 9, shape: 'square', rotation: 45, falloff: 1, strength: 1, spacing: .5, seed: 31 }),
    metrics, isAllowed: (x, z) => Math.abs(x) < 4 && z > 9 && z < 13 });
  assert.ok(result.placements.some(({ position }) => position.z > 9));
});

test('rotated ellipse influence covers the union of resampled brush positions along a stroke', () => {
  const result = planScatter({ map, document: document(), assetId, points: [{ x: -14, z: 0 }, { x: 14, z: 0 }],
    parameters: scatterParameters({ radius: 7, aspect: .35, rotation: 43, shape: 'ellipse', falloff: 1,
      strength: 1, spacing: 1.5, seed: 19 }), metrics, isAllowed: allowed });
  assert.ok(result.placements.some(({ position }) => position.x > 14 && position.x < 21));
  assert.ok(result.placements.some(({ position }) => position.x < -14 && position.x > -21));
});

test('per-cell jitter, selection, rotation and scale stay fixed when the stroke footprint expands', () => {
  const params = scatterParameters({ radius: 7, strength: .7, spacing: 2, seed: 102 });
  const planWith = (points) => planScatter({ map, document: document(), assetId, points,
    parameters: params, metrics, isAllowed: allowed });
  const short = planWith([{ x: 0, z: 0 }]);
  const extended = planWith([{ x: 0, z: 0 }, { x: 0, z: 40 }]);
  const core = (result) => result.placements.filter(({ position }) => position.x < -2 && Math.hypot(position.x, position.z) < 5)
    .sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
  assert.deepEqual(core(extended), core(short));
});

test('spacing holds against every prior decoration and every accepted point', () => {
  const doc = document();
  const old = createDecoration({ id: 'old-1', assetId, position: { x: 0, y: 2, z: 0 } });
  const withOld = validateDocument({ ...doc, objects: [old] });
  const result = planScatter({ map, document: withOld, assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 8, strength: 1, spacing: 2, seed: 8 }), metrics, isAllowed: allowed });
  const all = [{ x: 0, z: 0 }, ...result.placements.map((p) => ({ x: p.position.x, z: p.position.z }))];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
    assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) >= 2 - 1e-9);
});

test('policy exclusions and unsupported heights are omitted deterministically and counted', () => {
  let checks = 0;
  const result = planScatter({ map: { half: 100, groundAt: () => 1 }, document: document(), assetId,
    points: [{ x: 0, z: 0 }], parameters: scatterParameters({ radius: 8, strength: 1, spacing: 2, seed: 17 }),
    metrics, isAllowed: (x, z, footprint) => { checks++; assert.equal(footprint, metrics.radius * 1.2); return x < 0; } });
  assert.ok(checks > 0);
  assert.ok(result.skipped > 0);
  assert.ok(result.placements.every((item) => item.position.x < 0));
  assert.ok(plan({ seed: 1 }).skipped >= 0);
});

test('model metrics and hard object, triangle, primitive, and candidate limits reject whole plans', () => {
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters(), metrics: null, isAllowed: allowed }), (error) => error.code === 'scatter_metrics');
  assert.throws(() => planScatter({ map, document: document(), assetId,
    points: [{ x: -60, z: 0 }, { x: 60, z: 0 }], parameters: scatterParameters({ radius: 24, spacing: .5 }),
    metrics, isAllowed: allowed }), (error) => error.code === 'scatter_candidate_limit');
  assert.ok(MAX_SCATTER_CANDIDATES > 0);
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 5, strength: 1, spacing: 2, seed: 4 }),
    metrics: { triangles: MAX_SCATTER_TRIANGLES + 1, primitives: 1, radius: .4 }, isAllowed: allowed }),
  (error) => error.code === 'scatter_triangle_limit');
  assert.throws(() => planScatter({ map, document: document(), assetId, points: Array.from({ length: 257 }, () => ({ x: 0, z: 0 })),
    parameters: scatterParameters(), metrics, isAllowed: allowed }), (error) => error.code === 'scatter_points');
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: -10_000, z: 0 }, { x: 10_000, z: 0 }],
    parameters: scatterParameters(), metrics, isAllowed: allowed }), (error) => error.code === 'scatter_path_limit');
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 24, spacing: .5, strength: 1 }), metrics, isAllowed: allowed }),
  (error) => error.code === 'scatter_object_limit');
  let permitted = 0;
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 24, spacing: .5, strength: 1 }),
    metrics: { triangles: 1, primitives: 4, radius: .1 }, isAllowed: () => ++permitted <= 100 }),
  (error) => error.code === 'scatter_primitive_limit');
});

test('existing authored cost participates in cumulative triangle and primitive budgets', () => {
  const base = { map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 6, strength: 1, spacing: 2, seed: 8 }), metrics, isAllowed: allowed };
  const sample = planScatter(base);
  assert.ok(sample.placements.length > 0);
  assert.equal(sample.cost.totalTriangles, sample.cost.triangles);
  assert.equal(sample.cost.totalPrimitives, sample.cost.primitives);
  assert.throws(() => planScatter({ ...base,
    existingCost: { triangles: MAX_AUTHORED_TRIANGLES - sample.cost.triangles + 1, primitives: 0 } }),
  (error) => error.code === 'scatter_authored_triangle_limit');
  assert.throws(() => planScatter({ ...base,
    existingCost: { triangles: 0, primitives: MAX_AUTHORED_PRIMITIVES - sample.cost.primitives + 1 } }),
  (error) => error.code === 'scatter_authored_primitive_limit');
  assert.throws(() => planScatter({ ...base, points: [{ x: 1000, z: 1000 }], isAllowed: () => false,
    existingCost: { triangles: MAX_AUTHORED_TRIANGLES + 1, primitives: 0 } }),
  (error) => error.code === 'scatter_authored_triangle_limit');
});

test('dense strokes stop invoking spatial policy as soon as object budget is exceeded', () => {
  let policyCalls = 0;
  assert.throws(() => planScatter({ map, document: document(), assetId, points: [{ x: 0, z: 0 }],
    parameters: scatterParameters({ radius: 24, strength: 1, spacing: .5, seed: 4 }),
    metrics: { triangles: 1, primitives: 1, radius: .1 }, isAllowed: () => { policyCalls++; return true; } }),
  (error) => error.code === 'scatter_object_limit');
  assert.ok(policyCalls > 0);
  assert.ok(policyCalls < 1_000, `expected early stop, got ${policyCalls} policy calls`);
});

test('application creates one schema-preserving atomic history entry with stable IDs and roundtrips', () => {
  const original = document(), before = structuredClone(original), result = plan();
  const ids = result.placements.map((_, i) => `scatter-${i + 1}`);
  const applied = applyScatter(original, result, (index) => ids[index]);
  assert.deepEqual(original, before);
  assert.deepEqual(applied.ids, ids);
  assert.equal(applied.document.version, original.version);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(applied.document))), applied.document);
  const history = createDocumentHistory(original);
  history.commit(applied.document);
  assert.equal(history.current().objects.length, ids.length);
  assert.equal(history.undo().objects.length, 0);
  assert.equal(history.redo().objects.length, ids.length);
  assert.deepEqual(history.current(), applied.document);
});

test('zero placements are a no-op and invalid IDs cannot partially change the source document', () => {
  const original = document(), before = structuredClone(original);
  const empty = { assetId, placements: [], skipped: 0, candidates: 0, cost: { triangles: 0, primitives: 0 } };
  assert.deepEqual(applyScatter(original, empty, () => 'unused').document, original);
  const occupied = plan();
  assert.throws(() => applyScatter(original, occupied, (index) => index === 1 ? 'bad id' : `ok-${index}`));
  assert.deepEqual(original, before);
});
