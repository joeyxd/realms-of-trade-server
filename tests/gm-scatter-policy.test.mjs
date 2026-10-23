import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { resourceLayout } from '../src/data/resources.js';
import { canScatterAt } from '../src/editor/terrainData.js';

test('cosmetic scatter policy admits safe dry ground and rejects protected gameplay sites', () => {
  const map = generateWorld(20261010);
  assert.equal(canScatterAt(map, -136, -152, .3), true);
  assert.equal(canScatterAt(map, map.landmarks.village.x, map.landmarks.village.z, .3), false);
  const resource = resourceLayout(map).nodes[0];
  assert.ok(resource);
  assert.equal(canScatterAt(map, resource.x, resource.z, .3), false);
  assert.equal(canScatterAt(map, map.half - 1, 0, .3), false);
});

test('scatter rejects a footprint crossing the shoreline or a steep height break', () => {
  const base = generateWorld(20261010);
  const x = -136, z = -152;
  assert.equal(canScatterAt(base, x, z, .3), true);

  const coast = Object.assign(Object.create(base), {
    groundAt: (px, pz) => px > x ? 0 : base.groundAt(px, pz),
  });
  assert.equal(canScatterAt(coast, x, z, .3), false);

  const slope = Object.assign(Object.create(base), {
    groundAt: (px, pz) => base.groundAt(px, pz) + (px > x ? (px - x) * 2 : 0),
  });
  assert.equal(canScatterAt(slope, x, z, .3), false);
});
