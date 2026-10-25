import { terrainGridOf } from './terrainData.js';
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

// GM08: the bounds of the vertices of `region` whose height or paint differ between two compiled maps, or
// null. A gesture's region is the union of its strokes, mostly unchanged since the last frame: the rewrite and upload
// follow what moved, and the commit after a preview finds almost nothing left to change.
function changedBounds(a, b, { i0, j0, i1, j1 }) {
  const { Nx } = terrainGridOf(b);
  const ha = a.heights, hb = b.heights, pa = a.terrainPaint || null, pb = b.terrainPaint || null;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let j = j0; j <= j1; j++) for (let i = i0, k = j * Nx + i0; i <= i1; i++, k++) {
    let differs = ha !== hb && ha[k] !== hb[k];
    if (!differs && pa !== pb) for (let c = k * 4; c < k * 4 + 4; c++) if ((pa ? pa[c] : 0) !== (pb ? pb[c] : 0)) { differs = true; break; }
    if (!differs) continue;
    x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = j;
  }
  return x1 < 0 ? null : { i0: x0, j0: y0, i1: x1, j1: y1 };
}

/** GM08: the union of two grid vertex regions ({ i0, j0, i1, j1 }; either may be null), without `from`. */
export function joinRegions(a, b) {
  if (!a || !b) { const r = a || b; return r ? { i0: r.i0, j0: r.j0, i1: r.i1, j1: r.j1 } : null; }
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
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
  // A stroke's `region` (grid bounds plus the map it changed, TerrainSession.commit) limits the update to those
  // vertices when the preview shows that very map (GM07c); anything else rewrites the whole grid.
  const apply = (projectedMap, { region = null } = {}) => {
    if (disposed) return;
    if (!projectedMap || projectedMap === map || projectedMap.gmTerrain !== true) {
      restore();
      return;
    }
    // Compiled maps are snapshots: the map already shown needs no rewrite (a preview that changed nothing).
    if (projectedMap === currentMap && activeGeometry && heightTexture) return;
    const paintOnly = !!projectedMap.terrain && !!currentMap.terrain && sameHeights(projectedMap, currentMap);
    let dirty = activeGeometry && heightTexture && region?.from === currentMap ? region : null;
    if (dirty) {
      const changed = changedBounds(currentMap, projectedMap, dirty);
      if (!changed) { currentMap = projectedMap; return; }
      dirty = { ...changed, from: region.from };
    }
    // Render counts are per 560 m: 560 segments and 561 texels keep one metre per cell on either map.
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
      updateTerrainGeometry(terrain, projectedMap, { segments: 560, paintOnly, region: dirty });
    }
    if (heightTexture && !paintOnly) updateHeightTexture(projectedMap, heightTexture, { region: dirty });
    else if (!heightTexture) heightTexture = createHeightTexture(projectedMap, 561);
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
