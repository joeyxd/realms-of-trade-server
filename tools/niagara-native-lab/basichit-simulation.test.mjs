import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { BasicHitSimulation, MAX_STEP, NAMES } from '../../src/render/vfx/niagara/basichit-simulation.js';
import { DT } from '../../src/render/vfx/niagara/core/particle-state.js';
const source = JSON.parse(await fs.readFile(new URL('../../src/render/vfx/niagara/basichit-source.json', import.meta.url)));
const f32 = Math.fround;
const counts = frame => frame.emitters.map(e => e.particles.length);

test('one burst on step 1 (1/1/250, ids in order, age DT); EmitterState Once leaves the effect empty', () => {
  const sim = new BasicHitSimulation(source);
  assert.deepEqual(counts(sim.seek(0)), [0, 0, 0]);
  const first = sim.seek(1);
  assert.deepEqual(first.emitters.map(e => e.name), NAMES);
  assert.deepEqual(counts(first), [1, 1, 250]);
  for (const e of first.emitters) {
    assert.deepEqual(e.particles.map(p => p.uniqueId), e.particles.map((_, i) => i));
    assert.ok(e.particles.every(p => p.age === DT));
  }
  assert.equal(first.emitters[0].particles[0].lifetime, f32(0.4));
  assert.equal(first.emitters[1].particles[0].lifetime, f32(0.3));
  // The update pass inside the spawn script already integrated one dt from the origin.
  for (const p of first.emitters[2].particles) assert.deepEqual(p.position, p.velocity.map(v => f32(v * DT)));
  let previous = first;
  for (let step = 2; step <= 36; step++) {
    const frame = sim.seek(step);
    frame.emitters.forEach((e, i) => {
      const ids = new Set(previous.emitters[i].particles.map(p => p.uniqueId));
      assert.ok(e.particles.every(p => ids.has(p.uniqueId)), 'no births after step 1');
      assert.deepEqual(e.particles.map(p => p.uniqueId), [...e.particles.map(p => p.uniqueId)].sort((a, b) => a - b));
    });
    previous = frame;
  }
  assert.deepEqual(counts(sim.seek(36)), [0, 0, 0]);
  assert.deepEqual(counts(sim.seek(MAX_STEP)), [0, 0, 0]);
  assert.throws(() => sim.advance(), /ends at 8 seconds/);
});

test('seek is repeatable forwards and backwards; snapshots are copies; the source is not mutated', () => {
  const input = structuredClone(source), before = structuredClone(input), sim = new BasicHitSimulation(input);
  const mid = sim.seek(12);
  assert.deepEqual(counts(mid).slice(0, 2), [1, 1]);
  sim.seek(30); assert.deepEqual(sim.seek(12), mid);
  sim.seek(0); assert.deepEqual(sim.seek(12), mid);
  assert.deepEqual(new BasicHitSimulation(source).seek(12), mid);
  mid.emitters[2].particles[0].position[0] = 999;
  assert.notEqual(sim.snapshot().emitters[2].particles[0].position[0], 999);
  assert.deepEqual(input, before);
});

test('flame and flash: constant rotation and RGB, SubUV only on the flame, alpha and size from the curves', () => {
  const sim = new BasicHitSimulation(source), flame = [], flash = [];
  for (let step = 1; step <= 22; step++) {
    const frame = sim.seek(step);
    flame.push(frame.emitters[0].particles[0]);
    if (step <= 16) flash.push(frame.emitters[1].particles[0]);
  }
  const rotation = flame[0].rotation;
  assert.ok(rotation >= 0.25 && rotation < 0.5);
  for (const p of flame) {
    assert.equal(p.rotation, rotation);
    assert.deepEqual(p.color.slice(0, 3), flame[0].color.slice(0, 3));
    assert.equal(p.subImage, f32(f32(p.age / p.lifetime) * 40));
    assert.deepEqual(p.position, [0, 0, 0]); assert.deepEqual(p.velocity, [0, 0, 0]);
  }
  assert.ok(flame.at(-1).subImage > 32, 'the 40-frame SubUV index passes the 32 cells of the atlas');
  for (const p of flash) {
    assert.equal('subImage' in p, false);
    assert.equal(p.rotation, 0);
    assert.deepEqual(p.color.slice(0, 3), [37, 6, f32(0.7)]);
    assert.equal(p.size[0], p.size[1]);
  }
  assert.ok(flash.at(-1).size[0] > flash[0].size[0]);
});

test('SimpleBurst: drag divides the velocity each step, draws stay in their source ranges', () => {
  const sim = new BasicHitSimulation(source), one = sim.seek(1).emitters[2].particles, two = sim.seek(2).emitters[2].particles;
  const denominator = f32(f32(0.75 * DT) + 1);
  assert.equal(two.length, 250);
  two.forEach((p, i) => {
    const q = one[i];
    assert.deepEqual(p.velocity, q.velocity.map(v => f32(v / denominator)));
    assert.deepEqual(p.position, q.position.map((x, k) => f32(x + f32(p.velocity[k] * DT))));
    assert.deepEqual(p.color.slice(0, 3), [36, 7, f32(0.7)]);
    assert.equal(p.rotation, 0);
  });
  for (const p of one) {
    const speed = Math.hypot(...p.velocity) * denominator;
    assert.ok(speed > 75 - 1e-3 && speed < 400 + 1e-3);
    assert.ok(p.lifetime >= f32(0.1) && p.lifetime < 0.6);
    assert.ok(p.size[0] > 0 && p.size[0] === p.size[1]);
  }
});

test('seed changes the draws, not the burst counts; extreme seeds stay finite', () => {
  const normal = new BasicHitSimulation(source).seek(1), variant = new BasicHitSimulation(source, { seed: 42 }).seek(1);
  assert.deepEqual(counts(variant), [1, 1, 250]);
  assert.notDeepEqual(normal.emitters[0].particles[0].color, variant.emitters[0].particles[0].color);
  assert.notEqual(normal.emitters[0].particles[0].rotation, variant.emitters[0].particles[0].rotation);
  assert.notDeepEqual(normal.emitters[2].particles[0].velocity, variant.emitters[2].particles[0].velocity);
  assert.deepEqual(normal.emitters[1], variant.emitters[1]);
  assert.deepEqual(variant, new BasicHitSimulation(source, { seed: 42 }).seek(1));
  for (const seed of [0, 65533]) {
    const sim = new BasicHitSimulation(source, { seed });
    for (let step = 1; step <= 40; step++)
      for (const e of sim.seek(step).emitters) for (const p of e.particles)
        assert.ok([...p.position, ...p.velocity, ...p.size, ...p.color, p.age, p.lifetime].every(Number.isFinite));
  }
});

test('unsupported sources, controls and seeks fail before running', () => {
  for (const change of [s => { s.schema = 'st01c-native-source/v1'; }, s => { s.emitters.reverse(); },
    s => { s.fixtureSeeds[2] = 6374; }, s => { s.emitters[2].burst.count = 600; }, s => { s.emitters[0].emitterState.mode = 'Infinite'; },
    s => { s.emitters[1].burst.spawnTime = 0.5; }, s => { s.emitters[0].curves.size.samples.pop(); },
    s => { s.emitters[1].curves.alpha.samples[3] = 0.1; }, s => { s.emitters[0].writeSpriteRotation = false; },
    s => { s.emitters[0].drag = 0.75; }, s => { s.emitters[2].velocityFromPoint.useFalloffDistance = true; },
    s => { s.emitters[2].speed.counter = 5; }, s => { s.emitters[2].sizeFromMass.densityMaterial = 'water'; },
    s => { s.emitters[2].lifetime.min = 0; }]) {
    const s = structuredClone(source); change(s); assert.throws(() => new BasicHitSimulation(s));
  }
  for (const input of [{ seed: 0.5 }, { seed: 65534 }, { seed: -1 }, { seed: Infinity }, { smokeSpeed: 1 }, null, []])
    assert.throws(() => new BasicHitSimulation(source, input));
  const sim = new BasicHitSimulation(source);
  for (const step of [-1, NaN, 1.5, MAX_STEP + 1]) assert.throws(() => sim.seek(step));
});
