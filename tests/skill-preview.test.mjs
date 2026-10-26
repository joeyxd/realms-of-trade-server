import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkillPreview } from '../src/render/skillPreview.js';
import { cloneSkillDocument } from '../src/editor/skillDocument.js';
import { FXU } from '../src/render/pipeline.js';
import { U } from '../src/render/toon.js';
import { SKILLS } from '../src/data/weapons.js';

function fixture() {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { getContext() { return {
    createRadialGradient() { return { addColorStop() {} }; }, fillRect() {},
  }; } }; } };
  const viewport = new EventTarget();
  viewport.getBoundingClientRect = () => ({ left: 200, top: 80, right: 800, width: 600, height: 500 });
  const renderer = {
    target: { name: 'world-target' }, viewport: new THREE.Vector4(1, 2, 3, 4), scissor: new THREE.Vector4(4, 3, 2, 1), test: true,
    color: new THREE.Color(0x403020), alpha: 0.8, autoClear: false, info: { render: { calls: 7 } },
    getSize(v) { return v.set(1200, 900); }, getRenderTarget() { return this.target; }, setRenderTarget(v) { this.target = v; },
    getViewport(v) { return v.copy(this.viewport); }, getScissor(v) { return v.copy(this.scissor); },
    getScissorTest() { return this.test; }, setScissorTest(v) { this.test = v; },
    getClearColor(v) { return v.copy(this.color); }, getClearAlpha() { return this.alpha; },
    setClearColor(v, a) { this.color.set(v); this.alpha = a; },
    setViewport(...a) { a[0]?.isVector4 ? this.viewport.copy(a[0]) : this.viewport.set(...a); },
    setScissor(...a) { a[0]?.isVector4 ? this.scissor.copy(a[0]) : this.scissor.set(...a); },
    getPixelRatio() { return 1; }, clear() {}, render() { this.info.render.calls += 3; },
  };
  const preview = new SkillPreview({ renderer, viewport });
  return { preview, renderer, cleanup() { preview.dispose(); globalThis.document = oldDocument; } };
}
const snapshot = p => ({ time: p.time, pos: Array.from(p.pool.pos), data: Array.from(p.pool.data), col: Array.from(p.pool.col), alive: Array.from(p.pool.alive) });

test('private playback pauses all effect clocks, seeks reproducibly and keeps the actual combat radius', () => {
  const f = fixture();
  try {
    const p = f.preview;
    p.pause(); p.seek(SKILLS.tromba.windup + SKILLS.tromba.delay - 0.02);
    assert.equal(p.fired, false, 'The impact follows windup plus flight delay');
    p.pause(); p.seek(0.8); const first = snapshot(p);
    assert.ok(p.metrics.particles > 0);
    p.render(0.1); assert.deepEqual(snapshot(p), first);
    p.seek(0.8); assert.deepEqual(snapshot(p), first);
    p.setOriginal(true); assert.deepEqual(snapshot(p), first);
    const document = cloneSkillDocument(); document.parameters.scale = 1.5;
    p.setDocument(document); p.setOriginal(false); p.seek(0.8);
    assert.equal(p.fx.spouts[0].r, SKILLS.tromba.r * 0.55 * 1.5);
    const positions = p.range.geometry.attributes.position;
    assert.ok(Math.abs(Math.hypot(positions.getX(0), positions.getZ(0)) - SKILLS.tromba.r) < 0.000001);
  } finally { f.cleanup(); }
});

test('speed, loop and mobile budget stay bounded without changing the gameplay skill', () => {
  const f = fixture(), before = structuredClone(SKILLS.tromba);
  try {
    const p = f.preview; p.setSpeed(2); p.render(0.1); assert.ok(Math.abs(p.time - 0.2) < 0.00001);
    p.setSpeed(100); assert.equal(p.speed, 2);
    p.setLoop(false); p.seek(p.duration); p.playing = true; p.render(0.1); assert.equal(p.playing, false);
    p.setQuality('mobile'); p.setOriginal(false);
    const document = cloneSkillDocument(); document.parameters.density = 2; document.parameters.duration = 2;
    p.setDocument(document); p.seek(1.25);
    assert.equal(p.cap, 128); assert.ok(p.metrics.particles <= 128);
    assert.deepEqual(SKILLS.tromba, before);
  } finally { f.cleanup(); }
});

test('private particle playback does not consume the global visual RNG', () => {
  const previous = Math.random, f = fixture();
  Math.random = () => { throw new Error('Global visual RNG consumed'); };
  try {
    f.preview.seek(1); f.preview.seek(0.8);
    assert.ok(f.preview.metrics.particles > 0);
  } finally { Math.random = previous; f.cleanup(); }
});

test('private stage restores renderer and shared uniforms even on a render failure and releases owned resources', () => {
  const f = fixture();
  try {
    const p = f.preview, r = f.renderer, target = r.target;
    const viewport = r.viewport.clone(), scissor = r.scissor.clone(), color = r.color.clone();
    const uniforms = { depth: FXU.uUseDepth.value, light: FXU.uFxLight.value.clone(), count: U.mnLightCount.value, cloud: U.mnCloud.value };
    p.pause(); p.render(); assert.equal(p.metrics.drawCalls, 3);
    r.info.autoReset = true; r.render = () => { r.info.render.calls = 4; };
    p.render(); assert.equal(p.metrics.drawCalls, 4, 'Three.js resets its render counter for each render by default');
    r.render = () => { throw new Error('context failure'); };
    assert.throws(() => p.render(), /context failure/);
    assert.equal(r.target, target); assert.deepEqual(r.viewport, viewport); assert.deepEqual(r.scissor, scissor);
    assert.deepEqual(r.color, color); assert.equal(r.autoClear, false); assert.equal(r.test, true); assert.equal(r.alpha, 0.8);
    assert.equal(FXU.uUseDepth.value, uniforms.depth); assert.deepEqual(FXU.uFxLight.value, uniforms.light);
    assert.equal(U.mnLightCount.value, uniforms.count); assert.equal(U.mnCloud.value, uniforms.cloud);
    let disposed = 0; p.pool.mat.addEventListener('dispose', () => disposed++);
    p.dispose(); p.dispose(); assert.equal(disposed, 1); assert.equal(p.scene.children.length, 0);
  } finally { f.cleanup(); }
});
