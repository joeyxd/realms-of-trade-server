const MAX_STROKE_POINTS = 2048;
const MAX_PATH_SAMPLES = 8192;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const validatedParams = new WeakSet();

/** Validate and return the canonical shared terrain brush parameters. */
export function brushParameters({ radius = 6, strength = .5, falloff = .5, shape = 'circle', aspect = .5, rotation = 0 } = {}) {
  if (!Number.isFinite(radius) || radius < 2 || radius > 24 ||
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

/** Return the falloff weight for an offset from a brush center. */
export function brushWeight(dx, dz, params = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
  const p = params && validatedParams.has(params) ? params : brushParameters(params);
  const angle = p.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Rotate the sample into brush-local coordinates.
  const x = (dx * cos + dz * sin) / p.radius;
  const z = (-dx * sin + dz * cos) / p.radius;
  let t;
  if (p.shape === 'square') t = Math.max(Math.abs(x), Math.abs(z));
  else if (p.shape === 'ellipse') t = Math.hypot(x, z / p.aspect);
  else t = Math.hypot(x, z);
  if (t > 1) return 0;
  const hard = t <= p.falloff ? 1 : 1 - (t - p.falloff) / Math.max(1e-9, 1 - p.falloff);
  return hard * hard * (3 - 2 * hard);
}

/** Brush outline in world-local XZ coordinates; ellipse uses its aspect ratio. */
export function brushOutline(params = {}, segments = 64) {
  const p = params && validatedParams.has(params) ? params : brushParameters(params);
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

/** Resample a stroke with a hard output bound, preserving its endpoints. */
export function strokePath(points) {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_STROKE_POINTS ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    throw new TypeError('Invalid terrain stroke points');
  }
  if (points.length === 1) return [{ x: points[0].x, z: points[0].z }];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
  const legacyCount = 1 + lengths.reduce((sum, n) => sum + Math.max(1, Math.ceil(n / .5)), 0);
  if (legacyCount <= MAX_PATH_SAMPLES) {
    const legacy = [{ x: points[0].x, z: points[0].z }];
    for (let i = 0; i < lengths.length; i++) {
      const a = points[i], b = points[i + 1], count = Math.max(1, Math.ceil(lengths[i] / .5));
      for (let s = 1; s <= count; s++) legacy.push({ x: a.x + (b.x - a.x) * s / count, z: a.z + (b.z - a.z) * s / count });
    }
    return legacy;
  }
  throw new RangeError('Terrain stroke path exceeds the 8192 sample limit');
}
