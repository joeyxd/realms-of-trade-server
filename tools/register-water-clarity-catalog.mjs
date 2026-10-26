// Register S11 on the two existing water rows after runtime and source evidence are complete.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(catalogPath);
const catalog = JSON.parse(before);
const report = 'docs/delivery/water-clarity-v1.md';
const brief = 'docs/briefs/visual-s11-water-clarity.md';
const runtime = 'docs/art/water-clarity/runtime-evidence-v1.json';
const snapshotPath = 'docs/art/source/water-clarity-v1/final/source-snapshot.json';
const beforeDevices = ['desktop', 'mobile', 'low'];
const afterDevices = ['desktop', 'mobile', 'low', 'disabled', 'night', 'portrait'];
const views = [
  ['map', 'Mapa de costa y agua'],
  ['close', 'Detalle de costa y fondo'],
  ['deep', 'Lectura de agua profunda'],
];
const shots = [
  ...beforeDevices.flatMap((device) => views.map(([view, label]) => ({
    path: `docs/art/water-clarity/${device}-${view}-before-v1.png`,
    label: `${label} · antes · ${device}`,
  }))),
  ...afterDevices.flatMap((device) => views.map(([view, label]) => ({
    path: `docs/art/water-clarity/${device}-${view}-after-v1.png`,
    label: `${label} · después · ${device}`,
  }))),
];
const artifact = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const previewPaths = [
  'docs/art/water-clarity/desktop-close-after-v1.png',
  'docs/art/water-clarity/desktop-map-after-v1.png',
  'docs/art/water-clarity/desktop-deep-after-v1.png',
];
const previews = previewPaths.map((relative) => {
  const shot = shots.find((entry) => entry.path === relative);
  return artifact(shot.label, relative, 'preview');
});
const sourceReceipt = artifact('Recibo de snapshot inmutable S11', snapshotPath, 'source');

for (const relative of [report, brief, runtime, snapshotPath, ...shots.map((shot) => shot.path)]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Falta evidencia S11: ${relative}`);
}
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const runtimeData = readJson(runtime);
if (!runtimeData || typeof runtimeData !== 'object' || Array.isArray(runtimeData) || runtimeData.cut !== 'S11') {
  throw new Error('La evidencia runtime debe corresponder al corte S11');
}
if (!Array.isArray(runtimeData.before) || !Array.isArray(runtimeData.after) ||
  runtimeData.before.length !== 3 || runtimeData.after.length !== 6) {
  throw new Error('S11 runtime debe contener exactamente tres casos before y seis after');
}
const allowedFavicon404 = (error) => error.location?.url?.endsWith('/favicon.ico') && /\b404\b/.test(error.text || '');
const emptyErrors = (value) => (Array.isArray(value) || (value && typeof value === 'object')) && Object.keys(value).length === 0;
const transitionTiers = ['high', 'low', 'medium', 'high'];
const validAfterTransitions = (transitions) => transitions.length === transitionTiers.length &&
  transitions.every((item, index) => {
    const tier = transitionTiers[index];
    const low = tier === 'low';
    return item.tier === tier && item.quality === tier && item.reused === true &&
      item.mode === (low ? 'simple' : 'screen-refraction') && item.terrainCaustics === (low ? 1 : 0) &&
      emptyErrors(item.errors) && item.glError === 0 && item.programsLinked === true &&
      Array.isArray(item.consoleErrors ?? []) && (item.consoleErrors || []).every(allowedFavicon404);
  });
for (const [phase, devices, entries] of [
  ['before', beforeDevices, runtimeData.before],
  ['after', afterDevices, runtimeData.after],
]) {
  if (entries.some((entry) => entry.phase !== phase) || new Set(entries.map((entry) => entry.device)).size !== devices.length ||
    devices.some((device) => !entries.some((entry) => entry.device === device))) {
    throw new Error(`La matriz runtime ${phase} no coincide con sus dispositivos requeridos`);
  }
  for (const device of devices) {
    const entry = entries.find((item) => item.device === device);
    if (!entry || !Array.isArray(entry.errors) || !Array.isArray(entry.consoleErrors) ||
      (phase === 'after' && (!emptyErrors(entry.errors) || entry.consoleErrors.some((error) => !allowedFavicon404(error)))) ||
    !Array.isArray(entry.views) || !views.every(([name]) => {
      const view = entry.views.find((candidate) => candidate.name === name);
      const state = view?.state;
        return Boolean(view && state && emptyErrors(state.errors) &&
        state.glError === 0 && state.programsLinked === true);
      }) || !Array.isArray(entry.transitions) ||
      (phase === 'after' && !validAfterTransitions(entry.transitions))) {
    throw new Error(`S11 QA ${phase} no pasa en ${device}: errores, vistas, shaders o transiciones incompletos`);
    }
  }
}

const snapshot = readJson(snapshotPath);
if (!Array.isArray(snapshot.files) || snapshot.files.length < 4 || snapshot.files.some((entry) =>
  !entry.source || !entry.snapshot || !['before', 'after'].includes(entry.phase) || !Number.isInteger(entry.bytes) ||
  !/^[a-f0-9]{64}$/i.test(entry.sha256 || ''))) {
  throw new Error('El recibo S11 debe listar files con source, snapshot, phase, bytes y SHA-256');
}
const sourceHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
for (const entry of snapshot.files) {
  const snapshotFile = path.join(root, entry.snapshot);
  const sourceFile = path.join(root, entry.source);
  if (!fs.existsSync(snapshotFile)) throw new Error(`Falta snapshot de fuente S11: ${entry.snapshot}`);
  if (!fs.existsSync(sourceFile)) throw new Error(`Falta fuente S11: ${entry.source}`);
  const bytes = fs.readFileSync(snapshotFile);
  if (bytes.length !== entry.bytes || sourceHash(bytes) !== entry.sha256.toLowerCase()) {
    throw new Error(`El snapshot no coincide con el recibo S11: ${entry.snapshot}`);
  }
}
for (const phase of ['before', 'after']) {
  for (const source of ['src/render/water.js', 'src/render/terrain.js']) {
    if (!snapshot.files.some((entry) => entry.phase === phase && entry.source === source)) {
      throw new Error(`El recibo S11 no incluye ${phase}/${source}`);
    }
  }
}
const sourceFiles = [sourceReceipt, ...snapshot.files.map((entry) =>
  artifact(`Fuente S11 · ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'))];
const visualEvidence = shots.map((shot) => artifact(shot.label, shot.path));
const evidence = [
  artifact('Entrega S11', report),
  artifact('Matriz runtime S11', runtime),
  ...visualEvidence,
];
const requiredReferences = [
  artifact('Brief S11 · contrato y reutilización', brief, 'reference'),
  artifact('Plan visual del puerto', 'PLAN-VISUAL-PORT.md', 'reference'),
  artifact('Entrega S10 · lectura de algas someras', 'docs/delivery/seaweed-v1.md', 'reference'),
];
for (const item of requiredReferences) {
  if (!fs.existsSync(path.join(root, item.path))) throw new Error(`Falta referencia S11: ${item.path}`);
}

const specifications = [
  {
    id: 'm11-mar-espuma',
    name: 'Mar y espuma',
    description: 'Agua turquesa ilustrada con espuma costera más fina y discontinua, cáusticas suaves y refracción contenida.',
    destination: ['src/render/waterDetail.js', 'src/render/water.js', 'src/render/terrain.js', 'src/render/pipeline.js', 'src/render/scene.js'],
    notes: 'S11 calibra el agua existente: espuma más fina y rota, cáusticas más ligeras y refracción reducida de 0.035 a 0.02. Reutiliza las texturas de ruido/olas y comparte los controles entre SSR y simple; la calidad baja conserva sus cáusticas en terreno. No añade mapas, modelos ni geometría. Las vistas mapa/cerca/profunda se revisaron en escritorio, móvil emulado, low, disabled, noche y retrato; las matrices before/after conservan sus propias transiciones y errores. La validación de cambios de calidad se registra aparte de las vistas estables. FPS físico, ajuste fino con el autor y publicación pendientes.',
  },
  {
    id: 'fondo-marino',
    name: 'Fondo marino',
    description: 'Fondo somero turquesa y profundidad azul con cáusticas más suaves y detalle legible bajo la superficie.',
    destination: ['src/render/waterDetail.js', 'src/render/water.js', 'src/render/terrain.js', 'src/render/pipeline.js', 'src/render/scene.js'],
    notes: 'S11 ajusta los controles de cáustica compartidos por agua SSR y cáusticas de terreno en low, y reduce la refracción existente de 0.035 a 0.02. Conserva las posiciones y sustratos submarinos de S10 para que las algas se lean mejor; no cambia terreno, vegetación, geometría ni simulación. Reutiliza texturas existentes; no importa candidatos Unreal. Capturas y QA local cubren seis modos/dispositivos; la evidencia de transiciones conserva sus resultados before/after. FPS físico, aceptación artística final y publicación pendientes.',
  },
];
const merge = (row, field, additions) => {
  row[field] ??= [];
  if (!Array.isArray(row[field])) throw new Error(`Catálogo ${field} no es una lista`);
  for (const item of additions) {
    const index = row[field].findIndex((entry) => entry.path === item.path);
    if (index < 0) row[field].push(item);
    else row[field][index] = { ...row[field][index], ...item };
  }
};
const allLinks = [...sourceFiles, ...requiredReferences, ...previews, ...evidence];
const linked = (row, item) => [...(row.files || []), ...(row.references || []), ...(row.evidence || [])]
  .some((entry) => entry.path === item.path);
let changed = false;
for (const spec of specifications) {
  const row = catalog.rows.find((entry) => entry.id === spec.id);
  if (!row || row.name !== spec.name) throw new Error(`No existe la fila S11 esperada: ${spec.id}`);
  if (row.state === 'applied') {
    if (!allLinks.every((item) => linked(row, item)) || row.description !== spec.description ||
      !spec.destination.every((file) => row.destination?.includes(file)) ||
      JSON.stringify(row.references.slice(0, previews.length).map((item) => item.path)) !== JSON.stringify(previewPaths)) {
      throw new Error(`La fila ${spec.id} ya aplicada no coincide con el registro S11; revisar manualmente`);
    }
    continue;
  }
  if (row.state !== 'pending') throw new Error(`La fila ${spec.id} tiene estado inesperado: ${row.state}`);
  row.description = spec.description;
  row.destination = spec.destination;
  row.notes = spec.notes;
  row.nextStep = 'Revisar lectura cromática fina y rendimiento en hardware físico; publicación pendiente.';
  row.files ??= [];
  row.references ??= [];
  row.evidence ??= [];
  merge(row, 'files', sourceFiles);
  merge(row, 'references', [...previews, ...requiredReferences]);
  row.references = [...previews, ...row.references.filter((entry) => !previews.some((preview) => preview.path === entry.path))];
  merge(row, 'evidence', evidence);
  row.state = 'applied';
  changed = true;
}
const interactionRow = catalog.rows.find((entry) => entry.id === 'vfx-contacto-agua');
if (!interactionRow || interactionRow.state !== 'pending') {
  throw new Error('La fila vfx-contacto-agua debe conservarse pending en este corte S11');
}
if (!changed) {
  console.log(`S11 ya está registrado: revisión ${catalog.revision}.`);
} else {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.water-clarity.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(before)) throw new Error('El catálogo cambió concurrentemente; se conserva la revisión nueva.');
    fs.renameSync(temp, catalogPath);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  console.log(`S11 registrado en las dos filas existentes; revisión ${catalog.revision}, ${catalog.rows.length} filas.`);
}
