// Shared preflight for S12 registration and live catalogue verification.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const rockFacesPaths = {
  brief: 'docs/briefs/visual-s12-rock-faces.md',
  report: 'docs/delivery/rock-faces-v1.md',
  runtime: 'docs/art/rock-faces/runtime-evidence-v1.json',
  snapshot: 'docs/art/source/rock-faces-v1/final/source-snapshot.json',
  previews: [
    'docs/art/rock-faces/desktop-interior-after-v1.png',
    'docs/art/rock-faces/desktop-beach-after-v1.png',
    'docs/art/rock-faces/desktop-wet-after-v1.png',
  ],
  beforeDevices: ['desktop', 'mobile', 'low'],
  afterDevices: ['desktop', 'mobile', 'low', 'disabled', 'night', 'portrait'],
  views: ['beach', 'interior', 'wet'],
};
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const isFavicon404 = (error) => error?.location?.url?.endsWith('/favicon.ico') && /\b404\b/.test(error.text || '');
const onlyAllowedErrors = value => Array.isArray(value) && value.every(isFavicon404);
const noErrors = value => value !== null && typeof value === 'object' && Object.keys(value).length === 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const instances = state => state.rocks.flatMap(rock => Array.from({ length: rock.count }, (_, i) => {
  const matrix = rock.matrices.slice(i * 16, (i + 1) * 16);
  if (matrix.length !== 16 || matrix.some(n => !Number.isFinite(n)) || !rock.geometryBytes) throw Error('Incomplete rock instance data');
  return { id: matrix.slice(12, 15).join(','), matrix, geometry: rock.geometryBytes,
    colors: rock.colors?.slice(i * 3, (i + 1) * 3) || null, shader: rock.key, legacy: rock.group.startsWith('volcanicRocks') };
})).sort((a, b) => a.id.localeCompare(b.id));

export function validateRockFacesEvidence(root) {
  const { brief, report, runtime: runtimePath, snapshot: snapshotPath, previews, beforeDevices, afterDevices, views } = rockFacesPaths;
  const runtime = readJson(root, runtimePath);
  if (runtime.cut !== 'S12' || runtime.schema !== 1) throw new Error('La evidencia runtime debe ser S12, schema 1');
  if (!Array.isArray(runtime.before) || runtime.before.length !== beforeDevices.length ||
    !Array.isArray(runtime.after) || runtime.after.length !== afterDevices.length) {
    throw new Error('La evidencia S12 requiere tres casos before y seis after');
  }
  const tiers = ['high', 'low', 'medium', 'high'];
  for (const [phase, devices, entries] of [['before', beforeDevices, runtime.before], ['after', afterDevices, runtime.after]]) {
    if (entries.some((entry) => entry.phase !== phase) || new Set(entries.map((entry) => entry.device)).size !== devices.length ||
      devices.some((device) => !entries.some((entry) => entry.device === device))) throw new Error(`Matriz runtime ${phase} incompleta`);
    for (const device of devices) {
      const entry = entries.find((item) => item.device === device);
      if (!noErrors(entry.errors) || !onlyAllowedErrors(entry.consoleErrors)) {
        throw new Error(`Errores runtime no admitidos: ${phase}/${device}`);
      }
      if (!Array.isArray(entry.views) || views.some((name) => {
        const state = entry.views.find((view) => view.name === name)?.state;
        return !state || !noErrors(state.errors) || !noErrors(state.assetErrors) || state.glError !== 0 || state.programsLinked !== true;
      })) throw new Error(`Vistas, GL o enlaces shader incompletos: ${phase}/${device}`);
      if (!Array.isArray(entry.transitions)) throw new Error(`Faltan transiciones: ${phase}/${device}`);
      if (phase === 'after' && (entry.transitions.length !== tiers.length || entry.transitions.some((item, index) =>
        item.tier !== tiers[index] || item.quality !== tiers[index] || item.reused !== true || item.glError !== 0 ||
        item.programsLinked !== true || !noErrors(item.errors) || !Array.isArray(item.consoleErrors ?? []) ||
        !onlyAllowedErrors(item.consoleErrors ?? [])))) {
        throw new Error(`Transiciones after inválidas en ${device}: se requieren cuatro tiers reutilizados sin errores`);
      }
    }
  }
  if (runtime.after.length * tiers.length !== 24) throw new Error('La cobertura de tiers after debe sumar 24 casos');
  for (const key of ['verified', 'exactProps', 'geometry', 'matrices', 'colors', 'legacyShader']) {
    if (runtime.invariants?.[key] !== true) throw new Error(`Invariante de equivalencia no verificada: ${key}`);
  }
  if (Object.values(runtime.invariants).some((value) => typeof value === 'boolean' && value !== true)) {
    throw new Error('Las invariantes no pueden contener resultados booleanos falsos');
  }
  // Recompute equivalence from captured arrays and geometry hashes rather than trusting flags.
  for (const after of runtime.after) {
    if (!same(after.views[0].state.rockProps, runtime.before[0].views[0].state.rockProps)) throw Error('World rock props changed');
  }
  for (const device of beforeDevices) {
    const before = runtime.before.find(c => c.device === device).views[0].state;
    const after = runtime.after.find(c => c.device === device).views[0].state;
    const a = instances(before), b = instances(after);
    if (a.length !== b.length || a.some((entry, i) => !same(entry.matrix, b[i].matrix) ||
      !same(entry.geometry, b[i].geometry) || !same(entry.colors, b[i].colors) ||
      (b[i].legacy && entry.shader !== b[i].shader))) throw Error('Captured rock geometry, transform, color or legacy shader changed');
  }

  const snapshot = readJson(root, snapshotPath);
  if (!Array.isArray(snapshot.files) || snapshot.files.length < 8) throw new Error('El recibo S12 debe incluir al menos ocho fuentes verificadas');
  const required = [
    ['before', 'src/render/vegetation.js'],
    ['after', 'src/render/vegetation.js'],
    ['after', 'src/render/rockMaterials.js'],
  ];
  for (const [phase, source] of required) if (!snapshot.files.some((entry) => entry.phase === phase && entry.source === source)) {
    throw new Error(`Falta recibo ${phase}/${source}`);
  }
  if (snapshot.files.some((entry) => entry.phase === 'before' && entry.source !== 'src/render/vegetation.js')) {
    throw new Error('El único snapshot before permitido es vegetation.js');
  }
  for (const entry of snapshot.files) {
    if (!entry.source || !entry.snapshot || !['before', 'after'].includes(entry.phase) || !Number.isInteger(entry.bytes) ||
      !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')) throw new Error('Recibo de fuente S12 incompleto');
  }
  const legacyPaint = phase => {
    const file = snapshot.files.find(entry => entry.phase === phase && entry.source === 'src/render/vegetation.js');
    const text = fs.readFileSync(path.join(root, file.snapshot), 'utf8').replace(/\r/g, '');
    const block = text.match(/const ROCK_INK = \{[\s\S]*?\n\};/);
    if (!block) throw Error('Missing legacy rock shader snapshot');
    return block[0];
  };
  if (legacyPaint('before') !== legacyPaint('after')) throw Error('Legacy volcanic paint changed');
  const afterSources = snapshot.files.filter((entry) => entry.phase === 'after').map((entry) => entry.source.toLowerCase());
  for (const marker of ['rockmaterials.js', 'vegetation.js', 'qa', 'test', 'prepare', 'register', 'verify', 'rock-faces-evidence.mjs']) {
    if (!afterSources.some((source) => source.includes(marker))) throw new Error(`Falta fuente after para ${marker}`);
  }
  for (const entry of snapshot.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256.toLowerCase()) throw new Error(`Hash/bytes del snapshot no coincide: ${entry.snapshot}`);
    if (!fs.existsSync(path.join(root, entry.source))) throw new Error(`Falta fuente registrada: ${entry.source}`);
  }
  const screenshots = [
    ...beforeDevices.flatMap((device) => views.map((view) => `docs/art/rock-faces/${device}-${view}-before-v1.png`)),
    ...afterDevices.flatMap((device) => views.map((view) => `docs/art/rock-faces/${device}-${view}-after-v1.png`)),
  ];
  const artifactPaths = [brief, report, runtimePath, snapshotPath, ...previews, ...screenshots, ...snapshot.files.map((entry) => entry.snapshot)];
  for (const relative of new Set(artifactPaths)) if (!fs.existsSync(path.join(root, relative))) throw new Error(`Falta evidencia S12: ${relative}`);
  return { runtime, snapshot, screenshots, requiredLinks: new Set(artifactPaths) };
}
