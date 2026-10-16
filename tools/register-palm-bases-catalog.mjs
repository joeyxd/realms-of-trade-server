// Add S06's two specific rows without accepting the broader standalone shrub family.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'tools/art-catalog/catalog.json');
const before = fs.readFileSync(file), data = JSON.parse(before), report = 'docs/delivery/palm-bases-v1.md';
const a = (label, p, role) => ({ label, path: p, ...(role ? { role } : {}) });
const source = 'docs/art/source/palm-bases-v1', tex = 'assets/textures/palm-base-v1';
const files = [
  ...['open', 'lush'].map((s) => a('Modelo de base · ' + s + ' · raíces/hojas', `assets/models/palm-base-${s}-v1.glb`, 'model')),
  a('Original del autor · color', 'docs/art/source/palm-base-textures-v1/albedo.png', 'source'),
  a('Original del autor · normal', 'docs/art/source/palm-base-textures-v1/normal.png', 'source'),
  a('Recortes, máscara, probes y hashes', 'docs/art/source/palm-base-textures-v1/receipt.json', 'source'),
  a('Modelos · hashes, UV y atributos', source + '/receipt.json', 'source'),
  a('Fuentes · hashes', source + '/source-snapshot.json', 'source'),
  ...['palmBaseGeometry', 'palmBaseMaterials', 'vegetation', 'palmMaterials'].map((n) => a('Fuente editable · ' + n, `${source}/${n}.source.js`, 'source')),
  ...['prepare-palm-bases', 'prepare-palm-base-textures'].map((n) => a('Generador · ' + n, `${source}/${n}.source.mjs`, 'source')),
  ...['albedo', 'normal'].flatMap((c) => ['pc', 'mobile'].map((d) => a(`Hojas · ${c} · ${d} · ${d === 'pc' ? '512×256' : '256×128'}`, `${tex}/${c}-${d}.webp`, d === 'mobile' ? 'mobile' : c))),
  ...['albedo', 'normal'].flatMap((c) => ['desktop', 'mobile'].map((d) => a(`Corteza compartida S05 · ${c} · ${d}`, `assets/textures/palm-family-v2/${c}-${d}.webp`, d === 'mobile' ? 'mobile' : c))),
];
const evidence = [a('Entrega S06 · alcance local', report), a('Carga, shaders y fallback · ocho casos', 'docs/art/palm-bases/browser-evidence-v1.json'),
  ...['desktop', 'mobile', 'low'].flatMap((d) => ['map', 'map-clean', 'contact', 'gallery'].map((v) => a(`${v === 'gallery' ? 'Muestrario temporal 1×' : v === 'contact' ? 'Contacto real' : 'Mapa real'} · ${d}`, `docs/art/palm-bases/${d}-${v}-v1.png`))),
  ...['missing-model', 'invalid-model', 'missing-color', 'missing-normal', 'disabled'].map((d) => a('Fallback · ' + d, `docs/art/palm-bases/${d}-contact-v1.png`)),
  a('Viento · reloj 0', 'docs/art/palm-bases/desktop-wind-0-v1.png'), a('Viento · reloj 2,1', 'docs/art/palm-bases/desktop-wind-2-v1.png'),
  a('Comparación · normal apagado', 'docs/art/palm-bases/desktop-normal-off-v1.png')];
const specs = [
  { id: 'raices-palma', name: 'Raíces de palmera', description: 'Cinco o seis raíces en relieve que unen el tronco con la arena; corteza cálida S05 reutilizada.',
    variants: ['cinco raíces · base abierta', 'seis raíces · base frondosa'], preview: 'docs/art/palm-bases/desktop-contact-v1.png' },
  { id: 'plantas-base-palma', name: 'Plantas al pie de palmera', description: 'Dos o tres rosetas bajas de cinco hojas, pintadas con el atlas del autor, con recorte y viento.',
    variants: ['dos hojas pintadas', 'base abierta', 'base frondosa'], preview: 'docs/art/palm-bases/base-lush-preview-v1.png' },
];
let changed = false;
for (const spec of specs) {
  const refs = [a(spec.id === 'raices-palma' ? 'Contacto en palma real' : 'Preview · base frondosa · modelo 1×', spec.preview, 'preview'),
    a('Preview · base abierta · modelo 1×', 'docs/art/palm-bases/base-open-preview-v1.png', 'preview'),
    a('Referencia original · palmera tropical', source + '/reference.png', 'reference'),
    a('Brief S06 · reutilización y contrato', 'docs/briefs/visual-s06-palm-bases.md', 'source')];
  for (const artifact of [...files, ...refs, ...evidence]) if (!fs.existsSync(path.join(root, artifact.path))) throw Error('Missing S06 artifact: ' + artifact.path);
  const old = data.rows.find((r) => r.id === spec.id);
  if (old) { if (!old.evidence.some((e) => e.path === report)) throw Error('Existing S06 row differs: ' + spec.id); continue; }
  const row = { id: spec.id, name: spec.name, category: 'Vegetación', priority: 'P1', kind: 'object', description: spec.description, variants: spec.variants,
    destination: ['src/render/palmBaseGeometry.js', 'src/render/palmBaseMaterials.js', 'src/render/vegetation.js', tex], state: 'applied',
    nextStep: 'Revisar tamaño/densidad y repetición de corteza con el autor; FPS físicos pendientes. Arbusto tropical independiente sigue propuesto.',
    notes: 'S06 local: 144 bases (74 abiertas/70 frondosas) en 234 palmas existentes; hash de renderer, sin RNG ni cambios de colisión. Dos GLB 410/540 tri, 125.680 B juntos; raíces rígidas con corteza S05 v2 existente. Hojas en atlas 2×1 PC 512×256 / táctil 256×128: par 74.944 / 30.006 B. Alpha 0,35 y viento compartidos en color/contorno/sombra; normal suave 0,16, bake no certificado. Huella excluye agua/caminos/muelles, pendientes, props y accesos. Ocho casos PC/móvil/low y cinco fallos; 62/62 tests. Fuentes históricas conservadas. Sin gameplay de plantas, sin FPS físicos ni publicación.',
    references: refs, files, evidence };
  const index = data.rows.findIndex((r) => r.id === 'arbusto-tropical');
  data.rows.splice(index < 0 ? data.rows.length : index, 0, row); changed = true;
}
if (changed) {
  data.revision++; data.updatedAt = new Date().toISOString(); const temp = `${file}.${process.pid}.palm-bases.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw Error('Catalog changed concurrently'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S06 registered: revision ${data.revision}, ${data.rows.length} rows, ${data.rows.filter((r) => r.state === 'applied').length} applied.`);
