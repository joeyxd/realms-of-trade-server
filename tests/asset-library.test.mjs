import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFacets, filterAssets, hasAssetPreview, loadAssetLibrary, paginateAssets } from '../src/editor/assetLibrary.js';

const entry = (overrides = {}) => ({
  id: 'aw-pilot-03', name: 'Algodón intacto y cosechado', originalName: 'SM_Cotton_A + SM_Cotton_A_Harvested',
  packId: 'UltimateFarming', packName: 'Ultimate Farming', type: 'model', categories: ['Plantas', 'Recursos'],
  materials: [], tags: ['variantes'], aliases: ['planta de algodón'], isNew: true,
  sourceRevision: 'snapshot-a', source: { project: 'survival project', package: 'Ultimate Farming', paths: ['UltimateFarming/Meshes/SM_Cotton_A.uasset'] },
  preview: null, limitations: ['Candidato de metadata: clase, preview y conversión no verificados; ficha no certificada.'], ...overrides,
});

test('loads the catalog and merges prepared metadata only for known IDs', async () => {
  const responses = new Map([
    ['catalog', { ok: true, json: async () => ({ schema: 'marea.asset-workshop.catalog.v1', coverage: { fullCatalog: false }, entries: [entry()] }) }],
    ['prepared', { ok: true, json: async () => ({ schema: 'marea.asset-prepared.v1', entries: [
      { id: 'aw-pilot-03', catalogSourceRevision: 'snapshot-a', sourcePaths: ['UltimateFarming/Meshes/SM_Cotton_A.uasset'], sourceRevision: 'a'.repeat(64), technicalType: 'StaticMesh', preview: { kind: 'model', desktop: { url: 'assets/workshop/prepared/cotton.glb', bytes: 100, sha256: 'b'.repeat(64) } } },
      { id: 'evil-injection', name: 'injected', sourceRevision: 'x', preview: { url: 'bad' } },
    ] }) }],
  ]);
  const result = await loadAssetLibrary({ fetchImpl: async (url) => responses.get(url) || { ok: false, status: 404 }, url: 'catalog', preparedUrl: 'prepared' });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, 'Algodón intacto y cosechado');
  assert.equal(result.entries[0].sourceRevision, 'a'.repeat(64));
  assert.equal(result.entries[0].type, 'StaticMesh');
  assert.equal(result.entries[0].preview.desktop.url, 'assets/workshop/prepared/cotton.glb');
  assert.equal(result.entries[0].limitations.some((item) => item.startsWith('Candidato de metadata:')), false);
  assert.equal(result.coverage.fullCatalog, false);
});

test('optional absent preparation leaves catalog usable and malformed catalog is rejected', async () => {
  const catalog = { schema: 'marea.asset-workshop.catalog.v1', coverage: {}, entries: [entry()] };
  const result = await loadAssetLibrary({ fetchImpl: async (url) => url === 'c'
    ? { ok: true, json: async () => catalog }
    : { ok: false, status: 404 }, url: 'c', preparedUrl: 'p' });
  assert.equal(result.entries[0].preview, null);
  assert.equal(result.warnings.length, 1);
  await assert.rejects(loadAssetLibrary({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), url: 'c', preparedUrl: 'p' }), /esquema válido/);
});

test('prepared rows must match catalog source revision and source paths', async () => {
  const responses = new Map([
    ['c', { ok: true, json: async () => ({ schema: 'marea.asset-workshop.catalog.v1', coverage: {}, entries: [entry()] }) }],
    ['p', { ok: true, json: async () => ({ schema: 'marea.asset-prepared.v1', entries: [
      { id: entry().id, catalogSourceRevision: 'old-revision', sourcePaths: entry().source.paths, sourceRevision: 'a'.repeat(64), technicalType: 'StaticMesh', preview: { kind: 'model', desktop: { url: 'assets/old.glb', bytes: 7 } } },
    ] }) }],
  ]);
  const result = await loadAssetLibrary({ fetchImpl: async (url) => responses.get(url) || { ok: false, status: 404 }, url: 'c', preparedUrl: 'p' });
  assert.equal(result.entries[0].sourceRevision, 'snapshot-a');
  assert.equal(result.entries[0].type, 'model');
  assert.equal(result.entries[0].preview, null);
  assert.equal(result.warnings.length, 1);
});

test('invalid prepared preview is nulled, warned, and remains pending', async () => {
  const catalog = { schema: 'marea.asset-workshop.catalog.v1', coverage: {}, entries: [entry()] };
  const prepared = { schema: 'marea.asset-prepared.v1', entries: [{
    id: entry().id, catalogSourceRevision: entry().sourceRevision, sourcePaths: entry().source.paths,
    sourceRevision: 'c'.repeat(64), technicalType: 'static-mesh',
    preview: { kind: 'model', desktop: { url: 'https://elsewhere.test/cotton.glb', bytes: 100, sha256: 'd'.repeat(64) } },
  }] };
  const result = await loadAssetLibrary({ fetchImpl: async (url) => ({ ok: true, json: async () => url === 'c' ? catalog : prepared }), url: 'c', preparedUrl: 'p' });
  assert.equal(result.entries[0].preview, null);
  assert.equal(hasAssetPreview(result.entries[0]), false);
  assert.equal(result.warnings.length, 2);
});

test('loader combines a caller abort signal with its bounded fetch signal', async () => {
  const controller = new AbortController();
  controller.abort();
  let receivedSignal;
  await assert.rejects(loadAssetLibrary({
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      receivedSignal = options.signal;
      throw options.signal.reason;
    },
  }));
  assert.equal(receivedSignal.aborted, true);
});

test('rendered thumbnails must match the current source revision', async () => {
  const current = entry();
  const library = await loadAssetLibrary({ url: 'c', preparedUrl: 'p', thumbnailsUrl: 't', fetchImpl: async url => ({ ok: url !== 'p', status: 404, json: async () => url === 'c'
    ? { schema: 'marea.asset-workshop.catalog.v1', entries: [current], coverage: {} }
    : { schema: 'marea.asset-thumbnails.v1', entries: [{ id: current.id, sourceRevision: 'stale', url: 'assets/thumb.webp', bytes: 10, sha256: 'a'.repeat(64) }] } }) });
  assert.equal(library.entries[0].thumbnail, undefined);
});

test('preview readiness validates profile URL, kind, bytes and optional hash including variants', () => {
  const base = entry({ preview: { kind: 'model', desktop: { url: 'assets/one.glb', bytes: 11 } } });
  assert.equal(hasAssetPreview(base), true);
  assert.equal(hasAssetPreview(base, 'desktop'), true);
  assert.equal(hasAssetPreview(base, 'mobile'), false);
  assert.equal(hasAssetPreview({ ...base, preview: { ...base.preview, desktop: { url: 'https://example.test/a.glb', bytes: 11 } } }), false);
  assert.equal(hasAssetPreview({ ...base, preview: { ...base.preview, desktop: { url: 'assets/../private.glb', bytes: 11 } } }), false);
  assert.equal(hasAssetPreview({ ...base, preview: { ...base.preview, desktop: { url: 'assets/%2e%2e%2fprivate.glb', bytes: 11 } } }), false);
  assert.equal(hasAssetPreview({ ...base, preview: { ...base.preview, kind: 'unknown' } }), false);
  assert.equal(hasAssetPreview({ ...base, preview: { ...base.preview, desktop: { url: 'assets/one.glb', bytes: 0 } } }), false);
  assert.equal(hasAssetPreview({ ...base, preview: null, variants: [{ id: 'intact', preview: { kind: 'model', mobile: { url: 'assets/intact.glb', bytes: 20, sha256: 'a'.repeat(64) } } }] }), true);
  assert.equal(hasAssetPreview({ ...base, preview: null, variants: [{ id: 'bad', preview: { kind: 'model', mobile: { url: 'assets/bad.glb', bytes: 20, sha256: 'bad' } } }] }), false);
});

test('search folds accents and searches aliases, source paths, materials, tags and notes', () => {
  const cotton = entry({ notes: 'Algodón de prueba', materials: ['MI_Cuero'], tags: ['vegetación'] });
  assert.deepEqual(filterAssets([cotton], { query: 'algodon' }), [cotton]);
  assert.deepEqual(filterAssets([cotton], { query: 'cuero' }), [cotton]);
  assert.deepEqual(filterAssets([cotton], { query: 'vegetacion' }), [cotton]);
  assert.deepEqual(filterAssets([cotton], { query: 'UltimateFarming/Meshes' }), [cotton]);
  assert.deepEqual(filterAssets([cotton], { query: 'sin coincidencia' }), []);
});

test('category and pack facets combine, and new/status/collection filters stay independent', () => {
  const cotton = entry();
  const control = entry({ id: 'control', name: 'Control integrado', packId: 'marea', categories: ['Plantas'], isNew: false, sourceRevision: 'v1' });
  const reviews = { [cotton.id]: { decision: 'use', collection: 'Algodón', notes: 'No cambiar pivote' } };
  assert.deepEqual(filterAssets([cotton, control], { category: 'Plantas', pack: 'UltimateFarming' }), [cotton]);
  assert.deepEqual(filterAssets([cotton, control], { newOnly: true }), [cotton]);
  assert.deepEqual(filterAssets([cotton, control], { status: 'pending', reviews }), [control]);
  assert.deepEqual(filterAssets([cotton, control], { collection: 'Algodón', reviews }), [cotton]);
  assert.deepEqual(filterAssets([cotton, control], { status: 'use', reviews }), [cotton]);
  const variantReady = entry({ preview: null, variants: [{ id: 'intact', preview: { kind: 'model', desktop: { url: 'assets/cotton.glb', bytes: 20 } } }] });
  assert.deepEqual(filterAssets([variantReady], { status: 'ready' }), [variantReady]);
  assert.deepEqual(filterAssets([cotton], { query: 'pivote', reviews }), [cotton]);
  assert.deepEqual(filterAssets([cotton], { status: 'unreviewed', reviews: { [cotton.id]: { decision: 'unreviewed' } } }), [cotton]);
});

test('facets and pagination are bounded and report exact totals', () => {
  const items = [entry(), entry({ id: 'two', packId: 'other', packName: 'Otro', categories: ['Decoración'], type: 'texture' })];
  assert.deepEqual(assetFacets(items), { categories: ['Decoración', 'Plantas', 'Recursos'], packs: [
    { id: 'other', name: 'Otro' }, { id: 'UltimateFarming', name: 'Ultimate Farming' },
  ], types: ['model', 'texture'] });
  assert.deepEqual(paginateAssets(items, { page: 4, pageSize: 1 }), { items: [items[1]], page: 2, pageSize: 1, pages: 2, total: 2 });
});
