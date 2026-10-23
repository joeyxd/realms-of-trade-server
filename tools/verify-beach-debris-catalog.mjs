// Verify every unique beach-debris catalog artifact against the local HTTP bytes.
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const localCatalog = JSON.parse(fs.readFileSync(new URL('../tools/art-catalog/catalog.json', import.meta.url), 'utf8'));
const row = localCatalog.rows.find((entry) => entry.id === 'restos-playa');
if (row?.state !== 'applied') throw new Error('Beach debris is not applied in the local catalog');
const paths = new Set([...(row.references || []), ...(row.files || []), ...(row.evidence || [])]
  .map((artifact) => artifact.path).filter(Boolean));
if (!paths.size) throw new Error('Beach debris catalog row has no linked artifacts');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const base = 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async (relative) => {
  const local = fs.readFileSync(new URL(relative, root));
  const url = `${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${relative}`);
  const remote = Buffer.from(await response.arrayBuffer());
  if (hash(remote) !== hash(local)) throw new Error(`Live file differs: ${relative}`);
}));
const response = await fetch(`${base}/api/catalog`);
if (!response.ok) throw new Error(`Live catalog returned HTTP ${response.status}`);
const live = await response.json();
if (live.revision !== localCatalog.revision) throw new Error(`Stale live catalogue revision ${live.revision}; local revision is ${localCatalog.revision}`);
const liveRow = live.rows?.find((entry) => entry.id === 'restos-playa');
if (liveRow?.state !== 'applied') throw new Error('Live catalog does not expose the applied beach-debris row');
console.log(`Beach-debris catalogue verified: ${paths.size} unique exact links, revision ${live.revision}.`);
