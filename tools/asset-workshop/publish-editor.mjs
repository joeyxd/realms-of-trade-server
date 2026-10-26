#!/usr/bin/env node
// AW06a: publishes the workshop pieces listed in assets/workshop/published.json into the GM editor catalog
// (assets/editor/catalog.json and assets/editor/thumbnails.json). Explicit, hashed and reproducible.
// Usage: node tools/asset-workshop/publish-editor.mjs [--check]
//   no flag  : writes both editor files.
//   --check  : writes nothing; exit 0 when both files already equal the tool output, otherwise exit 1.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID_RE = /^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/;
// A thumbnail key belongs to the workshop when its image lives here (no marker field is added to the file).
const WORKSHOP_THUMB_PREFIX = 'assets/workshop/thumbnails/';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const fail = (message) => { throw new Error(message); };

// Serializes like the files on disk: 2-space JSON, trailing newline, the eol the existing file already uses.
function serialize(value, existingText) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return existingText.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
}

/** Builds the two editor documents (and their text) from the files under `root`. Pure: writes nothing. */
export function buildPublication(root = DEFAULT_ROOT) {
  const published = readJson(path.join(root, 'assets/workshop/published.json'));
  const prepared = readJson(path.join(root, 'assets/workshop/prepared.json'));
  const workshopCatalog = readJson(path.join(root, 'assets/workshop/catalog.json'));
  const workshopThumbs = readJson(path.join(root, 'assets/workshop/thumbnails.json'));
  const catalogPath = path.join(root, 'assets/editor/catalog.json');
  const thumbsPath = path.join(root, 'assets/editor/thumbnails.json');
  const catalogText = readFileSync(catalogPath, 'utf8');
  const thumbsText = readFileSync(thumbsPath, 'utf8');
  const catalog = JSON.parse(catalogText);
  const thumbnails = JSON.parse(thumbsText);

  if (published.schema !== 'marea.asset-published.v1' || !Array.isArray(published.entries)) fail('published.json: schema inválido');
  const fresh = [];
  const freshThumbs = {};
  const seen = new Set();
  for (const entry of published.entries) {
    const where = `published.json ${entry.id}`;
    if (seen.has(entry.editorId)) fail(`${where}: editorId duplicado`);
    seen.add(entry.editorId);
    if (!ID_RE.test(entry.editorId)) fail(`${where}: editorId inválido`);
    if (entry.decision !== 'Usar') fail(`${where}: la decisión debe ser Usar`);
    if (!workshopCatalog.entries.some((item) => item.id === entry.id)) fail(`${where}: no está en catalog.json del taller`);
    const prep = prepared.entries.find((item) => item.id === entry.id);
    if (!prep) fail(`${where}: no existe en prepared.json`);
    if (prep.sourceRevision !== entry.sourceRevision) fail(`${where}: sourceRevision distinta de prepared.json`);
    if (prep.preview?.kind !== 'model') fail(`${where}: preview.kind no es model`);
    const rel = `workshop/${entry.id}/desktop.glb`;
    const file = path.join(root, 'assets', ...rel.split('/'));
    if (!existsSync(file)) fail(`${where}: falta ${rel}`);
    const bytes = readFileSync(file);
    const digest = sha256(bytes);
    if (digest !== prep.preview.desktop.sha256) fail(`${where}: sha256 de ${rel} (${digest}) distinto de prepared.json (${prep.preview.desktop.sha256})`);
    if (entry.fit !== 'size' && entry.fit !== 'height') fail(`${where}: fit inválido`);
    const metres = entry.fit === 'size' ? entry.size : entry.height;
    if (!(metres > 0)) fail(`${where}: falta ${entry.fit}`);
    const thumb = workshopThumbs.entries.find((item) => item.id === entry.id);
    if (!thumb || thumb.sourceRevision !== entry.sourceRevision) fail(`${where}: miniatura ausente o de otra revisión`);
    if (!thumb.url.startsWith(WORKSHOP_THUMB_PREFIX) || !existsSync(path.join(root, ...thumb.url.split('/')))) fail(`${where}: falta la miniatura ${thumb.url}`);

    const mobileRel = `workshop/${entry.id}/mobile.glb`;
    const triangles = prep.metrics?.triangles;
    const item = { id: entry.editorId, kind: 'model', src: rel };
    if (existsSync(path.join(root, 'assets', ...mobileRel.split('/')))) item.mobileSrc = mobileRel;
    item.fit = entry.fit;
    item[entry.fit] = metres;
    Object.assign(item, {
      label: entry.label, category: entry.category, status: entry.status,
      workshop: { id: entry.id, sourceRevision: entry.sourceRevision, publishedAt: entry.publishedAt },
      stats: { bytes: bytes.length, triangles, sha256: digest },
    });
    fresh.push(item);
    freshThumbs[entry.editorId] = { thumbnail: thumb.url, label: entry.label, stats: { bytes: bytes.length, triangles } };
  }

  const nextCatalog = { ...catalog, assets: [...catalog.assets.filter((asset) => !asset.workshop), ...fresh] };
  const nextThumbs = { ...thumbnails, assets: {} };
  for (const [key, value] of Object.entries(thumbnails.assets)) {
    // Workshop-owned keys are dropped here: still published ones are re-added below, stale ones stay removed.
    if (typeof value?.thumbnail === 'string' && value.thumbnail.startsWith(WORKSHOP_THUMB_PREFIX)) continue;
    nextThumbs.assets[key] = value;
  }
  Object.assign(nextThumbs.assets, freshThumbs);
  return {
    catalog: nextCatalog, thumbnails: nextThumbs,
    catalogText: serialize(nextCatalog, catalogText), thumbnailsText: serialize(nextThumbs, thumbsText),
    catalogPath, thumbsPath, currentCatalogText: catalogText, currentThumbsText: thumbsText, entries: fresh,
  };
}

function main(argv) {
  const check = argv.includes('--check');
  let result;
  try { result = buildPublication(DEFAULT_ROOT); } catch (error) { console.error(`ERROR publish-editor: ${error.message}`); return 1; }
  for (const item of result.entries) {
    console.log(`${item.id} ${item.src} ${item.fit}=${item[item.fit]} ${item.stats.sha256.slice(0, 12)}`);
  }
  const differing = [];
  if (result.catalogText !== result.currentCatalogText) differing.push('assets/editor/catalog.json');
  if (result.thumbnailsText !== result.currentThumbsText) differing.push('assets/editor/thumbnails.json');
  if (check) {
    if (differing.length) { console.error(`DIFF publish-editor: difieren ${differing.join(', ')}; ejecuta sin --check`); return 1; }
    console.log(`OK publish-editor: ${result.entries.length} entradas`);
    return 0;
  }
  if (result.catalogText !== result.currentCatalogText) writeFileSync(result.catalogPath, result.catalogText);
  if (result.thumbnailsText !== result.currentThumbsText) writeFileSync(result.thumbsPath, result.thumbnailsText);
  console.log(`publish-editor: ${result.entries.length} entradas; escritos: ${differing.length ? differing.join(', ') : 'ninguno (ya al día)'}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
