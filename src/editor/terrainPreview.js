import { createTerrain, createHeightTexture, updateTerrainGeometry, updateHeightTexture } from '../render/terrain.js';

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
    const paintOnly = !!projectedMap.terrain && !!currentMap.terrain &&
      JSON.stringify(projectedMap.terrain.samples) === JSON.stringify(currentMap.terrain.samples);
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
