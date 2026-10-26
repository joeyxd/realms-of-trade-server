import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DepthStage, depthFactor } from '../../src/render/vfx/niagara/depth-stage.js';
import { PilotParticles } from '../../src/render/vfx/niagara/particles.js';

test('linear axial separation saturates at contact and the source 100cm span', () => {
  for (const [gap, expected] of [[-.25, 0], [0, 0], [.25, .25], [.5, .5], [1, 1], [1.5, 1]])
    assert.equal(depthFactor(5 + gap, 5), expected);
  assert.throws(() => depthFactor(Infinity, 5));
  assert.throws(() => depthFactor(5, 5, 0));
});

test('opaque stage follows camera axis; particle depth reads separate target and never writes depth', () => {
  const stage = new DepthStage(), camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 100);
  const target = new THREE.Vector3(0, 1, 0); camera.position.set(3, 4, 4);
  stage.configure('wall', 50, camera, target);
  const axis = camera.position.clone().sub(target).normalize();
  assert.ok(stage.surface.position.distanceTo(target.clone().addScaledVector(axis, -.5)) < 1e-10);
  stage.configure('floor', 0, camera, target);
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(stage.surface.quaternion).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-10);
  assert.throws(() => stage.configure('wall', 999, camera, target));
  const particles = new PilotParticles(new THREE.Scene(), [new THREE.Texture(), new THREE.Texture()]);
  const hdr = new THREE.WebGLRenderTarget(512, 512), renders = [];
  const renderer = { autoClear: true, setRenderTarget(t) { this.target = t; }, clear() {},
    render(scene) { renders.push({ scene, target: this.target, autoClear: this.autoClear }); } };
  stage.render(renderer, camera, hdr, new THREE.Scene(), particles);
  assert.equal(renders.length, 3); assert.equal(renders[0].target, stage.target);
  assert.equal(renders[2].target, hdr); assert.notEqual(stage.target, hdr);
  assert.equal(renderer.autoClear, true);
  for (const layer of particles.layers) {
    assert.equal(layer.material.depthWrite, false);
    assert.equal(layer.material.uniforms.opaqueDepth.value, stage.target.depthTexture);
    assert.equal(layer.material.uniforms.depthFadeEnabled.value, true);
  }
  let disposed = 0; stage.target.addEventListener('dispose', () => disposed++);
  stage.dispose(); particles.layers.forEach(m => m.material.uniforms.atlas.value.dispose()); particles.dispose(); hdr.dispose();
  assert.equal(disposed, 1);
});
