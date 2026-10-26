// Add only this sand family's entries; preserve every other manifest binding.
import fs from 'node:fs';
import { SAND_MATERIALS, sandTextureId } from '../src/render/sandMaterials.js';
const file = new URL('../assets/manifest.json', import.meta.url);
const before = fs.readFileSync(file, 'utf8');
const manifest = JSON.parse(before);
const names = new Set(SAND_MATERIALS.flatMap((m) => [m.albedo, m.normal]));
for (const name of names) {
  const id = sandTextureId(name);
  const entry = {
    id, kind: 'tex', src: `textures/sand-family-v1/${name}-desktop.webp`,
    mobileSrc: `textures/sand-family-v1/${name}-mobile.webp`, repeat: [1, 1],
    ...(name.endsWith('normal') ? { data: true } : {}),
    notes: 'Supplied illustrated sand family; desktop 1024 / mobile 512. See docs/delivery/sand-family-v1.md.',
  };
  const old = manifest.assets.findIndex((e) => e.id === id);
  if (old < 0) manifest.assets.push(entry); else manifest.assets[old] = entry;
}
if (fs.readFileSync(file, 'utf8') !== before) throw new Error('Manifest changed during registration');
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Registered ${names.size} unique sand textures (wet shares dry normal)`);
