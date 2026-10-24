// Asset protocol guards (docs/art/PROTOCOLO.md).
// The runtime checks need only assets/ and src/, so they also run in the release image.
// The catalog checks need tools/ and git; they skip visibly where those are absent (the image).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[A-Za-z0-9._-]+$/;
const FILE = /\.[A-Za-z0-9]{2,5}$/;
const PROSE = new Set(['notes', 'label', 'looks', 'stats', 'evidence', 'sources']);
const readJson = p => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

// Every string field that names a file, skipping prose and metadata.
function filePaths(entry, out = []) {
  for (const [key, value] of Object.entries(entry)) {
    if (PROSE.has(key)) continue;
    if (typeof value === 'string' && FILE.test(value) && !/^[a-z]+:/i.test(value)) out.push(value);
    else if (value && typeof value === 'object') filePaths(value, out);
  }
  return out;
}

async function runtimeRefs() {
  const refs = [];
  const asset = (p, from) => refs.push({ path: `assets/${String(p).replace(/^\.?\/?(assets\/)?/, '')}`, from });
  for (const e of readJson('assets/manifest.json').assets) for (const p of filePaths(e)) asset(p, `manifest ${e.id}`);
  for (const e of readJson('assets/editor/catalog.json').assets) for (const p of filePaths(e)) asset(p, `editor ${e.id}`);
  for (const [id, e] of Object.entries(readJson('assets/editor/thumbnails.json').assets)) for (const p of filePaths(e)) asset(p, `thumbnails ${id}`);
  const niagara = path.join(root, 'src/editor/niagaraCatalog.js');
  const { NIAGARA_NATIVE } = await import('../src/editor/niagaraNative.js');
  for (const entry of Object.values(NIAGARA_NATIVE)) for (const file of Object.values(entry.files)) {
    if (file.url.startsWith('/assets/')) asset(file.url, `native ${entry.id}`);
  }
  if (existsSync(niagara)) {
    const { NIAGARA_CATALOG } = await import(pathToFileURL(niagara).href);
    for (const fx of NIAGARA_CATALOG) if (fx.thumbnail) asset(fx.thumbnail, `niagara ${fx.id}`);
  }
  return refs;
}

test('every file the game catalogs load exists under assets/ with a URL-safe name', async () => {
  const refs = await runtimeRefs();
  for (const source of ['manifest', 'editor', 'thumbnails', 'niagara']) {
    assert.ok(refs.some(r => r.from.startsWith(`${source} `)), `no paths read from the ${source} catalog`);
  }
  const missing = refs.filter(r => !existsSync(path.join(root, r.path))).map(r => `${r.path} <- ${r.from}`);
  const unsafe = refs.filter(r => !r.path.split('/').every(part => NAME.test(part))).map(r => `${r.path} <- ${r.from}`);
  assert.deepEqual(missing, [], 'catalog points at files that are not in assets/');
  assert.deepEqual(unsafe, [], 'catalog paths must be ASCII [A-Za-z0-9._-] with no spaces');
});

test('desktop variants loaded by the manifest ship with their mobile pair', () => {
  const unpaired = [];
  for (const e of readJson('assets/manifest.json').assets) {
    if (/-(desktop|pc)\.[a-z0-9]+$/i.test(e.src ?? '') && !e.mobileSrc) unpaired.push(e.id);
  }
  assert.deepEqual(unpaired, [], 'manifest entries with a -desktop src need mobileSrc');
});

const tooling = existsSync(path.join(root, 'tools/asset-index/scan.mjs')) && existsSync(path.join(root, 'tools/art-catalog/catalog.json'));
const skip = tooling ? false : 'tools/ is not in this checkout (release image): catalog checks run in the repo';

test('no new asset problems beyond the inherited baseline', { skip }, async () => {
  const { scanAssets, loadBaseline, compareBaseline } = await import(pathToFileURL(path.join(root, 'tools/asset-index/scan.mjs')).href);
  const scan = await scanAssets(root);
  const { fresh } = compareBaseline(scan.problems, loadBaseline(root));
  assert.deepEqual(fresh.map(p => p.key), [], 'run `npm run assets:check` and follow docs/art/PROTOCOLO.md');
});

test('the asset workshop catalogs claim the files under assets/workshop/', { skip }, async () => {
  const { scanAssets } = await import(pathToFileURL(path.join(root, 'tools/asset-index/scan.mjs')).href);
  const scan = await scanAssets(root);
  assert.deepEqual(scan.problems.filter(p => p.kind === 'sin-ficha' && p.path.startsWith('assets/workshop/')).map(p => p.key), []);
  for (const f of ['assets/workshop/aw-pilot-01/desktop.glb', 'assets/workshop/thumbnails/aw-pilot-01.webp']) {
    const rec = scan.files.find(r => r.path === f);
    assert.ok(rec?.sources.includes('taller'), `${f} should be claimed by the taller source`);
  }
});

test('the baseline only lists real, sorted, unique problem keys', { skip }, async () => {
  const { PROBLEMS } = await import(pathToFileURL(path.join(root, 'tools/asset-index/scan.mjs')).href);
  const { problems } = readJson('tools/asset-index/baseline.json');
  assert.deepEqual(problems, [...new Set(problems)].sort((a, b) => a.localeCompare(b)), 'baseline must stay sorted and unique');
  for (const key of problems) assert.ok(Object.hasOwn(PROBLEMS, key.split(' ')[0]), `unknown problem kind in baseline: ${key}`);
});

test('the index renders every piece, file and problem from the scan', { skip }, async () => {
  const { scanAssets } = await import(pathToFileURL(path.join(root, 'tools/asset-index/scan.mjs')).href);
  const { indexData, renderIndex } = await import(pathToFileURL(path.join(root, 'tools/asset-index/build.mjs')).href);
  const scan = await scanAssets(root);
  const html = renderIndex(indexData(scan, new Set()));
  const data = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(data.pieces.length, scan.pieces.length);
  assert.equal(data.files.length, scan.files.length);
  assert.equal(data.problems.filter(p => p.fresh).length, scan.problems.length);
  assert.ok(!/<\/script>/i.test(html.match(/<script id="data"[^>]*>(.*?)<\/script>/s)[1]), 'embedded JSON must not close its script tag');
});
