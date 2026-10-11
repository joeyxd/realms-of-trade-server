// Freeze once; later checks validate historical bytes without refreshing from live code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = 'docs/art/source/dock-wood-v1/final';
const args = process.argv.slice(2), check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-dock-wood-sources.mjs [--check]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = [{ phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/dock-wood-v1/before/props.source.js' }];
for (const source of ['src/render/dockWood.js', 'src/render/props.js', 'tools/qa-dock-wood.playwright.js',
  'tests/dock-wood.test.mjs', 'tools/prepare-dock-wood-sources.mjs', 'tools/register-dock-wood-catalog.mjs',
  'tools/verify-dock-wood-catalog.mjs']) entries.push({ phase: 'after', source, snapshot: `${dir}/after/${path.basename(source)}` });
const receiptPath = path.join(root, dir, 'source-snapshot.json');
if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (JSON.stringify(receipt.files.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }))) !== JSON.stringify(entries)) throw Error('Snapshot scope differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Snapshot hash mismatch: ' + entry.snapshot);
  }
  console.log('S13 immutable sources verified: ' + receipt.files.length);
} else {
  if (check) throw Error('Missing source receipt');
  const files = entries.map(entry => {
    const content = fs.readFileSync(path.join(root, entry.phase === 'before' ? entry.snapshot : entry.source));
    return { ...entry, bytes: content.length, sha256: hash(content), content };
  });
  for (const entry of files) if (fs.existsSync(path.join(root, entry.snapshot)) && !fs.readFileSync(path.join(root, entry.snapshot)).equals(entry.content)) throw Error('Refusing changed snapshot: ' + entry.snapshot);
  for (const entry of files) {
    const dest = path.join(root, entry.snapshot); fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, entry.content, { flag: 'wx' });
  }
  fs.writeFileSync(receiptPath, JSON.stringify({ schema: 1, family: 'dock-wood-v1',
    policy: 'Exact props.js copied before S13; exact final after sources. --check verifies historical files only.',
    files: files.map(({ content: ignored, ...entry }) => entry) }, null, 2) + '\n', { flag: 'wx' });
  console.log('S13 immutable sources frozen: ' + files.length);
}
