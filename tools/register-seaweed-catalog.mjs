// Register S10 on the existing seaweed row only after runtime and source evidence is complete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(catalogPath);
const catalog = JSON.parse(before);
const rowId = 'hierbas-algas';
const report = 'docs/delivery/seaweed-v1.md';
const brief = 'docs/briefs/visual-s10-seaweed.md';
const runtime = 'docs/art/seaweed/runtime-evidence-v1.json';
const sourceRoot = 'docs/art/source/seaweed-v1';
const devices = ['desktop', 'mobile', 'low', 'disabled'];
const screenshotFamilies = [
  ['map', 'Mapa de algas existentes'],
  ['close', 'Detalle de contacto'],
  ['gallery', 'Galería temporal de formas'],
];
const shots = devices.flatMap((device) => screenshotFamilies.map(([kind, label]) => [
  `${device}-${kind}-v1.png`, `${label} · ${device}`,
]));
shots.push(
  ['variant-ribbon-preview-v1.png', 'Preview runtime · cinta'],
  ['variant-fork-preview-v1.png', 'Preview runtime · bifurcada'],
  ['variant-fan-preview-v1.png', 'Preview runtime · abanico'],
  ['desktop-current-0-v1.png', 'Movimiento de hojas · escritorio · reloj 0'],
  ['desktop-current-2-v1.png', 'Movimiento de hojas · escritorio · reloj 2,1'],
);
const artifact = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const previews = shots.slice(12, 15).map(([name, label]) => artifact(label, `docs/art/seaweed/${name}`, 'preview'));
const visualEvidence = shots.map(([name, label]) => artifact(label, `docs/art/seaweed/${name}`));
const runtimeEvidence = artifact('Estado de runtime y cuatro casos QA', runtime);
const deliveryEvidence = artifact('Entrega S10', report);
const evidence = [deliveryEvidence, runtimeEvidence, ...visualEvidence];
const runtimeSnapshotPath = `${sourceRoot}/source-snapshot.json`;

for (const relative of [report, brief, runtime, runtimeSnapshotPath,
  ...shots.map(([name]) => `docs/art/seaweed/${name}`)]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing seaweed S10 artifact: ${relative}`);
}
const runtimeData = JSON.parse(fs.readFileSync(path.join(root, runtime), 'utf8'));
if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData) ||
  runtimeData.cut !== 'S10' || !Array.isArray(runtimeData.cases) || runtimeData.cases.length !== 4) {
  throw new Error('S10 runtime evidence must contain exactly four cases');
}
for (const device of devices) {
  const entry = runtimeData.cases.find((item) => item.device === device);
  if (!entry) throw new Error(`S10 runtime evidence is missing the ${device} case`);
  const unexpectedConsole = (entry.consoleErrors || []).filter((error) =>
    !(error.location?.url?.endsWith('/favicon.ico') && /404/.test(error.text)));
  if (entry.errors?.length || unexpectedConsole.length || Object.keys(entry.state?.errors || {}).length ||
    entry.state?.glError !== 0 || entry.state?.programsLinked !== true) {
    throw new Error(`S10 ${device} runtime QA has not passed`);
  }
}

const snapshot = JSON.parse(fs.readFileSync(path.join(root, runtimeSnapshotPath), 'utf8'));
if (!Array.isArray(snapshot.files) || snapshot.files.length === 0 || snapshot.files.some((entry) =>
  !entry.source || !entry.snapshot || !Number.isInteger(entry.bytes) || !/^[a-f0-9]{64}$/i.test(entry.sha256 || ''))) {
  throw new Error('S10 source snapshot receipt must list source, snapshot, byte count, and SHA-256');
}
for (const entry of snapshot.files) {
  if (!fs.existsSync(path.join(root, entry.snapshot))) throw new Error(`Missing S10 source snapshot file: ${entry.snapshot}`);
}
const sourceFiles = [artifact('Snapshot inmutable de fuentes S10', runtimeSnapshotPath, 'source'), ...snapshot.files.map((entry) =>
  artifact(`Fuente congelada · ${entry.source}`, entry.snapshot, 'source'))];
const requiredReferences = [
  ...previews,
  artifact('Brief S10 · contrato y reutilización', brief, 'reference'),
  artifact('Entrega S08 · pasto costero ya cubierto', 'docs/delivery/grass-patches-v1.md', 'reference'),
];
if (!fs.existsSync(path.join(root, 'docs/delivery/grass-patches-v1.md'))) {
  throw new Error('Missing S08 grass delivery reference');
}

let row = catalog.rows.find((entry) => entry.id === rowId);
if (!row) throw new Error(`Expected existing catalog row ${rowId}; do not add a new seaweed row`);
if (row.category !== 'Vegetación') throw new Error('Existing seaweed row has an unexpected category');
const merge = (field, additions) => {
  row[field] ??= [];
  if (!Array.isArray(row[field])) throw new Error(`Catalog ${field} is not an array`);
  for (const item of additions) {
    const index = row[field].findIndex((entry) => entry.path === item.path);
    if (index < 0) row[field].push(item);
    else row[field][index] = { ...row[field][index], ...item };
  }
};
const requiredLinks = [...sourceFiles, ...requiredReferences, ...evidence];
const linked = (item) => [...(row.files || []), ...(row.references || []), ...(row.evidence || [])]
  .some((entry) => entry.path === item.path);
if (row.state === 'applied') {
  if (row.name !== 'Hierbas costeras y algas someras' || !requiredLinks.every(linked)) {
    throw new Error('Applied seaweed row is incomplete or has a different identity; review before editing');
  }
  console.log(`Seaweed registration already complete: revision ${catalog.revision}.`);
} else {
  row.name = 'Hierbas costeras y algas someras';
  row.description = 'Pasto costero de S08 y algas someras S10 en tres siluetas pintadas. Las algas sustituyen las formas básicas en sus posiciones submarinas existentes.';
  row.variants = ['cinta arqueada', 'bifurcada', 'abanico bajo'];
  row.destination = ['src/render/seaweed.js', 'src/render/seaweedGeometry.js', 'src/render/seaweedPlacement.js', 'src/render/vegetation.js', 'src/render/scene.js'];
  row.notes = 'S10 reutiliza exclusivamente props seaweed ya generados: 197/216 anchors del seed actual sobreviven al filtro y cap high 256. Tres formas ribbon/fork/fan: cerca 60/84/72 triángulos, lejos 16 cada una. High 256 instancias / distancia 65 / detalle cercano 22; medium o móvil 160/45/14; low 96/32/sin detalle cercano. Sin modelos ni mapas nuevos; material opaco compartido, geometría instanciada por chunks, sin sombra propia ni pase de contorno. El pasto costero ya está cubierto por S08; S10 no añade hierbas terrestres. Sin cambios de props, colisiones ni RNG. QA local de escritorio, móvil emulado, low y noassets registrado; FPS físico, revisión artística y publicación pendientes.';
  row.nextStep = 'Revisar lectura visual y densidad con el autor; FPS en dispositivo físico y publicación pendientes.';
  row.files ??= [];
  row.references ??= [];
  row.evidence ??= [];
  merge('files', sourceFiles);
  merge('references', requiredReferences);
  row.references = [...previews, ...row.references.filter((entry) => !previews.some((preview) => preview.path === entry.path))];
  merge('evidence', evidence);
  row.state = 'applied';

  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.seaweed.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(before)) throw new Error('Catalogue changed concurrently; preserve the newer revision');
    fs.renameSync(temp, catalogPath);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  console.log(`Seaweed registered: revision ${catalog.revision}, ${catalog.rows.length} rows.`);
}
