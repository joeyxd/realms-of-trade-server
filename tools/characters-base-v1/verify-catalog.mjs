// Verify the registered P02a artifacts through the actual local catalog file routes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createCatalogServer } from '../art-catalog/server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogFile = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(catalogFile);
const catalog = JSON.parse(before);
const ids = ['char-base-male-v1', 'char-base-female-v1'];
const rows = ids.map((id) => {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`Missing registered row: ${id}`);
  return row;
});
const paths = [...new Set(rows.flatMap((row) => ['references', 'files', 'evidence']
  .flatMap((field) => row[field].map((entry) => entry.path))))].sort();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const server = createCatalogServer({ repoRoot: root });
const artifacts = [];
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const artifact of paths) {
    const response = await fetch(`${origin}/files/${artifact.split('/').map(encodeURIComponent).join('/')}`);
    const served = Buffer.from(await response.arrayBuffer());
    const local = fs.readFileSync(path.join(root, artifact));
    if (response.status !== 200 || !local.equals(served)) throw new Error(`Catalog route mismatch: ${artifact} (${response.status})`);
    artifacts.push({ path: artifact, status: response.status, bytes: served.length,
      sha256: hash(served), contentType: response.headers.get('content-type') });
  }
  if (!fs.readFileSync(catalogFile).equals(before)) throw new Error('Catalog changed during verification');
  const report = { schema: 'character-artifact-http/v1', scope: 'Local catalog GET file routes; no gameplay or deployment acceptance',
    catalogRevision: catalog.revision, rows: ids, checkedAt: new Date().toISOString(), artifacts, failures: [] };
  fs.writeFileSync(path.join(root, 'docs/art/characters-base-v1/artifact-evidence-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ catalogRevision: catalog.revision, rows: ids, artifacts: artifacts.length, failures: 0 }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
