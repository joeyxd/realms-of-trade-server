// Register only S04's four small geometry models; retain concurrent manifest entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'assets/manifest.json'), before = fs.readFileSync(file), data = JSON.parse(before);
const names = ['shell-fan', 'shell-oval', 'shell-chip', 'pebbles'];
let changed = false;
for (const name of names) {
  const entry = { id: `model:beach-${name}-v1`, kind: 'model', src: `models/beach-${name}-v1.glb`, fit: 'none',
    toon: { flat: true, comic: false },
    notes: 'S04 painted beach geometry; normals and vertex color, no new textures. Pebbles reuse S02 SM_Rock. See docs/delivery/beach-details-v1.md.' };
  if (!fs.existsSync(path.join(root, 'assets', entry.src))) throw new Error('Missing model: ' + entry.src);
  const current = data.assets.find((a) => a.id === entry.id);
  if (current && JSON.stringify(current) !== JSON.stringify(entry)) throw new Error('Existing entry differs: ' + entry.id);
  if (!current) { data.assets.push(entry); changed = true; }
}
const validated = normalizeManifest(data);
for (const name of names) if (!validated.entries.has(`model:beach-${name}-v1`)) throw new Error(validated.errors.join('\n'));
if (changed) {
  const temp = `${file}.${process.pid}.beach.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Manifest changed concurrently');
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log('S04: four beach models registered; other manifest entries retained.');
