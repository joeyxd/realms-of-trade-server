// Freeze S09 integration source bytes, preserving every older family's receipt.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url), dir = 'docs/art/source/beach-debris-runtime-v1';
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw Error('Usage: node tools/prepare-beach-debris-sources.mjs [--check]');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const entries = ['beachDebrisGeometry', 'beachDebrisPlacement', 'beachDebris', 'vegetation', 'scene'].map((name) =>
  ({ source: `src/render/${name}.js`, snapshot: `${dir}/${name}.source.js` }));
for (const [source, name] of [
  ['tools/qa-beach-debris.playwright.js', 'qa-beach-debris.source.js'],
  ['tests/beach-debris.test.mjs', 'beach-debris.test.source.mjs'],
  ['tools/prepare-beach-debris.mjs', 'prepare-beach-debris.source.mjs'],
  ['tools/prepare-beach-debris-sources.mjs', 'prepare-beach-debris-sources.source.mjs'],
  ['tools/stage-s09-logs.ps1', 'stage-s09-logs.source.ps1'],
  ['tools/export-s09-logs.py', 'export-s09-logs.source.py'],
]) entries.push({ source, snapshot: `${dir}/${name}` });
const receiptPath = new URL(`${dir}/source-snapshot.json`, root);
if (fs.existsSync(receiptPath)) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  if (JSON.stringify(receipt.files.map(({ source, snapshot }) => ({ source, snapshot }))) !== JSON.stringify(entries)) throw Error('Snapshot scope differs');
  for (const entry of receipt.files) {
    const bytes = fs.readFileSync(new URL(entry.snapshot, root));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('S09 snapshot differs: ' + entry.snapshot);
  }
  console.log('S09 historical integration snapshots verified.');
} else {
  if (check) throw Error('S09 snapshot receipt missing');
  const files = entries.map((entry) => { const content = fs.readFileSync(new URL(entry.source, root)); return { ...entry, content, bytes: content.length, sha256: hash(content) }; });
  for (const entry of files) { const file = new URL(entry.snapshot, root); if (fs.existsSync(file) && !fs.readFileSync(file).equals(entry.content)) throw Error('Refusing different S09 snapshot'); }
  fs.mkdirSync(new URL(dir + '/', root), { recursive: true });
  for (const entry of files) { const file = new URL(entry.snapshot, root); if (!fs.existsSync(file)) fs.writeFileSync(file, entry.content, { flag: 'wx' }); }
  fs.writeFileSync(receiptPath, JSON.stringify({ schemaVersion: 1, family: 'beach-debris-v1',
    policy: 'Immutable historical integration source; --check validates copies, not later live files.',
    files: files.map(({ content: ignored, ...entry }) => entry) }, null, 2) + '\n', { flag: 'wx' });
  console.log('S09 integration source snapshots created.');
}
