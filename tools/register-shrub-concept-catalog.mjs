// Register generated source art as a reference without accepting runtime integration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file), data = JSON.parse(before);
const row = data.rows.find((r) => r.id === 'arbusto-tropical');
if (!row) throw Error('Missing shrub row');
const folder = 'docs/art/source/shrub-art-v1';
const report = 'docs/art/shrubs/shrub-v1.md';
const entries = [
  ['Concepto generado · arbusto v1', folder + '/concept.png', 'preview', 'references'],
  ['Color · cuatro hojas · fuente RGBA', folder + '/albedo.png', 'albedo', 'files'],
  ['Normal generado · fuente RGBA · prueba', folder + '/normal.png', 'normal', 'files'],
  ['Prompts exactos · herramienta integrada', folder + '/prompts.json', 'source', 'files'],
  ['Procedencia · hashes y medidas', folder + '/receipt.json', 'source', 'files'],
  ['Prueba de arte · alcance y siguiente paso', report, 'source', 'files'],
];
for (const [, p] of entries) if (!fs.existsSync(path.join(root, p))) throw Error('Missing shrub artifact: ' + p);
let changed = false;
// Keep generation originals in materials; serve identical source copies through the catalogue's docs allowlist.
for (const field of ['references', 'files']) for (const item of row[field] || []) {
  const old = 'materials/generated/tropical-shrub-v1/';
  if (item.path.startsWith(old)) { item.path = folder + '/' + item.path.slice(old.length); changed = true; }
}
const registered = row.files.some((f) => f.path === report);
if (registered) {
  for (const [, p, , field] of entries) if (!row[field].some((e) => e.path === p)) throw Error('Incomplete shrub registration');
} else {
  if (!['pending', 'reference'].includes(row.state)) throw Error('Shrub row has advanced; review before editing');
  for (const [label, p, role, field] of entries) {
    row[field] ??= [];
    if (!row[field].some((e) => e.path === p)) row[field].push({ label, path: p, role });
  }
  row.state = 'reference';
  row.nextStep = 'Preparar atlas PC/móvil con gutters, montar hojas y tallos y probar viento, normal y sombra en el mapa.';
  row.notes = (row.notes ? row.notes + '\n' : '') + 'Prueba v1: concepto + color/normal 2×2 de cuatro hojas, RGBA con alfa real. Generador integrado; GPT Image 2 solicitado, identificador de modelo no devuelto. Normal aproximado, máscara no idéntica; bake y GPU pendientes. Fuentes fuera del bundle; todavía no aplicado en juego.';
  changed = true;
}
if (changed) {
  data.revision++; data.updatedAt = new Date().toISOString();
  const temp = file + '.' + process.pid + '.shrub-concept.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw Error('Catalog changed concurrently');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(JSON.stringify({ revision: data.revision, rows: data.rows.length, state: row.state, applied: data.rows.filter((r) => r.state === 'applied').length }));
