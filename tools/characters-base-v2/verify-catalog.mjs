// Verify prepared P02b artifacts through read-only catalog routes; optionally save the receipt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createCatalogServer } from '../art-catalog/server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogFile = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(catalogFile);
const catalog = JSON.parse(before);
const ids = ['char-base-male-v2', 'char-base-female-v2'];
const receiptPath='docs/art/characters-base-v2/artifact-evidence-v2.json';
const rows = ids.map((id) => {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`Missing registered row: ${id}`);
  return row;
});
const paths = [...new Set(rows.flatMap((row) => ['references', 'files', 'evidence']
  .flatMap((field) => row[field].map((entry) => entry.path))))].filter(p=>p!==receiptPath).sort();
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
    const servedHash = hash(served), localHash = hash(local);
    if (response.status !== 200 || servedHash !== localHash) {
      throw new Error(`Catalog route/hash mismatch: ${artifact} (${response.status})`);
    }
    artifacts.push({ path: artifact, status: response.status, bytes: served.length, sha256: servedHash });
  }
  if (!fs.readFileSync(catalogFile).equals(before)) throw new Error('Catalog changed during verification');
  if(process.argv.includes('--write-evidence')) {
    const report={schema:'character-artifact-http/v1',scope:'Local catalog GET file routes; no gameplay or deployment acceptance',
      catalogRevision:catalog.revision,rows:ids,checkedAt:new Date().toISOString(),artifacts,failures:[]};
    fs.writeFileSync(path.join(root,receiptPath),`${JSON.stringify(report,null,2)}\n`);
  }
  // Serve the report after writing it, without putting its own hash inside itself.
  const receiptResponse=await fetch(`${origin}/files/${receiptPath}`);
  const receiptBytes=Buffer.from(await receiptResponse.arrayBuffer());
  if(receiptResponse.status!==200||hash(receiptBytes)!==hash(fs.readFileSync(path.join(root,receiptPath))))throw new Error('Artifact receipt route/hash mismatch');
  console.log(JSON.stringify({ check: 'ok', catalogRevision: catalog.revision, rows: ids, artifacts: artifacts.length,
    hashMismatches: 0, catalogReadOnly: true, receiptRouteVerified:true, evidenceWritten:process.argv.includes('--write-evidence') }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
