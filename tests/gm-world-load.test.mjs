import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { TERRAIN_DOMAINS } from '../src/editor/terrainTiles.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { RemoteDraftPanel } from '../src/editor/remotePanel.js';
import { WORLD_LOAD_LIMITS, WORLD_OVER_LOAD_BUDGET, worldLoadBudget, worldLoadDomain, worldLoadPercent, worldLoadRank } from '../src/editor/worldLoad.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1';
const SEED = 123456;
// A domain of whole 70 m tiles (tile keys are world-anchored, so an odd count is not centred on 0).
const square = (tilesX, tilesZ = tilesX) => {
  const minX = -70 * Math.ceil(tilesX / 2), minZ = -70 * Math.ceil(tilesZ / 2);
  return { minX, maxX: minX + 70 * tilesX, minZ, maxZ: minZ + 70 * tilesZ, cell: 1 };
};
// Small enough that today's 561 x 561 terrain (314,721 vertices) is over it.
const TIGHT = Object.freeze({ ...WORLD_LOAD_LIMITS, vertices: 300_000 });

test("today's world reads 31 % of a single load, bound by its terrain", () => {
  const map = generateWorld(SEED);
  const budget = worldLoadBudget(worldLoadDomain(map, BASE), createDocument({ seed: map.seed >>> 0, baseRevision: BASE }));
  assert.deepEqual(worldLoadDomain(map, BASE), TERRAIN_DOMAINS[BASE]);
  assert.equal(budget.tiles, 64);
  assert.equal(budget.vertices, 314_721);
  assert.equal(budget.gpuBytes, 314_721 * 44 + 560 * 560 * 24);
  assert.equal(budget.tileBytes, 0);
  assert.equal(budget.objects, 0);
  assert.equal(budget.binding, 'vertices');
  assert.equal(Math.round(budget.share * 100), 31);
  assert.equal(budget.level, 'ok');
  // A base without a tile domain loads its own generated square.
  assert.deepEqual(worldLoadDomain({ half: 6 }, 'map-r1'), { minX: -6, maxX: 6, minZ: -6, maxZ: 6, cell: 1 });
});

test('the brief table: grown zones cross amber at 70 % and go over above 100 %', () => {
  const rows = [[square(16, 8), 628_881, 63, 'ok'], [square(12), 707_281, 71, 'near'], [square(14), 962_361, 96, 'near'],
    [square(15), 1_104_601, 110, 'over'], [square(16), 1_256_641, 126, 'over']];
  for (const [domain, vertices, pct, level] of rows) {
    const budget = worldLoadBudget(domain, null);
    assert.equal(budget.vertices, vertices);
    assert.equal(Math.round(budget.share * 100), pct);
    assert.equal(budget.level, level, `${vertices} vertices`);
  }
  assert.equal(worldLoadBudget(square(15), null).tiles, 225);
  assert.ok(worldLoadRank('over') > worldLoadRank('near') && worldLoadRank('near') > worldLoadRank('ok'));
});

test('objects and raw tile bytes count against their own budget; exactly 100 % still fits', () => {
  const domain = TERRAIN_DOMAINS[BASE], objects = (n) => ({ objects: new Array(n).fill(null) });
  assert.equal(worldLoadBudget(domain, objects(699)).level, 'ok');
  const near = worldLoadBudget(domain, objects(700));
  assert.equal(near.binding, 'objects'); assert.equal(near.level, 'near');
  assert.equal(worldLoadBudget(domain, objects(1000)).level, 'near', 'as many objects as edit_limit allows stays publishable');
  assert.equal(worldLoadBudget(domain, objects(1001)).level, 'over');
  assert.equal(worldLoadPercent(worldLoadBudget(domain, objects(1001))), 101, 'an over world never reads 100 %');
  assert.equal(worldLoadPercent(worldLoadBudget(domain, objects(1000))), 100);
  assert.equal(worldLoadPercent(worldLoadBudget(domain, objects(0))), 31);
  const tiled = { version: 5, objects: [], terrain: { tiles: [[0, 0, 'a'.repeat(64), 6 * 1048576], [1, 0, 'b'.repeat(64), 3 * 1048576]] } };
  const heavy = worldLoadBudget(domain, tiled);
  assert.equal(heavy.tileBytes, 9 * 1048576);
  assert.equal(heavy.binding, 'tileBytes'); assert.equal(heavy.level, 'over');
});

test('publication refuses a world over the budget with world_over_load_budget; under it the report is unchanged', () => {
  const map = generateWorld(SEED), document = createDocument({ seed: map.seed >>> 0, baseRevision: BASE });
  const ok = validateGmPublication({ map, document, baseRevision: BASE });
  assert.equal(ok.valid, true);
  assert.equal(ok.issues.some((issue) => issue.code === WORLD_OVER_LOAD_BUDGET), false);
  const over = validateGmPublication({ map, document, baseRevision: BASE, loadLimits: TIGHT });
  assert.equal(over.valid, false);
  assert.deepEqual(over.issues, [{ severity: 'error', code: WORLD_OVER_LOAD_BUDGET }]);
  assert.equal(over.summary.errors, 1);
});

test('the server preparation refuses the same world with the same code, and its draft still validates for saving', async () => {
  const map = generateWorld(SEED);
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8'));
  const editorCatalog = JSON.parse(await readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8'));
  const validateReferences = createGmDraftValidator({ map, baseRevision: BASE, manifest, editorCatalog });
  const service = createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: 'gm-world-load-test',
    validateReferences, gameVersion: '0.6.0-test', protocolVersion: 99, loadLimits: TIGHT });
  await service.prepare();
  const crate = createDecoration({ id: 'crate', assetId: 'prop:storage-crate', position: { x: 40, y: map.groundAt(40, 40), z: 40 } });
  const document = createDocument({ seed: map.seed >>> 0, baseRevision: BASE, objects: [crate] });
  assert.doesNotThrow(() => validateReferences(document), 'drafts over the budget still save');
  const result = await service.build({ document, draftRevision: 3 });
  assert.equal(result.revision, null);
  assert.equal(result.report.valid, false);
  assert.ok(result.report.issues.some((issue) => issue.code === WORLD_OVER_LOAD_BUDGET), JSON.stringify(result.report.issues));
});

test('the Online panel will not prepare a head over the budget and names the reason', async () => {
  let level = 'over', prepared = 0;
  const panel = Object.defineProperties(Object.create(RemoteDraftPanel.prototype), {
    matchesHead: { value: true }, compatible: { value: true } });
  Object.assign(panel, {
    editor: { _t: (en) => en, lang: 'en', active: true, loadBudget: () => ({ level }) }, head: { document: { objects: [] }, revision: 2 },
    client: { prepareRevision: async () => { prepared++; return { preparation: {} }; }, pending: null },
    state: 'ready', contentBusy: false, generation: 0, render() {},
  });
  assert.equal(panel.canPrepare, true, 'everything else allows preparing');
  assert.equal(panel.overLoadBudget, true);
  await panel.prepare();
  assert.equal(prepared, 0);
  assert.match(panel.issueText(WORLD_OVER_LOAD_BUDGET), /no longer fits in one load/);
  level = 'near';
  assert.equal(panel.overLoadBudget, false);
  await panel.prepare();
  assert.equal(prepared, 1, 'a near world still prepares');
});
