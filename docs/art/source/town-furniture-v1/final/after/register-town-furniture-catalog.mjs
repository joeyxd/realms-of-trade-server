// Register the two S19 town furniture rows after browser evidence and frozen sources exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FAMILY = 'town-furniture-v1';
const CATALOG = 'tools/art-catalog/catalog.json';
const BEFORE_CATALOG = `docs/art/source/${FAMILY}/before/catalog.source.json`;
const SNAPSHOT = `docs/art/source/${FAMILY}/final/source-snapshot.json`;
const RUNTIME = 'docs/art/town-furniture/runtime-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s19-town-furniture.md';
const REPORT = 'docs/delivery/town-furniture-v1.md';
const BEFORE = ['desktop'];
const AFTER = ['desktop', 'mobile', 'low', 'disabled', 'missing-albedo', 'missing-normal', 'portrait'];
const VIEWS = ['bench', 'sepia', 'overview'];
const TIERS = ['high', 'low', 'medium', 'high'];
const ATLAS = [
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp', 'albedo'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-desktop.webp', 'normal'],
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp', 'albedo'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-mobile.webp', 'normal'],
];
const IDS = ['banco-carpintero-v1', 'mobiliario-sepia-v1'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const full = file => path.join(ROOT, file);
const readJson = file => JSON.parse(fs.readFileSync(full(file), 'utf8'));
const exists = file => fs.existsSync(full(file));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const canonical = value => JSON.stringify(value, (key, current) => current && !Array.isArray(current) && typeof current === 'object'
  ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) : current);
const same = (a, b) => canonical(a) === canonical(b);
const link = (label, file, role) => ({ label, path: file, ...(role ? { role } : {}) });
const unique = values => [...new Map(values.map(value => [value.path, value])).values()];
const args = process.argv.slice(2);
const verifyOnly = args.length === 1 && args[0] === '--verify-only';
const runtimeOnly = args.length === 1 && args[0] === '--validate-runtime';
if (args.length && !verifyOnly && !runtimeOnly) throw Error('Usage: node tools/register-town-furniture-catalog.mjs [--verify-only|--validate-runtime]');

function validateSources() {
  const receipt = readJson(SNAPSHOT);
  const expected = [
    ['before', 'src/render/props.js'], ['before', 'src/render/resourceNodes.js'],
    ...['src/render/props.js', 'src/render/resourceNodes.js', 'src/render/townFurniture.js',
      'tests/town-furniture.test.mjs', 'tools/qa-town-furniture.playwright.js',
      'tools/prepare-town-furniture-sources.mjs', 'tools/register-town-furniture-catalog.mjs']
      .map(source => ['after', source]),
  ];
  assert(receipt.schema === 1 && receipt.family === FAMILY && receipt.sources?.length === 9, 'Invalid S19 source receipt.');
  const seen = new Set();
  for (const [phase, source] of expected) {
    const matches = receipt.sources.filter(item => item.phase === phase && item.source === source);
    assert(matches.length === 1, `Missing frozen ${phase} source: ${source}`);
    const entry = matches[0];
    const expectedPath = phase === 'before'
      ? `docs/art/source/${FAMILY}/before/${path.basename(source)}`
      : `docs/art/source/${FAMILY}/final/after/${path.basename(source)}`;
    assert(entry.snapshot === expectedPath && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), `Invalid frozen source record: ${source}`);
    assert(!seen.has(entry.snapshot), `Repeated source snapshot: ${entry.snapshot}`); seen.add(entry.snapshot);
    const bytes = fs.readFileSync(full(entry.snapshot));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Frozen source hash mismatch: ${entry.snapshot}`);
  }
  assert(same(receipt.reusedAssets?.map(({ id, path: file }) => ({ id, path: file })), ATLAS.map(([id, file]) => ({ id, path: file }))), 'S19 reused atlas paths differ.');
  for (const asset of receipt.reusedAssets) {
    const bytes = fs.readFileSync(full(asset.path));
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, `Reused atlas hash mismatch: ${asset.path}`);
  }
  return receipt;
}

function validateRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.schema === 1 && runtime.family === FAMILY, 'Invalid S19 runtime evidence.');
  assert(same(runtime.before?.map(item => item.device), BEFORE) && same(runtime.after?.map(item => item.device), AFTER), 'S19 runtime contexts are incomplete or out of order.');
  const cases = [...runtime.before, ...runtime.after];
  const stateOf = item => item.state || item;
  const requestsOf = item => (item.requests || []).map(request => typeof request === 'string' ? request : request.url || request.href || '');
  const empty = value => Array.isArray(value) ? value.length === 0 : !!value && typeof value === 'object' && Object.keys(value).length === 0;
  const errorText = error => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.location?.url || error?.url || ''}`;
  for (const item of cases) {
    const mobile = ['mobile', 'low', 'portrait'].includes(item.device);
    const disabled = item.device === 'disabled';
    const missing = item.device === 'missing-albedo' ? 'albedo' : item.device === 'missing-normal' ? 'normal' : null;
    assert(Array.isArray(item.errors) && item.errors.length === 0, `JavaScript errors in ${item.phase}/${item.device}.`);
    assert(Array.isArray(item.views) && item.views.length === VIEWS.length && VIEWS.every(name => item.views.some(view => view.name === name)), `S19 views incomplete in ${item.phase}/${item.device}.`);
    if (item.phase === 'after') assert(Array.isArray(item.transitions) && same(item.transitions.map(value => value.tier), TIERS), `Wrong quality sequence in ${item.device}.`);
    for (const view of [...item.views, ...(item.transitions || [])]) {
      const state = stateOf(view), furniture = state.furniture;
      assert(state.glError === 0 && state.programsLinked === true && empty(state.gameErrors), `Runtime or GL failure: ${item.device}/${view.name || view.tier}.`);
      assert(furniture && typeof furniture.applied === 'boolean', `Furniture state missing: ${item.device}/${view.name || view.tier}.`);
      const after = item.phase === 'after';
      const applied = after && !disabled && missing !== 'albedo';
      assert(furniture.applied === applied, `Unexpected furniture fallback: ${item.device}/${view.name || view.tier}.`);
      for (const channel of ['albedo', 'normal']) {
        const texture = furniture[channel];
        if (disabled || missing === channel) { assert(texture === null, `Unexpected ${channel} texture in ${item.device}.`); continue; }
        assert(texture && typeof texture.src === 'string' && Number.isInteger(texture.width) && Number.isInteger(texture.height) && typeof texture.textureRef === 'string', `Invalid ${channel} texture record in ${item.device}.`);
        assert(texture.width === (mobile ? 1024 : 2048) && texture.height === (mobile ? 1024 : 2048), `Wrong ${channel} dimensions in ${item.device}.`);
        assert(channel === 'albedo' ? /srgb/i.test(String(texture.colorSpace)) : texture.colorSpace === '', `Wrong ${channel} color space in ${item.device}.`);
        assert(texture.src === `textures/town-wood-v1/atlas-${channel}-${mobile ? 'mobile' : 'desktop'}.webp`, `Wrong ${channel} atlas variant in ${item.device}.`);
        if (after && applied) assert(texture.shared === true, `${channel} texture is not shared with the applied furniture in ${item.device}.`);
        else assert(texture.shared === false, `${channel} texture should be unshared in ${item.device}.`);
      }
      assert(furniture.bench && typeof furniture.bench.mapped === 'boolean' && Number.isInteger(furniture.bench.meshes) && (typeof furniture.bench.geometry === 'string' || furniture.bench.geometry === null) && (typeof furniture.bench.material === 'string' || furniture.bench.material === null), `Invalid bench state in ${item.device}.`);
      assert(furniture.bench.mapped === applied, `Bench mapping differs from application in ${item.device}.`);
      assert(furniture.bench.meshes === (applied ? 2 : 6), `Wrong bench mesh count in ${item.device}.`);
      assert(after ? furniture.bench.metadata?.family === FAMILY && furniture.bench.metadata?.mapped === applied && furniture.bench.metadata?.texturesAdded === 0 : furniture.bench.metadata === null, `Unexpected bench metadata in ${item.device}.`);
      assert(applied ? !!furniture.bench.geometry && !!furniture.bench.material : furniture.bench.geometry === null && furniture.bench.material === null, `Unexpected bench resource identity in ${item.device}.`);
      const sepia = furniture.sepia;
      if (!after) assert(Array.isArray(sepia) && sepia.length === 0, 'Sepia metadata should be empty in baseline.');
      else assert(Array.isArray(sepia) && sepia.length === 1 && sepia[0]?.family === FAMILY && sepia[0]?.kind === 'sepia' && sepia[0]?.mapped === applied && sepia[0]?.texturesAdded === 0, `Sepia metadata missing or invalid in ${item.device}.`);
    }
    if (item.phase === 'after') {
      const atlasRequests = requestsOf(item).filter(url => /town-wood-v1\/atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(url));
      assert(disabled ? atlasRequests.length === 0 : atlasRequests.length === 2, `Unexpected atlas request count in ${item.device}.`);
      if (!disabled) for (const channel of ['albedo', 'normal']) assert(atlasRequests.filter(url => url.endsWith(`atlas-${channel}-${mobile ? 'mobile' : 'desktop'}.webp`)).length === 1, `Wrong or repeated ${channel} atlas request in ${item.device}.`);
      const errors = item.consoleErrors || [];
      if (missing) {
        const expectedUrl = `atlas-${missing}-desktop.webp`;
        assert(errors.some(error => /404/i.test(errorText(error)) && errorText(error).includes(expectedUrl)), `Missing ${missing} 404 evidence.`);
      }
      assert(errors.every(error => /404/i.test(errorText(error)) && (missing ? errorText(error).includes(`atlas-${missing}-desktop.webp`) || /favicon\.ico/i.test(errorText(error)) : /favicon\.ico/i.test(errorText(error)))), `Unexpected console error in ${item.device}.`);
    }
    for (const view of [...item.views, ...(item.transitions || [])]) {
      const state = stateOf(view);
      assert(Array.isArray(state.assetErrors) && state.assetErrors.length === (item.phase === 'after' && missing ? 1 : 0), `Unexpected asset errors in ${item.phase}/${item.device}/${view.name || view.tier}.`);
      if (item.phase === 'after' && missing) {
        const expectedId = `tex:town-wood-${missing}-v1:`;
        assert(typeof state.assetErrors[0] === 'string' && state.assetErrors[0].startsWith(expectedId), `Wrong asset error identity in ${item.device}.`);
      }
    }
  }
  const baseline = runtime.before[0];
  assert(baseline.mapProps && /^[a-f0-9]{64}$/.test(baseline.mapProps.sha256) && Number.isInteger(baseline.mapProps.bytes) && Number.isInteger(baseline.mapProps.count), 'Missing baseline mapProps hash record.');
  assert(baseline.resourceAnchor !== undefined && baseline.resourceNodes && /^[a-f0-9]{64}$/.test(baseline.resourceNodes.sha256) && Number.isInteger(baseline.resourceNodes.bytes), 'Missing bench anchor or resource nodes snapshot hash.');
  for (const item of cases) {
    assert(same(item.mapProps, baseline.mapProps), `mapProps changed in ${item.phase}/${item.device}.`);
    assert(same(item.resourceAnchor, baseline.resourceAnchor), `Bench resource anchor changed in ${item.phase}/${item.device}.`);
    assert(same(item.resourceNodes, baseline.resourceNodes), `Resource nodes snapshot changed in ${item.phase}/${item.device}.`);
  }
  for (const item of runtime.after) {
    assert(item.transitions.every(value => value.reused === true), `Quality tier recreated resources in ${item.device}.`);
    const firstBench = stateOf(item.views.find(view => view.name === 'bench')).furniture.bench;
    for (const transition of item.transitions) {
      const bench = stateOf(transition).furniture.bench;
      assert(bench.geometry === firstBench.geometry && bench.meshes === firstBench.meshes, `Bench geometry changed during quality transition in ${item.device}.`);
      assert(same(stateOf(transition).furniture, stateOf(item.views[0]).furniture), `Furniture resources changed during quality transition in ${item.device}.`);
    }
  }
  return runtime;
}

if (runtimeOnly) { validateRuntime(); console.log('S19 runtime evidence validated.'); process.exit(0); }
const snapshot = validateSources();
const runtime = validateRuntime();
const screenshots = [...runtime.before, ...runtime.after].flatMap(item => VIEWS.map(view => `docs/art/town-furniture/${item.device}-${view}-${item.phase}-v1.png`));
assert(screenshots.length === 24, 'Expected 24 S19 screenshots.');
for (const file of [BRIEF, REPORT, RUNTIME, SNAPSHOT, BEFORE_CATALOG, 'docs/art/town-furniture/tests-v1.log', ...screenshots, ...ATLAS.map(([, file]) => file)])
  assert(exists(file), `Missing S19 artifact: ${file}`);
const catalogPath = full(CATALOG), catalogBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
const original = readJson(BEFORE_CATALOG);
assert(Array.isArray(original.rows) && original.rows.length === 106, 'S19 baseline catalogue must contain 106 rows.');
assert(same(catalog.rows.filter(row => !IDS.includes(row.id)), original.rows), 'Existing catalogue rows differ from the immutable S19 baseline.');
const sourceLinks = snapshot.sources.map(entry => link(`Fuente congelada ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'));
const atlasLinks = ATLAS.map(([id, file, role]) => link(`Atlas reutilizado · ${id} · ${path.basename(file)}`, file, role));
const commonFiles = unique([
  ...atlasLinks, link('Recibo de fuentes S19', SNAPSHOT, 'source'), ...sourceLinks,
  link('Catálogo fuente inmutable S19', BEFORE_CATALOG, 'source'), link('Evidencia runtime S19', RUNTIME),
  link('Brief visual S19', BRIEF, 'reference'), link('Entrega local S19', REPORT),
  link('Registro de pruebas S19', 'docs/art/town-furniture/tests-v1.log', 'source'),
]);
const evidence = unique([link('Evidencia runtime y estados S19', RUNTIME), link('Entrega local S19', REPORT),
  ...screenshots.map(file => link(`Captura · ${path.basename(file, '.png')}`, file))]);
const specs = [
  { id: IDS[0], name: 'Banco de carpintero', preview: 'docs/art/town-furniture/desktop-bench-after-v1.png', description: 'Banco de recursos con tablones, repisa, tornillo de banco y martillo: 276 triángulos en una malla opaca; conserva el ancla y la interacción existentes.' },
  { id: IDS[1], name: 'Mobiliario de Doña Sepia', preview: 'docs/art/town-furniture/desktop-sepia-after-v1.png', description: 'Mesa, taburete, postes y caja de agujas del puesto de Doña Sepia con madera ilustrada compartida; conserva geometría, tela, tintas y herramientas.' },
];
const rows = specs.map(spec => ({
  id: spec.id, name: spec.name, category: 'Props de pueblo', kind: 'object', description: spec.description,
  priority: 'P0', state: 'applied', variants: spec.id === IDS[0] ? ['texturizado', 'respaldo procedural'] : ['mesa', 'taburete', 'postes', 'caja de agujas'],
  destination: ['src/render/props.js', 'src/render/resourceNodes.js', 'src/render/townFurniture.js'],
  nextStep: 'Escala, lectura y rendimiento en dispositivos físicos pendientes.',
  notes: 'S19 aplicado localmente con atlas de madera PC/móvil reutilizados; conserva el ancla de recursos del banco.',
  references: [link('Brief visual S19 · mobiliario de pueblo', BRIEF, 'reference'), link('Catálogo fuente inmutable S19', BEFORE_CATALOG, 'source'), link('Vista aplicada', spec.preview, 'preview')],
  files: commonFiles, evidence: unique([...evidence, link('Vista aplicada', spec.preview, 'preview')]),
}));
for (const row of rows) for (const item of [...row.references, ...row.files, ...row.evidence]) assert(exists(item.path), `Missing catalogue link: ${item.path}`);

let changed = false;
for (const row of rows) {
  const existing = catalog.rows.find(value => value.id === row.id);
  if (existing) assert(same(existing, row), `Existing S19 row differs; refusing overwrite: ${row.id}`);
  else if (!verifyOnly) { catalog.rows.push(row); changed = true; }
  else throw Error(`S19 catalogue row is missing: ${row.id}`);
}
if (verifyOnly) for (const row of rows) assert(same(catalog.rows.find(value => value.id === row.id), row), `S19 row verification failed: ${row.id}`);
else if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.town-furniture.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(catalogBytes)) throw Error('Catalogue changed concurrently; preserving the newer revision.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}

if (verifyOnly) {
  const paths = new Set([...rows.flatMap(row => [...row.references, ...row.files, ...row.evidence].map(item => item.path)), BEFORE_CATALOG]);
  const base = process.env.TOWN_FURNITURE_CATALOG_BASE || 'http://127.0.0.1:5190';
  const digestByPath = new Map();
  for (const relative of paths) {
    const local = fs.readFileSync(full(relative)), digest = hash(local);
    const response = await fetch(`${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`);
    assert(response.ok, `HTTP ${response.status} for ${relative}.`);
    assert(hash(Buffer.from(await response.arrayBuffer())) === digest, `Served bytes differ: ${relative}.`);
    digestByPath.set(relative, digest);
  }
  const response = await fetch(`${base}/api/catalog`);
  assert(response.ok, `Active catalogue HTTP ${response.status}.`);
  const live = await response.json();
  assert(same(live, catalog), 'API catalogue JSON differs from the local catalogue.');
  console.log(`S19 catalogue verified: ${digestByPath.size} unique SHA-256 files; revision ${catalog.revision}.`);
} else console.log(`S19 catalogue ready: two rows; revision ${catalog.revision}.`);
