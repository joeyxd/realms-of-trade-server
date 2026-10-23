// Runtime-only native swim animation. The gameplay mesh remains on its existing 15-bone rig.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { charToon } from './toonmat.js';
import { charNormalMat } from '../toon.js';

const MAX_ADVANCE = 0.1;

function withoutRootMotion(clip) {
  const runtimeClip = clip.clone();
  const hipsPosition = runtimeClip.tracks.filter((track) =>
    /(?:mixamorig)?hips/i.test(track.name) && track.name.endsWith('.position'));
  if (hipsPosition.length !== 1) {
    throw new Error(`expected one Hips position track in ${clip.name}, found ${hipsPosition.length}`);
  }
  const values = hipsPosition[0].values;
  if (values.length < 3 || values.length % 3 !== 0) {
    throw new Error('Hips position track must contain Vector3 keyframes');
  }
  const firstZ = values[2];
  for (let index = 2; index < values.length; index += 3) values[index] = firstZ;
  return runtimeClip;
}

function fitSourceScene(scene, bake, entry, height) {
  const root = new THREE.Group();
  const fitted = new THREE.Group();
  const fit = bake.normalization;
  const scale = height * fit.scale;
  fitted.scale.setScalar(scale);
  fitted.position.fromArray(fit.offset).multiplyScalar(scale);
  fitted.position.y += Number.isFinite(entry.swimOffsetY) ? entry.swimOffsetY : 0;
  fitted.rotation.y = fit.rotationY;
  fitted.add(scene);
  root.add(fitted);
  return root;
}

// Create a private skeleton/mixer while sharing immutable geometry and source textures.
export function createCharacterSwim(source, bake, entry, height, shared) {
  if (!source?.scene || !source.swimClip || source.swimClip.duration <= 0) {
    throw new Error('native swim source scene and clip are required');
  }
  if (!shared?.glow || !shared?.flash) throw new Error('shared character glow and flash uniforms are required');

  const scene = clone(source.scene);
  const root = fitSourceScene(scene, bake, entry, height);
  const materials = new Map();
  const meshes = [];
  const getMaterial = (original) => {
    if (!materials.has(original)) materials.set(original, charToon(original, entry, shared));
    return materials.get(original);
  };
  scene.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    object.material = Array.isArray(object.material)
      ? object.material.map(getMaterial)
      : getMaterial(object.material);
    object.userData.nm = charNormalMat();
    object.frustumCulled = false;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const clip = withoutRootMotion(source.swimClip);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity).play();
  mixer.update(0);
  root.updateMatrixWorld(true);

  return {
    root,
    meshes,
    mixer,
    nativeSwim: true,
    advance(delta) {
      mixer.update(Math.max(0, Math.min(MAX_ADVANCE, Number.isFinite(delta) ? delta : 0)));
      root.updateMatrixWorld(true);
    },
    reset() {
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      mixer.setTime(0);
      root.updateMatrixWorld(true);
    },
  };
}
