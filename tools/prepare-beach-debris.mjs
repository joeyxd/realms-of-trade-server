// Adapt the audited log mesh and export the small painted branch/log/plank kit, without textures.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEBRIS_STYLES, debrisGeometry, loadedDebrisGeometry } from '../src/render/beachDebrisGeometry.js';
import { readGlb, summarize } from './glb.mjs';

const root = new URL('../', import.meta.url), check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw Error('Usage: node tools/prepare-beach-debris.mjs [--check]');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'docs/art/source/beach-debris-v1/SM_Logs.geometry-export.glb';
const sourceBytes = fs.readFileSync(new URL(sourcePath, root));
const parsed = await new GLTFLoader().parseAsync(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength), '');
let source;
parsed.scene.traverse((o) => { if (o.isMesh && !source) source = o.geometry.clone().applyMatrix4(o.matrixWorld); });
if (!source) throw Error('Audited SM_Logs export has no geometry');

function pack(name, geo) {
  const views = [], accessors = [], chunks = [], attributes = {};
  let offset = 0;
  for (const [attributeName, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['color', 'COLOR_0']]) {
    const attribute = geo.attributes[attributeName], bytes = Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
    const accessor = { bufferView: views.length - 1, componentType: 5126, count: attribute.count, type: 'VEC3' };
    if (attributeName === 'position') { accessor.min = geo.boundingBox.min.toArray(); accessor.max = geo.boundingBox.max.toArray(); }
    attributes[semantic] = accessors.length; accessors.push(accessor); chunks.push(bytes); offset += bytes.length;
  }
  const primitive = { attributes, mode: 4, material: 0 };
  if (geo.index) {
    const values = new Uint16Array(geo.index.array), bytes = Buffer.from(values.buffer);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34963 });
    primitive.indices = accessors.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5123, count: values.length, type: 'SCALAR' });
    chunks.push(bytes); offset += bytes.length;
  }
  const json = { asset: { version: '2.0', generator: 'Realms of Trade S09 painted beach kit' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives: [primitive] }],
    materials: [{ name: 'opaque-vertex-paint', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: offset }], bufferViews: views, accessors };
  const text = Buffer.from(JSON.stringify(json)), j = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(j);
  const binary = Buffer.concat(chunks), b = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(b);
  const head = Buffer.alloc(20), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + j.length + b.length, 8);
  head.writeUInt32LE(j.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, j, bh, b]);
}

const outputs = [], models = [];
for (const [i, style] of DEBRIS_STYLES.entries()) {
  const geo = debrisGeometry(i, i === 2 ? source : null), validated = loadedDebrisGeometry(geo);
  if (!validated) throw Error('Unsafe geometry: ' + style); validated.dispose();
  const name = `beach-debris-${style}-v1`, bytes = pack(name, geo), stats = summarize(readGlb(bytes));
  if (stats.tris > 250 || bytes.length > 32 * 1024) throw Error('Beach model exceeds budget: ' + name);
  const relative = `assets/models/${name}.glb`;
  outputs.push({ relative, bytes }); models.push({ style, file: relative, bytes: bytes.length, sha256: hash(bytes), triangles: stats.tris,
    bounds: { min: geo.boundingBox.min.toArray(), max: geo.boundingBox.max.toArray() }, source: i === 2 ? sourcePath : 'native painted geometry' });
  geo.dispose();
}
source.dispose(); parsed.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
const receipt = { version: 1, cut: 'S09', family: 'beach-debris-v1', source: { file: sourcePath, bytes: sourceBytes.length, sha256: hash(sourceBytes) },
  geometrySha256: hash(fs.readFileSync(new URL('src/render/beachDebrisGeometry.js', root))),
  toolSha256: hash(fs.readFileSync(new URL(import.meta.url))), models };
outputs.push({ relative: 'docs/art/source/beach-debris-v1/runtime-models.json', bytes: Buffer.from(JSON.stringify(receipt, null, 2) + '\n') });
for (const { relative, bytes } of outputs) {
  const file = new URL(relative, root);
  if (fs.existsSync(file)) { if (!fs.readFileSync(file).equals(bytes)) throw Error('Existing S09 output differs: ' + relative); }
  else if (check) throw Error('Missing S09 output: ' + relative);
}
if (!check) for (const { relative, bytes } of outputs) { const file = new URL(relative, root); if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' }); }
console.log(JSON.stringify({ check, models, totalBytes: models.reduce((n, m) => n + m.bytes, 0) }, null, 2));
