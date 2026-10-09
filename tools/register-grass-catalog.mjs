// Register S08 as a separate vegetation row only after runtime evidence is present.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file);
const catalog = JSON.parse(before);
const report = 'docs/delivery/grass-patches-v1.md';
const brief = 'docs/briefs/visual-s08-grass-patches.md';
const runtime = 'docs/art/grass/runtime-evidence-v1.json';
const sourceRoot = 'docs/art/source/grass-patches-v1';
const shots = [
  ['desktop-map-v1.png', 'Mapa real · escritorio'],
  ['mobile-map-v1.png', 'Mapa real · móvil emulado'],
  ['low-map-v1.png', 'Mapa real · low'],
  ['desktop-gallery-v1.png', 'Galería temporal · estilos'],
  ['variant-tuft-preview-v1.png', 'Preview runtime · tuft'],
  ['variant-fan-preview-v1.png', 'Preview runtime · fan'],
  ['variant-wild-preview-v1.png', 'Preview runtime · wild'],
  ['desktop-close-v1.png', 'Contacto real · escritorio'],
  ['mobile-close-v1.png', 'Contacto real · móvil emulado'],
  ['low-close-v1.png', 'Contacto real · low'],
  ['mobile-gallery-v1.png', 'Galería temporal · móvil'],
  ['low-gallery-v1.png', 'Galería temporal · low'],
  ['desktop-wind-0-v1.png', 'Viento · reloj 0'],
  ['desktop-wind-2-v1.png', 'Viento · reloj 2,1'],
  ['disabled-close-v1.png', 'Geometría nativa · noassets'],
];
const sourceNames = [
  'grassGeometry.source.js', 'grassPlacement.source.js', 'grassPatches.source.js',
  'vegetation.source.js', 'scene.source.js', 'source-snapshot.json',
  'shrubPlacement.source.js', 'qa-grass.source.js', 'grass-patches.test.source.mjs', 'prepare-grass-sources.source.mjs',
];
const artifact = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const evidence = [
  artifact('Entrega S08', report),
  artifact('Carga y estado de runtime', runtime),
  ...shots.map(([name, label]) => artifact(label, `docs/art/grass/${name}`)),
];
const sources = sourceNames.map((name) => artifact(
  name === 'source-snapshot.json' ? 'Hashes de fuentes congeladas' : `Fuente editable · ${name.replace('.source.js', '')}`,
  `${sourceRoot}/${name}`, 'source'));

for (const relative of [report, brief, runtime, ...shots.map(([name]) => `docs/art/grass/${name}`),
  ...sourceNames.map((name) => `${sourceRoot}/${name}`)]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing grass QA artifact: ${relative}`);
}
const runtimeData = JSON.parse(fs.readFileSync(path.join(root, runtime), 'utf8'));
if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData)) {
  throw new Error('Grass runtime evidence must be a JSON object');
}
if (runtimeData.cut !== 'S08' || runtimeData.cases?.length !== 4 ||
  runtimeData.cases.some((entry) => entry.errors?.length || Object.keys(entry.state?.errors || {}).length ||
    entry.state?.glError !== 0 || entry.state?.programsLinked !== true)) throw Error('S08 runtime QA has not passed');

let row = catalog.rows.find((entry) => entry.id === 'pasto-volumetrico');
if (row?.state === 'applied') {
  if (!row.evidence?.some((entry) => entry.path === report)) {
    throw new Error('Applied grass row has different evidence; review before editing');
  }
  for (const item of [...evidence, ...sources, artifact('Brief S08 · contrato y reutilización', brief, 'reference')]) {
    if (![...(row.files || []), ...(row.evidence || []), ...(row.references || [])].some((entry) => entry.path === item.path)) {
      throw new Error(`Applied grass registration is incomplete: ${item.path}`);
    }
  }
  console.log(`Grass registration already complete: revision ${catalog.revision}.`);
} else {
  if (!row) {
    row = {
      id: 'pasto-volumetrico', name: 'Pasto volumétrico', category: 'Vegetación',
      priority: 'P2', kind: 'object', references: [], files: [], evidence: [],
    };
    catalog.rows.push(row);
  }
  if (row.category !== 'Vegetación') throw new Error('Grass row has an unexpected category');
  const merge = (field, additions) => {
    row[field] ??= [];
    for (const item of additions) {
      const index = row[field].findIndex((entry) => entry.path === item.path);
      if (index < 0) row[field].push(item);
      else row[field][index] = { ...row[field][index], ...item };
    }
  };
  const previews = shots.slice(4, 7).map(([name, label]) => artifact(label, `docs/art/grass/${name}`, 'preview'));
  merge('files', sources);
  merge('references', [
    ...previews,
    artifact('Brief S08 · contrato y reutilización', brief, 'reference'),
  ]);
  merge('evidence', evidence);
  row.description = 'Matas pequeñas de hojas geométricas estrechas, curvas y pintadas, con material toon opaco y viento del renderer.';
  row.variants = ['tuft', 'fan', 'wild'];
  row.destination = ['src/render/grassGeometry.js', 'src/render/grassPlacement.js', 'src/render/grassPatches.js', 'src/render/vegetation.js', 'src/render/scene.js'];
  row.notes = 'S08: detalle cosmético determinista con despeje vegetal compartido, sin texturas ni alpha. High 600/55/24; medium o móvil 320/38/14; low 160/28/todo low. No altera mundo, props, colisiones ni RNG de simulación. No certifica FPS físico ni publicación.';
  row.nextStep = 'Revisar la lectura visual y densidad con el autor. FPS en dispositivo físico pendiente.';
  row.state = 'applied';

  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${file}.${process.pid}.grass.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Catalogue changed concurrently; preserve the newer revision');
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  console.log(`Grass registered: revision ${catalog.revision}, ${catalog.rows.length} rows.`);
}
