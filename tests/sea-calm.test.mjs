// The swell's calm mask (PT20b): 0 within `near` units of land or the dock deck, 1 beyond `far`; the same bytes on the
// CPU and the GPU. Pure, no three: a gate candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVAL_SEA } from '../src/data/navalSea.js';
import { buildCalmMask, calmByteToUnit, dockSeed } from '../src/render/naval/seaCalm.js';
import {
  sampleSeaFloor, seaCalmAt, seaDepthFade, seaSurfaceAt, seaSwellHeight, setSeaCalm, setSeaFloor,
} from '../src/render/naval/seaSwell.js';

const { near, far, seaLevel } = NAVAL_SEA.calm;
const smooth = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// A 128 x 128 grid over [-64, 64]^2 (one unit a texel, centres at .5): land (+2) where x < 0, deep water (-10) east of it.
const RES = 128, HALF = 64;
function coastGrid() {
  const h = new Float32Array(RES * RES);
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) h[j * RES + i] = i < RES / 2 ? 2 : -10;
  return h;
}
const at = (mask, x, z) => sampleSeaFloor(mask, RES, HALF, x, z, calmByteToUnit, 1);

test('the knobs: calm within 15 units of land, full swell beyond 40, the sea level at 0', () => {
  assert.deepEqual(NAVAL_SEA.calm, { near: 15, far: 40, seaLevel: 0 });
});

test('a straight coast: 0 on land and within near, the smoothstep of the distance between, 1 beyond far', () => {
  const mask = buildCalmMask(coastGrid(), RES, HALF);
  assert.equal(mask.length, RES * RES);
  for (const x of [-60, -30, -0.5, 0.5, 5, 10, 14]) for (const z of [-50, 0, 33]) assert.equal(at(mask, x, z), 0, `(${x}, ${z})`);
  for (const x of [40.5, 45, 63]) for (const z of [-50, 0, 33]) assert.equal(at(mask, x, z), 1, `(${x}, ${z})`);
  // The last land texel centre sits at x = -0.5, so a water texel at x has distance x + 0.5.
  for (const x of [17.5, 22.5, 27.5, 32.5, 37.5]) {
    const want = smooth(near, far, x + 0.5), got = at(mask, x, 7);
    assert.ok(Math.abs(got - want) < 1 / 255 + 1e-9, `${x}: ${got} vs ${want}`);
  }
  let last = -1;
  for (let x = 0.5; x < 63; x += 1) { const v = at(mask, x, -20); assert.ok(v >= last, `monotone at ${x}`); last = v; }
});

test('the dock deck is a seed: calm around it, and only when its deck stands over the sea level', () => {
  const dock = { base: { x: 30, z: 0 }, dir: { x: 1, z: 0 }, len: 10, halfWidth: 1.7, deckY: 1.05 };
  const seed = dockSeed(dock);
  assert.ok(seed(35, 0) && seed(29, 1.5) && seed(39.9, -1.6), 'inside: 1.5 before the base to the end, halfWidth each side');
  assert.ok(!seed(28.4, 0) && !seed(40.1, 0) && !seed(35, 1.8), 'outside');
  assert.equal(dockSeed({ ...dock, deckY: 0 }), null);
  assert.equal(dockSeed(null), null);
  const plain = buildCalmMask(coastGrid(), RES, HALF), withDock = buildCalmMask(coastGrid(), RES, HALF, { seedAt: seed });
  assert.equal(at(withDock, 35, 0), 0, 'on the deck');
  assert.equal(at(withDock, 45, 0), 0, 'five units past the end');
  assert.equal(at(withDock, 35, 12), 0, 'twelve units abeam');
  assert.ok(at(plain, 45, 0) > 0.3 && at(plain, 35, 12) > 0.3, 'the same points swell without the dock');
  // Far abeam the dock still shortens the distance: 35 units from the coast, about 24 from the deck.
  const abeam = at(withDock, 35, 26);
  assert.ok(abeam > 0 && abeam < at(plain, 35, 26), `abeam ${abeam} vs ${at(plain, 35, 26)}`);
  assert.equal(at(withDock, 62, 60), 1, 'the open corner is untouched');
});

test('decode, the sea level and a grid without land', () => {
  const half = new Uint16Array(RES * RES).fill(1); // every "1" decodes to -10: no land anywhere
  assert.ok(buildCalmMask(half, RES, HALF, { decode: () => -10 }).every((v) => v === 255));
  const shallow = new Float32Array(RES * RES).fill(-0.2); // under the sea level: water, so no seeds
  assert.ok(buildCalmMask(shallow, RES, HALF).every((v) => v === 255));
  assert.ok(buildCalmMask(shallow, RES, HALF, { seaLevel: -0.5 }).every((v) => v === 0), 'a lower sea level makes it land');
  assert.throws(() => buildCalmMask(new Float32Array(10), 4, 2), RangeError);
  assert.equal(at(buildCalmMask(coastGrid(), RES, HALF), 200, 0), 1, 'off the grid is open sea');
  assert.equal(sampleSeaFloor([0, 0, 0, 0], 2, 10, 50, 0), NAVAL_SEA.floorOutside, 'the seabed keeps its own outside value');
});

test('seaSurfaceAt multiplies the swell by the calm factor; no sampler means full swell', () => {
  setSeaFloor(() => -20);
  let c = 0.5;
  setSeaCalm((x, z) => c);
  assert.equal(seaCalmAt(3, 4), 0.5);
  assert.ok(Math.abs(seaSurfaceAt(37.5, -12.25, 9) - 0.5 * seaSwellHeight(37.5, -12.25, 9) * seaDepthFade(20)) < 1e-12);
  c = 0; assert.equal(seaSurfaceAt(37.5, -12.25, 9), 0);
  c = 7; assert.equal(seaCalmAt(0, 0), 1, 'clamped');
  c = NaN; assert.equal(seaCalmAt(0, 0), 1, 'a bad reading is full swell');
  setSeaCalm(null);
  assert.equal(seaCalmAt(0, 0), 1);
  assert.ok(Math.abs(seaSurfaceAt(37.5, -12.25, 9) - seaSwellHeight(37.5, -12.25, 9) * seaDepthFade(20)) < 1e-12);
  setSeaFloor(null);
});
