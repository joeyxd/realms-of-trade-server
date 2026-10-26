// Register only the standalone shrub family, preserving concurrent manifest entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'assets/manifest.json');
const before = fs.readFileSync(file), data = JSON.parse(before);
const entries = ['round', 'low', 'tall'].map((style) => ({ id: `model:shrub-${style}-v1`, kind: 'model', src: `models/shrub-${style}-v1.glb`,
  fit: 'none', toon: { flat: false, comic: false }, notes: 'S07 cosmetic shrub: rigid painted wood and four atlas leaf silhouettes. Wind and alpha in vegetation.js. See docs/delivery/shrubs-v1.md.' }));
for (const channel of ['albedo', 'normal']) entries.push({ id: `tex:shrub-${channel}-v1`, kind: 'tex',
  src: `textures/shrub-v1/${channel}-pc.webp`, mobileSrc: `textures/shrub-v1/${channel}-mobile.webp`,
  ...(channel === 'normal' ? { data: true } : {}), notes: 'S07 generated leaf atlas, PC 512x512 / coarse pointer 256x256; authoritative color alpha, per-tile gutters. Normal data linear; generated source, bake not certified.' });
let changed = false;
for (const entry of entries) {
  for (const p of [entry.src, entry.mobileSrc].filter(Boolean)) if (!fs.existsSync(path.join(root, 'assets', p))) throw Error('Missing asset: ' + p);
  const old = data.assets.find((a) => a.id === entry.id);
  if (old && JSON.stringify(old) !== JSON.stringify(entry)) throw Error('Existing entry differs: ' + entry.id);
  if (!old) { data.assets.push(entry); changed = true; }
}
const valid = normalizeManifest(data);
for (const entry of entries) if (!valid.entries.has(entry.id)) throw Error(valid.errors.join('\n'));
if (changed) {
  const temp = `${file}.${process.pid}.shrubs.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw Error('Manifest changed concurrently'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log('S07: three shrub models and one device-selected leaf texture pair registered.');
