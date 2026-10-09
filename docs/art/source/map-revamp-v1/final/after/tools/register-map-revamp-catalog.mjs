// Register S21 only after the supplied terrain runtime, source, and layout evidence is complete.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FAMILY = 'map-revamp-v1';
const ID = 'isla-terrazas-v1';
const CATALOG = 'tools/art-catalog/catalog.json';
const BASELINE_CATALOG = `docs/art/source/${FAMILY}/before/catalog.json`;
const SNAPSHOT = `docs/art/source/${FAMILY}/final/source-snapshot.json`;
const RUNTIME = 'docs/art/map-revamp/runtime-evidence-v1.json';
const LAYOUT = 'docs/art/map-revamp/layout-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s21-map-revamp.md';
const REPORT = 'docs/delivery/map-revamp-v1.md';
const TEST_LOG = 'docs/art/map-revamp/tests-v1.log';
const MAP_PANEL = 'docs/art/map-revamp/map-ui-evidence-v1.json';
const PANEL_SCREENSHOTS = ['desktop', 'mobile'].map(device => `docs/art/map-revamp/${device}-map-panel-after-v1.png`);
const BEFORE_DEVICES = ['desktop'];
const AFTER_DEVICES = ['desktop', 'mobile', 'low', 'portrait', 'noassets'];
const VIEWS = ['town', 'island', 'volcano', 'boss', 'pvp'];
const TIERS = ['high', 'low', 'medium', 'high'];
const SOURCE_PATHS = ['src/sim/worldgen.js', 'src/render/terrain.js', 'src/data/resources.js', 'src/ui/mapview.js'];
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
if (args.length && !verifyOnly) throw Error('Usage: node tools/register-map-revamp-catalog.mjs [--verify-only]');

function validateSources() {
  const receipt = readJson(SNAPSHOT);
  assert(receipt.family === FAMILY && Array.isArray(receipt.files) && receipt.files.length > 0, 'Invalid S21 source snapshot receipt.');
  assert(Array.isArray(receipt.reusedAssets) && receipt.reusedAssets.length === 0, 'S21 must not add or claim reused assets.');
  const seen = new Set();
  for (const entry of receipt.files) {
    assert(typeof entry.path === 'string' && Number.isInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/.test(entry.sha256), 'Malformed frozen source entry.');
    assert(!seen.has(entry.path), `Repeated frozen source path: ${entry.path}`); seen.add(entry.path);
    const bytes = fs.readFileSync(full(entry.path));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Frozen source hash mismatch: ${entry.path}`);
  }
  return receipt;
}

function validateRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.family === FAMILY, 'Invalid S21 runtime evidence family.');
  const before = Array.isArray(runtime.before) ? runtime.before : runtime.before ? [runtime.before] : [];
  const after = runtime.after;
  assert(before.length === 1 && before[0].device === 'desktop' && (before[0].phase === undefined || before[0].phase === 'before'), 'S21 requires one desktop before capture.');
  assert(Array.isArray(after) && same(after.map(item => item.device), AFTER_DEVICES) && after.every(item => item.phase === 'after'), 'S21 after contexts are incomplete or out of order.');
  const cases = [...before, ...after];
  const statesOf = item => [item.initialState, ...(item.views || []).map(view => view.state || view), ...(item.transitions || []).map(value => value.state || value)].filter(Boolean);
  const stableNode = ({ y, ...node }) => node;
  const nodesOf = item => item.resourceNodes?.nodes || item.resources?.nodes || item.nodes || [];
  const benchOf = item => item.resourceNodes?.bench || item.resources?.bench || item.bench;
  const propsOf = item => item.map?.propsXZ || item.propsXZ;
  const fullPropsOf = item => item.map?.props || item.props;
  const gameContractOf = item => item.map?.gameplayContract || item.gameplayContract;
  const dressingOf = item => item.dressing;
  const emptyErrors = value => Array.isArray(value) ? value.length === 0 : !!value && typeof value === 'object' && Object.keys(value).length === 0;
  const consoleErrorsClean = item => Array.isArray(item.consoleErrors) && item.consoleErrors.every(error => {
    const text = typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.location?.url || error?.url || ''}`;
    return /404/i.test(text) && /favicon\.ico/i.test(text);
  });
  for (const item of cases) {
    assert(Array.isArray(item.errors) && item.errors.length === 0, `JavaScript errors in ${item.phase}/${item.device}.`);
    assert(consoleErrorsClean(item), `Unexpected console error in ${item.phase}/${item.device}.`);
    assert(Array.isArray(item.views) && item.views.length === VIEWS.length && same(item.views.map(view => view.name).sort(), [...VIEWS].sort()), `S21 views incomplete in ${item.phase}/${item.device}.`);
    for (const state of statesOf(item)) {
      assert(state.glError === 0 && state.programLinked === true && emptyErrors(state.gameErrors), `GL or game error in ${item.phase}/${item.device}.`);
      assert(Array.isArray(state.assetErrors) && state.assetErrors.length === 0, `Asset errors in ${item.phase}/${item.device}.`);
    }
    if (item.phase === 'after') {
      assert(Array.isArray(item.transitions) && same(item.transitions.map(value => value.tier), TIERS), `Quality transitions incomplete in ${item.device}.`);
      assert(item.transitions.every(value => value.terrainGeometryReused === true && value.heightTextureReused === true), `Terrain geometry or height texture recreated in ${item.device}.`);
    }
  }
  const baseline = before[0], baseProps = propsOf(baseline), baseNodes = nodesOf(baseline);
  assert(Array.isArray(baseProps), 'Before evidence is missing propsXZ.');
  assert(Array.isArray(fullPropsOf(baseline)), 'Before evidence is missing full props.');
  assert(benchOf(baseline) && typeof benchOf(baseline) === 'object', 'Before evidence is missing the resource bench.');
  assert(baseNodes.length === 176, `Expected 176 before resource nodes; got ${baseNodes.length}.`);
  const nodeSignature = nodes => nodes.map(stableNode).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const propsSignature = props => props.map(({ y, ...prop }) => prop);
  const baseDressing = dressingOf(baseline);
  assert(baseDressing && ['grass', 'debris', 'seaweed'].every(key => baseDressing[key] !== undefined) && baseDressing.metadata !== undefined, 'Before evidence is missing dressing contracts or metadata.');
  for (const item of cases) {
    assert(same(propsOf(item), baseProps), `propsXZ changed in ${item.phase}/${item.device}.`);
    assert(same(propsSignature(fullPropsOf(item)), propsSignature(fullPropsOf(baseline))), `Full prop metadata changed in ${item.phase}/${item.device}.`);
    assert(same(gameContractOf(item), gameContractOf(baseline)), `Gameplay contract changed in ${item.phase}/${item.device}.`);
    const dressing = dressingOf(item);
    assert(dressing && ['grass', 'debris', 'seaweed'].every(key => dressing[key] !== undefined), `Dressing contracts missing in ${item.phase}/${item.device}.`);
    for (const key of ['grass', 'debris', 'seaweed']) assert(same(dressing[key], baseDressing[key]), `${key} dressing changed in ${item.phase}/${item.device}.`);
    if (item.device !== 'noassets') assert(same(dressing.metadata, baseDressing.metadata), `Dressing metadata changed in ${item.phase}/${item.device}.`);
    const nodes = nodesOf(item);
    assert(nodes.length === 176 && same(nodeSignature(nodes), nodeSignature(baseNodes)), `Resource-node layout changed in ${item.phase}/${item.device}.`);
    assert(same(stableNode(benchOf(item)), stableNode(benchOf(baseline))), `Resource bench changed in ${item.phase}/${item.device}.`);
  }
  return { runtime, cases, before, after };
}

const snapshot = validateSources();
const { runtime, before, after } = validateRuntime();
const baseline = readJson(BASELINE_CATALOG);
const catalogPath = full(CATALOG), catalogBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
assert(baseline.revision === 34 && Array.isArray(baseline.rows) && baseline.rows.length === 109, 'S21 baseline must be revision 34 with 109 rows.');
assert(baseline.rows.filter(row => row.state === 'applied').length === 53, 'S21 baseline must contain 53 applied rows.');
assert(catalog.revision === 34 || (catalog.revision === 35 && catalog.rows.length === 110), 'S21 current catalogue revision changed unexpectedly.');
assert(same(catalog.rows.filter(row => row.id !== ID), baseline.rows), 'Pre-existing catalogue rows differ from the immutable S21 baseline.');

const screenshots = [...before, ...after].flatMap(item => VIEWS.map(view => `docs/art/map-revamp/${item.device}-${view}-${item.phase}-v1.png`));
assert(screenshots.length === 30, 'Expected 30 S21 terrain screenshots.');
for (const file of [BRIEF, REPORT, LAYOUT, RUNTIME, SNAPSHOT, BASELINE_CATALOG, TEST_LOG, MAP_PANEL, ...PANEL_SCREENSHOTS, ...screenshots]) assert(exists(file), `Missing S21 artifact: ${file}`);
const panel = readJson(MAP_PANEL);
assert(panel.family === FAMILY && same(panel.cases.map(value => value.device), ['desktop', 'mobile']), 'S21 map-panel cases incomplete.');
for (const item of panel.cases) {
  const s = item.state;
  assert(s.open && s.span === 255 && s.size === 560 && s.glError === 0 && !Object.keys(s.gameErrors).length && !s.assetErrors.length && !item.errors.length && item.closePassed, `Map panel failed in ${item.device}.`);
  assert(s.pins.every(pin => pin.every(n => Number.isFinite(n) && n >= 0 && n <= 100)), `Map pin clipped in ${item.device}.`);
}
const testLog = fs.readFileSync(full(TEST_LOG), 'utf8');
const testCount = testLog.match(/^[#ℹ]\s*tests\s+(\d+)\s*$/m), passCount = testLog.match(/^[#ℹ]\s*pass\s+(\d+)\s*$/m);
const failCount = testLog.match(/^[#ℹ]\s*fail\s+(\d+)\s*$/m), cancelledCount = testLog.match(/^[#ℹ]\s*cancelled\s+(\d+)\s*$/m), skippedCount = testLog.match(/^[#ℹ]\s*skipped\s+(\d+)\s*$/m);
assert(testCount?.[1] === '220' && passCount?.[1] === '220' && failCount?.[1] === '0' && cancelledCount?.[1] === '0' && skippedCount?.[1] === '0',
  'S21 test log must report 220 tests, 220 passed, and zero failed, cancelled, or skipped.');

const sourceLinks = snapshot.files.map(entry => link(`Fuente S21 - ${entry.path}`, entry.path, 'source'));
const runtimeLinks = [link('Evidencia runtime S21', RUNTIME), link('Mapa M - evidencia PC y movil', MAP_PANEL), ...PANEL_SCREENSHOTS.map(file => link(`Mapa M - ${path.basename(file, '.png')}`, file)), ...screenshots.map(file => link(`Captura - ${path.basename(file, '.png')}`, file))];
const row = {
  id: ID,
  name: 'Isla ampliada y pueblo en terrazas',
  category: 'Terreno y naturaleza',
  priority: 'P0',
  kind: 'material',
  description: 'Isla ampliada con terreno escalonado para el pueblo, manteniendo espacio y recorridos hacia el volcán, el jefe y la zona PvP de Cala Calavera.',
  variants: ['pueblo en terrazas', 'isla ampliada', 'volcán y caldera', 'Cala Calavera PvP'],
  destination: SOURCE_PATHS,
  state: 'applied',
  nextStep: 'Revisar escala y lectura del terreno con el autor en escritorio y móvil físicos.',
  notes: 'S21 aplicado localmente. El alcance cambia terreno y distribuye el espacio de las zonas; conserva props y nodos de recursos, sin introducir assets nuevos.',
  references: [
    link('Brief visual S21 - revamp del mapa', BRIEF, 'reference'),
    link('Catálogo fuente inmutable S21 - revisión 34', BASELINE_CATALOG, 'source'),
    link('Layout y contratos de terreno S21', LAYOUT, 'source'),
  ],
  files: uniquePaths([
    link('Entrega local S21', REPORT),
    link('Snapshot de fuentes y hashes S21', SNAPSHOT, 'source'),
    ...sourceLinks,
    link('Registro de pruebas S21', TEST_LOG, 'source'),
  ]),
  evidence: uniquePaths([
    ...runtimeLinks,
    link('Layout y contratos de terreno S21', LAYOUT, 'source'),
    link('Entrega local S21', REPORT),
  ]),
};
for (const item of [...row.references, ...row.files, ...row.evidence]) assert(exists(item.path), `Missing catalogue link: ${item.path}`);

const existing = catalog.rows.find(value => value.id === ID);
if (existing) assert(same(existing, row), `Existing S21 row differs; refusing overwrite: ${ID}`);
else {
  assert(catalog.revision === 34 && catalog.rows.length === 109, 'S21 registration requires current revision 34 with 109 rows.');
  if (verifyOnly) throw Error(`S21 catalogue row is missing: ${ID}`);
  catalog.rows.push(row);
}

if (!verifyOnly && !existing) {
  catalog.revision = 35;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.map-revamp.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(catalogBytes)) throw Error('Catalogue changed concurrently; preserving newer bytes.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}

if (verifyOnly) {
  const paths = [...new Set([...row.references, ...row.files, ...row.evidence].map(item => item.path).concat(BASELINE_CATALOG))];
  const base = process.env.MAP_REVAMP_CATALOG_BASE || 'http://127.0.0.1:5190';
  for (const relative of paths) {
    const expectedHash = hash(fs.readFileSync(full(relative)));
    const response = await fetch(`${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`);
    assert(response.ok, `HTTP ${response.status} for ${relative}.`);
    assert(hash(Buffer.from(await response.arrayBuffer())) === expectedHash, `Served bytes differ: ${relative}.`);
  }
  const response = await fetch(`${base}/api/catalog`);
  assert(response.ok, `Active catalogue HTTP ${response.status}.`);
  assert(same(await response.json(), catalog), 'API catalogue differs from local catalogue.');
  console.log(`S21 catalogue verified: ${paths.length} linked paths; revision ${catalog.revision}, ${catalog.rows.length} rows.`);
} else console.log(`S21 catalogue ready: one terrain row; revision ${catalog.revision}, ${catalog.rows.length} rows.`);
