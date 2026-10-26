import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { gmBaseId, gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { createBaseDecorationLayer } from '../src/editor/baseDecoration.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';

const manifest = JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const editorCatalog = JSON.parse(await readFile(new URL('../assets/editor/catalog.json', import.meta.url), 'utf8'));
const revision = 'terrain-s21-v1';
const seed = 12345;
const map = generateWorld(seed);
const validator = createGmDraftValidator({ map, baseRevision: revision, manifest, editorCatalog });
const base = createDocument({ seed, baseRevision: revision });
const transform = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };

test('pure base identity matches GM02 renderer IDs on a generated map', () => {
  const eligible = gmEditableBaseProps(map, revision);
  assert.ok(eligible.length > 0);
  const entry = eligible.find((item) => item.prop.kind === 'flower' || item.prop.kind === 'pebble');
  const scene = new THREE.Scene();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  mesh.name = entry.prop.kind === 'flower' ? 'flowers0' : 'pebbles';
  mesh.userData.gmBaseProps = [entry.prop];
  scene.add(mesh);
  const rendererLayer = createBaseDecorationLayer({ scene, map, baseRevision: revision });
  assert.equal(rendererLayer.list()[0].id, entry.id);
  assert.equal(entry.id, gmBaseId(seed, revision, entry.prop, entry.index));
});

test('accepts a current document and approved model references, returning normalized v2', () => {
  assert.deepEqual(validator(base), base);
  const assetId = editorCatalog.assets.find((entry) => entry.kind === 'model').id;
  const withModel = { ...base, objects: [createDecoration({ id: 'draft-piece', assetId, position: { x: 0, y: 0, z: 0 } })] };
  assert.deepEqual(validator(withModel), withModel);
});

test('rejects stale base, arbitrary asset IDs, and uneditable base references with stable codes', () => {
  assert.throws(() => validator({ ...base, base: { ...base.base, revision: 'other' } }), { code: 'base_mismatch' });
  const arbitrary = { ...base, objects: [createDecoration({ id: 'bad-asset', assetId: 'model:remote-url', position: { x: 0, y: 0, z: 0 } })] };
  assert.throws(() => validator(arbitrary), { code: 'asset_reference' });
  const hiddenBase = { ...base, baseOverrides: [{ id: 'base:rock:999999:deadbeef', transform, hidden: true }] };
  assert.throws(() => validator(hiddenBase), { code: 'base_reference' });
});

test('accepts only generated eligible base IDs and rejects malformed documents', () => {
  const eligible = gmEditableBaseProps(map, revision).find((item) => !item.coastal);
  assert.ok(eligible);
  const doc = { ...base, baseOverrides: [{ id: eligible.id, transform, hidden: false }] };
  assert.deepEqual(validator(doc), doc);
  assert.throws(() => validator({ ...base, objects: [{ nope: true }] }), { code: 'object' });
});
