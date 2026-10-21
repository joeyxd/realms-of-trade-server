const f32 = Math.fround;
export const DT = f32(1 / 60);
// Compiled CPU VM: true division.
export const normalizedAge = (age, lifetime) => f32(age / lifetime);
// Update lab (captured spawn fixtures): reciprocal multiply, which can differ in the last bit.
export const normalizedAgeByReciprocal = (age, lifetime) => f32(age * f32(1 / lifetime));
// Returns false when the particle dies. killEpsilon null: dies at lifetime (update lab, unrounded);
// a number: the compiled ParticleState kills at lifetime - epsilon.
export function ageParticle(p, dt, killEpsilon) {
  p.age = f32(p.age + dt);
  return killEpsilon === null ? !(p.age >= p.lifetime) : !(p.age >= f32(p.lifetime - f32(killEpsilon)));
}
export function integrateVelocity(p, dt) {
  p.position = p.position.map((v, axis) => f32(v + f32(p.velocity[axis] * dt)));
}
// ScaleColor over Particles.Initial.Color: RGB times 1, alpha times the scale.
export const scaleColor = (initial, alpha) => initial.map((c, i) => f32(c * f32(1 * (i < 3 ? 1 : alpha))));
// ScaleSpriteSize / SpriteSizeScale over Particles.Initial.SpriteSize: both axes times the factor.
export const scaleSpriteSize = (initial, factor) => initial.map(s => f32(s * f32(factor * 1)));
