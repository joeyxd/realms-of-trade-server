// Register the inspected S12 paint treatment on the two existing natural-rock rows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rockFacesPaths, validateRockFacesEvidence } from './rock-faces-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = path.join(root, 'tools/art-catalog/catalog.json');
// Finish runtime, screenshot, and source-hash QA before preparing any catalogue mutation.
const { snapshot, screenshots } = validateRockFacesEvidence(root);
const before = fs.readFileSync(catalogPath);
const catalog = JSON.parse(before);
const { brief, report, runtime: runtimePath, snapshot: snapshotPath, previews } = rockFacesPaths;
const makeArtifact = (label, artifactPath, role) => ({ label, path: artifactPath, ...(role ? { role } : {}) });
const specs = [
  { id: 'roca-cara', name: 'Roca de cara cálida' },
  { id: 'm03-roca-natural', name: 'Roca natural' },
];
let changed = false;
for (const spec of specs) {
  const row = catalog.rows.find((entry) => entry.id === spec.id);
  if (!row || row.name !== spec.name) throw new Error(`Fila S12 ausente o renombrada: ${spec.id}`);
  if (!['reference', 'pending', 'applied'].includes(row.state)) throw new Error(`Estado inesperado en ${spec.id}: ${row.state}`);
  if (row.state === 'applied' && !row.evidence?.some(entry => entry.path === report)) throw Error(`Fila aplicada ajena a S12: ${spec.id}`);
  const oldRow = JSON.stringify(row);
  const oldReferences = (row.references || []).filter((entry) => !previews.includes(entry.path));
  const references = [
    ...previews.map((artifactPath, index) => makeArtifact(['Interior · PC', 'Playa · PC', 'Pie húmedo · PC'][index], artifactPath, 'preview')),
    ...oldReferences,
  ];
  if (!references.some((entry) => entry.path === brief)) references.push(makeArtifact('Brief S12 · alcance y reutilización', brief, 'source'));
  const files = [
    makeArtifact('Recibo S12 · hashes de fuentes antes/después', snapshotPath, 'source'),
    ...snapshot.files.map((entry) => makeArtifact(`Snapshot ${entry.phase} · ${entry.source}`, entry.snapshot, 'source')),
  ];
  const evidence = [
    makeArtifact('Entrega local S12', report),
    makeArtifact('Runtime · materiales y equivalencia de geometría', runtimePath),
    ...screenshots.map((artifactPath) => makeArtifact(`Captura · ${path.basename(artifactPath)}`, artifactPath)),
  ];
  const oldNotes = (row.notes || '').split(' S12: pintura compartida para rocas existentes')[0];
  const noteBase = oldNotes && !oldNotes.startsWith('Histórico:') ? 'Histórico: ' + oldNotes : oldNotes;
  Object.assign(row, {
    description: 'Roca natural compartida con caras de pintura ilustrada, fracturas escasas y una línea húmeda localizada.',
    variants: ['cara cálida', 'fractura escasa', 'pie húmedo'],
    destination: ['src/render/rockMaterials.js', 'src/render/vegetation.js'],
    state: 'applied',
    nextStep: 'Revisión de acabado artístico y FPS físicos pendientes. Acantilados, superficies y módulos de arco siguen pendientes; la geometría de playa S02 no cambia.',
    notes: `${noteBase}${noteBase ? ' ' : ''}S12: pintura compartida para rocas existentes, sin imágenes nuevas; fracturas escasas y línea húmeda localizada. Se conservan los 35 props volcánicos, de arena de combate y lava con su shader previo. El terreno no cambia; en la zona revisada hay laderas suaves. La geometría de playa S02 permanece intacta. Acantilados, superficies y módulos/arcos siguen pendientes; ajuste artístico, FPS físicos y publicación pendientes.`,
    references,
    files: [...(row.files || []).filter((entry) => !files.some((item) => item.path === entry.path)), ...files],
    evidence: [...(row.evidence || []).filter((entry) => !evidence.some((item) => item.path === entry.path)), ...evidence],
  });
  if (JSON.stringify(row) !== oldRow) changed = true;
}
if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.rock-faces.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(before)) throw new Error('El catálogo cambió en paralelo; conserva la revisión nueva.');
    fs.renameSync(temp, catalogPath);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
}
console.log(`S12 registrado: revisión ${catalog.revision}; dos filas aplicadas.`);
