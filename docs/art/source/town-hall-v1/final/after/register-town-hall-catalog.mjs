// Register S20 town hall after runtime evidence and frozen sources exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FAMILY = 'town-hall-v1';
const CATALOG = 'tools/art-catalog/catalog.json';
const DIR = `docs/art/source/${FAMILY}`;
const BEFORE_CATALOG = `${DIR}/before/catalog.source.json`;
const SNAPSHOT = `${DIR}/final/source-snapshot.json`;
const RUNTIME = 'docs/art/town-hall/runtime-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s20-town-hall.md';
const REPORT = 'docs/delivery/town-hall-v1.md';
const GEOMETRY = 'docs/art/town-hall/geometry-review-v1.json';
const TEST_LOG = 'docs/art/town-hall/tests-v1.log';
const BEFORE = ['desktop'];
const AFTER = ['desktop', 'mobile', 'low', 'disabled', 'missing-albedo', 'missing-normal', 'portrait'];
const VIEWS = ['hall', 'arrival', 'overview'];
const TIERS = ['high', 'low', 'medium', 'high'];
const ATLAS = [
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp', 'albedo'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-desktop.webp', 'normal'],
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp', 'albedo'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-mobile.webp', 'normal'],
];
const ID = 'fachada-salty-shore-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const full = file => path.join(ROOT, file);
const readJson = file => JSON.parse(fs.readFileSync(full(file), 'utf8'));
const exists = file => fs.existsSync(full(file));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const canonical = value => JSON.stringify(value, (key, current) => current && !Array.isArray(current) && typeof current === 'object'
  ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) : current);
const same = (a, b) => canonical(a) === canonical(b);
const link = (label, file, role) => ({ label, path: file, ...(role ? { role } : {}) });
const uniquePaths = values => [...new Map(values.map(value => [value.path, value])).values()];
const args = process.argv.slice(2);
const verifyOnly = args.length === 1 && args[0] === '--verify-only';
const runtimeOnly = args.length === 1 && args[0] === '--validate-runtime';
if (args.length && !verifyOnly && !runtimeOnly) throw Error('Usage: node tools/register-town-hall-catalog.mjs [--verify-only|--validate-runtime]');

function validateSources() {
  const receipt = readJson(SNAPSHOT);
  const expected = [
    ['before', 'src/render/props.js'],
    ...['src/render/props.js', 'src/render/townHall.js', 'tests/town-hall.test.mjs',
      'tools/qa-town-hall.playwright.js', 'tools/prepare-town-hall-sources.mjs',
      'tools/register-town-hall-catalog.mjs'].map(source => ['after', source]),
  ];
  assert(receipt.schema === 1 && receipt.family === FAMILY && receipt.sources?.length === 7, 'Invalid S20 source receipt.');
  const seen = new Set();
  for (const [phase, source] of expected) {
    const matches = receipt.sources.filter(item => item.phase === phase && item.source === source);
    assert(matches.length === 1, `Missing frozen ${phase} source: ${source}`);
    const entry = matches[0];
    const expectedPath = phase === 'before' ? `${DIR}/before/props.js` : `${DIR}/final/after/${path.basename(source)}`;
    assert(entry.snapshot === expectedPath && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), `Invalid frozen source: ${source}`);
    assert(!seen.has(entry.snapshot), `Repeated source snapshot: ${entry.snapshot}`); seen.add(entry.snapshot);
    const bytes = fs.readFileSync(full(entry.snapshot));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Frozen source hash mismatch: ${entry.snapshot}`);
  }
  assert(same(receipt.reusedAssets?.map(({ id, path: file }) => ({ id, path: file })), ATLAS.map(([id, file]) => ({ id, path: file }))), 'S20 reused asset paths differ.');
  for (const asset of receipt.reusedAssets) {
    const bytes = fs.readFileSync(full(asset.path));
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, `Reused town asset hash mismatch: ${asset.path}`);
  }
  return receipt;
}

function validateRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.schema === 1 && runtime.family === FAMILY, 'Invalid S20 runtime evidence.');
  assert(same(runtime.before?.map(item => item.device), BEFORE) && same(runtime.after?.map(item => item.device), AFTER), 'S20 runtime contexts are incomplete or out of order.');
  const cases = [...runtime.before, ...runtime.after];
  const stateOf = item => item.state || item;
  const requestUrls = item => (item.requests || []).map(request => typeof request === 'string' ? request : request.url || request.href || '');
  const empty = value => Array.isArray(value) ? value.length === 0 : !!value && typeof value === 'object' && Object.keys(value).length === 0;
  const errorText = error => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.location?.url || error?.url || ''}`;
  for (const item of cases) {
    const mobile = ['mobile', 'low', 'portrait'].includes(item.device);
    const disabled = item.device === 'disabled';
    const missing = item.device === 'missing-albedo' ? 'albedo' : item.device === 'missing-normal' ? 'normal' : null;
    assert(Array.isArray(item.errors) && item.errors.length === 0, `JavaScript errors in ${item.phase}/${item.device}.`);
    assert(Array.isArray(item.views) && item.views.length === 3 && VIEWS.every(name => item.views.some(view => view.name === name)), `S20 views incomplete in ${item.phase}/${item.device}.`);
    if (item.phase === 'after') assert(Array.isArray(item.transitions) && same(item.transitions.map(value => value.tier), TIERS), `Wrong quality sequence in ${item.device}.`);
    const states = [...item.views, ...(item.transitions || [])];
    for (const view of states) {
      const state = stateOf(view), hall = state.hall;
      assert(state.glError === 0 && state.programsLinked === true && empty(state.gameErrors), `Runtime or GL failure in ${item.device}/${view.name || view.tier}.`);
      const applied = item.phase === 'after' && !disabled && missing !== 'albedo';
      assert(hall && hall.applied === applied, `Unexpected hall fallback in ${item.device}/${view.name || view.tier}.`);
      if (!applied) assert(hall.metadata === null && hall.banner === null, `Unexpected hall metadata or banner in ${item.device}.`);
      else {
        const metadata = hall.metadata;
        assert(metadata?.family === FAMILY && metadata.anchor && ['x', 'y', 'z', 'rot', 'scale'].every(key => Number.isFinite(metadata.anchor[key])) &&
          same(metadata.canvas, [256, 256]) && metadata.texturesDownloaded === 0, `Invalid town hall metadata in ${item.device}.`);
        const banner = hall.banner;
        assert(banner && typeof banner.geometry === 'string' && typeof banner.material === 'string' &&
          typeof banner.texture === 'string' &&
          banner.width === 256 && banner.height === 256 && /srgb/i.test(String(banner.colorSpace)) &&
          banner.triangles === 72 && banner.castShadow === true && banner.receiveShadow === true,
        `Invalid banner geometry or material evidence in ${item.device}.`);
      }
      for (const channel of ['albedo', 'normal']) {
        const texture = hall[channel];
        if (disabled || missing === channel) assert(texture === null, `Unexpected ${channel} texture in ${item.device}.`);
        else assert(texture !== null, `Missing ${channel} atlas in ${item.device}.`);
        if (texture) {
          assert(typeof texture.src === 'string' && typeof texture.textureRef === 'string' &&
            texture.width === (mobile ? 1024 : 2048) && texture.height === (mobile ? 1024 : 2048), `Invalid ${channel} atlas in ${item.device}.`);
          assert(channel === 'albedo' ? /srgb/i.test(String(texture.colorSpace)) : texture.colorSpace === '', `Wrong ${channel} atlas color space in ${item.device}.`);
          assert(texture.src === `textures/town-wood-v1/atlas-${channel}-${mobile ? 'mobile' : 'desktop'}.webp`, `Wrong ${channel} atlas in ${item.device}.`);
        }
      }
      assert(Array.isArray(state.assetErrors) && state.assetErrors.length === (item.phase === 'after' && missing ? 1 : 0), `Unexpected asset errors in ${item.device}.`);
      if (item.phase === 'after' && missing) assert(String(state.assetErrors[0]).startsWith(`tex:town-wood-${missing}-v1:`), `Wrong missing asset ID in ${item.device}.`);
    }
    if (item.phase === 'after') {
      const urls = requestUrls(item).filter(url => /town-wood-v1\/atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(url));
      assert(disabled ? urls.length === 0 : urls.length === 2, `Unexpected town atlas requests in ${item.device}.`);
      if (!disabled) for (const channel of ['albedo', 'normal']) assert(urls.filter(url => url.endsWith(`atlas-${channel}-${mobile ? 'mobile' : 'desktop'}.webp`)).length === 1, `Repeated or wrong ${channel} request in ${item.device}.`);
      if (missing) assert((item.consoleErrors || []).some(error => /404/i.test(errorText(error)) && errorText(error).includes(`atlas-${missing}-desktop.webp`)), `Missing ${missing} 404 evidence.`);
      assert((item.consoleErrors || []).every(error => /404/i.test(errorText(error)) && (missing ? errorText(error).includes(`atlas-${missing}-desktop.webp`) || /favicon\.ico/i.test(errorText(error)) : /favicon\.ico/i.test(errorText(error)))), `Unexpected console error in ${item.device}.`);
      assert(item.transitions.every(entry => entry.reused === true), `Hall resources were recreated by quality change in ${item.device}.`);
      for (const transition of item.transitions) assert(same(transition.hall, item.views[0].state.hall), `Hall resources changed by quality tier in ${item.device}.`);
    }
  }
  const baseline = runtime.before[0];
  for (const item of cases) {
    for (const key of ['mapProps', 'mapContract', 'resourceAnchor', 'resourceNodes', 'hallAnchor'])
      assert(same(item[key], baseline[key]), `${key} changed in ${item.phase}/${item.device}.`);
    for (const view of item.views) if (view.state.hall.applied) assert(same(view.state.hall.metadata.anchor, item.hallAnchor), 'Hall render anchor differs from selected hut.');
  }
  return runtime;
}

if (runtimeOnly) { validateRuntime(); console.log('S20 runtime evidence validated: 8 contexts.'); process.exit(0); }
const snapshot = validateSources();
const runtime = validateRuntime();
const screenshots = [...runtime.before, ...runtime.after].flatMap(item => VIEWS.map(view => `docs/art/town-hall/${item.device}-${view.name || view}-${item.phase}-v1.png`));
assert(screenshots.length === 24, 'Expected 24 S20 screenshots.');
for (const file of [BRIEF, REPORT, GEOMETRY, RUNTIME, SNAPSHOT, BEFORE_CATALOG, TEST_LOG, ...screenshots, ...ATLAS.map(([, file]) => file)])
  assert(exists(file), `Missing S20 artifact: ${file}`);

const catalogPath = full(CATALOG), catalogBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
const original = readJson(BEFORE_CATALOG);
assert(original.revision === 33 && Array.isArray(original.rows) && original.rows.length === 108, 'S20 baseline must be revision 33 with 108 rows.');
assert(same(catalog.rows.filter(row => row.id !== ID), original.rows), 'Pre-existing catalogue rows differ from the immutable S20 baseline.');
const frozenLinks = snapshot.sources.map(entry => link(`Fuente congelada ${entry.phase} · ${entry.source}`, entry.snapshot, 'source'));
const reusedLinks = ATLAS.map(([id, file, channel]) => link(`Atlas de madera reutilizado · ${id} · ${path.basename(file)}`, file, channel));
const commonFiles = uniquePaths([
  ...reusedLinks, link('Recibo de fuentes congeladas S20', SNAPSHOT, 'source'), ...frozenLinks,
  link('Catálogo fuente inmutable S20', BEFORE_CATALOG, 'source'), link('Evidencia runtime S20', RUNTIME),
  link('Brief visual S20', BRIEF, 'reference'), link('Entrega local S20', REPORT), link('Registro de pruebas S20', TEST_LOG, 'source'),
  link('Comparación independiente de geometría S20', GEOMETRY, 'source'),
]);
const evidence = uniquePaths([link('Evidencia runtime y estados S20', RUNTIME), link('Entrega local S20', REPORT), link('Comparación de geometría S20', GEOMETRY),
  ...screenshots.map(file => link(`Captura · ${path.basename(file, '.png')}`, file))]);
const preview = 'docs/art/town-hall/desktop-hall-after-v1.png';
const row = {
  id: ID, name: 'Fachada de Salty Shore', category: 'Props de pueblo', kind: 'object',
  description: 'Tela roja con ancla y letras, soportes de madera y mástil corto en una cabaña existente orientada al puerto; decoración sobre el tejado, sin nueva interacción.',
  priority: 'P0', state: 'applied', variants: ['Salty Shore'],
  destination: ['src/render/props.js', 'src/render/townHall.js'],
  nextStep: 'Escala, lectura y rendimiento en dispositivos físicos pendientes.',
  notes: 'S20 aplicado localmente; reutiliza los atlas PC/móvil de madera y pinta el estandarte en canvas sin descargar texturas.',
  references: [link('Brief visual S20 · fachada de Salty Shore', BRIEF, 'reference'), link('Catálogo fuente inmutable S20', BEFORE_CATALOG, 'source'), link('Vista aplicada', preview, 'preview')],
  files: commonFiles, evidence: uniquePaths([...evidence, link('Vista aplicada', preview, 'preview')]),
};
for (const item of [...row.references, ...row.files, ...row.evidence]) assert(exists(item.path), `Missing catalogue link: ${item.path}`);
const existing = catalog.rows.find(value => value.id === ID);
if (existing) assert(same(existing, row), `Existing S20 row differs; refusing overwrite: ${ID}`);
else if (verifyOnly) throw Error(`S20 catalogue row is missing: ${ID}`);
else catalog.rows.push(row);

if (!verifyOnly && !existing) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.town-hall.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(catalogBytes)) throw Error('Catalogue changed concurrently; preserving newer bytes.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
if (verifyOnly) {
  const paths = [...new Set([...row.references, ...row.files, ...row.evidence].map(item => item.path).concat(BEFORE_CATALOG))];
  const base = process.env.TOWN_HALL_CATALOG_BASE || 'http://127.0.0.1:5190';
  const digestByPath = new Map();
  for (const relative of paths) {
    const localHash = hash(fs.readFileSync(full(relative)));
    const response = await fetch(`${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`);
    assert(response.ok, `HTTP ${response.status} for ${relative}.`);
    assert(hash(Buffer.from(await response.arrayBuffer())) === localHash, `Served bytes differ: ${relative}.`);
    digestByPath.set(relative, localHash);
  }
  const response = await fetch(`${base}/api/catalog`);
  assert(response.ok, `Active catalogue HTTP ${response.status}.`);
  assert(same(await response.json(), catalog), 'API catalogue differs from local catalogue.');
  console.log(`S20 catalogue verified: ${digestByPath.size} distinct paths SHA-256 matched; revision ${catalog.revision}.`);
} else console.log(`S20 catalogue ready: one row; revision ${catalog.revision}.`);
