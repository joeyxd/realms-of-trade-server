// Freeze the S20 town hall inputs and final source files; never replace a snapshot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FAMILY = 'town-hall-v1';
const DIR = `docs/art/source/${FAMILY}`;
const RECEIPT = `${DIR}/final/source-snapshot.json`;
const sources = [
  ['before', 'src/render/props.js'],
  ...['src/render/props.js', 'src/render/townHall.js', 'tests/town-hall.test.mjs',
    'tools/qa-town-hall.playwright.js', 'tools/prepare-town-hall-sources.mjs',
    'tools/register-town-hall-catalog.mjs']
    .map(file => ['after', file]),
].map(([phase, source]) => ({ phase, source, snapshot: phase === 'before'
  ? `${DIR}/before/${path.basename(source)}`
  : `${DIR}/final/after/${path.basename(source)}` }));
const reused = [
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-desktop.webp'],
  ['tex:town-wood-albedo-v1', 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp'],
  ['tex:town-wood-normal-v1', 'assets/textures/town-wood-v1/atlas-normal-mobile.webp'],
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const full = file => path.join(ROOT, file);
const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
if (args.length && !check) throw Error('Usage: node tools/prepare-town-hall-sources.mjs [--check]');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const reusedAssets = reused.map(([id, file]) => {
  const bytes = fs.readFileSync(full(file));
  return { id, path: file, bytes: bytes.length, sha256: hash(bytes) };
});

if (fs.existsSync(full(RECEIPT))) {
  const receipt = JSON.parse(fs.readFileSync(full(RECEIPT), 'utf8'));
  if (receipt.schema !== 1 || receipt.family !== FAMILY ||
    !same(receipt.sources?.map(({ phase, source, snapshot }) => ({ phase, source, snapshot })), sources))
    throw Error('S20 source receipt scope differs.');
  for (const entry of receipt.sources) {
    const bytes = fs.readFileSync(full(entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error(`Frozen source mismatch: ${entry.snapshot}`);
  }
  if (!same(receipt.reusedAssets, reusedAssets)) throw Error('S20 reused town asset record differs.');
  console.log(`S20 frozen source receipt verified: ${receipt.sources.length} files.`);
} else {
  if (check) throw Error('Missing S20 source receipt.');
  const records = sources.map(entry => {
    const sourceFile = entry.phase === 'before' ? entry.snapshot : entry.source;
    const bytes = fs.readFileSync(full(sourceFile));
    return { ...entry, bytes: bytes.length, sha256: hash(bytes), content: bytes };
  });
  for (const entry of records.filter(item => item.phase === 'before')) {
    if (!fs.existsSync(full(entry.snapshot))) throw Error(`Missing pre-edit snapshot: ${entry.snapshot}`);
  }
  if (!fs.existsSync(full(`${DIR}/before/catalog.source.json`))) throw Error('Missing immutable before catalogue snapshot.');
  for (const entry of records) {
    const dest = full(entry.snapshot);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(entry.content)) throw Error(`Refusing changed snapshot: ${entry.snapshot}`);
  }
  for (const entry of records) {
    const dest = full(entry.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, entry.content, { flag: 'wx' });
  }
  const receipt = { schema: 1, family: FAMILY, sources: records.map(({ content, ...record }) => record), reusedAssets };
  fs.mkdirSync(path.dirname(full(RECEIPT)), { recursive: true });
  fs.writeFileSync(full(RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`S20 source snapshots frozen: ${records.length}.`);
}
