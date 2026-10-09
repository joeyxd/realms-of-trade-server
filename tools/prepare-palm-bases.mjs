// Build deterministic palm-base GLBs; --draft writes only the isolated review directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { palmBaseGeometry, PALM_BASE_STYLES } from '../src/render/palmBaseGeometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const draft = process.argv.includes('--draft');
const check = process.argv.includes('--check');
if ((draft && check) || process.argv.length > 3 || (process.argv.length === 3 && !draft && !check)) {
  throw new Error('Usage: node tools/prepare-palm-bases.mjs [--draft|--check]');
}
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFile = path.join(root, 'materials/references/palmera tropical.png');
const referenceFile = path.join(root, 'docs/art/source/palm-bases-v1/reference.png');
const geometryFile = path.join(root, 'src/render/palmBaseGeometry.js');
const toolFile = fileURLToPath(import.meta.url);
const sourceBytes = fs.readFileSync(sourceFile);
const geometryBytes = fs.readFileSync(geometryFile);
const toolBytes = fs.readFileSync(toolFile);
const recipeSha256 = hash(Buffer.concat([
  Buffer.from('palm-bases-v1\0'), geometryBytes, Buffer.from([0]), toolBytes,
]));
const draftRevision = recipeSha256.slice(0, 12);

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

function partStats(geometry) {
  geometry.computeBoundingBox();
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const elements = index ? index.count : position.count;
  if (elements % 3) throw new Error('Part element count is not divisible by three');
  return { sourceVertices: position.count, triangles: elements / 3, bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() } };
}

function packModel(name, parts) {
  const views = [], accessors = [], chunks = [], meshes = [], nodes = [];
  const compactVertices = {};
  let offset = 0;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const { name: partName, geometry, doubleSided } = parts[partIndex];
    const attributes = {};
    const specs = [
      ['position', 'POSITION', 3], ['normal', 'NORMAL', 3], ['color', 'COLOR_0', 3],
      ['uv', 'TEXCOORD_0', 2], ['aFlex', '_FLEX', 1], ['aPaint', '_PAINT', 2],
    ];
// Source geometry is triangle-expanded; exact attribute tuples safely share identical vertices in the GLB.
    const unique = new Map(), compact = Object.fromEntries(specs.map(([attributeName]) => [attributeName, []]));
    const remappedIndices = [];
    const sourcePosition = geometry.getAttribute('position');
    const sourceIndex = geometry.getIndex();
    const sourceElements = sourceIndex ? sourceIndex.array : Array.from({ length: sourcePosition.count }, (_, i) => i);
    for (const vertex of sourceElements) {
      const tuple = specs.map(([attributeName]) => {
        const attribute = geometry.getAttribute(attributeName);
        if (!attribute) throw new Error(`${name}/${partName}: missing ${attributeName}`);
        return Array.from(attribute.array.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize));
      });
      const key = tuple.flat().join(',');
      let compactIndex = unique.get(key);
      if (compactIndex === undefined) {
        compactIndex = unique.size;
        unique.set(key, compactIndex);
        tuple.forEach((values, i) => compact[specs[i][0]].push(...values));
      }
      remappedIndices.push(compactIndex);
    }
    for (const [attributeName, semantic, itemSize] of specs) {
      const attribute = geometry.getAttribute(attributeName);
      if (!attribute || attribute.itemSize !== itemSize || !attribute.count || !(attribute.array instanceof Float32Array)) {
        throw new Error(`${name}/${partName}: missing or invalid ${attributeName}`);
      }
      const values = compact[attributeName];
      let compactArray = new Float32Array(values), componentType = 5126, normalized = false;
      if (attributeName === 'color' || attributeName === 'aFlex' || attributeName === 'aPaint') {
        compactArray = new Uint8Array(values.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255)));
        componentType = 5121; normalized = true;
      } else if (attributeName === 'uv') {
        compactArray = new Uint16Array(values.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 65535)));
        componentType = 5123; normalized = true;
      }
      // Every bufferView and every vertex element uses a four-byte-aligned layout.
      while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
      const elementBytes = itemSize * compactArray.BYTES_PER_ELEMENT;
      const stride = Math.ceil(elementBytes / 4) * 4;
      const count = compactArray.length / itemSize;
      const bytes = Buffer.alloc(count * stride);
      const packed = Buffer.from(compactArray.buffer, compactArray.byteOffset, compactArray.byteLength);
      for (let vertex = 0; vertex < count; vertex++) packed.copy(bytes, vertex * stride, vertex * elementBytes, (vertex + 1) * elementBytes);
      const viewIndex = views.length;
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, byteStride: stride, target: 34962 });
      const accessor = { bufferView: viewIndex, componentType, ...(normalized ? { normalized: true } : {}), count, type: itemSize === 1 ? 'SCALAR' : `VEC${itemSize}` };
      if (attributeName === 'position') {
        const stats = partStats(geometry); accessor.min = stats.bounds.min; accessor.max = stats.bounds.max;
      }
      attributes[semantic] = accessors.length;
      accessors.push(accessor); chunks.push(bytes); offset += bytes.length;
    }
    let primitive = { attributes, mode: 4, material: partIndex };
    const ArrayType = unique.size > 65535 ? Uint32Array : Uint16Array;
    compactVertices[partName] = unique.size;
    const indices = new ArrayType(remappedIndices);
    while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
    const indexBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
    const viewIndex = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.length, target: 34963 });
    const accessorIndex = accessors.length;
    accessors.push({ bufferView: viewIndex, componentType: ArrayType === Uint32Array ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
    primitive = { ...primitive, indices: accessorIndex };
    chunks.push(indexBytes); offset += indexBytes.length;
    meshes.push({ name: `${name}-${partName}`, primitives: [primitive] });
    nodes.push({ name: `${name}-${partName}`, mesh: partIndex });
  }
  const materials = parts.map(({ name: partName, doubleSided }) => ({
    name: `palm-base-${partName}-vertex-paint`,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
    ...(doubleSided ? { doubleSided: true } : {}),
  }));
  return { bytes: makeGlb({
    asset: { version: '2.0', generator: 'Realms of Trade palm bases v1: deterministic geometry' },
    scene: 0, scenes: [{ nodes: [0, 1] }], nodes, meshes, materials,
    buffers: [{ byteLength: offset }], bufferViews: views, accessors,
  }, Buffer.concat(chunks)), compactVertices };
}

function inspectGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  if (json.nodes?.length !== 2 || json.meshes?.length !== 2 || json.images || json.textures || json.nodes.some((node) => ['translation', 'rotation', 'scale', 'matrix'].some((k) => k in node))) {
    throw new Error('Palm-base GLB requires two transform-free meshes and no embedded images');
  }
  if ((json.bufferViews || []).some((view) => (view.byteOffset || 0) % 4 !== 0)) throw new Error('GLB bufferView offset is not four-byte aligned');
  if ((json.bufferViews || []).some((view) => view.target === 34962 && (!view.byteStride || view.byteStride % 4 !== 0))) throw new Error('Vertex attribute element stride is not four-byte aligned');
  for (const mesh of json.meshes) {
    const accessorIndex = mesh.primitives?.[0]?.attributes?.NORMAL;
    const normal = json.accessors?.[accessorIndex];
    if (!normal || normal.componentType !== 5126 || normal.type !== 'VEC3') throw new Error('NORMAL must use float32 VEC3 without KHR_mesh_quantization');
  }
  return json;
}

const models = PALM_BASE_STYLES.map((style, variant) => {
  const name = `palm-base-${style}-v1`;
  const { roots, leaves } = palmBaseGeometry(variant, { cards: true });
  try {
    const parts = { roots: partStats(roots), leaves: partStats(leaves) };
    const triangles = parts.roots.triangles + parts.leaves.triangles;
    if (triangles > 600) throw new Error(`${name} exceeds 600 triangles (${triangles})`);
    const packed = packModel(name, [
      { name: 'roots', geometry: roots, doubleSided: false },
      { name: 'leaves', geometry: leaves, doubleSided: true },
    ]);
    const bytes = packed.bytes;
    const json = inspectGlb(bytes);
    if (bytes.length > 80 * 1024 && !draft) throw new Error(`${name} exceeds 80 KiB (${bytes.length})`);
    return {
      style, name, bytes, sha256: hash(bytes), triangles,
      sourceVertices: parts.roots.sourceVertices + parts.leaves.sourceVertices,
      compactVertices: packed.compactVertices.roots + packed.compactVertices.leaves,
      compactPartVertices: packed.compactVertices,
      bounds: {
        min: [0, 1, 2].map((axis) => Math.min(parts.roots.bounds.min[axis], parts.leaves.bounds.min[axis])),
        max: [0, 1, 2].map((axis) => Math.max(parts.roots.bounds.max[axis], parts.leaves.bounds.max[axis])),
      },
      parts, meshes: json.meshes.length,
    };
  } finally {
    roots.dispose(); leaves.dispose();
  }
});

const finalModels = models.map(({ style, name, bytes, sha256, triangles, sourceVertices, compactVertices, compactPartVertices, bounds, parts, meshes }) => ({
  style, file: `assets/models/${name}.glb`, bytes: bytes.length, sha256, triangles, sourceVertices, compactVertices, compactPartVertices, bounds, parts, meshes, images: 0,
}));
const draftModels = models.map((model) => ({
  ...finalModels.find((entry) => entry.style === model.style),
  file: `docs/art/palm-bases/draft-models/${draftRevision}/${model.name}.glb`,
}));
const finalReceipt = {
  version: 1,
  recipe: 'palm-bases-v1',
  recipeSha256,
  source: {
    reference: { original: 'materials/references/palmera tropical.png', copy: 'docs/art/source/palm-bases-v1/reference.png', bytes: sourceBytes.length, sha256: hash(sourceBytes), copiedByteForByte: true },
    geometry: { file: 'src/render/palmBaseGeometry.js', bytes: geometryBytes.length, sha256: hash(geometryBytes) },
    tool: { file: 'tools/prepare-palm-bases.mjs', bytes: toolBytes.length, sha256: hash(toolBytes) },
  },
  geometryCodePath: 'src/render/palmBaseGeometry.js:PALM_BASE_STYLES,palmBaseGeometry',
  format: 'GLB 2.0; two transform-free meshes in roots/leaves order; POSITION,NORMAL,COLOR_0,TEXCOORD_0,_FLEX,_PAINT; no embedded images',
  atlasMapping: {
    roots: { atlas: 'assets/textures/palm-family-v1/{albedo,normal}-{desktop,mobile}.webp', quadrant: 'top-left; shares the S05 trunk tile', uvInset: [1 / 64, 1 / 64], uvSpan: [15 / 32, 15 / 32] },
    leaves: { atlas: 'assets/textures/palm-base-v1/{albedo,normal}-{pc,mobile}.webp', layout: 'two equal horizontal tiles, one per half of U; UV inset [1/64,1/32], span [15/32,15/16]; desktop 512x256, mobile 256x128' },
  },
  materials: [
    { part: 'roots', baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, doubleSided: false },
    { part: 'leaves', baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, doubleSided: true },
  ],
  attributeEncoding: { position: 'FLOAT32 stride12', normal: 'FLOAT32 VEC3 stride12; no KHR_mesh_quantization', color: 'UNORM8 VEC3 stride4 padded', uv: 'UNORM16 VEC2 stride4', aFlex: 'UNORM8 scalar stride4 padded', aPaint: 'UNORM8 VEC2 stride4 padded', bufferViewAlignmentBytes: 4, vertexElementStrideAlignmentBytes: 4 },
  budgets: { maxBytesPerModel: 80 * 1024, maxTrianglesPerModel: 600 },
  models: finalModels,
};

const draftReceipt = Buffer.from(JSON.stringify({ ...finalReceipt, models: draftModels, draft: true, outputs: draftModels }, null, 2) + '\n');
const finalReceiptBytes = Buffer.from(JSON.stringify(finalReceipt, null, 2) + '\n');
const draftDir = path.join(root, 'docs/art/palm-bases/draft-models', draftRevision);
const draftOutputs = [
  ...models.map((model) => [path.join(draftDir, `${model.name}.glb`), model.bytes]),
  [path.join(draftDir, 'receipt.json'), draftReceipt],
];
const finalOutputs = [
  [referenceFile, sourceBytes],
  ...models.map((model) => [path.join(root, `assets/models/${model.name}.glb`), model.bytes]),
  [path.join(root, 'docs/art/source/palm-bases-v1/receipt.json'), finalReceiptBytes],
];
const outputs = draft ? draftOutputs : finalOutputs;

// Check every destination before any write, and never replace even a differing draft artifact.
for (const [file, bytes] of outputs) {
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw new Error(`Refusing to replace differing output: ${path.relative(root, file)}`);
  if (check && !fs.existsSync(file)) throw new Error(`--check expected existing output: ${path.relative(root, file)}`);
}
if (!check) {
  for (const [file, bytes] of outputs) {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx' });
    }
  }
}
for (const [file, bytes] of outputs) if (!fs.readFileSync(file).equals(bytes)) throw new Error(`Output verification failed: ${path.relative(root, file)}`);

console.log(JSON.stringify({ draft, check, recipeSha256, referenceSha256: hash(sourceBytes), models: draft ? draftModels : finalModels }, null, 2));
