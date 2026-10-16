import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { LocalLights } from '../src/render/lights.js';
import { RaftLayer } from '../src/render/rafts.js';
import { isRaftFireTuple, personalLanternPoint, raftFirePoint, PERSONAL_LANTERN_LOCAL } from '../src/render/personalLantern.js';

const map = generateWorld(GAME.seed);
const foundation = ['foundation', 0, 0, 0, 0];

test('hand-held torch anchor and supported raft fire tuples stay finite and rotated with the raft', () => {
  assert.deepEqual(PERSONAL_LANTERN_LOCAL, { x: 0.35, y: 1.1, z: 0.35 });
  assert.deepEqual(personalLanternPoint({ x: 1, y: 2, z: 3, f: 0 }), { x: 1.35, y: 3.1, z: 3.35 });
  const record = { x: 10, y: 0.72, z: -4, yaw: Math.PI / 2 };
  for (const tuple of [
    ['torchFloor', 1, 2, 1, 0], ['torchWall', 1, 2, 1, 1], ['campfire', 1, 2, 1, 0],
    ['grill', 1, 2, 1, 0], ['lantern', 1, 2, 1, 0],
  ]) {
    assert.equal(isRaftFireTuple(tuple), true);
    const point = raftFirePoint(record, tuple);
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    assert.ok(Math.abs(point.x - 15) < 1e-8, `${tuple[0]} rotates with raft yaw`);
    assert.ok(point.y > record.y);
  }
  assert.equal(isRaftFireTuple(['grill', 1.5, 0, 0, 0]), false);
  assert.equal(raftFirePoint({ ...record, yaw: NaN }, ['campfire', 0, 0, 0, 0]), null);
});

test('raft torch, campfire and grill cores only show for lit public tuples and follow moving raft sources', () => {
  const scene = new THREE.Group();
  const layer = new RaftLayer(scene, { skin: false });
  const lights = new LocalLights(map);
  try {
    const pieces = [
      ['torchFloor', 1, 0, 0, 0], ['torchWall', 0, 1, 0, 2], ['campfire', 1, 1, 0, 0],
      ['grill', 0, 0, 0, 0], ['lantern', 1, 0, 0, 1],
    ];
    const base = { id: 'fire-raft', rev: 1, x: 10, y: 0.72, z: -4, yaw: Math.PI / 2,
      parts: [foundation, ...pieces], litLanterns: [] };
    layer.update([base], 0);
    const view = layer.views.get(base.id);
    assert.equal(view.lanternCores.length, pieces.length);
    assert.equal(view.lanternCores.every((core) => !core.visible), true);
    const wallCore = view.lanternCores.find((core) => core.userData.raftLanternPart[0] === 'torchWall');
    assert.ok(wallCore, 'mount-layer wall torches render a flame core');
    assert.deepEqual(wallCore.position.toArray(), [1, 2.13, 3.68], 'flame sits above the bracket, inward from the wall edge');
    const wallPoint = raftFirePoint(base, ['torchWall', 0, 1, 0, 2]);
    assert.ok(Math.abs(wallPoint.x - 13.68) < 1e-8 && Math.abs(wallPoint.y - 2.85) < 1e-8 && Math.abs(wallPoint.z + 5) < 1e-8,
      'mounted fire light matches the rendered flame after raft rotation');
    const lit = { ...base, litLanterns: pieces.map((part) => [...part]) };
    layer.update([lit], 0.1);
    assert.equal(view.lanternCores.every((core) => core.visible), true);
    const grill = view.lanternCores.find((core) => core.userData.raftLanternPart[0] === 'grill');
    assert.ok(grill);
    layer.update([{ ...lit, litLanterns: lit.litLanterns.filter((part) => part[0] !== 'grill') }], 0.2);
    assert.equal(grill.visible, false, 'an unlit grill has no visible fire core');

    lights.setRafts([lit], lit.id);
    assert.equal(lights.raftSources.size, pieces.length);
    for (const tuple of pieces) {
      const source = [...lights.raftSources.values()].find((entry) => JSON.stringify(entry.part) === JSON.stringify(tuple));
      assert.ok(source, `${tuple[0]} has a local-light source`);
      const point = raftFirePoint(lit, tuple);
      assert.deepEqual({ x: source.x, y: source.y, z: source.z }, point);
    }
    const sample = [...lights.raftSources.values()][0];
    lights.setRafts([{ ...lit, x: 20, z: 7, yaw: 0 }], lit.id);
    assert.equal([...lights.raftSources.values()][0], sample, 'pose updates reuse existing sources');
    lights.setRafts([{ ...base, parts: [foundation, ['grill', 0, 0, 0, 0]], litLanterns: [['grill', 0, 0, 0, 0]] }]);
    assert.equal(lights.raftSources.size, 1, 'only a placed lit fixture gets a source');
    lights.setRafts([{ ...base, parts: [foundation, ['grill', 0, 0, 0, 0]], litLanterns: [] }]);
    assert.equal(lights.raftSources.size, 0, 'unfuelled grill creates no source');
  } finally {
    layer.dispose();
    lights.portableSources.clear();
  }
});
