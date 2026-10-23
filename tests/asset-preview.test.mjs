import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetPreview, releaseAssetObject, requireSelfContainedGlb } from '../src/render/assetPreview.js';
import { U } from '../src/render/toon.js';

test('preview cannot fetch unreceipted external glTF images or buffers', () => {
  const glb = object => {
    const json = new TextEncoder().encode(JSON.stringify(object)); const length = Math.ceil(json.length / 4) * 4;
    const data = new ArrayBuffer(20 + length), view = new DataView(data), bytes = new Uint8Array(data);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, data.byteLength, true);
    view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20); bytes.set(json, 20); return data;
  };
  assert.doesNotThrow(() => requireSelfContainedGlb(glb({ asset: { version: '2.0' }, images: [{ bufferView: 0 }] })));
  assert.throws(() => requireSelfContainedGlb(glb({ images: [{ uri: 'https://outside.example/texture.png' }] })), /externas/);
  assert.throws(() => requireSelfContainedGlb(glb({ buffers: [{ uri: 'unreceipted.bin' }] })), /externas/);
});

test('resource ownership releases shared base/toon geometry and textures exactly once', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const base = new THREE.MeshStandardMaterial({ map: texture }), toon = new THREE.MeshBasicMaterial({ map: texture });
  const calls = { geometry: 0, base: 0, toon: 0, texture: 0 };
  for (const [key, resource] of Object.entries({ geometry, base, toon, texture })) resource.addEventListener('dispose', () => calls[key]++);
  for (let i = 0; i < 2; i++) { const mesh = new THREE.Mesh(geometry, base); mesh.userData.awBase = base; mesh.userData.awToon = toon; group.add(mesh); }
  releaseAssetObject(group); assert.deepEqual(calls, { geometry: 1, base: 1, toon: 1, texture: 1 });
});

function fixture() {
  const viewport = new EventTarget(); viewport.getBoundingClientRect = () => ({ left: 200, top: 80, right: 800, width: 600, height: 500 });
  const renderer = {
    target: { name: 'world' }, viewport: new THREE.Vector4(1, 2, 3, 4), scissor: new THREE.Vector4(4, 3, 2, 1), test: true,
    color: new THREE.Color(0x403020), alpha: .8, autoClear: false, info: { autoReset: true, render: { calls: 0 } },
    getSize(v) { return v.set(1200, 900); }, getRenderTarget() { return this.target; }, setRenderTarget(v) { this.target = v; },
    getViewport(v) { return v.copy(this.viewport); }, getScissor(v) { return v.copy(this.scissor); }, getScissorTest() { return this.test; }, setScissorTest(v) { this.test = v; },
    getClearColor(v) { return v.copy(this.color); }, getClearAlpha() { return this.alpha; }, setClearColor(v, a) { this.color.set(v); this.alpha = a; },
    setViewport(...args) { args[0]?.isVector4 ? this.viewport.copy(args[0]) : this.viewport.set(...args); }, setScissor(...args) { args[0]?.isVector4 ? this.scissor.copy(args[0]) : this.scissor.set(...args); },
    clear() {}, render() { this.info.render.calls = 3; },
  };
  const oldDocument = globalThis.document; globalThis.document = { hidden: false };
  const preview = new AssetPreview({ renderer, viewport });
  return { preview, renderer, cleanup() { preview.dispose(); globalThis.document = oldDocument; } };
}

test('A/B preserves shared renderer state and uniforms after success and failure', () => {
  const { preview, renderer: r, cleanup } = fixture();
  const before = { target: r.target, viewport: r.viewport.clone(), scissor: r.scissor.clone(), color: r.color.clone(), count: U.mnLightCount.value, cloud: U.mnCloud.value };
  try {
    preview.mode = 'compare'; preview.render(); assert.equal(preview.drawCalls, 6);
    r.render = () => { throw new Error('render failure'); };
    assert.throws(() => preview.render(), /render failure/);
    assert.equal(r.target, before.target); assert.deepEqual(r.viewport, before.viewport); assert.deepEqual(r.scissor, before.scissor);
    assert.deepEqual(r.color, before.color); assert.equal(r.alpha, .8); assert.equal(r.autoClear, false); assert.equal(r.test, true);
    assert.equal(U.mnLightCount.value, before.count); assert.equal(U.mnCloud.value, before.cloud);
  } finally { cleanup(); }
});

test('missing preview explicitly clears the previous model and reports pending', async () => {
  const { preview, cleanup } = fixture();
  try {
    const geometry = new THREE.BoxGeometry(); let released = false; geometry.addEventListener('dispose', () => { released = true; });
    preview.object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); preview.scene.add(preview.object);
    await preview.select({ id: 'pending', limitations: ['Rig todavía sin preparar.'] });
    assert.equal(preview.object, null); assert.equal(released, true); assert.equal(preview.state.status, 'pending'); assert.match(preview.state.message, /Rig/);
  } finally { cleanup(); }
});
