// Freeze only S08's source bytes; later changes never refresh historical snapshots.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = 'docs/art/source/grass-patches-v1';
const args = process.argv.slice(2), check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-grass-sources.mjs [--check]');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = ['grassGeometry', 'grassPlacement', 'grassPatches', 'shrubPlacement', 'vegetation', 'scene'].map((name) =>
  ({ source: `src/render/${name}.js`, snapshot: `${dir}/${name}.source.js` }));
entries.push({ source: 'tools/qa-grass.playwright.js', snapshot: `${dir}/qa-grass.source.js` },
  { source: 'tests/grass-patches.test.mjs', snapshot: `${dir}/grass-patches.test.source.mjs` },
  { source: 'tools/prepare-grass-sources.mjs', snapshot: `${dir}/prepare-grass-sources.source.mjs` });
const receiptPath = path.join(root, dir, 'source-snapshot.json');
if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (JSON.stringify(receipt.files.map(({ source, snapshot }) => ({ source, snapshot }))) !== JSON.stringify(entries)) throw Error('Snapshot scope differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Snapshot hash mismatch: ' + entry.snapshot);
  }
  console.log('S08 immutable integration snapshots verified.');
} else {
  if (check) throw Error('Missing source snapshot receipt');
  const files = entries.map((entry) => { const bytes = fs.readFileSync(path.join(root, entry.source)); return { ...entry, bytes: bytes.length, sha256: hash(bytes), content: bytes }; });
  for (const entry of files) {
    const file = path.join(root, entry.snapshot);
    if (fs.existsSync(file) && !fs.readFileSync(file).equals(entry.content)) throw Error('Refusing different snapshot: ' + entry.snapshot);
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  for (const entry of files) if (!fs.existsSync(path.join(root, entry.snapshot))) fs.writeFileSync(path.join(root, entry.snapshot), entry.content, { flag: 'wx' });
  fs.writeFileSync(receiptPath, JSON.stringify({ schemaVersion: 1, family: 'grass-patches-v1',
    policy: 'Historical snapshot: check validates copied bytes; future renderer work does not refresh this source.',
    files: files.map(({ content: ignored, ...entry }) => entry) }, null, 2) + '\n', { flag: 'wx' });
  console.log('S08 integration source snapshots created.');
}
