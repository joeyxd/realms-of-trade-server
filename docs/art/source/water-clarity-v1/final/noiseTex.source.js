// Procedural, tileable noise textures generated once at boot (no image assets).
// Every shader that used per-pixel procedural noise (water, clouds, terrain detail, caustics, foam)
// now samples these instead: a few texture fetches are far cheaper than hash/voronoi math.
//
// mnNoiseTex  RGBA8, 256², 8×8 cells per tile:
//   R = cellular F1   G = cellular F2−F1 (≈ edge distance)   B = fbm value noise   A = cell id
// mnWaveTex   RGBA8, 256²: RG = slope (x, z) of a smooth tileable height, B = height
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

const SIZE = 256;
let noiseTex = null, waveTex = null;

function periodicValueNoise(rng, period) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const at = (i, j) => g[((j % period) + period) % period * period + ((i % period) + period) % period];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}

export function getNoiseTexture() {
  if (noiseTex) return noiseTex;
  const rng = mulberry32(0x7e57ab1e);
  const CELLS = 8;
  const fx = new Float32Array(CELLS * CELLS), fy = new Float32Array(CELLS * CELLS), id = new Float32Array(CELLS * CELLS);
  for (let i = 0; i < fx.length; i++) { fx[i] = 0.12 + rng() * 0.76; fy[i] = 0.12 + rng() * 0.76; id[i] = rng(); }
  const octaves = [8, 16, 32, 64].map((p) => periodicValueNoise(rng, p));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = (x + 0.5) / SIZE * CELLS, py = (y + 0.5) / SIZE * CELLS;
      const cx = Math.floor(px), cy = Math.floor(py);
      let f1 = 9, f2 = 9, cid = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const k = (((gy % CELLS) + CELLS) % CELLS) * CELLS + (((gx % CELLS) + CELLS) % CELLS);
        const dx = gx + fx[k] - px, dy = gy + fy[k] - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; cid = id[k]; } else if (d < f2) f2 = d;
      }
      let n = 0, a = 0.5, norm = 0;
      for (let o = 0; o < 4; o++) {
        const per = [8, 16, 32, 64][o];
        n += a * octaves[o]((x / SIZE) * per, (y / SIZE) * per);
        norm += a; a *= 0.5;
      }
      const k = (y * SIZE + x) * 4;
      data[k] = Math.min(255, (f1 / 0.85) * 255);
      data[k + 1] = Math.min(255, ((f2 - f1) / 0.6) * 255);
      data[k + 2] = (n / norm) * 255;
      data[k + 3] = cid * 255;
    }
  }
  noiseTex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.anisotropy = 4;
  noiseTex.colorSpace = THREE.NoColorSpace;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

export function getWaveTexture() {
  if (waveTex) return waveTex;
  const rng = mulberry32(0x0ceab0b);
  const n4 = periodicValueNoise(rng, 4), n8 = periodicValueNoise(rng, 8), n16 = periodicValueNoise(rng, 16);
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE, v = y / SIZE;
    // Smooth rolling swell (integer frequencies keep it tileable) + soft noise chop.
    const swell = Math.sin((u * 3 + v * 2) * Math.PI * 2) * 0.22 + Math.sin((u * -2 + v * 4) * Math.PI * 2 + 1.3) * 0.16;
    h[y * SIZE + x] = swell + n4(u * 4, v * 4) * 0.55 + n8(u * 8, v * 8) * 0.3 + n16(u * 16, v * 16) * 0.12;
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const sx = (at(x + 1, y) - at(x - 1, y)) * 6;
    const sz = (at(x, y + 1) - at(x, y - 1)) * 6;
    const k = (y * SIZE + x) * 4;
    data[k] = Math.max(0, Math.min(255, (sx * 0.5 + 0.5) * 255));
    data[k + 1] = Math.max(0, Math.min(255, (sz * 0.5 + 0.5) * 255));
    data[k + 2] = Math.max(0, Math.min(255, (at(x, y) * 0.6 + 0.2) * 255));
    data[k + 3] = 255;
  }
  waveTex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  waveTex.wrapS = waveTex.wrapT = THREE.RepeatWrapping;
  waveTex.magFilter = THREE.LinearFilter;
  waveTex.minFilter = THREE.LinearMipmapLinearFilter;
  waveTex.generateMipmaps = true;
  waveTex.anisotropy = 4;
  waveTex.colorSpace = THREE.NoColorSpace;
  waveTex.needsUpdate = true;
  return waveTex;
}
