#!/usr/bin/env node
// Preserve the supplied ground maps and build auditable previews plus compact runtime atlases.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY_DIR = 'docs/art/source/ground-family-v1';
const PREVIEW_DIR = 'docs/art/ground/ground-family-v1';
const ASSET_DIR = 'assets/textures/ground-family-v1';
const RECEIPT = 'docs/art/ground/ground-family-v1-receipt.json';
const PAIRS = [
  { id: 'sand-grass', albedo: 'Transición de arena y pastizal pintada.png', normal: 'Mapa normal de transición arena y hierba.png' },
  { id: 'sand-dirt', albedo: 'Textura de Arena y Tierra Compactada.png', normal: 'Mapa normal de arena y tierra pedregosa.png' },
  { id: 'grass', albedo: 'Textura de hierba tropical estilizada.png', normal: 'Textura normal de césped y tierra.png' },
  { id: 'dirt', albedo: 'Textura de tierra seca con piedras y conchas.png', normal: 'Textura normal de tierra agrietada con guijarros.png' },
];
const LAYOUT = [
  { id: 'sand-grass', x: 0, y: 0, origin: [0, 0], offset: [0, 0.5] },
  { id: 'sand-dirt', x: 1, y: 0, origin: [1024, 0], offset: [0.5, 0.5] },
  { id: 'grass', x: 0, y: 1, origin: [0, 1024], offset: [0, 0] },
  { id: 'dirt', x: 1, y: 1, origin: [1024, 1024], offset: [0.5, 0] },
].map((tile) => ({ ...tile, glslUv: { offset: tile.offset, inset: [1 / 64, 1 / 64], span: [15 / 32, 15 / 32] } }));
const checkOnly = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error(`Unknown argument: ${process.argv.slice(2).filter((arg) => arg !== '--check').join(' ')}`);

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function fail(message) { throw new Error(message); }
function imageInfo(file) {
  const data = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', file]));
  const stream = data.streams?.[0];
  if (!stream) fail(`No image stream: ${file}`);
  return { width: stream.width, height: stream.height, pixelFormat: stream.pix_fmt };
}
const receiptPath = path.join(ROOT, RECEIPT);
const oldReceipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
const sources = [];
for (const pair of PAIRS) for (const kind of ['albedo', 'normal']) {
  const file = pair[kind];
  const original = path.join(ROOT, 'materials', file);
  if (!fs.existsSync(original)) fail(`Missing original: materials/${file}`);
  const info = imageInfo(original);
  if (info.width !== 1254 || info.height !== 1254) fail(`${file} is ${info.width}x${info.height}, expected 1254x1254`);
  const source = { id: `${pair.id}-${kind}`, pairId: pair.id, kind, file, originalPath: `materials/${file}`, path: `${COPY_DIR}/${pair.id}-${kind}.png`, sha256: sha256(original), byteLength: fs.statSync(original).size, dimensions: { width: info.width, height: info.height }, pixelFormat: info.pixelFormat };
  const copyPath = path.join(ROOT, source.path);
  if (fs.existsSync(copyPath) && sha256(copyPath) !== source.sha256) fail(`Refusing to overwrite differing source copy: ${source.path}`);
  if (oldReceipt) {
    const prior = oldReceipt.sources?.find((item) => item.id === source.id);
    if (!prior || prior.sha256 !== source.sha256) fail(`Source differs from existing receipt: ${file}`);
  }
  sources.push(source);
}

const PY = String.raw`from PIL import Image
import sys
src_root, work_root = sys.argv[1], sys.argv[2]
specs = [tuple(x.split('|')) for x in sys.argv[3:]]
names = {
 'sand-grass-albedo':'Transición de arena y pastizal pintada.png', 'sand-grass-normal':'Mapa normal de transición arena y hierba.png',
 'sand-dirt-albedo':'Textura de Arena y Tierra Compactada.png', 'sand-dirt-normal':'Mapa normal de arena y tierra pedregosa.png',
 'grass-albedo':'Textura de hierba tropical estilizada.png', 'grass-normal':'Textura normal de césped y tierra.png',
 'dirt-albedo':'Textura de tierra seca con piedras y conchas.png', 'dirt-normal':'Textura normal de tierra agrietada con guijarros.png'}
order = ['sand-grass','sand-dirt','grass','dirt']
for kind, device, size, content, gutter, output, quality in specs:
    size, content, gutter, quality = int(size), int(content), int(gutter), int(quality)
    if kind == 'preview':
        pair_id, channel = device.split(':')
        im = Image.open(src_root + '/' + names[pair_id + '-' + channel]).convert('RGB')
        im = im.resize((size,size), Image.Resampling.LANCZOS)
        im.save(work_root + '/' + output, 'WEBP', quality=quality if channel == 'albedo' else 100, lossless=(channel == 'normal'), method=6)
    else:
        atlas = Image.new('RGB', (size*2,size*2))
        for i, pair_id in enumerate(order):
            im = Image.open(src_root + '/' + names[pair_id + '-' + kind]).convert('RGB')
            im = im.resize((content,content), Image.Resampling.LANCZOS)
            tile = Image.new('RGB',(size,size))
            tile.paste(im,(gutter,gutter))
            # Extend each edge pixel through the gutter so bilinear filtering stays inside its material.
            tile.paste(im.crop((0,0,content,1)).resize((content,gutter)),(gutter,0))
            tile.paste(im.crop((0,content-1,content,content)).resize((content,gutter)),(gutter,gutter+content))
            tile.paste(im.crop((0,0,1,content)).resize((gutter,content)),(0,gutter))
            tile.paste(im.crop((content-1,0,content,content)).resize((gutter,content)),(gutter+content,gutter))
            tile.paste(im.getpixel((0,0)),(0,0,gutter,gutter))
            tile.paste(im.getpixel((content-1,0)),(gutter+content,0,size,gutter))
            tile.paste(im.getpixel((0,content-1)),(0,gutter+content,gutter,size))
            tile.paste(im.getpixel((content-1,content-1)),(gutter+content,gutter+content,size,size))
            atlas.paste(tile,((i%2)*size,(i//2)*size))
        atlas.save(work_root + '/' + output, 'WEBP', quality=quality if kind == 'albedo' else 100, lossless=(kind == 'normal'), method=6)
`;
const specs = [];
for (const pair of PAIRS) for (const channel of ['albedo', 'normal']) for (const [device, size, quality] of [['desktop', 1024, channel === 'albedo' ? 85 : 100], ['mobile', 512, channel === 'albedo' ? 82 : 100]]) {
  specs.push({ id: `${pair.id}-${channel}-${device}`, type: 'preview', pairId: pair.id, channel, device, size, quality, path: `${PREVIEW_DIR}/${pair.id}-${channel}-${device}.webp` });
}
for (const channel of ['albedo', 'normal']) for (const [device, size, content, gutter, quality] of [['desktop', 1024, 960, 32, channel === 'albedo' ? 85 : 100], ['mobile', 512, 480, 16, channel === 'albedo' ? 82 : 100]]) {
  specs.push({ id: `atlas-${channel}-${device}`, type: 'atlas', channel, device, size: size * 2, tileSize: size, contentSize: content, gutter, quality, path: `${ASSET_DIR}/atlas-${channel}-${device}.webp` });
}
if (checkOnly) {
  if (!oldReceipt) fail(`Missing receipt: ${RECEIPT}`);
  if (JSON.stringify(oldReceipt.sources) !== JSON.stringify(sources)) fail('Receipt source metadata does not match the supplied originals');
  for (const source of sources) {
    const target = path.join(ROOT, source.path);
    if (!fs.existsSync(target) || sha256(target) !== source.sha256 || fs.statSync(target).size !== source.byteLength) fail(`Source copy mismatch: ${source.path}`);
  }
  for (const spec of specs) {
    const list = spec.type === 'preview' ? oldReceipt.previews : oldReceipt.runtimeAtlases;
    const recorded = list?.find((item) => item.id === spec.id);
    const target = path.join(ROOT, spec.path);
    if (!recorded || recorded.path !== spec.path || !fs.existsSync(target) || sha256(target) !== recorded.sha256 || fs.statSync(target).size !== recorded.byteLength) fail(`Derivative mismatch: ${spec.path}`);
    const actual = imageInfo(target);
    const expectedSize = spec.size;
    if (actual.width !== expectedSize || actual.height !== expectedSize || recorded.dimensions?.width !== expectedSize || recorded.dimensions?.height !== expectedSize) fail(`Dimensions mismatch: ${spec.path}`);
  }
  const expectedRuntime = oldReceipt.runtimeAtlases.reduce((sum, item) => sum + item.byteLength, 0);
  if (oldReceipt.aggregateRuntimeBytes !== expectedRuntime) fail('Aggregate runtime byte count mismatch');
  console.log(`ground-family-v1 check OK: ${sources.length} sources, ${oldReceipt.previews.length} previews, ${oldReceipt.runtimeAtlases.length} runtime atlases; ${expectedRuntime} runtime bytes`);
  process.exit(0);
}
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ground-family-v1-'));
try {
  const args = ["-c", PY, path.join(ROOT, 'materials'), tempDir, ...specs.map((s) => s.type === 'preview'
    ? `preview|${s.pairId}:${s.channel}|${s.size}|${s.size}|0|${path.basename(s.path)}|${s.quality}`
    : `${s.channel}|${s.device}|${s.tileSize}|${s.contentSize}|${s.gutter}|${path.basename(s.path)}|${s.quality}`)];
  run('python', args);
  const derivatives = specs.map((spec) => {
    const temporary = path.join(tempDir, path.basename(spec.path));
    const info = imageInfo(temporary);
    if (info.width !== (spec.type === 'atlas' ? spec.size : spec.size) || info.height !== info.width) fail(`Unexpected output size: ${spec.path} (${info.width}x${info.height})`);
    return { ...spec, dimensions: { width: info.width, height: info.height }, byteLength: fs.statSync(temporary).size, sha256: sha256(temporary), pixelFormat: info.pixelFormat,
      encoding: { format: 'WebP', lossless: spec.channel === 'normal', quality: spec.channel === 'normal' ? null : spec.quality, compressionMethod: 6 },
      processing: spec.channel === 'normal' ? 'RGB channels resized independently with Lanczos; no gamma or color transform' : 'RGB resized with Lanczos; no explicit gamma or color transform' };
  });
  const receipt = {
    schemaVersion: 1, family: 'ground-family-v1', generatedAt: oldReceipt?.generatedAt ?? new Date().toISOString(),
    generator: { script: 'tools/prepare-ground-materials.mjs', python: run('python', ['--version']), pillow: run('python', ['-c', 'import PIL; print(PIL.__version__)']), resampler: 'Pillow Lanczos; RGB processing without explicit colorspace/gamma conversion' },
    sources, previews: derivatives.filter((item) => item.type === 'preview'), runtimeAtlases: derivatives.filter((item) => item.type === 'atlas'),
    atlasLayout: { originConvention: 'pixel top-left; TextureLoader flipY=true', tileOrder: LAYOUT, desktop: { atlas: [2048,2048], tile: [1024,1024], content: [960,960], gutter: 32 }, mobile: { atlas: [1024,1024], tile: [512,512], content: [480,480], gutter: 16 }, gutter: 'duplicated edge pixels on all four edges and corners', normalMaps: 'lossless RGB WebP; no gamma transform' },
    aggregateRuntimeBytes: derivatives.filter((item) => item.type === 'atlas').reduce((sum, item) => sum + item.byteLength, 0),
  };
  if (checkOnly) {
    if (!oldReceipt) fail(`Missing receipt: ${RECEIPT}`);
    for (const source of sources) {
      const copy = path.join(ROOT, source.path);
      if (!fs.existsSync(copy) || sha256(copy) !== source.sha256 || fs.statSync(copy).size !== source.byteLength) fail(`Source copy mismatch: ${source.path}`);
    }
    for (const item of derivatives) {
      const target = path.join(ROOT, item.path);
      if (!fs.existsSync(target) || sha256(target) !== item.sha256 || fs.statSync(target).size !== item.byteLength) fail(`Derivative mismatch: ${item.path}`);
      const actual = imageInfo(target);
      if (actual.width !== item.dimensions.width || actual.height !== item.dimensions.height) fail(`Dimensions mismatch: ${item.path}`);
    }
    const compare = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    if (!compare(oldReceipt.sources, receipt.sources) || !compare(oldReceipt.previews, receipt.previews) || !compare(oldReceipt.runtimeAtlases, receipt.runtimeAtlases) || !compare(oldReceipt.atlasLayout, receipt.atlasLayout) || oldReceipt.aggregateRuntimeBytes !== receipt.aggregateRuntimeBytes) fail('Receipt metadata does not match recipe or files');
    console.log(`ground-family-v1 check OK: ${sources.length} sources, ${receipt.previews.length} previews, ${receipt.runtimeAtlases.length} runtime atlases; ${receipt.aggregateRuntimeBytes} runtime bytes`);
  } else {
    for (const source of sources) {
      const target = path.join(ROOT, source.path);
      if (fs.existsSync(target) && (!oldReceipt?.sources?.some((item) => item.id === source.id && item.sha256 === source.sha256))) fail(`Refusing to replace unreceipted source copy: ${source.path}`);
    }
    for (const item of derivatives) {
      const target = path.join(ROOT, item.path);
      if (fs.existsSync(target)) {
        const old = [...(oldReceipt?.previews ?? []), ...(oldReceipt?.runtimeAtlases ?? [])].find((prior) => prior.path === item.path);
        const existingHash = sha256(target);
        if (!old || existingHash !== old.sha256 || existingHash !== item.sha256) fail(`Refusing to overwrite unreceipted or differing derivative: ${item.path}`);
      }
    }
    for (const source of sources) {
      const target = path.join(ROOT, source.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(ROOT, source.originalPath), target, fs.constants.COPYFILE_EXCL);
    }
    for (const item of derivatives) {
      const target = path.join(ROOT, item.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(tempDir, path.basename(item.path)), target, fs.constants.COPYFILE_EXCL);
    }
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`ground-family-v1 generated: ${sources.length} exact source copies, ${receipt.previews.length} previews, ${receipt.runtimeAtlases.length} atlases; ${receipt.aggregateRuntimeBytes} runtime bytes`);
  }
} finally {
  const resolved = path.resolve(tempDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('ground-family-v1-')) throw new Error('Unsafe temporary cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true });
}
