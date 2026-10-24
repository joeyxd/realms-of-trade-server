const MAX_STROKE_POINTS = 2048;
const MAX_PATH_SAMPLES = 8192;
/** GM08: the largest terrain sculpt and paint radius; scatter and the v3/v4 document path keep the 24 m default. */
export const TERRAIN_BRUSH_MAX_RADIUS = 128;
/** GM08: 'stroke' keeps the strongest dab per vertex (a second pass adds nothing); 'airbrush' accumulates. */
export const BRUSH_FLOWS = Object.freeze(['stroke', 'airbrush']);
/** GM08 airbrush: the flow of a dab laid on the spot, one per tick while the pointer is held still. */
export const AIRBRUSH_HOLD_FLOW = .1;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const validatedParams = new WeakSet();
const kernels = new WeakMap();

/** Validate and return the canonical shared terrain brush parameters; `maxRadius` is 24 m unless a caller raises it. */
export function brushParameters({ radius = 6, strength = .5, falloff = .5, shape = 'circle', aspect = .5, rotation = 0 } = {},
  { maxRadius = 24 } = {}) {
  if (!Number.isFinite(radius) || radius < 2 || radius > maxRadius ||
      !Number.isFinite(strength) || strength <= 0 || strength > 1 ||
      !Number.isFinite(falloff) || falloff < 0 || falloff > 1 ||
      !['circle', 'square', 'ellipse'].includes(shape) ||
      !Number.isFinite(aspect) || aspect < .25 || aspect > 1 ||
      !Number.isFinite(rotation) || rotation < 0 || rotation > 360) {
    throw new TypeError('Invalid terrain brush parameters');
  }
  const canonical = Object.freeze({ radius, strength, falloff, shape, aspect, rotation });
  validatedParams.add(canonical);
  return canonical;
}

// The falloff weight of canonical parameters with the rotation computed once (GM08: a 128 m dab is 66,000 calls).
function kernel(p) {
  let weight = kernels.get(p);
  if (weight) return weight;
  const angle = p.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle), { radius, shape, aspect, falloff } = p;
  const soft = Math.max(1e-9, 1 - falloff);
  weight = (dx, dz) => {
    // Rotate the sample into brush-local coordinates.
    const x = (dx * cos + dz * sin) / radius;
    const z = (-dx * sin + dz * cos) / radius;
    // sqrt, not Math.hypot: about seven times faster in V8, and the shape needs no overflow guard.
    let t;
    if (shape === 'square') t = Math.max(Math.abs(x), Math.abs(z));
    else if (shape === 'ellipse') { const e = z / aspect; t = Math.sqrt(x * x + e * e); }
    else t = Math.sqrt(x * x + z * z);
    if (t > 1) return 0;
    const hard = t <= falloff ? 1 : 1 - (t - falloff) / soft;
    return hard * hard * (3 - 2 * hard);
  };
  kernels.set(p, weight);
  return weight;
}

/** Return the falloff weight for an offset from a brush center. */
export function brushWeight(dx, dz, params = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
  return kernel(params && validatedParams.has(params) ? params : brushParameters(params))(dx, dz);
}

/** GM08: dab spacing of a terrain stroke: 0.5 m up to a 6 m radius, a twelfth of the radius above (edge error < 0.1 %). */
export function strokeSpacing(radius) { return Math.max(.5, radius / 12); }

/**
 * GM08: the influence of a resampled stroke over the grid window its dabs reach (column i = x + half, row j = z + half,
 * clamped to 0..2 half). Per vertex: the strongest dab weight ('stroke'), or the sum of each dab weight times its flow
 * ('airbrush': the distance the dab moved over the radius, AIRBRUSH_HOLD_FLOW for a dab on the spot or the first).
 * Returns { i0, j0, i1, j1, width, values } with values row-major over the window.
 */
export function strokeInfluence(path, params, { half, flow = 'stroke' } = {}) {
  const p = params && validatedParams.has(params) ? params : brushParameters(params, { maxRadius: TERRAIN_BRUSH_MAX_RADIUS });
  if (!Array.isArray(path) || !path.length || !Number.isSafeInteger(half) || half <= 0 || !BRUSH_FLOWS.includes(flow))
    throw new TypeError('Invalid terrain stroke influence');
  const weight = kernel(p), last = 2 * half, angle = p.rotation * Math.PI / 180, airbrush = flow === 'airbrush';
  const reach = p.shape === 'square' ? p.radius * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))) : p.radius;
  const low = (v) => clamp(Math.floor(v + half - reach - 1), 0, last), high = (v) => clamp(Math.ceil(v + half + reach + 1), 0, last);
  let i0 = last, j0 = last, i1 = 0, j1 = 0;
  for (const c of path) { i0 = Math.min(i0, low(c.x)); i1 = Math.max(i1, high(c.x)); j0 = Math.min(j0, low(c.z)); j1 = Math.max(j1, high(c.z)); }
  const width = i1 - i0 + 1, values = new Float64Array(width * (j1 - j0 + 1));
  let previous = null;
  for (const c of path) {
    const moved = previous ? Math.hypot(c.x - previous.x, c.z - previous.z) : 0;
    const gain = moved > 0 ? moved / p.radius : AIRBRUSH_HOLD_FLOW;
    previous = c;
    for (let j = low(c.z), b1 = high(c.z), a0 = low(c.x), a1 = high(c.x); j <= b1; j++) {
      for (let i = a0, n = (j - j0) * width + a0 - i0; i <= a1; i++, n++) {
        const value = weight(i - half - c.x, j - half - c.z);
        if (value <= 0) continue;
        if (airbrush) values[n] += value * gain;
        else if (value > values[n]) values[n] = value;
      }
    }
  }
  return { i0, j0, i1, j1, width, values };
}

/**
 * GM08: an airbrush sum as the influence the stroke rules take: metres over the strength for raise and lower (they
 * multiply it back); for a blend (flatten, smooth, paint, erase) the share 1 - exp(-strength x sum) over the strength,
 * so a held brush approaches its target without passing it.
 */
export function airbrushInfluence(sum, strength, blend) { return blend ? (1 - Math.exp(-strength * sum)) / strength : sum; }

/** Brush outline in world-local XZ coordinates; ellipse uses its aspect ratio. */
export function brushOutline(params = {}, segments = 64) {
  const p = params && validatedParams.has(params) ? params : brushParameters(params, { maxRadius: TERRAIN_BRUSH_MAX_RADIUS });
  const count = clamp(Math.trunc(Number.isFinite(segments) ? segments : 64), 8, 256);
  const angle = p.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return Array.from({ length: count }, (_, i) => {
    const a = i * Math.PI * 2 / count;
    let x, z;
    if (p.shape === 'square') {
      // Ray intersection with a square gives a four-sided outline for any segment count.
      const ux = Math.cos(a), uz = Math.sin(a), scale = p.radius / Math.max(Math.abs(ux), Math.abs(uz));
      x = ux * scale; z = uz * scale;
    } else {
      x = p.radius * Math.cos(a);
      z = p.radius * Math.sin(a) * (p.shape === 'ellipse' ? p.aspect : 1);
    }
    return { x: x * cos - z * sin, z: x * sin + z * cos };
  });
}

/** Resample a stroke every `spacing` metres or less (0.5 m by default) with a hard output bound, preserving its endpoints. */
export function strokePath(points, spacing = .5) {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_STROKE_POINTS ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) || !(spacing >= .5 && spacing <= TERRAIN_BRUSH_MAX_RADIUS)) {
    throw new TypeError('Invalid terrain stroke points');
  }
  if (points.length === 1) return [{ x: points[0].x, z: points[0].z }];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
  const total = 1 + lengths.reduce((sum, n) => sum + Math.max(1, Math.ceil(n / spacing)), 0);
  if (total <= MAX_PATH_SAMPLES) {
    const path = [{ x: points[0].x, z: points[0].z }];
    for (let i = 0; i < lengths.length; i++) {
      const a = points[i], b = points[i + 1], count = Math.max(1, Math.ceil(lengths[i] / spacing));
      for (let s = 1; s <= count; s++) path.push({ x: a.x + (b.x - a.x) * s / count, z: a.z + (b.z - a.z) * s / count });
    }
    return path;
  }
  throw new RangeError('Terrain stroke path exceeds the 8192 sample limit');
}
