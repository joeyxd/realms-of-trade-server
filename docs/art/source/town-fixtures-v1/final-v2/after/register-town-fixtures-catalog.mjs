// Register S18 painted town fixtures after the serial browser evidence is ready.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'tools/art-catalog/catalog.json';
const SNAPSHOT = 'docs/art/source/town-fixtures-v1/final-v2/source-snapshot.json';
const BEFORE_CATALOG = 'docs/art/source/town-fixtures-v1/before/catalog.source.json';
const RUNTIME = 'docs/art/town-fixtures/runtime-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s18-town-fixtures.md';
const REPORT = 'docs/delivery/town-fixtures-v1.md';
const BEFORE = ['desktop'];
const AFTER = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-albedo', 'missing-normal', 'portrait'];
const VIEWS = ['overview', 'lantern', 'sign', 'cala-sign'];
const ATLAS = [
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-desktop.webp'],
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-mobile.webp'],
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const exists = file => fs.existsSync(path.join(ROOT, file));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const canonical = value => JSON.stringify(value, (key, current) => current && !Array.isArray(current) && typeof current === 'object'
  ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) : current);
const same = (a, b) => canonical(a) === canonical(b);
const link = (label, file, role) => ({ label, path: file, ...(role ? { role } : {}) });
const unique = values => [...new Map(values.map(value => [value.path, value])).values()];
const args = process.argv.slice(2);
const verifyOnly = args.length === 1 && args[0] === '--verify-only';
const runtimeOnly = args.length === 1 && args[0] === '--validate-runtime';
if (args.length && !verifyOnly && !runtimeOnly) throw Error('Usage: node tools/register-town-fixtures-catalog.mjs [--verify-only|--validate-runtime]');

function validateSources() {
  const receipt = readJson(SNAPSHOT);
  const expected = [['before', 'src/render/props.js'], ...[
    'src/render/props.js', 'src/render/townFixtures.js', 'tests/town-fixtures.test.mjs',
    'tools/qa-town-fixtures.playwright.js', 'tools/prepare-town-fixtures-sources.mjs',
    'tools/register-town-fixtures-catalog.mjs',
  ].map(source => ['after', source])];
  assert(receipt.schema === 1 && receipt.family === 'town-fixtures-v1' && receipt.sources?.length === 7, 'Invalid S18 source receipt.');
  const seen = new Set();
  for (const [phase, source] of expected) {
    const entries = receipt.sources.filter(item => item.phase === phase && item.source === source);
    assert(entries.length === 1, `Missing frozen ${phase} source: ${source}`);
    const entry = entries[0];
    const expectedSnapshot = phase === 'before' ? 'docs/art/source/town-fixtures-v1/before/props.source.js'
      : `docs/art/source/town-fixtures-v1/final-v2/after/${path.basename(source)}`;
    assert(entry.snapshot === expectedSnapshot, `Wrong frozen source path: ${source}`);
    assert(typeof entry.snapshot === 'string' && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), `Incomplete source receipt: ${source}`);
    assert(!seen.has(entry.snapshot), `Repeated frozen source: ${entry.snapshot}`); seen.add(entry.snapshot);
    const bytes = fs.readFileSync(path.join(ROOT, entry.snapshot));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Frozen source hash mismatch: ${entry.snapshot}`);
  }
  assert(same(receipt.reusedAssets?.map(({ id, path }) => ({ id, path })), ATLAS.map(([id, path]) => ({ id, path }))), 'S18 reused town wood asset paths differ.');
  for (const asset of receipt.reusedAssets) {
    const bytes = fs.readFileSync(path.join(ROOT, asset.path));
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, `Reused asset hash mismatch: ${asset.path}`);
  }
  return receipt;
}

function validateRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.schema === 1 && runtime.family === 'town-fixtures-v1', 'Invalid S18 runtime evidence.');
  assert(same(runtime.before?.map(item => item.device), BEFORE) && same(runtime.after?.map(item => item.device), AFTER), 'S18 contexts are incomplete or out of order.');
  const cases = [...runtime.before, ...runtime.after];
  const requestUrls = item => (item.requests || []).map(request => typeof request === 'string' ? request : request.url || request.href || '');
  const state = view => view.state || view;
  const empty = value => Array.isArray(value) ? value.length === 0 : value && Object.keys(value).length === 0;
  const consoleText = error => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.location?.url || error?.url || ''}`;
  for (const item of cases) {
    const mobile = ['mobile', 'low', 'portrait'].includes(item.device), disabled = item.device === 'disabled';
    const missing = item.device === 'missing-albedo' ? 'albedo' : item.device === 'missing-normal' ? 'normal' : null;
    assert((item.phase === 'before' && BEFORE.includes(item.device)) || (item.phase === 'after' && AFTER.includes(item.device)), `Unexpected S18 case ${item.phase}/${item.device}.`);
    assert(item.errors?.length === 0, `JavaScript errors in ${item.phase}/${item.device}.`);
    assert(item.fixtureCounts?.lantern === 8 && item.fixtureCounts?.sign === 2, `Fixture counts differ in ${item.phase}/${item.device}.`);
    assert(item.meshes?.length === (disabled ? 27 : 28), `Wrong mesh count in ${item.phase}/${item.device}.`);
    assert(item.views?.length === 4 && VIEWS.every(name => item.views.some(view => view.name === name)), `Four S18 views required in ${item.phase}/${item.device}.`);
    const allStates = [...item.views, ...item.transitions];
    const applied = !disabled && missing !== 'albedo';
    assert(item.transitions?.length === 4 && same(item.transitions.map(t => t.tier), ['high', 'low', 'medium', 'high']), `Wrong quality sequence: ${item.device}`);
    for (const view of allStates) {
      const s = state(view), fixture = s.portFixture;
      assert(s.glError === 0 && s.programsLinked === true && empty(s.gameErrors), `Runtime or GL failure in ${item.device}/${view.name}.`);
      assert(fixture && fixture.applied === applied && fixture.painted?.length === (item.phase === 'before' ? 0 : 2), `Fixture state missing in ${item.device}/${view.name}.`);
      if (item.phase === 'after') for (const sign of fixture.painted) {
        assert(sign.family === 'town-fixtures-v1' && sign.kind === 'sign' && sign.mapped === applied, `Wrong sign fallback: ${item.device}`);
        assert(applied ? sign.ink?.width === 256 && sign.ink.height === 256 && sign.ink.colorSpace === 'srgb' : sign.ink === null, `Wrong glyph canvas: ${item.device}`);
      }
      const expectedSize = mobile ? 1024 : 2048;
      for (const channel of ['albedo', 'normal']) {
        const tex = fixture[channel];
        if (missing === channel) { assert(tex === null, `Missing texture still present: ${item.device}/${channel}`); continue; }
        if (disabled) { assert(tex === null, `Disabled assets still loaded ${channel} in ${item.device}.`); continue; }
        assert(tex && tex.width === expectedSize && tex.height === expectedSize, `Unexpected actual ${channel} dimensions in ${item.device}/${view.name}.`);
        if (channel === 'albedo') assert(/srgb/i.test(String(tex.colorSpace)), `Albedo color space is not sRGB in ${item.device}/${view.name}.`);
        else assert(tex.colorSpace === '', `Normal map must be linear in ${item.device}/${view.name}.`);
        const expectedSuffix = mobile ? '-mobile.webp' : '-desktop.webp';
        assert(tex.src === `textures/town-wood-v1/atlas-${channel}${expectedSuffix}`, `Wrong atlas source in ${item.device}`);
      }
      if (item.phase === 'after' && !disabled) {
        const expectedSuffix = mobile ? '-mobile.webp' : '-desktop.webp';
        for (const tex of [fixture.albedo, fixture.normal]) if (tex) assert(tex.src.endsWith(expectedSuffix), `Wrong atlas variant in ${item.device}/${view.name}.`);
        if (applied) assert(fixture.albedo.shared === true && (missing === 'normal' || fixture.normal.shared === true), `Town textures are not shared in ${item.device}/${view.name}.`);
      }
    }
    const woodRequests = requestUrls(item).filter(url => /town-wood-v1\/atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(url));
    if (disabled) assert(woodRequests.length === 0, `Disabled assets requested wood atlases in ${item.device}.`);
    else assert(woodRequests.length === 2, `Expected one albedo and one normal atlas request in ${item.device}.`);
    if (!disabled) for (const channel of ['albedo', 'normal']) assert(woodRequests.filter(url => url.endsWith(`atlas-${channel}-${mobile ? 'mobile' : 'desktop'}.webp`)).length === 1, `Atlas loaded twice or wrong variant in ${item.device}`);
    const expectedAssetError = missing ? `tex:town-wood-${missing}-v1` : null;
    for (const view of allStates) {
      const s = state(view);
      assert(s.assetErrors?.length === (missing ? 1 : 0) && (!missing || s.assetErrors[0].startsWith(expectedAssetError + ':')), `Unexpected asset failure in ${item.device}`);
      assert(same(s.portFixture, state(item.views[0]).portFixture), `Fixture resources changed between views/tiers in ${item.device}`);
    }
    if (missing) {
      const failed = woodRequests.filter(url => url.endsWith(`atlas-${missing}-desktop.webp`));
      const failures = item.consoleErrors || [];
      assert(failed.length === 1 && failures.some(e => /404/i.test(consoleText(e)) && consoleText(e).includes(`atlas-${missing}-desktop.webp`)), `Expected ${missing} 404 evidence in ${item.device}.`);
      assert(failures.every(e => /404/i.test(consoleText(e)) && (/favicon\.ico/i.test(consoleText(e)) || consoleText(e).includes(`atlas-${missing}-desktop.webp`))), `Unexpected console error in ${item.device}.`);
    } else assert((item.consoleErrors || []).every(e => /404/i.test(consoleText(e)) && /favicon\.ico/i.test(consoleText(e))), `Unexpected console errors in ${item.phase}/${item.device}.`);
    if (item.phase === 'after') assert(item.transitions?.length === 4 && item.transitions.every(entry => entry.reused === true), `Quality resources were not reused in ${item.device}.`);
  }
  const baseline = runtime.before[0];
  for (const item of cases) {
    assert(same(item.mapProps, baseline.mapProps) && same(item.lightSources, baseline.lightSources), `mapProps or lightSources changed in ${item.phase}/${item.device}.`);
  }
  return runtime;
}

if (runtimeOnly) { validateRuntime(); console.log('S18 runtime evidence validated: 9 contexts.'); process.exit(0); }
const snapshot = validateSources();
const runtime = validateRuntime();
const shots = [...runtime.before, ...runtime.after].flatMap(item => VIEWS.map(view => `docs/art/town-fixtures/${item.device}-${view}-${item.phase}-v1.png`));
assert(shots.length === 36, 'Expected 36 S18 screenshots.');
for (const file of [BRIEF, REPORT, RUNTIME, SNAPSHOT, BEFORE_CATALOG, ...shots, ...ATLAS.map(([, file]) => file)]) assert(exists(file), `Missing S18 artifact: ${file}`);

const catalogPath = path.join(ROOT, CATALOG), beforeBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(beforeBytes.toString('utf8'));
const original = readJson(BEFORE_CATALOG);
const ids = ['farol-pintado-v1', 'letreros-pintados-v1'];
const oldRows = catalog.rows.filter(row => !ids.includes(row.id));
assert(same(oldRows, original.rows), 'Pre-existing catalogue rows differ from the immutable S18 baseline.');
const oldComposite = catalog.rows.find(row => row.id === 'cuerda-mostrador-farol');
assert(oldComposite && same(oldComposite, original.rows.find(row => row.id === oldComposite.id)), 'Composite fixture catalogue row changed.');
const frozenLinks = snapshot.sources.map(entry => link(`Fuente congelada ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'));
const commonFiles = unique([
  ...ATLAS.map(([id, file]) => link(`Atlas de madera reutilizado · ${id}`, file, id.includes('normal') ? 'normal' : 'albedo')),
  link('Recibo de fuentes congeladas S18', SNAPSHOT, 'source'), ...frozenLinks,
  link('Catálogo de origen S18', BEFORE_CATALOG, 'source'), link('Evidencia runtime S18', RUNTIME),
  link('Brief visual S18', BRIEF, 'reference'), link('Entrega local S18', REPORT),
  link('Pruebas pertinentes S18 · 127 casos', 'docs/art/town-fixtures/tests-v1.log', 'source'),
]);
const evidence = unique([link('Evidencia runtime y estados S18', RUNTIME), link('Entrega local S18', REPORT), ...shots.map(file => link(`Captura · ${path.basename(file, '.png')}`, file))]);
const specs = [
  { id: 'farol-pintado-v1', name: 'Farol pintado de pueblo', kind: 'object', description: 'Farol de puesto con madera pintada y vidrio luminoso visible; reutiliza los atlas de madera existentes.', preview: 'docs/art/town-fixtures/desktop-lantern-after-v1.png' },
  { id: 'letreros-pintados-v1', name: 'Letreros pintados de pueblo', kind: 'object', description: 'Letreros de Caldera y Cala Calavera con letras y señales dibujadas en canvas local; sin descargas de textura.', preview: 'docs/art/town-fixtures/desktop-cala-sign-after-v1.png' },
];
const rows = specs.map(spec => ({
  id: spec.id, name: spec.name, category: 'Props de pueblo', kind: spec.kind,
  description: spec.description, priority: 'P0', state: 'applied', variants: spec.id.startsWith('farol') ? ['madera pintada y cristal luminoso'] : ['Caldera', 'Cala Calavera'],
  destination: ['src/render/props.js', 'src/render/townFixtures.js'],
  nextStep: 'Escala, lectura y rendimiento en dispositivos físicos pendientes.',
  notes: 'S18 aplicado localmente; reutiliza atlas albedo/normal de S14 y conserva el farol y las luces existentes.',
  references: [link('Brief visual S18 · fixtures de pueblo', BRIEF, 'reference'), link('Catálogo fuente inmutable S18', BEFORE_CATALOG, 'source'), link('Vista de gameplay aplicada', spec.preview, 'preview')],
  files: commonFiles, evidence: unique([...evidence, link('Vista de gameplay aplicada', spec.preview, 'preview')]),
}));
for (const row of rows) for (const item of [...row.references, ...row.files, ...row.evidence]) assert(exists(item.path), `Missing catalogue link: ${item.path}`);

let changed = false;
for (const row of rows) {
  const existing = catalog.rows.find(item => item.id === row.id);
  if (existing) assert(same(existing, row), `S18 catalogue row differs; refusing overwrite: ${row.id}`);
  else if (!verifyOnly) { catalog.rows.push(row); changed = true; }
  else throw Error(`S18 catalogue row is missing: ${row.id}`);
}
if (verifyOnly) {
  for (const row of rows) assert(same(catalog.rows.find(item => item.id === row.id), row), `S18 row verification failed: ${row.id}`);
} else {
  // Any previously present, exact row is idempotent; append only missing rows.
  const finalRows = [...oldRows, ...rows];
  if (changed) {
    catalog.rows = finalRows;
    catalog.revision++;
    catalog.updatedAt = new Date().toISOString();
    const temp = `${catalogPath}.${process.pid}.town-fixtures.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
      if (!fs.readFileSync(catalogPath).equals(beforeBytes)) throw Error('Catalogue changed concurrently; preserving newer bytes.');
      fs.renameSync(temp, catalogPath);
    } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  }
}

if (verifyOnly) {
  const paths = new Set([...rows.flatMap(row => [...row.references, ...row.files, ...row.evidence].map(item => item.path)), BEFORE_CATALOG]);
  const base = process.env.TOWN_FIXTURES_CATALOG_BASE || 'http://127.0.0.1:5190';
  await Promise.all([...paths].map(async relative => {
    const local = fs.readFileSync(path.join(ROOT, relative));
    const response = await fetch(`${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`);
    assert(response.ok, `HTTP ${response.status} for ${relative}.`);
    assert(hash(Buffer.from(await response.arrayBuffer())) === hash(local), `Served bytes differ: ${relative}.`);
  }));
  const response = await fetch(`${base}/api/catalog`);
  assert(response.ok, `Active catalogue HTTP ${response.status}.`);
  const live = await response.json();
  assert(live.revision === catalog.revision, `Active revision ${live.revision}; local ${catalog.revision}.`);
  for (const row of rows) assert(same(live.rows?.find(item => item.id === row.id), row), `Active catalogue row differs: ${row.id}.`);
  console.log(`S18 catalog verified: ${paths.size} HTTP links SHA-256 matched; two rows and revision ${live.revision}.`);
} else console.log(`S18 catalogue ready: two rows; revision ${catalog.revision}.`);
