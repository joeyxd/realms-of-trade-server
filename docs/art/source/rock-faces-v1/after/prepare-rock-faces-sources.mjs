// Preserve a one-time S12 source receipt; subsequent checks never overwrite historical bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/rock-faces-v1';
const args = process.argv.slice(2), check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-rock-faces-sources.mjs [--check]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = [{ phase: 'before', source: 'src/render/vegetation.js', snapshot: `${dir}/before/vegetation.source.js` }];
for (const source of ['src/render/rockMaterials.js', 'src/render/vegetation.js', 'tools/qa-rock-faces.playwright.js',
  'tests/rock-materials.test.mjs', 'tools/prepare-rock-faces-sources.mjs', 'tools/register-rock-faces-catalog.mjs',
  'tools/verify-rock-faces-catalog.mjs', 'tools/rock-faces-evidence.mjs']) {
  entries.push({ phase: 'after', source, snapshot: `${dir}/after/${path.basename(source)}` });
}
const receiptPath = path.join(root, dir, 'source-snapshot.json');
if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (JSON.stringify(receipt.files.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) !== JSON.stringify(entries)) throw Error('Snapshot scope differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Snapshot hash mismatch: ' + entry.snapshot);
  }
  console.log('S12 immutable source snapshots verified.');
} else {
  if (check) throw Error('Missing source receipt');
  const files = entries.map(entry => {
    const bytes = fs.readFileSync(path.join(root, entry.phase === 'before' ? entry.snapshot : entry.source));
    return { ...entry, bytes: bytes.length, sha256: hash(bytes), content: bytes };
  });
  for (const entry of files) {
    const dest = path.join(root, entry.snapshot);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(entry.content)) throw Error('Refusing different source snapshot: ' + entry.snapshot);
  }
  for (const entry of files) {
    const dest = path.join(root, entry.snapshot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, entry.content, { flag: 'wx' });
  }
  fs.writeFileSync(receiptPath, JSON.stringify({ schema: 1, family: 'rock-faces-v1',
    policy: 'Before is the exact file copied before S12. After is exact final live source bytes. --check verifies historical copies without refreshing from future live source.',
    files: files.map(({ content: ignored, ...entry }) => entry) }, null, 2) + '\n', { flag: 'wx' });
  console.log('S12 source snapshots created: ' + files.length);
}
