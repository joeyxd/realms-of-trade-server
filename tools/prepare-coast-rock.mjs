// Strip the geometry export's unverified baked material; retain a tiny, vertex-painted GLB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { readGlb, summarize } from './glb.mjs';
import { coastRockGeometry } from '../src/render/coastRockGeometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv[2] || '../asset-staging/s02-rock-export/project/out/SM_Rock.glb');
const original = fs.readFileSync(source);
const { json, bin } = readGlb(original);
if (!bin || json.skins?.length || json.animations?.length) throw new Error('Expected one static binary geometry export');

function glb(j, b) {
  let text = Buffer.from(JSON.stringify(j));
  const jp = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(jp);
  const bp = Buffer.alloc(Math.ceil(b.length / 4) * 4); b.copy(bp);
  const h = Buffer.alloc(20), bh = Buffer.alloc(8);
  h.writeUInt32LE(0x46546c67); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + jp.length + bp.length, 8);
  h.writeUInt32LE(jp.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bp.length); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jp, bh, bp]);
}
// Avoid loading an image in Node, and never mistake the NullRHI export's white material for art.
delete json.images; delete json.textures; delete json.samplers; delete json.extensionsUsed; delete json.extensionsRequired;
json.materials = [{ name: 'geometry-only', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }];
for (const mesh of json.meshes || []) for (const p of mesh.primitives) { p.material = 0; delete p.extensions; }
const stripped = glb(json, bin);
const loaded = await new GLTFLoader().parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '');
loaded.scene.updateMatrixWorld(true);
const parts = [];
loaded.scene.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.applyMatrix4(o.matrixWorld); parts.push(g);
});
if (!parts.length) throw new Error('No exported mesh');
const merged = mergeGeometries(parts, false);
const geo = coastRockGeometry(merged, 0);
const buffers = [], views = [], accessors = [];
let offset = 0;
const attrs = {};
for (const [name, semantic] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['color', 'COLOR_0']]) {
  const a = geo.attributes[name], b = Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength);
  views.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target: 34962 });
  const ac = { bufferView: views.length - 1, componentType: 5126, count: a.count, type: 'VEC3' };
  if (name === 'position') { ac.min = geo.boundingBox.min.toArray(); ac.max = geo.boundingBox.max.toArray(); }
  attrs[semantic] = accessors.length; accessors.push(ac); buffers.push(b); offset += b.length;
}
const runtimeJson = {
  asset: { version: '2.0', generator: 'Realms of Trade S02: Dreamrise SM_Rock geometry, vertex-painted derivative' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'CoastalRock', mesh: 0 }],
  meshes: [{ name: 'SM_Rock_coast_v1', primitives: [{ attributes: attrs, mode: 4, material: 0 }] }],
  materials: [{ name: 'coast-stone-vertex-paint', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  buffers: [{ byteLength: offset }], bufferViews: views, accessors,
};
const runtime = glb(runtimeJson, Buffer.concat(buffers));
const sourceDir = path.join(root, 'docs/art/source/coast-rock-v1');
fs.mkdirSync(sourceDir, { recursive: true });
function preserve(file, bytes) {
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw new Error(`Refusing to overwrite different art: ${file}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
}
preserve(path.join(sourceDir, 'SM_Rock.geometry-export.glb'), original);
for (const [name, origin] of [
  ['SM_Rock.unreal-report.json', path.join(path.dirname(source), 'SM_Rock.report.json')],
  ['export-stage-evidence.json', path.join(path.dirname(source), '..', 'evidence.json')],
]) if (fs.existsSync(origin)) preserve(path.join(sourceDir, name), fs.readFileSync(origin));
preserve(path.join(root, 'assets/models/coast-rock-v1.glb'), runtime);
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const report = { source: path.relative(root, source), sourceBytes: original.length, sourceSha256: hash(original),
  sourceSummary: summarize(readGlb(original)), runtime: 'assets/models/coast-rock-v1.glb', runtimeBytes: runtime.length,
  runtimeSha256: hash(runtime), runtimeSummary: summarize(readGlb(runtime)), variants: ['compact', 'ledge', 'low'],
  material: 'vertex paint + runtime toon; no exported texture or material accepted',
};
preserve(path.join(sourceDir, 'preparation.json'), Buffer.from(JSON.stringify(report, null, 2) + '\n'));
for (const g of parts) g.dispose(); merged.dispose(); geo.dispose();
console.log(JSON.stringify(report, null, 2));
