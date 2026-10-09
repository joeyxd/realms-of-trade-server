// Deterministic, dependency-free RGB8 texture generator for character-base-v3.
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii'), out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function pngRgb(size, paint) {
  const rowBytes = size * 3, scanlines = Buffer.allocUnsafe((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (rowBytes + 1);
    scanlines[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint((x + 0.5) / size, (y + 0.5) / size);
      const offset = row + 1 + x * 3;
      scanlines[offset] = r; scanlines[offset + 1] = g; scanlines[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const fract = (n) => n - Math.floor(n);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x, c, r) => Math.exp(-0.5 * ((x - c) / r) ** 2);
const wrapDistance = (a, b) => Math.abs(fract(a - b + 0.5) - 0.5);
const roundRgb = (rgb) => rgb.map((n) => Math.round(clamp(n, 0, 255)));

// Quiet, periodic brush planes keep both sides of each perimeter chart aligned.
function skinPaint(u, v, phase = 0) {
  const broad = Math.sin((u * 2 + phase) * Math.PI * 2) * 0.012
    + Math.sin((u * 4 - phase * 0.3) * Math.PI * 2) * 0.006
    + Math.cos((v * 2 + phase) * Math.PI * 2) * 0.006;
  const brush = Math.sin((u * 8 + phase) * Math.PI * 2) * Math.sin((v * 3 + phase) * Math.PI * 2) * 0.003;
  const value = 0.986 + broad + brush;
  return roundRgb([255 * value, 253 * (value - 0.006), 250 * (value - 0.012)]);
}

function headPaint(u, v) {
  // Front is U=.5; source PNG row zero is UV V=0 at the crown.
  const y = 0.314 - v * 0.326;
  let [r, g, b] = skinPaint(u, v, 0.17);
  const front = gauss(wrapDistance(u, 0.5), 0, 0.115);
  const cheekY = gauss(y, 0.133, 0.025);
  const cheeks = (gauss(wrapDistance(u, 0.402), 0, 0.024) + gauss(wrapDistance(u, 0.598), 0, 0.024)) * cheekY * front;
  const blush = clamp(cheeks) * 0.065;
  r *= 1 + blush * 0.25; g *= 1 - blush * 0.45; b *= 1 - blush;

  // Facial paint stays within skin planes; eyes, brows, hair, and beard remain geometry.
  const center = gauss(wrapDistance(u, 0.5), 0, 0.018) * front;
  const underNose = gauss(y, 0.111, 0.010) * center;
  const lowerLip = gauss(y, 0.065, 0.005) * gauss(wrapDistance(u, 0.5), 0, 0.030) * front;
  const lipTone=gauss(y,.071,.008)*gauss(wrapDistance(u,.5),0,.044)*front;
  r*=1+lipTone*.010;g*=1-lipTone*.036;b*=1-lipTone*.048;
  const orbit = (gauss(wrapDistance(u, 0.435), 0, 0.023) + gauss(wrapDistance(u, 0.565), 0, 0.023))
    * gauss(y, 0.185, 0.013) * front;
  const cheekPlane = (gauss(wrapDistance(u, 0.395), 0, 0.027) + gauss(wrapDistance(u, 0.605), 0, 0.027))
    * gauss(y, 0.112, 0.028) * front;
  const jawPlane = gauss(y, 0.033, 0.015) * front;
  const shade = clamp(underNose*.065 + lowerLip*.045 + orbit*.065 + cheekPlane*.052 + jawPlane*.018,0,.13);
  // Broad skin planes remain recolorable; eye, brow and lip contours are separate geometry.
  return roundRgb([r*(1-shade),g*(1-shade*.96),b*(1-shade*.88)]);
}

function clothPaint(u, v, phase, base) {
  const broad = Math.sin((u * 2 + phase) * Math.PI * 2) * 0.014
    + Math.sin((u * 4 - phase) * Math.PI * 2) * 0.007
    + Math.cos((v * 2 + phase) * Math.PI * 2) * 0.009;
  // Painted weave is broad and subdued; no high-frequency noise.
  const weave = Math.sin((u * 48 + phase) * Math.PI * 2) * 0.002
    + Math.sin((v * 40 - phase) * Math.PI * 2) * 0.0015;
  const hem = smooth(0.94, 0.951, v) * (1 - smooth(0.974, 0.986, v));
  const stitch = hem * (0.055 + 0.008 * Math.sin(u * Math.PI * 2 * 24 + phase));
  const seam = gauss(wrapDistance(u, 0.25), 0, 0.004) + gauss(wrapDistance(u, 0.75), 0, 0.004);
  const value = clamp(0.985 + broad + weave - stitch - seam * 0.035, 0.92, 1.02);
  return roundRgb(base.map((c) => c * value));
}

const PAD = 0.006;
const BODY_CHARTS = [
  { name: 'torso', x0: 0, y0: 0, x1: 0.5, y1: 0.5, phase: 0.12 },
  { name: 'armL', x0: 0.5, y0: 0, x1: 0.75, y1: 0.5, phase: 0.24 },
  { name: 'armR', x0: 0.75, y0: 0, x1: 1, y1: 0.5, phase: 0.36 },
  { name: 'legL', x0: 0, y0: 0.5, x1: 0.35, y1: 1, phase: 0.48 },
  { name: 'legR', x0: 0.35, y0: 0.5, x1: 0.7, y1: 1, phase: 0.6 },
  { name: 'handL', x0: 0.7, y0: 0.5, x1: 0.85, y1: 0.75, phase: 0.72 },
  { name: 'handR', x0: 0.85, y0: 0.5, x1: 1, y1: 0.75, phase: 0.84 },
  { name: 'footL', x0: 0.7, y0: 0.75, x1: 0.85, y1: 1, phase: 0.96 },
  { name: 'footR', x0: 0.85, y0: 0.75, x1: 1, y1: 1, phase: 1.08 },
];

function bodyPaint(u, v) {
  for (const chart of BODY_CHARTS) {
    const x0 = chart.x0 + PAD, x1 = chart.x1 - PAD;
    const y0 = chart.y0 + PAD, y1 = chart.y1 - PAD;
    if (u >= x0 && u < x1 && v >= y0 && v < y1) {
      return skinPaint((u - x0) / (x1 - x0), (v - y0) / (y1 - y0), chart.phase);
    }
  }
  return [249, 247, 244];
}

const FAMILIES = {
  body: bodyPaint,
  head: headPaint,
  top: (u, v) => clothPaint(u, v, 0.23, [255, 255, 255]),
  shorts: (u, v) => clothPaint(u, v, 0.71, [255, 255, 255]),
};

/** Build one deterministic RGB8 PNG; no filesystem or browser I/O occurs here. */
export function makeTexture(family, size) {
  const paint = FAMILIES[family];
  if (!paint) throw new RangeError(`Unknown character texture family: ${family}`);
  if (size !== 512 && size !== 1024) throw new RangeError(`Unsupported character texture size: ${size}`);
  return pngRgb(size, paint);
}
