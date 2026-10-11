#!/usr/bin/env node
// Preserve the supplied town wood maps and build paired previews plus padded runtime atlases.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = 'materials/references';
const COPY_DIR = 'docs/art/source/town-wood-v1/textures';
const PREVIEW_DIR = 'docs/art/town-wood/town-wood-v1/previews';
const ASSET_DIR = 'assets/textures/town-wood-v1';
const RECEIPT = 'docs/art/town-wood/material-receipt-v1.json';
const PAIRS = [
  { id: 'planks', albedo: 'Textura de tablas de madera estilizadas.png', normal: 'Textura normal púrpura de tablones de madera.png' },
  { id: 'patched', albedo: 'Textura de tablas de madera parchada estilizadas.png', normal: 'Textura Normal de tablas de madera parchada estilizadas.png' },
  { id: 'floor', albedo: 'piso de tablas juntas escalonadas, clavos y desgaste para el suelo.png', normal: 'Normal piso de tablas juntas escalonadas, clavos y desgaste para el suelo.png' },
  { id: 'beam', albedo: 'Textura de Viga horizontal de madera estilizadas.png', normal: 'Textura Normal de Viga horizontal de madera estilizadas.png' },
  { id: 'timber', albedo: 'Textura de madera solida (timber) estilizadas.png', normal: 'Textura normal de madera solida (timber) estilizadas.png' },
  { id: 'iron', albedo: 'Textura Timber with iron reinforcement straps.png', normal: 'Textura Normal Timber with iron reinforcement straps.png' },
  { id: 'corner', albedo: 'Textura de esquina exterior de madera estilizadas.png', normal: 'Textura normal de esquina exterior de madera estilizadas.png' },
  { id: 'door', albedo: 'Textura de muro de madera con puerta cerrada estilizadas.png', normal: 'Textura normal de muro de madera con puerta cerrada estilizadas.png' },
  { id: 'window', albedo: 'Textura de muro de madera con ventana estilizadas.png', normal: 'Textura normal de muro de madera con ventana estilizadas.png' },
];
const LAYOUT = PAIRS.map((pair, index) => ({ id: pair.id, tile: index, x: index % 4, y: Math.floor(index / 4) }));
const DEVICES = [
  { device: 'desktop', atlasSize: 2048, tileSize: 512, gutter: 16, contentSize: 480 },
  { device: 'mobile', atlasSize: 1024, tileSize: 256, gutter: 8, contentSize: 240 },
];
const RECIPE = {
  schemaVersion: 1, family: 'town-wood-v1', sourceDirectory: SOURCE_DIR,
  pairs: PAIRS, tileOrder: LAYOUT,
  previews: { directory: PREVIEW_DIR, size: 512, format: 'WebP', albedoQuality: 90, normalLossless: true },
  atlases: DEVICES.map(({ device, atlasSize, tileSize, gutter, contentSize }) => ({ device, atlas: [atlasSize, atlasSize], tile: [tileSize, tileSize], gutter, content: [contentSize, contentSize] })),
  processing: {
    input: 'RGB; source alpha discarded so black window openings remain opaque black',
    resize: 'Pillow Lanczos; paired albedo and normal maps use identical resize dimensions',
    albedo: 'RGB WebP quality 90, no explicit gamma or colorspace transform',
    normal: 'RGB lossless WebP, channel convention preserved, no gamma or colorspace transform',
    gutter: 'duplicate each content edge pixel through all four gutters and corners',
    emptyTiles: { albedoRgb: [255, 255, 255], normalRgb: [128, 128, 255] },
  },
};
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check') || args.filter((arg) => arg === '--check').length > 1) throw new Error('Usage: node tools/prepare-town-materials.mjs [--check]');
const checkOnly = args.includes('--check');

function fail(message) { throw new Error(message); }
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function imageInfo(file) {
  const parsed = JSON.parse(run('python', ['-c', 'from PIL import Image; import json,sys; im=Image.open(sys.argv[1]); print(json.dumps({"width":im.width,"height":im.height,"mode":im.mode,"format":im.format}))', file]));
  return parsed;
}
function canonical(value) { return JSON.stringify(value); }
function readReceipt() {
  const file = path.join(ROOT, RECEIPT);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const receiptPath = path.join(ROOT, RECEIPT);
const oldReceipt = readReceipt();
const sources = [];
for (const pair of PAIRS) for (const channel of ['albedo', 'normal']) {
  const file = pair[channel];
  const originalPath = `${SOURCE_DIR}/${file}`;
  const original = path.join(ROOT, originalPath);
  if (!fs.existsSync(original)) fail(`Missing original: ${originalPath}`);
  const info = imageInfo(original);
  if (info.width !== 1254 || info.height !== 1254) fail(`${originalPath} is ${info.width}x${info.height}, expected 1254x1254`);
  const copyPath = `${COPY_DIR}/${pair.id}-${channel}.png`;
  const entry = { path: copyPath, source: originalPath, bytes: fs.statSync(original).size, sha256: sha256(original), pairId: pair.id, channel, width: info.width, height: info.height };
  const copy = path.join(ROOT, copyPath);
  if (fs.existsSync(copy) && (fs.statSync(copy).size !== entry.bytes || sha256(copy) !== entry.sha256)) fail(`Refusing to overwrite differing source copy: ${copyPath}`);
  sources.push(entry);
}

const outputs = [];
for (const pair of PAIRS) for (const channel of ['albedo', 'normal']) {
  outputs.push({ id: `preview-${pair.id}-${channel}`, kind: 'preview', pairId: pair.id, channel, path: `${PREVIEW_DIR}/${pair.id}-${channel}-512.webp`, width: 512, height: 512 });
}
for (const channel of ['albedo', 'normal']) for (const device of DEVICES) {
  outputs.push({ id: `atlas-${channel}-${device.device}`, kind: 'atlas', channel, device: device.device, path: `${ASSET_DIR}/atlas-${channel}-${device.device}.webp`, width: device.atlasSize, height: device.atlasSize, tileSize: device.tileSize, contentSize: device.contentSize, gutter: device.gutter });
}

const PY = String.raw`from PIL import Image
import sys
src_root, out_root = sys.argv[1], sys.argv[2]
specs = [tuple(s.split('|')) for s in sys.argv[3:]]
pairs = [
 ('planks','Textura de tablas de madera estilizadas.png','Textura normal púrpura de tablones de madera.png'),
 ('patched','Textura de tablas de madera parchada estilizadas.png','Textura Normal de tablas de madera parchada estilizadas.png'),
 ('floor','piso de tablas juntas escalonadas, clavos y desgaste para el suelo.png','Normal piso de tablas juntas escalonadas, clavos y desgaste para el suelo.png'),
 ('beam','Textura de Viga horizontal de madera estilizadas.png','Textura Normal de Viga horizontal de madera estilizadas.png'),
 ('timber','Textura de madera solida (timber) estilizadas.png','Textura normal de madera solida (timber) estilizadas.png'),
 ('iron','Textura Timber with iron reinforcement straps.png','Textura Normal Timber with iron reinforcement straps.png'),
 ('corner','Textura de esquina exterior de madera estilizadas.png','Textura normal de esquina exterior de madera estilizadas.png'),
 ('door','Textura de muro de madera con puerta cerrada estilizadas.png','Textura normal de muro de madera con puerta cerrada estilizadas.png'),
 ('window','Textura de muro de madera con ventana estilizadas.png','Textura normal de muro de madera con ventana estilizadas.png'),
]
by_id = {p[0]: p for p in pairs}
def source(pair_id, channel):
    return Image.open(src_root + '/' + by_id[pair_id][1 if channel == 'albedo' else 2]).convert('RGB')
def put_tile(atlas, image, x, y, tile, gutter, content):
    im = image.resize((content, content), Image.Resampling.LANCZOS)
    cell = Image.new('RGB', (tile, tile))
    cell.paste(im, (gutter, gutter))
    cell.paste(im.crop((0,0,content,1)).resize((content,gutter)), (gutter,0))
    cell.paste(im.crop((0,content-1,content,content)).resize((content,gutter)), (gutter,gutter+content))
    cell.paste(im.crop((0,0,1,content)).resize((gutter,content)), (0,gutter))
    cell.paste(im.crop((content-1,0,content,content)).resize((gutter,content)), (gutter+content,gutter))
    cell.paste(im.getpixel((0,0)), (0,0,gutter,gutter))
    cell.paste(im.getpixel((content-1,0)), (gutter+content,0,tile,gutter))
    cell.paste(im.getpixel((0,content-1)), (0,gutter+content,gutter,tile))
    cell.paste(im.getpixel((content-1,content-1)), (gutter+content,gutter+content,tile,tile))
    atlas.paste(cell, (x*tile,y*tile))
for spec in specs:
    kind, pair_id, channel, device, out_name = spec
    if kind == 'preview':
        image = source(pair_id, channel).resize((512,512), Image.Resampling.LANCZOS)
        if channel == 'normal': image.save(out_root+'/'+out_name,'WEBP',lossless=True,method=6)
        else: image.save(out_root+'/'+out_name,'WEBP',quality=90,method=6)
    else:
        atlas_size, tile, content, gutter = map(int, device.split(','))
        empty = (255,255,255) if channel == 'albedo' else (128,128,255)
        atlas = Image.new('RGB',(atlas_size,atlas_size),empty)
        for i, (pid,_,__) in enumerate(pairs):
            put_tile(atlas,source(pid,channel),i%4,i//4,tile,gutter,content)
        if channel == 'normal': atlas.save(out_root+'/'+out_name,'WEBP',lossless=True,method=6)
        else: atlas.save(out_root+'/'+out_name,'WEBP',quality=90,method=6)
`;

function checkReceipt() {
  if (!oldReceipt) fail(`Missing receipt: ${RECEIPT}`);
  if (canonical(oldReceipt.recipe) !== canonical(RECIPE)) fail('Receipt recipe does not match this generator');
  if (canonical(oldReceipt.sources) !== canonical(sources)) fail('Receipt source metadata does not match supplied originals');
  const sourceMap = new Map(sources.map((source) => [source.path, source]));
  for (const source of sources) {
    const original = path.join(ROOT, source.source), copy = path.join(ROOT, source.path);
    for (const file of [original, copy]) if (!fs.existsSync(file) || fs.statSync(file).size !== source.bytes || sha256(file) !== source.sha256) fail(`Source bytes/hash mismatch: ${path.relative(ROOT, file)}`);
  }
  if (!sourceMap.size) fail('Empty source inventory');
  for (const output of outputs) {
    const recorded = oldReceipt.derivatives?.find((item) => item.id === output.id);
    const file = path.join(ROOT, output.path);
    if (!recorded || recorded.path !== output.path || !fs.existsSync(file) || fs.statSync(file).size !== recorded.bytes || sha256(file) !== recorded.sha256) fail(`Derivative mismatch: ${output.path}`);
    const info = imageInfo(file);
    if (info.width !== output.width || info.height !== output.height || recorded.width !== output.width || recorded.height !== output.height || info.mode !== 'RGB') fail(`Derivative dimensions/mode mismatch: ${output.path}`);
  }
  if (oldReceipt.derivatives.length !== outputs.length) fail('Receipt has unexpected derivative records');
  const total = outputs.filter((item) => item.kind === 'atlas').reduce((sum, item) => sum + oldReceipt.derivatives.find((d) => d.id === item.id).bytes, 0);
  if (oldReceipt.aggregateRuntimeBytes !== total) fail('Aggregate runtime byte count mismatch');
  console.log(`town-wood-v1 check OK: ${sources.length} source maps, ${outputs.filter((o) => o.kind === 'preview').length} previews, ${outputs.filter((o) => o.kind === 'atlas').length} runtime atlases; ${total} runtime bytes`);
}

if (checkOnly) { checkReceipt(); process.exit(0); }
if (oldReceipt) {
  if (canonical(oldReceipt.recipe) !== canonical(RECIPE)) fail('Existing town wood receipt has a different recipe');
  checkReceipt();
  console.log('town-wood-v1 already generated; no files rewritten');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-wood-v1-'));
const staged = [];
try {
  const specs = outputs.map((output) => output.kind === 'preview'
    ? `preview|${output.pairId}|${output.channel}|-|${path.basename(output.path)}`
    : `atlas|-|${output.channel}|${DEVICES.find((d) => d.device === output.device).atlasSize},${output.tileSize},${output.contentSize},${output.gutter}|${path.basename(output.path)}`);
  run('python', ['-c', PY, path.join(ROOT, SOURCE_DIR), tempDir, ...specs]);
  const derivatives = outputs.map((output) => {
    const temporary = path.join(tempDir, path.basename(output.path));
    const info = imageInfo(temporary);
    if (info.width !== output.width || info.height !== output.height || info.mode !== 'RGB') fail(`Unexpected derivative dimensions/mode: ${output.path}`);
    return { ...output, bytes: fs.statSync(temporary).size, sha256: sha256(temporary), format: info.format, encoding: output.channel === 'normal' ? { format: 'WebP', lossless: true, quality: null, method: 6 } : { format: 'WebP', lossless: false, quality: 90, method: 6 } };
  });
  const receipt = {
    schemaVersion: 1, family: 'town-wood-v1', generatedAt: new Date().toISOString(),
    generator: { script: 'tools/prepare-town-materials.mjs', python: run('python',['--version']), pillow: run('python',['-c','import PIL; print(PIL.__version__)'] ), resampler: 'Pillow Lanczos; RGB processing without explicit gamma/colorspace conversion' },
    recipe: RECIPE, sources, derivatives,
    aggregateRuntimeBytes: derivatives.filter((item) => item.kind === 'atlas').reduce((sum, item) => sum + item.bytes, 0),
  };
  const targets = [
    ...sources.map((source) => ({ path: source.path, from: path.join(ROOT, source.source), hash: source.sha256 })),
    ...derivatives.map((item) => ({ path: item.path, from: path.join(tempDir, path.basename(item.path)), hash: item.sha256 })),
  ];
  for (const target of targets) if (fs.existsSync(path.join(ROOT, target.path))) fail(`Refusing to overwrite existing output: ${target.path}`);
  if (fs.existsSync(receiptPath)) fail(`Receipt appeared during generation: ${RECEIPT}`);
  for (const target of targets) {
    const destination = path.join(ROOT, target.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tempFile = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.tmp`);
    try {
      fs.copyFileSync(target.from, tempFile, fs.constants.COPYFILE_EXCL);
      if (sha256(tempFile) !== target.hash) fail(`Staged hash mismatch: ${target.path}`);
      staged.push({ tempFile, destination });
    } catch (error) { if (fs.existsSync(tempFile)) fs.rmSync(tempFile); throw error; }
  }
  // Install with exclusive hard links so a concurrent creator cannot be overwritten.
  for (const item of staged) fs.linkSync(item.tempFile, item.destination);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const receiptTemp = `${receiptPath}.${process.pid}.tmp`;
  fs.writeFileSync(receiptTemp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  fs.linkSync(receiptTemp, receiptPath);
  fs.rmSync(receiptTemp);
  for (const item of staged) fs.rmSync(item.tempFile);
  console.log(`town-wood-v1 generated: ${sources.length} exact source copies, ${derivatives.filter((d) => d.kind === 'preview').length} previews, ${derivatives.filter((d) => d.kind === 'atlas').length} atlases; ${receipt.aggregateRuntimeBytes} runtime bytes`);
} catch (error) {
  // Remove only this run's temp files. Installed outputs are retained as recovery material on interruption.
  for (const item of staged) if (fs.existsSync(item.tempFile)) fs.rmSync(item.tempFile);
  throw error;
} finally {
  const resolved = path.resolve(tempDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('town-wood-v1-')) throw new Error('Unsafe temporary cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true });
}
