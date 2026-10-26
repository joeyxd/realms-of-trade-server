// Roots reuse the already loaded S05 bark. Only the small leaves add a compact device-selected pair.
import { palmMaterials, PALM_TEXTURE_IDS } from './palmMaterials.js';

export const PALM_BASE_TEXTURE_IDS = ['tex:palm-base-albedo-v1', 'tex:palm-base-normal-v1'];

export function palmBaseMaterials(registry, swayUniform, existingPalmMaterials) {
  // Reuse the exact color/outline/shadow alpha and wind implementation verified for S05.
  const leaves = palmMaterials({ texture: (id) => registry.texture(PALM_BASE_TEXTURE_IDS[PALM_TEXTURE_IDS.indexOf(id)]) }, swayUniform);
  leaves.trunk.dispose(); leaves.trunkNm.dispose(); leaves.trunkDepth.dispose();
  return { roots: existingPalmMaterials.trunk, rootNm: existingPalmMaterials.trunkNm, rootDepth: existingPalmMaterials.trunkDepth,
    leaves: leaves.fronds, leafNm: leaves.frondNm, leafDepth: leaves.frondDepth,
    painted: leaves.painted, normal: leaves.normal,
    textures: leaves.textures.map((id) => PALM_BASE_TEXTURE_IDS[PALM_TEXTURE_IDS.indexOf(id)]) };
}
