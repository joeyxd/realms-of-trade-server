// Register the accepted S15 procedural covers after source and gameplay evidence are present.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'tools/art-catalog/catalog.json';
const BRIEF = 'docs/briefs/visual-s15-town-covers.md';
const REPORT = 'docs/delivery/town-covers-v1.md';
const RUNTIME = 'docs/art/town-covers/runtime-evidence-v1.json';
const SNAPSHOT = 'docs/art/source/town-covers-v1/final-v3/source-snapshot.json';
const BEFORE = ['desktop', 'mobile', 'low'];
const AFTER = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-cloth', 'portrait'];
const VIEWS = ['overview', 'house', 'stall', 'dock'];
const SHARED_ATLAS = 'assets/textures/raft/comic-materials-v1.webp';
const MOBILE_ATLAS = 'assets/textures/raft/comic-materials-v1-mobile.webp';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const exists = file => fs.existsSync(path.join(ROOT, file));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const canonical = value => JSON.stringify(value, (key, current) => current && !Array.isArray(current) && typeof current === 'object'
  ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) : current);
const same = (a, b) => canonical(a) === canonical(b);
const link = (label, file, role) => ({ label, path: file, ...(role ? { role } : {}) });
const unique = values => [...new Map(values.map(value => [value.path, value])).values()];
const errorsEmpty = value => (Array.isArray(value) && value.length === 0) || (value && !Array.isArray(value) && Object.keys(value).length === 0);
const requestsOf = entry => (entry.requests || []).map(value => typeof value === 'string' ? value : value.url || value.href || '');
const stateOf = value => value.state || value;
const args = process.argv.slice(2);
const refresh = args.length === 1 && args[0] === '--refresh-owned-rows';
if (args.length && !refresh) throw Error('Usage: node tools/register-town-covers-catalog.mjs [--refresh-owned-rows]');

function validateSources() {
  const receipt = readJson(SNAPSHOT);
  const expected = [
    ['before', 'src/render/props.js'],
    ...['src/render/props.js', 'src/render/townCovers.js', 'tests/town-covers.test.mjs',
      'tools/qa-town-covers.playwright.js', 'tools/prepare-town-covers-sources.mjs',
      'tools/register-town-covers-catalog.mjs', 'tools/verify-town-covers-catalog.mjs'].map(source => ['after', source]),
  ];
  assert(receipt.schema === 1 && receipt.family === 'town-covers-v1' && Array.isArray(receipt.sources), 'S15 source receipt is incompatible.');
  assert(receipt.sources.length === expected.length, 'S15 source receipt has an unexpected number of entries.');
  const seen = new Set();
  for (const [phase, source] of expected) {
    const matches = receipt.sources.filter(value => value.phase === phase && value.source === source);
    assert(matches.length === 1, `Missing frozen ${phase} source: ${source}`);
    const entry = matches[0];
    assert(typeof entry.snapshot === 'string' && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), `Incomplete frozen source record: ${source}`);
    assert(!seen.has(entry.snapshot), `Repeated source snapshot: ${entry.snapshot}`);
    const bytes = fs.readFileSync(path.join(ROOT, entry.snapshot));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Frozen source hash mismatch: ${entry.snapshot}`);
    seen.add(entry.snapshot);
  }
  assert(same(receipt.reusedAssets?.map(({ id, path }) => ({ id, path })), [
    { id: 'tex:raft-comic-v1', path: SHARED_ATLAS },
    { id: 'tex:raft-comic-v1', path: MOBILE_ATLAS },
  ]), 'S15 reused atlas receipt paths are incomplete.');
  for (const asset of receipt.reusedAssets) {
    const bytes = fs.readFileSync(path.join(ROOT, asset.path));
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, `Reused atlas hash mismatch: ${asset.path}`);
  }
  return receipt;
}

function validateRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.schema === 1 && runtime.family === 'town-covers-v1', 'S15 runtime evidence is incompatible.');
  assert(same(runtime.before?.map(value => value.device), BEFORE), 'S15 before cases are incomplete or out of order.');
  assert(same(runtime.after?.map(value => value.device), AFTER), 'S15 after cases are incomplete or out of order.');
  const cases = [...runtime.before, ...runtime.after];
  const errorText = error => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.url || error?.location?.url || ''}`;
  for (const entry of cases) {
    const missing = entry.device === 'missing-cloth';
    const disabled = entry.device === 'disabled';
    const mobile = ['mobile', 'low', 'portrait'].includes(entry.device);
    assert((BEFORE.includes(entry.device) && entry.phase === 'before') || (AFTER.includes(entry.device) && entry.phase === 'after'), `Unexpected evidence phase: ${entry.device}/${entry.phase}`);
    assert(entry.mapProps && Number.isInteger(entry.mapProps.count) && Number.isInteger(entry.mapProps.bytes) && /^[a-f0-9]{64}$/.test(entry.mapProps.sha256), `Missing real mapProps hash: ${entry.phase}/${entry.device}`);
    assert(Array.isArray(entry.errors) && entry.errors.length === 0, `Runtime errors: ${entry.phase}/${entry.device}`);
    assert(Array.isArray(entry.consoleErrors), `Missing consoleErrors: ${entry.phase}/${entry.device}`);
    assert(entry.consoleErrors.every(error => /404/i.test(errorText(error)) && (String(error?.location?.url || error?.url || errorText(error)).endsWith('/favicon.ico') ||
      (missing && String(error?.location?.url || error?.url || errorText(error)).endsWith('/assets/textures/raft/comic-materials-v1.webp')))), `Unexpected console error: ${entry.phase}/${entry.device}`);
    assert(Array.isArray(entry.views) && entry.views.length === VIEWS.length && VIEWS.every(name => entry.views.some(view => view.name === name)), `Expected overview/house/stall/dock views: ${entry.phase}/${entry.device}`);
    if (entry.phase === 'before') {
      assert(same(entry.coverVertices, [0, 0, 0]), `Baseline has cover vertices: ${entry.device}`);
      for (const view of entry.views || []) {
        const cloth = stateOf(view).townCovers?.cloth;
        const size = mobile ? 512 : 1024;
        assert(cloth && cloth.width === size && cloth.height === size && cloth.colorSpace === 'srgb' && cloth.shared === false, `Baseline must decode the existing unshared cloth atlas: ${entry.device}/${view.name}`);
        assert(cloth.src?.endsWith(mobile ? 'comic-materials-v1-mobile.webp' : 'comic-materials-v1.webp'), `Baseline selected wrong cloth atlas: ${entry.device}/${view.name}`);
      }
    }
    else {
      assert(Array.isArray(entry.coverVertices) && entry.coverVertices.length === 3 && entry.coverVertices[1] > 0 && entry.coverVertices[2] > 0, `Thatched and cloth covers are absent: ${entry.device}`);
      assert(Array.isArray(entry.transitions) && entry.transitions.length === 4 && entry.transitions.every(value => value.reused === true), `Quality transition replaced shared resources: ${entry.device}`);
      assert(same(entry.transitions.map(value => value.tier), ['high', 'low', 'medium', 'high']), `Unexpected quality transition order: ${entry.device}`);
    }
    for (const view of [...entry.views, ...(entry.phase === 'after' ? entry.transitions : [])]) {
      const state = stateOf(view);
      assert(state.glError === 0 && state.programsLinked === true, `GL failure: ${entry.device}/${view.name || view.tier}`);
      assert(errorsEmpty(state.gameErrors) && Array.isArray(state.assetErrors), `Game/asset error record missing: ${entry.device}/${view.name || view.tier}`);
      assert(state.assetErrors.length === (missing ? 1 : 0) && (!missing || state.assetErrors[0] === 'tex:raft-comic-v1: [object Event]'), `Unexpected asset errors: ${entry.device}/${view.name || view.tier}`);
      if (entry.phase === 'after') {
        const cover = state.townCovers, cloth = cover?.cloth;
        assert(cover && Number.isInteger(cover.chunks) && Array.isArray(cover.geometries) && Array.isArray(cover.materials), `townCovers state missing: ${entry.device}/${view.name || view.tier}`);
        assert(cover.geometries.length === cover.chunks && cover.materials.length === cover.chunks, `Chunk resources incomplete: ${entry.device}/${view.name || view.tier}`);
        if (disabled || missing) assert(cloth === null, `Cloth atlas should be absent: ${entry.device}/${view.name || view.tier}`);
        else {
          const size = mobile ? 512 : 1024;
          assert(cloth && cloth.width === size && cloth.height === size && cloth.colorSpace === 'srgb' && cloth.shared === true && typeof cloth.textureRef === 'string', `Unexpected shared cloth texture: ${entry.device}/${view.name || view.tier}`);
          assert(cloth.src?.endsWith(mobile ? 'comic-materials-v1-mobile.webp' : 'comic-materials-v1.webp'), `Wrong selected cloth atlas: ${entry.device}/${view.name || view.tier}`);
        }
      }
    }
    const atlasRequests = requestsOf(entry).filter(url => /comic-materials-v1(?:-mobile)?\.webp/.test(url));
    if (disabled) assert(atlasRequests.length === 0, `No-assets case must not request an atlas: ${entry.phase}/${entry.device}`);
    else {
      assert(atlasRequests.length === 1, `Expected one shared cloth atlas request: ${entry.phase}/${entry.device}`);
      const expected = mobile ? MOBILE_ATLAS : SHARED_ATLAS;
      if (missing) assert(atlasRequests[0].endsWith('/' + SHARED_ATLAS), 'Missing-cloth route must fail the desktop shared atlas URL.');
      else assert(atlasRequests[0].endsWith('/' + expected), `Wrong selected atlas URL: ${entry.device}`);
    }
  }

  const reference = runtime.before[0];
  for (const entry of cases) {
    assert(same(reference.mapProps, entry.mapProps) && same(reference.dock, entry.dock), `Map props or dock changed: ${entry.phase}/${entry.device}`);
  }
  for (const device of BEFORE) {
    const before = runtime.before.find(value => value.device === device);
    const after = runtime.after.find(value => value.device === device);
    assert(same(before.views.map(view => view.state.camera), after.views.map(view => view.state.camera)), `Comparison cameras changed: ${device}`);
    assert(before.meshes.length === after.meshes.length, `Mesh count changed: ${device}`);
    assert(before.meshes.filter(mesh => mesh.chunk).length === after.meshes.filter(mesh => mesh.chunk).length, `Props chunk count changed: ${device}`);
    for (let i = 0; i < before.meshes.length; i++) {
      const old = before.meshes[i], next = after.meshes[i];
      assert(old.name === next.name && old.animated === next.animated && old.chunk === next.chunk && old.triangles === next.triangles && (old.count ?? null) === (next.count ?? null) && same(old.index ?? null, next.index ?? null), `Mesh identity/index/count changed: ${device}/${next.name}`);
      if (!old.chunk || old.animated) assert(same(old.key ?? null, next.key ?? null), `Non-cover material program key changed: ${device}/${next.name}`);
      assert(same({ castShadow: old.castShadow, receiveShadow: old.receiveShadow, normalPass: old.normalPass }, { castShadow: next.castShadow, receiveShadow: next.receiveShadow, normalPass: next.normalPass }), `Shadow/material pass changed: ${device}/${next.name}`);
      const isCover = Object.hasOwn(next.attributes || {}, 'aTownCover');
      assert(!Object.hasOwn(old.attributes || {}, 'aTownCover'), `aTownCover existed in baseline: ${device}/${next.name}`);
      assert(!isCover || next.chunk === true, `aTownCover escaped props chunks: ${device}/${next.name}`);
      if (!old.animated && !next.animated) {
        const attrs = mesh => Object.fromEntries(Object.entries(mesh.attributes || {}).filter(([name]) => name !== 'aTownCover').sort(([a], [b]) => a.localeCompare(b)));
        assert(same(attrs(old), attrs(next)) && same(old.matrix ?? null, next.matrix ?? null), `Existing geometry/attributes/matrix changed: ${device}/${next.name}`);
      }
    }
    const additions = after.meshes.flatMap((mesh, index) => Object.keys(mesh.attributes || {}).filter(name => !Object.hasOwn(before.meshes[index].attributes || {}, name)));
    assert(additions.length > 0 && additions.every(name => name === 'aTownCover'), `Unexpected new mesh attributes: ${device}`);
    const newAttributeMeshes = after.meshes.filter(mesh => Object.hasOwn(mesh.attributes || {}, 'aTownCover'));
    assert(newAttributeMeshes.length > 0 && newAttributeMeshes.length === after.meshes.filter(mesh => mesh.chunk).length && newAttributeMeshes.every(mesh => mesh.chunk), `aTownCover is not present on every props chunk only: ${device}`);
  }
  const afterVertices = runtime.after[0].coverVertices;
  // No-assets restores procedural crates, changing neutral vertices but not roof/cloth coverage.
  for (const entry of runtime.after) assert(same(entry.coverVertices.slice(1), afterVertices.slice(1)), `Selected cover vertex counts differ across after cases: ${entry.device}`);
  for (const entry of cases) {
    for (const view of [...entry.views, ...(entry.phase === 'after' ? entry.transitions : [])]) {
      const initial = stateOf(entry.views[0]).townCovers;
      const current = stateOf(view).townCovers;
      if (entry.phase === 'after') {
        assert(same(initial.geometries, current.geometries) && same(initial.materials, current.materials), `Chunk resources were recreated: ${entry.device}/${view.name || view.tier}`);
        if (initial.cloth && current.cloth) assert(initial.cloth.textureRef === current.cloth.textureRef, `Cloth texture was recreated: ${entry.device}/${view.name || view.tier}`);
      }
    }
  }
  return runtime;
}

const snapshot = validateSources();
const runtime = validateRuntime();
const screenshotPaths = [...runtime.before, ...runtime.after].flatMap(entry => VIEWS.map(view => `docs/art/town-covers/${entry.device}-${view}-${entry.phase}-v1.png`));
const allRequired = [BRIEF, REPORT, RUNTIME, SNAPSHOT, 'docs/delivery/raft-comic-material.md',
  'tools/prepare-town-covers-sources.mjs', 'tools/register-town-covers-catalog.mjs', 'tools/verify-town-covers-catalog.mjs',
  'tools/qa-town-covers.playwright.js', 'tests/town-covers.test.mjs', SHARED_ATLAS, MOBILE_ATLAS, ...screenshotPaths];
for (const file of allRequired) assert(exists(file), `Missing S15 artifact: ${file}`);
assert(screenshotPaths.length === 40, 'Expected 40 gameplay screenshots.');

const catalogPath = path.join(ROOT, CATALOG), beforeBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(beforeBytes.toString('utf8'));
for (const id of ['m05-lona', 'kit-techo', 'toldo-bandera-vela']) {
  const row = catalog.rows.find(value => value.id === id);
  assert(row, `Existing catalogue row is missing: ${id}`);
  if (id !== 'm05-lona') assert(row.state === 'pending', `S15 must leave ${id} pending.`);
}
const sourceEntries = snapshot.sources.map(entry => link(`Fuente congelada · ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'));
const sharedFiles = unique([
  link('Atlas compartido PC 1024', SHARED_ATLAS, 'albedo'), link('Atlas compartido móvil 512', MOBILE_ATLAS, 'mobile'),
  link('Fuente y aplicación del atlas de balsa', 'docs/delivery/raft-comic-material.md', 'reference'),
  link('Recibo de fuentes congeladas S15', SNAPSHOT, 'source'), ...sourceEntries,
  link('Evidencia del mapa S15', RUNTIME), link('Brief S15', BRIEF, 'reference'), link('Entrega local S15', REPORT),
]);
const screenshots = screenshotPaths.map(file => link(`Captura del mapa · ${path.basename(file, '.png')}`, file));
const evidence = unique([link('S15 · cubiertas, atlas y equivalencia', RUNTIME), link('Entrega local S15', REPORT), ...screenshots]);
const rows = [
  { id: 'town-thatch-v1', name: 'Techo de paja', category: 'Materiales de pueblo', kind: 'material', description: 'Cubierta cosmética procedural aplicada a las seis casas del pueblo; reutiliza los recursos existentes.', variants: ['paja escalonada'], destination: ['src/render/townCovers.js', 'src/render/props.js'], nextStep: 'Escala y lectura en dispositivos físicos pendientes.', preview: 'docs/art/town-covers/desktop-house-after-v1.png' },
  { id: 'town-awning-v1', name: 'Toldo de mercado', category: 'Props de pueblo', kind: 'object', description: 'Toldo cosmético procedural aplicado únicamente al puesto del mercado; reutiliza el atlas compartido existente.', variants: ['franjas rojo apagado y crema'], destination: ['src/render/townCovers.js', 'src/render/props.js'], nextStep: 'Escala y lectura en dispositivos físicos pendientes.', preview: 'docs/art/town-covers/desktop-stall-after-v1.png' },
];
let changed = false;
for (const spec of rows) {
  const { preview, ...fields } = spec;
  const row = { ...fields, priority: 'P0', state: 'applied', notes: 'S15 aplicado localmente: cobertura decorativa procedural; sin texturas nuevas ni cambios de mapa o muelle.', references: [
    link('S15 brief · techos de casas y toldo del mercado', BRIEF, 'reference'),
    link('Atlas compartido · fuente existente', 'docs/delivery/raft-comic-material.md', 'reference'),
    link('Vista de gameplay del elemento aplicado', preview, 'preview'),
  ], files: sharedFiles, evidence: unique([...evidence, link('Vista de gameplay del elemento aplicado', preview, 'preview')]) };
  for (const entry of [...row.references, ...row.files, ...row.evidence]) assert(exists(entry.path), `Missing catalogue link: ${entry.path}`);
  const existing = catalog.rows.find(value => value.id === row.id);
  if (existing && !same(existing, row)) {
    // Repair only the exact S15 rows written by the initial registrar, without absorbing user edits.
    const prior = JSON.parse(JSON.stringify(row));
    for (const file of [...prior.references, ...prior.files, ...prior.evidence]) file.path = file.path.replace('/town-covers-v1/final-v3/', '/town-covers-v1/final-v2/');
    prior.files.push(
      link('Preparación de fuentes', 'tools/prepare-town-covers-sources.mjs', 'source'),
      link('Comprobación en navegador', 'tools/qa-town-covers.playwright.js', 'source'),
      link('Prueba de cubiertas', 'tests/town-covers.test.mjs', 'source'),
      link('Verificador del catálogo', 'tools/verify-town-covers-catalog.mjs', 'source'),
      link('Registro del catálogo', 'tools/register-town-covers-catalog.mjs', 'source'));
    assert(refresh && same(existing, prior), `Existing S15 catalogue row differs; refusing overwrite: ${row.id}`);
    catalog.rows[catalog.rows.indexOf(existing)] = row; changed = true;
  }
  else if (!existing) { catalog.rows.push(row); changed = true; }
}
if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.town-covers.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(beforeBytes)) throw Error('Catalogue changed concurrently; preserving the newer revision.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S15 catalogue ready: two rows; revision ${catalog.revision}.`);
