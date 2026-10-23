import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlipbookEffect } from '../src/render/vfx/flipbook.js';

const effect = { atlas: { desktop: '/desktop.webp', mobile: '/mobile.webp' }, columns: 4, rows: 4,
  frames: 16, duration: 2, width: 6, height: 4, blend: 'alpha' };
const parameters = { scale: 1, height: 1, duration: 1, speed: 1, brightness: 1, opacity: 1, tint: '#ffffff' };
function texture(width = 1024, height = 1024) {
  let closed = 0, disposed = 0;
  const value = new THREE.Texture({ width, height, close() { closed++; } });
  value.addEventListener('dispose', () => disposed++);
  return { value, get closed() { return closed; }, get disposed() { return disposed; } };
}

test('baked playback maps top-first frames, pauses exactly, and exposes bounded presentation only', async () => {
  const scene = new THREE.Scene(), tex = texture();
  const fx = new FlipbookEffect(scene, { loadTexture: async () => tex.value });
  await fx.setEffect(effect); fx.update(0, parameters);
  assert.equal(fx.sprite.visible, true);
  assert.deepEqual(tex.value.repeat.toArray(), [0.25, 0.25]);
  assert.deepEqual(tex.value.offset.toArray(), [0, 0.75]);
  fx.update(1, parameters); assert.equal(fx.frame, 8);
  assert.deepEqual(tex.value.offset.toArray(), [0, 0.25]);
  fx.update(1, parameters); assert.equal(fx.frame, 8);
  assert.equal(fx.metrics.atlasPixels, 1048576);
  fx.update(-0.1, parameters); assert.equal(fx.sprite.visible, false);
  fx.update(2, parameters); assert.equal(fx.sprite.visible, false);
  fx.update(0.5, { ...parameters, scale: 2, height: 1.5, opacity: 0.5 });
  assert.deepEqual(fx.sprite.scale.toArray(), [12, 12, 1]);
  assert.equal(fx.material.opacity, 0.5);
  assert.equal(fx.duration({ ...parameters, duration: 2, speed: 0.5 }), 8);
  fx.dispose(); fx.dispose(); assert.equal(tex.disposed, 1); assert.equal(tex.closed, 1);
  assert.equal(scene.children.length, 0);
});

test('rapid selection disposes late results and only keeps the last chosen quality', async () => {
  const scene = new THREE.Scene(), loads = [];
  const fx = new FlipbookEffect(scene, { loadTexture: (url, signal) => new Promise(resolve => loads.push({ url, signal, resolve })) });
  const first = fx.setEffect(effect, 'desktop');
  const second = fx.setEffect(effect, 'mobile');
  assert.equal(loads[0].signal.aborted, true);
  assert.equal(loads[1].url, '/mobile.webp');
  const a = texture(), b = texture(512, 512);
  loads[1].resolve(b.value); await second;
  loads[0].resolve(a.value); await first;
  assert.equal(fx.texture, b.value); assert.equal(a.disposed, 1); assert.equal(a.closed, 1);
  assert.equal(fx.state, 'ready');
  fx.dispose(); assert.equal(b.disposed, 1);
});

test('missing or invalid atlas keeps the stage empty and can recover on another selection', async () => {
  const scene = new THREE.Scene(), bad = texture(999, 1024), good = texture(); let call = 0;
  const fx = new FlipbookEffect(scene, { loadTexture: async () => {
    if (++call === 1) throw new Error('404');
    return call === 2 ? bad.value : good.value;
  } });
  await fx.setEffect(effect); fx.update(1, parameters);
  assert.equal(fx.state, 'error'); assert.equal(fx.sprite.visible, false);
  await fx.setEffect(effect); assert.equal(fx.state, 'error'); assert.equal(bad.disposed, 1);
  await fx.setEffect(effect); fx.update(1, parameters);
  assert.equal(fx.state, 'ready'); assert.equal(fx.sprite.visible, true);
  fx.dispose();
});

test('closing while the texture loads cancels it and releases any late bitmap', async () => {
  let resolve;
  const fx = new FlipbookEffect(new THREE.Scene(), { loadTexture: () => new Promise(done => { resolve = done; }) });
  const pending = fx.setEffect(effect), tex = texture();
  fx.dispose(); resolve(tex.value); await pending;
  assert.equal(tex.closed, 1); assert.equal(tex.disposed, 1); assert.equal(fx.sprite.parent, null);
});
