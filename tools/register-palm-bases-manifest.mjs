// Register only S06's portable bases and device-selected leaf pair, retaining concurrent assets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = fileURLToPath(new URL('../', import.meta.url)), file = path.join(root, 'assets/manifest.json');
const before = fs.readFileSync(file), data = JSON.parse(before);
const entries = ['open', 'lush'].map((style) => ({ id: `model:palm-base-${style}-v1`, kind: 'model', src: `models/palm-base-${style}-v1.glb`,
  fit: 'none', toon: { flat: false, comic: false }, notes: 'S06 two-part cosmetic base: rigid roots and low leaf rosettes. Shared S05 bark; separate compact leaf atlas. See docs/delivery/palm-bases-v1.md.' }));
for (const channel of ['albedo', 'normal']) entries.push({ id: `tex:palm-base-${channel}-v1`, kind: 'tex',
  src: `textures/palm-base-v1/${channel}-pc.webp`, mobileSrc: `textures/palm-base-v1/${channel}-mobile.webp`,
  ...(channel === 'normal' ? { data: true } : {}), notes: 'S06 two supplied small leaf crops, 512x256 PC / 256x128 coarse pointer. Shared binary alpha, linear normal data; visual registration only.' });
let changed = false;
for (const entry of entries) {
  for (const p of [entry.src, entry.mobileSrc].filter(Boolean)) if (!fs.existsSync(path.join(root, 'assets', p))) throw Error('Missing asset: ' + p);
  const old = data.assets.find((a) => a.id === entry.id);
  if (old && JSON.stringify(old) !== JSON.stringify(entry)) throw Error('Existing entry differs: ' + entry.id);
  if (!old) { data.assets.push(entry); changed = true; }
}
const valid = normalizeManifest(data);
for (const e of entries) if (!valid.entries.has(e.id)) throw Error(valid.errors.join('\n'));
if (changed) {
  const temp = `${file}.${process.pid}.palm-bases.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw Error('Manifest changed concurrently'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log('S06: two palm base models and two small leaf textures registered.');
