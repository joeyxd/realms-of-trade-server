// Register S04 after local evidence exists, with one catalog-wide compare-and-swap.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'tools/art-catalog/catalog.json'), before = fs.readFileSync(file), data = JSON.parse(before);
const report = 'docs/delivery/beach-details-v1.md';
const artifact = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const shots = ['desktop', 'mobile', 'low'].flatMap((d) => [
  artifact(`Mapa real · ${d}`, `docs/art/beach-details/${d}-map-clean-v1.png`),
  artifact(`Contacto real · ${d}`, `docs/art/beach-details/${d}-contact-v1.png`),
  artifact(`Mapa con HUD · ${d}`, `docs/art/beach-details/${d}-map-v1.png`),
]);
const shared = [artifact('Entrega S04', report), ...shots,
  artifact('Muestrario temporal · escala 1.7×', 'docs/art/beach-details/desktop-gallery-v1.png'),
  ...['missing', 'invalid', 'disabled'].map((d) => artifact(`Fallback · ${d}`, `docs/art/beach-details/${d}-map-clean-v1.png`)),
  artifact('Carga, variantes y fallback · seis casos', 'docs/art/beach-details/browser-evidence-v1.json')];
const sourceFiles = [
  artifact('Fuente editable · geometría y distribución', 'docs/art/source/beach-details-v1/beachDetails.source.js', 'source'),
  artifact('Material pintado · shader y renderer', 'docs/art/source/beach-details-v1/vegetation.source.js', 'source'),
  artifact('Generador reproducible', 'docs/art/source/beach-details-v1/prepare-beach-details.source.mjs', 'source'),
  artifact('Hashes de las copias exactas de código', 'docs/art/source/beach-details-v1/source-snapshot.json', 'source'),
  artifact('Hashes, fuentes y presupuesto', 'docs/art/source/beach-details-v1/receipt.json', 'source'),
];
const specs = [
  { id: 'conchas-playa', names: ['shell-fan', 'shell-oval', 'shell-chip'], variants: ['abanico', 'ovalada', 'fragmento'],
    description: 'Conchas independientes marfil/coral con volumen convexo, nervaduras y borde pintado; tres siluetas sobre arena expuesta.',
    note: 'Actual S04: tres GLB propios con normales geométricas y color por vértice; las nervaduras se pintan en el shader del juego. Cien conchas en la semilla actual, máximo 144 global. Decoración sin colisiones ni recogida; PC/móvil emulado/low/fallback revisados. Arte final y FPS físicos pendientes.' },
  { id: 'cantos-guijarros', names: ['pebbles'], variants: ['canto gris cálido', 'canto claro', 'grupo de tres'],
    description: 'Grupos bajos de tres cantos angulares pintados, derivados del SM_Rock ya exportado en S02.',
    note: 'Actual S04: un GLB de 192 triángulos, sin imágenes ni texturas; reutilización del SM_Rock exacto de S02. Cincuenta y ocho grupos en la semilla actual, máximo 96 global. Decoración sin colisiones; fallback geométrico si falta el GLB/SM_Rock. PC/móvil emulado/low revisados; arte final y FPS físicos pendientes.' },
];
let changed = false;
for (const spec of specs) {
  const row = data.rows.find((r) => r.id === spec.id);
  if (!row) throw new Error('Missing row: ' + spec.id);
  if (row.evidence.some((e) => e.path === report)) continue;
  const files = [...sourceFiles, ...spec.names.map((name) => artifact(`Modelo portable · ${name} · PC/móvil`, `assets/models/beach-${name}-v1.glb`, 'model'))];
  if (spec.id === 'cantos-guijarros') files.push(
    artifact('SM_Rock · export original de geometría', 'docs/art/source/coast-rock-v1/SM_Rock.geometry-export.glb', 'source'),
    artifact('SM_Rock · informe Unreal S02', 'docs/art/source/coast-rock-v1/SM_Rock.unreal-report.json', 'source'));
  const previews = spec.names.map((name) => artifact(`Preview · ${name} · muestrario 1.7×`, `docs/art/beach-details/${name}-preview-v1.png`, 'preview'));
  const brief = artifact('Brief S04 · reparto y reutilización', 'docs/briefs/visual-s04-beach-details.md', 'reference');
  for (const a of [...files, ...shared, ...previews, brief]) if (!fs.existsSync(path.join(root, a.path))) throw new Error('Missing evidence: ' + a.path);
  row.state = 'applied'; row.description = spec.description; row.variants = spec.variants;
  row.destination = ['src/render/beachDetails.js', 'src/render/vegetation.js', ...spec.names.map((n) => `assets/models/beach-${n}-v1.glb`)];
  row.notes = spec.note + ' Histórico: ' + row.notes;
  row.nextStep = 'Afinar color/escala/densidad con el autor. Rendimiento físico pendiente; siguiente familia visual: palmeras.';
  row.files = [...files, ...row.files.filter((a) => !files.some((b) => a.path === b.path))];
  row.references = [...previews, brief, ...row.references.map((r) => r.role === 'preview' ? { ...r, role: 'reference' } : r)];
  row.evidence = [...shared, ...row.evidence.filter((a) => !shared.some((b) => a.path === b.path))]; changed = true;
}
// Repair the draft's source links through explicit snapshots, keeping the server allowlist unchanged.
const sourcePaths = { 'src/render/beachDetails.js': sourceFiles[0].path, 'src/render/vegetation.js': sourceFiles[1].path,
  'tools/prepare-beach-details.mjs': sourceFiles[2].path };
for (const spec of specs) {
  const row = data.rows.find((r) => r.id === spec.id);
  for (const entry of row.files) if (sourcePaths[entry.path]) {
    entry.path = sourcePaths[entry.path];
    if (!fs.existsSync(path.join(root, entry.path))) throw new Error('Missing source snapshot: ' + entry.path);
    changed = true;
  }
  if (!row.files.some((a) => a.path === sourceFiles[3].path)) {
    row.files.push(sourceFiles[3]); changed = true;
  }
}
if (changed) {
  // Keep the existing sand row accurate without changing its supplied textures or evidence.
  const sand = data.rows.find((r) => r.id === 'arena-conchas');
  if (sand) {
    sand.description = 'Acabado de arena con conchas pequeñas y guijarros dibujados en el albedo; conchas y cantos independientes incorporados después en S04.';
    sand.nextStep = 'Afinar el acabado de arena con el autor; piezas independientes en conchas-playa/cantos-guijarros S04. FPS físicos pendientes.';
    if (!sand.notes.startsWith('Actual S04:')) sand.notes = 'Actual S04: las piezas independientes ya tienen sus propias filas aplicadas. ' + sand.notes;
  }
  data.revision++; data.updatedAt = new Date().toISOString();
  const temp = `${file}.${process.pid}.beach.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Catalog changed concurrently; retain its revision');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S04 registered: revision ${data.revision}, ${data.rows.length} rows.`);
