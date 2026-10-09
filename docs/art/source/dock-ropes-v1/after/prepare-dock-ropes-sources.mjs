// Preserve a one-time S16 source receipt; checks never refresh historical bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/dock-ropes-v1';
const afterDir = `${dir}/after`;
const args = process.argv.slice(2);
const check = args[0] === '--check';
if (args.length > 1 || (args.length && !check)) throw Error('Usage: node tools/prepare-dock-ropes-sources.mjs [--check]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reusedAssets = [
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1.webp' },
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1-mobile.webp' },
].map(entry => {
  const bytes = fs.readFileSync(path.join(root, entry.path));
  return { ...entry, bytes: bytes.length, sha256: hash(bytes) };
});
const entries = [
  { phase: 'before', source: 'src/render/props.js', snapshot: `${dir}/before/props.source.js` },
  ...['src/render/props.js', 'src/render/dockRopes.js', 'tests/dock-ropes.test.mjs',
    'tools/qa-dock-ropes.playwright.js', 'tools/prepare-dock-ropes-sources.mjs',
    'tools/register-dock-ropes-catalog.mjs', 'tools/verify-dock-ropes-catalog.mjs'].map(source => ({
    phase: 'after', source, snapshot: `${afterDir}/${path.basename(source)}`,
  })),
];
const receiptPath = path.join(root, dir, 'source-snapshot.json');

if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const scope = receipt.files?.map(({ phase, source, snapshot }) => ({ phase, source, snapshot }));
  if (receipt.schema !== 1 || receipt.family !== 'dock-ropes-v1' || JSON.stringify(scope) !== JSON.stringify(entries)) {
    throw Error('S16 source receipt scope differs');
  }
  if (JSON.stringify(receipt.reusedAssets) !== JSON.stringify(reusedAssets)) throw Error('S16 reused asset receipt differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(path.join(root, entry.snapshot));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error(`Historical source hash mismatch: ${entry.snapshot}`);
  }
  console.log('S16 immutable source snapshots verified.');
} else {
  if (check) throw Error('Missing S16 source receipt');
  const files = entries.map(entry => {
    const sourcePath = path.join(root, entry.phase === 'before' ? entry.snapshot : entry.source);
    const content = fs.readFileSync(sourcePath);
    return { ...entry, bytes: content.length, sha256: hash(content), content };
  });
  for (const entry of files) {
    const destination = path.join(root, entry.snapshot);
    if (fs.existsSync(destination) && !fs.readFileSync(destination).equals(entry.content)) {
      throw Error(`Refusing to replace a different historical snapshot: ${entry.snapshot}`);
    }
  }
  for (const entry of files) {
    const destination = path.join(root, entry.snapshot);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, entry.content, { flag: 'wx' });
  }
  const receipt = { schema: 1, family: 'dock-ropes-v1',
    policy: 'Exact props.js copied before S16; exact final after sources. --check verifies immutable historical copies without refreshing from live sources.',
    files: files.map(({ content: ignored, ...entry }) => entry), reusedAssets };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(`S16 source snapshots created: ${files.length}`);
}
