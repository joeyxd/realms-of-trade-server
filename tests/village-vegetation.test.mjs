// The village plants (T-1019-04): the Tripo fern, flower bush and broadleaf plant dress the hut bases, the plaza rim and the
// vendor stall of the night village (worldgen.js VILLAGE_VEGETATION). Placement, clearances and the foliage that keeps off
// them; the render side (kits, imported instances, fallback) is in tests/prop-variants.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { resourceLayout } from '../src/data/resources.js';
import { buildShrubs, shrubSiteContext } from '../src/render/shrubPlacement.js';
import { buildGrassPatches } from '../src/render/grassPlacement.js';

// After the baseline props (1259), the night plaza dressing (20) and the village palms (17).
const SEED = 99282957, FIRST = 1259 + 20 + 17, COUNT = 24;
const KINDS = ['fern', 'flowerbush', 'broadleaf'];
const PLANT_R = { fern: 0.58, flowerbush: 0.7, broadleaf: 0.58 }; // shrubPlacement.js obstacle radius at scale 1
const map = generateWorld(SEED);
const plants = map.props.slice(FIRST, FIRST + COUNT);
const village = map.landmarks.village;
const huts = map.props.filter((p) => p.kind === 'hut');
const campfire = map.props.find((p) => p.kind === 'campfire');
const stall = map.props.find((p) => p.kind === 'stall');
const palms = map.props.filter((p) => p.kind === 'palm');
const TOWN = new Set(['lantern', 'fence', 'board', 'planter', 'stallTarp', 'crate', 'barrel', 'stall', 'rack', 'sign']);
const town = map.props.filter((p) => TOWN.has(p.kind) && Math.hypot(p.x - village.x, p.z - village.z) < 45);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const segDist = (p, a, b) => {
  const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  return Math.hypot(p.x - a.x - abx * t, p.z - a.z - abz * t);
};
// A fence is a 2 u segment along its local x (props.js fenceGeo); everything else a circle of radius r.
const propGap = (p, q) => {
  if (q.kind !== 'fence') return dist(p, q) - q.r;
  const ax = Math.cos(q.rot), az = -Math.sin(q.rot);
  return segDist(p, { x: q.x - ax, z: q.z - az }, { x: q.x + ax, z: q.z + az });
};
// Angle between a spot and a hut's door axis (its local +z), in radians.
const doorOff = (p, h) => {
  const a = Math.atan2(p.x - h.x, p.z - h.z) - h.rot;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
};
const onHutBase = (p) => huts.some((h) => dist(p, h) >= 2.7 && dist(p, h) <= 3.6);
const count = (list) => Object.fromEntries(KINDS.map((k) => [k, list.filter((p) => p.kind === k).length]));

test('the village plants are appended after the palms: 10 ferns, 7 flower bushes, 7 broadleaf plants, no collider', () => {
  assert.equal(map.props.length, FIRST + COUNT);
  assert.equal(plants.length, COUNT);
  assert.deepEqual(count(plants), { fern: 10, flowerbush: 7, broadleaf: 7 });
  assert.ok(!map.props.slice(0, FIRST).some((p) => KINDS.includes(p.kind)), 'no plant of these kinds before the block');
  for (const p of plants) {
    const at = `${p.kind} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    assert.ok(KINDS.includes(p.kind), at);
    assert.deepEqual(Object.keys(p).sort(), ['h', 'kind', 'r', 'rot', 'scale', 'v', 'x', 'y', 'z']);
    assert.ok([p.x, p.y, p.z, p.rot, p.scale, p.h, p.v].every(Number.isFinite), at);
    assert.equal(p.r, 0, `${at}: players and bots walk through plants`);
    assert.equal(p.v, 0.5, `${at}: explicit variant seed, no rng`);
    assert.ok(p.scale >= 0.85 && p.scale <= 1.25, `${at}: scale ${p.scale}`);
    assert.ok(!map.colliders.some((c) => c.x === p.x && c.z === p.z), `${at} has no collider`);
    assert.ok(Math.abs(p.y - map.groundAt(p.x, p.z)) < 0.02, `${at} stands on the reshaped ground`);
  }
});

test('the village plants keep clear of the cobbles, the fire, the doors, the props, the palms, each other and the routes', () => {
  const W = map.botWaypoints, legs = W.map((w, i) => [w, W[(i + 1) % W.length]]);
  const npcs = map.npcs.filter((n) => ['merchant', 'vendor', 'tattoo'].includes(n.id));
  const { ring, dummy, cannon } = map.practice;
  for (const p of plants) {
    const at = `${p.kind} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    assert.ok(dist(p, village) <= 30, `${at} is ${dist(p, village).toFixed(1)} u from the village point`);
    assert.ok(dist(p, village) >= 7.4 || onHutBase(p), `${at} is on the cobbles and not at a hut base`);
    for (const h of huts) {
      const d = dist(p, h);
      assert.ok(d >= 2.7, `${at} is ${d.toFixed(2)} from a hut centre (inside its collider)`);
      if (d < 6) assert.ok(doorOff(p, h) >= 0.9, `${at} stands on a hut door axis`);
    }
    assert.ok(dist(p, campfire) >= 3.5, `${at} is by the campfire`);
    for (const q of town) assert.ok(propGap(p, q) >= 0.6 - 1e-9, `${at} is ${propGap(p, q).toFixed(2)} from a ${q.kind}`);
    for (const q of palms) assert.ok(dist(p, q) - q.r >= 0.5 - 1e-9, `${at} is ${(dist(p, q) - q.r).toFixed(2)} from a palm trunk`);
    for (const q of plants) if (q !== p) assert.ok(dist(p, q) >= 0.9 - 1e-9, `${at} is ${dist(p, q).toFixed(2)} from another plant`);
    for (const c of map.colliders) assert.ok(dist(p, c) - c.r >= 0.1 - 1e-9, `${at} is inside a collider`);
    // The walking routes (routeClear with a 0.5 u footprint): bot waypoints, the legs between them, the Sendero, the NPCs.
    for (const w of W) assert.ok(dist(p, w) >= 1.5, `${at} is on a bot waypoint`);
    for (const [a, b] of legs) assert.ok(segDist(p, a, b) >= 0.9 + 0.5 - 1e-9, `${at} is on a bot route`);
    assert.ok(map.pathInfo(p.x, p.z).d >= 1.5, `${at} is on the Sendero`);
    for (const n of npcs) assert.ok(dist(p, n) >= 1.2, `${at} is on ${n.id}`);
    // nearPractice: the practice ground and the weapon racks.
    assert.ok(dist(p, ring) >= ring.r + 5 && dist(p, dummy) >= 6 && dist(p, cannon) >= 5, `${at} is on the practice ground`);
    for (const k of map.racks) assert.ok(dist(p, k) >= 3.2, `${at} crowds a weapon rack`);
    // Gentle footing on the final terrain (the town ramp is about 0.2 u per u), dry land.
    const ys = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].map(([dx, dz]) => map.heightAt(p.x + dx, p.z + dz));
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.3, `${at} stands on a slope`);
    assert.notEqual(map.materialAt(p.x, p.z), 'water');
  }
});

test('the village plants dress every hut base, the plaza rim between the palms and the vendor stall', () => {
  for (const h of huts) {
    const base = plants.filter((p) => dist(p, h) >= 2.7 && dist(p, h) <= 3.6);
    assert.ok(base.length >= 2 && base.length <= 3, `hut at ${h.x.toFixed(1)},${h.z.toFixed(1)} has ${base.length} plants at its base`);
  }
  // A flower bush just beside a door: at a hut base, off the door axis by less than 1.2 rad (the axis arc is 0.9).
  const byDoor = huts.filter((h) => plants.some((p) => p.kind === 'flowerbush' && dist(p, h) <= 3.6 && doorOff(p, h) < 1.2));
  assert.ok(byDoor.length >= 4, `${byDoor.length} huts with a flower bush beside the door`);
  // The rim: outside the cobbles, off the hut bases, in clusters (each with a neighbour within 2 u), with palms around.
  const rim = plants.filter((p) => !onHutBase(p) && dist(p, village) >= 7.4 && dist(p, village) <= 13);
  assert.ok(rim.length >= 6, `${rim.length} plants on the plaza rim`);
  for (const p of rim) assert.ok(rim.some((q) => q !== p && dist(p, q) <= 2), `rim ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} stands alone`);
  assert.ok(rim.filter((p) => palms.some((q) => dist(p, q) <= 2.5)).length >= 2, 'ferns under the ring palms');
  const byStall = plants.filter((p) => dist(p, stall) <= 4);
  assert.ok(byStall.length >= 1 && byStall.length <= 2, `${byStall.length} plants by the vendor stall`);
  assert.deepEqual(count(plants.filter((p) => onHutBase(p))), { fern: 7, flowerbush: 4, broadleaf: 6 });
});

test('the village plants move no harvest node (resourceLayout, which also shapes the terrain, ignores them)', () => {
  const without = { ...map, props: map.props.slice(0, FIRST) };
  assert.deepEqual(resourceLayout(map), resourceLayout(without));
  const nodes = resourceLayout(map).nodes;
  for (const p of plants) for (const n of nodes) assert.ok(dist(p, n) >= 1.5, `${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} covers resource ${n.id}`);
});

test('village plant placement is deterministic and draws no random numbers', () => {
  const again = generateWorld(SEED);
  assert.deepEqual(again.props.slice(FIRST), plants);
  assert.deepEqual(again.colliders, map.colliders);
  // Another seed keeps every rule the generator itself checks (a plant with no clear spot is dropped, never forced).
  const other = generateWorld(20261007), otherVillage = other.landmarks.village;
  const otherHuts = other.props.filter((p) => p.kind === 'hut');
  const otherPlants = other.props.filter((p) => KINDS.includes(p.kind));
  assert.ok(otherPlants.length >= 20 && otherPlants.length <= COUNT);
  for (const p of otherPlants) {
    assert.equal(p.r, 0);
    assert.ok(dist(p, otherVillage) >= 7.4 || otherHuts.some((h) => dist(p, h) >= 2.7 && dist(p, h) <= 3.6));
    for (const h of otherHuts) assert.ok(dist(p, h) >= 2.7 && (dist(p, h) >= 6 || doorOff(p, h) >= 0.9));
    for (const q of otherPlants) if (q !== p) assert.ok(dist(p, q) >= 0.9 - 1e-9);
  }
});

test('shrubs and scattered grass keep off the plants (their obstacle radius in shrubPlacement.js)', () => {
  const ctx = shrubSiteContext(map);
  for (const p of plants) {
    const entries = [...ctx.buckets.values()].flat().filter((e) => e.x === p.x && e.z === p.z);
    assert.ok(entries.length > 0, `${p.kind} is an obstacle`);
    for (const e of entries) assert.ok(Math.abs(e.radius - PLANT_R[p.kind] * p.scale) < 1e-9, `${p.kind} radius ${e.radius}`);
  }
  const shrubs = buildShrubs(map), grass = buildGrassPatches(map, { shrubs });
  for (const s of shrubs) for (const p of plants) assert.ok(dist(s, p) >= PLANT_R[p.kind] * p.scale, 'a shrub on a plant');
  // Scattered clumps pass shrubSite (radius + obstacle + 0.3); edge clumps only check colliders, which plants do not have.
  for (const g of grass.filter((c) => !c.edge)) for (const p of plants)
    assert.ok(dist(g, p) >= g.radius + PLANT_R[p.kind] * p.scale + 0.3 - 1e-9, `a grass clump at ${g.x.toFixed(1)},${g.z.toFixed(1)} on a ${p.kind}`);
});
