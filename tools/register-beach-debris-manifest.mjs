// Add only S09 models, preserving concurrent manifest work.
import fs from 'node:fs';
import { normalizeManifest } from '../src/render/assets/manifest.js';
const root = new URL('../', import.meta.url), file = new URL('assets/manifest.json', root);
const before = fs.readFileSync(file), data = JSON.parse(before); let changed = false;
for (const style of ['branch', 'log', 'planks']) {
  const entry = { id: `model:beach-debris-${style}-v1`, kind: 'model', src: `models/beach-debris-${style}-v1.glb`, fit: 'none',
    toon: { flat: false, comic: false }, notes: 'S09 opaque painted coastal debris; stacked planks derive from audited Dreamrise SM_Logs after visual review; no new textures. Cosmetic, no collider. See docs/delivery/beach-debris-v1.md.' };
  if (!fs.existsSync(new URL('assets/' + entry.src, root))) throw Error('Missing S09 model: ' + entry.src);
  const current = data.assets.find((e) => e.id === entry.id);
  if (current && JSON.stringify(current) !== JSON.stringify(entry)) throw Error('Existing S09 entry differs');
  if (!current) { data.assets.push(entry); changed = true; }
}
const valid = normalizeManifest(data);
for (const style of ['branch', 'log', 'planks']) if (!valid.entries.has(`model:beach-debris-${style}-v1`)) throw Error(valid.errors.join('\n'));
if (changed) {
  const temp = new URL(`assets/manifest.json.${process.pid}.debris.tmp`, root);
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw Error('Concurrent manifest edit'); fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log('S09: three beach debris models registered.');
