import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { resourceLayout } from '../src/data/resources.js';
import { palmVariant } from '../src/render/palmGeometry.js';
import { U, patchToon, normalMatFor } from '../src/render/toon.js';

// The village palms (T-1018-36) come right after the baseline props (1259) and the night plaza dressing (20).
const SEED = 99282957, FIRST = 1259 + 20, COUNT = 17;
const map = generateWorld(SEED);
const palms = map.props.slice(FIRST, FIRST + COUNT);
const village = map.landmarks.village;
const huts = map.props.filter((p) => p.kind === 'hut');
const campfire = map.props.find((p) => p.kind === 'campfire');
const allPalms = map.props.filter((p) => p.kind === 'palm');
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
// Crown height above the ground: the form's trunk height (palmGeometry.js FORMS: tall 6, curved 5.7, short 4.2) times h / 6 * scale.
const crown = (p) => [6, 5.7, 4.2][palmVariant(p)] * (p.h / 6) * p.scale;

test('the village palms are appended after the plaza dressing, each with the standard palm fields and collider', () => {
  const PROP_TOTAL = 1259 + 20 + 17 + 24; // the 24 plants of worldgen.js VILLAGE_VEGETATION (T-1019-04) follow the palms
  assert.equal(map.props.length, PROP_TOTAL);
  assert.equal(palms.length, COUNT);
  for (const p of palms) {
    assert.equal(p.kind, 'palm');
    assert.deepEqual(Object.keys(p).sort(), ['h', 'kind', 'r', 'rot', 'scale', 'v', 'x', 'y', 'z']);
    assert.equal(p.r, 0.38);
    assert.ok([p.x, p.y, p.z, p.rot, p.scale, p.h, p.v].every(Number.isFinite));
    assert.ok(map.colliders.slice(-COUNT).some((c) => c.x === p.x && c.z === p.z && c.r === 0.38), 'its trunk collider is appended too');
    assert.ok(Math.abs(p.y - map.groundAt(p.x, p.z)) < 0.02, 'standing on the reshaped ground');
  }
  // The same shape as the island's own palms, so vegetation.js builds them unchanged.
  assert.deepEqual(Object.keys(palms[0]).sort(), Object.keys(allPalms[0]).sort());
});

test('the village palms keep clear of the plaza, the fire, the huts, the props, the routes and the resources', () => {
  const nodes = resourceLayout(map).nodes;
  const W = map.botWaypoints, legs = W.map((w, i) => [w, W[(i + 1) % W.length]]);
  for (const p of palms) {
    const at = `palm at ${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    assert.ok(dist(p, village) >= 7.5, `${at} is on the cobbles`);
    assert.ok(dist(p, campfire) >= 3.5, `${at} is by the campfire`);
    for (const q of allPalms) if (q !== p) assert.ok(dist(p, q) >= 2.8, `${at} is ${dist(p, q).toFixed(2)} from another palm`);
    for (const h of huts) {
      const d = dist(p, h);
      assert.ok(d >= 3.2, `${at} is ${d.toFixed(2)} from a hut centre`);
      if (d < 6) {
        const a = Math.atan2(p.x - h.x, p.z - h.z) - h.rot;
        assert.ok(Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) >= 0.9, `${at} stands in front of a hut door`);
      }
    }
    for (const q of town) assert.ok(propGap(p, q) >= 1.4 - 1e-9, `${at} is ${propGap(p, q).toFixed(2)} from a ${q.kind}`);
    for (const c of map.colliders) if (c.x !== p.x || c.z !== p.z) assert.ok(dist(p, c) - c.r - p.r >= 0.3 - 1e-9, `${at} touches a collider`);
    // The walking routes: bot waypoints, the straight legs between them, the Sendero and the NPCs.
    for (const w of W) assert.ok(dist(p, w) >= 1.5, `${at} is on a bot waypoint`);
    for (const [a, b] of legs) assert.ok(segDist(p, a, b) >= 0.9 + p.r, `${at} blocks a bot route`);
    assert.ok(map.pathInfo(p.x, p.z).d >= 1.5, `${at} is on the Sendero`);
    for (const n of map.npcs) assert.ok(dist(p, n) >= 1.2, `${at} is on ${n.id}`);
    for (const k of map.racks) assert.ok(dist(p, k) >= 3.2, `${at} crowds a weapon rack`);
    for (const n of nodes) assert.ok(dist(p, n) >= 2.8, `${at} is ${dist(p, n).toFixed(2)} from resource ${n.id}`);
    // Flat footing on the town terraces (never on a terrace step), dry land.
    const ys = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].map(([dx, dz]) => map.heightAt(p.x + dx, p.z + dz));
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.5, `${at} stands on a slope`);
    assert.notEqual(map.materialAt(p.x, p.z), 'water');
  }
});

test('the village palms frame the plaza, flank every hut and stand between the default camera and the player', () => {
  assert.ok(palms.length >= 14 && palms.length <= 18);
  const ring = palms.filter((p) => dist(p, village) >= 9 && dist(p, village) <= 13);
  assert.ok(ring.length >= 6, `${ring.length} palms on the ring just outside the cobbles`);
  for (const h of huts) assert.ok(palms.some((p) => dist(p, h) >= 3.2 && dist(p, h) <= 4), `hut at ${h.x.toFixed(1)},${h.z.toFixed(1)} has no palm beside it`);
  const stall = map.props.find((p) => p.kind === 'stall');
  assert.ok(palms.filter((p) => dist(p, stall) <= 6).length >= 2, 'two palms by the vendor stall');
  // tools/shot.mjs default spot (village + (2, 4)) at yaw 45: the camera sits on the +x+z side.
  const spot = { x: village.x + 2, z: village.z + 4 };
  const front = palms.filter((p) => (p.x - spot.x) + (p.z - spot.z) > 0 && dist(p, spot) >= 5 && dist(p, spot) <= 9);
  assert.ok(front.length >= 3, `${front.length} palms between the default camera and the player`);
  // Mostly the tall and curved forms with crowns at 5.4 to 6 u; the render picks the form from the coordinates.
  const forms = [0, 1, 2].map((f) => palms.filter((p) => palmVariant(p) === f).length);
  assert.deepEqual(forms, [8, 7, 2], 'worldgen asked for 8 tall, 7 curved and 2 short palms (its hash must match palmVariant)');
  for (const p of palms) if (palmVariant(p) < 2) assert.ok(crown(p) >= 5.4 && crown(p) <= 6.0 + 1e-9, `crown at ${crown(p).toFixed(2)}`);
});

test('village palm placement is deterministic and draws no random numbers', () => {
  const again = generateWorld(SEED);
  assert.deepEqual(again.props.slice(FIRST, FIRST + COUNT), palms);
  assert.deepEqual(again.colliders, map.colliders);
  // Another seed keeps every rule the generator itself checks (a palm with no clear spot is dropped, never forced).
  const other = generateWorld(20261007), otherVillage = other.landmarks.village;
  const otherPalms = other.props.slice(FIRST).filter((p) => p.kind === 'palm');
  assert.ok(otherPalms.length >= 14);
  for (const p of otherPalms) {
    assert.ok(dist(p, otherVillage) >= 7.5);
    for (const q of other.props) if (q !== p && q.kind === 'palm') assert.ok(dist(p, q) >= 2.8);
  }
});

test('the near fade dissolves only a disc around the player once the cut-out radius is set', () => {
  assert.equal(U.mnCutoutR.value, 0, 'off by default: title, tools and tests keep the whole near fade');
  assert.ok(U.mnPlayerNdc.value.isVector2 && U.mnCutoutProj.value.isVector2);
  const toonMat = patchToon(new THREE.MeshToonMaterial(), { occluder: true });
  const sources = [
    [toonMat, THREE.ShaderLib.toon],
    [normalMatFor({ occluder: true }), THREE.ShaderLib.normal],
  ];
  for (const [mat, lib] of sources) {
    const sh = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    mat.onBeforeCompile(sh);
    for (const name of ['mnPlayerNdc', 'mnCutoutR', 'mnCutoutProj']) assert.strictEqual(sh.uniforms[name], U[name], `${name} is the shared uniform`);
    assert.match(sh.fragmentShader, /uniform vec2 mnPlayerNdc;\s*uniform float mnCutoutR;\s*uniform vec2 mnCutoutProj;/);
    // Today's fade unchanged when the radius is 0; the disc is aspect-corrected (x in half-heights) with a soft outer quarter.
    assert.match(sh.fragmentShader, /if \(mnCutoutR > 0\.0 && near > 0\.0\) \{/);
    assert.match(sh.fragmentShader, /mnCutoutProj \* mnVp\.xy \/ max\(-mnVp\.z, 1e-3\)/);
    assert.match(sh.fragmentShader, /\(mnNdc - mnPlayerNdc\) \* vec2\(mnCutoutProj\.y \/ mnCutoutProj\.x, 1\.0\)/);
    assert.match(sh.fragmentShader, /near \*= 1\.0 - smoothstep\(mnCutoutR \* 0\.75, mnCutoutR, length\(mnOff\)\);/);
    assert.match(sh.fragmentShader, /if \(near > 0\.0 && near \* 0\.95 > mnBayer\(gl_FragCoord\.xy\)\) discard;/);
  }
  toonMat.dispose();
});
