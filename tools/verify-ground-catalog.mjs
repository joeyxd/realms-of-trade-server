import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog = JSON.parse(fs.readFileSync(new URL('./art-catalog/catalog.json', import.meta.url)));
const paths = new Set();
for (const id of ['arena-compactada','transicion-arena-hierba','hierba-tropical-material','tierra-seca-material']) {
  const row = catalog.rows.find((r) => r.id === id);
  if (!row || row.state !== 'applied') throw new Error('Not applied: ' + id);
  for (const item of [...row.references,...row.files,...row.evidence]) if (item.path) paths.add(item.path);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const relative of paths) {
  const local = fs.readFileSync(new URL('../' + relative, import.meta.url));
  const response = await fetch('http://127.0.0.1:5190/files/' + relative.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== sha(local)) throw new Error('Catalogue file mismatch: ' + relative);
}
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== catalog.revision) throw new Error('Stale live catalogue');
console.log(`Ground catalogue verified: ${paths.size} exact file links, revision ${live.revision}.`);
