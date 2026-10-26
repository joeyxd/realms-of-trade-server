// Build the deterministic, vertex-painted palm family GLBs. Existing outputs are immutable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { palmGeometry, PALM_STYLES } from '../src/render/palmGeometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.includes('--refresh-draft')) throw new Error('Palm family outputs cannot be refreshed');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFile = path.join(root, 'materials/references/palmera tropical.png');
const referenceFile = path.join(root, 'docs/art/source/palm-family-v1/reference.png');
const geometryFile = path.join(root, 'src/render/palmGeometry.js');
const sourceBytes = fs.readFileSync(sourceFile);
const geometryBytes = fs.readFileSync(geometryFile);
const toolBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const sourceHash = hash(sourceBytes);
const geometryHash = hash(geometryBytes);
const recipeSha256 = hash(Buffer.concat([
  Buffer.from('palm-family-v1\0'), geometryBytes, Buffer.from([0]), toolBytes,
]));

function makeGlb(json, binary) {
  const jsonText = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(jsonText.length / 4) * 4, 0x20);
  jsonText.copy(jsonChunk);
  const binChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(binChunk);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}

function geometryStats(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const index = geometry.getIndex();
  const elements = index ? index.count : geometry.getAttribute('position').count;
  if (elements % 3 !== 0) throw new Error('Palm part element count is not divisible by three');
  return {
    vertices: geometry.getAttribute('position').count,
    triangles: elements / 3,
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
  };
}

function packPalm(name, parts) {
  const views = [], accessors = [], chunks = [];
  const meshes = [], nodes = [];
  let offset = 0;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const { name: partName, geometry, doubleSided } = parts[partIndex];
    const attributes = {};
    for (const [attributeName, semantic] of [
      ['position', 'POSITION'], ['normal', 'NORMAL'], ['color', 'COLOR_0'],
      ['aFlex', '_FLEX'], ['aPaint', '_PAINT'], ['uv', 'TEXCOORD_0'],
    ]) {
      const attribute = geometry.getAttribute(attributeName);
      const expectedSize = attributeName === 'aFlex' ? 1 : ['aPaint', 'uv'].includes(attributeName) ? 2 : 3;
      if (!attribute || attribute.itemSize !== expectedSize || attribute.count === 0 || !(attribute.array instanceof Float32Array)) {
        throw new Error(`${name}/${partName}: missing or invalid ${attributeName}`);
      }
      const bytes = Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
      const viewIndex = views.length;
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
      const accessor = { bufferView: viewIndex, componentType: 5126, count: attribute.count, type: expectedSize === 1 ? 'SCALAR' : `VEC${expectedSize}` };
      if (attributeName === 'position') {
        const stat = geometryStats(geometry);
        accessor.min = stat.bounds.min; accessor.max = stat.bounds.max;
      }
      attributes[semantic] = accessors.length;
      accessors.push(accessor); chunks.push(bytes); offset += bytes.length;
    }

    const index = geometry.getIndex();
    let primitive = { attributes, mode: 4, material: partIndex };
    if (index) {
      const values = index.array;
      const IndexArray = values instanceof Uint32Array ? Uint32Array : Uint16Array;
      const converted = values instanceof IndexArray ? values : new IndexArray(values);
      while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
      const bytes = Buffer.from(converted.buffer, converted.byteOffset, converted.byteLength);
      const viewIndex = views.length;
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34963 });
      const accessorIndex = accessors.length;
      accessors.push({ bufferView: viewIndex, componentType: IndexArray === Uint32Array ? 5125 : 5123, count: converted.length, type: 'SCALAR' });
      primitive = { ...primitive, indices: accessorIndex };
      chunks.push(bytes); offset += bytes.length;
    }
    meshes.push({ name: `${name}-${partName}`, primitives: [primitive] });
    nodes.push({ name: `${name}-${partName}`, mesh: partIndex });
  }
  const materials = parts.map(({ name: partName, doubleSided }) => ({
    name: `palm-${partName}-vertex-paint`,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
    ...(doubleSided ? { doubleSided: true } : {}),
  }));
  const json = {
    asset: { version: '2.0', generator: 'Realms of Trade palm family v1: deterministic vertex-painted geometry' },
    scene: 0, scenes: [{ nodes: [0, 1] }], nodes, meshes, materials,
    buffers: [{ byteLength: offset }], bufferViews: views, accessors,
  };
  return makeGlb(json, Buffer.concat(chunks));
}

function inspectGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Generated invalid GLB header');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  if (json.nodes?.length !== 2 || json.meshes?.length !== 2 || json.images || json.textures || json.nodes.some((node) => 'translation' in node || 'rotation' in node || 'scale' in node || 'matrix' in node)) {
    throw new Error('Palm GLB must contain two transform-free meshes and no images');
  }
  return json;
}

const models = [];
for (let variant = 0; variant < PALM_STYLES.length; variant++) {
  const style = PALM_STYLES[variant];
  const name = `palm-${style}-v1`;
  const { trunk, fronds } = palmGeometry(variant, { cards: true });
  try {
    const partStats = {
      trunk: geometryStats(trunk),
      fronds: geometryStats(fronds),
    };
    const triangles = partStats.trunk.triangles + partStats.fronds.triangles;
    if (triangles > 1600) throw new Error(`${name} exceeds 1600 triangles (${triangles})`);
    const bytes = packPalm(name, [
      { name: 'trunk', geometry: trunk, doubleSided: false },
      { name: 'fronds', geometry: fronds, doubleSided: true },
    ]);
    const json = inspectGlb(bytes);
    if (bytes.length > 200 * 1024) throw new Error(`${name} exceeds 200 KiB (${bytes.length})`);
    models.push({
      style, name, file: `assets/models/${name}.glb`, bytes,
      sha256: hash(bytes), triangles, vertices: partStats.trunk.vertices + partStats.fronds.vertices,
      bounds: {
        min: [0, 1, 2].map((axis) => Math.min(partStats.trunk.bounds.min[axis], partStats.fronds.bounds.min[axis])),
        max: [0, 1, 2].map((axis) => Math.max(partStats.trunk.bounds.max[axis], partStats.fronds.bounds.max[axis])),
      },
      parts: partStats,
      meshCount: json.meshes.length,
    });
  } finally {
    trunk.dispose(); fronds.dispose();
  }
}

const receipt = {
  version: 1,
  recipe: 'palm-family-v1',
  recipeSha256,
  source: {
    reference: {
      original: 'materials/references/palmera tropical.png',
      copy: 'docs/art/source/palm-family-v1/reference.png',
      bytes: sourceBytes.length,
      sha256: sourceHash,
      copiedByteForByte: true,
    },
    geometry: { file: 'src/render/palmGeometry.js', bytes: geometryBytes.length, sha256: geometryHash },
    tool: { file: 'tools/prepare-palm-family.mjs', bytes: toolBytes.length, sha256: hash(toolBytes) },
  },
  geometryCodePath: 'src/render/palmGeometry.js:PALM_STYLES,palmGeometry',
  format: 'GLB 2.0; two transform-free meshes in trunk/fronds order; POSITION,NORMAL,COLOR_0,_FLEX,_PAINT,TEXCOORD_0; no images or textures',
  textureAtlasMapping: {
    receipt: 'docs/art/source/palm-textures-v1/receipt.json',
    atlas: 'assets/textures/palm-family-v1/{albedo,normal}-{desktop,mobile}.webp',
    tileOrder: ['trunk', 'leaf-a', 'leaf-b', 'coconut'],
    layout: '2x2; trunk top-left, leaf-a top-right, leaf-b bottom-left, coconut bottom-right; each tile uses an inset UV region to stay inside the 16 px desktop / 8 px mobile gutter',
    cropPixelsAtSource1254: {
      trunk: [32, 18, 163, 832],
      'leaf-a': [647, 6, 224, 584],
      'leaf-b': [856, 6, 221, 516],
      coconut: [396, 494, 124, 132],
    },
    uv: { inset: [1 / 64, 1 / 64], span: [15 / 32, 15 / 32], pixelOrigin: 'top-left with TextureLoader flipY=true' },
    meshAssignment: { trunk: ['trunk', 'coconut'], fronds: ['leaf-a', 'leaf-b'] },
  },
  materials: [
    { part: 'trunk', baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, doubleSided: false },
    { part: 'fronds', baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, doubleSided: true },
  ],
  budgets: { maxBytesPerModel: 200 * 1024, maxTrianglesPerModel: 1600 },
  models: models.map(({ style, file, bytes, sha256, triangles, vertices, bounds, parts, meshCount }) => ({
    style, file, bytes: bytes.length, sha256, triangles, vertices, bounds, parts, meshCount, images: 0,
  })),
};
const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');

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

verifyOrWrite(referenceFile, sourceBytes);
for (const model of models) verifyOrWrite(path.join(root, model.file), model.bytes);
const receiptFile = path.join(root, 'docs/art/source/palm-family-v1/receipt.json');
verifyOrWrite(receiptFile, receiptBytes);
if (check) {
  const copied = fs.readFileSync(referenceFile);
  if (!copied.equals(sourceBytes) || hash(copied) !== sourceHash) throw new Error('Source reference copy differs from original');
  for (const model of models) {
    const existing = fs.readFileSync(path.join(root, model.file));
    if (hash(existing) !== model.sha256) throw new Error(`Hash verification failed: ${model.file}`);
  }
  if (!fs.readFileSync(receiptFile).equals(receiptBytes)) throw new Error('Receipt verification failed');
}
console.log(JSON.stringify({ check, recipeSha256, sourceReferenceSha256: sourceHash, models: receipt.models }, null, 2));
