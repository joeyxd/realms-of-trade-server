// GM08d (docs/briefs/gm08-large-brushes.md): heightmap export and import. Export writes the compiled Nx x Nz
// heights as a 16-bit grayscale PNG with a JSON sidecar (also inside the PNG as a tEXt chunk, so the PNG alone imports
// back to its heights). Import reads a 16-bit (or 8-bit) PNG or an Unreal Landscape .r16 (raw little-endian 16-bit,
// square), maps it to the [min, max] range the GM chooses and resamples it to the grid; terrainRegion.js applies the
// result as a flatten-to-target field with the edit clip and clamps, in one commit.
// Pure module: no DOM; it runs in the browser and in Node (CompressionStream and DecompressionStream).
import { centeredSquare } from '../sim/mapBounds.js';
import { TERRAIN_GRID_MAX_HEIGHT, TERRAIN_GRID_MIN_HEIGHT, TERRAIN_GRID_SIZE, terrainGridOf } from './terrainData.js';

export const HEIGHTMAP_FORMAT = 'marea-negra-heightmap';
export const HEIGHTMAP_VERSION = 1;
/** A side of up to 8,192 pixels and at most 4,097 x 4,097 pixels in all (Unreal's largest Landscape is 8,161 a side). */
export const HEIGHTMAP_MAX_SIDE = 8192;
export const HEIGHTMAP_MAX_PIXELS = 4097 * 4097;
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const SIDECAR_KEY = 'marea-negra:heightmap';
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const fail = code => { throw Object.assign(new TypeError(`Heightmap failed: ${code}`), { code }); };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let n = start; n < end; n++) c = CRC_TABLE[(c ^ bytes[n]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zlib streams (PNG IDAT is a zlib stream: CompressionStream 'deflate' is RFC 1950).
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let n = 0; n < 4; n++) out[4 + n] = type.charCodeAt(n);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
const latin1 = text => Uint8Array.from(text, c => c.charCodeAt(0) & 255);

/**
 * The heights of a compiled map as a 16-bit grayscale PNG and its sidecar. Column i is x = minX + i and row j is
 * z = minZ + j (row 0 is the minZ edge), one pixel per metre. A value maps linearly from min (0) to max (65535),
 * the map's own lowest and highest heights. Returns { png: Uint8Array, sidecar }.
 */
export async function exportHeightmap(map, { baseRevision = null } = {}) {
  let shape;
  try { shape = terrainGridOf(map); } catch { fail('map'); }
  const { minX, minZ, Nx, Nz } = shape, heights = map.heights;
  let min = Infinity, max = -Infinity;
  for (const h of heights) { min = Math.min(min, h); max = Math.max(max, h); }
  if (!(max - min >= .001)) max = min + 1;
  const unit = (max - min) / 65535;
  const sidecar = { format: HEIGHTMAP_FORMAT, version: HEIGHTMAP_VERSION, width: Nx, height: Nz, min, max,
    metresPerUnit: unit, metresPerPixel: map.res ?? 1, origin: { x: minX, z: minZ },
    rows: centeredSquare(shape) ? 'row 0 is z = -half, column 0 is x = -half'
      : 'row 0 is the z = minZ edge, column 0 is the x = minX edge', seed: map.seed ?? null, baseRevision };
  // Scanlines with the Up filter (2): heightmaps change slowly from row to row, so the differences deflate well.
  const stride = Nx * 2, raw = new Uint8Array(Nz * (stride + 1));
  let prior = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let j = 0; j < Nz; j++) {
    for (let i = 0; i < Nx; i++) {
      const value = Math.round((heights[j * Nx + i] - min) / unit);
      row[i * 2] = value >>> 8; row[i * 2 + 1] = value & 255;
    }
    const at = j * (stride + 1);
    raw[at] = 2;
    for (let n = 0; n < stride; n++) raw[at + 1 + n] = (row[n] - prior[n]) & 255;
    [prior, row] = [row, prior];
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, Nx); view.setUint32(4, Nz); header[8] = 16; header[9] = 0;
  const parts = [SIGNATURE, chunk('IHDR', header), chunk('tEXt', latin1(`${SIDECAR_KEY}\0${JSON.stringify(sidecar)}`)),
    chunk('IDAT', await pipe(raw, new CompressionStream('deflate'))), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => { png.set(part, at); return at + part.length; }, 0);
  return { png, sidecar };
}

function checkSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 ||
      width > HEIGHTMAP_MAX_SIDE || height > HEIGHTMAP_MAX_SIDE || width * height > HEIGHTMAP_MAX_PIXELS) fail('size');
}

/** A sidecar's range when it is one of ours: { min, max }, else null. */
export function sidecarRange(sidecar) {
  return sidecar?.format === HEIGHTMAP_FORMAT && Number.isFinite(sidecar.min) && Number.isFinite(sidecar.max) &&
    sidecar.min < sidecar.max ? { min: sidecar.min, max: sidecar.max } : null;
}

async function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat = [];
  let header = null, sidecar = null, at = SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), end = at + 8 + length;
    if (end + 4 > bytes.length) fail('png');
    if (view.getUint32(end) !== crc32(bytes, at + 4, end)) fail('png');
    const data = bytes.subarray(at + 8, end);
    if (type === 'IHDR') {
      header = { width: view.getUint32(at + 8), height: view.getUint32(at + 12), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'tEXt') {
      const zero = data.indexOf(0);
      if (zero > 0 && String.fromCharCode(...data.subarray(0, zero)) === SIDECAR_KEY) {
        try { sidecar = JSON.parse(new TextDecoder('latin1').decode(data.subarray(zero + 1))); } catch { sidecar = null; }
      }
    } else if (type === 'IEND') break;
    at = end + 4;
  }
  // Grayscale, RGB, gray + alpha or RGBA at 8 or 16 bits, not interlaced; colour images give their first channel.
  if (!header || !idat.length || !CHANNELS[header.color] || (header.depth !== 8 && header.depth !== 16) || header.interlace) fail('png_format');
  const { width, height, depth } = header;
  checkSize(width, height);
  const deflated = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  idat.reduce((offset, part) => { deflated.set(part, offset); return offset + part.length; }, 0);
  let raw;
  try { raw = await pipe(deflated, new DecompressionStream('deflate')); } catch { fail('png'); }
  const bpp = CHANNELS[header.color] * depth / 8, stride = width * bpp;
  if (raw.length < height * (stride + 1)) fail('png');
  const values = new Uint16Array(width * height);
  let prior = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let j = 0; j < height; j++) {
    const at = j * (stride + 1), filter = raw[at];
    if (filter > 4) fail('png');
    for (let n = 0; n < stride; n++) {
      const x = raw[at + 1 + n], a = n >= bpp ? row[n - bpp] : 0, b = prior[n], c = n >= bpp ? prior[n - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >>> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[n] = (x + predictor) & 255;
    }
    for (let i = 0; i < width; i++) values[j * width + i] = depth === 16 ? row[i * bpp] << 8 | row[i * bpp + 1] : row[i * bpp] * 257;
    [prior, row] = [row, prior];
  }
  return { kind: 'png', width, height, values, sidecar };
}

/**
 * Read a heightmap file: a PNG (by its signature) or, by its name, an Unreal .r16 / .raw (little-endian 16-bit,
 * square). Returns { kind, width, height, values: Uint16Array (0..65535, row by row), sidecar (ours, or null) }.
 * Fails with a code: format, png, png_format, size, r16_size.
 */
export async function decodeHeightmap(bytes, name = '') {
  if (!(bytes instanceof Uint8Array)) fail('format');
  if (bytes.length >= SIGNATURE.length && SIGNATURE.every((byte, n) => bytes[n] === byte)) return decodePng(bytes);
  if (!/\.(r16|raw)$/i.test(name)) fail('format');
  const side = Math.round(Math.sqrt(bytes.length / 2));
  if (bytes.length % 2 || side * side * 2 !== bytes.length) fail('r16_size');
  checkSize(side, side);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), values = new Uint16Array(side * side);
  for (let n = 0; n < values.length; n++) values[n] = view.getUint16(n * 2, true);
  return { kind: 'r16', width: side, height: side, values, sidecar: null };
}

/**
 * The target heights of an image over the editor grid: 0 maps to min and 65535 to max (metres, from -40 to +200),
 * resampled bilinearly so the image's corners land on the map's corners (a non-square image stretches).
 * Returns a Float64Array of Nx * Nz heights, row 0 at minZ. Fails with 'range' or 'size'.
 */
export function heightmapTargets({ width, height, values } = {}, { min, max } = {},
  { Nx = TERRAIN_GRID_SIZE, Nz = TERRAIN_GRID_SIZE } = {}) {
  checkSize(width, height);
  if (!(values instanceof Uint16Array) || values.length !== width * height) fail('size');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max ||
      min < TERRAIN_GRID_MIN_HEIGHT || max > TERRAIN_GRID_MAX_HEIGHT) fail('range');
  checkSize(Nx, Nz);
  const targets = new Float64Array(Nx * Nz), scale = (max - min) / 65535;
  const sx = (width - 1) / (Nx - 1), sy = (height - 1) / (Nz - 1);
  for (let j = 0; j < Nz; j++) {
    const y = j * sy, y0 = Math.min(Math.floor(y), height - 2), fy = y - y0;
    for (let i = 0; i < Nx; i++) {
      const x = i * sx, x0 = Math.min(Math.floor(x), width - 2), fx = x - x0, k = y0 * width + x0;
      const top = values[k] + (values[k + 1] - values[k]) * fx;
      const bottom = values[k + width] + (values[k + width + 1] - values[k + width]) * fx;
      targets[j * Nx + i] = min + (top + (bottom - top) * fy) * scale;
    }
  }
  return targets;
}
