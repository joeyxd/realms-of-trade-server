// Verify S13 catalogue links against the running local artifact service byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ids = ['m01-madera-costera', 'muelle-tablones'];
const required = [
  'docs/briefs/visual-s13-dock-wood.md',
  'docs/delivery/dock-wood-v1.md',
  'docs/art/dock-wood/runtime-evidence-v1.json',
  'docs/art/source/dock-wood-v1/final/source-snapshot.json',
  'docs/art/dock-wood/desktop-detail-after-v1.png',
  'docs/art/dock-wood/mobile-detail-after-v1.png',
  'docs/art/dock-wood/desktop-overview-after-v1.png',
];
const rows = new Map();
for (const id of ids) {
  const row = catalog.rows.find((entry) => entry.id === id);
  assert(row && row.state === 'applied', `Fila no aplicada: ${id}`);
  rows.set(id, row);
  const linked = new Set([...row.references || [], ...row.files || [], ...row.evidence || []].map((item) => item.path).filter(Boolean));
  for (const relative of required) assert(linked.has(relative), `Falta enlace ${relative} en ${id}.`);
}
const m01 = rows.get('m01-madera-costera');
assert(m01.files.some((item) => item.path === 'assets/textures/raft/comic-materials-v1.webp'), 'M01 perdió atlas desktop.');
assert(m01.files.some((item) => item.path === 'assets/textures/raft/comic-materials-v1-mobile.webp'), 'M01 perdió atlas móvil.');
assert(m01.references.some((item) => item.path === 'docs/delivery/raft-comic-material.md'), 'M01 perdió referencia original del atlas.');
const dock = rows.get('muelle-tablones');
assert(dock.name === 'Tablones del muelle' && dock.category === 'Kit portuario' && dock.kind === 'object' && dock.priority === 'P0', 'Metadatos de muelle-tablones incorrectos.');
for (const id of ['kit-piso', 'kit-poste', 'kit-viga-diagonal', 'muelle-soporte']) {
  const row = catalog.rows.find((entry) => entry.id === id);
  assert(row?.state !== 'applied', `Alcance S13 aplicó indebidamente ${id}.`);
}
const snapshot = JSON.parse(fs.readFileSync(path.join(root, required[3]), 'utf8'));
assert(Array.isArray(snapshot.files) && snapshot.files.length > 0, 'Snapshot de fuente sin files[].');
for (const entry of snapshot.files) {
  const bytes = fs.readFileSync(path.join(root, entry.snapshot));
  assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Snapshot inválido: ${entry.snapshot}`);
}

const paths = new Set(required);
for (const id of ids) {
  const row = rows.get(id);
  for (const item of [...row.references || [], ...row.files || [], ...row.evidence || []]) if (item.path) paths.add(item.path);
}
const base = process.env.DOCK_WOOD_CATALOG_BASE || 'http://127.0.0.1:5190';
await Promise.all([...paths].map(async (relative) => {
  const local = fs.readFileSync(path.join(root, relative));
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${base}/files/${encoded}`);
  assert(response.ok, `HTTP ${response.status} para ${relative}.`);
  const remote = Buffer.from(await response.arrayBuffer());
  assert(hash(remote) === hash(local), `Los bytes servidos difieren: ${relative}.`);
}));
const response = await fetch(`${base}/api/catalog`);
assert(response.ok, `Catálogo activo HTTP ${response.status}.`);
const live = await response.json();
assert(live.revision === catalog.revision, `Revisión activa ${live.revision}; local ${catalog.revision}.`);
for (const id of ids) {
  const localRow = rows.get(id), liveRow = live.rows?.find((entry) => entry.id === id);
  assert(JSON.stringify(liveRow) === JSON.stringify(localRow), `Fila activa difiere del JSON local: ${id}.`);
}
console.log(`S13 catálogo verificado: ${paths.size} enlaces HTTP con SHA-256 exacto, JSON completo de dos filas, revisión ${live.revision}.`);
