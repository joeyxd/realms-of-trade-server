// Register S09 beach debris only after its runtime and visual artifacts exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(catalogPath);
const catalog = JSON.parse(before);
const rowId = 'restos-playa';
const report = 'docs/delivery/beach-debris-v1.md';
const brief = 'docs/briefs/visual-s09-beach-debris.md';
const runtime = 'docs/art/beach-debris/runtime-evidence-v1.json';
const runtimeSourceRoot = 'docs/art/source/beach-debris-runtime-v1';
const sourceRoot = 'docs/art/source/beach-debris-v1';
const models = [
  ['branch', 'assets/models/beach-debris-branch-v1.glb', 'Modelo GLB · rama'],
  ['log', 'assets/models/beach-debris-log-v1.glb', 'Modelo GLB · tronco corto'],
  ['planks', 'assets/models/beach-debris-planks-v1.glb', 'Modelo GLB · tablones varados'],
];
const previews = [
  ['variant-branch-preview-v1.png', 'Vista runtime · rama'],
  ['variant-log-preview-v1.png', 'Vista runtime · tronco corto'],
  ['variant-planks-preview-v1.png', 'Vista runtime · tablones varados'],
];
const shots = [
  ['desktop-map-v1.png', 'Mapa real · escritorio'],
  ['desktop-close-v1.png', 'Contacto real · escritorio'],
  ['desktop-gallery-v1.png', 'Galería temporal · escritorio'],
  ['mobile-map-v1.png', 'Mapa real · móvil emulado'],
  ['mobile-close-v1.png', 'Contacto real · móvil emulado'],
  ['mobile-gallery-v1.png', 'Galería temporal · móvil emulado'],
  ['low-map-v1.png', 'Mapa real · low'],
  ['low-close-v1.png', 'Contacto real · low'],
  ['low-gallery-v1.png', 'Galería temporal · low'],
  ['disabled-gallery-v1.png', 'Fallback · noassets'],
  ['missing-gallery-v1.png', 'Fallback · modelos ausentes'],
  ['invalid-gallery-v1.png', 'Fallback · modelos inválidos'],
];
const artifact = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const screenshotEvidence = shots.map(([name, label]) => artifact(label, `docs/art/beach-debris/${name}`));
const evidence = [
  artifact('Entrega S09', report),
  artifact('Estado de runtime y seis casos QA', runtime),
  ...screenshotEvidence,
];
const mustExist = [report, brief, runtime,
  'docs/art/source/beach-debris-v1/README.md',
  'docs/art/source/beach-debris-v1/SM_Logs.geometry-export.glb',
  'docs/art/source/beach-debris-v1/SM_Logs.unreal-report.json',
  'docs/art/source/beach-debris-v1/stage-evidence.json',
  'docs/art/source/beach-debris-v1/runtime-models.json',
  ...models.map(([, relative]) => relative),
  ...previews.map(([name]) => `docs/art/beach-debris/${name}`),
  ...shots.map(([name]) => `docs/art/beach-debris/${name}`),
  `${runtimeSourceRoot}/source-snapshot.json`,
];
for (const relative of mustExist) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing beach-debris S09 artifact: ${relative}`);
}

const runtimeData = JSON.parse(fs.readFileSync(path.join(root, runtime), 'utf8'));
const expectedCases = ['desktop', 'mobile', 'low', 'disabled', 'missing', 'invalid'];
const caseText = (entry) => [entry.id, entry.name, entry.device, entry.mode, entry.case, entry.label]
  .filter(Boolean).join(' ').toLowerCase();
if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData) ||
  runtimeData.cut !== 'S09' || !Array.isArray(runtimeData.cases) || runtimeData.cases.length !== 6) {
  throw new Error('S09 runtime evidence must contain exactly six cases');
}
for (const expected of expectedCases) {
  const match = runtimeData.cases.find((entry) => caseText(entry).includes(expected));
  if (!match) throw new Error(`S09 runtime evidence is missing the ${expected} case`);
  if (match.errors?.length || match.pageErrors?.length || match.pageerrors?.length || Object.keys(match.state?.errors || {}).length ||
    match.state?.glError !== 0 || match.state?.programsLinked !== true) {
    throw new Error(`S09 ${expected} runtime QA has not passed`);
  }
}

const runtimeSnapshotPath = `${runtimeSourceRoot}/source-snapshot.json`;
const runtimeSnapshot = JSON.parse(fs.readFileSync(path.join(root, runtimeSnapshotPath), 'utf8'));
if (!Array.isArray(runtimeSnapshot.files) || runtimeSnapshot.files.some((entry) => !entry.snapshot)) {
  throw new Error('S09 runtime source snapshot must list snapshot paths in files[].snapshot');
}
for (const entry of runtimeSnapshot.files) {
  if (!fs.existsSync(path.join(root, entry.snapshot))) throw new Error(`Missing S09 source snapshot file: ${entry.snapshot}`);
}
const runtimeSourceArtifacts = runtimeSnapshot.files.map((entry) => artifact(
  `Fuente editable · ${entry.source || entry.snapshot}`, entry.snapshot, 'source'));
const sourceAssets = [
  artifact('Geometría original exportada de Unreal', `${sourceRoot}/SM_Logs.geometry-export.glb`, 'source'),
  artifact('Informe Unreal · clase, límites y dependencias', `${sourceRoot}/SM_Logs.unreal-report.json`, 'source'),
  artifact('Evidencia de hashes S09', `${sourceRoot}/stage-evidence.json`, 'source'),
  artifact('Modelos runtime y sus hashes', `${sourceRoot}/runtime-models.json`, 'source'),
  artifact('README de procedencia S09', `${sourceRoot}/README.md`, 'source'),
  artifact('Snapshot de fuentes runtime', runtimeSnapshotPath, 'source'),
  ...runtimeSourceArtifacts,
  ...models.map(([, relative, label]) => artifact(label, relative, 'model')),
];
const previewReferences = previews.map(([name, label]) => artifact(label, `docs/art/beach-debris/${name}`, 'preview'));
const previewEvidence = previews.map(([name, label]) => artifact(label, `docs/art/beach-debris/${name}`));
const allEvidence = [...evidence, ...previewEvidence];

let row = catalog.rows.find((entry) => entry.id === rowId);
if (!row) throw new Error(`Expected existing catalog row ${rowId}; preserving catalog shape`);
if (row.category !== 'Terreno y costa' || row.name !== 'Madera varada y restos de playa') {
  throw new Error('Existing beach-debris row identity changed; review before registration');
}
const merge = (field, additions) => {
  row[field] ??= [];
  if (!Array.isArray(row[field])) throw new Error(`Catalog ${field} is not an array`);
  for (const item of additions) {
    const index = row[field].findIndex((entry) => entry.path === item.path);
    if (index < 0) row[field].push(item);
    else row[field][index] = { ...row[field][index], ...item };
  }
};
const requiredLinks = [...sourceAssets, ...previewReferences, artifact('Brief S09 · contrato y reutilización', brief, 'reference'), ...allEvidence];
const complete = row.state === 'applied' && requiredLinks.every((item) =>
  [...(row.files || []), ...(row.references || []), ...(row.evidence || [])].some((entry) => entry.path === item.path));
if (complete) {
  console.log(`Beach-debris registration already complete: revision ${catalog.revision}.`);
} else {
  if (row.state === 'applied') throw new Error('Beach-debris row is applied but its artifact links are incomplete; inspect before changing revision');
  // Add the three real previews first so the HTML catalog can immediately render them.
  merge('references', [artifact('Brief S09 · contrato y reutilización', brief, 'reference')]);
  row.references = [...previewReferences, ...row.references.filter((e) => !previewReferences.some((p) => p.path === e.path))];
  merge('files', sourceAssets);
  merge('evidence', allEvidence);
  row.description = 'Ramas torcidas, troncos cortos y tablones gastados, con planos pintados y vetas oscuras sobre la arena de playa.';
  row.variants = ['rama', 'tronco corto', 'tablones varados'];
  row.destination = ['src/render/beachDebris.js', 'src/render/beachDebrisGeometry.js', 'src/render/beachDebrisPlacement.js', 'src/render/vegetation.js'];
  row.notes = 'S09: 34 conjuntos cosméticos por hash (19 ramas/ocho troncos/siete tablones), material toon opaco compartido y vetas, instancing; sin texturas nuevas, alpha ni sombras propias. High hasta 96/65 m, móvil-medium 64/45 m, low 32/32 m. GLB ausentes o inválidos usan geometría nativa; SM_Logs se reutiliza en los tablones tras inspección visual. No altera props, colisiones ni RNG. Revisión artística del autor, FPS físicos y publicación pendientes.';
  row.nextStep = 'Revisar lectura visual, contacto con arena y densidad con el autor; FPS en dispositivo físico y publicación pendientes.';
  row.state = 'applied';
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.beach-debris.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(before)) throw new Error('Catalogue changed concurrently; preserve the newer revision');
    fs.renameSync(temp, catalogPath);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  console.log(`Beach debris registered: revision ${catalog.revision}, ${catalog.rows.length} rows.`);
}
