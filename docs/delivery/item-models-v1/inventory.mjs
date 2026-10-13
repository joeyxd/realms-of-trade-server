import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, summarize } from '../../../tools/glb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.dirname(fileURLToPath(import.meta.url));
const downloads = path.join(process.env.USERPROFILE, 'Downloads');
const files = fs.readdirSync(downloads).filter((f) => f.toLowerCase().endsWith('.glb'))
  .map((name) => ({ name, full: path.join(downloads, name), stat: fs.statSync(path.join(downloads, name)) }))
  .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, 12);

function imageSize(buf, mime) {
  if (mime === 'image/png' && buf.length >= 24) return `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return `${buf.readUInt16BE(i + 7)}×${buf.readUInt16BE(i + 5)}`;
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return 'unknown';
}

const rows = [];
for (const [ix, file] of files.entries()) {
  const buf = fs.readFileSync(file.full), glb = readGlb(buf), stats = summarize(glb), json = glb.json;
  const imageRoles = new Map();
  const markTexture = (textureInfo, role) => {
    if (!textureInfo || json.textures?.[textureInfo.index] === undefined) return;
    const source = json.textures[textureInfo.index].source;
    if (source === undefined) return;
    const roles = imageRoles.get(source) || [];
    if (!roles.includes(role)) roles.push(role);
    imageRoles.set(source, roles);
  };
  for (const material of json.materials || []) {
    const pbr = material.pbrMetallicRoughness || {};
    markTexture(pbr.baseColorTexture, 'base color');
    markTexture(pbr.metallicRoughnessTexture, 'metallic/roughness');
    markTexture(material.normalTexture, 'normal');
    markTexture(material.occlusionTexture, 'occlusion');
    markTexture(material.emissiveTexture, 'emissive');
  }
  const images = (json.images || []).map((image, n) => {
    const mime = image.mimeType || 'application/octet-stream';
    let bytes = Buffer.alloc(0);
    if (image.bufferView !== undefined) {
      const view = json.bufferViews[image.bufferView];
      bytes = glb.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    } else if (image.uri?.startsWith('data:')) bytes = Buffer.from(image.uri.slice(image.uri.indexOf(',') + 1), 'base64');
    let ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'bin';
    const preview = bytes.length ? `texture-${String(ix + 1).padStart(2,'0')}-${n + 1}.${ext}` : null;
    if (preview) fs.writeFileSync(path.join(outDir, preview), bytes);
    return { name: image.name || `image-${n + 1}`, roles: imageRoles.get(n) || [], mime, bytes: bytes.length, dimensions: imageSize(bytes, mime), preview };
  });
  const dx = stats.max[0] - stats.min[0], dy = stats.max[1] - stats.min[1], dz = stats.max[2] - stats.min[2];
  const primitives = (json.meshes || []).flatMap((m) => (m.primitives || []).map((p) => ({
    material: p.material === undefined ? '(default)' : (json.materials?.[p.material]?.name || `material-${p.material + 1}`),
    mode: ['points','lines','line-loop','line-strip','triangles','triangle-strip','triangle-fan'][p.mode ?? 4] || `mode-${p.mode}`,
    indices: p.indices === undefined ? null : json.accessors[p.indices]?.count,
  })));
  rows.push({
    source: file.name, modified: file.stat.mtime.toISOString(), fileBytes: buf.length,
    generator: stats.generator, meshes: stats.meshes, vertices: stats.verts, triangles: stats.tris,
    bounds: [dx, dy, dz].map((v) => Number.isFinite(v) ? Number(v.toFixed(4)) : null),
    materials: stats.materials, primitives, images, extensions: stats.extensions, binBytes: stats.binBytes,
  });
}
fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sourceDirectory: downloads, selection: '12 most recently modified *.glb files', assets: rows }, null, 2) + '\n');
const mb = (n) => `${(n / 1048576).toFixed(2)} MiB`;
const md = [
  '# Item model intake inventory v1', '',
  `Generated ${new Date().toISOString()}. Scope: the 12 most recently modified GLBs in the Downloads directory; source files remain there unchanged.`, '',
  '| Source | File | Geometry | Bounds (X × Y × Z) | Materials | Embedded textures |',
  '|---|---:|---|---|---|---|',
  ...rows.map((r) => `| ${r.source.replaceAll('|','\\|')} | ${mb(r.fileBytes)} | ${r.triangles.toLocaleString()} tris / ${r.vertices.toLocaleString()} verts; ${r.meshes} mesh(es) | ${r.bounds.map((v) => v ?? '?').join(' × ')} | ${r.materials.join(', ') || '—'} | ${r.images.map((im) => `${im.roles.join('/ ') || im.name}: ${im.dimensions} ${mb(im.bytes)} (${im.preview || 'no extract'})`).join('<br>') || 'none'} |`),
  '',
  '## Interpretation and visual review', '',
  'See [visual-review.md](visual-review.md) for rendered candidate matching, Borderlands art direction notes, and optimization recommendations. The [rendered model thumbnail sheet](model-thumbnails.jpg) and embedded texture previews stay in this report folder. Source intake and derivative preparation are recorded here; runtime registration and publication are separate steps.', '',
  '## Reproduction', '',
  'Run `node docs/delivery/item-models-v1/inventory.mjs`. It uses the repository reader in `tools/glb.mjs`, reads only the 12 newest `*.glb` files in the current user Downloads directory, and writes its JSON, table, and extracted embedded texture previews here.', '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'REPORT.md'), md);
console.log(`Inventoried ${rows.length} GLBs into ${outDir}`);
