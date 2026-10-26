import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { NativeSimulation, random3, random4 } from '../../src/render/vfx/niagara/native-simulation.js';
const source = JSON.parse(await fs.readFile(new URL('../../src/render/vfx/niagara/pilot-source.json', import.meta.url)));

test('source-only births continue beyond the recorded window and seek repeatably', () => {
  const input = structuredClone(source), before = structuredClone(input), sim = new NativeSimulation(input);
  assert.deepEqual(sim.seek(6).emitters.map(e => e.particles.length), [0, 0]);
  assert.deepEqual(sim.seek(7).emitters.map(e => e.particles.length), [0, 1]);
  assert.deepEqual(sim.seek(21).emitters.map(e => e.particles.length), [1, 3]);
  const late = sim.seek(420);
  assert.deepEqual(late.emitters.map(e => e.particles.length), [3, 20]);
  assert.ok(late.emitters[1].particles.at(-1).uniqueId > 50);
  sim.seek(0); assert.deepEqual(sim.seek(420), late); sim.seek(480);
  assert.deepEqual(sim.seek(420), late); assert.deepEqual(input, before);
  late.emitters[0].particles[0].position[0] = 999;
  assert.notEqual(sim.snapshot().emitters[0].particles[0].position[0], 999);
});

test('seed changes the sampled appearance while preserving life, count and timing', () => {
  const normal = new NativeSimulation(source).seek(120), variant = new NativeSimulation(source, { seed: 42 }).seek(120);
  assert.notDeepEqual(normal.emitters[0].particles[0].color, variant.emitters[0].particles[0].color);
  assert.notDeepEqual(normal.emitters[1].particles[0].position, variant.emitters[1].particles[0].position);
  assert.deepEqual(variant, new NativeSimulation(source, { seed: 42 }).seek(120));
  for (let e = 0; e < 2; e++) assert.deepEqual(normal.emitters[e].particles.map(p => [p.uniqueId, p.age, p.lifetime]),
    variant.emitters[e].particles.map(p => [p.uniqueId, p.age, p.lifetime]));
  for (const seed of [0, 65534]) {
    const sim = new NativeSimulation(source, { seed });
    for (const e of sim.seek(480).emitters) for (const p of e.particles) assert.ok(p.position.every(Number.isFinite));
  }
  for (const rand of [random3, random4]) for (const value of rand(0x7fffffff, 480, 65535, 5))
    assert.ok(value >= 0 && value < 1 && Number.isFinite(value));
});

test('native stop and speed/life controls conserve their stated behavior', () => {
  const normal = new NativeSimulation(source), fast = new NativeSimulation(source, { smokeSpeed: 2 });
  const a = normal.seek(120), b = fast.seek(120);
  assert.deepEqual(a.emitters[0], b.emitters[0]);
  assert.equal(a.emitters[1].particles.length, b.emitters[1].particles.length);
  assert.ok(b.emitters[1].particles[0].position[2] > a.emitters[1].particles[0].position[2]);
  assert.equal(new NativeSimulation(source, { stopAt: 0 }).seek(480).emitters.flatMap(e => e.particles).length, 0);
  const stopped = new NativeSimulation(source, { stopAt: 1, smokeLife: 4 });
  assert.ok(stopped.seek(240).emitters[1].particles.length > 0);
  assert.equal(stopped.seek(360).emitters.flatMap(e => e.particles).length, 0);
  stopped.configure(); assert.deepEqual(stopped.seek(120), a);
});

test('unsupported sources, controls and seeks fail before running', () => {
  for (const change of [s => { s.sourceSha256 = 'wrong'; }, s => { s.smoke.enableLatheProfile = true; },
    s => { s.vmReciprocalEstimates[0] = 1/3; }, s => { s.flame.radiusCm = NaN; },
    s => { s.smoke.velocityCm = [Infinity, 0, 1]; }, s => { s.alphaCurve.samples.push(0); }]) {
    const s = structuredClone(source); change(s); assert.throws(() => new NativeSimulation(s));
  }
  const changed = structuredClone(source); changed.flame.radiusCm *= 2;
  assert.throws(() => new NativeSimulation(changed), /Unreviewed/);
  for (const input of [{ seed: .5 }, { seed: 65535 }, { smokeSpeed: Infinity }, { toString: 3 }, null])
    assert.throws(() => new NativeSimulation(source, input));
  const sim = new NativeSimulation(source);
  for (const step of [-1, NaN, 1.5, 481]) assert.throws(() => sim.seek(step));
});
