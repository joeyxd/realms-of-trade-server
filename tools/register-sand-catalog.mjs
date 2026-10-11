#!/usr/bin/env node
// Register the sand-family receipt in the local art catalog with a read-before-write guard.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'tools/art-catalog/catalog.json');
const RECEIPT_PATH = 'docs/art/sand/sand-family-v1-receipt.json';
const RECEIPT_FILE = path.join(ROOT, RECEIPT_PATH);
const DELIVERY = 'docs/delivery/sand-family-v1.md';
const REQUIRED_REVIEW_FILES = [
  DELIVERY,
  'docs/art/sand/map-desktop-spawn-v1.png',
  'docs/art/sand/map-desktop-coast-v1.png',
  'docs/art/sand/map-mobile-spawn-v1.png',
];
const REVIEW_FILES = {
  spawn: [
    { label: 'Revisión local · spawn escritorio', path: 'docs/art/sand/map-desktop-spawn-v1.png' },
    { label: 'Revisión local · spawn móvil emulado', path: 'docs/art/sand/map-mobile-spawn-v1.png' },
  ],
  coast: [
    { label: 'Revisión local · costa escritorio', path: 'docs/art/sand/map-desktop-coast-v1.png' },
    { label: 'Revisión local · costa móvil emulado', path: 'docs/art/sand/map-mobile-coast-v1.png' },
  ],
};
const TARGET_IDS = ['arena-seca', 'arena-humeda', 'arena-conchas', 'arena-ondulada', 'huellas-arena', 'arena-orilla'];

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`No se pudo leer ${label}: ${error.message}`); }
}
function uniqueByPath(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  });
}
function receiptSource(receipt, id) {
  const item = receipt.sourceCopies?.find((source) => source.id === id);
  if (!item?.path) throw new Error(`La receta no registra source-copy: ${id}`);
  return item.path;
}
function receiptDerivative(receipt, id) {
  const item = receipt.derivatives?.find((derivative) => derivative.id === id);
  if (!item?.path) throw new Error(`La receta no registra derivado: ${id}`);
  return item.path;
}
function sourceFile(label, pathName) { return { label, path: pathName, role: 'source' }; }
function mapFile(label, pathName, role) { return { label, path: pathName, role }; }
function pairFiles(receipt, { albedo, normal, albedoSource = albedo, normalSource = normal, sharedNormal = false, extraSources = [] }) {
  const albedoSourcePath = receiptSource(receipt, `${albedoSource}-albedo`);
  const normalSourcePath = receiptSource(receipt, `${normalSource}-normal`);
  const entries = [
    sourceFile('Fuente PNG de albedo · copia exacta', albedoSourcePath),
    sourceFile(sharedNormal ? 'Fuente PNG de normal · compartida con arena seca' : 'Fuente PNG de normal · copia exacta', normalSourcePath),
    mapFile('Albedo escritorio · 1024', receiptDerivative(receipt, `${albedo}-albedo-desktop`), 'albedo'),
    mapFile('Albedo móvil · 512', receiptDerivative(receipt, `${albedo}-albedo-mobile`), 'mobile'),
    mapFile('Normal escritorio · 1024 · datos lineales', receiptDerivative(receipt, `${normal}-normal-desktop`), 'normal'),
    mapFile('Normal móvil · 512 · datos lineales', receiptDerivative(receipt, `${normal}-normal-mobile`), 'mobile'),
    sourceFile('Recibo de fuentes y derivados', RECEIPT_PATH),
    ...extraSources.map(({ label, id }) => sourceFile(label, receiptSource(receipt, id))),
  ];
  return uniqueByPath(entries);
}
function previewReference(label, pathName) { return { label, path: pathName, role: 'preview' }; }
function reference(label, pathName) { return { label, path: pathName, role: 'reference' }; }
function withReferences(row, additions, firstPreview) {
  const prior = Array.isArray(row.references) ? row.references : [];
  const preview = previewReference(firstPreview.label, firstPreview.path);
  row.references = uniqueByPath([preview, ...prior, ...additions]);
}
function withFiles(row, additions) {
  row.files = uniqueByPath([...(Array.isArray(row.files) ? row.files : []), ...additions]);
}
function setEvidence(row, view, root) {
  const old = Array.isArray(row.evidence) ? row.evidence : [];
  const candidates = [
    { label: 'Ficha de la familia y revisión visual local', path: DELIVERY },
    ...REVIEW_FILES[view],
  ];
  row.evidence = uniqueByPath([
    ...old,
    ...candidates.filter((entry) => fs.existsSync(path.join(root, entry.path))),
  ]);
}
function reviewComplete(root) {
  return REQUIRED_REVIEW_FILES.every((relative) => fs.existsSync(path.join(root, relative)));
}
function reviewText(isApplied) {
  if (isApplied) return 'Integrado en el mapa local con capturas PC/móvil emulado; el ajuste artístico final sigue abierto.';
  return 'Material y derivados preparados. La aplicación local queda pendiente hasta completar la ficha y las capturas de escritorio, costa y móvil emulado. No hay aceptación de FPS en teléfono físico.';
}
function prepareRow(row, { receipt, root, pair, previewId, previewLabel, reviewView, description, variants, nextStepPrepared, nextStepApplied, notes, fullShoreReferences = false }) {
  const done = reviewComplete(root);
  const desktopPreview = receiptDerivative(receipt, `${previewId}-albedo-desktop`);
  const refs = [
    reference('Ruta S01 · familia de arena', 'docs/briefs/visual-s01-sand-family.md'),
  ];
  if (fullShoreReferences) {
    refs.unshift(
      reference('Fuente completa de orilla · albedo PNG intacto', receiptSource(receipt, 'shore-albedo')),
      reference('Fuente completa de orilla · normal PNG intacto', receiptSource(receipt, 'shore-normal')),
    );
  }
  row.category = 'Terreno y costa';
  row.description = description;
  row.variants = variants;
  row.state = done ? 'applied' : 'prepared';
  row.nextStep = done ? nextStepApplied : nextStepPrepared;
  row.notes = `${notes} ${reviewText(done)}`;
  withReferences(row, refs, { label: previewLabel, path: desktopPreview });
  withFiles(row, pairFiles(receipt, pair));
  setEvidence(row, reviewView, root);
}

const initialBytes = fs.readFileSync(CATALOG_PATH);
const initialHash = hash(initialBytes);
const catalog = JSON.parse(initialBytes.toString('utf8'));
const receipt = readJson(RECEIPT_FILE, RECEIPT_PATH);
if (!catalog || !Array.isArray(catalog.rows) || !Number.isInteger(catalog.revision) || !Number.isInteger(catalog.version)) throw new Error('Contrato de catálogo inválido');
if (catalog.version !== 1 || receipt.family !== 'sand-family-v1' || !Array.isArray(receipt.sources) || !Array.isArray(receipt.sourceCopies) || !Array.isArray(receipt.derivatives)) throw new Error('Versión de catálogo o recibo no compatible');

const rowsById = new Map();
for (const row of catalog.rows) {
  if (rowsById.has(row.id)) throw new Error(`ID duplicado en catálogo: ${row.id}`);
  rowsById.set(row.id, row);
}
for (const requiredId of ['arena-seca', 'arena-humeda', 'arena-conchas', 'arena-compactada', 'arena-orilla', 'huellas-arena']) {
  if (!rowsById.has(requiredId)) throw new Error(`Falta fila requerida: ${requiredId}`);
}

const rowSpecs = [
  {
    id: 'arena-seca', pair: { albedo: 'dry', normal: 'dry' }, previewId: 'dry', reviewView: 'spawn',
    previewLabel: 'Arena seca dorada · preview actual · escritorio 1024',
    description: 'Arena dorada ilustrada con surcos, guijarros y pequeñas conchas pintadas; selección visual del autor.',
    variants: ['seca dorada', 'guijarros y conchas finas pintados'],
    nextStepPrepared: 'Completar la revisión visual local y después ajustar escala y repetición con la aceptación del autor.',
    nextStepApplied: 'Recoger aceptación y ajustes del autor sobre escala y repetición; revisar FPS en teléfono físico.',
    notes: `Histórico: ${rowsById.get('arena-seca').notes} Familia v1: se conserva el albedo elegido, sus mapas normal y los candidatos históricos; las sombras pequeñas de conchas/guijarros están pintadas y las rocas grandes siguen como objetos separados.`,
  },
  {
    id: 'arena-humeda', pair: { albedo: 'wet', normal: 'dry', sharedNormal: true }, previewId: 'wet', reviewView: 'coast',
    previewLabel: 'Arena húmeda · preview escritorio 1024',
    description: 'Acabado húmedo de arena dorada con albedo propio y el mapa normal seco compartido.',
    variants: ['borde mojado', 'variación húmeda de la base dorada'],
    nextStepPrepared: 'Completar revisión visual local y afinar la transición y respuesta de brillo en el shader.',
    nextStepApplied: 'Recoger aceptación del autor y afinar mezcla/brillo en el shader; revisar FPS en teléfono físico.',
    notes: `Histórico: ${rowsById.get('arena-humeda').notes} El paquete incluye el albedo húmedo y comparte explícitamente el normal de arena seca; el brillo final aún requiere revisión del shader.`,
  },
  {
    id: 'arena-conchas', pair: { albedo: 'dry', normal: 'dry' }, previewId: 'dry', reviewView: 'spawn',
    previewLabel: 'Arena dorada con pequeñas conchas pintadas · escritorio 1024',
    description: 'Acabado de arena con conchas pequeñas y guijarros dibujados en el albedo; las conchas grandes son objetos separados pendientes.',
    variants: ['conchas pequeñas pintadas', 'guijarros finos pintados'],
    nextStepPrepared: 'Completar revisión visual local; las siluetas de conchas grandes requieren un corte de objetos separado.',
    nextStepApplied: 'Recoger aceptación del autor; las siluetas grandes siguen como objetos separados y falta FPS en teléfono físico.',
    notes: `Histórico: ${rowsById.get('arena-conchas').notes} El par seco aporta solo el acabado con conchas pequeñas pintadas; no registra ni sustituye los objetos de conchas grandes, que siguen pendientes por separado.`,
  },
  {
    id: 'arena-ondulada', pair: { albedo: 'ripple', normal: 'ripple' }, previewId: 'ripple', reviewView: 'spawn',
    previewLabel: 'Arena ondulada · acabado de surcos · escritorio 1024',
    description: 'Material de arena con surcos ondulados ilustrados y mapa normal lineal a juego.',
    variants: ['surcos ondulados', 'relieve suave por normal'],
    nextStepPrepared: 'Completar revisión visual local y decidir su escala frente a la base seca.',
    nextStepApplied: 'Recoger aceptación del autor y afinar escala frente a la arena seca; revisar FPS en teléfono físico.',
    notes: 'Familia v1: material de surcos ondulados preparado como acabado propio. No representa por sí solo arena compactada ni sustituye su máscara localizada.',
  },
  {
    id: 'huellas-arena', pair: { albedo: 'footprints', normal: 'footprints' }, previewId: 'footprints', reviewView: 'spawn',
    previewLabel: 'Arena con huellas estáticas · escritorio 1024',
    description: 'Acabado ilustrado con huellas y conchas para una banda localizada de paso estática.',
    variants: ['banda estática localizada de paso', 'huellas y conchas pintadas'],
    nextStepPrepared: 'Completar revisión visual local y limitar el uso a bandas estáticas; las huellas dinámicas de jugadores son otro corte.',
    nextStepApplied: 'Recoger aceptación del autor; las huellas dinámicas siguen pendientes y falta FPS en teléfono físico.',
    notes: `Histórico: ${rowsById.get('huellas-arena').notes} El material sirve como banda de paso localizada estática; no implementa huellas dinámicas por jugador ni su duración.`,
  },
  {
    id: 'arena-orilla', pair: { albedo: 'shore-sand', normal: 'shore-sand', albedoSource: 'shore', normalSource: 'shore', extraSources: [
      { label: 'Fuente completa de orilla · albedo PNG intacto', id: 'shore-albedo' },
      { label: 'Fuente completa de orilla · normal PNG intacto', id: 'shore-normal' },
    ] }, previewId: 'shore-sand', reviewView: 'coast', fullShoreReferences: true,
    previewLabel: 'Muestra recortada de arena de orilla · escritorio 1024',
    description: 'Muestra repetible de arena recortada de la fuente de orilla; el agua pintada de la imagen completa permanece como referencia.',
    variants: ['muestra de arena costera', 'mezcla con agua y espuma animadas'],
    nextStepPrepared: 'Completar revisión visual local de costa; conservar la muestra recortada y el agua/espuma animadas del renderer.',
    nextStepApplied: 'Recoger aceptación del autor sobre el contacto agua/arena; la espuma sigue animada y falta FPS en teléfono físico.',
    notes: `Histórico: ${rowsById.get('arena-orilla').notes} La pareja repetible usa solo el recorte inferior izquierdo x=0, y=742, 512×512 y sus escalas 1024/512. Las fuentes completas de orilla quedan como referencia; la imagen completa con agua pintada no se usa como material repetible. El agua y la espuma existentes siguen animadas.`,
  },
];

for (const spec of rowSpecs) {
  let row = rowsById.get(spec.id);
  if (!row) {
    row = {
      id: spec.id,
      name: 'Arena ondulada',
      category: 'Terreno y costa',
      priority: 'P0',
      kind: 'material',
      destination: ['src/render/terrain.js'],
      state: 'prepared',
      references: [],
      files: [],
      evidence: [],
    };
    catalog.rows.push(row);
    rowsById.set(spec.id, row);
  }
  // Preserve the later walking-footprints delivery when re-registering the original texture family.
  if (spec.id === 'huellas-arena' && row.evidence?.some((e) => e.path === 'docs/delivery/sand-footprints-v1.md')) continue;
  prepareRow(row, {
    receipt,
    root: ROOT,
    pair: spec.pair,
    previewId: spec.previewId,
    previewLabel: spec.previewLabel,
    reviewView: spec.reviewView,
    description: spec.description,
    variants: spec.variants,
    nextStepPrepared: spec.nextStepPrepared,
    nextStepApplied: spec.nextStepApplied,
    notes: spec.notes,
    fullShoreReferences: spec.fullShoreReferences,
  });
}

const compacted = rowsById.get('arena-compactada');
compacted.notes = `Histórico: ${compacted.notes} Arena compactada sigue sin bitmap dedicado; arena-ondulada es un acabado de surcos distinto y no acredita compactación.`;

// Ensure every prepared target has files and every evidence link points at this review packet.
for (const id of TARGET_IDS) {
  const row = rowsById.get(id);
  if (!Array.isArray(row.files) || row.files.length < 7 || !Array.isArray(row.references) || !Array.isArray(row.evidence)) throw new Error(`Contrato incompleto para ${id}`);
}
const nextRevision = catalog.revision + 1;
catalog.revision = nextRevision;
catalog.updatedAt = new Date().toISOString();
const outputBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const tempPath = `${CATALOG_PATH}.${process.pid}.sand-register.tmp`;
try {
  fs.writeFileSync(tempPath, outputBytes, { flag: 'wx' });
  const currentBytes = fs.readFileSync(CATALOG_PATH);
  if (hash(currentBytes) !== initialHash) throw new Error('El catálogo cambió desde la lectura inicial; no se escribió ningún cambio. Vuelve a ejecutar el registrador.');
  fs.renameSync(tempPath, CATALOG_PATH);
} finally {
  if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
}
console.log(`Catálogo de arena actualizado: ${TARGET_IDS.length} filas, revisión ${nextRevision}.`);
