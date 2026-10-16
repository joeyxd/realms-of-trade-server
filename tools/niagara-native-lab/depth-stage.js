// Private opaque-scene input, never a gameplay collision or particle simulation.
import * as THREE from 'three';

export function depthFactor(sceneDepth, pixelDepth, fadeDistance = 1) {
  if (![sceneDepth, pixelDepth, fadeDistance].every(Number.isFinite) || fadeDistance <= 0)
    throw new Error('Invalid linear depth');
  return Math.max(0, Math.min(1, (sceneDepth - pixelDepth) / fadeDistance));
}

export class DepthStage {
  constructor(size = 512) {
    this.scene = new THREE.Scene();
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide, toneMapped: false }));
    this.scene.add(this.surface);
    this.target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    this.target.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    this.target.depthTexture.minFilter = this.target.depthTexture.magFilter = THREE.NearestFilter;
    this.size = size;
    this.present = false;
  }
  configure(kind, gapCm, camera, target) {
    if (!['none', 'wall', 'floor'].includes(kind) || !Number.isFinite(gapCm) || gapCm < -25 || gapCm > 150)
      throw new Error('Invalid controlled surface');
    this.present = kind !== 'none';
    this.surface.visible = this.present;
    if (kind === 'floor') {
      this.surface.position.set(0, 0, 0);
      this.surface.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
    } else {
      const normal = camera.position.clone().sub(target).normalize();
      this.surface.position.copy(target).addScaledVector(normal, -gapCm / 100);
      this.surface.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
  }
  render(renderer, camera, hdr, particleScene, particles, enabled = true) {
    const previousAutoClear = renderer.autoClear;
    try {
      // Sampling a depth texture attached to the active framebuffer is undefined.
      // First capture opaque depth in a separate target, then depth-test the color pass.
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, camera);
      particles.setDepth(this.target.depthTexture, camera, this.size, this.size, this.present && enabled);
      renderer.setRenderTarget(hdr);
      renderer.clear();
      renderer.autoClear = false;
      renderer.render(this.scene, camera);
      renderer.render(particleScene, camera);
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }
  dispose() {
    this.surface.removeFromParent(); this.surface.geometry.dispose(); this.surface.material.dispose();
    this.target.dispose();
  }
}
