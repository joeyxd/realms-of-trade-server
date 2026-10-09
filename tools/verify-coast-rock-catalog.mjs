// Verify the live row and every linked artifact against its actual local bytes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const catalog = JSON.parse(fs.readFileSync(new URL('./art-catalog/catalog.json', import.meta.url)));
const row = catalog.rows.find((r) => r.id === 'roca-playa');
if (!row || row.state !== 'applied') throw new Error('Rocks row is not applied');
const paths = new Set([...row.references, ...row.files, ...row.evidence].map((f) => f.path).filter(Boolean));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const file of paths) {
  const local = fs.readFileSync(new URL('../' + file, import.meta.url));
  const response = await fetch('http://127.0.0.1:5190/files/' + file.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== sha(local)) throw new Error('Live file mismatch: ' + file);
}
const live = await (await fetch('http://127.0.0.1:5190/api/catalog')).json();
if (live.revision !== catalog.revision) throw new Error('Stale live revision');
console.log(`Rocks catalogue verified: ${paths.size} exact links, revision ${live.revision}.`);
