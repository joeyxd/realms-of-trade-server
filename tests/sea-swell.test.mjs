import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NAVAL_SEA } from '../src/data/navalSea.js';
import { WW_UNIT } from '../src/data/navalHandling.js';
import {
  SEA_AMP, SEA_CELL, SEA_SWELL_GLSL, sampleSeaFloor, seaCalmAt, seaDepthFade, seaEdgeFade, seaPatchOrigin, seaSurfaceY,
  seaSwellHeight, seaSwellSlope, setSeaCalm, setSeaClock, setSeaFloor,
} from '../src/render/naval/seaSwell.js';
import { createWater } from '../src/render/water.js';
import { createHeightTexture } from '../src/render/terrain.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { U } from '../src/render/toon.js';
import { LAYER } from '../src/render/pipeline.js';

const POINTS = [[0, 0], [37.5, -12.25], [-140, 96], [260, 255], [-900, 3.3], [12.75, 1100]];

// Wind Waker's SEA wave, written from the research notes in WW units and integer WW frames (01 section 5).
function wwReference(X, Z, frame, waveMax) {
  const table = [[7.353e-5, 0, 0.98, 0.2, 200], [8.929e-5, 4000, 0.2, 0.98, 190], [1.136e-4, 8000, -0.98, 0.2, 210], [1.5625e-4, 12000, 0.2, -0.98, 180]];
  let h = 0;
  for (const [km, phase, vx, vz, period] of table) {
    const ratio = (frame % period) / period;
    h += 2.5 * waveMax * Math.cos(km * 6.28 * (vx * X + vz * Z) - 0x10000 * (ratio - 0.5) * (Math.PI * 2 / 0x10000) + phase * (Math.PI * 2 / 0x10000));
  }
  return h;
}

test('the swell is WW\'s four cosines at the open-sea waveMax 30, scaled to our units', () => {
  assert.equal(NAVAL_SEA.waveMax, 30);
  assert.ok(Math.abs(SEA_AMP / WW_UNIT - 75) < 1e-9, 'component amplitude 2.5 x 30 WW units');
  assert.ok(Math.abs(SEA_AMP - 0.956) < 0.001);
  assert.deepEqual(NAVAL_SEA.waves.map((w) => [w.phase, w.vx, w.vz, w.period]),
    [[0, 0.98, 0.2, 200], [4000, 0.2, 0.98, 190], [8000, -0.98, 0.2, 210], [12000, 0.2, -0.98, 180]]);
  for (const frame of [0, 1, 17, 95, 199, 200, 3990, 123457]) for (const [x, z] of POINTS) {
    const ours = seaSwellHeight(x, z, frame / 30), ww = wwReference(x / WW_UNIT, z / WW_UNIT, frame, 30) * WW_UNIT;
    // The research rounds Km to 4 digits; 2e-3 relative on k is under 0.1 rad at our farthest point.
    assert.ok(Math.abs(ours - ww) < 0.08, `frame ${frame} (${x}, ${z}): ${ours} vs ${ww}`);
  }
  // Exact against the table we ship (the same formula on NAVAL_SEA itself).
  const exact = (x, z, frame) => NAVAL_SEA.waves.reduce((h, w) => h + 2.5 * 30 * Math.cos(w.km * 6.28 * (w.vx * x / WW_UNIT + w.vz * z / WW_UNIT)
    - 2 * Math.PI * ((frame % w.period) / w.period - 0.5) + w.phase * 2 * Math.PI / 65536), 0) * WW_UNIT;
  for (const frame of [0, 7, 180, 211, 5000]) for (const [x, z] of POINTS) assert.ok(Math.abs(seaSwellHeight(x, z, frame / 30) - exact(x, z, frame)) < 1e-9);
});

test('the slope matches a finite difference of the height', () => {
  const out = { x: 0, z: 0 }, e = 1e-4;
  for (const t of [0, 3.3, 41.7]) for (const [x, z] of POINTS) {
    seaSwellSlope(x, z, t, out);
    const dx = (seaSwellHeight(x + e, z, t) - seaSwellHeight(x - e, z, t)) / (2 * e);
    const dz = (seaSwellHeight(x, z + e, t) - seaSwellHeight(x, z - e, t)) / (2 * e);
    assert.ok(Math.abs(out.x - dx) < 1e-6 && Math.abs(out.z - dz) < 1e-6, `${out.x} ${dx} / ${out.z} ${dz}`);
  }
});

// A JS transcription of the GLSL the water shaders compile, from its own constants.
function glslSea(src) {
  const vec = (name) => src.match(new RegExp(`const vec4 ${name} = vec4\\(([^)]*)\\);`))[1].split(',').map(Number);
  const num = (name) => Number(src.match(new RegExp(`const float ${name} = ([^;]*);`))[1]);
  assert.match(src, /vec4 th = MN_SEA_KX \* p\.x \+ MN_SEA_KZ \* p\.y - 6\.283185307 \* fract\(t \* MN_SEA_W\) \+ MN_SEA_PH;/);
  assert.match(src, /return MN_SEA_AMP \* vec3\(dot\(cos\(th\), vec4\(1\.0\)\), -dot\(s, MN_SEA_KX\), -dot\(s, MN_SEA_KZ\)\);/);
  assert.match(src, /vec2 e = clamp\(min\(idx, MN_SEA_CELLS - idx\) \/ ([\d.]+), 0\.0, 1\.0\);\s*return e\.x \* e\.y;/);
  const KX = vec('MN_SEA_KX'), KZ = vec('MN_SEA_KZ'), W = vec('MN_SEA_W'), PH = vec('MN_SEA_PH'), A = num('MN_SEA_AMP');
  const [, d0, d1] = src.match(/smoothstep\(([\d.]+), ([\d.]+), depth\)/).map(Number);
  const cells = num('MN_SEA_CELLS'), edge = Number(src.match(/MN_SEA_CELLS - idx\) \/ ([\d.]+)/)[1]);
  const fract = (v) => v - Math.floor(v), smooth = (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };
  return {
    swell(x, z, t) {
      let h = 0, sx = 0, sz = 0;
      for (let i = 0; i < 4; i++) {
        const th = KX[i] * x + KZ[i] * z - 6.283185307 * fract(t * W[i]) + PH[i];
        h += Math.cos(th); sx -= Math.sin(th) * KX[i]; sz -= Math.sin(th) * KZ[i];
      }
      return [A * h, A * sx, A * sz];
    },
    depthFade: (d) => smooth(d0, d1, d),
    edgeFade: (ix, iz) => Math.min(Math.max(Math.min(ix, cells - ix) / edge, 0), 1) * Math.min(Math.max(Math.min(iz, cells - iz) / edge, 0), 1),
    cell: num('MN_SEA_CELL'),
  };
}

test('the GLSL swell, depth fade and edge fade agree with the JS ones', () => {
  const g = glslSea(SEA_SWELL_GLSL), out = { x: 0, z: 0 };
  assert.ok(Math.abs(g.cell - SEA_CELL) < 1e-6);
  for (const t of [0, 0.5, 6.66, 123.4]) for (const [x, z] of POINTS) {
    const [h, sx, sz] = g.swell(x, z, t);
    seaSwellSlope(x, z, t, out);
    assert.ok(Math.abs(h - seaSwellHeight(x, z, t)) < 1e-6, `height ${h}`);
    assert.ok(Math.abs(sx - out.x) < 1e-7 && Math.abs(sz - out.z) < 1e-7, 'slope');
  }
  for (let d = -3; d <= 12; d += 0.25) assert.ok(Math.abs(g.depthFade(d) - seaDepthFade(d)) < 1e-12);
  for (let i = 0; i <= NAVAL_SEA.cells; i++) assert.ok(Math.abs(g.edgeFade(i, 30) - seaEdgeFade(i)) < 1e-12);
});

test('depth fade: 0 at depth <= D0, 1 at depth >= D1, rising between', () => {
  const { d0, d1 } = NAVAL_SEA.depthFade;
  for (const d of [-20, -1, 0, 1, d0]) assert.equal(seaDepthFade(d), 0);
  for (const d of [d1, d1 + 0.5, 20]) assert.equal(seaDepthFade(d), 1);
  let last = 0;
  for (let k = 1; k < 60; k++) { const f = seaDepthFade(d0 + (d1 - d0) * k / 60); assert.ok(f > last && f < 1, `step ${k}`); last = f; }
});

test('patch edge fade: 0, 1/6 .. 5/6 over the outer 6 cells, 1 inside, and the patch snaps around the camera', () => {
  const n = NAVAL_SEA.cells;
  assert.equal(n, 65); assert.equal(NAVAL_SEA.cell, 800); assert.equal(NAVAL_SEA.edgeCells, 6);
  for (let i = 0; i <= 6; i++) {
    assert.ok(Math.abs(seaEdgeFade(i) - i / 6) < 1e-12, `ring ${i}`);
    assert.ok(Math.abs(seaEdgeFade(n - i) - i / 6) < 1e-12, `ring ${n - i}`);
  }
  for (let i = 6; i <= n - 6; i++) assert.equal(seaEdgeFade(i), 1);
  const o = seaPatchOrigin(3.2, -27.9);
  assert.ok(Math.abs(o.x / SEA_CELL - Math.round(o.x / SEA_CELL)) < 1e-9, 'whole cells');
  assert.ok(3.2 - o.x > 32 * SEA_CELL && o.x + n * SEA_CELL - 3.2 > 32 * SEA_CELL, 'the camera cell in the middle');
  assert.ok(-27.9 - o.y > 32 * SEA_CELL && o.y + n * SEA_CELL + 27.9 > 32 * SEA_CELL);
  assert.deepEqual(seaPatchOrigin(3.2 + SEA_CELL * 0.4, -27.9), o, 'stays put inside a cell');
});

test('seaSurfaceY: the swell times the depth fade at the shared clock; the seabed is read like the shader reads it', () => {
  let t = 12.5, bed = -20;
  setSeaClock(() => t);
  setSeaFloor(() => bed);
  assert.equal(seaSurfaceY(40, 9), seaSwellHeight(40, 9, 12.5));
  t = 13;
  assert.equal(seaSurfaceY(40, 9), seaSwellHeight(40, 9, 13));
  bed = -1.5; // shallow: calm
  assert.equal(Math.abs(seaSurfaceY(40, 9)), 0);
  bed = -5;
  assert.ok(Math.abs(seaSurfaceY(40, 9) - seaSwellHeight(40, 9, 13) * seaDepthFade(5)) < 1e-12);
  // 2 x 2 texels over [-10, 10]: centres at -5 and 5, clamp to edge, -20 off the texture.
  const data = [0, 4, 8, 12];
  assert.equal(sampleSeaFloor(data, 2, 10, -5, -5), 0);
  assert.equal(sampleSeaFloor(data, 2, 10, 0, -5), 2);
  assert.equal(sampleSeaFloor(data, 2, 10, 0, 0), 6);
  assert.equal(sampleSeaFloor(data, 2, 10, 9, 9), 12);
  assert.equal(sampleSeaFloor(data, 2, 10, 10.5, 0), NAVAL_SEA.floorOutside);
});

test('createWater: a swell patch child on the water layer, both modes switch, uniforms shared, clock and seabed registered', () => {
  const height = new THREE.DataTexture(new Float32Array([-6, -6, -1, -1]), 2, 2, THREE.RedFormat, THREE.FloatType);
  const water = createWater({ size: 20 }, height);
  const swell = water.userData.swell;
  assert.ok(swell && water.children.includes(swell));
  assert.ok(swell.layers.isEnabled(LAYER.WATER) && !swell.layers.isEnabled(0));
  assert.equal(swell.geometry.attributes.position.count, 66 * 66);
  assert.equal(swell.geometry.index.count, 65 * 65 * 6);
  water.userData.setMode(false);
  const simple = [water.material, swell.material];
  water.userData.setMode(true);
  assert.notEqual(water.material, simple[0]); assert.notEqual(swell.material, simple[1]);
  assert.equal(swell.material.defines.MN_SEA_PATCH, ''); assert.equal(water.material.defines.MN_SEA_OUTER, '');
  for (const k of ['uWaves', 'uRefract', 'uHeight', 'uWorldHalf', 'uSeaOrigin', 'mnTime']) {
    assert.equal(swell.material.uniforms[k], water.material.uniforms[k], k);
    assert.equal(simple[1].uniforms[k], water.material.uniforms[k], k);
  }
  assert.match(swell.material.vertexShader, /mnSeaSwell\(xz, mnTime\) \* \(mnSeaEdgeFade\(position\.xz\) \* mnSeaDepthFade\(-th\) \* calm\)/);
  // The camera moves the shared patch corner before either mesh draws.
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(100, 30, -50); cam.updateMatrixWorld();
  swell.onBeforeRender(null, null, cam);
  assert.deepEqual({ x: water.material.uniforms.uSeaOrigin.value.x, y: water.material.uniforms.uSeaOrigin.value.y }, seaPatchOrigin(100, -50));
  // seaSurfaceY now reads the shader clock and this water's seabed (deep row z < 0, shallow row z > 0).
  U.mnTime.value = 7.25;
  assert.equal(seaSurfaceY(-5, -5), seaSwellHeight(-5, -5, 7.25) * seaDepthFade(6));
  assert.equal(Math.abs(seaSurfaceY(-5, 5)), 0);
  height.dispose(); water.geometry.dispose(); swell.geometry.dispose();
  for (const m of [...simple, water.material, swell.material]) m.dispose();
});

test('the real island: calm at the dock and beside it, full swell again within 120 units offshore, inside the map', () => {
  const map = generateWorld(99282957);
  const water = createWater(map, createHeightTexture(map, 256)), calm = water.userData.calm;
  assert.ok(calm.data && calm.res === 256 && calm.tex.image.width === 256);
  const d = map.dock, end = d.end;
  assert.equal(seaCalmAt(end.x, end.z), 0, 'dock end');
  assert.equal(seaCalmAt(d.base.x, d.base.z), 0, 'dock base');
  assert.equal(seaCalmAt(end.x - d.dir.z * 3, end.z + d.dir.x * 3), 0, 'three units abeam of the dock end');
  assert.equal(seaCalmAt(end.x + d.dir.x * 8, end.z + d.dir.z * 8), 0, 'eight units past the dock end');
  let reach = null;
  for (let s = 0; s <= 200; s += 1) {
    const x = end.x + d.dir.x * s, z = end.z + d.dir.z * s;
    if (Math.abs(x) > map.half || Math.abs(z) > map.half) break;
    if (seaCalmAt(x, z) >= 1) { reach = s; break; }
  }
  assert.ok(reach !== null && reach >= 40 && reach <= 120, `full swell ${reach} units past the dock end`);
  // The GPU reads the same bytes: every material binds the mask texture.
  for (const m of [water.material, water.userData.materials.simple, water.userData.swell.material]) assert.equal(m.uniforms.uCalm.value, calm.tex);
  assert.equal(calm.tex.format, THREE.RedFormat); assert.equal(calm.tex.type, THREE.UnsignedByteType);
});

test('the calm mask rebakes when the height texture changes, throttled by the shader clock', () => {
  const height = new THREE.DataTexture(new Float32Array(16 * 16).fill(-10), 16, 16, THREE.RedFormat, THREE.FloatType);
  const water = createWater({ size: 32 }, height), calm = water.userData.calm;
  assert.ok(calm.data.every((v) => v === 255), 'deep water everywhere: full swell');
  assert.equal(seaCalmAt(0, 0), 1);
  assert.equal(calm.refresh(0.1), false, 'same texture version: nothing to do');
  height.image.data.fill(5, 0, 16); // the first row (z = -15) becomes land
  height.needsUpdate = true;
  assert.equal(calm.refresh(0.1), false, 'throttled: half a second between bakes');
  assert.equal(calm.refresh(0.6), true);
  assert.equal(seaCalmAt(0, -15.9), 0, 'next to the new land');
  assert.ok(seaCalmAt(0, 15) > 0.5 && seaCalmAt(0, 15) < 1, 'thirty units away: on the ramp');
  assert.equal(calm.refresh(1.2), false);
  setSeaCalm(null);
});
