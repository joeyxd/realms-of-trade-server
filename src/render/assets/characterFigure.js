// A native glTF rig for the character sheet. Gameplay continues to use the 15-bone rebind.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { charToon } from './toonmat.js';
import { charNormalMat } from '../toon.js';

// Capture before bakeCharacter lowers the source arms in place. Geometry/textures remain shared.
export function captureCharacterFigure(gltf, entry) {
  const clip = entry.figureAnimation
    ? gltf.animations?.find((c) => c.name === entry.figureAnimation && c.duration > 0)
    : null;
  const swimClip = entry.swimAnimation
    ? gltf.animations?.find((c) => c.name === entry.swimAnimation && c.duration > 0)
    : null;
  if (!clip && !swimClip) return null;
  return { scene: clone(gltf.scene), clip: clip || null, swimClip: swimClip || null };
}

export function createCharacterFigure(source, bake, entry, look, height) {
  const scene = clone(source.scene), root = new THREE.Group(), fitted = new THREE.Group();
  const fit = bake.normalization, scale = height * fit.scale;
  fitted.scale.setScalar(scale);
  fitted.position.fromArray(fit.offset).multiplyScalar(scale);
  fitted.rotation.y = fit.rotationY;
  fitted.add(scene); root.add(fitted);
  const shared = { glow: { value: 1 }, flash: { value: new THREE.Vector4(1, 1, 1, 0) } };
  const materials = new Map();
  const material = (src) => {
    if (!materials.has(src)) materials.set(src, charToon(src, entry, shared));
    return materials.get(src);
  };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
    o.userData.nm = charNormalMat();
    // One on-demand figure: avoid a stale bind-pose bounding volume clipping animated limbs.
    o.frustumCulled = false;
  });
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(source.clip).setLoop(THREE.LoopRepeat, Infinity).play();
  mixer.update(0); root.updateMatrixWorld(true);
  return { root, height, look, ext: { id: entry.id }, nativeIdle: true, mixer,
    advance(delta) { mixer.update(Math.max(0, Math.min(0.1, delta || 0))); } };
}
