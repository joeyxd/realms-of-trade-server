// Read-only end-to-end check of this family's live catalog links and file bytes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog = JSON.parse(fs.readFileSync(new URL('./art-catalog/catalog.json', import.meta.url)));
const ids = ['arena-seca', 'arena-humeda', 'arena-conchas', 'arena-ondulada', 'huellas-arena', 'arena-orilla'];
const paths = new Set();
for (const id of ids) {
  const row = catalog.rows.find((r) => r.id === id);
  if (!row || row.state !== 'applied' || !row.evidence.length) throw new Error(`Unapplied sand row: ${id}`);
  for (const file of [...row.references, ...row.files, ...row.evidence]) if (file.path) paths.add(file.path);
}
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let checked = 0;
for (const path of paths) {
  const local = fs.readFileSync(new URL('../' + path, import.meta.url));
  const response = await fetch(`http://127.0.0.1:5190/files/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) throw new Error(`${response.status}: ${path}`);
  const remote = Buffer.from(await response.arrayBuffer());
  if (sha(remote) !== sha(local)) throw new Error(`Catalog file byte mismatch: ${path}`);
  checked++;
}
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== catalog.revision) throw new Error('Catalog server serves stale revision');
console.log(`Live catalog OK: ${ids.length} applied sand rows, ${checked} byte-verified links, revision ${catalog.revision}`);
