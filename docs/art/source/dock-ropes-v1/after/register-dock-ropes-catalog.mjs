// Register S16 only after runtime evidence and immutable source snapshots validate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const paths = {
  brief: 'docs/briefs/visual-s16-dock-ropes.md',
  report: 'docs/delivery/dock-ropes-v1.md',
  runtime: 'docs/art/dock-ropes/runtime-evidence-v1.json',
  snapshot: 'docs/art/source/dock-ropes-v1/source-snapshot.json',
  preview: 'docs/art/dock-ropes/desktop-coil-after-v1.png',
};
const views = ['overview', 'wrap', 'coil'];
const beforeDevices = ['desktop', 'mobile', 'low'];
const afterDevices = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-rope', 'portrait'];
const screenshotPath = (device, view, phase) => `docs/art/dock-ropes/${device}-${view}-${phase}-v1.png`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const artifact = (label, artifactPath, role) => ({ label, path: artifactPath, ...(role ? { role } : {}) });
const normalize = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exists = relative => fs.existsSync(path.join(root, relative));

export function validateSources() {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, paths.snapshot), 'utf8'));
  assert(receipt.schema === 1 && receipt.family === 'dock-ropes-v1' && Array.isArray(receipt.files), 'Recibo S16 inválido.');
  const reusedAssets = [
    { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1.webp' },
    { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1-mobile.webp' },
  ].map(item => {
    const bytes = fs.readFileSync(path.join(root, item.path));
    return { ...item, bytes: bytes.length, sha256: hash(bytes) };
  });
  assert(normalize(receipt.reusedAssets) === normalize(reusedAssets), 'Hashes de atlas reutilizados no coinciden con el recibo S16.');
  const expected = [
    ['before', 'src/render/props.js', 'docs/art/source/dock-ropes-v1/before/props.source.js'],
    ...['src/render/props.js', 'src/render/dockRopes.js', 'tests/dock-ropes.test.mjs', 'tools/qa-dock-ropes.playwright.js',
      'tools/prepare-dock-ropes-sources.mjs', 'tools/register-dock-ropes-catalog.mjs', 'tools/verify-dock-ropes-catalog.mjs']
      .map(source => ['after', source, `docs/art/source/dock-ropes-v1/after/${path.basename(source)}`]),
  ];
  assert(normalize(receipt.files.map(({ phase, source, snapshot }) => [phase, source, snapshot])) === normalize(expected), 'Alcance del recibo S16 inesperado.');
  for (const item of receipt.files) {
    assert(item.snapshot.startsWith('docs/art/source/'), `Snapshot fuera de docs/art/source: ${item.snapshot}`);
    const bytes = fs.readFileSync(path.join(root, item.snapshot));
    assert(bytes.length === item.bytes && hash(bytes) === item.sha256, `Snapshot histórico inválido: ${item.snapshot}`);
  }
  return receipt;
}

export function validateRuntime() {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, paths.runtime), 'utf8'));
  assert(evidence.schema === 1 && evidence.family === 'dock-ropes-v1', 'Runtime evidence S16 inválido.');
  const sharedAssets = ['assets/textures/raft/comic-materials-v1.webp', 'assets/textures/raft/comic-materials-v1-mobile.webp'];
  for (const relative of sharedAssets) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert(bytes.length > 0, `Atlas reutilizado vacío: ${relative}`);
  }
  assert(Array.isArray(evidence.before) && evidence.before.length === beforeDevices.length, 'Casos before incompletos.');
  assert(Array.isArray(evidence.after) && evidence.after.length === afterDevices.length, 'Casos after incompletos.');
  const cases = [...evidence.before, ...evidence.after];
  const expectedPairs = [...beforeDevices.map(device => `before:${device}`), ...afterDevices.map(device => `after:${device}`)].sort();
  assert(normalize(cases.map(item => `${item.phase}:${item.device}`).sort()) === normalize(expectedPairs), 'Casos runtime duplicados o inesperados.');
  const requestPath = request => {
    const raw = typeof request === 'string' ? request : request.url;
    try { return new URL(raw, 'http://localhost').pathname; } catch { return ''; }
  };
  const ropeTexturePath = device => ['mobile', 'low', 'portrait'].includes(device)
    ? '/assets/textures/raft/comic-materials-v1-mobile.webp' : '/assets/textures/raft/comic-materials-v1.webp';
  const expectedRopes = { family: 'dock-ropes-v1', wraps: 8, coils: 2,
    coilCenters: [{ x: -1.24, z: 4 }, { x: 1.24, z: 29.949030993194196 }], triangles: 4160,
    mapped: true, texturesAdded: 0, atlas: 'tex:raft-comic-v1' };
  const stateFor = item => item.views[0].state.dockRopes;
  const sameRopeMeta = value => {
    if (value === null) return false;
    const copy = { ...value }; delete copy.mapped; delete copy.atlas;
    const expected = { ...expectedRopes }; delete expected.mapped; delete expected.atlas;
    return normalize(copy) === normalize(expected);
  };
  const allowedConsoleError = (error, item) => {
    const url = error.location?.url || '';
    if (/favicon\.ico$/.test(url) && /404/i.test(error.text || '')) return true;
    return item.device === 'missing-rope' && item.phase === 'after' &&
      url === 'http://127.0.0.1:5192/assets/textures/raft/comic-materials-v1.webp' && /404|failed/i.test(error.text || '');
  };
  for (const item of cases) {
    assert(item.phase === 'before' || item.phase === 'after', `Fase inválida: ${item.phase}`);
    assert(Array.isArray(item.errors) && item.errors.length === 0, `Errores runtime en ${item.device}/${item.phase}.`);
    assert(Array.isArray(item.consoleErrors) && item.consoleErrors.every(error => allowedConsoleError(error, item)), `Errores de consola en ${item.device}/${item.phase}.`);
    assert(Array.isArray(item.views) && item.views.length === 3 && normalize(item.views.map(view => view.name).sort()) === normalize([...views].sort()), `Vistas incompletas en ${item.device}/${item.phase}.`);
    assert(Array.isArray(item.meshes) && item.meshes.length > 0, `Mallas no registradas: ${item.device}/${item.phase}.`);
    assert(item.mapProps && item.dock, `Faltan datos de mapa/muelle: ${item.device}/${item.phase}.`);
    for (const view of item.views) {
      assert(view.state && view.state.glError === 0 && view.state.programsLinked === true &&
      view.state.gameErrors && Object.keys(view.state.gameErrors).length === 0 && Array.isArray(view.state.assetErrors) &&
      view.state.assetErrors.length === (item.device === 'missing-rope' && item.phase === 'after' ? 1 : 0) &&
      (item.device !== 'missing-rope' || item.phase !== 'after' || view.state.assetErrors[0] === 'tex:raft-comic-v1: [object Event]'),
      `Estado de vista no válido en ${item.device}/${view.name}/${item.phase}.`);
    const ropeState = view.state.dockRopes;
    const fallback = item.device === 'disabled' || item.device === 'missing-rope';
    if (item.phase === 'before') {
      assert(ropeState?.mesh === null, `Rope mesh presente antes de S16: ${item.device}/${view.name}.`);
      assert(ropeState.atlas && ropeState.atlas.src === ropeTexturePath(item.device).replace('/assets/', '') &&
        ropeState.atlas.width === (['mobile', 'low', 'portrait'].includes(item.device) ? 512 : 1024) &&
        ropeState.atlas.height === ropeState.atlas.width && ropeState.atlas.colorSpace === 'srgb' &&
        ropeState.atlas.shared === false && typeof ropeState.atlas.textureRef === 'string', `Atlas base before inesperado: ${item.device}/${view.name}.`);
    }
    else {
      assert(ropeState && ropeState.mesh && ropeState.mesh.family === 'dock-ropes-v1' && ropeState.mesh.wraps === 8 && ropeState.mesh.coils === 2 &&
        normalize(ropeState.mesh.coilCenters) === normalize(expectedRopes.coilCenters) && ropeState.mesh.triangles === 4160 &&
        ropeState.mesh.mapped === !fallback && ropeState.mesh.texturesAdded === 0 &&
        ropeState.mesh.atlas === (fallback ? null : 'tex:raft-comic-v1'),
        `userData dockRopes incorrecto: ${item.device}/${view.name}.`);
      assert(Number.isInteger(ropeState.mesh.attributeBytes) && ropeState.mesh.attributeBytes === 83712 &&
        Number.isInteger(ropeState.mesh.indexBytes) && ropeState.mesh.indexBytes === 24960 &&
        typeof ropeState.mesh.geometry === 'string' && typeof ropeState.mesh.material === 'string', `Buffers/UUID dockRopes incorrectos: ${item.device}/${view.name}.`);
    }
    if (fallback) assert(ropeState?.atlas === null && ropeState.mesh?.mapped === false, `Fallback S16 inválido: ${item.device}/${view.name}.`);
    else if (item.phase === 'after') {
      assert(ropeState?.atlas && ropeState.atlas.src === ropeTexturePath(item.device).replace('/assets/', '') &&
        ropeState.atlas.width === (['mobile', 'low', 'portrait'].includes(item.device) ? 512 : 1024) &&
        ropeState.atlas.height === ropeState.atlas.width && ropeState.atlas.colorSpace === 'srgb' &&
        ropeState.atlas.shared === true && typeof ropeState.atlas.textureRef === 'string', `Atlas compartido/resolución incorrectos: ${item.device}/${view.name}.`);
    }
    }
    assert(Array.isArray(item.requests), `Solicitudes no registradas: ${item.device}/${item.phase}.`);
    const ropeAtlas = item.requests.map(requestPath).filter(url => /\/assets\/textures\/raft\/comic-materials-v1(?:-mobile)?\.webp$/.test(url));
    const expectedCount = item.device === 'disabled' ? 0 : 1;
    assert(ropeAtlas.length === expectedCount, `Conteo de solicitudes del atlas compartido incorrecto: ${item.device}/${item.phase}.`);
    if (expectedCount) assert(ropeAtlas[0] === ropeTexturePath(item.device), `URL de atlas incorrecta: ${item.device}/${item.phase}.`);
    if (item.device === 'missing-rope' && item.phase === 'after') assert(ropeAtlas[0] === '/assets/textures/raft/comic-materials-v1.webp', 'La única URL fallida debe ser el atlas PC exacto.');
    if (item.phase === 'after') {
      assert(Array.isArray(item.transitions) && item.transitions.length === 4 &&
        normalize(item.transitions.map(transition => transition.tier)) === normalize(['high', 'low', 'medium', 'high']), `Transiciones de calidad incompletas: ${item.device}.`);
      const initial = stateFor(item);
      for (const transition of item.transitions) {
        const missing = item.device === 'missing-rope';
        assert(transition.glError === 0 && transition.programsLinked === true &&
          transition.gameErrors && Object.keys(transition.gameErrors).length === 0 &&
          normalize(transition.assetErrors) === normalize(missing ? ['tex:raft-comic-v1: [object Event]'] : []),
          `Estado GPU inválido al cambiar calidad: ${item.device}/${transition.tier}.`);
        assert(normalize(transition.dockRopes) === normalize(initial),
          `Metadatos, atlas o buffers cambiaron con calidad: ${item.device}/${transition.tier}.`);
        assert(transition.reused === true && transition.dockRopes?.mesh?.geometry === initial.mesh.geometry &&
          transition.dockRopes?.mesh?.material === initial.mesh.material && transition.dockRopes?.atlas?.textureRef === initial.atlas?.textureRef,
          `Cambio de calidad reemplazó recursos: ${item.device}/${transition.tier}.`);
      }
    }
  }
  for (const device of beforeDevices) {
    const before = evidence.before.find(item => item.device === device);
    const after = evidence.after.find(item => item.device === device);
    assert(normalize(before.mapProps) === normalize(after.mapProps) && normalize(before.dock) === normalize(after.dock), `Mapa o muelle cambió en ${device}.`);
    assert(before.ropes === null && sameRopeMeta(after.ropes), `Metadatos de cuerda seleccionados inesperados: ${device}.`);
    assert(before.meshes.every(mesh => mesh.rope !== true) && after.meshes.filter(mesh => mesh.rope === true).length === 1 &&
      after.meshes.find(mesh => mesh.rope === true).name === 'dockRopes', `Malla dockRopes ausente/duplicada en ${device}.`);
    const oldProps = before.meshes;
    const newProps = after.meshes.filter(mesh => mesh.rope !== true);
    const normalizeOld = mesh => {
      const copy = { ...mesh };
      if (mesh.animated) { delete copy.attributes; delete copy.matrix; }
      return copy;
    };
    assert(normalize(oldProps.map(normalizeOld)) === normalize(newProps.map(normalizeOld)), `Cambió geometría, atributos, índice, shader o matrices preexistentes en ${device}.`);
    for (const name of views) {
      const oldView = before.views.find(view => view.name === name);
      const newView = after.views.find(view => view.name === name);
      assert(normalize(oldView.state.camera) === normalize(newView.state.camera), `La cámara cambió en ${device}/${name}.`);
    }
  }
  const baseline = cases[0];
  for (const item of cases) {
    assert(normalize(item.mapProps) === normalize(baseline.mapProps) && normalize(item.dock) === normalize(baseline.dock),
      `Mapa/muelle difiere entre casos: ${item.device}/${item.phase}.`);
  }
  const afterMeta = evidence.after[0].ropes;
  assert(sameRopeMeta(afterMeta), 'Metadatos de cuerda S16 inesperados.');
  for (const item of evidence.after) assert(sameRopeMeta(item.ropes), `Metadatos seleccionados difieren: ${item.device}.`);
  for (const phase of ['before', 'after']) for (const device of phase === 'before' ? beforeDevices : afterDevices) {
    for (const view of views) assert(exists(screenshotPath(device, view, phase)), `Falta captura ${screenshotPath(device, view, phase)}.`);
  }
  assert(exists(paths.preview), `Falta preview ${paths.preview}.`);
  return evidence;
}

export function validateDockRopesEvidence() {
  return { snapshot: validateSources(), runtime: validateRuntime() };
}

function registerCatalog() {
const { snapshot, runtime } = validateDockRopesEvidence();
for (const relative of [paths.brief, paths.report, paths.runtime, paths.snapshot, paths.preview]) assert(exists(relative), `Falta artefacto S16: ${relative}`);
const beforeBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(beforeBytes.toString('utf8'));
assert(Array.isArray(catalog.rows), 'Catálogo sin rows[].');
const existing = catalog.rows.find(row => row.id === 'muelle-cuerdas-v1');
const linkedFiles = snapshot.files.map(item => artifact(`Fuente congelada ${item.phase} · ${item.source}`, item.snapshot, 'source'));
const reusedTextureArtifact = (label, relative, role) => {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { ...artifact(label, relative, role), bytes: bytes.length, sha256: hash(bytes) };
};
const shots = [...runtime.before, ...runtime.after].flatMap(item => item.views.map(view => artifact(`Captura · ${item.device} · ${view.name} · ${item.phase}`,
  screenshotPath(item.device, view.name, item.phase), 'evidence')));
const desired = {
  id: 'muelle-cuerdas-v1', name: 'Cuerdas del muelle', category: 'Kit portuario', priority: 'P0', kind: 'object',
  description: 'Cuerdas enrolladas y amarres ilustrados sobre postes y bordes de cubierta del muelle.',
  variants: ['amarres en postes', 'rollos en bordes de cubierta'],
  destination: ['src/render/dockRopes.js', 'src/render/props.js'], state: 'applied',
  nextStep: 'Ajuste artístico y rendimiento en dispositivos físicos pendientes.',
  notes: 'S16: vueltas cosméticas sobre postes de muelle existentes y dos rollos en bordes de cubierta; reutiliza raft-comic-v1 para escritorio y móvil, sin textura nueva. La geometría de props preexistentes permanece idéntica.',
  references: [artifact('Preview S16 · rollo de cubierta · escritorio', paths.preview, 'preview'), artifact('Brief S16 · alcance y reutilización', paths.brief, 'reference')],
  files: [artifact('Recibo de snapshots de fuente S16', paths.snapshot, 'source'), ...linkedFiles,
    reusedTextureArtifact('Atlas compartido PC · raft-comic-v1', 'assets/textures/raft/comic-materials-v1.webp', 'albedo'),
    reusedTextureArtifact('Atlas compartido móvil · raft-comic-v1', 'assets/textures/raft/comic-materials-v1-mobile.webp', 'mobile')],
  evidence: [artifact('Entrega local S16', paths.report, 'report'), artifact('Runtime S16 · vistas, atlas y equivalencia', paths.runtime, 'runtime'), ...shots],
};
if (existing) {
  assert(normalize(existing) === normalize(desired), 'muelle-cuerdas-v1 ya existe con contenido distinto; no se repara automáticamente.');
  console.log(`S16 ya registrado sin cambios: revisión ${catalog.revision}; las filas existentes se conservaron.`);
} else {
  const originalRows = catalog.rows.map(row => JSON.stringify(row));
  catalog.rows.push(desired);
  assert(originalRows.every((row, index) => JSON.stringify(catalog.rows[index]) === row), 'La preparación alteró una fila previa.');
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.dock-ropes.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(beforeBytes)) throw new Error('El catálogo cambió en paralelo; conserva la revisión nueva.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  console.log(`S16 registrado: revisión ${catalog.revision}; Cuerdas del muelle aplicada (${runtime.before.length + runtime.after.length} casos runtime).`);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) registerCatalog();
