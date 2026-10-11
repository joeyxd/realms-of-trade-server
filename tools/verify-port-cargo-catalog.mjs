// Verify S17 source hashes, catalogue preservation, evidence inventory and served bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validatePortCargoRuntime, validatePortCargoSnapshot } from './register-port-cargo-catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = 'tools/art-catalog/catalog.json';
const baselineCatalogPath = 'docs/art/source/port-cargo-v1/before/catalog.source.json';
const brief = 'docs/briefs/visual-s17-port-cargo.md';
const report = 'docs/delivery/port-cargo-v1.md';
const runtimePath = 'docs/art/port-cargo/runtime-evidence-v1.json';
const snapshotPath = 'docs/art/source/port-cargo-v1/final/source-snapshot.json';
const beforeDevices = ['desktop', 'mobile', 'low'];
const afterDevices = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-albedo', 'missing-normal', 'missing-crate', 'portrait'];
const views = ['overview', 'barrel', 'crate'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const beforeCatalog = readJson(baselineCatalogPath);
const catalog = readJson(catalogPath);
const runtime = readJson(runtimePath);
const snapshot = readJson(snapshotPath);
validatePortCargoRuntime(runtime);
validatePortCargoSnapshot();
assert(snapshot.schema === 1 && snapshot.family === 'port-cargo-v1' && snapshot.sources?.length === 8, 'Invalid S17 source receipt.');
for (const entry of snapshot.sources) {
  const bytes = fs.readFileSync(path.join(root, entry.snapshot));
  assert(bytes.length === entry.bytes && sha(bytes) === entry.sha256, `Frozen source mismatch: ${entry.snapshot}`);
}
assert(snapshot.reusedAssets?.length === 5, 'S17 reused asset inventory differs.');
for (const item of snapshot.reusedAssets) {
  const expectedId = item.path.endsWith('.glb') ? 'prop:storage-crate' : item.path.includes('atlas-normal') ? 'tex:town-wood-normal-v1' : 'tex:town-wood-albedo-v1';
  assert(item.id === expectedId, `Reused asset registry ID differs: ${item.path}`);
  const bytes = fs.readFileSync(path.join(root, item.path));
  assert(bytes.length === item.bytes && sha(bytes) === item.sha256, `Reused asset mismatch: ${item.path}`);
}
const screenshots = [...beforeDevices.map(device => ({ phase: 'before', device })), ...afterDevices.map(device => ({ phase: 'after', device }))]
  .flatMap(({ phase, device }) => views.map(view => `docs/art/port-cargo/${device}-${view}-${phase}-v1.png`));
assert(screenshots.length === 36, 'Expected 36 S17 screenshots.');
const ids = ['barril', 'crate-integrada'];
const rows = new Map(ids.map(id => {
  const row = catalog.rows.find(item => item.id === id);
  assert(row?.state === 'applied', `S17 row missing or unapplied: ${id}`);
  return [id, row];
}));
const oldRows = new Map(ids.map(id => [id, beforeCatalog.rows.find(item => item.id === id)]));
for (const id of ids) {
  const row = rows.get(id), old = oldRows.get(id);
  assert(old && row.references?.some(item => old.references?.some(prior => prior.path === item.path)), `Existing references were not preserved: ${id}`);
  assert(old.files?.every(prior => row.files?.some(item => item.path === prior.path)), `Existing files were not preserved: ${id}`);
  assert(old.evidence?.every(prior => row.evidence?.some(item => item.path === prior.path)), `Existing evidence was not preserved: ${id}`);
  assert(row.references.some(item => item.path === brief && item.role === 'reference'), `S17 brief link missing: ${id}`);
  const preview = id === 'barril' ? 'docs/art/port-cargo/desktop-barrel-after-v1.png' : 'docs/art/port-cargo/desktop-crate-after-v1.png';
  assert(row.references.some(item => item.path === preview && item.role === 'preview'), `S17 preview missing: ${id}`);
  for (const entry of snapshot.sources) assert(row.files.some(item => item.path === entry.snapshot), `Source snapshot unlinked: ${id}/${entry.snapshot}`);
  for (const required of [baselineCatalogPath, snapshotPath, runtimePath, report, ...screenshots,
    'assets/textures/town-wood-v1/atlas-albedo-desktop.webp', 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp',
    'assets/textures/town-wood-v1/atlas-normal-desktop.webp', 'assets/textures/town-wood-v1/atlas-normal-mobile.webp',
    'assets/models/prop-storage-crate.glb']) assert([...row.files, ...row.evidence].some(item => item.path === required), `S17 artifact not linked: ${id}/${required}`);
}
assert(rows.get('crate-integrada').files.some(item => item.path === 'assets/models/prop-storage-crate.glb'), 'Existing crate model link was lost.');
for (const relative of [brief, report, runtimePath, snapshotPath, ...screenshots]) assert(fs.existsSync(path.join(root, relative)), `Missing S17 artifact: ${relative}`);

const paths = new Set([brief, report, runtimePath, snapshotPath, ...screenshots]);
for (const row of rows.values()) for (const link of [...row.references || [], ...row.files || [], ...row.evidence || []]) if (link.path) paths.add(link.path);
const base = process.env.PORT_CARGO_CATALOG_BASE || 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async relative => {
  const local = fs.readFileSync(path.join(root, relative));
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${base}/files/${encoded}`);
  assert(response.ok, `HTTP ${response.status} for ${relative}.`);
  const remote = Buffer.from(await response.arrayBuffer());
  assert(sha(remote) === sha(local), `Served bytes differ: ${relative}.`);
}));
const response = await fetch(`${base}/api/catalog`);
assert(response.ok, `Active catalog HTTP ${response.status}.`);
const live = await response.json();
assert(live.revision === catalog.revision, `Active revision ${live.revision}; local ${catalog.revision}.`);
for (const id of ids) assert(JSON.stringify(live.rows?.find(row => row.id === id)) === JSON.stringify(rows.get(id)), `Active catalogue row differs: ${id}.`);
console.log(`S17 catalogue verified: ${paths.size} exact HTTP SHA-256 links; two rows and revision ${live.revision}.`);
