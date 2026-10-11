#!/usr/bin/env node
// Build resolution-specific WebP derivatives from the preserved raft board-map JPEGs.
// FFmpeg/libwebp is a development tool; the browser bundle receives only the approved derivatives.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const checkOnly = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node tools/prepare-raft-board-material.mjs [--check]');

const sources = {
  albedo: { path: 'materials/raft material.jpg', width: 2048, height: 2048, bytes: 3909415,
    sha256: '95a47597af982b1079b24bf1c7d873b3ef070562d3ea4f968794a4a3fd50c413' },
  normal: { path: 'materials/raft material normal.jpg', width: 2048, height: 2048, bytes: 2882809,
    sha256: '9d32c52e6d39aa7887ed1b16cf4e71eccdf3095ae1f4decd8e65a6a8cb99e044' },
};
const outputs = [
  { role: 'albedo', variant: 'desktop', path: 'assets/textures/raft/wood-boards-v2.webp', width: 1024, quality: 88 },
  { role: 'albedo', variant: 'mobile', path: 'assets/textures/raft/wood-boards-v2-mobile.webp', width: 512, quality: 85 },
  { role: 'normal', variant: 'desktop', path: 'assets/textures/raft/wood-boards-v2-normal.webp', width: 1024 },
  { role: 'normal', variant: 'mobile', path: 'assets/textures/raft/wood-boards-v2-normal-mobile.webp', width: 512 },
];
const receiptPath = 'docs/art/raft-wood-boards-v2.json';
const byteEstimate = (width) => ({ decodedRgbaBytes: width * width * 4,
  decodedRgbaWithFullMipChainBytes: Math.ceil(width * width * 4 * 4 / 3) });

function localPath(relative) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
  return resolved;
}

function run(binary, args, { input, encoding = 'utf8' } = {}) {
  const result = spawnSync(binary, args, { cwd: root, input, encoding, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed (${result.status}): ${(result.stderr || result.stdout || '').toString().trim()}`);
  return result.stdout;
}

function hashFile(file) {
  const data = fs.readFileSync(file);
  return { bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), data };
}

function probe(file) {
  const data = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,pix_fmt,color_space,color_transfer,color_primaries', '-of', 'json', file]));
  const stream = data.streams?.[0];
  if (!stream) throw new Error(`No image stream found: ${file}`);
  return { width: stream.width, height: stream.height, pixelFormat: stream.pix_fmt || null,
    colorSpace: stream.color_space || null, colorTransfer: stream.color_transfer || null,
    colorPrimaries: stream.color_primaries || null };
}

function dimensionsFromWebp(data) {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Output is not WebP');
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4), at = offset + 8;
    if (kind === 'VP8X' && size >= 10) return { width: 1 + data.readUIntLE(at + 4, 3), height: 1 + data.readUIntLE(at + 7, 3) };
    if (kind === 'VP8L' && size >= 5 && data[at] === 0x2f) {
      const bits = data.readUInt32LE(at + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ' && size >= 10 && data[at + 3] === 0x9d && data[at + 4] === 0x01 && data[at + 5] === 0x2a) {
      return { width: data.readUInt16LE(at + 6) & 0x3fff, height: data.readUInt16LE(at + 8) & 0x3fff };
    }
    offset = at + size + (size & 1);
  }
  throw new Error('Could not read dimensions from WebP frame');
}

function inspectSource(role) {
  const expected = sources[role], file = localPath(expected.path), digest = hashFile(file), image = probe(file);
  if (digest.bytes !== expected.bytes || digest.sha256 !== expected.sha256 || image.width !== expected.width || image.height !== expected.height) {
    throw new Error(`${expected.path} changed: ${digest.sha256}, ${digest.bytes} bytes, ${image.width}x${image.height}`);
  }
  return { path: expected.path, width: image.width, height: image.height, bytes: digest.bytes,
    sha256: digest.sha256, pixelFormat: image.pixelFormat, colorSpace: image.colorSpace,
    colorTransfer: image.colorTransfer, colorPrimaries: image.colorPrimaries };
}

function resizeAlbedo(source, spec, output) {
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source,
    '-vf', `scale=${spec.width}:${spec.width}:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp',
    '-quality', String(spec.quality), '-compression_level', '6', '-y', output]);
}

function resizeAndNormalizeNormal(source, width) {
  const pixels = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source,
    '-vf', `format=rgb24,scale=${width}:${width}:flags=lanczos,format=rgb24`,
    '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: null });
  if (pixels.length !== width * width * 3) throw new Error(`Unexpected RGB buffer length at ${width}px`);
  const normalized = Buffer.allocUnsafe(pixels.length);
  for (let i = 0; i < pixels.length; i += 3) {
    let x = pixels[i] / 127.5 - 1, y = pixels[i + 1] / 127.5 - 1, z = pixels[i + 2] / 127.5 - 1;
    const length = Math.hypot(x, y, z);
    if (length < 1e-6) { x = 0; y = 0; z = 1; }
    else { x /= length; y /= length; z /= length; }
    normalized[i] = Math.round((x * 0.5 + 0.5) * 255);
    normalized[i + 1] = Math.round((y * 0.5 + 0.5) * 255);
    normalized[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
  }
  return normalized;
}

function encodeLosslessNormal(rgb, output, width) {
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
    '-video_size', `${width}x${width}`, '-framerate', '1', '-i', 'pipe:0', '-frames:v', '1',
    '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-y', output], { input: rgb });
}

function loadPriorReceipt() {
  const file = localPath(receiptPath);
  if (!fs.existsSync(file)) throw new Error(`${receiptPath} is missing; run generation mode first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const sourceReport = { albedo: inspectSource('albedo'), normal: inspectSource('normal') };
const ffmpegVersion = run(ffmpeg, ['-version']).split(/\r?\n/, 1)[0].trim();
const ffprobeVersion = run(ffprobe, ['-version']).split(/\r?\n/, 1)[0].trim();
if (checkOnly) {
  const prior = loadPriorReceipt();
  if (JSON.stringify(prior.sources) !== JSON.stringify(sourceReport)) throw new Error('Source metadata differs from the receipt.');
  const checked = outputs.map((spec) => {
    const file = localPath(spec.path), digest = hashFile(file), size = dimensionsFromWebp(digest.data);
    const recorded = prior.outputs.find((item) => item.path === spec.path);
    if (size.width !== spec.width || size.height !== spec.width || !recorded ||
        digest.bytes !== recorded.bytes || digest.sha256 !== recorded.sha256) {
      throw new Error(`${spec.path} differs from its recorded dimensions or hash.`);
    }
    return { path: spec.path, width: size.width, height: size.height, bytes: digest.bytes, sha256: digest.sha256, matchesReceipt: true };
  });
  console.log(JSON.stringify({ mode: 'check', sources: sourceReport, outputs: checked,
    tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion } }, null, 2));
} else {
  for (const spec of outputs) {
    const target = localPath(spec.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (spec.role === 'albedo') resizeAlbedo(localPath(sources.albedo.path), spec, target);
    else encodeLosslessNormal(resizeAndNormalizeNormal(localPath(sources.normal.path), spec.width), target, spec.width);
  }
  const outputReport = outputs.map((spec) => {
    const digest = hashFile(localPath(spec.path)), size = dimensionsFromWebp(digest.data);
    if (size.width !== spec.width || size.height !== spec.width) throw new Error(`${spec.path} has unexpected dimensions.`);
    return { path: spec.path, role: spec.role, variant: spec.variant, codec: spec.role === 'normal' ? 'WebP lossless RGB' : 'WebP lossy RGB',
      width: size.width, height: size.height, bytes: digest.bytes, sha256: digest.sha256,
      settings: spec.role === 'normal' ? { resize: 'Lanczos in raw RGB channel values', vector: 'decoded tangent normals renormalized after resize',
        gammaConversion: false, greenChannelSignChanged: false, lossless: true, compressionLevel: 6 }
        : { resize: 'Lanczos', quality: spec.quality, compressionLevel: 6 },
      ...byteEstimate(spec.width) };
  });
  const receipt = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, codec: 'libwebp' }, sources: sourceReport,
    notes: { layout: 'The 2x2 board collage is preserved as supplied; outputs are not seamless tiling textures.',
      normalConvention: 'The source provides no metadata establishing tangent-space green-channel sign; channel signs are preserved without flipping.',
      normalMobileRuntime: 'Mobile normal derivative is prepared for later review; current runtime selection is albedo-only.' },
    outputs: outputReport };
  const receiptFile = localPath(receiptPath);
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'generated', receipt: receiptPath, sources: sourceReport, outputs: outputReport,
    tools: receipt.tools }, null, 2));
}
