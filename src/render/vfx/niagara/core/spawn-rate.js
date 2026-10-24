const f32 = Math.fround;
// Rate spawn with the VM's reciprocal-estimate interval. `start` is the offset of the first birth in the tick.
export function rateStep(remainder, rate, interval, delta) {
  const start = f32(interval * f32(1 - remainder));
  const total = f32(f32(rate * delta) + remainder), count = Math.floor(total);
  return { count, remainder: f32(total - count), start };
}
// Update time of the interpolated spawn script: Engine.DeltaTime - (InterpStartDt + SpawnInterval * index).
export const spawnUpdateDt = (start, interval, i, dt) => f32(dt - f32(start + f32(interval * i)));
export function rateBirthAge(start, interval, i, dt) {
  const age = spawnUpdateDt(start, interval, i, dt);
  if (age < 0 || age >= dt) throw new Error('Unsupported native birth timing');
  return age;
}
