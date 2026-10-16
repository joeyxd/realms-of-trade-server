import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'assets', 'editor', 'catalog.json');
const RECEIPT = path.join(ROOT, 'docs', 'art', 'gm00', 'receipts.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readGlbJson(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8', 20, 20 + length));
}

function triangles(gltf) {
  return gltf.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => {
    if ((primitive.mode ?? 4) !== 4) return sum;
    const accessor = gltf.accessors[primitive.indices ?? primitive.attributes.POSITION];
    return sum + Math.floor(accessor.count / 3);
  }, 0);
}

test('editor catalog exposes only the four hashed GM00 candidates with verified GLB metadata', async () => {
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  assert.equal(catalog.version, 1);
  assert.equal(catalog.assets.length, 4);
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.originalsModified, false);
  assert.equal(receipt.toolchain['@gltf-transform/core'], '4.5.0');
  assert.equal(receipt.toolchain['meshoptimizer'], '0.22.0');

  const expectedIds = ['model:gm-rock-2k', 'model:gm-rock-1k', 'model:gm-coral-200k', 'model:gm-coral-50k'];
  assert.deepEqual(catalog.assets.map(asset => asset.id), expectedIds);
  const receiptRows = new Map(receipt.assets.map(row => [row.id, row]));
  for (const asset of catalog.assets) {
    assert.equal(asset.status, 'candidate');
    assert.equal(asset.kind, 'model');
    assert.equal(asset.fit, 'size');
    assert.equal(asset.size, 4);
    assert.match(asset.src, /^editor\/.+-[a-f0-9]{12}\.glb$/);
    assert.equal(asset.groupId, asset.id.slice(0, asset.id.lastIndexOf('-')));

    const abs = path.resolve(ROOT, 'assets', asset.src);
    assert.ok(abs.startsWith(path.join(ROOT, 'assets', 'editor') + path.sep));
    const bytes = await readFile(abs);
    assert.equal(bytes.byteLength, asset.stats.bytes);
    assert.equal(hash(bytes), asset.stats.sha256);
    assert.ok(path.basename(abs).includes(asset.stats.sha256.slice(0, 12)));
    const gltf = readGlbJson(bytes);
    assert.ok(gltf.extensionsUsed.includes('EXT_texture_webp'));
    assert.ok(gltf.images.length > 0 && gltf.images.every(image => image.mimeType === 'image/webp'));
    assert.equal(triangles(gltf), asset.stats.triangles);

    const row = receiptRows.get(asset.id);
    assert.ok(row && !row.diagnostic);
    assert.equal(row.output.sha256, asset.stats.sha256);
    assert.equal(row.source.sha256, asset.stats.sourceSha256);
    assert.equal(row.recipe.geometry?.normalBake ?? false, false);
  }
  assert.equal(catalog.assets.some(asset => asset.stats.triangles > 250_000), false);
  assert.ok(receipt.assets.filter(row => row.diagnostic).every(row => row.output.file.startsWith('.scratch/gm-assets/benchmarks/')));
});
