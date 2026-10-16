// Register only S05's portable geometry and device-selected shared atlas pair.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'assets/manifest.json');
const before = fs.readFileSync(file), data = JSON.parse(before);
const entries = ['tall', 'curved', 'short'].map((style) => ({ id: `model:palm-${style}-v1`, kind: 'model',
  src: `models/palm-${style}-v1.glb`, fit: 'none', toon: { flat: false, comic: false },
  notes: 'S05 geometry + authored atlas UV. Two parts, _FLEX/_PAINT custom attributes; shared textures applied by vegetation.js. See docs/delivery/palm-family-v1.md.' }));
for (const channel of ['albedo', 'normal']) entries.push({ id: `tex:palm-${channel}-v2`, kind: 'tex',
  src: `textures/palm-family-v2/${channel}-desktop.webp`, mobileSrc: `textures/palm-family-v2/${channel}-mobile.webp`,
  ...(channel === 'normal' ? { data: true } : {}), notes: 'S05 supplied painted palm atlas; 1024 PC / 512 coarse pointer, four cropped components. Normal is linear data.' });
let changed = false;
// Replace only the two exact, unaccepted draft entries; keep their files and receipt for recovery.
for (const channel of ['albedo', 'normal']) {
  const old = { id: `tex:palm-${channel}-v1`, kind: 'tex', src: `textures/palm-family-v1/${channel}-desktop.webp`,
    mobileSrc: `textures/palm-family-v1/${channel}-mobile.webp`, ...(channel === 'normal' ? { data: true } : {}),
    notes: 'S05 supplied painted palm atlas; 1024 PC / 512 coarse pointer, four cropped components. Normal is linear data.' };
  const current = data.assets.find((a) => a.id === old.id);
  if (current) {
    if (JSON.stringify(current) !== JSON.stringify(old)) throw new Error('Draft palm entry changed concurrently: ' + old.id);
    data.assets = data.assets.filter((a) => a.id !== old.id); changed = true;
  }
}
for (const entry of entries) {
  for (const relative of [entry.src, entry.mobileSrc].filter(Boolean)) if (!fs.existsSync(path.join(root, 'assets', relative))) throw new Error('Missing asset: ' + relative);
  const current = data.assets.find((a) => a.id === entry.id);
  if (current && JSON.stringify(current) !== JSON.stringify(entry)) throw new Error('Existing entry differs: ' + entry.id);
  if (!current) { data.assets.push(entry); changed = true; }
}
const valid = normalizeManifest(data);
for (const entry of entries) if (!valid.entries.has(entry.id)) throw new Error(valid.errors.join('\n'));
if (changed) {
  const temp = `${file}.${process.pid}.palm.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Manifest changed concurrently'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log('S05: three palm models and two shared textures registered; other entries retained.');
