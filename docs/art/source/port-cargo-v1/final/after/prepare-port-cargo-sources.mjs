// Freeze the S17 source set once; --check verifies historical bytes without refreshing them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/port-cargo-v1/final';
const receiptPath = path.join(root, dir, 'source-snapshot.json');
const args = process.argv.slice(2);
const check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-port-cargo-sources.mjs [--check]');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = [
  { phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/port-cargo-v1/before/props.source.js' },
  ...['src/render/props.js', 'src/render/portCargo.js', 'tests/port-cargo.test.mjs',
    'tools/qa-port-cargo.playwright.js', 'tools/prepare-port-cargo-sources.mjs',
    'tools/register-port-cargo-catalog.mjs', 'tools/verify-port-cargo-catalog.mjs']
    .map(source => ({ phase: 'after', source, snapshot: `${dir}/after/${path.basename(source)}` })),
];
const reusedAssets = [
  ...['albedo-desktop', 'albedo-mobile', 'normal-desktop', 'normal-mobile'].map(name => ({
    id: name.startsWith('normal') ? 'tex:town-wood-normal-v1' : 'tex:town-wood-albedo-v1',
    path: `assets/textures/town-wood-v1/atlas-${name}.webp`,
  })),
  { id: 'prop:storage-crate', path: 'assets/models/prop-storage-crate.glb' },
];
const assetRecords = () => reusedAssets.map(asset => {
  const bytes = fs.readFileSync(path.join(root, asset.path));
  return { ...asset, bytes: bytes.length, sha256: sha256(bytes) };
});

if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.schema !== 1 || receipt.family !== 'port-cargo-v1' ||
      JSON.stringify(receipt.sources.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) !== JSON.stringify(entries)) {
    throw Error('S17 source receipt scope differs.');
  }
  for (const entry of receipt.sources) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw Error(`Historical source mismatch: ${entry.snapshot}`);
  }
  if (JSON.stringify(receipt.reusedAssets) !== JSON.stringify(assetRecords())) throw Error('S17 reused asset receipt mismatch.');
  console.log(`S17 historical sources verified: ${receipt.sources.length}`);
} else {
  if (check) throw Error('Missing S17 source receipt.');
  const records = entries.map(entry => {
    const bytes = fs.readFileSync(path.join(root, entry.phase === 'before' ? entry.snapshot : entry.source));
    return { ...entry, bytes: bytes.length, sha256: sha256(bytes), content: bytes };
  });
  for (const entry of records) {
    const dest = path.join(root, entry.snapshot);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(entry.content)) throw Error(`Refusing changed snapshot: ${entry.snapshot}`);
  }
  for (const entry of records) {
    const dest = path.join(root, entry.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, entry.content, { flag: 'wx' });
  }
  const receipt = { schema: 1, family: 'port-cargo-v1',
    policy: 'Exact props.js copied before S17; exact final after sources. --check verifies historical files only.',
    sources: records.map(({ content, ...entry }) => entry), reusedAssets: assetRecords() };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(`S17 immutable sources frozen: ${records.length}`);
}
