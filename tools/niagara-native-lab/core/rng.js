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
