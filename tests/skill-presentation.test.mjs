import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  cloneSkillDocument,
  DEFAULT_SKILL_DOCUMENT,
  parseSkillDocument,
  SKILL_PARAMETERS,
  validateSkillDocument,
} from '../src/editor/skillDocument.js';
import { SkillFx } from '../src/render/vfx/skillfx.js';
import { ParticlePool } from '../src/render/vfx/particles.js';

const makeDocument = (parameters = {}) => ({
  ...cloneSkillDocument(), parameters: { ...cloneSkillDocument().parameters, ...parameters },
});

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fixture(seed = 1) {
  const scene = new THREE.Scene(), particles = [], rings = [];
  const fx = new SkillFx(scene, { alpha: { spawn: (...args) => particles.push(structuredClone(args)) } },
    { ring: (...args) => rings.push(args) }, {}, { groundAt: () => 3 }, () => null, { random: seededRandom(seed) });
  return { scene, fx, particles, rings };
}

test('skill presentation document is immutable by default and round-trips through strict JSON', () => {
  assert.equal(Object.isFrozen(DEFAULT_SKILL_DOCUMENT), true);
  assert.equal(Object.isFrozen(DEFAULT_SKILL_DOCUMENT.parameters), true);
  assert.deepEqual(SKILL_PARAMETERS.map(({ key }) => key), [
    'scale', 'height', 'duration', 'density', 'spread', 'speed', 'brightness', 'deep', 'foam',
  ]);
  assert.deepEqual(validateSkillDocument(cloneSkillDocument()), { ok: true });
  const document = parseSkillDocument(JSON.stringify(DEFAULT_SKILL_DOCUMENT));
  assert.deepEqual(document, cloneSkillDocument());
  document.parameters.scale = 1.25;
  assert.equal(DEFAULT_SKILL_DOCUMENT.parameters.scale, 1);
});

test('skill document rejects unknown fields, invalid identities, ranges, non-finite values, and non-lowercase colors', () => {
  const invalid = [
    { ...makeDocument(), executable: 'code' },
    { ...makeDocument(), effect: 'arbitrary-ref' },
    makeDocument({ scale: 1.5001 }),
    makeDocument({ density: Number.NaN }),
    makeDocument({ deep: '#1F86C0' }),
    makeDocument({ foam: '#dff7ff', shader: 'anything' }),
  ];
  for (const value of invalid) assert.equal(validateSkillDocument(value).ok, false);
  assert.throws(() => parseSkillDocument(' '.repeat(16 * 1024 + 1)), { message: 'Invalid skill document' });
  assert.throws(() => parseSkillDocument('{bad json'), { message: 'Invalid skill document' });
  assert.throws(() => parseSkillDocument(JSON.stringify(invalid[0])), { message: 'Invalid skill document' });
});

test('legacy spout keeps its default dimensions, lifetime, colors, rings, and 34 initial particles', () => {
  const { fx, particles, rings } = fixture();
  fx.spout(2, -4, 5);
  const s = fx.spouts[0];
  assert.equal(s.r, 2.75);
  assert.equal(s.h, 6.2);
  assert.equal(s.life, 0.65);
  assert.equal(particles.length, 34);
  assert.equal(rings.length, 2);
  assert.equal(s.mat.uniforms.uDeep.value.getHexString(), '1f86c0');
  assert.equal(s.mat.uniforms.uFoam.value.getHexString(), 'dff7ff');
});

test('presentation parameters stay bounded and affect only the column and visual emission budget', () => {
  const { fx, particles, rings } = fixture();
  const doc = makeDocument({ scale: 1.5, height: 1.75, duration: 2, density: 2, spread: 2,
    speed: 2, brightness: 1.5, deep: '#105080', foam: '#ffffff' });
  fx.spout(0, 0, 4, false, 0, doc.parameters);
  const s = fx.spouts[0];
  assert.ok(Math.abs(s.r - 3.3) < 1e-12);
  assert.equal(s.h, (4.2 + 4 * 0.4) * 1.75);
  assert.equal(s.life, 1.3);
  assert.equal(particles.length, 68);
  assert.equal(rings[0][3], 4 * 1.1);
  assert.equal(s.mat.uniforms.uDeep.value.getHexString(), '105080');
  assert.equal(s.mat.uniforms.uFoam.value.getHexString(), 'ffffff');
  assert.equal(s.mat.uniforms.uBrightness.value, 1.5);
  assert.throws(() => fx.spout(0, 0, 4, false, 0, { ...doc.parameters, density: 99 }), /Invalid Tromba/);
});

test('density zero emits no Tromba particles and preview randomness repeats from the same seed', () => {
  const zero = fixture();
  zero.fx.spout(0, 0, 3, false, 0, makeDocument({ density: 0 }).parameters);
  zero.fx.update(0.1, 0);
  assert.equal(zero.particles.length, 0);

  const first = fixture(1234), second = fixture(1234);
  for (const current of [first, second]) {
    current.fx.spout(1, 2, 3, false, 0, makeDocument({ density: 0.75, speed: 1.3, spread: 1.4 }).parameters);
    current.fx.update(0.12, 0);
  }
  assert.deepEqual(first.particles, second.particles);
  assert.deepEqual(first.rings, second.rings);
});

test('Tromba reset is isolated and dispose releases only this SkillFx instance resources', () => {
  const { scene, fx } = fixture();
  fx.spout(0, 0, 2);
  const wheel = fx.wheels[0].m, spout = fx.spouts[0].m;
  assert.equal(spout.visible, true);
  assert.equal(wheel.parent, scene);
  fx.resetTromba();
  assert.equal(spout.visible, false);
  assert.equal(fx.spouts[0].t, -1);
  assert.equal(fx.trombaTime, 0);
  assert.equal(wheel.parent, scene);
  fx.dispose();
  assert.equal(wheel.parent, null);
  assert.equal(spout.parent, null);
});

test('particle pools use the injected RNG for budget rejection and sprite seeding', () => {
  const values = [0.9, 0.1, 0.75]; let calls = 0;
  const pool = new ParticlePool(4, { random: () => values[calls++] });
  pool.budget = 0.5;
  pool.spawn(0, 0, 0, 0, 1, 0);
  assert.equal(calls, 1);
  assert.equal(pool.alive[0], 0);
  pool.spawn(1, 2, 3, 0, 1, 0, { shape: 2 });
  assert.equal(calls, 3);
  assert.equal(pool.alive[0], 1);
  assert.ok(Math.abs(pool.seed[0] - 0.75 * 0.98 * 40) < 1e-5);
  assert.ok(Math.abs(pool.data[2] - (2 + 0.75 * 0.98)) < 1e-6);
  assert.equal(pool.pos[0], 1); assert.equal(pool.pos[1], 2); assert.equal(pool.pos[2], 3);
});
