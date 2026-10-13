// Stages the explicitly mapped item GLBs and creates conservative visual-size derivatives.
// Default runs read only the preserved source GLBs; pass --stage-from <dir> to intake them once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readGlb, summarize } from './glb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/delivery/item-models-v1/optimization.json');
const assetDir = path.join(root, 'assets/models/items-v1');
const args = process.argv.slice(2);
const stageAt = args.indexOf('--stage-from');
const stageFrom = stageAt >= 0 ? path.resolve(args[stageAt + 1] || '') : null;
if (stageAt >= 0 && !args[stageAt + 1]) throw new Error('--stage-from requires an explicit source directory');

// All named inputs are canonical archived sources; Downloads is used only for explicit staging.
const sources = [
  { download: 'amber gemstone 3d model.glb', source: 'docs/art/source/torch-resin-coconut-v1/resina/resina-v1.glb', id: 'resina', assigned: true },
  { download: 'wooden club 3d model.glb', source: 'docs/art/source/torch-resin-coconut-v1/antorcha/antorcha-v1.glb', id: 'antorcha', assigned: true },
  { download: 'coconut 3d model.glb', source: 'docs/art/source/torch-resin-coconut-v1/coco/coco-v1.glb', id: 'coco', assigned: true },
  { download: 'lime 3d model.glb', source: 'docs/art/source/cooking-items-v1/lima/lima-v1.glb', id: 'lima', assigned: true },
  { download: 'chili powder sack 3d model.glb', source: 'docs/art/source/cooking-items-v1/especias/especias-v1.glb', id: 'especias', assigned: true },
  { download: 'wooden beer mug 3d model.glb', source: 'docs/art/source/cooking-items-v1/meal_grog/meal_grog-v1.glb', id: 'meal_grog', assigned: true },
  { download: 'orange striped fish 3d model.glb', source: 'docs/art/source/cooking-items-v1/meal_roastFish/meal_roastFish-v1.glb', id: 'meal_roastFish', assigned: true },
  { download: 'bamboo stalk 3d model.glb', source: 'docs/art/source/cooking-items-v1/cana/cana-v1.glb', id: 'cana', assigned: true },
  { download: 'herb bundle 3d model.glb', source: 'docs/art/source/cooking-items-v1/hierbas_aromaticas/hierbas_aromaticas-v1.glb', id: 'hierbas_aromaticas', assigned: true },
  { download: 'bread loaf 3d model.glb', source: 'docs/art/source/cooking-items-v1/meal_heartyBiscuit/meal_heartyBiscuit-v1.glb', id: 'meal_heartyBiscuit', assigned: true, mappingBasis: 'working visual-reference mapping; rounded baked item fits the meal slot, while visible perforations differ from the existing biscuit art' },
  { download: 'blue ceramic vase 3d model.glb', source: 'docs/art/source/cooking-items-v1/agua/agua-v1.glb', id: 'agua', assigned: true, mappingBasis: 'working visual-reference mapping; blue stoppered vessel matches the water-jar silhouette, though the mesh reads as glazed ceramic and shows no water' },
  { download: 'rice+sack+3d+model.glb', source: 'docs/art/source/cooking-items-v1/harina/harina-v1.glb', id: 'harina', assigned: true, mappingBasis: 'working visual-reference mapping; white-filled sack matches the flour-sack silhouette, while visible grains suggest rice' },
];

const gmRequire = createRequire(path.join(root, 'tools/gm-assets/package.json'));
const gmModules = path.join(root, 'tools/gm-assets/node_modules');
const loadPackage = async (name) => import(pathToFileURL(gmRequire.resolve(name)));
const [{ NodeIO }, { KHRMaterialsVolume, EXTTextureWebP }, functions, sharpModule] = await Promise.all([
  loadPackage('@gltf-transform/core'),
  loadPackage('@gltf-transform/extensions'),
  loadPackage('@gltf-transform/functions'),
  loadPackage('sharp'),
]);
const sharp = sharpModule.default;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const mb = (bytes) => Number((bytes / 1048576).toFixed(4));
function writeImmutable(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (sha256(existing) !== sha256(bytes)) throw new Error(`refusing to overwrite non-identical file: ${path.relative(root, file)}`);
    return { created: false, bytes: existing.length, sha256: sha256(existing) };
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, bytes, { flag: 'wx' });
  try { fs.renameSync(temp, file); } catch (error) { if (fs.existsSync(temp)) fs.rmSync(temp); throw error; }
  return { created: true, bytes: bytes.length, sha256: sha256(bytes) };
}
function extensionPayloads(json) {
  const payloads = new Map();
  function visit(value, insidePayload = false) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extensionsUsed' || key === 'extensionsRequired') continue;
      if (/^(KHR_|EXT_|FB_)/.test(key)) payloads.set(key, true);
      visit(child, insidePayload);
    }
  }
  visit(json);
  return [...payloads.keys()];
}
function accessorFingerprint(doc) {
  const hash = crypto.createHash('sha256');
  let values = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const semantics = primitive.listSemantics();
    const accessors = primitive.listAttributes();
    for (let i = 0; i < accessors.length; i++) {
      const accessor = accessors[i], array = accessor.getArray();
      hash.update(`attribute:${semantics[i]}:${accessor.getType()}:${accessor.getCount()};`);
      if (array) { hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)); values += array.length; }
    }
    const indices = primitive.getIndices();
    if (indices) {
      const array = indices.getArray();
      hash.update(`indices:${indices.getType()}:${indices.getCount()};`);
      if (array) { hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)); values += array.length; }
    } else hash.update('indices:none;');
  }
  return { sha256: hash.digest('hex'), values };
}
function colorFactors(doc) {
  return doc.getRoot().listMaterials().map((material) => ({
    name: material.getName() || '',
    baseColor: material.getBaseColorFactor(),
    emissive: material.getEmissiveFactor(),
    alphaMode: material.getAlphaMode(),
    alphaCutoff: material.getAlphaCutoff(),
    doubleSided: material.getDoubleSided(),
  }));
}
function factorHash(doc) { return sha256(Buffer.from(JSON.stringify(colorFactors(doc)))); }
function principalAxis(doc) {
  const positions = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives().map((primitive) => ({
    position: primitive.getAttribute('POSITION')?.getArray(),
  }))).find((entry) => entry.position)?.position;
  if (!positions || positions.length < 9 || positions.length % 3) return null;
  const count = positions.length / 3, mean = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) mean[k] += positions[i + k] / count;
  const covariance = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i] - mean[0], positions[i + 1] - mean[1], positions[i + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) covariance[r][c] += p[r] * p[c] / count;
  }
  let axis = [1, 1, 1];
  for (let step = 0; step < 32; step++) {
    const next = covariance.map((row) => row.reduce((sum, value, i) => sum + value * axis[i], 0));
    const norm = Math.hypot(...next);
    if (!norm) return null;
    axis = next.map((v) => v / norm);
  }
  // Eigenvectors are sign-ambiguous; choose +Y as the tentative top direction.
  if (axis[1] < 0) axis = axis.map((v) => -v);
  const rotZ = Math.atan2(axis[0], axis[1]);
  const planar = Math.hypot(axis[0], axis[1]);
  const rotX = Math.atan2(-axis[2], planar);
  const round = (v) => Number(v.toFixed(5));
  return {
    principalAxis: axis.map(round),
    localBoundsSourceUnits: 'glTF POSITION accessors; no node transforms applied',
    suggestedEulerDegreesForAxisToPlusY: { rotX: round(rotX * 180 / Math.PI), rotZ: round(rotZ * 180 / Math.PI) },
    ambiguity: 'PCA sign cannot identify which end is the wrapped torch head; confirm top direction in the browser fixture before applying a rotation.',
  };
}
function imageDimensions(image) {
  return sharp(Buffer.from(image)).metadata().then((meta) => ({ width: meta.width, height: meta.height, format: meta.format }));
}
function materialTextureAudit(doc) {
  return doc.getRoot().listMaterials().map((material) => {
    const texture = material.getBaseColorTexture();
    return { material: material.getName() || '(unnamed)', baseColorTexture: texture?.getName() || '(unnamed)', mimeType: texture?.getMimeType() || '', hasNormal: !!material.getNormalTexture(), hasMetallicRoughness: !!material.getMetallicRoughnessTexture() };
  });
}
async function readPreservedSource(io, bytes) {
  const jsonDoc = await io.binaryToJSON(bytes);
  const required = jsonDoc.json.extensionsRequired || [];
  if (required.includes('FB_ngon_encoding')) throw new Error('FB_ngon_encoding is required; cannot safely discard it');
  jsonDoc.json.extensionsUsed = (jsonDoc.json.extensionsUsed || []).filter((name) => name !== 'FB_ngon_encoding');
  return io.readJSON(jsonDoc);
}

async function stageSources() {
  if (!stageFrom) return [];
  const staged = [];
  for (const entry of sources) {
    const input = path.join(stageFrom, entry.download), output = path.join(root, entry.source);
    if (!fs.existsSync(input)) throw new Error(`missing explicit intake source: ${input}`);
    const bytes = fs.readFileSync(input);
    if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${input}`);
    const result = writeImmutable(output, bytes);
    staged.push({ input: path.resolve(input), output: entry.source, bytes: result.bytes, sha256: result.sha256, copied: result.created });
  }
  return staged;
}

async function makeVariant(sourceFile, expectedGeometry, expectedFactors, sourceBaseColorTextureBytes, id, width) {
  const io = new NodeIO().registerExtensions([KHRMaterialsVolume, EXTTextureWebP]);
  // Read a clean copy for each output because document transforms mutate the graph.
  const doc = await readPreservedSource(io, fs.readFileSync(sourceFile));
  const originalFactors = factorHash(doc), originalGeometry = accessorFingerprint(doc);
  if (originalGeometry.sha256 !== expectedGeometry.sha256 || originalFactors !== expectedFactors) throw new Error(`${id}: source changed between audit and derivative generation`);
  const materials = doc.getRoot().listMaterials();
  for (const material of materials) {
    if (!material.getBaseColorTexture()) throw new Error(`${id}: every material must have a base-color texture`);
    material.setNormalTexture(null);
    material.setMetallicRoughnessTexture(null);
  }
  await doc.transform(
    functions.prune(),
    functions.textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, effort: 6, resize: [width, width], slots: /^baseColorTexture$/ }),
    functions.prune(),
  );
  const outputBytes = Buffer.from(await io.writeBinary(doc));
  const auditDoc = await io.readBinary(outputBytes);
  const auditJSON = (await io.binaryToJSON(outputBytes)).json;
  const used = auditJSON.extensionsUsed || [];
  if (!used.includes('EXT_texture_webp')) throw new Error(`${id} ${width}px: EXT_texture_webp declaration missing`);
  const geometry = accessorFingerprint(auditDoc), factors = factorHash(auditDoc);
  if (geometry.sha256 !== expectedGeometry.sha256 || geometry.values !== expectedGeometry.values) throw new Error(`${id} ${width}px: geometry/UV/index data changed`);
  if (factors !== originalFactors) throw new Error(`${id} ${width}px: material color factors changed`);
  const textures = [];
  for (const texture of auditDoc.getRoot().listTextures()) {
    const bytes = texture.getImage();
    if (!bytes) throw new Error(`${id} ${width}px: texture image missing after transform`);
    const dims = await imageDimensions(bytes);
    textures.push({ name: texture.getName() || '(unnamed)', mimeType: texture.getMimeType(), bytes: bytes.length, dimensions: dims });
    if (texture.getMimeType() !== 'image/webp' || Math.max(dims.width, dims.height) > width) throw new Error(`${id} ${width}px: unexpected texture derivative ${JSON.stringify(textures.at(-1))}`);
  }
  const stats = summarize(readGlb(outputBytes));
  const fileName = `${id}-${width === 512 ? 'desktop' : 'mobile'}.glb`;
  const output = path.join(assetDir, fileName);
  const saved = writeImmutable(output, outputBytes);
  return {
    id, variant: width === 512 ? 'desktop' : 'mobile', textureMax: width,
    path: path.relative(root, output).replaceAll('\\', '/'), bytes: saved.bytes, mib: mb(saved.bytes), sha256: saved.sha256,
    sourceBytes: fs.statSync(sourceFile).size,
    sourceToDerivativeFileReductionPercent: Number(((1 - saved.bytes / fs.statSync(sourceFile).size) * 100).toFixed(2)),
    created: saved.created, triangles: stats.tris, vertices: stats.verts,
    sourceBaseColorTextureBytes,
    geometryAndUvPreserved: true, materialColorFactorsPreserved: true,
    materials: colorFactors(auditDoc), textures, extensionsUsed: used,
    sourceTextureAndPBRMapsRemoved: materialTextureAudit(auditDoc).every((m) => !m.hasNormal && !m.hasMetallicRoughness),
    materialTextureAudit: materialTextureAudit(auditDoc),
  };
}

await stageSources();
const io = new NodeIO().registerExtensions([KHRMaterialsVolume, EXTTextureWebP]);
const entries = [];
for (const entry of sources) {
  const sourceFile = path.join(root, entry.source);
  if (!fs.existsSync(sourceFile)) throw new Error(`missing preserved source: ${entry.source}; stage first with --stage-from <explicit-folder>`);
  const sourceBytes = fs.readFileSync(sourceFile);
  const sourceJSON = readGlb(sourceBytes).json;
  const declared = sourceJSON.extensionsUsed || [];
  const payloadExtensions = extensionPayloads(sourceJSON);
  const unsupportedPayloads = payloadExtensions.filter((name) => !['KHR_materials_volume'].includes(name));
  if (unsupportedPayloads.length) throw new Error(`${entry.download}: unsupported extension payload(s): ${unsupportedPayloads.join(', ')}`);
  const sourceDoc = await readPreservedSource(io, sourceBytes);
  const stats = summarize(readGlb(sourceBytes));
  const entryReport = {
    source: entry.source.replaceAll('\\', '/'), sourceDownloadName: entry.download,
    sourceSha256: sha256(sourceBytes), sourceBytes: sourceBytes.length, sourceMiB: mb(sourceBytes.length),
    sourceTriangles: stats.tris, sourceVertices: stats.verts,
    geometryAndUvSha256: accessorFingerprint(sourceDoc).sha256,
    materialColorFactors: colorFactors(sourceDoc), materialColorFactorsSha256: factorHash(sourceDoc),
    ...(entry.id === 'antorcha' ? { orientationAnalysis: principalAxis(sourceDoc) } : {}),
    declaredExtensions: declared,
    extensionsWithPayload: payloadExtensions,
    unsupportedExtensionPolicy: 'KHR_materials_volume registered and preserved when present; FB_ngon_encoding has declaration only and no payload in these sources, so the optional declaration is dropped; any other extension payload fails closed.',
    sourceImages: await Promise.all((sourceJSON.images || []).map(async (im, index) => {
      const view = im.bufferView === undefined ? null : sourceJSON.bufferViews[im.bufferView];
      const size = view ? view.byteLength : 0;
      const data = view ? readGlb(sourceBytes).bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength) : Buffer.alloc(0);
      const dimensions = data.length ? await imageDimensions(data) : null;
      const roles = [];
      for (const material of sourceJSON.materials || []) {
        const pbr = material.pbrMetallicRoughness || {};
        for (const [role, info] of [['base color', pbr.baseColorTexture], ['metallic/roughness', pbr.metallicRoughnessTexture], ['normal', material.normalTexture], ['occlusion', material.occlusionTexture], ['emissive', material.emissiveTexture]]) {
          if (info && sourceJSON.textures?.[info.index]?.source === index) roles.push(role);
        }
      }
      return { index, name: im.name || '', roles: [...new Set(roles)], mimeType: im.mimeType || '', bytes: size, dimensions };
    })),
    assigned: entry.assigned,
    sourceRole: entry.sourceRole || 'canonical',
    match: entry.id,
    ...(entry.mappingBasis ? { mappingBasis: entry.mappingBasis, remainingAmbiguity: 'Semantic/illustration fit only; this mapping is a working asset assignment and does not change item behavior or recipes.' } : {}),
    derivatives: [],
  };
  if (entry.assigned) {
    const expectedGeometry = accessorFingerprint(sourceDoc), expectedFactors = factorHash(sourceDoc);
    const sourceBaseColorTextureBytes = entryReport.sourceImages.filter((image) => image.roles.includes('base color')).reduce((sum, image) => sum + image.bytes, 0);
    const desktop = await makeVariant(sourceFile, expectedGeometry, expectedFactors, sourceBaseColorTextureBytes, entry.id, 512);
    const mobile = await makeVariant(sourceFile, expectedGeometry, expectedFactors, sourceBaseColorTextureBytes, entry.id, 256);
    for (const variant of [desktop, mobile]) {
      const derivativeTextureBytes = variant.textures.reduce((sum, texture) => sum + texture.bytes, 0);
      variant.sourceToDerivativeBaseColorTextureReductionPercent = Number(((1 - derivativeTextureBytes / sourceBaseColorTextureBytes) * 100).toFixed(2));
    }
    entryReport.derivatives.push(desktop, mobile);
  }
  entries.push(entryReport);
}

const allDerivatives = entries.flatMap((entry) => entry.derivatives);
const sourceBytesTotal = entries.reduce((sum, entry) => sum + entry.sourceBytes, 0);
const assignedSourceBytes = entries.filter((entry) => entry.assigned).reduce((sum, entry) => sum + entry.sourceBytes, 0);
const derivativeBytesTotal = allDerivatives.reduce((sum, variant) => sum + variant.bytes, 0);
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    intakeOverwrite: 'refuse unless existing and incoming SHA-256 hashes are identical',
    derivativeOverwrite: 'refuse unless existing and generated SHA-256 hashes are identical',
    sourceFiles: 'unchanged GLB copies under docs/art/source; Downloads is read only when an explicit --stage-from folder is passed',
    geometry: 'preserve positions, normals, UVs, indices and triangle count; no decimation, quantization or Meshopt transform',
    textures: 'retain and resize base-color only; remove normal and metallic-roughness maps because the item toon renderer ignores them; WebP quality 90, desktop max 512px, mobile max 256px',
    materials: 'preserve base-color, emissive and alpha factors exactly; preserve the base-color image pixel values apart from resize and WebP encoding; no recolor or rebake',
    visualStyle: 'preserve the authored hand-painted, Borderlands-inspired target with in-game toon shading; this pipeline does not repaint PBR imagery or claim visual acceptance',
  },
  totals: {
    sourceCount: entries.length, canonicalDownloadCount: new Set(entries.map((entry) => entry.sourceDownloadName)).size,
    assignedCount: entries.filter((entry) => entry.assigned).length,
    derivativeCount: allDerivatives.length, sourceBytes: sourceBytesTotal, sourceMiB: mb(sourceBytesTotal),
    assignedSourceBytes, assignedSourceMiB: mb(assignedSourceBytes),
    derivativeBytes: derivativeBytesTotal, derivativeMiB: mb(derivativeBytesTotal),
    reductionPercentAssignedSources: Number(((1 - derivativeBytesTotal / assignedSourceBytes) * 100).toFixed(2)),
  },
  mappingDecisions: [
    { id: 'meal_heartyBiscuit', sourceDownloadName: 'bread loaf 3d model.glb', archiveSource: 'docs/art/source/cooking-items-v1/meal_heartyBiscuit/meal_heartyBiscuit-v1.glb', remainingAmbiguity: 'Semantic identity of a loaf/bun versus biscuit only; mapping follows the working assumption.', recipeChanged: false },
    { id: 'agua', sourceDownloadName: 'blue ceramic vase 3d model.glb', archiveSource: 'docs/art/source/cooking-items-v1/agua/agua-v1.glb', remainingAmbiguity: 'Semantic identity of a decorative-looking blue vessel versus water container only; mapping follows the working assumption.', recipeChanged: false },
    { id: 'harina', sourceDownloadName: 'rice+sack+3d+model.glb', archiveSource: 'docs/art/source/cooking-items-v1/harina/harina-v1.glb', remainingAmbiguity: 'Semantic identity of rice versus flour only; mapping follows the working assumption.', recipeChanged: false },
  ],
  entries,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Prepared ${report.totals.derivativeCount} variants from ${report.totals.sourceCount} canonical sources.`);
console.log(`${report.totals.assignedSourceMiB.toFixed(2)} MiB assigned sources → ${report.totals.derivativeMiB.toFixed(2)} MiB derivatives (${report.totals.reductionPercentAssignedSources}% reduction).`);
console.log(`Report: ${path.relative(root, reportPath).replaceAll('\\', '/')}`);
