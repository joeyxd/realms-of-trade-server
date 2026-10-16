// Verify S16 catalogue links against the running local artifact service byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateDockRopesEvidence } from './register-dock-ropes-catalog.mjs';

validateDockRopesEvidence();

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools/art-catalog/catalog.json'), 'utf8'));
const row = catalog.rows.find(item => item.id === 'muelle-cuerdas-v1');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert(row && row.state === 'applied', 'Fila S16 no aplicada: muelle-cuerdas-v1.');
assert(row.name === 'Cuerdas del muelle' && row.category === 'Kit portuario' && row.kind === 'object' && row.priority === 'P0', 'Metadatos de muelle-cuerdas-v1 incorrectos.');
assert(JSON.stringify(row.destination) === JSON.stringify(['src/render/dockRopes.js', 'src/render/props.js']), 'Destino S16 inesperado.');

const required = [
  'docs/briefs/visual-s16-dock-ropes.md',
  'docs/delivery/dock-ropes-v1.md',
  'docs/art/dock-ropes/runtime-evidence-v1.json',
  'docs/art/source/dock-ropes-v1/source-snapshot.json',
  'docs/art/dock-ropes/desktop-coil-after-v1.png',
  'assets/textures/raft/comic-materials-v1.webp',
  'assets/textures/raft/comic-materials-v1-mobile.webp',
];
const links = [...row.references || [], ...row.files || [], ...row.evidence || []];
const linked = new Set(links.map(item => item.path).filter(Boolean));
for (const relative of required) assert(linked.has(relative), `Falta enlace S16: ${relative}`);
const sourceLinks = links.filter(item => item.path?.startsWith('docs/art/source/dock-ropes-v1/'));
assert(sourceLinks.every(item => !item.path.includes('/before/') || item.path.endsWith('/props.source.js')), 'Enlace de fuente anterior inesperado.');
assert(links.every(item => !/^(?:tools|tests)\//.test(item.path || '')), 'El catálogo enlaza una herramienta o prueba viva fuera de docs/art/source.');

const snapshot = JSON.parse(fs.readFileSync(path.join(root, required[3]), 'utf8'));
assert(snapshot.schema === 1 && snapshot.family === 'dock-ropes-v1' && Array.isArray(snapshot.files), 'Recibo S16 inválido.');
const reusedAssets = [
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1.webp' },
  { id: 'tex:raft-comic-v1', path: 'assets/textures/raft/comic-materials-v1-mobile.webp' },
].map(item => {
  const bytes = fs.readFileSync(path.join(root, item.path));
  return { ...item, bytes: bytes.length, sha256: hash(bytes) };
});
assert(JSON.stringify(snapshot.reusedAssets) === JSON.stringify(reusedAssets), 'Hashes de atlas reutilizados no coinciden con el recibo S16.');
for (const entry of snapshot.files) {
  assert(entry.snapshot.startsWith('docs/art/source/dock-ropes-v1/'), `Snapshot fuera de la ruta congelada: ${entry.snapshot}`);
  assert(linked.has(entry.snapshot), `Falta enlace al helper congelado ${entry.snapshot}`);
  const frozen = fs.readFileSync(path.join(root, entry.snapshot));
  assert(frozen.length === entry.bytes && hash(frozen) === entry.sha256, `SHA-256 congelado incorrecto: ${entry.snapshot}`);
}
const before = snapshot.files.find(item => item.phase === 'before');
assert(before?.source === 'src/render/props.js', 'Falta el snapshot before exacto de props.js.');
for (const relative of required.slice(-2)) {
  const record = row.files?.find(item => item.path === relative && ['albedo', 'mobile'].includes(item.role));
  assert(record, `Falta enlace/hash de atlas reutilizado: ${relative}`);
  const bytes = fs.readFileSync(path.join(root, relative));
  assert(record.bytes === bytes.length && record.sha256 === hash(bytes), `Hash de atlas reutilizado incorrecto: ${relative}`);
}

const base = process.env.DOCK_ROPES_CATALOG_BASE || 'http://127.0.0.1:5190';
const paths = new Set(links.map(item => item.path).filter(Boolean));
await Promise.all([...paths].map(async relative => {
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
assert(JSON.stringify(live.rows?.find(item => item.id === row.id)) === JSON.stringify(row), 'Fila activa difiere del JSON local.');
console.log(`Catálogo S16 verificado: ${paths.size} enlaces HTTP con SHA-256 exacto, helpers congelados válidos y revisión ${live.revision}.`);
