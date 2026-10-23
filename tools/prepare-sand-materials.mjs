#!/usr/bin/env node
// Preserve the supplied sand bitmaps and produce auditable, device-sized WebP derivatives.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [
  { id: 'dry-albedo', file: 'Textura de arena dorada con guijarros y conchas.png', kind: 'albedo' },
  { id: 'dry-normal', file: 'Textura ormal de arena dorada con guijarros y conchas.png', kind: 'normal' },
  { id: 'wet-albedo', file: 'Textura de arena dorada con guijarros y conchas mojada.png', kind: 'albedo' },
  { id: 'ripple-albedo', file: 'Textura de arena dorada estilizada.png', kind: 'albedo' },
  { id: 'ripple-normal', file: 'Mapa normal de arena ondulada.png', kind: 'normal' },
  { id: 'footprints-albedo', file: 'Textura de arena con huellas y conchas.png', kind: 'albedo' },
  { id: 'footprints-normal', file: 'Textura normal de arena con huellas y conchas.png', kind: 'normal' },
  { id: 'shore-albedo', file: 'Orilla Turquesa de Arena Dorada shoreline.png', kind: 'albedo' },
  { id: 'shore-normal', file: 'Orilla Turquesa de Arena Dorada shoreline mapa normal .png', kind: 'normal' },
];
const CROPS = {
  'shore-sand-albedo': { x: 0, y: 742, width: 512, height: 512, note: 'bottom-left sand-only sample; painted water excluded' },
  'shore-sand-normal': { x: 0, y: 742, width: 512, height: 512, note: 'matching bottom-left sand-only sample; painted water excluded' },
};
const COPY_DIR = 'docs/art/source/sand-family-v1';
const ASSET_DIR = 'assets/textures/sand-family-v1';
const RECEIPT = 'docs/art/sand/sand-family-v1-receipt.json';
const checkOnly = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs.join(' ')}`);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function probe(file) {
  const data = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,color_space,color_transfer,color_primaries', '-of', 'json', file]));
  const stream = data.streams?.[0];
  if (!stream) throw new Error(`No image stream in ${file}`);
  return { width: stream.width, height: stream.height, pixelFormat: stream.pix_fmt, colorSpace: stream.color_space ?? null, transfer: stream.color_transfer ?? null, primaries: stream.color_primaries ?? null };
}
function readReceipt() {
  const file = path.join(ROOT, RECEIPT);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
function fail(message) { throw new Error(message); }

const oldReceipt = readReceipt();
const sourceMetadata = [];
for (const source of SOURCES) {
  const originalPath = path.join(ROOT, 'materials', source.file);
  if (!fs.existsSync(originalPath)) fail(`Missing original: ${path.relative(ROOT, originalPath)}`);
  const info = probe(originalPath);
  if (info.width !== 1254 || info.height !== 1254) fail(`${source.file} is ${info.width}x${info.height}, expected 1254x1254`);
  const hash = sha256(originalPath);
  const record = { ...source, originalPath: `materials/${source.file}`, sha256: hash, byteLength: fs.statSync(originalPath).size, dimensions: { width: info.width, height: info.height }, pixelFormat: info.pixelFormat, sourceColorMetadata: { colorSpace: info.colorSpace, transfer: info.transfer, primaries: info.primaries } };
  sourceMetadata.push(record);
  const copyPath = path.join(ROOT, COPY_DIR, `${source.id}.png`);
  if (fs.existsSync(copyPath) && sha256(copyPath) !== hash) fail(`Refusing to overwrite differing source copy: ${path.relative(ROOT, copyPath)}`);
  if (oldReceipt) {
    const prior = oldReceipt.sources?.find((item) => item.id === source.id);
    if (!prior || prior.sha256 !== hash) fail(`Original source changed since receipt: ${source.file}`);
  }
}

const specs = [];
const sourceFor = new Map(SOURCES.map((source) => [source.id, source]));
function addDerivatives(sourceId, stem = sourceId, crop = null) {
  const source = sourceFor.get(sourceId);
  for (const [label, size, quality] of [['desktop', 1024, source.kind === 'albedo' ? 85 : null], ['mobile', 512, source.kind === 'albedo' ? 82 : null]]) {
    specs.push({
      id: `${stem}-${label}`, sourceId, file: `${stem}-${label}.webp`, size, quality, crop,
      kind: source.kind,
    });
  }
}
addDerivatives('dry-albedo');
addDerivatives('dry-normal');
addDerivatives('wet-albedo');
addDerivatives('ripple-albedo');
addDerivatives('ripple-normal');
addDerivatives('footprints-albedo');
addDerivatives('footprints-normal');
addDerivatives('shore-albedo', 'shore-sand-albedo', CROPS['shore-sand-albedo']);
addDerivatives('shore-normal', 'shore-sand-normal', CROPS['shore-sand-normal']);

const tempBase = path.resolve(os.tmpdir());
const tempDir = fs.mkdtempSync(path.join(tempBase, 'sand-family-v1-'));
try {
  const derivativeRecords = [];
  for (const spec of specs) {
    const source = sourceFor.get(spec.sourceId);
    const input = path.join(ROOT, 'materials', source.file);
    const tempOutput = path.join(tempDir, spec.file);
    const cropFilter = spec.crop ? `crop=${spec.crop.width}:${spec.crop.height}:${spec.crop.x}:${spec.crop.y},` : '';
    const filter = `${cropFilter}scale=${spec.size}:${spec.size}:flags=lanczos+accurate_rnd+full_chroma_int`;
    const args = ['-v', 'error', '-y', '-i', input, '-vf', filter, '-frames:v', '1', '-an'];
    if (spec.kind === 'normal') args.push('-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-pix_fmt', 'rgb24');
    else args.push('-c:v', 'libwebp', '-lossless', '0', '-q:v', String(spec.quality), '-compression_level', '6', '-pix_fmt', 'rgb24');
    args.push(tempOutput);
    run('ffmpeg', args);
    const dimensions = probe(tempOutput);
    if (dimensions.width !== spec.size || dimensions.height !== spec.size) fail(`${spec.file} encoded at unexpected dimensions ${dimensions.width}x${dimensions.height}`);
    derivativeRecords.push({
      id: spec.id,
      path: `${ASSET_DIR}/${spec.file}`,
      sourceId: spec.sourceId,
      dimensions: { width: dimensions.width, height: dimensions.height },
      byteLength: fs.statSync(tempOutput).size,
      sha256: sha256(tempOutput),
      crop: spec.crop,
      colorSpace: spec.kind === 'normal'
        ? { meaning: 'linear normal-map data', processing: 'RGB channels resampled independently with Lanczos; no color or transfer-function transform', webp: 'lossless' }
        : { meaning: 'albedo color', processing: 'source RGB resampled with Lanczos; no explicit color or transfer-function transform', sourceProfile: 'none reported by ffprobe' },
      encoding: spec.kind === 'normal'
        ? { format: 'WebP', lossless: true, quality: null, compressionLevel: 6 }
        : { format: 'WebP', lossless: false, quality: spec.quality, compressionLevel: 6 },
      pixelFormat: dimensions.pixelFormat,
    });
  }

  const receipt = {
    schemaVersion: 1,
    family: 'sand-family-v1',
    generatedAt: new Date().toISOString(),
    generator: { script: 'tools/prepare-sand-materials.mjs', ffmpeg: run('ffmpeg', ['-version']).split('\n')[0], ffprobe: run('ffprobe', ['-version']).split('\n')[0], resampler: 'Lanczos with accurate rounding; no explicit colorspace conversion' },
    sourceCopies: sourceMetadata.map((source) => ({ id: source.id, originalPath: source.originalPath, path: `${COPY_DIR}/${source.id}.png`, sha256: source.sha256, byteLength: source.byteLength, dimensions: source.dimensions })),
    sources: sourceMetadata,
    derivatives: derivativeRecords,
    pairs: [
      { id: 'dry', albedo: ['dry-albedo-desktop', 'dry-albedo-mobile'], normal: ['dry-normal-desktop', 'dry-normal-mobile'] },
      { id: 'wet', albedo: ['wet-albedo-desktop', 'wet-albedo-mobile'], normal: ['dry-normal-desktop', 'dry-normal-mobile'], normalSharedWith: 'dry' },
      { id: 'ripple', albedo: ['ripple-albedo-desktop', 'ripple-albedo-mobile'], normal: ['ripple-normal-desktop', 'ripple-normal-mobile'] },
      { id: 'footprints', albedo: ['footprints-albedo-desktop', 'footprints-albedo-mobile'], normal: ['footprints-normal-desktop', 'footprints-normal-mobile'] },
      { id: 'shore-sand', albedo: ['shore-sand-albedo-desktop', 'shore-sand-albedo-mobile'], normal: ['shore-sand-normal-desktop', 'shore-sand-normal-mobile'], sourceFilesPreservedFull: ['shore-albedo', 'shore-normal'], note: 'Cropped sand material sample only; the full painted shoreline bitmap is not a repeating sand material.' },
    ],
  };

  if (checkOnly) {
    if (!oldReceipt) fail(`Missing receipt: ${RECEIPT}`);
    for (const source of sourceMetadata) {
      const copyPath = path.join(ROOT, COPY_DIR, `${source.id}.png`);
      if (!fs.existsSync(copyPath) || sha256(copyPath) !== source.sha256 || fs.statSync(copyPath).size !== source.byteLength) fail(`Source copy mismatch: ${path.relative(ROOT, copyPath)}`);
    }
    for (const derivative of derivativeRecords) {
      const target = path.join(ROOT, derivative.path);
      if (!fs.existsSync(target)) fail(`Missing derivative: ${derivative.path}`);
      const actualProbe = probe(target);
      if (sha256(target) !== derivative.sha256 || fs.statSync(target).size !== derivative.byteLength || actualProbe.width !== derivative.dimensions.width || actualProbe.height !== derivative.dimensions.height) fail(`Derivative mismatch: ${derivative.path}`);
    }
    const comparable = (value) => JSON.stringify(value);
    if (comparable(oldReceipt.sources) !== comparable(receipt.sources) || comparable(oldReceipt.sourceCopies) !== comparable(receipt.sourceCopies) || comparable(oldReceipt.derivatives) !== comparable(receipt.derivatives) || comparable(oldReceipt.pairs) !== comparable(receipt.pairs)) fail('Receipt metadata does not match the files or current recipe');
    console.log(`sand-family-v1 check OK: ${sourceMetadata.length} sources, ${derivativeRecords.length} derivatives, ${receipt.pairs.length} pairs`);
  } else {
    for (const derivative of derivativeRecords) {
      const target = path.join(ROOT, derivative.path);
      if (fs.existsSync(target)) {
        const prior = oldReceipt?.derivatives?.find((item) => item.path === derivative.path);
        if (!prior || sha256(target) !== prior.sha256) fail(`Refusing to overwrite unreceipted or differing derivative: ${derivative.path}`);
      }
    }
    for (const source of sourceMetadata) {
      const copyPath = path.join(ROOT, COPY_DIR, `${source.id}.png`);
      fs.mkdirSync(path.dirname(copyPath), { recursive: true });
      if (!fs.existsSync(copyPath)) fs.copyFileSync(path.join(ROOT, source.originalPath), copyPath, fs.constants.COPYFILE_EXCL);
    }
    for (let index = 0; index < derivativeRecords.length; index += 1) {
      const derivative = derivativeRecords[index];
      const target = path.join(ROOT, derivative.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(tempDir, path.basename(derivative.path)), target);
    }
    const receiptPath = path.join(ROOT, RECEIPT);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`sand-family-v1 generated: ${sourceMetadata.length} exact source copies, ${derivativeRecords.length} derivatives, ${receipt.pairs.length} pairs`);
  }
} finally {
  if (path.dirname(path.resolve(tempDir)) !== tempBase || !path.basename(tempDir).startsWith('sand-family-v1-')) throw new Error('Unsafe temporary cleanup target');
  fs.rmSync(tempDir, { recursive: true, force: true });
}
