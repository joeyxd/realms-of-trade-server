// Verify S11 catalog artifacts against local bytes and the live catalog service.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools/art-catalog/catalog.json'), 'utf8'));
const ids = ['m11-mar-espuma', 'fondo-marino'];
const names = new Map([['m11-mar-espuma', 'Mar y espuma'], ['fondo-marino', 'Fondo marino']]);
const brief = 'docs/briefs/visual-s11-water-clarity.md';
const report = 'docs/delivery/water-clarity-v1.md';
const runtimePath = 'docs/art/water-clarity/runtime-evidence-v1.json';
const snapshotPath = 'docs/art/source/water-clarity-v1/final/source-snapshot.json';
const beforeDevices = ['desktop', 'mobile', 'low'];
const afterDevices = ['desktop', 'mobile', 'low', 'disabled', 'night', 'portrait'];
const views = ['map', 'close', 'deep'];
const expectedDestinations = ['src/render/water.js', 'src/render/terrain.js', 'src/render/scene.js'];
const expectedShots = [
  ...beforeDevices.flatMap((device) => views.map((view) => `docs/art/water-clarity/${device}-${view}-before-v1.png`)),
  ...afterDevices.flatMap((device) => views.map((view) => `docs/art/water-clarity/${device}-${view}-after-v1.png`)),
];
const previewPaths = [
  'docs/art/water-clarity/desktop-close-after-v1.png',
  'docs/art/water-clarity/desktop-map-after-v1.png',
  'docs/art/water-clarity/desktop-deep-after-v1.png',
];
const transitionTiers = ['high', 'low', 'medium', 'high'];
const emptyErrors = (value) => (Array.isArray(value) || (value && typeof value === 'object')) && Object.keys(value).length === 0;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const required = [brief, report, runtimePath, snapshotPath, ...expectedShots];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Falta artefacto S11: ${relative}`);
}

const runtime = readJson(runtimePath);
if (runtime.cut !== 'S11') throw new Error('La evidencia runtime no corresponde a S11');
if (!Array.isArray(runtime.before) || !Array.isArray(runtime.after) || runtime.before.length !== 3 || runtime.after.length !== 6) {
  throw new Error('La evidencia runtime requiere tres casos before y seis after');
}
const allowedFavicon404 = (error) => error.location?.url?.endsWith('/favicon.ico') && /\b404\b/.test(error.text || '');
for (const [phase, devices, entries] of [
  ['before', beforeDevices, runtime.before],
  ['after', afterDevices, runtime.after],
]) {
  if (entries.some((entry) => entry.phase !== phase) || new Set(entries.map((item) => item.device)).size !== devices.length ||
    devices.some((device) => !entries.some((item) => item.device === device))) {
    throw new Error(`La matriz runtime ${phase} no coincide con sus dispositivos requeridos`);
  }
  for (const device of devices) {
    const entry = entries.find((item) => item.device === device);
    if (!entry || !Array.isArray(entry.errors) || !Array.isArray(entry.consoleErrors) ||
      (phase === 'after' && (!emptyErrors(entry.errors) || entry.consoleErrors.some((error) => !allowedFavicon404(error)))) ||
      !Array.isArray(entry.views) || !views.every((name) => {
        const view = entry.views.find((candidate) => candidate.name === name);
        const state = view?.state;
        return Boolean(view && state && emptyErrors(state.errors) && state.glError === 0 && state.programsLinked === true);
      })) {
      throw new Error(`Runtime ${phase} no pasa o está incompleto: ${device}`);
    }
    if (!Array.isArray(entry.transitions)) {
      throw new Error(`Faltan transiciones ${phase} para ${device}`);
    }
    if (phase === 'after') {
      const valid = entry.transitions.length === transitionTiers.length && entry.transitions.every((item, index) => {
        const tier = transitionTiers[index];
        const low = tier === 'low';
        return item.tier === tier && item.quality === tier && item.reused === true &&
          item.mode === (low ? 'simple' : 'screen-refraction') && item.terrainCaustics === (low ? 1 : 0) &&
          emptyErrors(item.errors) && item.glError === 0 && item.programsLinked === true &&
          Array.isArray(item.consoleErrors ?? []) && (item.consoleErrors || []).every(allowedFavicon404);
      });
      if (!valid) throw new Error(`Transiciones after no válidas para ${device}: calidad, reutilización, modo, cáusticas o estado shader`);
    }
  }
}

const snapshot = readJson(snapshotPath);
if (!Array.isArray(snapshot.files) || snapshot.files.length < 4) throw new Error('El recibo S11 no tiene files before/after completos');
const snapshotPaths = [];
for (const entry of snapshot.files) {
  if (!entry.source || !entry.snapshot || !['before', 'after'].includes(entry.phase) || !Number.isInteger(entry.bytes) ||
    !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) {
    throw new Error('Cada file del recibo debe incluir source, snapshot, phase, bytes y SHA-256');
  }
  const snapshotFile = path.join(root, entry.snapshot);
  if (!fs.existsSync(snapshotFile)) throw new Error(`Falta snapshot de fuente: ${entry.snapshot}`);
  const bytes = fs.readFileSync(snapshotFile);
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256.toLowerCase()) {
    throw new Error(`El snapshot de fuente no coincide con su recibo: ${entry.snapshot}`);
  }
  const sourceFile = path.join(root, entry.source);
  if (!fs.existsSync(sourceFile)) throw new Error(`Falta fuente S11: ${entry.source}`);
  snapshotPaths.push(entry.snapshot);
}
for (const phase of ['before', 'after']) {
  for (const source of ['src/render/water.js', 'src/render/terrain.js']) {
    if (!snapshot.files.some((entry) => entry.phase === phase && entry.source === source)) {
      throw new Error(`El recibo S11 no incluye ${phase}/${source}`);
    }
  }
}
const requiredPaths = new Set([
  ...required,
  ...snapshotPaths,
  ...previewPaths,
  'PLAN-VISUAL-PORT.md',
  'docs/delivery/seaweed-v1.md',
]);
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (row?.state !== 'applied' || row.name !== names.get(id)) throw new Error(`Fila S11 no aplicada o cambió de nombre: ${id}`);
  if (!expectedDestinations.every((destination) => row.destination?.includes(destination))) {
    throw new Error(`La fila ${id} no vincula todos los consumidores del agua S11`);
  }
  const artifacts = [...(row.references || []), ...(row.files || []), ...(row.evidence || [])];
  const paths = new Set(artifacts.map((item) => item.path).filter(Boolean));
  for (const relative of requiredPaths) {
    if (!paths.has(relative)) throw new Error(`Falta enlace ${relative} en ${id}`);
  }
  for (const relative of previewPaths) {
    const preview = (row.references || []).find((item) => item.path === relative);
    if (preview?.role !== 'preview') throw new Error(`Preview S11 no destacado en ${id}: ${relative}`);
  }
  if (JSON.stringify(row.references.slice(0, previewPaths.length).map((item) => item.path)) !== JSON.stringify(previewPaths)) {
    throw new Error(`Las tres previews S11 no son las primeras referencias de ${id}`);
  }
}
const interaction = catalog.rows.find((entry) => entry.id === 'vfx-contacto-agua');
if (interaction?.state !== 'pending') throw new Error('vfx-contacto-agua debe seguir pending: este corte no acepta toda su interacción');

const paths = new Set();
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  for (const artifact of [...(row.references || []), ...(row.files || []), ...(row.evidence || [])]) {
    if (artifact.path) paths.add(artifact.path);
  }
}
const base = 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async (relative) => {
  const local = fs.readFileSync(path.join(root, relative));
  const url = `${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} para ${relative}`);
  const remote = Buffer.from(await response.arrayBuffer());
  if (hash(remote) !== hash(local)) throw new Error(`El archivo servido difiere: ${relative}`);
}));
const response = await fetch(`${base}/api/catalog`);
if (!response.ok) throw new Error(`Catálogo activo respondió HTTP ${response.status}`);
const live = await response.json();
if (live.revision !== catalog.revision) throw new Error(`Revisión activa ${live.revision}; local ${catalog.revision}`);
for (const id of ids) {
  const localRow = catalog.rows.find((entry) => entry.id === id);
  const liveRow = live.rows?.find((entry) => entry.id === id);
  if (liveRow?.state !== 'applied' || liveRow.name !== localRow.name || JSON.stringify(liveRow) !== JSON.stringify(localRow)) {
    throw new Error(`El catálogo activo no muestra la fila S11 aplicada: ${id}`);
  }
}
const liveInteraction = live.rows?.find((entry) => entry.id === 'vfx-contacto-agua');
if (liveInteraction?.state !== 'pending') throw new Error('El catálogo activo debe conservar vfx-contacto-agua pending');
console.log(`Catálogo S11 verificado: ${paths.size} enlaces HTTP únicos con SHA-256 exacto; revisión ${live.revision}, dos filas aplicadas.`);
