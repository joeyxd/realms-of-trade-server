// Register only the two runtime atlases; previews/original PNGs remain outside game requests.
import fs from 'node:fs';
import { GROUND_TEXTURES, groundTextureId } from '../src/render/groundMaterials.js';
const file = new URL('../assets/manifest.json', import.meta.url);
const before = fs.readFileSync(file, 'utf8'), manifest = JSON.parse(before);
let changed = false;
for (const name of GROUND_TEXTURES) {
  const entry = { id: groundTextureId(name), kind: 'tex',
    src: `textures/ground-family-v1/${name}-desktop.webp`,
    mobileSrc: `textures/ground-family-v1/${name}-mobile.webp`, repeat: [1, 1],
    ...(name.endsWith('normal') ? { data: true } : {}),
    notes: 'Four supplied painted ground pairs in a padded atlas; PC 2048 / mobile 1024. See docs/delivery/ground-family-v1.md.' };
  for (const relative of [entry.src, entry.mobileSrc]) if (!fs.existsSync(new URL('../assets/' + relative, import.meta.url))) throw new Error('Missing derivative: ' + relative);
  const prior = manifest.assets.find((e) => e.id === entry.id);
  if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new Error('Refusing different entry: ' + entry.id);
  if (!prior) { manifest.assets.push(entry); changed = true; }
}
if (fs.readFileSync(file, 'utf8') !== before) throw new Error('Manifest changed during registration');
if (changed) fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Ground manifest: 2 runtime atlas entries${changed ? ' added' : ' unchanged'}.`);
