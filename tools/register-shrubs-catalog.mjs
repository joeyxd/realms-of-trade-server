// Promote only the existing tropical shrub reference after local runtime evidence is present.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file), data = JSON.parse(before);
const row = data.rows.find((entry) => entry.id === 'arbusto-tropical');
if (!row) throw new Error('Missing shrub row');
if (!['reference', 'applied'].includes(row.state)) throw new Error(`Unexpected shrub state: ${row.state}`);
const a = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const runtimeSource = 'docs/art/source/shrub-runtime-v1';
const texture = 'assets/textures/shrub-v1';
const modelNames = ['round', 'low', 'tall'];
const models = modelNames.map((name) => a(`Modelo portable · ${name}`, `assets/models/shrub-${name}-v1.glb`, 'model'));
const textures = ['albedo', 'normal'].flatMap((kind) => ['pc', 'mobile'].map((device) =>
  a(`Atlas ${kind} · ${device} · ${device === 'pc' ? '512×512' : '256×256'}`,
    `${texture}/${kind}-${device}.webp`, device === 'mobile' ? 'mobile' : kind)));
const sourceFiles = [
  a('Recibo de geometría y presupuestos', `${runtimeSource}/geometry-receipt.json`, 'source'),
  a('Recibo de texturas · recortes, variantes y hashes', `${runtimeSource}/textures-receipt.json`, 'source'),
  a('Snapshots de integración · seis fuentes', `${runtimeSource}/source-snapshot.json`, 'source'),
  ...['shrubMaterials', 'shrubPlacement', 'vegetation', 'palmMaterials', 'qa-shrubs'].map((name) =>
    a(`Snapshot de fuente · ${name}`, `${runtimeSource}/${name}.source.js`, 'source')),
  a('Snapshot de fuente · prepare-shrub-sources', `${runtimeSource}/prepare-shrub-sources.source.mjs`, 'source'),
  a('Fuente editable · geometría de arbustos', `${runtimeSource}/shrubGeometry.source.js`, 'source'),
  a('Generador reproducible · modelos', `${runtimeSource}/prepare-shrubs.source.mjs`, 'source'),
  a('Generador reproducible · atlas', `${runtimeSource}/prepare-shrub-textures.source.mjs`, 'source'),
  ...['concept.png', 'albedo.png', 'normal.png', 'prompts.json', 'receipt.json'].map((name) =>
    a(`Snapshot exacto de fuente · ${name}`, `${runtimeSource}/${name}`, 'source')),
];
const report = 'docs/delivery/shrubs-v1.md';
const brief = 'docs/briefs/visual-s07-shrubs.md';
const evidence = [
  a('Entrega S07', report),
  a('Brief S07 · alcance y reutilización', brief, 'reference'),
  a('Carga, variantes y fallos · ocho casos', 'docs/art/shrubs/runtime-evidence-v1.json'),
  ...[
    ['desktop-map-v1.png', 'Mapa real · escritorio'], ['desktop-close-v1.png', 'Contacto real · escritorio'],
    ['desktop-gallery-v1.png', 'Muestrario temporal · escritorio'], ['mobile-map-v1.png', 'Mapa real · móvil emulado'],
    ['mobile-gallery-v1.png', 'Muestrario temporal · móvil'],
    ['low-map-v1.png', 'Mapa real · low'], ['low-close-v1.png', 'Contacto · low'], ['low-gallery-v1.png', 'Muestrario · low'],
    ['desktop-wind-0-v1.png', 'Viento · reloj 0'], ['desktop-wind-2-v1.png', 'Viento · reloj 2,1'],
    ['desktop-normal-off-v1.png', 'Comparación · normal apagado'],
    ['missing-model-close-v1.png', 'Fallback · modelo ausente'], ['invalid-model-close-v1.png', 'Fallback · modelo inválido'],
    ['missing-color-close-v1.png', 'Fallback · color ausente'], ['missing-normal-close-v1.png', 'Fallback · normal ausente'],
    ['disabled-close-v1.png', 'Fallback · recursos desactivados'],
  ].map(([name, label]) => a(label, `docs/art/shrubs/${name}`)),
  ...modelNames.map((name) => a(`Preview runtime · variante ${name}`, `docs/art/shrubs/variant-${name}-preview-v1.png`, 'preview')),
];
for (const artifact of [...models, ...textures, ...sourceFiles, ...evidence]) {
  if (!fs.existsSync(path.join(root, artifact.path))) throw new Error(`Missing shrub artifact: ${artifact.path}`);
}
if (row.state === 'applied') {
  if (!row.evidence?.some((entry) => entry.path === report)) throw new Error('Applied shrub row has different evidence; review before editing');
  for (const artifact of [...models, ...textures, ...sourceFiles, ...evidence]) {
    if (![...(row.files || []), ...(row.evidence || []), ...(row.references || [])].some((entry) => entry.path === artifact.path))
      throw new Error(`Incomplete applied shrub registration: ${artifact.path}`);
  }
  if (row.references?.[0]?.path !== 'docs/art/shrubs/variant-round-preview-v1.png') throw new Error('Applied shrub row does not lead with runtime previews');
  console.log(`Shrub registration already complete: revision ${data.revision}.`);
} else {
  const merge = (field, additions) => {
    row[field] ??= [];
    for (const artifact of additions) if (!row[field].some((entry) => entry.path === artifact.path)) row[field].push(artifact);
  };
  merge('files', [...models, ...textures, ...sourceFiles]);
  const previews = modelNames.map((name) => a(`Preview runtime · ${name}`, `docs/art/shrubs/variant-${name}-preview-v1.png`, 'preview'));
  row.references = [
    ...previews,
    ...(row.references || []).filter((reference) => !previews.some((preview) => preview.path === reference.path)).map((reference) =>
      reference.path === 'docs/art/source/shrub-art-v1/concept.png' && reference.role === 'preview'
        ? { ...reference, role: 'reference' } : reference),
  ];
  merge('references', [a('Brief S07 · contrato', brief, 'reference')]);
  merge('evidence', evidence);
  row.state = 'applied';
  row.description = 'Arbustos tropicales independientes de tallos cálidos y hojas anchas pintadas, con contorno entintado y atlas recortado.';
  row.variants = ['redondo', 'bajo', 'alto'];
  row.destination = ['src/render/shrubGeometry.js', 'src/render/shrubMaterials.js', 'src/render/shrubPlacement.js',
    'src/render/vegetation.js', ...models.map((entry) => entry.path), ...textures.map((entry) => entry.path)];
  row.nextStep = 'Revisar escala, densidad, color y lectura artística con el autor. FPS en dispositivo físico pendiente.';
  row.notes = 'S07 local: 784 arbustos (330 redondos/290 bajos/164 altos) en seed 99282957; 262 reemplazos y 522 de dispersión, límite 900. Conserva 80 anclajes inseguros con apariencia procedural para feedback de collider. Tres GLB/1.376 tri/79.208 B; atlas 2×2 PC 512×512 y móvil 256×256; par 170.924/59.020 B, total nuevo por dispositivo 250.132/138.228 B. Ocho QA PC/móvil/low y fallos: sin errores de página/juego/GL, programas enlazados. Sin RNG, mutación de props ni cambios de collider. Backend de generación y bake normal certificado pendientes; sin FPS físico ni publicación.';
  data.revision++;
  data.updatedAt = new Date().toISOString();
  const temp = `${file}.${process.pid}.shrubs.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Catalog changed concurrently; retain the newer revision');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  console.log(`Shrub registered: revision ${data.revision}, ${data.rows.length} rows.`);
}
