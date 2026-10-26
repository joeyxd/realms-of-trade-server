// Register S13 dock planks only after runtime evidence and source receipts exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const paths = {
  brief: 'docs/briefs/visual-s13-dock-wood.md',
  report: 'docs/delivery/dock-wood-v1.md',
  runtime: 'docs/art/dock-wood/runtime-evidence-v1.json',
  snapshot: 'docs/art/source/dock-wood-v1/final/source-snapshot.json',
  previews: [
    'docs/art/dock-wood/desktop-detail-after-v1.png',
    'docs/art/dock-wood/mobile-detail-after-v1.png',
    'docs/art/dock-wood/desktop-overview-after-v1.png',
  ],
};
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const artifact = (label, artifactPath, role) => ({ label, path: artifactPath, ...(role ? { role } : {}) });

function validateSnapshot() {
  const receipt = readJson(paths.snapshot);
  assert(receipt.family === 'dock-wood-v1' && Array.isArray(receipt.files) && receipt.files.length === 8, 'Recibo S13 incompleto.');
  for (const [phase, source] of [['before', 'src/render/props.js'],
    ...['src/render/props.js', 'src/render/dockWood.js', 'tools/qa-dock-wood.playwright.js',
      'tests/dock-wood.test.mjs', 'tools/prepare-dock-wood-sources.mjs',
      'tools/register-dock-wood-catalog.mjs', 'tools/verify-dock-wood-catalog.mjs'].map(source => ['after', source])]) {
    assert(receipt.files.filter(e => e.phase === phase && e.source === source).length === 1, `Falta fuente ${phase}: ${source}`);
  }
  for (const entry of receipt.files) {
    assert(['before', 'after'].includes(entry.phase), `Fase de fuente inválida: ${entry.phase}`);
    assert(typeof entry.source === 'string' && typeof entry.snapshot === 'string' && Number.isInteger(entry.bytes) &&
      /^[a-f0-9]{64}$/.test(entry.sha256), 'Falta source/snapshot/bytes/SHA-256 válido en recibo.');
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    assert(bytes.length === entry.bytes, `Bytes históricos incorrectos: ${entry.snapshot}`);
    assert(sha(bytes) === entry.sha256, `SHA-256 histórico incorrecto: ${entry.snapshot}`);
  }
  return receipt;
}

function validateEvidence() {
  const evidence = readJson(paths.runtime);
  assert(evidence.schema === 1 && evidence.family === 'dock-wood-v1', 'Runtime evidence S13 incompatible.');
  const devices = ['desktop', 'mobile', 'low'];
  const afterDevices = ['desktop', 'mobile', 'low', 'disabled', 'night', 'portrait', 'missing'];
  assert(JSON.stringify(evidence.before?.map((x) => x.device)) === JSON.stringify(devices), 'Casos before incompletos o fuera de orden.');
  assert(JSON.stringify(evidence.after?.map((x) => x.device)) === JSON.stringify(afterDevices), 'Casos after incompletos o fuera de orden.');
  assert(JSON.stringify(evidence.equivalence?.map((x) => x.device)) === JSON.stringify(devices), 'Equivalencias incompletas.');
  assert(evidence.invariants && typeof evidence.invariants === 'object', 'Faltan invariantes de runtime.');
  const cases = [...evidence.before, ...evidence.after];
  const normalize = (value) => JSON.stringify(value);
  const errorText = (error) => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.url || error?.location?.url || ''}`;
  const meshRecord = (mesh, isDeck) => {
    const attributes = Object.fromEntries(Object.entries(mesh.attributes || {})
      .filter(([name]) => !(isDeck && name === 'uv'))
      .sort(([a], [b]) => a.localeCompare(b)));
    return { ...(mesh.animated ? { index: mesh.index } : { attributes, index: mesh.index, matrix: mesh.matrix }), triangles: mesh.triangles,
      key: mesh.key, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, normalPass: mesh.normalPass };
  };
  const meshes = (entry) => (entry.meshes || []);
  for (const item of cases) {
    assert(['before', 'after'].includes(item.phase), `phase inválida para ${item.device}`);
    assert(Array.isArray(item.errors) && item.errors.length === 0, `Errores runtime en ${item.device}/${item.phase}.`);
    const consoleErrors = item.consoleErrors || [];
    const allowed404 = item.device === 'missing' && item.phase === 'after'
      ? (error) => /404/i.test(errorText(error)) && ['http://127.0.0.1:5192/favicon.ico', 'http://127.0.0.1:5192/assets/textures/raft/comic-materials-v1.webp'].includes(error.location?.url)
      : (error) => error.location?.url === 'http://127.0.0.1:5192/favicon.ico' && /404/i.test(errorText(error));
    assert(Array.isArray(consoleErrors) && consoleErrors.every(allowed404), `consoleErrors no permitidos en ${item.device}/${item.phase}.`);
    assert(Array.isArray(item.views) && item.views.length === 2 && item.views.every((view) => view.state), `Se requieren dos vistas con state en ${item.device}/${item.phase}.`);
    assert(Array.isArray(item.transitions) && item.transitions.length === 4, `Se requieren cuatro transiciones en ${item.device}/${item.phase}.`);
    for (const view of [...item.views, ...item.transitions]) {
      const state = view.state || view;
      assert(state.glError === 0 && state.programsLinked === true, `WebGL no válido: ${item.device}/${item.phase}/${view.name}.`);
      assert(state.gameErrors && Object.keys(state.gameErrors).length === 0, `Errores de juego en ${item.device}/${item.phase}.`);
      assert(Array.isArray(state.assetErrors) && (item.device === 'missing'
        ? state.assetErrors.length === 1 && state.assetErrors[0].startsWith('tex:raft-comic-v1:')
        : state.assetErrors.length === 0), `Errores de assets inesperados en ${item.device}/${item.phase}.`);
      if (item.phase === 'after' && ['desktop', 'mobile', 'low', 'night', 'portrait'].includes(item.device)) {
        assert(state.deck?.atlasShared === true && state.deck?.mapped === true, `Atlas/reuso no acreditado: ${item.device}/${view.name}.`);
        const width = ['mobile', 'low', 'portrait'].includes(item.device) ? 512 : 1024;
        assert(state.deck?.atlas?.width === width && state.deck?.atlas?.height === width, `Resolución de atlas inesperada: ${item.device}/${view.name}.`);
        assert(typeof state.deck.atlas.src === 'string' && state.deck.atlas.src.endsWith(width === 512 ? 'comic-materials-v1-mobile.webp' : 'comic-materials-v1.webp'), `Atlas seleccionado incorrecto: ${item.device}/${view.name}.`);
      }
      if (['disabled', 'missing'].includes(item.device)) assert(state.deck?.mapped === false && state.deck?.atlas === null, `Falta fallback en ${item.device}.`);
      if (view.tier) assert(view.reused === true, `Transición reemplazó geometry/material: ${item.device}/${view.tier}.`);
    }
    const req = item.requests || [];
    const atlasReq = req.filter((request) => /comic-materials-v1(?:-mobile)?\.webp/.test(request));
    if (item.device === 'disabled') assert(atlasReq.length === 0, 'Disabled debe hacer cero solicitudes de atlas.');
    else {
      assert(atlasReq.length === 1, `Se esperaba una solicitud de atlas en ${item.device}/${item.phase}.`);
      if (item.device !== 'missing') {
        const mobile = ['mobile', 'low', 'portrait'].includes(item.device);
        assert(atlasReq[0].endsWith(mobile ? 'comic-materials-v1-mobile.webp' : 'comic-materials-v1.webp'), `URL de atlas incorrecta en ${item.device}/${item.phase}.`);
      } else assert(atlasReq[0].endsWith('textures/raft/comic-materials-v1.webp'), 'La única URL fallida debe ser el atlas desktop exacto.');
    }
    if (item.device === 'missing') {
      assert(item.phase === 'after' && atlasReq.length === 1, 'Missing debe ser únicamente after con una solicitud.');
    }
  }
  for (const device of devices) {
    const before = cases.find((x) => x.phase === 'before' && x.device === device);
    const after = cases.find((x) => x.phase === 'after' && x.device === device);
    assert(before && after, `Falta par before/after ${device}.`);
    assert(normalize(before.mapProps) === normalize(after.mapProps) && normalize(before.dock) === normalize(after.dock), `Cambió mapa/muelle: ${device}.`);
    const a = meshes(before), b = meshes(after);
    const isDeck = (mesh) => mesh.deck === true;
    const oldProps = a.filter((mesh) => !isDeck(mesh)), newProps = b.filter((mesh) => !isDeck(mesh));
    assert(normalize(oldProps.map((mesh) => mesh.name).sort()) === normalize(newProps.map((mesh) => mesh.name).sort()), `Cambió el conjunto de props estáticos: ${device}.`);
    const records = list => list.map(mesh => ({ name: mesh.name, animated: mesh.animated, record: meshRecord(mesh, false) }));
    assert(normalize(records(oldProps)) === normalize(records(newProps)), `Geometría/matrices/materiales estáticos cambiaron: ${device}.`);
    const deck = b.find(isDeck);
    const oldDeck = a.find(isDeck);
    assert(deck && oldDeck && a.filter(isDeck).length === 1 && b.filter(isDeck).length === 1, `Falta deck único en ${device}.`);
    const deckRecord = mesh => { const record = meshRecord(mesh, true); delete record.key; return record; };
    assert(normalize(deckRecord(oldDeck)) === normalize(deckRecord(deck)), `Geometría/transformación del deck cambió: ${device}.`);
    const reported = evidence.equivalence.find((entry) => entry.device === device);
    assert(reported && ['mapProps', 'dock', 'staticGeometry', 'staticMatrices', 'nonDeckShaders', 'deckGeometry'].every((key) => reported[key] === true),
      `Reporte de equivalencia incompleto: ${device}.`);
    const deckUvBytes = deck.attributes?.uv?.bytes || 0;
    assert(reported.meshCount === b.length && b.length === 27 && reported.deckTriangles === deck.triangles && reported.deckTriangles === 828 &&
      reported.uvBytesAdded === deckUvBytes && deckUvBytes === 19872,
      `Conteos reportados no corresponden a las mallas: ${device}.`);
  }
  for (const key of ['mapProps', 'dock', 'staticGeometry', 'staticMatrices', 'nonDeckShaders', 'deckGeometry', 'sharedAtlas', 'noNewImages']) {
    assert(evidence.invariants[key] === true, `Invariante reportado como falso o ausente: ${key}.`);
  }
  for (const relative of paths.previews) assert(exists(relative), `Falta preview: ${relative}`);
  return evidence;
}

// Validate all evidence before reading the catalogue so a partial registration cannot occur.
const snapshot = validateSnapshot();
const runtime = validateEvidence();
for (const relative of [paths.brief, paths.report, paths.runtime, paths.snapshot, ...paths.previews]) assert(exists(relative), `Falta artefacto S13: ${relative}`);

const beforeBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(beforeBytes.toString('utf8'));
const existing = catalog.rows.find((entry) => entry.id === 'm01-madera-costera');
assert(existing && existing.state === 'applied', 'La fila M01 debe existir y seguir aplicada.');
const added = catalog.rows.find((entry) => entry.id === 'muelle-tablones');
assert(!added || (added.state === 'applied' && added.evidence?.some((entry) => entry.path === paths.report)), 'La fila muelle-tablones ya existe con contenido ajeno.');
const dock = added || {
  id: 'muelle-tablones', name: 'Tablones del muelle', category: 'Kit portuario', kind: 'object', priority: 'P0',
  state: 'applied', description: 'Cubierta de tablones del muelle con madera ilustrada del atlas costero compartido.',
  variants: ['cuatro recortes', 'ocho orientaciones'], destination: ['src/render/dockWood.js', 'src/render/props.js'],
  nextStep: 'Ajuste artístico; kits, postes y soportes siguen pendientes.', notes: '', references: [], files: [], evidence: [],
};
assert(dock.name === 'Tablones del muelle' && dock.category === 'Kit portuario' && ['prop', 'object'].includes(dock.kind) && dock.priority === 'P0', 'Metadatos de fila muelle-tablones incorrectos.');
dock.kind = 'object';
const previewLabels = ['Detalle escritorio', 'Detalle móvil', 'Vista general escritorio'];
const referenceAdds = [...paths.previews.map((p, i) => artifact(previewLabels[i], p, 'preview')),
  artifact('Brief S13 · alcance y reutilización', paths.brief, 'reference')];
const sourceAdds = [artifact('Recibo de snapshots de fuente', paths.snapshot, 'source'),
  ...snapshot.files.map((entry) => artifact(`Snapshot ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'))];
const screenshots = [...runtime.before, ...runtime.after].flatMap(item => item.views.map(view =>
  `docs/art/dock-wood/${item.device}-${view.name}-${item.phase}-v1.png`));
for (const screenshot of screenshots) assert(exists(screenshot), `Falta captura ${screenshot}`);
const evidenceAdds = [artifact('Entrega local S13', paths.report), artifact('Runtime · atlas, fallback y equivalencia', paths.runtime),
  ...screenshots.map(p => artifact(`Captura · ${path.basename(p)}`, p))];
const upsert = (list, additions) => [...(list || []).filter((entry) => !additions.some((item) => item.path === entry.path)), ...additions];
existing.description = 'Tablones pintados, juntas con tinta y veta no fotográfica; atlas compartido aplicado en balsa y cubierta de muelle.';
existing.variants = [...new Set([...(existing.variants || []), 'cubierta de tablones del muelle'])];
existing.destination = [...new Set([...(existing.destination || []), 'src/render/dockWood.js', 'src/render/props.js'])];
existing.nextStep = 'Revisión artística y FPS físicos pendientes; los kits y soportes conservan sus estados.';
const s13Note = 'S13: cubierta de 67 tablones y dos vigas en muelles existentes; reutiliza el atlas de balsa (1024 escritorio/512 táctil), sin texturas nuevas. Kits de piso, postes, vigas estructurales y soportes inferiores siguen pendientes; el alcance cubre solo la cubierta decorativa.';
if (!existing.notes?.includes('S13: cubierta de 67 tablones')) existing.notes = `${existing.notes || ''}${existing.notes ? ' ' : ''}${s13Note}`;
existing.references = upsert(existing.references, referenceAdds);
existing.files = upsert(existing.files.filter(entry => !entry.path.startsWith('docs/art/source/dock-wood-v1/')), sourceAdds);
existing.evidence = upsert(existing.evidence, evidenceAdds);
dock.references = upsert(dock.references, referenceAdds);
dock.files = upsert(dock.files.filter(entry => !entry.path.startsWith('docs/art/source/dock-wood-v1/')), sourceAdds);
dock.evidence = upsert(dock.evidence, evidenceAdds);
if (!added) catalog.rows.push(dock);
for (const id of ['kit-piso', 'kit-poste', 'kit-viga-diagonal', 'muelle-soporte']) {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (row) assert(row.state !== 'applied', `S13 no puede aplicar ${id}.`);
}
const changed = !beforeBytes.equals(Buffer.from(JSON.stringify(catalog, null, 2) + '\n'));
if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.dock-wood.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(beforeBytes)) throw new Error('El catálogo cambió en paralelo; conserva su revisión nueva.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S13 registrado: revisión ${catalog.revision}; M01 extendida y muelle-tablones aplicada (${runtime.before.length + runtime.after.length} casos runtime).`);
