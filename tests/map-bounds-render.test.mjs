import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { revampTerrain } from '../src/sim/terrainRevamp.js';
import { createTerrain, updateTerrainGeometry, createHeightTexture, updateHeightTexture, createSeabed } from '../src/render/terrain.js';
import { createWater } from '../src/render/water.js';

const original = generateWorld(99282957), grown = revampTerrain(original.terrainSource, { bounds: { minX: -840, maxX: 280, minZ: -280, maxZ: 280 } });
for (const [name, map, columns, center, side] of [['default', original, 321, 0, 2400], ['rectangle', grown, 641, -280, 2960]]) {
  test(`${name} terrain, height textures, seabed and water use their per-axis extent`, () => {
    const mesh = createTerrain(map), pos = mesh.geometry.getAttribute('position');
    assert.equal(pos.count, columns * 321); assert.equal(mesh.geometry.boundingBox.min.x, map.bounds.minX); assert.equal(mesh.geometry.boundingBox.max.x, map.bounds.maxX);
    const before = pos.array.slice(); updateTerrainGeometry(mesh, map, { segments: 320 }); assert.deepEqual(pos.array, before);
    const seabed = createSeabed(map); assert.equal(seabed.position.x, center); assert.equal(seabed.position.z, 0); assert.equal(seabed.geometry.parameters.width, side); assert.equal(seabed.geometry.parameters.height, side);
    for (const [res, width] of [[256, columns === 321 ? 256 : 511], [561, columns === 321 ? 561 : 1121]]) {
      const tex = createHeightTexture(map, res); assert.equal(tex.image.width, width); assert.equal(tex.image.height, res);
      const data = tex.image.data.slice(); updateHeightTexture(map, tex); assert.deepEqual(tex.image.data, data);
      const edited = { ...map, heightAt: () => 2 }; updateHeightTexture(edited, tex, { region: { i0: 560, i1: 560, j0: 280, j1: 280 } });
      const col = Math.round(560 * (width - 1) / (columns === 321 ? 560 : 1120)), row = Math.round(280 * (res - 1) / 560);
      assert.equal(tex.image.data[row * width + col], THREE.DataUtils.toHalfFloat(2)); assert.equal(tex.image.data[0], data[0]);
      const water = createWater(map, tex), u = water.material.uniforms;
      assert.deepEqual(u.uWorldMin.value.toArray(), [map.bounds.minX, map.bounds.minZ]); assert.deepEqual(u.uWorldSize.value.toArray(), [map.bounds.maxX - map.bounds.minX, 560]);
      water.geometry.computeBoundingBox(); const wb = water.geometry.boundingBox;
      assert.equal(water.position.x, 0); assert.equal((wb.min.x + wb.max.x) / 2, center); assert.equal((wb.min.z + wb.max.z) / 2, 0); assert.equal(water.geometry.parameters.width, side);
      water.geometry.dispose(); Object.values(water.userData.materials).forEach(m => m.dispose()); tex.dispose();
    }
    updateTerrainGeometry(mesh, { ...map, heightAt: () => 2 }, { segments: 320, region: { i0: 200, i1: 200, j0: 100, j1: 100 } });
    assert.equal(pos.getY(100 * columns + 200), 2); assert.equal(pos.getY(0), before[1]);
    for (const m of [mesh, seabed]) { m.geometry.dispose(); m.material.dispose(); m.userData.nm?.dispose(); }
  });
}
