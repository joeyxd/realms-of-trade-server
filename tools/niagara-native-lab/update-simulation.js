// Presentation-only evolution. Initial states are explicit UE spawn fixtures, not a ported RNG.
const f32 = Math.fround;
export const DT = f32(1 / 60);
export const SOURCE_SHA = '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165';
const NAMES = ['NE_Flame_Basic_001', 'NE_Smoke_Basic'];
export const CONTROL_SPEC = Object.freeze({
  smokeSpeed: { default: 1, min: 0, max: 2, step: .05, label: 'Velocidad del humo', unit: '×',
    help: 'Cambia el ascenso desde el nacimiento; no añade partículas.' },
  smokeLife: { default: 2, min: .25, max: 4, step: .25, label: 'Vida del humo', unit: 's',
    help: 'Alarga la trayectoria y ralentiza el desvanecimiento y el atlas; aumenta la ocupación.' },
  stopAt: { default: 4, min: 0, max: 4, step: .1, label: 'Emitir hasta', unit: 's',
    help: 'Deja de admitir nacimientos; las partículas existentes terminan su vida. La fixture contiene 4 s.' }
});

function controls(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(CONTROL_SPEC, k)))
    throw new Error('Unknown evolution controls');
  return Object.fromEntries(Object.entries(CONTROL_SPEC).map(([key, spec]) => {
    const value = input[key] ?? spec.default;
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw new Error(`Invalid ${key}`);
    return [key, value];
  }));
}

export function sampleCurve(curve, age) {
  // NiagaraDataInterfaceCurve::SampleCurveInternal<true>: clamped linear LUT lookup.
  const at = Math.max(0, Math.min(curve.samples.length - 1,
    f32(f32(f32(age - curve.minTime) * curve.inverseRange) * (curve.samples.length - 1))));
  const i = Math.floor(at), j = Math.min(i + 1, curve.samples.length - 1);
  return f32(curve.samples[i] + f32((curve.samples[j] - curve.samples[i]) * f32(at - i)));
}

function validate(fixture) {
  if (fixture?.schema !== 'st01c-spawn-fixture/v1' || fixture.sourceSha256 !== SOURCE_SHA ||
      fixture.sourceStepCount !== 240 || fixture.sourceStepSeconds !== 1 / 60 ||
      JSON.stringify(fixture.emitterNames) !== JSON.stringify(NAMES) ||
      !Array.isArray(fixture.births) || fixture.births.length > 512)
    throw new Error('Invalid spawn fixture');
  const curve = fixture.alphaCurve;
  if (!curve || !Number.isFinite(curve.minTime) || !Number.isFinite(curve.inverseRange) || curve.inverseRange <= 0 ||
      !Array.isArray(curve.samples) || curve.samples.length !== 54 || !curve.samples.every(v => Number.isFinite(v) && v >= 0 && v <= 2))
    throw new Error('Invalid source alpha LUT');
  const seen = new Set(); let previousStep = 0;
  for (const row of fixture.births) {
    const p = row.particle, key = `${row.emitter}:${p?.uniqueId}`;
    if (![0, 1].includes(row.emitter) || !Number.isInteger(row.step) || row.step < previousStep || row.step < 1 || row.step > 240 ||
        !Number.isInteger(p?.uniqueId) || p.uniqueId < 0 || seen.has(key)) throw new Error('Invalid birth identity/order');
    previousStep = row.step; seen.add(key);
    for (const [name, length] of [['position', 3], ['velocity', 3], ['size', 2], ['color', 4]])
      if (!Array.isArray(p[name]) || p[name].length !== length || !p[name].every(v => Number.isFinite(v) && Math.abs(v) < 1e5))
        throw new Error(`Invalid birth ${name}`);
    if (![p.age, p.lifetime, p.subImage, p.rotation].every(Number.isFinite) || p.age < 0 || p.age >= DT ||
        p.lifetime !== (row.emitter ? 2 : 1) || p.size.some(v => v < 0) || p.subImage < 0 ||
        p.velocity[0] !== 0 || p.velocity[1] !== 0 || (row.emitter === 0 && p.velocity[2] !== 0))
      throw new Error('Unsupported birth attributes');
  }
  return fixture;
}

export class UpdateSimulation {
  constructor(fixture, options = {}) {
    this.fixture = structuredClone(validate(fixture));
    this.configure(options);
  }
  configure(options = {}) { this.options = controls(options); this.reset(); }
  reset() { this.step = 0; this.cursor = 0; this.live = [[], []]; }
  advance() {
    if (this.step >= 480) throw new Error('Private sequence ends at 8 seconds');
    this.step++;
    // The known pilot has constant velocity, no forces, and age-based alpha/SubUV.
    this.live = this.live.map((list, emitter) => list.filter(p => {
      p.age = f32(p.age + DT);
      if (p.age >= p.lifetime) return false;
      p.position = p.position.map((v, axis) => f32(v + f32(p.velocity[axis] * DT)));
      this.evaluate(p, emitter); return true;
    }));
    const rows = this.fixture.births;
    while (this.cursor < rows.length && rows[this.cursor].step === this.step) {
      const { emitter, particle } = rows[this.cursor++];
      if (this.step / 60 > this.options.stopAt) continue;
      const p = structuredClone(particle);
      if (emitter === 1) {
        // Preserve the observed sub-tick initialization. Only this multiplier is editor-derived.
        p.velocity[2] = f32(p.velocity[2] * this.options.smokeSpeed);
        p.lifetime = this.options.smokeLife;
      }
      this.evaluate(p, emitter); this.live[emitter].push(p);
    }
  }
  evaluate(p, emitter) {
    const normalizedAge = f32(p.age * f32(1 / p.lifetime));
    p.subImage = f32(normalizedAge * (emitter ? 60 : 32));
    if (emitter) p.color[3] = sampleCurve(this.fixture.alphaCurve, normalizedAge);
  }
  seek(step) {
    if (!Number.isInteger(step) || step < 0 || step > 480) throw new Error('Invalid fixed step');
    if (step < this.step) this.reset();
    while (this.step < step) this.advance();
    return this.snapshot();
  }
  snapshot() {
    return { schema: 'st01c-update-frame/v1', systemAge: this.step / 60,
      emitters: NAMES.map((name, i) => ({ name, particles: structuredClone(this.live[i]) })) };
  }
}
