// NS_BasicHit native simulation: the compiled CPU recipe of docs/delivery/st01c/basichit/RECIPE.md
// over core/. Every value comes from basichit-source.json; no captured state is an input.
import { random3, random4, uniformSpan, randomUnitVector } from './core/rng.js';
import { sampleCurve, validateCurve } from './core/curve.js';
import { DT, normalizedAge, ageParticle, integrateVelocity, scaleColor, scaleSpriteSize } from './core/particle-state.js';
import { emitterStateOnce, burstWindow, burstBirthAge } from './core/burst.js';
import { dragVelocity, addVelocityFromPoint, sizeFromMass } from './core/physics.js';
import { subUVFrame } from './core/subuv.js';
const f32 = Math.fround;
export const NAMES = Object.freeze(['NE_Flame_Basic_001', 'NE_Basic_Flash001', 'NE_SimpleBurst']);
export const MAX_STEP = 480;
// The system sits at the origin without rotation, in world space (the reference fixture).
const ORIGIN = Object.freeze([0, 0, 0]);
// LUT sample counts of the reviewed source: [alpha, size] per emitter.
const CURVE_SAMPLES = [[54, 79], [54, 79], [54, 94]];
export const CONTROL_SPEC = Object.freeze({
  seed: { default: 6371, min: 0, max: 65533, step: 1, label: 'Semilla', unit: '',
    help: 'Otra distribución repetible de tamaño, color, rotación, vida y dirección; la ráfaga conserva sus cantidades al nacer.' }
});

const isF32 = v => Number.isFinite(v) && f32(v) === v;
const isVector = (v, length) => Array.isArray(v) && v.length === length && v.every(isF32);
// A RandomRangeFloat draw: f32 min and span (scalar or vector) and its deterministic random counter.
const isDraw = (d, length, counter) => !!d && d.counter === counter &&
  (length ? isVector(d.min, length) && isVector(d.span, length) : isF32(d.min) && isF32(d.span));
function validate(source) {
  if (source?.schema !== 'st01c-basichit-source/v1' || JSON.stringify(source.emitterNames) !== JSON.stringify(NAMES) ||
      !Array.isArray(source.fixtureSeeds) || source.fixtureSeeds.length !== 3 ||
      source.fixtureSeeds.some((seed, i) => seed !== CONTROL_SPEC.seed.default + i) ||
      !Array.isArray(source.emitters) || source.emitters.length !== 3)
    throw new Error('Unsupported BasicHit source');
  source.emitters.forEach((e, i) => {
    if (e?.name !== NAMES[i] || e.emitterState?.mode !== 'Once' || !isF32(e.emitterState.loopSeconds) || e.emitterState.loopSeconds <= 0 ||
        !Number.isInteger(e.burst?.count) || e.burst.count < 1 || e.burst.count > 512 || e.burst.spawnTime !== 0 || e.burst.intervalDt !== 0 ||
        !isF32(e.killEpsilon) || e.killEpsilon <= 0 || e.killEpsilon > .001)
      throw new Error('Unsupported BasicHit emitter timing');
    for (const [key, count] of [['alpha', CURVE_SAMPLES[i][0]], ['size', CURVE_SAMPLES[i][1]]]) {
      const c = validateCurve(e.curves?.[key], { sampleCount: count, min: 0, max: 2, message: `Invalid BasicHit ${key} curve` });
      if (!isF32(c.minTime) || !isF32(c.inverseRange) || !c.samples.every(isF32)) throw new Error('BasicHit curves hold f32 values');
    }
  });
  const [flame, flash, burst] = source.emitters, m = burst.sizeFromMass;
  if (!isF32(flame.lifetime) || flame.lifetime <= 0 || !isDraw(flame.spriteSize, 0, 1) || !isDraw(flame.colorScale, 4, 2) ||
      !isVector(flame.colorBase, 4) || flame.writeSpriteRotation !== true || !isDraw(flame.rotation, 0, 3) ||
      flame.subUVFrames !== 40 || 'drag' in flame)
    throw new Error('Unsupported BasicHit flame source');
  if (!isF32(flash.lifetime) || flash.lifetime <= 0 || !isVector(flash.spriteSize, 2) || !isVector(flash.color, 4) ||
      flash.writeSpriteRotation !== false || 'drag' in flash)
    throw new Error('Unsupported BasicHit flash source');
  if (!isDraw(burst.lifetime, 0, 2) || burst.lifetime.min <= 0 || burst.lifetime.span < 0 || !isDraw(burst.mass, 0, 3) || burst.mass.min <= 0 ||
      m?.densityMaterial !== 'steel' || m.calculateMeshScale !== false || ![m.density, m.volumeScale, m.exponent, m.spriteDimension].every(v => isF32(v) && v > 0) ||
      !isVector(burst.color, 4) || burst.writeSpriteRotation !== false || !isDraw(burst.speed, 0, 6) || !isDraw(burst.direction, 2, 7) ||
      burst.velocityFromPoint?.useFalloffDistance !== false || !isF32(burst.velocityFromPoint.thresholdSquared) ||
      !isF32(burst.drag) || burst.drag < 0)
    throw new Error('Unsupported BasicHit SimpleBurst source');
  return source;
}
// Public particle attributes, in the pilot frame order; Initial.* and mass stay internal.
function view(p, emitter) {
  const q = { uniqueId: p.uniqueId, position: [...p.position], velocity: [...p.velocity], size: [...p.size], color: [...p.color],
    rotation: p.rotation, age: p.age, lifetime: p.lifetime };
  if (emitter === 0) q.subImage = p.subImage;
  return q;
}

export class BasicHitSimulation {
  constructor(source, options = {}) { this.source = structuredClone(validate(source)); this.configure(options); }
  configure(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(CONTROL_SPEC, k)))
      throw new Error('Unknown BasicHit controls');
    this.options = Object.fromEntries(Object.entries(CONTROL_SPEC).map(([key, spec]) => {
      const value = input[key] ?? spec.default;
      if (!Number.isInteger(value) || value < spec.min || value > spec.max) throw new Error(`Invalid BasicHit ${key}`);
      return [key, value];
    }));
    this.reset();
  }
  reset() {
    this.step = 0; this.live = [[], [], []]; this.ids = [0, 0, 0];
    this.states = NAMES.map(() => ({ loopedAge: 0, active: true }));
  }
  // Particle update script; also the pass that ends the interpolated spawn script (dt = DeltaTime - spawn time).
  update(p, emitter, dt) {
    const s = this.source.emitters[emitter];
    // ParticleState: age, death at lifetime - epsilon, normalized age by true division.
    if (!ageParticle(p, dt, s.killEpsilon)) return false;
    const normalized = normalizedAge(p.age, p.lifetime);
    // SolveForcesAndVelocity: zero force; only SimpleBurst has Drag. Flame and Flash keep v = 0.
    if (s.drag !== undefined) p.velocity = dragVelocity(p.velocity, s.drag, dt);
    integrateVelocity(p, dt);
    p.color = scaleColor(p.initialColor, sampleCurve(s.curves.alpha, normalized));
    p.size = scaleSpriteSize(p.initialSize, sampleCurve(s.curves.size, normalized));
    if (emitter === 0) p.subImage = subUVFrame(normalized, s.subUVFrames);
    return true;
  }
  // Spawn modules, then one update pass; null when that pass already kills the particle.
  birth(emitter, id, updateDt) {
    const s = this.source.emitters[emitter], seed = this.options.seed + emitter, tick = this.step - 1;
    const draw = (d, component = 0) => uniformSpan(d.min, d.span, random3(id, tick, seed, d.counter)[component]);
    const p = { uniqueId: id, position: [...ORIGIN], velocity: [0, 0, 0], size: null, color: null, rotation: 0, age: 0, lifetime: 0 };
    if (emitter === 0) {
      const size = draw(s.spriteSize);
      const scale = random4(id, tick, seed, s.colorScale.counter).map((r, i) => uniformSpan(s.colorScale.min[i], s.colorScale.span[i], r));
      p.initialSize = [size, size];
      p.initialColor = s.colorBase.map((c, i) => f32(c * scale[i]));
      p.rotation = draw(s.rotation);
      p.lifetime = s.lifetime;
      p.subImage = 0;
    } else if (emitter === 1) {
      p.initialSize = [...s.spriteSize]; p.initialColor = [...s.color]; p.lifetime = s.lifetime;
    } else {
      p.lifetime = draw(s.lifetime);
      const m = s.sizeFromMass, edge = sizeFromMass(draw(s.mass), m.density, m.volumeScale, m.exponent);
      p.initialSize = [f32(m.spriteDimension * edge), f32(m.spriteDimension * edge)];
      p.initialColor = [...s.color];
      // The particle sits on the velocity origin, so AddVelocityFromPoint takes the random fallback direction.
      const fallback = randomUnitVector(random3(id, tick, seed, s.direction.counter), s.direction.min, s.direction.span);
      p.velocity = addVelocityFromPoint(p.velocity, p.position, ORIGIN, draw(s.speed), fallback, s.velocityFromPoint.thresholdSquared);
    }
    return this.update(p, emitter, updateDt) ? p : null;
  }
  advance() {
    if (this.step >= MAX_STEP) throw new Error('Private sequence ends at 8 seconds');
    this.step++;
    // Live particles first, in order; the dead leave without reordering.
    this.live = this.live.map((list, emitter) => list.filter(p => this.update(p, emitter, DT)));
    // System update: EmitterState (Once), then SpawnBurst_Instantaneous. The RNG tick is step - 1.
    this.source.emitters.forEach((s, emitter) => {
      const state = this.states[emitter];
      if (!emitterStateOnce(state, DT, s.emitterState.loopSeconds)) return;
      const { fires, interpStartDt } = burstWindow(s.burst.spawnTime, state.loopedAge, DT);
      if (!fires) return;
      for (let i = 0; i < s.burst.count; i++) {
        const p = this.birth(emitter, this.ids[emitter]++, burstBirthAge(interpStartDt, s.burst.intervalDt, i, DT));
        if (p) this.live[emitter].push(p);
      }
      if (this.live[emitter].length > 512) throw new Error('BasicHit particle bounds');
    });
  }
  seek(step) {
    if (!Number.isInteger(step) || step < 0 || step > MAX_STEP) throw new Error('Invalid fixed step');
    if (step < this.step) this.reset();
    while (this.step < step) this.advance();
    return this.snapshot();
  }
  snapshot() {
    return { schema: 'st01c-basichit-frame/v1', systemAge: this.step / 60,
      emitters: NAMES.map((name, e) => ({ name, particles: this.live[e].map(p => view(p, e)) })) };
  }
}
