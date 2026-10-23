// Register only the S02 geometry; preserve unrelated manifest entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'assets/manifest.json');
const before = fs.readFileSync(file);
const data = JSON.parse(before);
const entry = { id: 'model:coast-rock-v1', kind: 'model', src: 'models/coast-rock-v1.glb', fit: 'none',
  toon: { flat: true, comic: true },
  notes: 'Dreamrise SM_Rock geometry, vertex-painted coastal derivative; three runtime silhouettes. No new textures. See docs/delivery/coast-rocks-v1.md.' };
if (!fs.existsSync(path.join(root, 'assets', entry.src))) throw new Error('Prepare the coastal GLB first');
const current = data.assets.find((a) => a.id === entry.id);
if (current && JSON.stringify(current) !== JSON.stringify(entry)) throw new Error('An existing coastal manifest entry differs; review it before editing');
if (!current) {
  data.assets.push(entry);
  const validated = normalizeManifest(data);
  if (!validated.entries.has(entry.id)) throw new Error(validated.errors.join('\n'));
  if (!fs.readFileSync(file).equals(before)) throw new Error('Manifest changed concurrently');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log('Registered model:coast-rock-v1; all other entries retained.');
