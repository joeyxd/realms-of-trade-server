// Compare every S06 catalogue link with its repository bytes through the actual service.
import fs from 'node:fs';
import crypto from 'node:crypto';
const data = JSON.parse(fs.readFileSync(new URL('./art-catalog/catalog.json', import.meta.url))), paths = new Set();
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const id of ['raices-palma', 'plantas-base-palma']) {
  const row = data.rows.find((r) => r.id === id); if (row?.state !== 'applied') throw Error('Not applied: ' + id);
  for (const a of [...row.references, ...row.files, ...row.evidence]) if (a.path) paths.add(a.path);
}
for (const file of paths) {
  const response = await fetch('http://127.0.0.1:5190/files/' + file.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(fs.readFileSync(new URL('../' + file, import.meta.url)))) throw Error('Live file mismatch: ' + file);
}
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== data.revision) throw Error('Stale catalogue revision');
console.log(`S06 catalogue verified: ${paths.size} exact links, revision ${live.revision}.`);
