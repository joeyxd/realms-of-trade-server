// Freeze S11 evidence once; --check never refreshes historical renderer sources.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/water-clarity-v1/final';
const args = process.argv.slice(2), check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-water-clarity-sources.mjs [--check]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = ['water', 'terrain', 'pipeline'].map(name => ({ phase: 'before', source: `src/render/${name}.js`, snapshot: `docs/art/source/water-clarity-v1/before/${name}.source.js` }));
for (const name of ['waterDetail', 'water', 'terrain', 'pipeline', 'noiseTex']) entries.push({ phase: 'after', source: `src/render/${name}.js`, snapshot: `${dir}/${name}.source.js` });
for (const [source, name] of [['tools/qa-water-clarity.playwright.js', 'qa-water-clarity.source.js'], ['tests/water-clarity.test.mjs', 'water-clarity.test.source.mjs'], ['tools/prepare-water-clarity-sources.mjs', 'prepare-water-clarity-sources.source.mjs']]) entries.push({ phase: 'after', source, snapshot: `${dir}/${name}` });
const receiptPath = path.join(root, dir, 'source-snapshot.json');
if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (JSON.stringify(receipt.files.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) !== JSON.stringify(entries)) throw Error('Snapshot scope differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Snapshot hash mismatch: ' + entry.snapshot);
  }
  console.log('S11 immutable before/after source snapshots verified.');
} else {
  if (check) throw Error('Missing source snapshot receipt');
  const files = entries.map(entry => {
    const content = fs.readFileSync(path.join(root, entry.phase === 'before' ? entry.snapshot : entry.source));
    return { ...entry, bytes: content.length, sha256: hash(content), content };
  });
  for (const entry of files) {
    const file = path.join(root, entry.snapshot);
    if (fs.existsSync(file) && !fs.readFileSync(file).equals(entry.content)) throw Error('Refusing different snapshot: ' + entry.snapshot);
  }
  for (const entry of files) {
    const file = path.join(root, entry.snapshot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, entry.content, { flag: 'wx' });
  }
  fs.writeFileSync(receiptPath, JSON.stringify({ schemaVersion: 1, family: 'water-clarity-v1',
    policy: 'Historical snapshot: before preserves observed pre-cut source text normalized to LF; after copies exact live source bytes. --check validates copied bytes and never refreshes them.',
    files: files.map(({ content: ignored, ...entry }) => entry) }, null, 2) + '\n', { flag: 'wx' });
  console.log('S11 source snapshots created: ' + files.length + ' files.');
}
