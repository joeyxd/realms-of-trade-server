import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateSimulation, SOURCE_SHA, DT } from './update-simulation.js';

const fixture = () => ({ schema: 'st01c-spawn-fixture/v1', sourceSha256: SOURCE_SHA,
  sourceStepCount: 240, sourceStepSeconds: 1 / 60, emitterNames: ['NE_Flame_Basic_001', 'NE_Smoke_Basic'],
  alphaCurve: { minTime: 0, inverseRange: 1, samples: Array.from({ length: 54 }, (_, i) => 1 - i / 53) },
  births: [{ step: 1, emitter: 1, particle: { uniqueId: 0, position: [0, 0, 30], velocity: [0, 0, 60],
    size: [100, 100], color: [.4, .4, .4, 1], age: 0, lifetime: 2, rotation: 0, subImage: 0 } }] });

test('fixed-step evolution is independent from read order and never mutates caller data', () => {
  const input = fixture(), before = structuredClone(input), sim = new UpdateSimulation(input);
  const at61 = sim.seek(61);
  const p = at61.emitters[1].particles[0];
  assert.equal(p.position[2], 90); assert.ok(Math.abs(p.age - 1) < 1e-6);
  assert.ok(Math.abs(p.color[3] - .5) < 1e-6); assert.ok(Math.abs(p.subImage - 30) < .0001);
  sim.seek(20); assert.deepEqual(sim.seek(61), at61);
  sim.seek(140); assert.deepEqual(sim.seek(61), at61);
  at61.emitters[1].particles[0].position[2] = -999;
  assert.equal(sim.snapshot().emitters[1].particles[0].position[2], 90);
  assert.deepEqual(input, before);
});

test('speed, life and stop controls change only their stated presentation behavior', () => {
  const input = fixture();
  const normal = new UpdateSimulation(input), fast = new UpdateSimulation(input, { smokeSpeed: 2 });
  const a = normal.seek(61).emitters[1].particles[0], b = fast.seek(61).emitters[1].particles[0];
  assert.equal(b.position[2], 150); assert.equal(b.age, a.age); assert.deepEqual(b.color, a.color);
  const long = new UpdateSimulation(input, { smokeLife: 4 });
  const c = long.seek(61).emitters[1].particles[0];
  assert.equal(c.position[2], a.position[2]); assert.ok(c.color[3] > a.color[3]); assert.ok(c.subImage < a.subImage);
  assert.equal(normal.seek(180).emitters[1].particles.length, 0);
  assert.equal(long.seek(180).emitters[1].particles.length, 1);
  assert.equal(long.seek(480).emitters[1].particles.length, 0);
  assert.equal(new UpdateSimulation(input, { stopAt: 0 }).seek(240).emitters[1].particles.length, 0);
  long.configure(); assert.deepEqual(long.seek(61), normal.seek(61));
});

test('malformed or incompatible fixtures and unbounded controls fail before evolution', () => {
  for (const change of [
    f => { f.sourceSha256 = 'wrong'; }, f => { f.births[0].particle.velocity[0] = 1; },
    f => { f.births[0].particle.position[0] = NaN; }, f => { f.births[0].step = 241; },
    f => { f.births.push(structuredClone(f.births[0])); }, f => { f.alphaCurve.inverseRange = 0; },
    f => { f.births[0].particle.age = DT; }
  ]) { const f = fixture(); change(f); assert.throws(() => new UpdateSimulation(f)); }
  for (const options of [{ smokeLife: 0 }, { smokeSpeed: Infinity }, { stopAt: -1 }, { unknown: 1 }, { toString: 1 }])
    assert.throws(() => new UpdateSimulation(fixture(), options));
  const sim = new UpdateSimulation(fixture());
  for (const step of [NaN, -1, 2.5, 481]) assert.throws(() => sim.seek(step));
});
