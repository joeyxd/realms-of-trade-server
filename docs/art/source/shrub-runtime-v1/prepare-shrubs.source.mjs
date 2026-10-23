#!/usr/bin/env node
// Build compact, texture-free GLBs for the deterministic shrub geometry family.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHRUB_STYLES, shrubGeometry } from '../src/render/shrubGeometry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'docs/art/source/shrub-runtime-v1';
const GLB_DIR = 'assets/models';
const cli = process.argv.slice(2);
if (cli.length > 1 || (cli.length && cli[0] !== '--check')) throw new Error('Usage: node tools/prepare-shrubs.mjs [--check]');
const check = cli[0] === '--check';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const geometryPath = 'src/render/shrubGeometry.js';
const toolPath = 'tools/prepare-shrubs.mjs';
const geometryBytes = fs.readFileSync(path.join(ROOT, geometryPath));
const toolBytes = fs.readFileSync(fileURLToPath(import.meta.url));

function makeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(jsonChunk);
  const binChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(binChunk);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}

function stats(geometry) {
  geometry.computeBoundingBox();
  const count = geometry.getIndex()?.count ?? geometry.getAttribute('position').count;
  if (count % 3) throw new Error('Shrub element count must be divisible by three');
  return { vertices: geometry.getAttribute('position').count, triangles: count / 3, bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() } };
}

function pack(name, parts) {
  const views = [], accessors = [], chunks = [], meshes = [], nodes = [];
  let offset = 0;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const { name: partName, geometry } = parts[partIndex], attributes = {};
    for (const [attributeName, semantic, size] of [
      ['position', 'POSITION', 3], ['normal', 'NORMAL', 3], ['color', 'COLOR_0', 3],
      ['aFlex', '_FLEX', 1], ['aPaint', '_PAINT', 2], ['uv', 'TEXCOORD_0', 2],
    ]) {
      const attribute = geometry.getAttribute(attributeName);
      if (!attribute || attribute.itemSize !== size || !attribute.count || !(attribute.array instanceof Float32Array)) throw new Error(`${name}/${partName}: invalid ${attributeName}`);
      while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
      const bytes = Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
      const view = views.length; views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
      const accessor = { bufferView: view, componentType: 5126, count: attribute.count, type: size === 1 ? 'SCALAR' : `VEC${size}` };
      if (attributeName === 'position') { const b = geometry.boundingBox; accessor.min = b.min.toArray(); accessor.max = b.max.toArray(); }
      attributes[semantic] = accessors.length; accessors.push(accessor); chunks.push(bytes); offset += bytes.length;
    }
    const index = geometry.getIndex();
    let primitive = { attributes, mode: 4, material: partIndex };
    if (index) {
      while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
      const max = index.array.reduce((a, b) => Math.max(a, b), 0), IndexArray = max > 65535 ? Uint32Array : Uint16Array;
      const values = index.array instanceof IndexArray ? index.array : new IndexArray(index.array);
      const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
      const view = views.length; views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34963 });
      const accessor = accessors.length; accessors.push({ bufferView: view, componentType: IndexArray === Uint32Array ? 5125 : 5123, count: values.length, type: 'SCALAR' });
      chunks.push(bytes); offset += bytes.length; primitive = { ...primitive, indices: accessor };
    }
    meshes.push({ name: `${name}-${partName}`, primitives: [primitive] }); nodes.push({ name: `${name}-${partName}`, mesh: partIndex });
  }
  const materials = parts.map(({ name: partName, doubleSided }) => ({ name: `shrub-${partName}-vertex-paint`, pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], metallicFactor: 0, roughnessFactor: 1 }, ...(doubleSided ? { doubleSided: true } : {}) }));
  const json = { asset: { version: '2.0', generator: 'Realms of Trade shrub v1: vertex-painted GLB' }, scene: 0, scenes: [{ nodes: [0,1] }], nodes, meshes, materials, buffers: [{ byteLength: offset }], bufferViews: views, accessors };
  return makeGlb(json, Buffer.concat(chunks));
}

const models = [];
for (let variant = 0; variant < SHRUB_STYLES.length; variant++) {
  const style = SHRUB_STYLES[variant], name = `shrub-${style}-v1`;
  const { stems, leaves } = shrubGeometry(variant, { cards: true });
  try {
    const parts = { stems: stats(stems), leaves: stats(leaves) };
    const triangles = parts.stems.triangles + parts.leaves.triangles;
    if (triangles > 700) throw new Error(`${name} exceeds 700 triangles (${triangles})`);
    const bytes = pack(name, [{ name: 'stems', geometry: stems }, { name: 'leaves', geometry: leaves, doubleSided: true }]);
    if (bytes.length > 100 * 1024) throw new Error(`${name} exceeds 100 KiB (${bytes.length})`);
    models.push({ style, file: `${GLB_DIR}/${name}.glb`, bytes, sha256: hash(bytes), triangles, vertices: parts.stems.vertices + parts.leaves.vertices, parts, byteLength: bytes.length });
  } finally { stems.dispose(); leaves.dispose(); }
}

const snapshots = [
  { source: geometryPath, snapshot: `${SOURCE}/shrubGeometry.source.js`, bytes: geometryBytes },
  { source: toolPath, snapshot: `${SOURCE}/prepare-shrubs.source.mjs`, bytes: toolBytes },
];
const receipt = {
  version: 1, family: 'shrub-v1', recipeSha256: hash(Buffer.concat([Buffer.from('shrub-v1\0'), geometryBytes, Buffer.from([0]), toolBytes])),
  sources: snapshots.map(({ source, snapshot, bytes }) => ({ file: source, snapshot, bytes: bytes.length, sha256: hash(bytes) })),
  geometry: { api: 'SHRUB_IDS, SHRUB_STYLES, shrubGeometry(variant,{cards:true}), loadedShrubGeometry(data)', parts: ['stems', 'leaves'], attributes: ['POSITION','NORMAL','COLOR_0','_FLEX','_PAINT','TEXCOORD_0'], atlas: 'shrub-v1 2x2; TextureLoader flipY=true', material: 'vertex colors; leaves double sided; no embedded images' },
  budgets: { maxTrianglesPerModel: 700, maxBytesPerModel: 100 * 1024 },
  models: models.map(({ style, file, bytes, sha256, triangles, vertices, parts, byteLength }) => ({ style, file, bytes: byteLength, sha256, triangles, vertices, parts, images: 0 })),
};
const outputs = [...snapshots.map(({ snapshot, bytes }) => [snapshot, bytes]), ...models.map(({ file, bytes }) => [file, bytes]), [`${SOURCE}/geometry-receipt.json`, Buffer.from(JSON.stringify(receipt, null, 2) + '\n')]];
for (const [relative, bytes] of outputs) {
  const destination = path.join(ROOT, relative);
  if (fs.existsSync(destination)) {
    if (!fs.readFileSync(destination).equals(bytes)) throw new Error(`Refusing differing existing output: ${relative}`);
  } else if (check) throw new Error(`--check missing ${relative}`);
}
if (!check) for (const [relative, bytes] of outputs) {
  const destination = path.join(ROOT, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
}
console.log(JSON.stringify({ check, models: receipt.models }, null, 2));
