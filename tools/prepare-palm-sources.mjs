// Preserve exact source snapshots for the palm family receipt. --check recomputes but never writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/art/source/palm-family-v1';
const check = process.argv.includes('--check');
if (process.argv.length > 3 || (process.argv.length === 3 && !check)) {
  throw new Error('Usage: node tools/prepare-palm-sources.mjs [--check]');
}

const sourcePaths = [
  'src/render/palmGeometry.js',
  'src/render/palmMaterials.js',
  'src/render/vegetation.js',
  'src/render/lighting.js',
  'tools/prepare-palm-family.mjs',
  'tools/prepare-palm-textures-v2.mjs',
];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const files = sourcePaths.map((source) => {
  const bytes = fs.readFileSync(path.join(root, source));
  const basename = path.basename(source).replace(/\.(?:js|mjs)$/, '');
  const extension = source.endsWith('.mjs') ? 'mjs' : 'js';
  const copy = `${dir}/${basename}.source.${extension}`;
  return { source, copy, bytes, sha256: hash(bytes) };
});
const snapshot = Buffer.from(JSON.stringify({
  version: 1,
  files: files.map(({ source, copy, bytes, sha256 }) => ({ source, copy, bytes: bytes.length, sha256 })),
}, null, 2) + '\n');
const outputs = [...files.map(({ copy, bytes }) => [copy, bytes]), [`${dir}/source-snapshot.json`, snapshot]];

// Validate every target first so a differing recovery copy cannot leave a partially refreshed snapshot set.
for (const [relative, bytes] of outputs) {
  const file = path.join(root, relative);
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) {
    throw new Error(`Refusing to replace differing source snapshot: ${relative}`);
  }
  if (check && !fs.existsSync(file)) throw new Error(`--check expected existing source snapshot: ${relative}`);
}

if (!check) {
  for (const [relative, bytes] of outputs) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx' });
    }
  }
}

for (const [relative, bytes] of outputs) {
  if (!fs.readFileSync(path.join(root, relative)).equals(bytes)) throw new Error(`Snapshot verification failed: ${relative}`);
}
console.log(JSON.stringify({ check, files: files.map(({ source, copy, bytes, sha256 }) => ({ source, copy, bytes: bytes.length, sha256 })) }, null, 2));
