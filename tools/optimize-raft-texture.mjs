#!/usr/bin/env node
// Rebuild the checked-in raft comic atlas variants from the preserved PNG source.
// FFmpeg is an external development tool; this script adds no runtime dependency.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRel = 'docs/art/source/raft-comic-v1.png';
const receiptRel = 'docs/art/raft-comic-optimization.json';
const sourceExpected = {
  sha256: 'fd06e39b63e3a96b23e33d335facb6ed1d2d197b0552af74145b66ae7be8753e',
  bytes: 3032353,
  width: 1254,
  height: 1254,
};
const variants = [
  { path: 'assets/textures/raft/comic-materials-v1.webp', width: 1024, quality: 85, expectedBytes: 308536, expectedSha256: '8fd911b1f4c3e64d8a2a2f812c9b85cc82b86c9d562f71eeb8447e6204fa3a54' },
  { path: 'assets/textures/raft/comic-materials-v1-mobile.webp', width: 512, quality: 82, expectedBytes: 82878, expectedSha256: '464486d6ff3f108b6c9e0593bbb95dc9697fa1ac8907afa1225f1909cae6f719' },
];
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const checkOnly = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  throw new Error('Usage: node tools/optimize-raft-texture.mjs [--check]');
}

function localPath(relative) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
  return resolved;
}

function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(binary)} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout || '';
}

function hashFile(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), data: bytes };
}

function pngDimensions(data) {
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') throw new Error('Source is not a valid PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function webpDimensions(data) {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Output is not a valid WebP');
  }
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const p = offset + 8;
    if (kind === 'VP8X' && size >= 10) {
      return { width: 1 + data.readUIntLE(p + 4, 3), height: 1 + data.readUIntLE(p + 7, 3) };
    }
    if (kind === 'VP8L' && size >= 5 && data[p] === 0x2f) {
      const bits = data.readUInt32LE(p + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ' && size >= 10 && data[p + 3] === 0x9d && data[p + 4] === 0x01 && data[p + 5] === 0x2a) {
      return { width: data.readUInt16LE(p + 6) & 0x3fff, height: data.readUInt16LE(p + 8) & 0x3fff };
    }
    offset = p + size + (size & 1);
  }
  throw new Error('Could not read dimensions from WebP frame');
}

const sourceFile = localPath(sourceRel);
const source = hashFile(sourceFile);
const sourceSize = pngDimensions(source.data);
if (source.sha256 !== sourceExpected.sha256 || source.bytes !== sourceExpected.bytes ||
    sourceSize.width !== sourceExpected.width || sourceSize.height !== sourceExpected.height) {
  throw new Error(`PNG source changed unexpectedly: ${source.sha256}, ${source.bytes} bytes, ${sourceSize.width}x${sourceSize.height}`);
}
const priorReceiptFile = localPath(receiptRel);
let priorReceipt = null;
if (checkOnly && fs.existsSync(priorReceiptFile)) {
  try { priorReceipt = JSON.parse(fs.readFileSync(priorReceiptFile, 'utf8')); }
  catch { throw new Error(`${receiptRel} is not valid JSON; run generation mode to refresh it.`); }
}
const toolMetadata = checkOnly
  ? (priorReceipt?.tool || { name: 'FFmpeg', version: 'not queried in check mode', path: ffmpeg })
  : { name: 'FFmpeg', version: run(ffmpeg, ['-version']).split(/\r?\n/, 1)[0].trim(), path: ffmpeg };
const outputs = [];
for (const variant of variants) {
  const outputFile = localPath(variant.path);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  if (!checkOnly) {
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', sourceFile,
      '-vf', `scale=${variant.width}:${variant.width}:flags=lanczos`,
      '-c:v', 'libwebp', '-quality', String(variant.quality), '-compression_level', '6',
      '-frames:v', '1', '-y', outputFile,
    ]);
  }
  const output = hashFile(outputFile);
  const dimensions = webpDimensions(output.data);
  if (dimensions.width !== variant.width || dimensions.height !== variant.width) {
    throw new Error(`${variant.path} has unexpected dimensions ${dimensions.width}x${dimensions.height}`);
  }
  outputs.push({
    path: variant.path,
    codec: 'WebP lossy (libwebp)',
    width: dimensions.width,
    height: dimensions.height,
    bytes: output.bytes,
    sha256: output.sha256,
    settings: { scale: `${variant.width}x${variant.width}`, filter: 'Lanczos', quality: variant.quality, compressionLevel: 6 },
    estimatedDecodedRgbaBytes: dimensions.width * dimensions.height * 4,
    estimatedDecodedRgbaWithFullMipChainBytes: Math.ceil(dimensions.width * dimensions.height * 4 * 4 / 3),
    estimateNote: 'Decoded RGBA and full-mip-chain byte estimates only; not measured VRAM or performance.',
    matchesApprovedByteSize: output.bytes === variant.expectedBytes,
    matchesApprovedSha256: output.sha256 === variant.expectedSha256,
  });
}

const receipt = {
  schemaVersion: 1,
  generatedAt: (checkOnly && priorReceipt?.generatedAt) || new Date().toISOString(),
  tool: toolMetadata,
  source: { path: sourceRel, codec: 'PNG', width: sourceSize.width, height: sourceSize.height, bytes: source.bytes, sha256: source.sha256 },
  outputs,
};
if (!checkOnly) fs.writeFileSync(localPath(receiptRel), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'generated', receiptPath: receiptRel, ...receipt }, null, 2));
if (outputs.some((output) => !output.matchesApprovedByteSize || !output.matchesApprovedSha256)) {
  throw new Error('A WebP differs from the approved size or SHA-256; review before adoption.');
}
