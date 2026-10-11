// Reuse the verified leaf alpha, toon, outline and shadow wind passes with the shrub's own atlas.
import * as THREE from 'three';
import { toon, normalMatFor } from './toon.js';
import { palmMaterials, PALM_TEXTURE_IDS } from './palmMaterials.js';

export const SHRUB_TEXTURE_IDS = ['tex:shrub-albedo-v1', 'tex:shrub-normal-v1'];

export function shrubMaterials(registry, swayUniform) {
  const mats = palmMaterials({ texture: (id) => registry.texture(SHRUB_TEXTURE_IDS[PALM_TEXTURE_IDS.indexOf(id)]) }, swayUniform);
  mats.trunk.dispose(); mats.trunkNm.dispose(); mats.trunkDepth.dispose();
  // The leaf artwork already contains ink and painted shadow planes; extra hatching hides its color.
  delete mats.fronds.defines.MN_COMIC;
  const leafKey = mats.fronds.customProgramCacheKey();
  mats.fronds.customProgramCacheKey = () => leafKey + '-shrub-painted-leaves-v1';
  // Warm woody stems use geometry paint; a leaf atlas must never cover the wood.
  const opts = { occluder: true, key: 'shrub-stems-v1', comic: false };
  return { stems: toon({ color: 0xffffff, vertexColors: true }, opts), stemNm: normalMatFor(opts),
    stemDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    leaves: mats.fronds, leafNm: mats.frondNm, leafDepth: mats.frondDepth,
    painted: mats.painted, normal: mats.normal, textures: mats.textures.map((id) => SHRUB_TEXTURE_IDS[PALM_TEXTURE_IDS.indexOf(id)]) };
}
