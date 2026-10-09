// Verify every directly registered S04 artifact against the live local catalogue bytes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog = JSON.parse(fs.readFileSync(new URL('./art-catalog/catalog.json', import.meta.url)));
const paths = new Set(), hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const id of ['conchas-playa', 'cantos-guijarros']) {
  const row = catalog.rows.find((r) => r.id === id);
  if (!row || row.state !== 'applied') throw new Error('Not applied: ' + id);
  for (const a of [...row.references, ...row.files, ...row.evidence]) if (a.path) paths.add(a.path);
}
for (const file of paths) {
  const local = fs.readFileSync(new URL('../' + file, import.meta.url));
  const response = await fetch('http://127.0.0.1:5190/files/' + file.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(local)) throw new Error('Live file differs: ' + file);
}
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== catalog.revision) throw new Error('Stale live revision');
console.log(`S04 catalogue verified: ${paths.size} exact links, revision ${live.revision}.`);
