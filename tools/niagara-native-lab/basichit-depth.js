// NS_BasicHit opaque-surface stage (reference set "depth", docs/delivery/st01c/basichit/DEPTH.md). One opaque black
// two-sided unlit plane per pose, built from the capture row's `surface` (pointCm, normal, sizeCm; UE axes, cm). The pass
// follows the pilot's depth-stage.js: the plane is drawn into its own render target with a nearest depth texture, the
// Flame samples that texture for DepthFade, then the plane is drawn again into the main HDR target so it occludes, and
// the particles go on top without depth write. A texture attached to the active framebuffer is never sampled.
// Orthographic cameras only (the reference is orthographic; BasicHitParticles.setDepth throws otherwise).
import * as THREE from 'three';
import { toScene } from '../../src/render/vfx/niagara/particles.js';

export const SURFACE_KINDS = Object.freeze(['wall', 'floor']);
// UE direction (x, y, z) -> scene axes, the toScene mapping without the cm -> m scale.
export const directionToScene = ([x, y, z]) => [y, z, -x];

// The plane the lab builds from a row's surface: centre in scene metres, unit normal in scene axes, edge in metres.
export function planeFromSurface(surface) {
  const { kind, pointCm, normal, sizeCm } = surface ?? {};
  if (!SURFACE_KINDS.includes(kind) || ![pointCm, normal].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
      !Number.isFinite(sizeCm) || sizeCm <= 0)
    throw new Error('Invalid BasicHit surface');
  const length = Math.hypot(...normal);
  if (Math.abs(length - 1) > 1e-6) throw new Error('Invalid BasicHit surface normal');
  return { kind, center: toScene(pointCm), normal: directionToScene(normal).map(v => v / length), size: sizeCm / 100 };
}

export class BasicHitDepthStage {
  constructor(size) {
    this.size = size;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0);
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0, side: THREE.DoubleSide, toneMapped: false }));
    this.surface.visible = false;
    this.scene.add(this.surface);
    this.target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    this.target.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    this.target.depthTexture.minFilter = this.target.depthTexture.magFilter = THREE.NearestFilter;
    this.present = false;
  }
  // surface: a capture row's `surface`, or null for a control (empty opaque pass).
  configure(surface) {
    this.present = surface != null;
    this.surface.visible = this.present;
    if (!this.present) return;
    const plane = planeFromSurface(surface);
    this.surface.position.set(...plane.center);
    this.surface.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...plane.normal));
    this.surface.scale.set(plane.size, plane.size, 1);
    this.surface.updateMatrixWorld();
  }
  // enabled: the DepthFade of the layers that have it. A control still goes through the fade shader: the empty target
  // holds the far plane, so the fade is 1 there.
  render(renderer, camera, hdr, particleScene, particles, enabled) {
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, camera);
      particles.setDepth(this.target.depthTexture, camera, this.size, this.size, enabled);
      renderer.setRenderTarget(hdr);
      renderer.render(this.scene, camera); // clears the HDR target (background 0) and writes the plane's depth
      renderer.autoClear = false;
      renderer.render(particleScene, camera); // no scene.background here: a Color background would force a clear
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(null);
    }
  }
  dispose() {
    this.surface.removeFromParent(); this.surface.geometry.dispose(); this.surface.material.dispose();
    this.target.dispose(); this.target.depthTexture.dispose();
  }
}
