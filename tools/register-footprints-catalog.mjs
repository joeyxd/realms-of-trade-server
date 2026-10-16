// Advance only the footprints row, retaining the author's files and all other catalogue edits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'tools/art-catalog/catalog.json');
const initial = fs.readFileSync(target);
const data = JSON.parse(initial);
const row = data.rows.find((r) => r.id === 'huellas-arena');
if (!row) throw new Error('No existe la fila huellas-arena.');
const report = 'docs/delivery/sand-footprints-v1.md';
const shots = [
  { label: 'Huellas al caminar · PC', path: 'docs/art/sand/footprints-desktop-live-v1.png' },
  { label: 'Huellas desaparecidas · PC', path: 'docs/art/sand/footprints-desktop-faded-v1.png' },
  { label: 'Huellas al caminar · móvil emulado', path: 'docs/art/sand/footprints-mobile-live-v1.png' },
  { label: 'Huellas desaparecidas · móvil emulado', path: 'docs/art/sand/footprints-mobile-faded-v1.png' },
];
for (const relative of [report, ...shots.map((s) => s.path)]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Falta evidencia: ${relative}`);
}
if (row.evidence.some((e) => e.path === report)) {
  console.log(`Huellas dinámicas ya registradas; revisión ${data.revision}.`);
} else {
  row.description = 'Pisadas individuales al apoyar cada pie sobre arena, alternadas, orientadas al movimiento y con desvanecimiento.';
  row.variants = ['arena seca · hasta 18 s', 'arena húmeda · hasta 5 s', 'izquierda/derecha', 'par pintado del autor conservado como referencia'];
  row.destination = ['src/render/vfx/footprints.js', 'src/render/characters.js', 'src/render/scene.js', 'src/render/sandMaterials.js'];
  row.state = 'applied';
  row.nextStep = 'Revisar tamaño/intensidad/duración con el autor; el borrado por olas y el rastreo persistente son ampliaciones futuras.';
  row.notes = `Actual: huellas cosméticas generadas por la animación al caminar y desvanecidas según humedad, una malla con límite PC 256/táctil 128/baja 96. Pausa congela su reloj; no hay marcas en agua, salto, dash, cubiertas o terreno no arenoso. La banda pintada del PNG queda apagada por defecto y sus archivos se conservan para referencia. Pruebas y capturas PC/móvil emulado verificadas; ajuste artístico y FPS físico pendientes. Histórico del primer corte: ${row.notes}`;
  row.references = [{ ...shots[0], role: 'preview' }, ...row.references.map((r) => r.role === 'preview' ? { ...r, role: 'reference' } : r)];
  row.evidence = [{ label: 'Entrega de huellas dinámicas', path: report }, ...shots, ...row.evidence];
  data.revision++;
  data.updatedAt = new Date().toISOString();
  const temp = `${target}.${process.pid}.footprints.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(target).equals(initial)) throw new Error('El catálogo cambió durante la edición; se conserva la versión nueva.');
    fs.renameSync(temp, target);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  console.log(`Huellas dinámicas registradas; revisión ${data.revision}.`);
}
