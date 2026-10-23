// Freeze the S15 source set once; --check only verifies historical bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/town-covers-v1/final-v2';
const receiptPath = path.join(root, dir, 'source-snapshot.json');
const args = process.argv.slice(2);
const check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-town-covers-sources.mjs [--check]');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = [
  { phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/town-covers-v1/before/props.source.js' },
  ...['src/render/props.js', 'src/render/townCovers.js', 'tests/town-covers.test.mjs',
    'tools/qa-town-covers.playwright.js', 'tools/prepare-town-covers-sources.mjs',
    'tools/register-town-covers-catalog.mjs', 'tools/verify-town-covers-catalog.mjs']
    .map(source => ({ phase: 'after', source, snapshot: `${dir}/after/${path.basename(source)}` })),
];
const reusedAssets = [
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1.webp' },
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1-mobile.webp' },
];
const assetRecords = () => reusedAssets.map(asset => {
  const bytes = fs.readFileSync(path.join(root, asset.path));
  return { ...asset, bytes: bytes.length, sha256: sha256(bytes) };
});

if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.schema !== 1 || receipt.family !== 'town-covers-v1' ||
      JSON.stringify(receipt.sources.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) !== JSON.stringify(entries)) {
    throw Error('S15 source receipt scope differs.');
  }
  for (const entry of receipt.sources) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw Error(`Historical source mismatch: ${entry.snapshot}`);
  }
  const expectedAssets = assetRecords();
  if (JSON.stringify(receipt.reusedAssets) !== JSON.stringify(expectedAssets)) throw Error('S15 reused atlas receipt mismatch.');
  console.log(`S15 historical sources verified: ${receipt.sources.length}`);
} else {
  if (check) throw Error('Missing S15 source receipt.');
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
  const receipt = { schema: 1, family: 'town-covers-v1', sources: records.map(({ content, ...entry }) => entry), reusedAssets: assetRecords() };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(`S15 historical sources frozen: ${records.length}`);
}
