// Deterministic, dependency-free RGB8 texture generator for character-base-v1.
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = 3;
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

function pngRgb(size, pixels) {
  const rowBytes = size * CHANNELS, scanlines = Buffer.allocUnsafe((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (rowBytes + 1);
    scanlines[row] = 0; // PNG filter type None keeps generation simple and reproducible.
    for (let x = 0; x < size; x++) {
      const rgb = pixels((x + 0.5) / size, (y + 0.5) / size);
      const offset = row + 1 + x * CHANNELS;
      scanlines[offset] = rgb[0]; scanlines[offset + 1] = rgb[1]; scanlines[offset + 2] = rgb[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8-bit truecolor RGB, no palette or alpha.
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fract = (n) => n - Math.floor(n);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gaussian = (x, center, radius) => Math.exp(-0.5 * ((x - center) / radius) ** 2);
const wrapDistance = (a, b) => Math.abs(fract(a - b + 0.5) - 0.5);
const mix = (a, b, t) => a + (b - a) * t;

function roundedColor(rgb) { return rgb.map((n) => Math.round(clamp(n, 0, 255))); }

// Broad, low-contrast warm brush planes; this is not a normal, roughness, or baked-light map.
function paintedNeutral(u, v, phase = 0) {
  const broad = Math.sin((u * 2.1 + v * 0.7 + phase) * Math.PI * 2) * 0.012
    + Math.sin((u * 0.8 - v * 1.7 + phase * 0.3) * Math.PI * 2) * 0.009;
  const brush = Math.sin((u * 5.2 + Math.sin(v * 5.1 + phase) * 0.16 + phase) * Math.PI * 2)
    * Math.sin((v * 3.1 + phase) * Math.PI * 2) * 0.006;
  const value = 0.986 + broad + brush;
  // Warm white-gray multiplication keeps vertex colors within roughly an eight-percent shift.
  return roundedColor([255 * value, 253 * (value - 0.006), 250 * (value - 0.012)]);
}

function headTexture(u, v) {
  // Head UV contract: front center is u=.5; v=(.315-y)/.325, from bald crown to chin.
  const y = 0.315 - v * 0.325;
  let [r, g, b] = paintedNeutral(u, v, 0.17);
  const front = gaussian(wrapDistance(u, 0.5), 0, 0.115);
  const cheekY = gaussian(y, 0.158, 0.035);
  const cheekL = gaussian(wrapDistance(u, 0.445), 0, 0.025) * cheekY * front;
  const cheekR = gaussian(wrapDistance(u, 0.555), 0, 0.025) * cheekY * front;
  const blush = clamp(cheekL + cheekR, 0, 1) * 0.035;
  r *= 1 + blush * 0.25;
  g *= 1 - blush * 0.45;
  b *= 1 - blush;

  // Soft under-nose and lip planes are deliberately restrained; eyes and brows stay geometry-driven.
  const underNose = gaussian(y, 0.116, 0.012) * gaussian(wrapDistance(u, 0.5), 0, 0.018) * front;
  const lip = gaussian(y, 0.063, 0.006) * gaussian(wrapDistance(u, 0.5), 0, 0.023) * front;
  const contour = smoothstep(0.285, 0.37, wrapDistance(u, 0.5)) * gaussian(y, 0.17, 0.15);
  const warm = clamp(underNose * 0.035 + lip * 0.045, 0, 0.06);
  const shade = clamp(contour * 0.025, 0, 0.025);
  r *= 1 - shade; g *= 1 - shade - warm * 0.15; b *= 1 - shade - warm;
  return roundedColor([r, g, b]);
}

function clothTexture(u, v, phase) {
  // Fine woven modulation is intentionally subtle so the garment vertex color remains in charge.
  const warp = Math.sin((u * 72 + phase) * Math.PI * 2) * 0.0035;
  const weft = Math.sin((v * 68 - phase * 0.37) * Math.PI * 2) * 0.003;
  const broad = Math.sin((u * 2.7 + v * 0.8 + phase) * Math.PI * 2) * 0.009
    + Math.sin((u * 1.1 - v * 1.8) * Math.PI * 2) * 0.006;
  const wear = Math.max(0, Math.sin((u * 7.5 + v * 1.2 + phase) * Math.PI * 2)) * 0.007;
  const hem = smoothstep(0.94, 0.948, v) * (1 - smoothstep(0.972, 0.98, v));
  const seam = hem * (0.045 + 0.008 * Math.sin(u * Math.PI * 2 * 28 + phase));
  const value = clamp(0.985 + warp + weft + broad + wear - seam, 0.92, 1);
  return roundedColor([255 * value, 255 * value, 255 * value]);
}

const families = {
  head: headTexture,
  body: (u, v) => paintedNeutral(u, v, 0.39),
  top: (u, v) => clothTexture(u, v, 0.23),
  shorts: (u, v) => clothTexture(u, v, 0.71),
};

/** Build one deterministic RGB8 PNG; this function performs no filesystem or browser I/O. */
export function makeTexture(family, size) {
  const paint = families[family];
  if (!paint) throw new RangeError(`Unknown character texture family: ${family}`);
  if (size !== 512 && size !== 1024) throw new RangeError(`Unsupported character texture size: ${size}`);
  return pngRgb(size, paint);
}
