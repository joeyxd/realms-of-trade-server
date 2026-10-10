import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SOURCE_DIR = path.join(ROOT, 'materials', 'imported models');
const OUT_DIR = path.join(ROOT, 'assets', 'editor');
const BENCHMARK_DIR = path.join(ROOT, '.scratch', 'gm-assets', 'benchmarks');
const CATALOG_PATH = path.join(OUT_DIR, 'catalog.json');
const RECEIPT_PATH = path.join(ROOT, 'docs', 'art', 'gm00', 'receipts.json');
const FIT_SIZE = 4;
const SOURCES = {
  rock: { file: 'Tropical_Rock_Formation.glb', id: 'gm-rock', category: 'nature', label: { es: 'Formación rocosa tropical', en: 'Tropical rock formation' } },
  coral: { file: 'colorful coral reef 3d model.glb', id: 'gm-coral', category: 'nature', label: { es: 'Arrecife de coral colorido', en: 'Colorful coral reef' } },
};

const VARIANTS = [
  { source: 'rock', key: '2k', suffix: '2k', maxTexture: 2048, kind: 'texture', label: 'WebP 2K' },
  { source: 'rock', key: '1k', suffix: '1k', maxTexture: 1024, kind: 'texture', label: 'WebP 1K' },
  { source: 'coral', key: '2k', suffix: '2k', maxTexture: 2048, kind: 'texture', diagnostic: true, label: 'WebP 2K diagnostic' },
  { source: 'coral', key: '1k', suffix: '1k', maxTexture: 1024, kind: 'texture', diagnostic: true, label: 'WebP 1K diagnostic' },
  { source: 'coral', key: '200k', suffix: '200k-2k', maxTexture: 2048, kind: 'geometry', targetTriangles: 200_000, error: 0.002, label: '200K tris / WebP 2K' },
  { source: 'coral', key: '50k', suffix: '50k-2k', maxTexture: 2048, kind: 'geometry', targetTriangles: 50_000, error: 0.01, label: '50K tris / WebP 2K' },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }

function glbJson(data) {
  const buffer = Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
  if (buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2) throw new Error('Expected binary glTF 2.0');
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
}

function getTriangleCount(doc) {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mode = prim.getMode();
    const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
    if (mode === 4) total += Math.floor(count / 3);
    else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
  }
  return total;
}

function getBounds(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const lo = pos.getMin([]), hi = pos.getMax([]);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min: min.map(n => +n.toFixed(7)), max: max.map(n => +n.toFixed(7)), size: max.map((n, i) => +(n - min[i]).toFixed(7)), fitSize: FIT_SIZE };
}

async function getTextureStats(doc) {
  const images = [];
  for (const texture of doc.getRoot().listTextures()) {
    const bytes = texture.getImage();
    const info = await sharp(bytes, { animated: false }).metadata();
    images.push({ name: texture.getName() || null, mimeType: texture.getMimeType() || null, width: info.width, height: info.height, bytes: bytes.byteLength });
  }
  return images;
}

async function compressImages(doc, maxTexture) {
  // Source assets are always reread directly. Quality 95 avoids lossless WebP
  // inflation observed on already-compressed 4K source maps.
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTexture, maxTexture], quality: 95, effort: 6 }));
}

function sumImageBytes(images) { return images.reduce((sum, image) => sum + image.bytes, 0); }

async function prepareOne(sourceKey, variant) {
  const source = SOURCES[sourceKey];
  const sourcePath = path.join(SOURCE_DIR, source.file);
  const sourceBytes = await readFile(sourcePath);
  const sourceDoc = await io.read(sourcePath);
  const sourceJson = glbJson(sourceBytes);
  const sourceStats = { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes), triangles: getTriangleCount(sourceDoc), textures: await getTextureStats(sourceDoc), bounds: getBounds(sourceDoc), extensionsUsed: sourceJson.extensionsUsed ?? [], extensionsRequired: sourceJson.extensionsRequired ?? [] };
  const doc = await io.read(sourcePath);
  await compressImages(doc, variant.maxTexture);
  if (variant.targetTriangles) {
    const before = getTriangleCount(doc);
    const ratio = variant.targetTriangles / before;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: variant.error }));
  }
  const outputBytes = await io.writeBinary(doc);
  const outputHash = sha256(outputBytes);
  const outName = `${source.id}-${variant.suffix}-${outputHash.slice(0, 12)}.glb`;
  const outputDir = variant.diagnostic ? BENCHMARK_DIR : OUT_DIR;
  const outPath = path.join(outputDir, outName);
  const relativeOutput = path.relative(ROOT, outPath).replaceAll('\\', '/');
  await writeFile(outPath, outputBytes);
  const textureStats = await getTextureStats(doc);
  const outputTriangles = getTriangleCount(doc);
  const outputJson = glbJson(outputBytes);
  const droppedOptionalExtensions = sourceStats.extensionsUsed.filter(name => !(outputJson.extensionsUsed ?? []).includes(name) && !(sourceJson.extensionsRequired ?? []).includes(name));
  const metric = {
    source: { file: source.file, ...sourceStats },
    output: { file: relativeOutput, bytes: outputBytes.byteLength, sha256: outputHash, triangles: outputTriangles, textures: textureStats, bounds: getBounds(doc), extensionsUsed: outputJson.extensionsUsed ?? [] },
    droppedOptionalExtensions,
    recipe: {
      format: 'GLB + EXT_texture_webp', textureMax: variant.maxTexture,
      textures: 'WebP quality 95 effort 6, direct from untouched source maps',
      geometry: variant.targetTriangles ? { method: 'meshoptimizer simplify via glTF Transform', targetTriangles: variant.targetTriangles, ratio: +((variant.targetTriangles / sourceStats.triangles).toFixed(8)), error: variant.error, normalBake: false } : null,
      fit: { mode: 'size', size: FIT_SIZE },
    },
  };
  return { source, sourceKey, variant, metric };
}

async function prepare() {
  await MeshoptSimplifier.ready;
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(BENCHMARK_DIR, { recursive: true });
  await mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
  const results = [];
  for (const variant of VARIANTS) results.push(await prepareOne(variant.source, variant));
  const assets = results.filter(r => !r.variant.diagnostic).map(({ source, sourceKey, variant, metric }) => ({
    id: `model:${source.id}-${variant.key}`,
    groupId: `model:${source.id}`,
    kind: 'model',
    src: metric.output.file.replace(/^assets\//, ''),
    fit: 'size', size: FIT_SIZE,
    label: { es: source.label.es, en: source.label.en },
    category: source.category,
    status: 'candidate',
    variant: { key: variant.key, label: variant.label, optimization: variant.kind },
    stats: { bytes: metric.output.bytes, triangles: metric.output.triangles, textures: metric.output.textures.length, textureBytes: sumImageBytes(metric.output.textures), sourceBytes: metric.source.bytes, sourceTriangles: metric.source.triangles, sourceSha256: metric.source.sha256, sha256: metric.output.sha256, bounds: metric.output.bounds },
  }));
  const pkg = JSON.parse(await readFile(path.join(HERE, 'package.json'), 'utf8'));
  const receipt = { version: 1, generatedBy: 'tools/gm-assets/gm-assets.mjs', toolchain: pkg.dependencies, visualReview: 'pending', originalsModified: false, assets: results.map(r => ({ id: `model:${r.source.id}-${r.variant.key}`, diagnostic: !!r.variant.diagnostic, ...r.metric })) };
  await writeFile(CATALOG_PATH, `${JSON.stringify({ version: 1, assets }, null, 2)}\n`);
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ variants: assets.length, outputs: assets.map(a => ({ id: a.id, bytes: a.stats.bytes, triangles: a.stats.triangles, sourceTriangles: a.stats.sourceTriangles, textureBytes: a.stats.textureBytes, sha256: a.stats.sha256 })) }, null, 2));
}

async function check() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  if (catalog.version !== 1 || !Array.isArray(catalog.assets) || catalog.assets.length !== VARIANTS.filter(v => !v.diagnostic).length) throw new Error('Catalog schema/count mismatch');
  if (receipt.visualReview !== 'pending' || receipt.originalsModified !== false) throw new Error('Receipt review/source guard mismatch');
  for (const row of receipt.assets) {
    const outputPath = path.resolve(ROOT, row.output.file);
    const allowedRoot = row.diagnostic ? BENCHMARK_DIR : OUT_DIR;
    if (!outputPath.startsWith(allowedRoot + path.sep)) throw new Error(`Receipt output escaped its allowed area: ${row.output.file}`);
    const output = await readFile(outputPath);
    if (sha256(output) !== row.output.sha256 || output.byteLength !== row.output.bytes) throw new Error(`Receipt hash/size mismatch: ${row.id}`);
    if (!path.basename(row.output.file).includes(row.output.sha256.slice(0, 12))) throw new Error(`Output filename is not content-addressed: ${row.output.file}`);
  }
  for (const asset of catalog.assets) {
    const target = path.resolve(ROOT, 'assets', asset.src);
    if (!target.startsWith(OUT_DIR + path.sep)) throw new Error(`Output escaped assets/editor: ${asset.src}`);
    const bytes = await readFile(target);
    if (sha256(bytes) !== asset.stats.sha256 || bytes.byteLength !== asset.stats.bytes) throw new Error(`Hash/size mismatch: ${asset.id}`);
    const doc = await io.read(target);
    const triangles = getTriangleCount(doc);
    if (triangles !== asset.stats.triangles) throw new Error(`Triangle count mismatch: ${asset.id}`);
    if (!doc.getRoot().listExtensionsUsed().some(ext => ext.extensionName === 'EXT_texture_webp')) throw new Error(`WebP extension missing: ${asset.id}`);
    const record = receipt.assets.find(x => x.id === asset.id);
    if (asset.stats.sourceSha256 !== record?.source.sha256) throw new Error(`Source hash receipt mismatch: ${asset.id}`);
    const sourceBytes = await readFile(path.join(SOURCE_DIR, record.source.file));
    if (sha256(sourceBytes) !== record.source.sha256) throw new Error(`Source changed since preparation: ${record.source.file}`);
    const textures = await getTextureStats(doc);
    if (textures.length !== asset.stats.textures || textures.some(t => t.mimeType !== 'image/webp' || t.width > record.recipe.textureMax || t.height > record.recipe.textureMax)) throw new Error(`Texture format/dimension budget failed: ${asset.id}`);
    if (doc.getRoot().listMaterials().length !== 1 || doc.getRoot().listMaterials().some(m => !m.getNormalTexture())) throw new Error(`Material or normal-map preservation failed: ${asset.id}`);
    if (asset.fit !== 'size' || asset.size !== FIT_SIZE || !record.source.bounds || !record.output.bounds) throw new Error(`Fit reference missing: ${asset.id}`);
    if (asset.variant.optimization === 'geometry') {
      const range = asset.variant.key === '200k' ? [150_000, 250_000] : [30_000, 60_000];
      if (triangles < range[0] || triangles > range[1] || record.recipe.geometry?.normalBake !== false) throw new Error(`Geometry candidate gate failed: ${asset.id}`);
    } else if (triangles !== record.source.triangles) throw new Error(`Texture-only variant changed geometry: ${asset.id}`);
    if (record.source.extensionsRequired.some(name => record.droppedOptionalExtensions.includes(name))) throw new Error(`Required source extension was dropped: ${asset.id}`);
    if (asset.groupId !== asset.id.slice(0, asset.id.lastIndexOf('-'))) throw new Error(`Unexpected grouping: ${asset.id}`);
  }
  console.log(`Validated ${catalog.assets.length} candidate GLBs, hashes, triangle counts, WebP extension, and source receipts.`);
}

const command = process.argv[2] ?? 'prepare';
if (command === 'prepare') await prepare();
else if (command === 'check') await check();
else throw new Error(`Unknown command: ${command}`);
