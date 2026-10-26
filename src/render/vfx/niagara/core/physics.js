const f32 = Math.fround;
// Drag of SolveForcesAndVelocity with zero force and DragIgnoreMass: v / (max(drag, 0) * dt + 1).
// A non-zero force would need the VM's Reciprocal of the mass, which no capture has measured.
export function dragVelocity(velocity, drag, dt) {
  const denominator = f32(f32(Math.max(drag, 0) * dt) + 1);
  return velocity.map(v => f32(v / denominator));
}
// AddVelocityFromPoint without falloff, fallback branch only: a particle closer to the velocity origin
// than the threshold (|p - o|^2 < threshold^2) adds strength * fallback. The general branch (rsqrt
// direction, distance falloff) is not ported: nothing captured exercises it.
export function addVelocityFromPoint(velocity, position, origin, strength, fallback, thresholdSquared) {
  const d = position.map((v, axis) => f32(v - origin[axis]));
  if (!(f32(f32(f32(d[0] * d[0]) + f32(d[1] * d[1])) + f32(d[2] * d[2])) < thresholdSquared))
    throw new Error('Unsupported AddVelocityFromPoint geometry');
  return velocity.map((v, axis) => f32(v + f32(strength * fallback[axis])));
}
// CalculateSizeAndRotationalInertiaByMass, sprite branch: edge = pow(max(0, mass / density * volumeScale), exponent).
// JS pow stands in for the VM's (RECIPE.md, unresolved 2).
export const sizeFromMass = (mass, density, volumeScale, exponent) =>
  f32(Math.pow(Math.max(0, f32(f32(mass / density) * volumeScale)), exponent));
