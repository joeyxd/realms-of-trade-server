// Captures are reserved validation targets; none are passed to NativeSimulation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { NativeSimulation } from './native-simulation.js';
import { SOURCE_PRESET_SHA256 } from './source-identity.js';
const run = process.argv[2] || 'reference11';
assert.match(run, /^[A-Za-z0-9_-]{1,40}$/);
const source = JSON.parse(await fs.readFile(new URL('./pilot-source.json', import.meta.url)));
const sim = new NativeSimulation(source);
const base = new URL(`../../.scratch/unreal/${run}/`, import.meta.url);
const report = JSON.parse(await fs.readFile(new URL('capture-report.json', base)));
const reserved = JSON.parse(await fs.readFile(new URL('update-fixture.json', base))).provenance;
assert.equal(report.status, 'complete');
assert.equal(report.source_copy_package_sha256, source.sourceSha256);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(await fs.readFile(new URL('./pilot-source.json', import.meta.url))), SOURCE_PRESET_SHA256);
const max = { positionCm: 0, velocityCmPerSecond: 0, ageSeconds: 0, alpha: 0, rgb: 0, subImage: 0, sizeCm: 0 };
const limits = { positionCm: .002, velocityCmPerSecond: .001, ageSeconds: .00001, alpha: .00001, rgb: .00001, subImage: .001, sizeCm: .001 };
let states = 0;
for (let step = 0; step <= 240; step++) {
  const data = await fs.readFile(new URL(`particles/step_${String(step).padStart(4, '0')}.json`, base));
  assert.equal(sha(data), reserved.frameSha256[step]);
  const expected = JSON.parse(data), actual = sim.seek(step);
  for (let e = 0; e < 2; e++) {
    const a = actual.emitters[e].particles, b = expected.emitters[e].particles;
    assert.deepEqual(a.map(p => p.uniqueId), b.map(p => p.uniqueId), `live ID/order step${step} emitter${e}`);
    for (let j = 0; j < a.length; j++) {
      states++;
      const ap = a[j], bp = b[j];
      for (const [field, metric] of [['position', 'positionCm'], ['velocity', 'velocityCmPerSecond'], ['size', 'sizeCm']])
        for (let i = 0; i < ap[field].length; i++) max[metric] = Math.max(max[metric], Math.abs(ap[field][i] - bp[field][i]));
      for (const [field, metric] of [['age', 'ageSeconds'], ['subImage', 'subImage']])
        max[metric] = Math.max(max[metric], Math.abs(ap[field] - bp[field]));
      ap.color.forEach((v, i) => { const metric = i === 3 ? 'alpha' : 'rgb'; max[metric] = Math.max(max[metric], Math.abs(v - bp.color[i])); });
      assert.equal(ap.lifetime, bp.lifetime); assert.equal(ap.rotation, bp.rotation);
    }
  }
}
const result = { run, frames: 241, particleStates: states, sourcePresetSha256: sha(await fs.readFile(new URL('./pilot-source.json', import.meta.url))),
  capturedStatesUsedAsInputs: 0, liveIdsAndOrderMatch: true, maxErrors: max, tolerances: limits,
  passed: Object.keys(max).every(k => max[k] <= limits[k]) };
await fs.mkdir(new URL('../../.scratch/native-birth/', import.meta.url), { recursive: true });
await fs.writeFile(new URL(`../../.scratch/native-birth/validation-${run}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.ok(result.passed, 'Native generator exceeds predeclared tolerances');
