// Reuse the selected raft atlas on individual dock boards before they are merged.
import { part } from './geo.js';
import { toon } from './toon.js';
import { mapRaftUV, RAFT_ATLAS_ID } from './raftMaterials.js';

// Narrow strips inside individual painted boards, excluding the atlas's ink seams.
// Normalized coordinates work on both the 1024 and 512 images selected by the registry.
const strip = (top, bottom) => Object.freeze({ u0: 24 / 1024, u1: 494 / 1024,
  v0: 1 - bottom / 1024, v1: 1 - top / 1024 });
export const DOCK_WOOD_RECTS = Object.freeze([
  strip(104, 127), strip(184, 207), strip(266, 291), strip(462, 488),
]);

export function dockWoodPart(geometry, color, transform, { mapped = false, variant = 0 } = {}) {
  // part deliberately strips UVs. Preserve a matching non-indexed copy, mapped in primitive
  // space so translated beams still run their grain along their own longest face axis.
  let uv = null;
  if (mapped) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const layout = ((Math.trunc(Number.isFinite(variant) ? variant : 0) % 8) + 8) % 8;
    const rect = DOCK_WOOD_RECTS[layout % 4];
    if (mapRaftUV(source, 'wood', { grain: 'box', variant, rect, woodSlice: false })) {
      uv = source.getAttribute('uv').clone();
      if (layout >= 4) for (let i = 0; i < uv.count; i++) uv.setX(i, rect.u0 + rect.u1 - uv.getX(i));
    }
    source.dispose();
  }
  const result = part(geometry, color, transform);
  if (uv) result.setAttribute('uv', uv);
  return result;
}

export function dockWoodMaterial(atlas, fallback) {
  if (!atlas) return fallback;
  const material = toon({ color: 0xffffff, map: atlas }, {
    occluder: true, key: 'dock-wood-v1', hatchMask: '0.0',
    albedo: /* glsl */ `{
      // A mild salt wash in perceptual space calms amber and painted teal without
      // baking sunlight or adding another procedural grain over the illustration.
      vec3 mnDockPaint = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.4545));
      float mnDockValue = dot(mnDockPaint, vec3(0.2126, 0.7152, 0.0722));
      mnDockPaint = mix(mnDockPaint, vec3(mnDockValue) * vec3(1.03, 1.0, 0.94), 0.22);
      diffuseColor.rgb = pow(mnDockPaint, vec3(2.2));
    }`,
  });
  material.name = 'dock:coastal-wood';
  material.userData.dockWood = { family: 'dock-wood-v1', atlas: RAFT_ATLAS_ID, texturesAdded: 0 };
  return material;
}
