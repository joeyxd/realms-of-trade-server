// Bounded presentation port of the exact compiled CPU pilot. No captured births.
import { SOURCE_SHA, CONTROL_SPEC as UPDATE_CONTROLS } from './update-simulation.js';
import { SUPPORTED_BEHAVIOR } from './source-identity.js';
import { random3, random4, uniformRange as range } from '../../src/render/vfx/niagara/core/rng.js';
import { sampleCurve, validateCurve } from '../../src/render/vfx/niagara/core/curve.js';
import { rateStep, rateBirthAge } from '../../src/render/vfx/niagara/core/spawn-rate.js';
import { DT, normalizedAge, ageParticle, integrateVelocity } from '../../src/render/vfx/niagara/core/particle-state.js';
import { subUVFrame } from '../../src/render/vfx/niagara/core/subuv.js';
const f32 = Math.fround;
const NAMES = ['NE_Flame_Basic_001', 'NE_Smoke_Basic'];
export const CONTROL_SPEC = Object.freeze({
  smokeSpeed: UPDATE_CONTROLS.smokeSpeed,
  smokeLife: UPDATE_CONTROLS.smokeLife,
  stopAt: { ...UPDATE_CONTROLS.stopAt, default: 8, max: 8,
    help: 'Detiene la emisión local; las partículas que ya nacieron terminan su vida.' },
  seed: { default: 6371, min: 0, max: 65534, step: 1, label: 'Semilla', unit: '',
    help: 'Otra distribución repetible de tamaños, color y posiciones; conserva tiempos y cantidades.' }
});

export { random3, random4 };
function validate(source) {
  if (JSON.stringify([source?.flame, source?.smoke, source?.alphaCurve]) !== SUPPORTED_BEHAVIOR)
    throw new Error('Unreviewed native source behavior');
  if (source?.schema !== 'st01c-native-source/v1' || source.sourceSha256 !== SOURCE_SHA ||
      JSON.stringify(source.emitterNames) !== JSON.stringify(NAMES) ||
      JSON.stringify(source.rates) !== '[3,10]' || JSON.stringify(source.fixtureSeeds) !== '[6371,6372]' ||
      source.activationDeltaSeconds !== .0001 ||
      JSON.stringify(source.vmReciprocalEstimates) !== '[0.333251953125,0.0999755859375]' ||
      source.flame?.lifetime !== 1 || source.smoke?.lifetime !== 2 ||
      source.smoke.surfaceOnly !== false || source.smoke.enableLatheProfile !== false || source.smoke.orientationAxis !== 2)
    throw new Error('Unsupported native pilot source');
  for (const [value, length] of [[source.flame.size, 2], [source.smoke.size, 2],
    [source.flame.color, 4], [source.smoke.color, 4], [source.flame.colorRandomMin, 4], [source.flame.colorRandomMax, 4],
    [source.flame.offsetCm, 3], [source.smoke.offsetCm, 3], [source.smoke.velocityCm, 3]])
    if (!Array.isArray(value) || value.length !== length || !value.every(v => Number.isFinite(v) && Math.abs(v) <= 1000))
      throw new Error('Invalid native source vector');
  for (const value of [source.flame.radiusCm, source.smoke.radiusCm, source.smoke.heightCm, source.flame.radialPower])
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error('Invalid native source geometry');
  if (JSON.stringify(source.flame.hemispheres) !== '[false,false,true]' ||
      [source.flame, source.smoke].some(s => s.size[0] <= 0 || s.size[1] < s.size[0]) ||
      source.smoke.velocityCm[0] !== 0 || source.smoke.velocityCm[1] !== 0)
    throw new Error('Unsupported native source geometry');
  validateCurve(source.alphaCurve, { sampleCount: 54, min: 0, max: 2, message: 'Invalid native alpha curve' });
  return source;
}

export class NativeSimulation {
  constructor(source, options = {}) { this.source = structuredClone(validate(source)); this.configure(options); }
  configure(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(CONTROL_SPEC, k)))
      throw new Error('Unknown native controls');
    this.options = Object.fromEntries(Object.entries(CONTROL_SPEC).map(([key, spec]) => {
      const value = input[key] ?? spec.default;
      if (!Number.isFinite(value) || value < spec.min || value > spec.max || (key === 'seed' && !Number.isInteger(value)))
        throw new Error(`Invalid native ${key}`);
      return [key, value];
    }));
    this.reset();
  }
  reset() { this.step = 0; this.live = [[], []]; this.remainders = [0, 0]; this.ids = [0, 0]; }
  evaluate(p, emitter) {
    const normalized = normalizedAge(p.age, p.lifetime);
    p.subImage = subUVFrame(normalized, emitter ? 60 : 32);
    if (emitter) p.color[3] = sampleCurve(this.source.alphaCurve, normalized);
  }
  birth(emitter, id, age) {
    const s = emitter ? this.source.smoke : this.source.flame, seed = this.options.seed + emitter;
    const tick = this.step - 1;
    const size = range(...s.size, random3(id, tick, seed, 1)[0]);
    let color, position;
    if (!emitter) {
      color = random4(id, tick, seed, 2).map((r, i) => f32(f32(s.color[i]) * range(s.colorRandomMin[i], s.colorRandomMax[i], r)));
      // Call 3 is MaterialRandom; even though the material ignores it, it advances
      // Niagara's counter. The sphere is call 4 in the compiled spawn script.
      const [phiRandom, cosRandom, radiusRandom] = random3(id, tick, seed, 4);
      const phi = f32(phiRandom * f32(2 * Math.PI)), c = range(-1, 1, cosRandom);
      const planar = f32(Math.sqrt(f32(1 - f32(c * c))));
      const radius = f32(Math.pow(radiusRandom, f32(s.radialPower)));
      const unit = [f32(f32(Math.cos(phi)) * planar), f32(f32(Math.sin(phi)) * planar), Math.abs(c)];
      position = unit.map((v, i) => f32(f32(s.offsetCm[i]) + f32(f32(s.radiusCm) * f32(v * radius))));
    } else {
      color = s.color.map(f32);
      // Calls 2/3/4 are material random and the unit-vector helper's two outputs.
      // SurfaceOnly=false discards those directions but still consumes the calls.
      const [, angleRandom, zRandom, radiusRandom] = random4(id, tick, seed, 5);
      const angle = f32(angleRandom * f32(2 * Math.PI)), radial = f32(Math.sqrt(radiusRandom));
      position = [f32(f32(f32(Math.sin(angle)) * radial) * f32(s.radiusCm)),
        f32(f32(f32(Math.cos(angle)) * radial) * f32(s.radiusCm)), f32(range(-1, 1, zRandom) * f32(s.heightCm))]
        .map((v, i) => f32(v + f32(s.offsetCm[i])));
    }
    const velocity = emitter ? s.velocityCm.map(v => f32(v * this.options.smokeSpeed)) : [0, 0, 0];
    position = position.map((v, i) => f32(v + f32(velocity[i] * age)));
    const p = { uniqueId: id, position, velocity, size: [size, size], color, rotation: 0,
      age, lifetime: emitter ? this.options.smokeLife : s.lifetime, subImage: 0 };
    this.evaluate(p, emitter); return p;
  }
  advance() {
    if (this.step >= 480) throw new Error('Private sequence ends at 8 seconds');
    this.step++;
    this.live = this.live.map((list, emitter) => list.filter(p => {
      // The compiled ParticleState kills at lifetime - 0.0001, not at lifetime.
      if (!ageParticle(p, DT, .0001)) return false;
      integrateVelocity(p, DT);
      this.evaluate(p, emitter); return true;
    }));
    // The first activated system update uses UE's update-on-spawn microtick.
    const delta = this.step === 1 ? f32(this.source.activationDeltaSeconds) : DT;
    for (let emitter = 0; emitter < 2; emitter++) {
      const interval = this.source.vmReciprocalEstimates[emitter];
      const { count, remainder, start } = rateStep(this.remainders[emitter], this.source.rates[emitter], interval, delta);
      this.remainders[emitter] = remainder;
      for (let i = 0; i < count; i++) {
        const id = this.ids[emitter]++;
        if (this.step / 60 > this.options.stopAt) continue;
        const age = rateBirthAge(start, interval, i, DT);
        this.live[emitter].push(this.birth(emitter, id, age));
      }
      if (this.live[emitter].length > 512) throw new Error('Native particle bounds');
    }
  }
  seek(step) {
    if (!Number.isInteger(step) || step < 0 || step > 480) throw new Error('Invalid fixed step');
    if (step < this.step) this.reset();
    while (this.step < step) this.advance();
    return this.snapshot();
  }
  snapshot() {
    return { schema: 'st01c-native-frame/v1', systemAge: this.step / 60,
      emitters: NAMES.map((name, i) => ({ name, particles: structuredClone(this.live[i]) })) };
  }
}
