// Offline transfer precondition of NS_BasicHit: Unreal SceneColor HDR -> the exact film-color.js Filmic transform
// (the lab LUT's source, no LUT, no GPU) -> 8-bit, against the Unreal FinalColorLDR PNG of the same step and camera.
// Metric of compare-basichit.py's transfer rows (= compare-color.py:28-37): visible union = max channel > 8 on either
// image, absolute 8-bit channel error over the union pixels (3 channels each), MAE = mean, P95 = numpy's default
// (linear) percentile. Thresholds come from docs/delivery/st01c/basichit/render-sources.json, never retyped.
// HDR inputs: the raw little-endian RGBA16F readback (top row first) and the Radiance RGBE export, decoded exactly as
// the lab decodes it (three's RGBELoader, half-float). Every input file is checked against the checkpoint that pins
// the run (or the run's own capture-report "files" list) before use.
// node tools/niagara-native-lab/transfer-basichit.mjs --run <capture run under .scratch/unreal>
// Writes .scratch/basichit-render/transfer-<run>/transfer.json; exit 0 when the gate step passes on every gate camera,
// 1 when it fails (after writing), 2 on a usage or input error.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DataUtils } from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createFilmTransform } from '../../src/render/vfx/niagara/film-color.js';
import { FILM_SOURCE_SHA256 } from '../../src/render/vfx/niagara/film-identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const delivery = path.join(root, 'docs', 'delivery', 'st01c', 'basichit');
const CHECKPOINTS = ['reference-checkpoint.json', 'reference-profiled-checkpoint.json'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { console.error('ERROR ' + message); process.exit(2); };

const args = process.argv.slice(2);
const at = args.indexOf('--run');
const run = at >= 0 ? args[at + 1] : null;
if (!run || !/^[A-Za-z0-9_-]{1,40}$/.test(run) || args.length !== 2) fail('usage: transfer-basichit.mjs --run <capture run name>');
const runDir = path.join(root, '.scratch', 'unreal', run);
if (!fs.existsSync(path.join(runDir, 'capture-report.json'))) fail('capture run not found: ' + runDir);

// Pins: the delivery checkpoint that names this run, else the run's own file list.
function findPins() {
  for (const name of CHECKPOINTS) {
    const file = path.join(delivery, name);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.referenceRun === run && Array.isArray(data.referenceFiles))
      return { by: 'docs/delivery/st01c/basichit/' + name, rows: data.referenceFiles };
    for (const entry of data.runs ?? []) if (entry.name === run && Array.isArray(entry.files))
      return { by: 'docs/delivery/st01c/basichit/' + name, rows: entry.files };
  }
  const report = JSON.parse(fs.readFileSync(path.join(runDir, 'capture-report.json'), 'utf8'));
  if (Array.isArray(report.files)) return { by: `.scratch/unreal/${run}/capture-report.json files (not a delivery checkpoint)`, rows: report.files, self: true };
  fail('no checkpoint or file list pins ' + run);
}
const pins = findPins();
const pinMap = new Map(pins.rows.map(r => [r.file, r.sha256]));
const inputs = [];
function pinned(file) {
  const bytes = fs.readFileSync(path.join(runDir, file)), digest = sha(bytes);
  // A run's own file list cannot pin the report that holds it: that one file is read unpinned.
  if (pins.self && file === 'capture-report.json') { inputs.push({ file, sha256: digest, pinned: false }); return bytes; }
  if (!pinMap.has(file)) fail('unpinned run file: ' + file);
  if (digest !== pinMap.get(file)) fail(`hash mismatch: ${file} ${digest} (pinned ${pinMap.get(file)})`);
  inputs.push({ file, sha256: digest, pinned: true });
  return bytes;
}

// PNG: 8-bit RGB or RGBA, not interlaced; returns RGB bytes, top row first (Pillow's convert('RGB') drops alpha).
function decodePng(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8, width, height, depth, type, interlace; const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    offset += 12 + length;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || !channels || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels;
  const pixels = new Uint8Array(height * stride), rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride, prev = out - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0, b = y ? pixels[prev + x] : 0;
      const c = x >= channels && y ? pixels[prev + x - channels] : 0;
      let p;
      if (filter === 0) p = 0; else if (filter === 1) p = a; else if (filter === 2) p = b; else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw new Error('bad PNG filter ' + filter);
      pixels[out + x] = (line[x] + p) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = pixels[i * channels + k];
  return { width, height, rgb };
}

// HDR as Uint16 half floats RGBA, top row first.
function decodeRaw(bytes, width, height) {
  if (bytes.length !== width * height * 8) throw new Error(`raw size ${bytes.length}, expected ${width * height * 8}`);
  const half = new Uint16Array(width * height * 4);
  for (let i = 0; i < half.length; i++) half[i] = bytes.readUInt16LE(i * 2);
  return half;
}
function decodeRgbe(bytes) {
  const loader = new RGBELoader(); // default type HalfFloatType, as basichit-lab.js uses it
  const image = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  return { width: image.width, height: image.height, half: image.data };
}

const filmBytes = fs.readFileSync(path.join(here, '../../src/render/vfx/niagara/film-source.json'));
if (sha(filmBytes) !== FILM_SOURCE_SHA256) fail('film-source.json hash mismatch');
const film = createFilmTransform(JSON.parse(filmBytes));
const MAXH = 65504;
const toByte = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
// The shader takes max(0, hdr * exposure) with exposure 1; encode() also needs finite values <= 65504.
const linearOf = h => { const v = DataUtils.fromHalfFloat(h); return Number.isNaN(v) ? 0 : Math.min(MAXH, Math.max(0, v)); };
function transfer(half, count) {
  const out = new Uint8Array(count * 3), cache = new Map();
  for (let i = 0; i < count; i++) {
    const r = half[i * 4], g = half[i * 4 + 1], b = half[i * 4 + 2], key = r * 4294967296 + g * 65536 + b;
    let bytes = cache.get(key);
    if (!bytes) { bytes = film.encode([linearOf(r), linearOf(g), linearOf(b)]).map(toByte); cache.set(key, bytes); }
    out[i * 3] = bytes[0]; out[i * 3 + 1] = bytes[1]; out[i * 3 + 2] = bytes[2];
  }
  return out;
}

// compare-basichit.py metrics(): union of max channel > 8, |a - t| over the union, mean and numpy linear P95.
function metrics(ue, lab, width, height) {
  const histogram = new Float64Array(256); let n = 0, sum = 0, max = 0, union = 0;
  const signed = [0, 0, 0], bands = [[0, 0], [0, 0], [0, 0], [0, 0]];
  let wx = 0, wy = 0, wsum = 0, over = 0, box = null;
  for (let i = 0; i < width * height; i++) {
    const p = i * 3, ma = Math.max(ue[p], ue[p + 1], ue[p + 2]), mb = Math.max(lab[p], lab[p + 1], lab[p + 2]);
    if (!(ma > 8 || mb > 8)) continue;
    union++; let pixelError = 0, pixelMax = 0;
    for (let k = 0; k < 3; k++) {
      const d = lab[p + k] - ue[p + k], e = Math.abs(d);
      histogram[e]++; n++; sum += e; max = Math.max(max, e); signed[k] += d; pixelError += e; pixelMax = Math.max(pixelMax, e);
    }
    const band = bands[Math.min(3, ma >> 6)]; band[0]++; band[1] += pixelError / 3;
    const x = i % width, y = Math.floor(i / width);
    wx += x * pixelError; wy += y * pixelError; wsum += pixelError;
    if (pixelMax > 4) { over++; box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y]; }
  }
  const at = rank => { let seen = 0; for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen > rank) return v; } return 255; };
  let p95 = 0;
  if (n) { const k = (n - 1) * 0.95, lo = Math.floor(k), a = at(lo), b = at(Math.min(n - 1, lo + 1)); p95 = a + (b - a) * (k - lo); }
  return { mae255: n ? sum / n : 0, p95ChannelError255: p95, maxChannelError255: max, unionPixels: union,
    meanSignedError255: { r: union ? signed[0] / union : 0, g: union ? signed[1] / union : 0, b: union ? signed[2] / union : 0 },
    errorCentroidPx: wsum ? [wx / wsum, wy / wsum] : null, pixelsOver4: over, boxOver4Px: box,
    maeByUeBrightness: bands.map((b, i) => ({ ueMaxChannel: `${i * 64}-${i * 64 + 63}`, pixels: b[0], mae255: b[0] ? b[1] / b[0] : null })) };
}

const sourcesBytes = fs.readFileSync(path.join(delivery, 'render-sources.json'));
const thresholds = JSON.parse(sourcesBytes).thresholds, gate = thresholds.transferPrecondition, size = thresholds.resolutionPx;
const report = JSON.parse(pinned('capture-report.json'));
const order = ['front', 'oblique', 'side'];
const rows = [...report.images].sort((a, b) => a.step - b.step || order.indexOf(a.camera) - order.indexOf(b.camera));
const results = [];
for (const row of rows) {
  const candidates = [];
  if (row.hdr_raw) candidates.push({ kind: 'rgba16f', file: row.hdr_raw.file });
  if (row.linear) candidates.push({ kind: 'rgbe', file: row.linear.file });
  if (!candidates.length) continue;
  const ue = decodePng(pinned(row.file));
  if (ue.width !== size || ue.height !== size) fail(`${row.file}: ${ue.width}x${ue.height}, expected ${size}x${size} (no resampling)`);
  candidates.forEach((source, index) => {
    const bytes = pinned(source.file);
    const hdr = source.kind === 'rgba16f' ? { width: size, height: size, half: decodeRaw(bytes, size, size) } : decodeRgbe(bytes);
    if (hdr.width !== size || hdr.height !== size) fail(`${source.file}: ${hdr.width}x${hdr.height}, expected ${size}x${size}`);
    const m = metrics(ue.rgb, transfer(hdr.half, size * size), size, size);
    const isGate = index === 0 && row.step === gate.step && gate.cameras.includes(row.camera);
    results.push({ step: row.step, camera: row.camera, source: source.kind, primary: index === 0, ue: row.file, ueHdr: source.file, ...m,
      gate: isGate, accepted: isGate ? m.mae255 <= gate.transferMae255Max && m.p95ChannelError255 <= gate.transferP95ChannelError255Max : null });
  });
}
const gateRows = results.filter(r => r.gate);
if (gateRows.length !== gate.cameras.length) fail(`gate step ${gate.step} needs an HDR for ${gate.cameras.join(', ')}; found ${gateRows.length}`);
const pass = gateRows.every(r => r.accepted);
const outDir = path.join(root, '.scratch', 'basichit-render', 'transfer-' + run);
fs.mkdirSync(outDir, { recursive: true });
const result = { schema: 'st01c-basichit-transfer/v1', run, pinnedBy: pins.by,
  chain: 'Unreal SceneColor HDR -> max(0, x) -> film-color.js createFilmTransform().encode (exact, no LUT) -> round(clamp01 * 255)',
  metric: 'compare-basichit.py transfer rows = compare-color.py:28-37: union = max channel > 8 on either image; |UE LDR - transfer| over union pixels x 3 channels; MAE mean; P95 numpy linear percentile',
  filmSourceSha256: FILM_SOURCE_SHA256,
  thresholds: { source: 'docs/delivery/st01c/basichit/render-sources.json', sha256: sha(sourcesBytes), transferPrecondition: gate, resolutionPx: size },
  rows: results, gateStep: gate.step, gatePass: pass, inputs };
fs.writeFileSync(path.join(outDir, 'transfer.json'), JSON.stringify(result, null, 2) + '\n');

const f = (v, d = 2) => v.toFixed(d);
console.log(`run ${run} (pins: ${pins.by})`);
console.log('step camera  source   MAE/255  P95/255  max  union px  mean signed R/G/B      gate');
for (const r of results) {
  const s = r.meanSignedError255;
  console.log(`${String(r.step).padStart(4)} ${r.camera.padEnd(7)} ${r.source.padEnd(7)} ${f(r.mae255, 3).padStart(8)} ${f(r.p95ChannelError255).padStart(8)} ${String(r.maxChannelError255).padStart(4)} ${String(r.unionPixels).padStart(9)}  ${[s.r, s.g, s.b].map(v => f(v).padStart(6)).join(' ')}  ${r.gate ? (r.accepted ? 'PASS' : 'FAIL') : '-'}`);
}
for (const r of gateRows)
  console.log(`step ${r.step} ${r.camera} ${r.accepted ? 'PASS' : 'FAIL'}: MAE ${f(r.mae255, 3)} <= ${gate.transferMae255Max}, P95 ${f(r.p95ChannelError255)} <= ${gate.transferP95ChannelError255Max} (${r.source})`);
console.log(`RESULT ${pass ? 'PASS' : 'FAIL'} -> ${path.relative(root, path.join(outDir, 'transfer.json')).replaceAll('\\', '/')}`);
process.exit(pass ? 0 : 1);
