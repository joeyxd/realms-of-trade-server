// Shared belt-lantern placement for the character prop and its matching local-light source.
export const PERSONAL_LANTERN_LOCAL = Object.freeze({ x: 0.26, y: 1.16, z: 0.2 });

export function personalLanternPoint({ x, y, z, f = 0 } = {}) {
  if (![x, y, z, f].every(Number.isFinite)) return null;
  const c = Math.cos(f), s = Math.sin(f);
  const p = PERSONAL_LANTERN_LOCAL;
  return { x: x + p.x * c + p.z * s, y: y + p.y, z: z - p.x * s + p.z * c };
}
