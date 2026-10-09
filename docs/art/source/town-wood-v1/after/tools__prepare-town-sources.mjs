// Freeze the accepted runtime and its reproducible tooling once; later checks read only historical copies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = 'docs/art/source/town-wood-v1/runtime-source-snapshot.json';
const afterDir = 'docs/art/source/town-wood-v1/after';
const files = ['src/render/townMaterials.js', 'src/render/props.js', 'assets/manifest.json',
  'tools/prepare-town-materials.mjs', 'tools/register-town-manifest.mjs', 'tools/register-town-catalog.mjs',
  'tools/verify-town-catalog.mjs', 'tools/prepare-town-sources.mjs', 'tools/qa-town-wood.playwright.js',
  'tests/town-materials.test.mjs', 'tests/dock-wood.test.mjs'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receiptFile = path.join(root, receiptPath);
if (fs.existsSync(receiptFile)) {
  const old = JSON.parse(fs.readFileSync(receiptFile));
  if (old.schema !== 1 || old.family !== 'town-wood-v1' || old.sources.length !== 12) throw Error('Unexpected town source receipt');
  for (const item of old.sources) {
    const bytes = fs.readFileSync(path.join(root, item.snapshot));
    if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw Error('Historical source changed: ' + item.snapshot);
  }
  console.log('Town source freeze checked: 12 exact historical copies; live files are not refreshed.');
} else {
  if (process.argv.includes('--check')) throw Error('Town source freeze does not exist');
  const sources = [{ phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/town-wood-v1/before/props.source.js' },
    ...files.map(source => ({ phase: 'after', source, snapshot: `${afterDir}/${source.replaceAll('/', '__')}` }))];
  for (const item of sources) {
    const bytes = fs.readFileSync(path.join(root, item.phase === 'before' ? item.snapshot : item.source));
    item.bytes = bytes.length; item.sha256 = sha(bytes);
    if (item.phase === 'after') {
      const destination = path.join(root, item.snapshot);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: 'wx' });
    }
  }
  fs.writeFileSync(receiptFile, JSON.stringify({ schema: 1, family: 'town-wood-v1',
    createdAt: new Date().toISOString(), policy: 'Immutable historical copies; future live edits do not refresh this receipt.', sources }, null, 2) + '\n', { flag: 'wx' });
  console.log('Town source freeze created: 12 exact copies.');
}
