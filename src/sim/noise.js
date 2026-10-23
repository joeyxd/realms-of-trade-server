// Seeded 2D value/gradient noise + fbm. Pure JS, deterministic across worker/main/node.
import { mulberry32 } from '../core/rng.js';

export function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  // 12 gradient directions
  const gx = new Float64Array(256), gy = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2 + 0.37;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  // Gradient noise in [-1, 1] (approx).
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]];
    const ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
    const d00 = gx[aa] * xf + gy[aa] * yf;
    const d10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const d01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const d11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    const x1 = d00 + (d10 - d00) * u;
    const x2 = d01 + (d11 - d01) * u;
    return (x1 + (x2 - x1) * v) * 1.414;
  }

  function fbm(x, y, oct = 4, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f, y * f);
      n += a; a *= gain; f *= lac;
    }
    return s / n;
  }

  return { noise, fbm };
}
