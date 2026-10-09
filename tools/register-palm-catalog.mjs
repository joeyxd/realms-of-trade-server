// Register only S05's five existing rows after every concrete source and local evidence file exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file), data = JSON.parse(before), report = 'docs/delivery/palm-family-v1.md';
const a = (label, relative, role) => ({ label, path: relative, ...(role ? { role } : {}) });
const source = 'docs/art/source/palm-family-v1', textures = 'assets/textures/palm-family-v2';
const files = [a('Original del autor · atlas color completo', 'docs/art/source/palm-textures-v2/albedo.png', 'source'),
  a('Original del autor · atlas normal completo', 'docs/art/source/palm-textures-v2/normal.png', 'source'),
  a('Recortes, máscara y hashes · atlas v2', 'docs/art/source/palm-textures-v2/receipt.json', 'source'),
  a('Geometría v1 · hashes y UV compatibles con atlas v2', source + '/receipt.json', 'source'),
  a('Hashes de fuentes descargables', source + '/source-snapshot.json', 'source'),
  ...['palmGeometry', 'palmMaterials', 'vegetation', 'lighting'].map((n) => a('Fuente editable · ' + n, `${source}/${n}.source.js`, 'source')),
  ...['prepare-palm-family', 'prepare-palm-textures-v2'].map((n) => a('Generador reproducible · ' + n, `${source}/${n}.source.mjs`, 'source')),
  ...['albedo', 'normal'].flatMap((c) => ['desktop', 'mobile'].map((d) => a(`Atlas ${c} · ${d} · ${d === 'desktop' ? 1024 : 512}`, `${textures}/${c}-${d}.webp`, d === 'mobile' ? 'mobile' : c)))];
const references = [a('Referencia original · palmera tropical', source + '/reference.png', 'reference'),
  a('Brief S05 · reutilización, atlas y sombras', 'docs/briefs/visual-s05-palm-family.md', 'reference')];
const evidence = [a('Entrega S05 · alcance local', report), ...['desktop', 'mobile', 'low'].flatMap((d) => [
  a('Mapa real · ' + d, `docs/art/palms/${d}-map-clean-v1.png`), a('Mapa con HUD · ' + d, `docs/art/palms/${d}-map-v1.png`),
  a('Contacto en palma real · ' + d, `docs/art/palms/${d}-contact-v1.png`),
  a('Muestrario temporal · escala de modelo 1× · ' + d, `docs/art/palms/${d}-gallery-v1.png`),
  a('Ensayo de sombra · una fronda real · ' + d, `docs/art/palms/${d}-shadow-holes-v1.png`)]),
  a('Control QA · misma fronda con recorte de sombra desactivado', 'docs/art/palms/desktop-shadow-solid-control-v1.png'),
  a('Comparación · normal apagado · muestrario', 'docs/art/palms/desktop-normal-off-v1.png'),
  a('Viento · reloj 0 · muestrario', 'docs/art/palms/desktop-wind-0-v1.png'),
  a('Viento · reloj 2,1 · muestrario', 'docs/art/palms/desktop-wind-2-v1.png'),
  a('Sombra con viento · reloj 0', 'docs/art/palms/desktop-shadow-wind-0-v1.png'),
  a('Sombra con viento · reloj 2,1', 'docs/art/palms/desktop-shadow-wind-2-v1.png'),
  ...['missing-model', 'invalid-model', 'missing-color', 'missing-normal', 'disabled'].map((d) => a('Fallback · ' + d, `docs/art/palms/${d}-map-clean-v1.png`)),
  a('Carga, shaders, alpha y fallback · ocho casos', 'docs/art/palms/browser-evidence-v1.json')];
const specs = [
  { id: 'palma-alta', style: 'tall', description: 'Palma esbelta de tronco casi recto, corteza pintada y nueve frondas recortadas.', variants: ['alta y recta', 'copa radial de nueve hojas'] },
  { id: 'palma-curva', style: 'curved', description: 'Palma de tronco curvo cálido, diez hojas pintadas, cocos y viento compartido.', variants: ['curva visible', 'copa radial de diez hojas'] },
  { id: 'palma-corta', style: 'short', description: 'Palma de proporción baja y copa ancha de once hojas; silueta propia.', variants: ['corta y ancha', 'copa de once hojas'] },
  { id: 'copa-palma-doble', description: 'Dos frondas del atlas del autor en cards curvas, con tinta, huecos de alpha y sombras perforadas.', variants: ['hoja A', 'hoja B', 'recorte en color, contorno y sombra'] },
  { id: 'm08-corteza', description: 'Corteza cálida del autor aplicada por UV al tronco segmentado de las tres palmeras.', variants: ['albedo pintado', 'normal suave', 'fallback geométrico'] },
];
let changed = false;
for (const spec of specs) {
  const row = data.rows.find((r) => r.id === spec.id); if (!row) throw new Error('Missing S05 row: ' + spec.id);
  if (row.evidence.some((e) => e.path === report)) continue;
  const models = spec.style ? [a('Modelo portable · ' + spec.style + ' · dos partes', `assets/models/palm-${spec.style}-v1.glb`, 'model')] : [];
  const preview = spec.style ? a('Preview · modelo 1× en muestrario temporal', `docs/art/palms/palm-${spec.style}-preview-v1.png`, 'preview') :
    a(spec.id === 'm08-corteza' ? 'Atlas runtime · corteza en cuadrante superior izquierdo' : 'Muestrario temporal · tres copas',
      spec.id === 'm08-corteza' ? textures + '/albedo-desktop.webp' : 'docs/art/palms/desktop-gallery-v1.png', 'preview');
  for (const artifact of [...files, ...models, ...references, preview, ...evidence]) if (!fs.existsSync(path.join(root, artifact.path))) throw new Error('Missing S05 artifact: ' + artifact.path);
  row.state = 'applied'; row.description = spec.description; row.variants = spec.variants;
  row.destination = ['src/render/palmGeometry.js', 'src/render/palmMaterials.js', 'src/render/vegetation.js', 'src/render/lighting.js', textures,
    ...(spec.style ? [`assets/models/palm-${spec.style}-v1.glb`] : [])];
  row.notes = 'Actual S05 local: atlas y normal del autor conservados; recortes 2×2 PC 1024/móvil 512. Tres modelos v1 compatibles con atlas v2; 234 posiciones existentes, sin cambiar RNG/colisiones. Alpha en hojas, contornos y sombras: huecos dejan pasar luz; viento también en la sombra. PCF del sol 0,35 sin aumentar mapas: bordes más definidos; huecos interiores pequeños se pierden en low 1024 y pueden quedar tapados por otras hojas. V1 de máscara conservada como draft, v2 corrige interiores negros opacos. Normales a fuerza 0,16; coincidencia visual, bake no certificado. PC/móvil emulado/low y cinco fallos revisados. Arte fino, FPS físicos y publicación pendientes. Raíces/bases/restos y recogida de cocos quedan fuera del corte.';
  row.nextStep = 'Revisar proporciones, repetición de corteza y ajuste artístico con el autor; después vegetación de base/raíces. FPS físicos pendientes.';
  row.files = [...models, ...files, ...row.files.filter((x) => ![...models, ...files].some((y) => y.path === x.path))];
  row.references = [preview, ...references, ...row.references.filter((x) => !references.some((y) => y.path === x.path))];
  row.evidence = [...evidence, ...row.evidence.filter((x) => !evidence.some((y) => y.path === x.path))]; changed = true;
}
if (changed) {
  data.revision++; data.updatedAt = new Date().toISOString(); const temp = `${file}.${process.pid}.palm.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Catalog changed concurrently'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S05 registered: revision ${data.revision}, ${data.rows.length} rows.`);
