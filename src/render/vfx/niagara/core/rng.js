const f32 = Math.fround;
// NiagaraEmitterInstanceShader.usf shared VM/GPU rand3/rand4: signed 32-bit mixing,
// upper 24 bits. Math.imul preserves overflow, including the high-bit seed cases.
export function random3(id, tick, seed, counter) {
  let x = (Math.imul(id, 1664525) + 1013904223) | 0;
  let y = (Math.imul(tick, 1664525) + 1013904223) | 0;
  let z = (Math.imul(counter | (seed << 16), 1664525) + 1013904223) | 0;
  for (let i = 0; i < 2; i++) {
    x = (x + Math.imul(y, z)) | 0;
    y = (y + Math.imul(z, x)) | 0;
    z = (z + Math.imul(x, y)) | 0;
  }
  return [x, y, z].map(v => (v >>> 8) / 16777216);
}
export function random4(id, tick, seed, counter) {
  let [x, y, z, w] = [counter, id, tick, seed].map(v => (Math.imul(v, 1664525) + 1013904223) | 0);
  for (let i = 0; i < 2; i++) {
    x = (x + Math.imul(y, w)) | 0;
    y = (y + Math.imul(z, x)) | 0;
    z = (z + Math.imul(x, y)) | 0;
    w = (w + Math.imul(y, z)) | 0;
  }
  return [x, y, z, w].map(v => (v >>> 8) / 16777216);
}
export const uniformRange = (a, b, r) => f32(f32(a) + f32(f32(f32(b) - f32(a)) * r));
// RandomRangeFloat as compiled: the VM table holds Min and the folded Max - Min (span), so the draw is
// Min + span * r. uniformRange(a, b, r) equals uniformSpan(a, f32(f32(b) - f32(a)), r).
export const uniformSpan = (min, span, r) => f32(f32(min) + f32(f32(span) * r));
// RandomUnitVector (Unit Vector 3D): phi and cos(theta) from one float2 draw (min + span * r).
// JS cos/sin stand in for the VM's, which differ by 1-2 ulp (RECIPE.md, unresolved 1).
export function randomUnitVector(random, min, span) {
  const phi = uniformSpan(min[0], span[0], random[0]), c = uniformSpan(min[1], span[1], random[1]);
  const planar = f32(Math.sqrt(f32(1 - f32(c * c))));
  return [f32(f32(Math.cos(phi)) * planar), f32(f32(Math.sin(phi)) * planar), c];
}
