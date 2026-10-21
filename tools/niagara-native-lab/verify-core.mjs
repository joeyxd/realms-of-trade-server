// Proves the pilot simulations are unchanged: digests of every snapshot, steps 0..480 plus a backwards seek.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { NativeSimulation } from './native-simulation.js';
import { UpdateSimulation } from './update-simulation.js';
const read = async url => JSON.parse(await fs.readFile(url, 'utf8'));
const checkpoint = await read(new URL('../../docs/delivery/st01c/core-checkpoint.json', import.meta.url));
const source = await read(new URL('./pilot-source.json', import.meta.url));
const fixture = await read(new URL('../../.scratch/unreal/reference11/update-fixture.json', import.meta.url));

function digest(sim) {
  const h = createHash('sha256');
  for (let step = 0; step <= checkpoint.steps; step++) h.update(JSON.stringify(sim.seek(step)));
  // Seeking backwards resets; the replay must match too.
  h.update(JSON.stringify(sim.seek(37)));
  return h.digest('hex');
}
const digests = {};
for (const [name, options] of Object.entries(checkpoint.configurations))
  digests[name] = digest(name.startsWith('native.') ? new NativeSimulation(source, options) : new UpdateSimulation(fixture, options));
const passed = JSON.stringify(Object.keys(digests)) === JSON.stringify(Object.keys(checkpoint.digests)) &&
  Object.entries(digests).every(([name, value]) => value === checkpoint.digests[name]);
console.log(JSON.stringify({ schema: 'st01c-core-validation/v1', baselineCommit: checkpoint.baselineCommit, digests, passed }));
process.exit(passed ? 0 : 1);
