// Deterministic continuous collision helpers shared by projectile movement and focused CPU tests.
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export function pointOnSegment(from, to, t) {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
}

// Earliest normalized time at which two linearly swept spheres touch, or null for a miss.
export function firstRelativeSphereContact(a0, a1, b0, b1, radius) {
  const r = { x: a0.x - b0.x, y: a0.y - b0.y, z: a0.z - b0.z };
  const v = { x: (a1.x - a0.x) - (b1.x - b0.x), y: (a1.y - a0.y) - (b1.y - b0.y), z: (a1.z - a0.z) - (b1.z - b0.z) };
  const c = dot3(r, r) - radius * radius;
  if (c <= 0) return 0;
  const a = dot3(v, v);
  if (a <= 1e-18) return null;
  const b = 2 * dot3(r, v), disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= -1e-10 && t <= 1 + 1e-10 ? Math.max(0, Math.min(1, t)) : null;
}

// Earliest segment-circle contact in X/Z. Returns null for a miss.
export function firstSegmentCircleContact2D(from, to, x, z, radius) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const ox = from.x - x, oz = from.z - z;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a <= 1e-18) return null;
  const b = 2 * (ox * dx + oz * dz), disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= -1e-10 && t <= 1 + 1e-10 ? Math.max(0, Math.min(1, t)) : null;
}

// Earliest contact with a vertical cylinder, including the projectile's radius as margin.
// The horizontal circle and vertical slab each give a time interval; their overlap is the hit window.
export function firstSegmentCylinderContact(from, to, x, z, radius, bottom, top) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const ox = from.x - x, oz = from.z - z;
  const a = dx * dx + dz * dz, c = ox * ox + oz * oz - radius * radius;
  let h0 = 0, h1 = 1;
  if (a <= 1e-18) {
    if (c > 0) return null;
  } else {
    const b = 2 * (ox * dx + oz * dz), disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    h0 = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a));
    h1 = Math.min(1, (-b + Math.sqrt(disc)) / (2 * a));
    if (h0 > h1) return null;
  }
  const dy = to.y - from.y;
  let v0 = 0, v1 = 1;
  if (Math.abs(dy) <= 1e-12) {
    if (from.y < bottom || from.y > top) return null;
  } else {
    const a = (bottom - from.y) / dy, b = (top - from.y) / dy;
    v0 = Math.max(0, Math.min(a, b));
    v1 = Math.min(1, Math.max(a, b));
    if (v0 > v1) return null;
  }
  const t = Math.max(h0, v0);
  return t <= Math.min(h1, v1) ? t : null;
}
