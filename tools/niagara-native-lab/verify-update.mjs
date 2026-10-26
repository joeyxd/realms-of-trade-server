// Independent holdout: first-seen states are the only particle inputs to the simulator.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { UpdateSimulation } from '../../src/render/vfx/niagara/update-simulation.js';
const run = process.argv[2] || 'reference11';
if (!/^[a-zA-Z0-9_-]{1,40}$/.test(run)) throw new Error('Invalid capture run');
const base = new URL(`../../.scratch/unreal/${run}/`, import.meta.url);
const raw = await fs.readFile(new URL('update-fixture.json', base));
const fixture = JSON.parse(raw);
const simulation = new UpdateSimulation(fixture);
const errors = { positionCm: 0, ageSeconds: 0, alpha: 0, subImage: 0, sizeCm: 0, rgb: 0 };
const tolerance = { positionCm: .001, ageSeconds: .00001, alpha: .00001, subImage: .001, sizeCm: 0, rgb: 0 };
let samples = 0, orderDifferences = 0;
const counts = [];
for (let step = 0; step <= 240; step++) {
  const bytes = await fs.readFile(new URL(`particles/step_${String(step).padStart(4, '0')}.json`, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.provenance.frameSha256[step]);
  const observed = JSON.parse(bytes), computed = simulation.seek(step);
  for (let emitter = 0; emitter < 2; emitter++) {
    const expected = observed.emitters[emitter].particles, actual = computed.emitters[emitter].particles;
    assert.deepEqual(actual.map(p => p.uniqueId).sort((a, b) => a - b), expected.map(p => p.uniqueId).sort((a, b) => a - b), `living IDs at ${step}/${emitter}`);
    if (JSON.stringify(actual.map(p => p.uniqueId)) !== JSON.stringify(expected.map(p => p.uniqueId))) orderDifferences++;
    const actualById = new Map(actual.map(p => [p.uniqueId, p]));
    for (const b of expected) {
      const a = actualById.get(b.uniqueId); samples++;
      const maximum = (name, a, b) => { errors[name] = Math.max(errors[name], Math.abs(a - b)); };
      a.position.forEach((x, i) => maximum('positionCm', x, b.position[i]));
      a.size.forEach((x, i) => maximum('sizeCm', x, b.size[i]));
      a.color.slice(0, 3).forEach((x, i) => maximum('rgb', x, b.color[i]));
      maximum('ageSeconds', a.age, b.age); maximum('alpha', a.color[3], b.color[3]);
      maximum('subImage', a.subImage, b.subImage);
    }
  }
  if ([0, 30, 60, 120, 180, 240].includes(step)) counts.push({ step, particles: computed.emitters.map(e => e.particles.length) });
}
const end = simulation.seek(480);
assert.ok(end.emitters.every(e => e.particles.length === 0));
const result = { schema: 'st01c-update-validation/v1', run, fixtureSha256: createHash('sha256').update(raw).digest('hex'),
  frameCount: 241, comparedParticles: samples, births: fixture.births.length, counts,
  maxErrors: errors, tolerance, orderDifferences,
  numericPassed: Object.entries(errors).every(([key, value]) => value <= tolerance[key]),
  scope: 'Native update only; initial states and spawn timing remain observed fixtures. Not a native emitter or visual acceptance.' };
const out = new URL('../../.scratch/native-update/', import.meta.url);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(new URL(`validation-${run}.json`, out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
assert.ok(result.numericPassed, 'Update exceeded predeclared tolerances');
