// Frame contracts at the renderer boundary: accepted schemas, emitters in order (name and subImage
// policy) and the per-emitter particle limit. validateFrame only accepts specs built by frameSpec.
const SPECS = new WeakSet();
const SUBIMAGE = ['required', 'optional'];

export function frameSpec({ schemas, emitters, limit } = {}) {
  if (!Array.isArray(schemas) || !schemas.length || !schemas.every(s => typeof s === 'string' && s) ||
      !Array.isArray(emitters) || !emitters.length ||
      !emitters.every(e => typeof e?.name === 'string' && e.name && SUBIMAGE.includes(e.subImage)) ||
      new Set(emitters.map(e => e.name)).size !== emitters.length || !Number.isInteger(limit) || limit < 1)
    throw new Error('Invalid frame spec');
  const spec = Object.freeze({ schemas: Object.freeze([...schemas]), limit,
    emitters: Object.freeze(emitters.map(({ name, subImage }) => Object.freeze({ name, subImage }))) });
  SPECS.add(spec);
  return spec;
}

export function validateFrame(frame, spec) {
  if (!SPECS.has(spec)) throw new Error('Invalid frame spec');
  const count = spec.emitters.length;
  if (!frame || !spec.schemas.includes(frame.schema) || frame.emitters?.length !== count ||
      !Number.isFinite(frame.systemAge) || frame.systemAge < 0) throw new Error('Invalid observed frame');
  for (let index = 0; index < count; index++) {
    const emitter = frame.emitters[index], { name, subImage } = spec.emitters[index];
    if (emitter.name !== name || !Array.isArray(emitter.particles) || emitter.particles.length > spec.limit)
      throw new Error('Unexpected emitter or particle bounds');
    for (const p of emitter.particles) {
      for (const [field, length] of [['position', 3], ['size', 2], ['color', 4]]) {
        if (!Array.isArray(p[field]) || p[field].length !== length || !p[field].every(Number.isFinite))
          throw new Error(`Invalid particle ${field}`);
      }
      // An optional subImage may be absent; present, it must be a finite index >= 0 like a required one.
      if (!Number.isFinite(p.rotation) ||
          (subImage === 'required' || p.subImage !== undefined) && !(Number.isFinite(p.subImage) && p.subImage >= 0) ||
          p.size.some(x => x < 0)) throw new Error('Invalid sprite attributes');
    }
  }
  return frame;
}

// NS_BasicHit frames (basichit-simulation.js): the emitter names of basichit-source.json, in order. Only the
// Flame writes SubUV; Flash and SimpleBurst carry no subImage. 512 is the renderer's buffer per emitter.
export const BASICHIT_FRAME_SPEC = frameSpec({ schemas: ['st01c-basichit-frame/v1'], limit: 512, emitters: [
  { name: 'NE_Flame_Basic_001', subImage: 'required' },
  { name: 'NE_Basic_Flash001', subImage: 'optional' },
  { name: 'NE_SimpleBurst', subImage: 'optional' }] });
