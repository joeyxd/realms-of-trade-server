// Register S17 port cargo after the source receipt and visual evidence are complete.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const paths = {
  brief: 'docs/briefs/visual-s17-port-cargo.md', report: 'docs/delivery/port-cargo-v1.md',
  runtime: 'docs/art/port-cargo/runtime-evidence-v1.json', snapshot: 'docs/art/source/port-cargo-v1/final/source-snapshot.json',
};
const before = ['desktop', 'mobile', 'low'];
const after = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-albedo', 'missing-normal', 'missing-crate', 'portrait'];
const views = ['overview', 'barrel', 'crate'];
const screenshots = [...before.map(device => ({ phase: 'before', device })), ...after.map(device => ({ phase: 'after', device }))]
  .flatMap(({ phase, device }) => views.map(view => `docs/art/port-cargo/${device}-${view}-${phase}-v1.png`));
const reusedAssets = [
  ...['albedo-desktop', 'albedo-mobile', 'normal-desktop', 'normal-mobile'].map(name => `assets/textures/town-wood-v1/atlas-${name}.webp`),
  'assets/models/prop-storage-crate.glb',
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const exists = relative => fs.existsSync(path.join(root, relative));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const artifact = (label, artifactPath, role) => ({ label, path: artifactPath, ...(role ? { role } : {}) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const upsert = (list, additions) => [...(list || []).filter(entry => !additions.some(item => item.path === entry.path)), ...additions];

export function validatePortCargoSnapshot() {
  const receipt = readJson(paths.snapshot);
  const expected = [
    ['before', 'src/render/props.js'],
    ...['src/render/props.js', 'src/render/portCargo.js', 'tests/port-cargo.test.mjs', 'tools/qa-port-cargo.playwright.js',
      'tools/prepare-port-cargo-sources.mjs', 'tools/register-port-cargo-catalog.mjs', 'tools/verify-port-cargo-catalog.mjs']
      .map(source => ['after', source]),
  ];
  assert(receipt.schema === 1 && receipt.family === 'port-cargo-v1' && receipt.sources?.length === 8, 'Invalid S17 source receipt.');
  assert(same(receipt.sources.map(({ phase, source, snapshot }) => [phase, source, snapshot]),
    expected.map(([phase, source]) => [phase, source, phase === 'before'
      ? 'docs/art/source/port-cargo-v1/before/props.source.js'
      : `docs/art/source/port-cargo-v1/final/after/${path.basename(source)}`])), 'S17 source receipt scope differs.');
  for (const entry of receipt.sources) {
    assert(entry.snapshot && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), 'Incomplete S17 source metadata.');
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    assert(bytes.length === entry.bytes && sha(bytes) === entry.sha256, `Frozen source mismatch: ${entry.snapshot}`);
  }
  assert(receipt.reusedAssets?.length === 5, 'S17 reused asset receipt must contain four town atlas files and the crate model.');
  for (const asset of receipt.reusedAssets) {
    assert(reusedAssets.includes(asset.path) && Number.isInteger(asset.bytes) && /^[a-f0-9]{64}$/.test(asset.sha256), `Unexpected reused asset: ${asset.path}`);
    const expectedId = asset.path.endsWith('.glb') ? 'prop:storage-crate' : asset.path.includes('atlas-normal') ? 'tex:town-wood-normal-v1' : 'tex:town-wood-albedo-v1';
    assert(asset.id === expectedId, `Wrong reused asset registry ID for ${asset.path}`);
    const bytes = fs.readFileSync(path.join(root, asset.path));
    assert(bytes.length === asset.bytes && sha(bytes) === asset.sha256, `Reused asset hash mismatch: ${asset.path}`);
  }
  assert(same(receipt.reusedAssets.map(item => item.path).sort(), [...reusedAssets].sort()), 'S17 reused asset paths differ.');
  return receipt;
}

export function validatePortCargoRuntime(runtime = readJson(paths.runtime)) {
  assert(runtime.schema === 1 && runtime.family === 'port-cargo-v1', 'Invalid S17 runtime evidence envelope.');
  assert(same(runtime.before?.map(item => item.device), before), 'S17 before cases are incomplete or out of order.');
  assert(same(runtime.after?.map(item => item.device), after), 'S17 after cases are incomplete or out of order.');
  const cases = [...runtime.before, ...runtime.after];
  assert(runtime.before.every(item => item.phase === 'before') && runtime.after.every(item => item.phase === 'after'), 'S17 runtime phase labels differ.');
  const byCase = new Map();
  const expectedTierOrder = ['high', 'low', 'medium', 'high'];
  for (const item of cases) {
    const { phase, device } = item;
    const mobile = ['mobile', 'low', 'portrait'].includes(device);
    assert(item.viewport && Number.isInteger(item.viewport.width) && Number.isInteger(item.viewport.height), `Viewport missing: ${phase}/${device}`);
    assert(item.mapProps && Number.isInteger(item.mapProps.count) && Number.isInteger(item.mapProps.bytes) && /^[a-f0-9]{64}$/.test(item.mapProps.sha256), `Invalid mapProps digest: ${phase}/${device}`);
    assert(item.dock && item.cargoCounts?.barrel === 8 && item.cargoCounts?.crate === 7 && Array.isArray(item.meshes), `Map or cargo inventory differs: ${phase}/${device}`);
    assert(Array.isArray(item.errors) && item.errors.length === 0, `Page errors: ${phase}/${device}`);
    assert(item.views?.map(view => view.name).join(',') === 'overview,barrel,crate', `View order differs: ${phase}/${device}`);
    assert(item.transitions?.length === 4 && same(item.transitions.map(entry => entry.tier), expectedTierOrder) && item.transitions.every(entry => entry.reused === true), `Quality transition order/reuse differs: ${phase}/${device}`);
    byCase.set(`${phase}/${device}`, item);
    const expectedError = device === 'missing-albedo' ? /town-wood-albedo-v1/i : device === 'missing-normal' ? /town-wood-normal-v1/i : device === 'missing-crate' ? /prop-storage-crate/i : null;
    const urls = item.requests || [];
    assert(Array.isArray(urls) && urls.every(url => typeof url === 'string'), `Invalid request list: ${phase}/${device}`);
    const atlasUrls = urls.filter(url => /town-wood-v1\/atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(url));
    const crateUrls = urls.filter(url => /prop-storage-crate\.glb/.test(url));
    if (device === 'disabled') assert(atlasUrls.length === 0 && crateUrls.length === 0, 'Disabled case must not request reused assets.');
    else {
      const suffix = `-${mobile ? 'mobile' : 'desktop'}.webp`;
      assert(atlasUrls.length === 2 && atlasUrls.filter(url => url.includes('atlas-albedo')).length === 1 && atlasUrls.filter(url => url.includes('atlas-normal')).length === 1 && atlasUrls.every(url => url.endsWith(suffix)), `Unexpected atlas requests: ${phase}/${device}`);
      assert(crateUrls.length === 1, `Expected one crate model request: ${phase}/${device}`);
    }
    const states = [...item.views.map(view => view.state), ...item.transitions.map(view => view.state || view)];
    const expectedPainted = phase === 'after' && !['disabled', 'missing-albedo', 'missing-crate'].includes(device) ? 1 : 0;
    for (const state of states) {
      assert(state?.glError === 0 && state.programsLinked === true, `WebGL failure: ${phase}/${device}`);
      assert(state.gameErrors && Object.keys(state.gameErrors).length === 0, `Game errors: ${phase}/${device}`);
      const pc = state.portCargo;
      assert(pc && pc.applied === !['disabled', 'missing-albedo'].includes(device) && Array.isArray(pc.painted) && pc.painted.length === expectedPainted, `Port cargo state differs: ${phase}/${device}`);
      for (const painted of pc.painted) assert(painted.family === 'port-cargo-v1' && painted.kind === 'crate' && same(painted.roles, { planks: 272, floor: 136, iron: 0 }) && painted.texturesAdded === 0 && painted.instances === 7 && typeof painted.geometry === 'string' && typeof painted.material === 'string' && painted.attributeBytes === 26112 && painted.indexBytes === 1224, `Painted crate contract differs: ${phase}/${device}`);
      const failures = expectedError ? (state.assetErrors || []).filter(error => expectedError.test(typeof error === 'string' ? error : JSON.stringify(error))) : [];
      assert(Array.isArray(state.assetErrors) && state.assetErrors.length === (expectedError ? 1 : 0) && (!expectedError || failures.length === 1), `Unexpected asset errors: ${phase}/${device}`);
      const albedo = pc.albedo, normal = pc.normal;
      if (device === 'disabled' || device === 'missing-albedo') assert(albedo === null, `Albedo must be absent: ${phase}/${device}`);
      else {
        const size = mobile ? 1024 : 2048;
        assert(albedo?.width === size && albedo?.height === size && albedo.colorSpace === 'srgb' && albedo.shared === true && typeof albedo.textureRef === 'string' && albedo.src?.endsWith(`atlas-albedo-${mobile ? 'mobile' : 'desktop'}.webp`), `Wrong albedo selection: ${phase}/${device}`);
      }
      if (device === 'disabled' || device === 'missing-albedo' || device === 'missing-normal') assert(normal === null || (device === 'missing-albedo' && normal.shared === false), `Unexpected normal fallback: ${phase}/${device}`);
      else {
        const size = mobile ? 1024 : 2048;
        assert(normal?.width === size && normal?.height === size && normal.colorSpace === '' && normal.shared === true && typeof normal.textureRef === 'string' && normal.src?.endsWith(`atlas-normal-${mobile ? 'mobile' : 'desktop'}.webp`), `Wrong normal selection: ${phase}/${device}`);
      }
      assert(Array.isArray(state.camera?.position) && Array.isArray(state.camera?.target) && Number.isFinite(state.camera?.fov), `Camera evidence missing: ${phase}/${device}`);
      const expectedUrl = device === 'missing-albedo' ? 'atlas-albedo-desktop.webp' : device === 'missing-normal' ? 'atlas-normal-desktop.webp' : device === 'missing-crate' ? 'prop-storage-crate.glb' : null;
      const consoleErrors = (item.consoleErrors || []).filter(error => !(/404/i.test(error.text || '') && /\/favicon\.ico$/.test(error.location?.url || '')));
      assert(Array.isArray(consoleErrors) && consoleErrors.length === (expectedUrl ? 1 : 0) && (!expectedUrl || consoleErrors.every(error => /404/i.test(error.text || '') && String(error.location?.url || '').includes(expectedUrl))), `Unexpected console errors: ${phase}/${device}`);
    }
    assert(states.every(state => same(state.portCargo, states[0].portCargo)), `Cargo state differs between views/transitions: ${phase}/${device}`);
  }
  const baseline = runtime.before[0];
  for (const item of cases) assert(same(item.mapProps, baseline.mapProps) && same(item.dock, baseline.dock) && same(item.cargoCounts, baseline.cargoCounts), `Map/dock/cargo inventory changed: ${item.phase}/${item.device}`);
  for (const device of before) {
    const old = byCase.get(`before/${device}`), next = byCase.get(`after/${device}`);
    assert(same(old.mapProps, next.mapProps) && same(old.dock, next.dock) && same(old.cargoCounts, next.cargoCounts), `Map/dock/cargo counts changed: ${device}`);
    assert(old.meshes.length === next.meshes.length, `Mesh count changed: ${device}`);
    for (let i = 0; i < old.meshes.length; i++) {
      const a = old.meshes[i], b = next.meshes[i];
      if (b.importedCrate) assert(same(b.key, next.meshes.find(mesh => mesh.chunk).key), 'Painted crate must share the town shader variant.');
      assert(a.name === b.name && a.chunk === b.chunk && a.importedCrate === b.importedCrate && a.animated === b.animated, `Mesh identity changed: ${device}/${a.name}`);
      assert(same(a.index, b.index) && same(a.instanceMatrix, b.instanceMatrix) && a.count === b.count && (a.animated || same(a.matrix, b.matrix)) && a.triangles === b.triangles && (a.importedCrate || same(a.key, b.key)) && a.castShadow === b.castShadow && a.receiveShadow === b.receiveShadow && a.normalPass === b.normalPass, `Geometry/index/matrix/count/shader/shadow changed: ${device}/${a.name}`);
      if (a.animated) continue;
      const allowed = a.chunk ? new Set(['uv', 'aTownWood']) : a.importedCrate ? new Set(['uv', 'aTownWood', 'aTownCover']) : new Set();
      for (const name of new Set([...Object.keys(a.attributes || {}), ...Object.keys(b.attributes || {})])) if (!allowed.has(name)) assert(same(a.attributes?.[name], b.attributes?.[name]), `Unexpected attribute change: ${device}/${a.name}/${name}`);
    }
    for (const viewName of views) assert(same(old.views.find(view => view.name === viewName).state.camera, next.views.find(view => view.name === viewName).state.camera), `Camera comparison changed: ${device}/${viewName}`);
  }
  assert(screenshots.length === 36, 'Expected 36 S17 gameplay screenshots.');
  return runtime;
}

function registerCatalog() {
const snapshot = validatePortCargoSnapshot();
const runtime = validatePortCargoRuntime();
for (const relative of [paths.brief, paths.report, paths.runtime, paths.snapshot, ...reusedAssets, ...screenshots]) {
  assert(exists(relative), `Missing S17 artifact: ${relative}`);
}

const catalogBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
const untouched = catalog.rows.filter(row => !['barril', 'crate-integrada'].includes(row.id)).map(row => [row.id, JSON.stringify(row)]);
const barrel = catalog.rows.find(row => row.id === 'barril');
const crate = catalog.rows.find(row => row.id === 'crate-integrada');
assert(barrel && crate, 'Existing barrel and integrated crate catalogue rows are required.');
assert(crate.state === 'applied', 'S17 must preserve the existing applied crate row.');
const sharedFiles = [
  artifact('Catálogo previo S17', 'docs/art/source/port-cargo-v1/before/catalog.source.json', 'source'),
  artifact('Recibo de fuentes congeladas S17', paths.snapshot, 'source'),
  ...snapshot.sources.map(entry => artifact(`Snapshot ${entry.phase} · ${entry.source}`, entry.snapshot, 'source')),
  ...reusedAssets.map(relative => artifact(`Recurso reutilizado · ${path.basename(relative)}`, relative,
    relative.endsWith('.glb') ? 'model' : relative.includes('atlas-normal') ? 'normal' : 'albedo')),
];
for (const row of [barrel, crate]) {
  const preview = row.id === 'barril' ? 'docs/art/port-cargo/desktop-barrel-after-v1.png' : 'docs/art/port-cargo/desktop-crate-after-v1.png';
  row.references = upsert(row.references, [artifact('Brief S17 · carga del puerto', paths.brief, 'reference'), artifact('Vista de gameplay aplicada', preview, 'preview')]);
  row.files = upsert(row.files, sharedFiles);
  row.evidence = upsert(row.evidence, [artifact('Evidencia runtime S17', paths.runtime), artifact('Entrega local S17', paths.report),
    ...screenshots.map(relative => artifact(`Captura · ${path.basename(relative)}`, relative))]);
  row.destination = [...new Set([...(row.destination || []), 'src/render/portCargo.js', 'src/render/props.js'])];
  row.variants = [...new Set([...(row.variants || []), row.id === 'barril' ? 'madera portuaria integrada' : 'caja de carga portuaria'] )];
  row.nextStep = 'Variantes adicionales, ajuste artístico y rendimiento en dispositivos físicos pendientes.';
  const note = row.id === 'barril'
    ? 'S17: ocho barriles estáticos cerrados pintados con duelas y dos aros de hierro; color/normal S14 compartidos. Las variantes abierto/claro/oscuro siguen pendientes. Sin imágenes nuevas ni cambios de posición.'
    : 'S17: siete cajas estáticas abiertas conservan su GLB Dreamrise; clones de geometría usan el atlas de madera/normal S14 con veta horizontal. El registro original conserva su paleta para otros consumidores. Sin imágenes nuevas ni cambios de posición.';
  if (!row.notes?.includes('S17:')) row.notes = `${row.notes || ''}${row.notes ? ' ' : ''}${note}`;
}
barrel.description = 'Barril de madera portuaria con duelas, aros y silueta legible, integrado en la composición de carga.';
barrel.state = 'applied';
barrel.kind = 'object';
barrel.category = 'Props del puerto';
crate.description = 'Caja de carga integrada, realzada como elemento de la composición portuaria con su GLB existente.';
for (const row of [barrel, crate]) for (const link of [...row.references, ...row.files, ...row.evidence]) assert(exists(link.path), `Missing catalogue link: ${link.path}`);
assert(untouched.every(([id, value]) => JSON.stringify(catalog.rows.find(row => row.id === id)) === value), 'S17 preparation changed an unrelated row.');

const changed = !catalogBytes.equals(Buffer.from(JSON.stringify(catalog, null, 2) + '\n'));
if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.port-cargo.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(catalogBytes)) throw new Error('Catalogue changed concurrently; preserving the newer revision.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S17 catalogue ready: barrel and integrated crate; revision ${catalog.revision}${changed ? '' : ' (unchanged)'}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) registerCatalog();
