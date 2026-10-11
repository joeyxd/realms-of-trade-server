// Freeze S18 source inputs once; --check verifies the historical receipt only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIR = 'docs/art/source/town-fixtures-v1/final-v2';
const RECEIPT = `${DIR}/source-snapshot.json`;
const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
if (args.length && !check) throw Error('Usage: node tools/prepare-town-fixtures-sources.mjs [--check]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = [
  { phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/town-fixtures-v1/before/props.source.js' },
  ...['src/render/props.js', 'src/render/townFixtures.js', 'tests/town-fixtures.test.mjs',
    'tools/qa-town-fixtures.playwright.js', 'tools/prepare-town-fixtures-sources.mjs',
    'tools/register-town-fixtures-catalog.mjs'].map(source => ({
    phase: 'after', source, snapshot: `${DIR}/after/${path.basename(source)}`,
  })),
];
const assets = [
  { id: 'tex:town-wood-albedo-v1', path: 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp' },
  { id: 'tex:town-wood-normal-v1', path: 'assets/textures/town-wood-v1/atlas-normal-desktop.webp' },
  { id: 'tex:town-wood-albedo-v1', path: 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp' },
  { id: 'tex:town-wood-normal-v1', path: 'assets/textures/town-wood-v1/atlas-normal-mobile.webp' },
];
const reusedAssets = () => assets.map(asset => {
  const bytes = fs.readFileSync(path.join(ROOT, asset.path));
  return { ...asset, bytes: bytes.length, sha256: hash(bytes) };
});
const sameScope = receipt => receipt.schema === 1 && receipt.family === 'town-fixtures-v1' &&
  JSON.stringify(receipt.sources.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) === JSON.stringify(entries);

if (fs.existsSync(path.join(ROOT, RECEIPT))) {
  const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, RECEIPT), 'utf8'));
  if (!sameScope(receipt)) throw Error('S18 source receipt scope differs.');
  for (const entry of receipt.sources) {
    const bytes = fs.readFileSync(path.join(ROOT, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error(`Historical source mismatch: ${entry.snapshot}`);
  }
  if (JSON.stringify(receipt.reusedAssets) !== JSON.stringify(reusedAssets())) throw Error('S18 reused town wood assets mismatch.');
  console.log(`S18 historical sources verified: ${receipt.sources.length}`);
} else {
  if (check) throw Error('Missing S18 source receipt.');
  const records = entries.map(entry => {
    const bytes = fs.readFileSync(path.join(ROOT, entry.phase === 'before' ? entry.snapshot : entry.source));
    return { ...entry, bytes: bytes.length, sha256: hash(bytes), content: bytes };
  });
  for (const entry of records) {
    const dest = path.join(ROOT, entry.snapshot);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(entry.content)) throw Error(`Refusing changed snapshot: ${entry.snapshot}`);
  }
  for (const entry of records) {
    const dest = path.join(ROOT, entry.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, entry.content, { flag: 'wx' });
  }
  const receipt = { schema: 1, family: 'town-fixtures-v1', sources: records.map(({ content, ...entry }) => entry), reusedAssets: reusedAssets() };
  fs.mkdirSync(path.dirname(path.join(ROOT, RECEIPT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`S18 historical sources frozen: ${records.length}`);
}
