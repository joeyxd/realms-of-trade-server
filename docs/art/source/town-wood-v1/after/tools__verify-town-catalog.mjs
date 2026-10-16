#!/usr/bin/env node
// Verify S14 catalogue metadata, immutable source snapshots, and every linked artifact served by the local catalogue.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG_PATH = 'tools/art-catalog/catalog.json';
const MATERIAL_RECEIPT = 'docs/art/town-wood/material-receipt-v1.json';
const SOURCE_RECEIPT = 'docs/art/source/town-wood-v1/runtime-source-snapshot.json';
const RUNTIME = 'docs/art/town-wood/runtime-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s14-town-wood.md';
const REPORT = 'docs/delivery/town-wood-v1.md';
const PAIRS = [
  { id: 'planks', name: 'Tablones de madera' }, { id: 'patched', name: 'Tablones parchados' },
  { id: 'floor', name: 'Piso de tablones' }, { id: 'beam', name: 'Viga horizontal' },
  { id: 'timber', name: 'Madera sólida' }, { id: 'iron', name: 'Madera con refuerzo de hierro' },
  { id: 'corner', name: 'Esquina exterior de madera' }, { id: 'door', name: 'Muro de madera con puerta' },
  { id: 'window', name: 'Muro de madera con ventana' },
];
const BEFORE = ['desktop', 'mobile', 'low'];
const AFTER = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-albedo', 'missing-normal', 'portrait'];
const VIEWS = ['overview', 'house', 'stall', 'dock'];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const screenshots = [
  ...BEFORE.flatMap((device) => VIEWS.map((view) => `docs/art/town-wood/${device}-${view}-before-v1.png`)),
  ...AFTER.flatMap((device) => VIEWS.map((view) => `docs/art/town-wood/${device}-${view}-after-v1.png`)),
];
const atlas = (channel, device) => `assets/textures/town-wood-v1/atlas-${channel}-${device}.webp`;
const SOURCE_SCOPE = [
  ...['src/render/townMaterials.js', 'src/render/props.js', 'assets/manifest.json', 'tools/prepare-town-materials.mjs',
    'tools/register-town-manifest.mjs', 'tools/register-town-catalog.mjs', 'tools/verify-town-catalog.mjs',
    'tools/prepare-town-sources.mjs', 'tools/qa-town-wood.playwright.js', 'tests/town-materials.test.mjs', 'tests/dock-wood.test.mjs']
    .map((source) => ({ phase: 'after', source })),
  { phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/town-wood-v1/before/props.source.js' },
];

const catalog = readJson(CATALOG_PATH);
const material = readJson(MATERIAL_RECEIPT);
const sourceReceipt = readJson(SOURCE_RECEIPT);
const runtime = readJson(RUNTIME);
assert(material.schemaVersion === 1 && material.family === 'town-wood-v1' && material.sources?.length === 18, 'Material receipt S14 inválido.');
assert(sourceReceipt.schema === 1 && sourceReceipt.family === 'town-wood-v1' && Array.isArray(sourceReceipt.sources), 'Source snapshot S14 inválido.');
assert(runtime.schema === 1 && runtime.family === 'town-wood-v1', 'Runtime evidence S14 inválida.');
const sourcePaths = new Set();
for (const expected of SOURCE_SCOPE) {
  const matches = sourceReceipt.sources.filter((entry) => entry.phase === expected.phase && entry.source === expected.source);
  assert(matches.length === 1, `Falta snapshot ${expected.phase}: ${expected.source}`);
  const entry = matches[0];
  if (expected.snapshot) assert(entry.snapshot === expected.snapshot, `Ruta before incorrecta: ${entry.snapshot}`);
  assert(typeof entry.snapshot === 'string' && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), 'Entrada de snapshot S14 incompleta.');
  assert(!sourcePaths.has(entry.snapshot), `Snapshot duplicado: ${entry.snapshot}`);
  const bytes = fs.readFileSync(path.join(ROOT, entry.snapshot));
  assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Snapshot inmutable inválido: ${entry.snapshot}`);
  sourcePaths.add(entry.snapshot);
}
assert(sourceReceipt.sources.length === SOURCE_SCOPE.length && sourcePaths.size === SOURCE_SCOPE.length, 'El snapshot debe incluir solo las once fuentes after y la fuente before.');
const sourceCopies = new Set();
for (const source of material.sources) {
  assert(Number.isInteger(source.bytes) && /^[a-f0-9]{64}$/.test(source.sha256), 'Original incompleto en el recibo de material.');
  assert(!sourceCopies.has(source.path), `Copia PNG duplicada: ${source.path}`);
  const bytes = fs.readFileSync(path.join(ROOT, source.path));
  assert(bytes.length === source.bytes && hash(bytes) === source.sha256, `Copia PNG exacta inválida: ${source.path}`);
  sourceCopies.add(source.path);
}
assert(sourceCopies.size === 18, 'El recibo debe contener 18 copias PNG exactas.');
for (const kitId of ['kit-piso', 'kit-poste', 'kit-viga-diagonal', 'muelle-soporte']) {
  const row = catalog.rows.find((entry) => entry.id === kitId);
  if (row) assert(row.state === 'pending', `La fila pendiente ${kitId} no debe quedar aplicada por S14.`);
}

const rows = new Map();
const links = new Set([MATERIAL_RECEIPT, SOURCE_RECEIPT, RUNTIME, BRIEF, REPORT, ...screenshots]);
for (const pair of PAIRS) {
  const id = `town-wood-${pair.id}`;
  const row = catalog.rows.find((entry) => entry.id === id);
  assert(row && row.id === id && row.name === pair.name && row.category === 'Kit portuario' && row.priority === 'P0' && row.kind === 'material' && row.state === 'applied', `Fila S14 incorrecta: ${id}.`);
  rows.set(id, row);
  const references = new Set((row.references || []).map((entry) => entry.path));
  const files = new Set((row.files || []).map((entry) => entry.path));
  const evidence = new Set((row.evidence || []).map((entry) => entry.path));
  const sourceEntries = material.sources.filter((entry) => entry.pairId === pair.id);
  const previewEntries = material.derivatives.filter((entry) => entry.kind === 'preview' && entry.pairId === pair.id);
  assert(sourceEntries.length === 2 && previewEntries.length === 2, `Fuentes/previews incompletos: ${id}.`);
  for (const entry of previewEntries) assert(references.has(entry.path) && files.has(entry.path), `Falta preview albedo/normal en referencias/archivos: ${id}/${entry.path}.`);
  for (const entry of sourceEntries) assert(files.has(entry.path), `Falta original exacto en ${id}: ${entry.path}.`);
  for (const relative of [atlas('albedo', 'desktop'), atlas('albedo', 'mobile'), atlas('normal', 'desktop'), atlas('normal', 'mobile'), MATERIAL_RECEIPT, SOURCE_RECEIPT, RUNTIME, BRIEF, REPORT]) {
    assert(files.has(relative), `Falta archivo del kit compartido en ${id}: ${relative}.`);
  }
  for (const entry of sourceReceipt.sources) assert(files.has(entry.snapshot), `Falta snapshot de fuente en ${id}: ${entry.snapshot}.`);
  for (const relative of screenshots) assert(evidence.has(relative), `Falta captura gameplay en ${id}: ${relative}.`);
  assert(evidence.has(REPORT) && evidence.has(RUNTIME), `Falta evidencia S14 en ${id}.`);
  for (const entry of [...row.references || [], ...row.files || [], ...row.evidence || []]) if (entry.path) links.add(entry.path);
}

const base = process.env.TOWN_WOOD_CATALOG_BASE || 'http://127.0.0.1:5190';
await Promise.all([...links].map(async (relative) => {
  const local = fs.readFileSync(path.join(ROOT, relative));
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${base}/files/${encoded}`);
  assert(response.ok, `HTTP ${response.status} para ${relative}.`);
  const served = Buffer.from(await response.arrayBuffer());
  assert(hash(served) === hash(local), `Los bytes servidos difieren: ${relative}.`);
}));
const liveResponse = await fetch(`${base}/api/catalog`);
assert(liveResponse.ok, `Catálogo activo HTTP ${liveResponse.status}.`);
const live = await liveResponse.json();
assert(live.revision === catalog.revision, `Revisión activa ${live.revision}; local ${catalog.revision}.`);
for (const [id, row] of rows) assert(JSON.stringify(live.rows?.find((entry) => entry.id === id)) === JSON.stringify(row), `Fila activa difiere del JSON local: ${id}.`);
console.log(`S14 catálogo verificado: ${rows.size} filas, ${links.size} enlaces HTTP por SHA-256, revisión ${catalog.revision}.`);
