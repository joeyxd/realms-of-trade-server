// Register only this ground cut, preserving all other catalogue rows and concurrent edits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file), catalog = JSON.parse(before);
const receiptPath = 'docs/art/ground/ground-family-v1-receipt.json';
const receipt = JSON.parse(fs.readFileSync(path.join(root, receiptPath)));
const report = 'docs/delivery/ground-family-v1.md', browser = 'docs/art/ground/browser-evidence-v1.json';
const specs = [
  { id: 'transicion-arena-hierba', name: 'Transición arena–hierba', pair: 'sand-grass', view: 'beach', description: 'Degradado ilustrado de arena a pastizal que sigue el borde de la playa.', variants: ['borde playa–pastizal', 'normal orientada al borde'] },
  { id: 'arena-compactada', name: 'Arena compactada', pair: 'sand-dirt', view: 'road', description: 'Arena y tierra compactada pintadas en los bordes de sendero y zonas transitadas del pueblo.', variants: ['borde de sendero', 'zona transitada de tierra y arena'] },
  { id: 'hierba-tropical-material', name: 'Hierba tropical · material de suelo', pair: 'grass', view: 'beach', description: 'Hierba y claros de tierra pintados sobre el suelo; las matas con volumen son objetos separados.', variants: ['hierba tropical', 'claros de tierra pintados'] },
  { id: 'tierra-seca-material', name: 'Tierra seca · senderos y pueblo', pair: 'dirt', view: 'town', description: 'Tierra seca ilustrada con grietas, guijarros y conchas pintados para senderos y suelo del pueblo.', variants: ['interior del sendero', 'suelo alrededor de la plaza'] },
];
const unique = (entries) => [...new Map(entries.map((e) => [e.path, e])).values()];
for (const relative of [report, browser, ...['desktop', 'mobile'].flatMap((d) => ['beach','road','town'].map((v) => `docs/art/ground/${d}-${v}-v1.png`))]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error('Missing inspected evidence: ' + relative);
}
let changed = false;
for (const spec of specs) {
  let row = catalog.rows.find((r) => r.id === spec.id);
  if (row?.evidence?.some((e) => e.path === report)) continue;
  if (!row) { row = { id: spec.id, name: spec.name, category: 'Terreno y costa', priority: 'P0', kind: 'material', references: [], files: [], evidence: [], notes: '' }; catalog.rows.push(row); }
  const sources = receipt.sources.filter((s) => s.pairId === spec.pair);
  const previews = receipt.previews.filter((s) => s.pairId === spec.pair);
  if (sources.length !== 2 || previews.length !== 4) throw new Error('Incomplete material pair: ' + spec.pair);
  const files = [
    ...sources.map((s) => ({ label: s.kind === 'normal' ? 'Normal PNG · copia exacta' : 'Color PNG · copia exacta', path: s.path, role: 'source' })),
    ...previews.map((p) => ({ label: `${p.channel === 'normal' ? 'Normal lineal' : 'Albedo'} · preview ${p.device === 'mobile' ? 'móvil 512' : 'PC 1024'}`, path: p.path, role: p.device === 'mobile' ? 'mobile' : p.channel })),
    ...receipt.runtimeAtlases.map((p) => ({ label: `Atlas compartido · ${p.channel === 'normal' ? 'normal lineal' : 'albedo'} · ${p.device === 'mobile' ? 'móvil 1024' : 'PC 2048'}`, path: p.path, role: p.device === 'mobile' ? 'mobile' : p.channel })),
    { label: 'Fuentes, distribución y hashes', path: receiptPath, role: 'source' },
  ];
  for (const f of files) if (!fs.existsSync(path.join(root, f.path))) throw new Error('Missing material file: ' + f.path);
  const preview = previews.find((p) => p.channel === 'albedo' && p.device === 'desktop');
  row.description = spec.description; row.variants = spec.variants; row.state = 'applied';
  row.destination = ['src/render/groundMaterials.js', 'src/render/terrain.js', 'assets/textures/ground-family-v1/'];
  row.nextStep = 'Afinar escala, repetición y mezcla con el autor; después continuar los objetos de conchas, cantos y palmeras. FPS físicos pendientes.';
  row.notes = 'Actual S03: par del autor aplicado localmente; cuatro materiales comparten dos atlas con variante móvil. Gradientes adaptados a la máscara, normales lineales a intensidad 0.22; pueblo conserva pequeña plaza de piedra. No cambia altura, colisiones ni clasificación de terreno. PC/móvil emulado y fallos de carga comprobados; arte final y FPS físicos abiertos.' + (row.notes ? ' Histórico: ' + row.notes : '');
  row.references = unique([{ label: spec.name + ' · color recibido', path: preview.path, role: 'preview' }, ...(row.references || []).map((r) => r.role === 'preview' ? { ...r, role: 'reference' } : r), { label: 'Brief S03', path: 'docs/briefs/visual-s03-ground-family.md', role: 'reference' }]);
  row.files = unique([...(row.files || []), ...files]);
  row.evidence = unique([{ label: 'Entrega local S03', path: report }, ...['desktop','mobile','low'].map((d) => ({ label: `En mapa · ${d === 'desktop' ? 'PC' : d === 'mobile' ? 'móvil emulado' : 'calidad baja'}`, path: `docs/art/ground/${d}-${spec.view}-v1.png` })), { label: 'Carga real, samplers y fallback', path: browser }, ...(row.evidence || [])]);
  changed = true;
}
if (changed) {
  catalog.revision++; catalog.updatedAt = new Date().toISOString(); const temp = `${file}.${process.pid}.ground.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Catalogue changed during registration');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`Ground catalogue: four rows, revision ${catalog.revision}, ${catalog.rows.length} total rows.`);
