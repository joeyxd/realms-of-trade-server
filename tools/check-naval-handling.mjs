// Repeatable D08 measurements without a browser, game server, profile or economy connection.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LAB_FIXTURES, LAB_WINDS } from './naval-lab/fixtures.js';
import { measureHandling } from './naval-lab/measure.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const measurements = LAB_WINDS.flatMap((wind) => LAB_FIXTURES.map((fixture) => ({
  fixture: fixture.id, wind: wind.id, ...measureHandling(fixture, wind),
})));
const source = ['src/data/navalHandling.js', 'src/sim/naval/handling.js', 'tools/naval-lab/fixtures.js', 'tools/naval-lab/measure.js'];
const result = { schema: 1, purpose: 'D08a experimental local handling comparisons',
  visualAccepted: false, networkAccepted: false, physicalFpsClaim: false,
  source: source.map((name) => { const bytes = fs.readFileSync(path.join(root, name));
    return { path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }),
  conditions: 'Fixed 60Hz. Six seconds full thrust from rest; brake and 90-degree turn from speed2. 60s timeout. Wind blows toward heading, held constant in world space. Synthetic ballast only.', measurements };
if (process.argv[2]) {
  const out = path.resolve(root, process.argv[2]);
  const relative = path.relative(root, out);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must stay in repository');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
}
console.table(measurements.filter((m) => m.wind === 'tail').map((m) => ({
  fixture: m.fixture, mass: m.rig.mass, 'speed at 6s': m.acceleration.speed.toFixed(2),
  'brake seconds': m.braking.seconds.toFixed(2), 'brake distance': m.braking.distance.toFixed(2),
  '90deg seconds': m.turning.reached ? m.turning.seconds.toFixed(2) : '>60',
})));
