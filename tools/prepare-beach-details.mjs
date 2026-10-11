// Build the geometry-only, vertex-painted beach detail GLBs. Existing outputs are immutable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readGlb, summarize } from './glb.mjs';
import { shellGeometry, beachPebbleGeometry } from '../src/render/beachDetails.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const refreshDraft = process.argv.includes('--refresh-draft');
if (check && refreshDraft) throw new Error('Choose either --check or --refresh-draft');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceExport = path.join(root, 'docs/art/source/coast-rock-v1/SM_Rock.geometry-export.glb');
const sourceRuntime = path.join(root, 'assets/models/coast-rock-v1.glb');
const sourceExportBytes = fs.readFileSync(sourceExport);
const sourceRuntimeBytes = fs.readFileSync(sourceRuntime);
const sourceExportHash = hash(sourceExportBytes);
const sourceRuntimeHash = hash(sourceRuntimeBytes);

function makeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(jsonChunk);
  const binChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(binChunk);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}

function geometryGlb(name, geometry, generator) {
  const arrays = [['position', 'POSITION'], ['normal', 'NORMAL'], ['color', 'COLOR_0']];
  const views = [], accessors = [], chunks = [], attributes = {};
  let offset = 0;
  for (const [attributeName, semantic] of arrays) {
    const attribute = geometry.getAttribute(attributeName);
    if (!attribute || attribute.itemSize !== 3 || attribute.count === 0) throw new Error(`${name}: missing/invalid ${attributeName}`);
    const bytes = Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
    const viewIndex = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
    const accessor = { bufferView: viewIndex, componentType: 5126, count: attribute.count, type: 'VEC3' };
    if (attributeName === 'position') {
      geometry.computeBoundingBox();
      accessor.min = geometry.boundingBox.min.toArray(); accessor.max = geometry.boundingBox.max.toArray();
    }
    attributes[semantic] = accessors.length; accessors.push(accessor); chunks.push(bytes); offset += bytes.length;
  }
  const json = {
    asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives: [{ attributes, mode: 4, material: 0 }] }],
    materials: [{ name: 'geometry-only-vertex-paint', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: offset }], bufferViews: views, accessors,
  };
  return makeGlb(json, Buffer.concat(chunks));
}

async function sourceRockGeometry() {
  const parsed = await new GLTFLoader().parseAsync(sourceRuntimeBytes.buffer.slice(sourceRuntimeBytes.byteOffset, sourceRuntimeBytes.byteOffset + sourceRuntimeBytes.byteLength), '');
  let source = null;
  parsed.scene.traverse((object) => { if (!source && object.isMesh) source = object.geometry.clone(); });
  if (!source) throw new Error('S02 runtime GLB has no mesh geometry');
  return source;
}

const apiBytes = fs.readFileSync(path.join(root, 'src/render/beachDetails.js'));
const toolBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const recipeSha256 = hash(Buffer.concat([Buffer.from('beach-details-v1\0'), apiBytes, Buffer.from([0]), toolBytes]));
const pebbleSource = await sourceRockGeometry();
const geometries = [
  ['shell-fan', shellGeometry(0)], ['shell-oval', shellGeometry(1)], ['shell-chip', shellGeometry(2)],
  ['pebbles', beachPebbleGeometry(pebbleSource)],
];
pebbleSource.dispose();

const models = [];
for (const [style, geometry] of geometries) {
  const name = `beach-${style}-v1`;
  const bytes = geometryGlb(name, geometry, 'Realms of Trade beach details v1: deterministic vertex-painted geometry');
  const stats = summarize(readGlb(bytes));
  const triangleLimit = style === 'pebbles' ? 192 : 120;
  if (bytes.length > 24 * 1024) throw new Error(`${name} exceeds 24 KiB (${bytes.length})`);
  if (stats.tris > triangleLimit) throw new Error(`${name} exceeds ${triangleLimit} triangles (${stats.tris})`);
  models.push({ style, name, file: `assets/models/${name}.glb`, bytes, stats, sha256: hash(bytes) });
  geometry.dispose();
}

const receipt = {
  version: 1,
  recipe: 'beach-details-v1',
  recipeSha256,
  source: {
    unrealGeometryExport: { file: path.relative(root, sourceExport).replaceAll('\\', '/'), bytes: sourceExportBytes.length, sha256: sourceExportHash },
    coastRockRuntime: { file: path.relative(root, sourceRuntime).replaceAll('\\', '/'), bytes: sourceRuntimeBytes.length, sha256: sourceRuntimeHash },
  },
  dependencies: ['SM_Rock exact geometry export', 'coast-rock-v1 runtime vertex-painted geometry', 'src/render/beachDetails.js geometry recipe'],
  material: 'POSITION + NORMAL + COLOR_0 only; no texture; geometry-only white PBR wrapper; runtime material remains unchanged',
  models: models.map(({ style, file, bytes, stats, sha256 }) => ({ style, file, bytes: bytes.length, sha256, triangles: stats.tris, vertices: stats.verts, bounds: { min: stats.min, max: stats.max }, images: stats.images.length })),
};
const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');

const receiptFile = path.join(root, 'docs/art/source/beach-details-v1/receipt.json');

function refreshDraftOutputs() {
  const deliveryFile = path.join(root, 'docs/delivery/beach-details-v1.md');
  if (fs.existsSync(deliveryFile)) throw new Error('Refusing draft refresh after beach-details delivery documentation exists');
  const catalogFile = path.join(root, 'tools/art-catalog/catalog.json');
  const catalogBytes = fs.readFileSync(catalogFile);
  const catalog = JSON.parse(catalogBytes.toString('utf8'));
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && ['conchas-playa', 'cantos-guijarros'].includes(value.id)) found.push(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(catalog);
  for (const id of ['conchas-playa', 'cantos-guijarros']) {
    const rows = found.filter((item) => item.id === id);
    if (rows.length !== 1) throw new Error(`Expected exactly one catalog item ${id}`);
    if ((rows[0].evidence || []).some((e) => typeof e?.path === 'string' && e.path.replaceAll('\\', '/') === 'docs/delivery/beach-details-v1.md')) {
      throw new Error(`Refusing draft refresh: ${id} already cites beach-details delivery evidence`);
    }
  }
  const oldReceiptBytes = fs.readFileSync(receiptFile);
  const oldReceipt = JSON.parse(oldReceiptBytes.toString('utf8'));
  if (oldReceipt.recipe !== 'beach-details-v1' || oldReceipt.version !== 1) throw new Error('Unrecognized prior draft receipt');
  if (oldReceipt.source?.unrealGeometryExport?.sha256 !== sourceExportHash || oldReceipt.source?.coastRockRuntime?.sha256 !== sourceRuntimeHash) {
    throw new Error('Refusing draft refresh: source hashes differ from the existing receipt');
  }
  const expectedStyles = ['shell-fan', 'shell-oval', 'shell-chip', 'pebbles'];
  if (!Array.isArray(oldReceipt.models) || oldReceipt.models.length !== expectedStyles.length || expectedStyles.some((style) => !oldReceipt.models.some((m) => m.style === style && m.file === `assets/models/beach-${style}-v1.glb`))) {
    throw new Error('Existing receipt does not enumerate exactly the four known derivatives');
  }
  const modelFiles = new Map(models.map((m) => [m.file, m]));
  const oldModelBytes = new Map();
  for (const old of oldReceipt.models) {
    const file = path.join(root, old.file);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== old.bytes || hash(bytes) !== old.sha256) throw new Error(`Refusing draft refresh: prior derivative differs from receipt: ${old.file}`);
    oldModelBytes.set(old.file, bytes);
    if (!modelFiles.has(old.file)) throw new Error(`Unknown derivative in prior receipt: ${old.file}`);
  }
  const backupDir = path.join(root, 'docs/art/source/beach-details-v1/draft-flat');
  const backups = [
    { file: path.join(backupDir, 'receipt.json'), bytes: oldReceiptBytes },
    ...['shell-fan', 'shell-oval', 'shell-chip'].map((style) => ({
      file: path.join(backupDir, `beach-${style}-v1.glb`), bytes: oldModelBytes.get(`assets/models/beach-${style}-v1.glb`),
    })),
  ];
  // Complete every guard, including backup collision checks, before touching any file.
  for (const backup of backups) if (fs.existsSync(backup.file) && !fs.readFileSync(backup.file).equals(backup.bytes)) {
    throw new Error(`Refusing to replace differing draft backup: ${path.relative(root, backup.file)}`);
  }
  for (const model of models) {
    const before = oldModelBytes.get(model.file);
    if (!before) throw new Error(`Prior receipt omitted derivative: ${model.file}`);
  }
  if (!fs.readFileSync(catalogFile).equals(catalogBytes) || !fs.readFileSync(receiptFile).equals(oldReceiptBytes)) throw new Error('Catalog or receipt changed during refresh validation');
  for (const [file, bytes] of oldModelBytes) if (!fs.readFileSync(path.join(root, file)).equals(bytes)) throw new Error(`Derivative changed during refresh validation: ${file}`);

  for (const backup of backups) {
    if (!fs.existsSync(backup.file)) {
      fs.mkdirSync(path.dirname(backup.file), { recursive: true });
      fs.writeFileSync(backup.file, backup.bytes, { flag: 'wx' });
    }
  }
  for (const model of models) fs.writeFileSync(path.join(root, model.file), model.bytes);
  fs.writeFileSync(receiptFile, receiptBytes);
}

function verifyOrWrite(file, bytes) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file);
    if (!current.equals(bytes)) throw new Error(`Refusing to replace differing preexisting derivative/receipt: ${path.relative(root, file)}`);
    return;
  }
  if (check) throw new Error(`--check expected existing file: ${path.relative(root, file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}

if (refreshDraft) refreshDraftOutputs();
else {
  for (const model of models) verifyOrWrite(path.join(root, model.file), model.bytes);
  verifyOrWrite(receiptFile, receiptBytes);
}
if (check) {
  for (const model of models) {
    const existing = fs.readFileSync(path.join(root, model.file));
    if (hash(existing) !== model.sha256) throw new Error(`Hash verification failed: ${model.file}`);
  }
  if (hash(fs.readFileSync(path.join(root, 'docs/art/source/beach-details-v1/receipt.json'))) !== hash(receiptBytes)) throw new Error('Receipt hash verification failed');
}
console.log(JSON.stringify({ check, recipeSha256, models: receipt.models }, null, 2));
