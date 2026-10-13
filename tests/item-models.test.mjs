import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readGlb, summarize } from '../tools/glb.mjs';
import { normalizeManifest, selectTextureSource } from '../src/render/assets/manifest.js';

test('item models preserve source topology, have compact embedded maps, and defer cooking downloads', () => {
  const report = JSON.parse(fs.readFileSync(new URL('../docs/delivery/item-models-v1/optimization.json', import.meta.url)));
  const manifest = normalizeManifest(JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url))));
  assert.deepEqual(manifest.errors, []);
  const rows = report.entries.filter(row => row.assigned);
  assert.equal(rows.length, 12);
  assert.equal(rows.reduce((total, row) => total + row.derivatives.length, 0), 24);
  for (const row of rows) {
    const source = fs.readFileSync(new URL('../' + row.source, import.meta.url));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), row.sourceSha256);
    const id = row.derivatives[0].id, entry = manifest.entries.get(`model:item-${id}-v1`);
    assert.ok(entry);
    assert.equal(entry.preload, ['antorcha', 'resina', 'coco'].includes(id));
    assert.equal(entry.toon.comic, false, 'retain original painted marks without additional hatching');
    for (const variant of row.derivatives) {
      const bytes = fs.readFileSync(new URL('../' + variant.path, import.meta.url));
      const glb = readGlb(bytes), summary = summarize(glb);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), variant.sha256);
      assert.equal(summary.tris, row.sourceTriangles);
      assert.equal(glb.json.images.length, 1);
      assert.equal(glb.json.images[0].mimeType, 'image/webp');
      assert.equal(selectTextureSource(entry, variant.variant === 'mobile'), variant.path.replace(/^assets\//, ''));
      assert.ok(bytes.length < row.sourceBytes / 4, 'small item must have a material download reduction');
    }
  }
});
