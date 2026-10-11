import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Footprints } from '../src/render/vfx/footprints.js';
import { ACT } from '../src/sim/ecs.js';

const actor = (overrides = {}) => ({ x: 0, y: 0.2, z: 0, vx: 0, vz: 1, st: 0, hp: 100, act: 0, wade: 0, ...overrides });

function makeMap(overrides = {}) {
  return {
    materialAt: () => 'sand',
    heightAt: (x, z) => 0.2 + x * 0.08 + z * 0.04,
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
    ...overrides,
  };
}

function makeFx(map = makeMap(), tuning = {}, playing = true) {
  const scene = new THREE.Scene();
  const fx = new Footprints(scene, map, tuning);
  if (playing) fx.update(0, true);
  return { scene, fx };
}

test('footprints stay inactive until play and plant alternating, movement-oriented prints conforming to terrain', () => {
  const { fx } = makeFx(makeMap(), {}, false);
  const s = actor({ vx: 1, vz: 0 });
  assert.equal(fx.plant('p', 0, s), false);
  assert.equal(fx.used, 0);
  fx.update(0, true);
  assert.equal(fx.plant('p', 0, s), true);
  assert.equal(fx.plant('p', 1, { ...s, x: 0.5 }), true);
  assert.equal(fx.used, 2);
  assert.equal(fx.mesh.visible, true);
  assert.equal(fx.geometry.drawRange.count, 48);

  const first = fx.pool[0], second = fx.pool[1];
  assert.equal(first.side, 0);
  assert.equal(second.side, 1);
  assert.ok(first.f > 1.5 && first.f < 1.6); // Facing the x movement vector.
  assert.ok(first.z > 0 && second.z < 0); // Alternating feet lie on opposite sides.
  const positions = fx.geometry.attributes.position;
  for (let slot = 0; slot < 2; slot++) {
    for (let vertex = 0; vertex < 9; vertex++) {
      const i = slot * 9 + vertex;
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      assert.ok(Math.abs(y - (0.2 + x * 0.08 + z * 0.04 + 0.035)) < 1e-6);
    }
  }
});

test('dry and wet terrain set different lifetimes and prints fade out and expire', () => {
  const { fx } = makeFx(makeMap({ heightAt: () => 0.5 }));
  assert.equal(fx.plant('dry', 0, actor({ y: 0.5 })), true);
  assert.equal(fx.pool[0].life, 18);
  const wet = makeFx(makeMap({ heightAt: () => 0.08 }));
  assert.equal(wet.fx.plant('wet', 0, actor({ y: 0.08 })), true);
  assert.equal(wet.fx.pool[0].life, 5);
  assert.equal(wet.fx.pool[0].wet, 1);

  fx.update(13, true);
  assert.equal(fx.count, 1);
  fx.update(5, true);
  assert.equal(fx.count, 0);
  assert.equal(fx.mesh.visible, false);
});

test('rejects non-playing, invalid movement and non-sand or unsafe terrain conditions', () => {
  const inactive = new Footprints(new THREE.Scene(), makeMap());
  assert.equal(inactive.plant('p', 0, actor()), false);

  const rejectedActors = [
    actor({ dead: true }), actor({ hp: 0 }), actor({ st: 1 }), actor({ act: ACT.LEAP }),
    actor({ wade: 0.081 }), actor({ vx: 0, vz: 0 }), actor({ vx: NaN }),
    actor({ x: NaN }), actor({ y: NaN }), actor({ z: NaN }), actor({ vz: Infinity }),
  ];
  for (const state of rejectedActors) {
    const { fx } = makeFx();
    assert.equal(fx.plant('p', 0, state), false, JSON.stringify(state));
  }

  const rejectedMaps = [
    makeMap({ materialAt: () => 'water' }), makeMap({ materialAt: () => 'wood' }),
    makeMap({ materialAt: () => 'grass' }), makeMap({ masks: () => ({ path: 1, volcanic: 0, arenaFloor: 0, lava: 0 }) }),
    makeMap({ masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 1 }) }),
    makeMap({ heightAt: () => 1.7 }),
    makeMap({ heightAt: (x, z) => x > -0.15 ? 0.8 : 0.2 }),
    makeMap({ heightAt: (x, z) => z > 0 ? 0.8 : 0.2 }),
  ];
  for (const [index, map] of rejectedMaps.entries()) {
    const { fx } = makeFx(map);
    assert.equal(fx.plant('p', 0, actor()), false, `map rejection ${index}`);
  }
  const deck = makeFx(makeMap({ heightAt: () => 0.6 }));
  assert.equal(deck.fx.plant('p', 0, actor({ y: 0.2 })), false);

  for (const action of [ACT.LEAP]) {
    const { fx } = makeFx();
    const state = actor({ act: action });
    assert.equal(fx.plant('p', 0, state), false);
  }
});

test('rejects grass-edge, arena-floor and volcanic masks', () => {
  for (const masks of [
    { path: 0, volcanic: 0, arenaFloor: 1, lava: 0 },
    { path: 0, volcanic: 1, arenaFloor: 0, lava: 0 },
    { path: 0.21, volcanic: 0, arenaFloor: 0, lava: 0 },
  ]) {
    const { fx } = makeFx(makeMap({ masks: () => masks }));
    assert.equal(fx.plant('p', 0, actor()), false);
  }
});

test('idle reconciliation and teleports are rejected; capacity, quality, actor forgetting and title clearing work', () => {
  const { fx } = makeFx(makeMap(), { capacity: 2 });
  assert.equal(fx.plant('p', 0, actor()), true);
  assert.equal(fx.plant('p', 1, actor({ x: 0.1 })), false);
  assert.equal(fx.plant('p', 1, actor({ x: 0.5 })), true);
  assert.equal(fx.plant('p', 0, actor({ x: 10 })), false);
  fx.plant('q', 0, actor({ x: 1 }));
  assert.equal(fx.used, 2);
  assert.equal(fx.cursor, 1);
  fx.plant('p', 0, actor());
  fx.forget('p');
  assert.equal(fx.steps.has('p'), false);
  fx.update(0, false);
  assert.equal(fx.used, 0);
  assert.equal(fx.steps.size, 0);
  assert.equal(fx.mesh.visible, false);
});

test('setQuality clears active prints and caps the reusable pool at capacity', () => {
  const { fx } = makeFx(makeMap(), { capacity: 256 });
  assert.equal(fx.pool.length, 256);
  fx.plant('p', 0, actor());
  fx.plant('p', 1, actor({ x: 0.5 }));
  fx.setQuality(0.5);
  assert.equal(fx.limit, 96);
  assert.equal(fx.used, 0);
  assert.equal(fx.mesh.visible, false);
  fx.setQuality(1);
  assert.equal(fx.limit, 256);
  assert.equal(fx.used, 0);
  fx.setQuality(1, true);
  assert.equal(fx.limit, 128);
});

test('dispose removes the mesh and disposes its geometry and material', () => {
  const scene = new THREE.Scene();
  const fx = new Footprints(scene, makeMap());
  let geometryDisposed = false, materialDisposed = false;
  fx.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  fx.material.addEventListener('dispose', () => { materialDisposed = true; });
  fx.dispose();
  assert.equal(scene.children.includes(fx.mesh), false);
  assert.equal(geometryDisposed, true);
  assert.equal(materialDisposed, true);
  assert.equal(fx.geometry.drawRange.count, 0);
});
