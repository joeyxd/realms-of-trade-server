// Register one coastal-rock row only after its model and inspected captures exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file);
const data = JSON.parse(before);
const row = data.rows.find((r) => r.id === 'roca-playa');
if (!row) throw new Error('No existe roca-playa');
const report = 'docs/delivery/coast-rocks-v1.md';
const shots = [
  { label: 'Rocas en playa · PC', path: 'docs/art/coast-rocks/desktop-map-v1.png' },
  { label: 'Roca y arena · detalle', path: 'docs/art/coast-rocks/desktop-close-v1.png' },
  { label: 'Tres siluetas · muestrario temporal', path: 'docs/art/coast-rocks/desktop-three-silhouettes-v1.png' },
  { label: 'Rocas en playa · móvil emulado', path: 'docs/art/coast-rocks/mobile-map-v1.png' },
  { label: 'Rocas en playa · calidad baja', path: 'docs/art/coast-rocks/low-map-v1.png' },
];
const files = [
  { label: 'Modelo compacto · PC/móvil · sin texturas', path: 'assets/models/coast-rock-v1.glb', role: 'model' },
  { label: 'Export geométrico original', path: 'docs/art/source/coast-rock-v1/SM_Rock.geometry-export.glb', role: 'source' },
  { label: 'Preparación, medidas y hashes', path: 'docs/art/source/coast-rock-v1/preparation.json', role: 'source' },
];
for (const relative of [report, ...shots.map((s) => s.path), ...files.map((f) => f.path)]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error('Falta evidencia: ' + relative);
}
if (!row.evidence.some((e) => e.path === report)) {
  row.state = 'applied';
  row.description = 'Roca angular de Dreamrise adaptada a la playa: tres siluetas, gris cálido pintado, tinta y pie húmedo.';
  row.variants = ['compacta', 'alargada', 'baja'];
  row.destination = ['assets/models/coast-rock-v1.glb', 'src/render/coastRockGeometry.js', 'src/render/vegetation.js'];
  row.nextStep = 'Revisar forma, paleta y contacto con el autor; después continuar con conchas independientes y cantos. Material de acantilado y arco pendientes.';
  row.notes = 'Actual: geometría SM_Rock exportada desde copia aislada; originales Unreal verificados sin cambios. Se reemplazan solo las rocas existentes sobre arena, dentro de su radio de colisión actual. Tres deformaciones de una misma malla, colores por vértice y shader toon; sin texturas nuevas. PC/móvil emulado y fallback revisados. Ajuste artístico y rendimiento físico pendientes. Histórico: ' + row.notes;
  row.files = [...row.files, ...files.filter((f) => !row.files.some((old) => old.path === f.path))];
  row.references = [{ ...shots[0], role: 'preview' }, ...row.references.map((r) => r.role === 'preview' ? { ...r, role: 'reference' } : r)];
  row.evidence = [{ label: 'Entrega local S02', path: report }, ...shots, { label: 'Prueba de carga y fallback', path: 'docs/art/coast-rocks/browser-evidence-v1.json' }, ...row.evidence];
  data.revision++; data.updatedAt = new Date().toISOString();
  const temp = `${file}.${process.pid}.coast.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('El catálogo cambió; conservar su nueva revisión.');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`Rocas registradas; revisión ${data.revision}.`);
