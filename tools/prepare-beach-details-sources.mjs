// Deliver exact source snapshots inside the catalogue's existing docs allowlist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = 'docs/art/source/beach-details-v1';
const sources = [
  ['src/render/beachDetails.js', `${dir}/beachDetails.source.js`],
  ['src/render/vegetation.js', `${dir}/vegetation.source.js`],
  ['tools/prepare-beach-details.mjs', `${dir}/prepare-beach-details.source.mjs`],
];
const outputs = sources.map(([source, target]) => {
  const bytes = fs.readFileSync(path.join(root, source));
  return { source, target, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const receipt = Buffer.from(JSON.stringify({ version: 1, files: outputs.map(({ source, target, bytes, sha256 }) => ({ source, target, bytes: bytes.length, sha256 })) }, null, 2) + '\n');
const files = [...outputs.map((o) => [o.target, o.bytes]), [`${dir}/source-snapshot.json`, receipt]];
for (const [relative, bytes] of files) {
  const file = path.join(root, relative);
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw new Error('Snapshot differs: ' + relative);
}
for (const [relative, bytes] of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
}
console.log('S04: three exact source snapshots and their hashes verified.');
