// Verify registered grass artifacts against the local catalogue's actual HTTP bytes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('../tools/art-catalog/catalog.json', import.meta.url)));
const row = data.rows.find((entry) => entry.id === 'pasto-volumetrico');
if (row?.state !== 'applied') throw Error('Volumetric grass is not applied');
const paths = new Set([...row.references, ...row.files, ...row.evidence].map((artifact) => artifact.path).filter(Boolean));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
await Promise.all([...paths].map(async (relative) => {
  const local = fs.readFileSync(new URL(relative, root));
  const url = 'http://127.0.0.1:5190/files/' + relative.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url);
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(local)) throw Error(`Live file differs: ${relative}`);
}));
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== data.revision) throw Error('Stale live catalogue revision');
console.log(`Grass catalogue verified: ${paths.size} exact links, revision ${live.revision}.`);
