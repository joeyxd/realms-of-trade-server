import { createTerrain, createHeightTexture, updateTerrainGeometry, updateHeightTexture } from '../render/terrain.js';

// A map compiled from a grid (GM07) holds the grid itself as `terrain`, mutated in place by the editor: its compiled
// heights tell a paint-only change. Terrain v1/v2 maps compare their height samples as before.
const gridHeights = (map) => map.terrain?.deltasMm instanceof Int32Array ? map.heights : null;
function sameHeights(a, b) {
  const left = gridHeights(a), right = gridHeights(b);
  if (!left && !right) return JSON.stringify(a.terrain.samples) === JSON.stringify(b.terrain.samples);
  if (!left || !right || left.length !== right.length) return false;
  if (left === right) return true;
  for (let k = 0; k < left.length; k++) if (left[k] !== right[k]) return false;
  return true;
}

/** Render a private GM terrain projection while retaining the live scene objects and materials. */
export function createTerrainPreview({ scene, map, invalidate = () => {} } = {}) {
  if (!scene || !map) throw new TypeError('createTerrainPreview requires scene and map');
  const terrain = scene.getObjectByName?.('terrain');
  if (!terrain?.geometry) throw new TypeError('Terrain scene mesh is unavailable');
  const originalGeometry = terrain.geometry;
  const water = scene.getObjectByName?.('water');
  const waterMaterials = [...new Set([water?.material, water?.userData?.materials?.ssr, water?.userData?.materials?.simple])]
    .filter((material) => material?.uniforms?.uHeight);
  const originalHeights = waterMaterials.map((material) => [material, material.uniforms.uHeight.value]);
  let activeGeometry = null;
  let heightTexture = null;
  let currentMap = map;
  let disposed = false;

  const setWaterHeight = (texture) => {
    for (const material of waterMaterials) material.uniforms.uHeight.value = texture;
  };
  const restore = () => {
    if (disposed) return;
    if (activeGeometry) {
      terrain.geometry = originalGeometry;
      activeGeometry.dispose();
      activeGeometry = null;
    }
    if (heightTexture) {
      heightTexture.dispose();
      heightTexture = null;
    }
    for (const [material, original] of originalHeights) material.uniforms.uHeight.value = original;
    currentMap = map;
    invalidate();
  };
  const apply = (projectedMap) => {
    if (disposed) return;
    if (!projectedMap || projectedMap === map || projectedMap.gmTerrain !== true) {
      restore();
      return;
    }
    const paintOnly = !!projectedMap.terrain && !!currentMap.terrain && sameHeights(projectedMap, currentMap);
    if (!activeGeometry) {
      const temporary = createTerrain(projectedMap, { segments: 560 });
      activeGeometry = temporary.geometry;
      temporary.geometry = null;
      temporary.material.dispose();
      temporary.userData.nm?.dispose?.();
      temporary.userData = {};
      terrain.geometry = activeGeometry;
    } else {
      // Reuse GPU buffers while a sculpt stroke updates the projected sample set.
      updateTerrainGeometry(terrain, projectedMap, { segments: 560, paintOnly });
    }
    if (heightTexture && !paintOnly) updateHeightTexture(projectedMap, heightTexture);
    else if (!heightTexture) heightTexture = createHeightTexture(projectedMap);
    setWaterHeight(heightTexture);
    currentMap = projectedMap;
    invalidate();
  };
  const dispose = () => {
    if (disposed) return;
    restore();
    disposed = true;
  };

  return { apply, restore, dispose, get map() { return currentMap; } };
}
