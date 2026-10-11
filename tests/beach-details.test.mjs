import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import { readGlb, summarize } from '../tools/glb.mjs';
import { generateWorld } from '../src/sim/worldgen.js';
import {
  BEACH_DETAIL_LIMITS,
  beachDetailEligible,
  beachPebbleGeometry,
  buildBeachDetails,
  shellGeometry,
} from '../src/render/beachDetails.js';

const EPS = 1e-6;
const BEACH_MODEL_BUDGET = 24 * 1024;

function geometryState(geometry) {
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, [...attribute.array]])),
    index: geometry.index ? [...geometry.index.array] : null,
    groups: geometry.groups.map((group) => ({ ...group })),
  };
}

function assertShadedGeometry(geometry, label) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  assert.ok(position?.count >= 3, `${label} has triangle vertices`);
  assert.equal(position.count % 3, 0, `${label} is a triangle list`);
  assert.equal(normal?.count, position.count, `${label} has a normal per vertex`);
  assert.equal(color?.count, position.count, `${label} has a color per vertex`);
  for (let i = 0; i < position.count; i++) {
    for (const [attribute, name] of [[position, 'position'], [normal, 'normal'], [color, 'color']]) {
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Number.isFinite(attribute.getComponent(i, channel)), `${label} ${name} ${i}:${channel} is finite`);
      }
    }
    assert.ok(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) > EPS, `${label} normal ${i} is nonzero`);
    for (let channel = 0; channel < 3; channel++) {
      const value = color.getComponent(i, channel);
      assert.ok(value >= 0 && value <= 1, `${label} color ${i}:${channel} is in range`);
    }
  }
  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} triangle ${i / 3} has nonzero area`);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const { min, max } = geometry.boundingBox;
  for (const value of [...min.toArray(), ...max.toArray(), geometry.boundingSphere.radius]) {
    assert.ok(Number.isFinite(value), `${label} bounds are finite`);
  }
  assert.ok(max.x - min.x > 0 && max.y - min.y > 0 && max.z - min.z > 0, `${label} has nondegenerate bounds`);
}

test('beach eligibility excludes unsuitable terrain, access points, and nearby props', () => {
  let material = 'sand';
  let masks = { path: 0, volcanic: 0, arenaFloor: 0, lava: 0 };
  let heightAt = () => 0.5;
  let dock = false;
  const map = {
    materialAt: () => material,
    masks: () => masks,
    heightAt: (...args) => heightAt(...args),
    onDock: () => dock,
  };
  const eligible = () => beachDetailEligible(map, 0, 0);
  assert.equal(eligible(), true, 'flat dry sand is eligible');

  for (const surface of ['water', 'grass']) {
    material = surface;
    assert.equal(eligible(), false, `${surface} is excluded`);
  }
  material = 'sand';
  for (const key of ['path', 'volcanic', 'arenaFloor', 'lava']) {
    masks = { path: 0, volcanic: 0, arenaFloor: 0, lava: 0, [key]: key === 'path' ? 0.12 : key === 'volcanic' ? 0.15 : 0.1 };
    assert.equal(eligible(), false, `${key} mask boundary is excluded`);
  }
  masks = { path: 0, volcanic: 0, arenaFloor: 0, lava: 0 };
  heightAt = (x) => 0.5 + x;
  assert.equal(eligible(), false, 'steep terrain is excluded');
  heightAt = () => 0.5;
  dock = true;
  assert.equal(eligible(), false, 'dock surface is excluded');
  dock = false;

  map.landmarks = { spawn: { x: 0, z: 0 } };
  assert.equal(eligible(), false, 'spawn area is excluded');
  delete map.landmarks;
  map.practice = { dummy: { x: 0, z: 0, r: 0.5 } };
  assert.equal(eligible(), false, 'tutorial practice area is excluded');
  delete map.practice;
  map.props = [{ kind: 'tree', x: 0, z: 0, r: 1 }];
  assert.equal(eligible(), false, 'nearby solid props are excluded');
});

test('beach detail placement is deterministic, bounded, and leaves worldgen collision data untouched', () => {
  const map = generateWorld(20261006);
  const props = map.props;
  const colliders = map.colliders;
  const propsBefore = structuredClone(props);
  const collidersBefore = structuredClone(colliders);
  const first = buildBeachDetails(map);
  const second = buildBeachDetails(generateWorld(20261006));

  assert.deepEqual(first, second);
  assert.ok(first.shells.length > 0 && first.pebbles.length > 0, 'both detail families appear on the generated coast');
  assert.ok(first.shells.length <= BEACH_DETAIL_LIMITS.shells);
  assert.ok(first.pebbles.length <= BEACH_DETAIL_LIMITS.pebbles);
  for (const placement of [...first.shells, ...first.pebbles]) {
    for (const key of ['x', 'y', 'z', 'scale', 'rot', 'variant', 'nx', 'ny', 'nz']) {
      assert.ok(Number.isFinite(placement[key]), `${key} is finite`);
    }
    assert.ok(placement.scale > 0);
    assert.ok(placement.variant >= 0 && placement.variant < 3);
    assert.ok(Math.abs(Math.hypot(placement.nx, placement.ny, placement.nz) - 1) < 1e-5);
    assert.equal(beachDetailEligible(map, placement.x, placement.z), true, 'placement fits eligible dry sand');
  }
  assert.strictEqual(map.props, props);
  assert.strictEqual(map.colliders, colliders);
  assert.deepEqual(props, propsBefore);
  assert.deepEqual(colliders, collidersBefore);
});

test('all three shell styles and pebble clusters have finite colored surface geometry', () => {
  for (let variant = 0; variant < 3; variant++) {
    const geometry = shellGeometry(variant);
    assertShadedGeometry(geometry, `shell ${variant}`);
    geometry.dispose();
  }

  const fallback = beachPebbleGeometry();
  assertShadedGeometry(fallback, 'fallback pebble cluster');
  fallback.dispose();

  const source = new THREE.IcosahedronGeometry(1, 1);
  const before = geometryState(source);
  const cluster = beachPebbleGeometry(source);
  assert.deepEqual(geometryState(source), before, 'cluster generation preserves its reusable source mesh');
  assertShadedGeometry(cluster, 'source pebble cluster');
  cluster.dispose();
  source.dispose();
});

test('delivered beach GLBs are registered, texture-free, and within the small model budget', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const expected = [
    ['model:beach-shell-fan-v1', 'assets/models/beach-shell-fan-v1.glb', 80],
    ['model:beach-shell-oval-v1', 'assets/models/beach-shell-oval-v1.glb', 96],
    ['model:beach-shell-chip-v1', 'assets/models/beach-shell-chip-v1.glb', 48],
    ['model:beach-pebbles-v1', 'assets/models/beach-pebbles-v1.glb', 192],
  ];
  for (const [id, file, triangles] of expected) {
    const entry = manifest.assets.find((asset) => asset.id === id);
    assert.ok(entry, `${id} is registered`);
    assert.equal(entry.kind, 'model');
    assert.equal(entry.fit, 'none', `${id} keeps its authored geometry units`);
    assert.equal(entry.src, file.slice('assets/'.length));

    const bytes = fs.readFileSync(new URL(`../${file}`, import.meta.url));
    assert.ok(bytes.length <= BEACH_MODEL_BUDGET, `${id} is at most 24 KiB`);
    const parsed = readGlb(bytes);
    const info = summarize(parsed);
    assert.equal(info.tris, triangles, `${id} keeps its intended triangle budget`);
    assert.deepEqual(info.images, [], `${id} has no embedded texture images`);
    const primitive = parsed.json.meshes[0].primitives[0];
    assert.ok(primitive.attributes.NORMAL !== undefined, `${id} carries normals`);
    assert.ok(primitive.attributes.COLOR_0 !== undefined, `${id} carries vertex colors`);
  }
});

