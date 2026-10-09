// Verify the S12 catalogue rows and each linked artifact through the local service.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rockFacesPaths, validateRockFacesEvidence } from './rock-faces-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools/art-catalog/catalog.json'), 'utf8'));
const { snapshot, requiredLinks } = validateRockFacesEvidence(root);
const { brief, report, runtime, snapshot: snapshotPath, previews } = rockFacesPaths;
const ids = ['roca-cara', 'm03-roca-natural'];
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (!row || row.state !== 'applied') throw new Error(`Fila S12 no aplicada: ${id}`);
  if (JSON.stringify(row.destination) !== JSON.stringify(['src/render/rockMaterials.js', 'src/render/vegetation.js'])) {
    throw new Error(`Destino S12 inesperado: ${id}`);
  }
  const references = row.references || [];
  if (JSON.stringify(references.slice(0, 3).map((item) => item.path)) !== JSON.stringify(previews) ||
    references.slice(0, 3).some((item) => item.role !== 'preview')) throw new Error(`Previews S12 incompletas: ${id}`);
  const linked = new Set([...references, ...(row.files || []), ...(row.evidence || [])].map((item) => item.path).filter(Boolean));
  for (const relative of [...requiredLinks, brief, report, runtime, snapshotPath, ...previews]) {
    if (!linked.has(relative)) throw new Error(`Falta enlace en ${id}: ${relative}`);
  }
}
for (const id of ['roca-remate-pie', 'roca-arco']) {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (row?.state === 'applied') throw new Error(`${id} debe permanecer pendiente en S12`);
}

const paths = new Set();
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  for (const artifact of [...(row.references || []), ...(row.files || []), ...(row.evidence || [])]) {
    if (artifact.path) paths.add(artifact.path);
  }
}
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const base = 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async (relative) => {
  const local = fs.readFileSync(path.join(root, relative));
  const response = await fetch(`${base}/files/${relative.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) throw new Error(`HTTP ${response.status} para ${relative}`);
  const remote = Buffer.from(await response.arrayBuffer());
  if (hash(remote) !== hash(local)) throw new Error(`Bytes servidos difieren: ${relative}`);
}));
const response = await fetch(`${base}/api/catalog`);
if (!response.ok) throw new Error(`Catálogo activo HTTP ${response.status}`);
const live = await response.json();
if (live.revision !== catalog.revision) throw new Error(`Revisión activa ${live.revision}; local ${catalog.revision}`);
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  if (JSON.stringify(live.rows?.find((entry) => entry.id === id)) !== JSON.stringify(row)) {
    throw new Error(`Fila activa difiere de local: ${id}`);
  }
}
console.log(`Catálogo S12 verificado: ${paths.size} enlaces HTTP con SHA-256 exacto, revisión ${live.revision}, ocho o más fuentes y 24 transiciones.`);
