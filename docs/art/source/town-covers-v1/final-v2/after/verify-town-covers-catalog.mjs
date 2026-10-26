// Verify S15 catalogue links against the running local artifact service byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ids = ['town-thatch-v1', 'town-awning-v1'];
const required = [
  'docs/briefs/visual-s15-town-covers.md',
  'docs/delivery/town-covers-v1.md',
  'docs/art/town-covers/runtime-evidence-v1.json',
  'docs/art/source/town-covers-v1/final-v2/source-snapshot.json',
  'tools/prepare-town-covers-sources.mjs',
  'tools/register-town-covers-catalog.mjs',
  'tools/verify-town-covers-catalog.mjs',
  'tools/qa-town-covers.playwright.js',
  'tests/town-covers.test.mjs',
];
const rows = new Map();
for (const id of ids) {
  const row = catalog.rows.find(entry => entry.id === id);
  assert(row?.state === 'applied', `S15 row is missing or unapplied: ${id}`);
  rows.set(id, row);
  const linked = new Set([...row.references || [], ...row.files || [], ...row.evidence || []].map(item => item.path).filter(Boolean));
  for (const relative of required) assert(linked.has(relative), `Missing S15 link in ${id}: ${relative}`);
}
const thatch = rows.get('town-thatch-v1'), awning = rows.get('town-awning-v1');
assert(thatch.kind === 'material', 'Unexpected thatch catalogue kind.');
assert(awning.kind === 'object', 'Unexpected awning catalogue kind.');
for (const row of [thatch, awning]) {
  assert(row.files.some(item => item.path === 'assets/textures/raft/comic-materials-v1.webp'), `${row.id} is missing desktop shared atlas.`);
  assert(row.files.some(item => item.path === 'assets/textures/raft/comic-materials-v1-mobile.webp'), `${row.id} is missing mobile shared atlas.`);
  assert(row.references.some(item => item.path === 'docs/delivery/raft-comic-material.md'), `${row.id} is missing shared atlas source reference.`);
  assert(row.destination?.includes('src/render/townCovers.js'), `${row.id} destination is missing renderer.`);
}

const snapshotPath = 'docs/art/source/town-covers-v1/final-v2/source-snapshot.json';
const snapshot = JSON.parse(fs.readFileSync(path.join(root, snapshotPath), 'utf8'));
assert(snapshot.schema === 1 && snapshot.family === 'town-covers-v1' && snapshot.sources?.length === 8, 'Invalid S15 source receipt.');
for (const entry of snapshot.sources) {
  const bytes = fs.readFileSync(path.join(root, entry.snapshot));
  assert(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `Invalid frozen source: ${entry.snapshot}`);
}
const atlasPaths = ['assets/textures/raft/comic-materials-v1.webp', 'assets/textures/raft/comic-materials-v1-mobile.webp'];
assert(same(snapshot.reusedAssets?.map(({ id, path }) => ({ id, path })), [
  { id: 'tex:raft-comic-v1', path: atlasPaths[0] }, { id: 'tex:raft-comic-v1', path: atlasPaths[1] },
]), 'Invalid reused atlas metadata in S15 source receipt.');
for (const asset of snapshot.reusedAssets) {
  const bytes = fs.readFileSync(path.join(root, asset.path));
  assert(bytes.length === asset.bytes && sha256(bytes) === asset.sha256, `Invalid reused atlas hash: ${asset.path}`);
}

const runtime = JSON.parse(fs.readFileSync(path.join(root, 'docs/art/town-covers/runtime-evidence-v1.json'), 'utf8'));
assert(runtime.schema === 1 && runtime.family === 'town-covers-v1', 'Invalid S15 runtime evidence.');
assert(JSON.stringify(runtime.before?.map(item => item.device)) === JSON.stringify(['desktop', 'mobile', 'low']), 'S15 before cases are incomplete or out of order.');
assert(JSON.stringify(runtime.after?.map(item => item.device)) === JSON.stringify(['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-cloth', 'portrait']), 'S15 after cases are incomplete or out of order.');
const allCases = [...runtime.before, ...runtime.after];
assert(runtime.before.every(item => item.phase === 'before') && runtime.after.every(item => item.phase === 'after'), 'S15 evidence phase labels are incorrect.');
for (const item of allCases) assert(same(item.mapProps, runtime.before[0].mapProps) && same(item.dock, runtime.before[0].dock), `Map/dock changed in ${item.phase}/${item.device}.`);
for (const item of runtime.after) assert(same(item.coverVertices, runtime.after[0].coverVertices), `Cover vertex counts differ in after/${item.device}.`);
const screenshots = allCases.flatMap(item => ['overview', 'house', 'stall', 'dock'].map(view =>
  `docs/art/town-covers/${item.device}-${view}-${item.phase}-v1.png`));
assert(screenshots.length === 40, 'Expected 40 S15 screenshots.');
for (const relative of [...required, 'docs/delivery/raft-comic-material.md', ...screenshots]) {
  assert(fs.existsSync(path.join(root, relative)), `Missing S15 artifact: ${relative}`);
}
assert(rows.get('town-thatch-v1').references.some(item => item.path === 'docs/art/town-covers/desktop-house-after-v1.png' && item.role === 'preview'), 'Thatch row is missing its applied house gameplay preview.');
assert(rows.get('town-awning-v1').references.some(item => item.path === 'docs/art/town-covers/desktop-stall-after-v1.png' && item.role === 'preview'), 'Awning row is missing its applied market stall gameplay preview.');
const paths = new Set([...required, 'docs/delivery/raft-comic-material.md', ...screenshots]);
for (const row of rows.values()) for (const item of [...row.references || [], ...row.files || [], ...row.evidence || []]) if (item.path) paths.add(item.path);
const base = process.env.TOWN_COVERS_CATALOG_BASE || 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async relative => {
  const local = fs.readFileSync(path.join(root, relative));
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${base}/files/${encoded}`);
  assert(response.ok, `HTTP ${response.status} for ${relative}.`);
  const remote = Buffer.from(await response.arrayBuffer());
  assert(sha256(remote) === sha256(local), `Served bytes differ: ${relative}.`);
}));
const response = await fetch(`${base}/api/catalog`);
assert(response.ok, `Active catalogue HTTP ${response.status}.`);
const live = await response.json();
assert(live.revision === catalog.revision, `Active revision ${live.revision}; local ${catalog.revision}.`);
for (const id of ids) assert(JSON.stringify(live.rows?.find(row => row.id === id)) === JSON.stringify(rows.get(id)), `Active catalogue row differs: ${id}.`);
console.log(`S15 catalogue verified: ${paths.size} HTTP links SHA-256 matched; two rows and revision ${live.revision}.`);
