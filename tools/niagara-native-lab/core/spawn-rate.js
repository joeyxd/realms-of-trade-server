const f32 = Math.fround;
// Rate spawn with the VM's reciprocal-estimate interval. `start` is the offset of the first birth in the tick.
export function rateStep(remainder, rate, interval, delta) {
  const start = f32(interval * f32(1 - remainder));
  const total = f32(f32(rate * delta) + remainder), count = Math.floor(total);
  return { count, remainder: f32(total - count), start };
}
export function rateBirthAge(start, interval, i, dt) {
  const age = f32(dt - f32(start + f32(interval * i)));
  if (age < 0 || age >= dt) throw new Error('Unsupported native birth timing');
  return age;
}
