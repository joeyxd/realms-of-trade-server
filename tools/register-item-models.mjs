// Register reviewed item derivatives. Sources and proposed gameplay remain separate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'tools/gm-assets/package.json'))('sharp');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const report = read('docs/delivery/item-models-v1/optimization.json');
const manifest = read('assets/manifest.json'), thumbs = read('assets/editor/thumbnails.json');
const art = read('docs/art/items-index.json');
const boot = new Set(['antorcha', 'resina', 'coco']);
const heights = { antorcha: .52, resina: .45, coco: .42, cana: .65, especias: .65,
  meal_grog: .55, meal_roastFish: .35, meal_heartyBiscuit: .25, agua: .65, harina: .65, lima: .3, hierbas_aromaticas: .45 };
const english = { antorcha: 'Unlit torch', resina: 'Resin', coco: 'Coconut', cana: 'Sugar cane', especias: 'Spices',
  meal_grog: 'Grog', meal_roastFish: 'Roast fish', meal_heartyBiscuit: 'Hearty biscuit', agua: 'Water', harina: 'Flour', lima: 'Lime (concept)', hierbas_aromaticas: 'Herbs (concept)' };
for (const row of report.entries.filter(row => row.assigned)) {
  const desktop = row.derivatives.find(d => d.variant === 'desktop'), mobile = row.derivatives.find(d => d.variant === 'mobile');
  const id = desktop.id, name = `model:item-${id}-v1`, item = art.items.find(item => item.id === id);
  if (!item || !mobile || !fs.existsSync(path.join(root, desktop.path))) throw Error(`Missing reviewed derivative/reference ${id}`);
  const entry = { id: name, kind: 'model', src: desktop.path.replace(/^assets\//, ''), mobileSrc: mobile.path.replace(/^assets\//, ''),
    fit: 'height', height: heights[id], preload: boot.has(id),
    toon: { comic: false, rim: false, posterize: 0, sat: 1, bright: 1, occluder: false },
    shadow: false, notes: `${item.label}. Tripo original artwork; 512/256 WebP. ${boot.has(id) ? 'Gameplay visual.' : 'Decoration loaded on demand.'} ${item.group === 'Propuestas' ? 'Visual proposal; no gameplay item or recipe.' : ''}`.trim() };
  const at = manifest.assets.findIndex(entry => entry.id === name);
  if (at >= 0) manifest.assets[at] = entry; else manifest.assets.push(entry);
  const thumbnail = `assets/editor/thumbnails/item-${id}-v1.webp`;
  await sharp(path.join(root, item.reference)).resize(128, 128, { fit: 'inside' }).webp({ quality: 88 }).toFile(path.join(root, thumbnail));
  thumbs.assets[name] = { label: { es: item.label, en: english[id] }, thumbnail,
    stats: { triangles: row.sourceTriangles, bytes: desktop.bytes }, model: true };
  item.modelStatus = 'GLB recibido y optimizado';
  item.notes = boot.has(id) ? 'Modelo del autor integrado al uso visual; originales conservados.'
    : `Modelo del autor disponible como decoración en el editor. ${item.group === 'Propuestas' ? 'La mecánica continúa como propuesta.' : 'Conserva las recetas actuales.'}`;
}
write('assets/manifest.json', manifest); write('assets/editor/thumbnails.json', thumbs); write('docs/art/items-index.json', art);
console.log(JSON.stringify({ registered: report.totals.assignedCount, preload: [...boot], textureSizes: [512, 256] }));
