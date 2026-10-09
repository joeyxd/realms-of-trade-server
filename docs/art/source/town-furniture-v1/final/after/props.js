// Village, dock, ship and Caldera dressing: one merged vertex-colored geometry per prop kind,
// instanced per kind. Glowing bits (lantern glass, coals, hut windows at night) use unlit materials.
import * as THREE from 'three';
import { assets } from './assets/registry.js';
import { part, merge, box, rbox, bbox, sphere, cyl, cone, torus, ico, lumpy, canvasTexture } from './geo.js';
import { toon, normalMatFor, glowBasic } from './toon.js';
import { LAYER } from './pipeline.js';
import { INK_GLSL } from './inkGlsl.js';
import { RAFT_ATLAS_ID } from './raftMaterials.js';
import { dockWoodPart, dockWoodMaterial } from './dockWood.js';
import { createDockRopes } from './dockRopes.js';
import { portCargoGeometry, paintPortCargoInstances } from './portCargo.js';
import { townLanternGeometry, townSignPostGeometry, townSignGeometry, townSignInk, townSignMaterial } from './townFixtures.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, townPart, townNeutral, townMaterial } from './townMaterials.js';
import { townCoverPart, townCoverNeutral, townCoverMaterial } from './townCovers.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
// Ink pass (P5): classify the vertex colour (hue / saturation / value in ~sRGB) and paint wood grain on browns and
// brick bond on greys / violet basalt. Saturated colours (cloth, paint, metal trims) are left alone. Model-space position
// and normal, so patterns stay glued to props that bob (ship, floaters) and follow the dock deck's own axes; chunk
// meshes are baked in world space, so there it is world space. Grain: cell edges of the noise, stretched along the grain.
const PROP_INK = {
  vertPars: 'varying vec3 vMnObj;\nvarying vec3 vMnON;\n',
  vertBody: 'vMnObj = position;\nvMnON = objectNormal;\n',
  fragPars: INK_GLSL + 'varying vec3 vMnObj;\nvarying vec3 vMnON;\n',
  albedo: /* glsl */ `
    {
      float fade = mnDetailFade();
      if (fade > 0.01) {
        vec3 c = diffuseColor.rgb;
        vec3 hsv = mnHsv(sqrt(c));
        float hue = hsv.x * 360.0;
        // Wood: brown hues, mid saturation and value. Stone: neutral greys, or the violet Caldera basalt.
        float woodW = smoothstep(12.0, 18.0, hue) * (1.0 - smoothstep(35.0, 38.0, hue)) * smoothstep(0.28, 0.36, hsv.y) * (1.0 - smoothstep(0.9, 0.95, hsv.y)) * smoothstep(0.18, 0.26, hsv.z) * (1.0 - smoothstep(0.82, 0.88, hsv.z));
        float stoneW = (1.0 - smoothstep(0.1, 0.13, hsv.y)) * smoothstep(0.26, 0.32, hsv.z) * (1.0 - smoothstep(0.85, 0.9, hsv.z))
          + smoothstep(250.0, 262.0, hue) * (1.0 - smoothstep(330.0, 340.0, hue)) * smoothstep(0.1, 0.14, hsv.y) * (1.0 - smoothstep(0.3, 0.34, hsv.y)) * smoothstep(0.2, 0.24, hsv.z) * (1.0 - smoothstep(0.6, 0.65, hsv.z));
        vec3 N = normalize(vMnON);
        vec2 tp = mnTri(vMnObj, N);
        // Grain runs up the walls and along x on floors (the dock planks run across the deck).
        vec2 gu = mnIsFloor(N) > 0.5 ? tp.yx : tp;
        vec2 sk = vec2(0.8, 0.12);
        vec2 gdx = dFdx(gu) * sk, gdy = dFdy(gu) * sk;
        vec4 g = vec4(0.0, 9.0, 0.0, 0.0);
        if (woodW > 0.01) g = textureGrad(mnNoiseTex, gu * sk, gdx, gdy);
        float grain = mnLine(g.g * 0.3 / (8.0 * sk.x), 0.02);
        float knot = mnLine(g.r, 0.3) * step(0.93, g.a);
        c *= mix(1.0, (1.0 + (g.a - 0.5) * 0.14) * (1.0 - 0.2 * grain) * (1.0 - 0.3 * knot), woodW);
        // Running-bond blocks 0.55 x 0.3 u: ink joints, a little value jitter per block.
        vec2 bs = vec2(0.55, 0.3);
        float joint = mnLine(mnBricks(tp, bs), 0.02);
        c *= mix(1.0, 0.9 + 0.2 * mnBrickId(tp, bs), stoneW);
        c = mix(c, MN_INK, 0.6 * joint * stoneW);
        diffuseColor.rgb = mix(diffuseColor.rgb, c, fade);
      }
    }
  `,
};

const WOOD = 0xb5803f, WOOD_D = 0x8a5a2e, WOOD_L = 0xd6a565, STRAW = 0xe9b54d, STRAW_D = 0xc98f2c, STONE = 0x9a948e;

function hutGeo(mapped = false) {
  const P = (geo, color, transform, role = null, options = {}) => townPart(geo, color, transform, { mapped, role, ...options });
  const wallPaint = (x, y, z) => (Math.floor((y + 10) * 4.2) % 2 ? 0xe8c98a : 0xd9b26d);
  const L = [];
  for (const [x, z] of [[1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7]]) L.push(P(cyl(0.16, 0.2, 1.1, 8), WOOD_D, { pos: [x, 0.55, z] }, 'corner'));
  L.push(P(rbox(4.3, 0.26, 4.3, 0.08), WOOD, { pos: [0, 1.15, 0] }, 'floor'));
  L.push(P(rbox(3.5, 2.0, 3.5, 0.12), 0, { pos: [0, 2.25, 0], paint: wallPaint }, 'planks'));
  L.push(P(rbox(0.95, 1.45, 0.12, 0.05), 0x3b2418, { pos: [0, 2.0, 1.76] }, 'door', { crop: [.225, .04, .775, .94] }));
  L.push(P(rbox(0.7, 0.55, 0.12, 0.05), 0x3b2418, { pos: [1.15, 2.45, 1.76] }, 'window', { crop: [.22, .20, .78, .84] }));
  L.push(P(rbox(0.12, 0.55, 0.7, 0.05), 0x3b2418, { pos: [1.76, 2.45, 0] }, 'window', { crop: [.22, .20, .78, .84] }));
  // layered thatch roof
  // Stepped thatch: stacked square frustums with alternating straw tones.
  const bands = 5, base = 3.2, top = 5.35, r0 = 3.6;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands, t1 = (i + 1) / bands;
    const y0 = base + (top - base) * t0, y1 = base + (top - base) * t1;
    const rb = r0 * (1 - t0) + 0.05, rt = r0 * (1 - t1) + (i === bands - 1 ? 0.02 : 0.32);
    L.push(townCoverPart(new THREE.CylinderGeometry(rt, rb, y1 - y0, 4, 1), i % 2 ? 0xe9b54d : 0xd09a35,
      { pos: [0, (y0 + y1) / 2, 0], rot: [0, Math.PI / 4, 0] }, 'thatch', { mapped }));
  }
  L.push(P(sphere(0.24, 8, 6), WOOD_D, { pos: [0, 5.45, 0] }));
  // steps
  for (let i = 0; i < 3; i++) L.push(P(bbox(1.1, 0.12, 0.4), WOOD_L, { pos: [0, 0.25 + i * 0.32, 2.75 - i * 0.35] }, 'beam', { longU: true }));
  return merge(L.map(townCoverNeutral));
}

function crateGeo() {
  const paint = (x, y, z) => (Math.abs(x) > 0.42 || Math.abs(y - 0.5) > 0.42 || Math.abs(z) > 0.42 ? WOOD_D : WOOD);
  return merge([part(rbox(1, 1, 1, 0.06), 0, { pos: [0, 0.5, 0], paint }), part(rbox(0.15, 1.02, 1.02, 0.02), WOOD_D, { pos: [0, 0.5, 0], rot: [0, 0, 0.78] })]);
}

function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.38 + Math.sin(t * Math.PI) * 0.08, t * 1.0)); }
  const body = new THREE.LatheGeometry(pts, 14);
  const paint = (x, y) => (Math.abs(y - 0.18) < 0.05 || Math.abs(y - 0.82) < 0.05 ? 0x5a5a6a : Math.floor(Math.atan2(x, 1) * 0) ? WOOD : WOOD);
  return merge([part(body, 0, { paint }), part(cyl(0.38, 0.38, 0.04, 14), WOOD_D, { pos: [0, 0.99, 0] })]);
}

function stallGeo(mapped = false) {
  const P = (geo, color, transform, role = null, options = {}) => townPart(geo, color, transform, { mapped, role, ...options });
  const canopy = (x) => (Math.floor((x + 5) * 2.5) % 2 ? 0xe8463c : 0xfaf3e3);
  const L = [P(rbox(2.6, 0.12, 1.3, 0.04), WOOD, { pos: [0, 0.95, 0] }, 'floor'), P(rbox(2.4, 0.8, 1.1, 0.04), WOOD_D, { pos: [0, 0.5, 0] }, 'patched')];
  for (const [x, z] of [[1.25, 0.6], [-1.25, 0.6], [1.25, -0.6], [-1.25, -0.6]]) L.push(P(cyl(0.06, 0.06, 2.4, 6), WOOD_D, { pos: [x, 1.2, z] }, 'iron'));
  L.push(townCoverPart(rbox(3.0, 0.12, 1.8, 0.04), 0,
    { pos: [0, 2.45, 0], rot: [0.18, 0, 0], paint: canopy }, 'cloth', { mapped }));
  const fruit = [0xff9f1c, 0xffd166, 0x7bc74d, 0xe8463c, 0xff9f1c];
  for (let i = 0; i < 9; i++) L.push(P(sphere(0.13, 8, 6), fruit[i % fruit.length], { pos: [-0.9 + (i % 5) * 0.42, 1.12, -0.25 + Math.floor(i / 5) * 0.4] }));
  return merge(L.map(townCoverNeutral));
}

// Weapon rack (M3.5): a little roofed wooden stand with a cutlass hanging on pegs and a brace of
// flintlocks on the shelf. Front is +z (the side you walk up to).
function rackGeo() {
  const BRASS = 0xc9a44c, IRON = 0x3a3532, STEEL = 0xdfe6ea, RED = 0xb8352c;
  const L = [];
  for (const x of [-0.62, 0.62]) {
    L.push(part(cyl(0.07, 0.085, 1.75, 6), WOOD_D, { pos: [x, 0.875, 0] }));
    L.push(part(rbox(0.36, 0.08, 0.5, 0.02), WOOD_D, { pos: [x, 0.04, 0] }));
  }
  L.push(part(rbox(1.5, 0.09, 0.14, 0.02), WOOD, { pos: [0, 1.66, -0.04] }));
  for (const x of [-0.62, 0.62]) L.push(part(cone(0.1, 0.18, 6), WOOD_D, { pos: [x, 1.84, 0] }));
  L.push(part(rbox(1.3, 0.06, 0.34, 0.02), WOOD, { pos: [0, 0.78, 0.08] })); // shelf
  L.push(part(rbox(1.3, 0.14, 0.04, 0.01), WOOD_D, { pos: [0, 0.86, 0.26] })); // shelf lip
  L.push(part(rbox(1.26, 0.5, 0.04, 0.01), 0x7a4a26, { pos: [0, 1.3, -0.05] })); // back board
  for (const x of [-0.2, 0.2]) L.push(part(cyl(0.025, 0.025, 0.14, 5), WOOD_D, { pos: [x, 1.5, 0.03], rot: [Math.PI / 2, 0, 0] }));
  // the cutlass across the pegs (blade to the right, hilt left)
  L.push(part(bbox(0.78, 0.07, 0.015), STEEL, { pos: [0.12, 1.53, 0.1], rot: [0, 0, -0.05] }));
  L.push(part(bbox(0.05, 0.14, 0.04), IRON, { pos: [-0.3, 1.53, 0.1] }));
  L.push(part(cyl(0.022, 0.022, 0.14, 6), 0x3a2418, { pos: [-0.4, 1.53, 0.1], rot: [0, 0, Math.PI / 2] }));
  L.push(part(sphere(0.03, 6, 4), BRASS, { pos: [-0.48, 1.53, 0.1] }));
  // two flintlocks on the shelf, barrels crossed
  for (const [x, a] of [[-0.22, 0.35], [0.24, -0.4]]) {
    L.push(part(cyl(0.022, 0.022, 0.34, 6), BRASS, { pos: [x, 0.84, 0.1], rot: [Math.PI / 2, 0, a] }));
    L.push(part(rbox(0.06, 0.05, 0.16, 0.015), WOOD_D, { pos: [x - Math.sin(a) * 0.2, 0.84, 0.1 - Math.cos(a) * 0.2], rot: [0, a, 0] }));
  }
  // a red pennant on the left post
  L.push(part(bbox(0.02, 0.24, 0.3), RED, { pos: [-0.64, 1.45, 0.2] }));
  return merge(L);
}

// Doña Sepia's stall (M4.7): a slanted indigo-striped awning on four posts, a bar at the back for the hides she
// shows her designs on (a textured mesh of their own: tattooHidesMesh), a low table with ink pots, a needle box and a
// candle, a stool. Front is +z (the side she stands on). About 2.4 × 1.4 u.
function tattooStallGeo(mapped = false) {
  const P = (geo, color, transform, role = null, options = {}) => townPart(geo, color, transform, { mapped, role, ...options });
  const INDIGO = 0x3a2a5a, CREAM = 0xd8cbb0, INK = 0x1e2238, BRASS = 0xc9a44c;
  const awning = (x) => (Math.floor((x + 5) * 2.2) % 2 ? INDIGO : CREAM);
  const L = [];
  for (const [x, z, h] of [[1.1, 0.55, 2.0], [-1.1, 0.55, 2.0], [1.1, -0.6, 2.35], [-1.1, -0.6, 2.35]]) L.push(P(cyl(0.055, 0.065, h, 6), WOOD_D, { pos: [x, h / 2, z] }, 'timber'));
  L.push(part(rbox(2.6, 0.1, 1.55, 0.03), 0, { pos: [0, 2.22, -0.02], rot: [-0.24, 0, 0], paint: awning }));
  for (const x of [-1.25, -0.42, 0.42, 1.25]) L.push(part(cone(0.09, 0.2, 4), INDIGO, { pos: [x, 1.98, 0.74], rot: [Math.PI, 0, 0] })); // the awning's scalloped edge
  L.push(P(cyl(0.035, 0.035, 2.3, 6), WOOD, { pos: [0, 2.05, -0.6], rot: [0, 0, Math.PI / 2] }, 'timber')); // the hide bar
  // The table: top, legs, a cloth runner; ink pots (black, indigo, red), a needle box, a candle.
  L.push(P(rbox(1.3, 0.07, 0.62, 0.02), WOOD, { pos: [0.35, 0.78, 0.05] }, 'floor', { longU: true }));
  for (const [x, z] of [[0.95, 0.3], [-0.25, 0.3], [0.95, -0.2], [-0.25, -0.2]]) L.push(P(cyl(0.035, 0.035, 0.76, 5), WOOD_D, { pos: [x, 0.38, z] }, 'timber'));
  L.push(part(rbox(0.5, 0.01, 0.66, 0.005), 0x6e3a5a, { pos: [0.35, 0.82, 0.05] }));
  for (const [x, z, c, r] of [[0.0, 0.18, INK, 0.07], [0.18, 0.2, 0x2a3a8a, 0.06], [0.33, 0.16, 0x8a1e22, 0.055], [0.12, -0.05, INK, 0.05]]) {
    L.push(part(cyl(r, r * 1.1, 0.12, 8), c, { pos: [x, 0.88, z] }));
    L.push(part(cyl(r * 0.6, r * 0.6, 0.03, 8), 0x0e0c14, { pos: [x, 0.95, z] }));
  }
  L.push(P(rbox(0.3, 0.07, 0.16, 0.01), 0x5a3418, { pos: [0.72, 0.86, 0.12] }, 'planks', { crop: [.15, .2, .65, .7] }));
  for (let i = 0; i < 4; i++) L.push(part(cyl(0.006, 0.006, 0.18, 4), 0xdfe6ea, { pos: [0.64 + i * 0.05, 0.92, 0.12], rot: [0, 0, Math.PI / 2] }));
  L.push(part(cyl(0.035, 0.04, 0.14, 6), 0xf2e6c8, { pos: [0.95, 0.89, -0.08] }));
  L.push(part(cyl(0.06, 0.06, 0.02, 8), BRASS, { pos: [0.95, 0.82, -0.08] }));
  // The stool.
  L.push(P(cyl(0.2, 0.2, 0.06, 8), WOOD, { pos: [-0.75, 0.5, 0.25] }, 'floor'));
  for (const a of [0, 2.1, 4.2]) L.push(P(cyl(0.025, 0.03, 0.5, 5), WOOD_D, { pos: [-0.75 + Math.cos(a) * 0.13, 0.25, 0.25 + Math.sin(a) * 0.13] }, 'timber'));
  return merge(mapped ? L.map(townNeutral) : L);
}

// The hides on the bar: three stretched skins painted with an anchor, a skull and waves (one canvas, one mesh).
function tattooHidesTexture() {
  return canvasTexture(512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const w = s / 3;
    for (let i = 0; i < 3; i++) {
      const x0 = i * w, cx = x0 + w / 2;
      // A skin: an irregular parchment shape with stitched corners.
      ctx.fillStyle = ['#d9c09a', '#cfb28a', '#dcc6a2'][i];
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.14, s * 0.06); ctx.quadraticCurveTo(cx, s * 0.0, x0 + w * 0.86, s * 0.06);
      ctx.quadraticCurveTo(x0 + w * 0.98, s * 0.5, x0 + w * 0.84, s * 0.94); ctx.quadraticCurveTo(cx, s * 1.0, x0 + w * 0.16, s * 0.94);
      ctx.quadraticCurveTo(x0 + w * 0.02, s * 0.5, x0 + w * 0.14, s * 0.06);
      ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#3b2418'; ctx.stroke();
      ctx.strokeStyle = '#1e2238'; ctx.fillStyle = '#1e2238'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (i === 0) {
        // Anchor.
        ctx.beginPath(); ctx.arc(cx, s * 0.24, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, s * 0.29); ctx.lineTo(cx, s * 0.78); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 40, s * 0.38); ctx.lineTo(cx + 40, s * 0.38); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, s * 0.6, 56, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * 52, s * 0.7); ctx.lineTo(cx + sx * 66, s * 0.64); ctx.lineTo(cx + sx * 58, s * 0.76); ctx.fill(); }
      } else if (i === 1) {
        // Skull and crossed bones, with a red rose.
        ctx.beginPath(); ctx.arc(cx, s * 0.36, 44, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(cx - 26, s * 0.4, 52, 40);
        ctx.fillStyle = '#dcc6a2';
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * 17, s * 0.35, 12, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(cx, s * 0.41); ctx.lineTo(cx - 6, s * 0.45); ctx.lineTo(cx + 6, s * 0.45); ctx.fill();
        ctx.fillStyle = '#1e2238';
        for (const a of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx - 60, s * (0.62 + a * 0.08)); ctx.lineTo(cx + 60, s * (0.62 - a * 0.08)); ctx.stroke(); }
        ctx.fillStyle = '#a3201e'; ctx.beginPath(); ctx.arc(cx + 34, s * 0.82, 14, 0, Math.PI * 2); ctx.fill();
      } else {
        // Waves under a little ship.
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          for (let j = 0; j <= 4; j++) { const x = x0 + w * 0.18 + j * (w * 0.16), y = s * (0.56 + k * 0.12); if (j === 0) ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.04, y - 22, x + w * 0.08, y); ctx.quadraticCurveTo(x + w * 0.12, y + 14, x + w * 0.16, y); }
          ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(cx - 44, s * 0.4); ctx.lineTo(cx + 44, s * 0.4); ctx.lineTo(cx + 30, s * 0.47); ctx.lineTo(cx - 30, s * 0.47); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx, s * 0.4); ctx.lineTo(cx, s * 0.14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 4, s * 0.16); ctx.lineTo(cx + 36, s * 0.34); ctx.lineTo(cx + 4, s * 0.34); ctx.fill();
      }
    }
  });
}

function postGeo(mapped = false) {
  const P = (geo, color, transform, role = null, options = {}) => townPart(geo, color, transform, { mapped, role, ...options });
  return merge([P(cyl(0.2, 0.24, 6, 8), WOOD_D, { pos: [0, -2.4, 0] }, 'timber'), P(cyl(0.22, 0.2, 0.08, 8), WOOD_L, { pos: [0, 0.6, 0] }, 'timber')]);
}

function braziersGeo() {
  return merge([
    part(cyl(0.38, 0.5, 0.8, 8), STONE, { pos: [0, 0.4, 0] }),
    part(cyl(0.62, 0.32, 0.38, 10), 0x3a3240, { pos: [0, 0.98, 0] }),
    part(torus(0.6, 0.06, 6, 16), 0x5a4a5a, { pos: [0, 1.16, 0], rot: [Math.PI / 2, 0, 0] }),
  ]);
}

function pillarGeo() {
  const paint = (x, y) => (y > 0.92 ? 0x6a5c70 : 0x3d3344);
  return merge([part(cyl(0.72, 0.86, 1, 6), 0, { pos: [0, 0.5, 0], paint })]);
}

function gatePostGeo() {
  return merge([
    part(rbox(1.3, 4.2, 1.3, 0.12), 0x3d3344, { pos: [0, 2.1, 0] }),
    part(rbox(1.6, 0.35, 1.6, 0.08), 0x5a4a5a, { pos: [0, 4.3, 0] }),
    part(cyl(0.45, 0.25, 0.4, 8), 0x2a2230, { pos: [0, 4.65, 0] }),
    part(rbox(1.4, 0.3, 1.4, 0.08), 0x5a4a5a, { pos: [0, 0.15, 0] }),
  ]);
}

// La Cala Calavera (M4.5): the border totems, the old fort's stakes and the black flag's pole. Front is +z.
const BONE = 0xe9dfc6, BONE_D = 0xb9ac8e, RAG = 0xb3262b, SOCKET = 0x1a1033;
function skullPostGeo() {
  const L = [
    part(cyl(0.11, 0.15, 2.3, 6), WOOD_D, { pos: [0, 1.15, 0] }),
    part(rbox(0.9, 0.09, 0.09, 0.02), WOOD_D, { pos: [0, 1.75, 0], rot: [0, 0, 0.08] }),
    part(sphere(0.25, 8, 6), BONE, { pos: [0, 2.52, 0.02], scale: [1, 0.92, 1.05] }),
    part(rbox(0.3, 0.13, 0.22, 0.04), BONE_D, { pos: [0, 2.31, 0.08] }),
    part(sphere(0.07, 6, 4), SOCKET, { pos: [-0.09, 2.53, 0.22] }),
    part(sphere(0.07, 6, 4), SOCKET, { pos: [0.09, 2.53, 0.22] }),
    part(cone(0.04, 0.08, 3), SOCKET, { pos: [0, 2.43, 0.24], rot: [Math.PI, 0, 0] }),
    // a red rag tied under the skull, and two crossed bones on the bar
    part(bbox(0.34, 0.5, 0.03), RAG, { pos: [0.18, 1.5, 0.08], rot: [0, 0, -0.12] }),
    part(cyl(0.035, 0.035, 0.6, 5), BONE, { pos: [-0.25, 1.78, 0.06], rot: [0, 0, 0.7] }),
    part(cyl(0.035, 0.035, 0.6, 5), BONE, { pos: [-0.25, 1.78, 0.06], rot: [0, 0, -0.7] }),
  ];
  return merge(L);
}
function palisadeGeo() {
  const L = [];
  for (const [x, h, t] of [[-0.42, 1.9, 0.05], [0, 2.3, -0.04], [0.42, 1.6, 0.09]]) {
    L.push(part(cyl(0.16, 0.18, h, 6), x ? WOOD_D : 0x7a4a26, { pos: [x, h / 2, 0], rot: [t, 0, t * 0.6] }));
    L.push(part(cone(0.16, 0.36, 6), WOOD_L, { pos: [x + t * h * 0.6, h + 0.16, -t * h * 0.1], rot: [t, 0, t * 0.6] }));
  }
  L.push(part(rbox(1.3, 0.12, 0.1, 0.02), WOOD, { pos: [0, 1.05, 0.17], rot: [0, 0, 0.1] }));
  return merge(L);
}
function flagPoleGeo() {
  return merge([
    part(cyl(0.09, 0.13, 6.2, 6), WOOD_D, { pos: [0, 3.1, 0] }),
    part(sphere(0.14, 6, 4), 0xc9a44c, { pos: [0, 6.25, 0] }),
    part(lumpy(ico(0.5, 1), 0.25, 3), 0x998c7c, { pos: [0, 0.15, 0], scale: [1, 0.45, 1] }),
  ]);
}

function rockRingGeo() {
  const L = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    L.push(part(lumpy(ico(0.22, 1), 0.2, i + 1), 0x998c7c, { pos: [Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75] }));
  }
  for (let i = 0; i < 3; i++) L.push(part(cyl(0.09, 0.09, 1.1, 6), 0x6b4423, { pos: [0, 0.2, 0], rot: [Math.PI / 2, (i / 3) * Math.PI, 0.3] }));
  return merge(L);
}

function rowboatGeo() {
  const hullPaint = (x, y) => (y > 0.07 ? 0xe8c98a : y > -0.14 ? 0x9a5a2e : 0x6b3d22);
  const hull = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  return merge([
    part(hull, 0, { scale: [0.72, 0.42, 1.65], pos: [0, 0.12, 0], paint: hullPaint }),
    part(bbox(1.05, 0.06, 2.6), WOOD_D, { pos: [0, -0.06, 0] }),
    part(bbox(1.3, 0.08, 0.26), WOOD_D, { pos: [0, 0.1, 0.45] }),
    part(bbox(1.25, 0.08, 0.24), WOOD_D, { pos: [0, 0.1, -0.55] }),
    part(cyl(0.035, 0.035, 2.0, 5), WOOD_D, { pos: [0.48, 0.2, 0.2], rot: [1.45, 0, 0.2] }),
  ]);
}

function shipGeo() {
  const hullPaint = (x, y, z) => (y > 0.85 ? 0xe8c98a : y > 0.55 ? 0x7a4426 : y > -0.2 ? 0x5e3320 : 0xb83a2e);
  const hull = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  const L = [
    part(hull, 0, { scale: [2.4, 2.0, 7.0], pos: [0, 1.25, 0], paint: hullPaint }),
    part(rbox(4.3, 0.2, 12.4, 0.08), WOOD_L, { pos: [0, 1.3, 0] }),
    part(rbox(3.6, 1.1, 2.6, 0.12), 0x7a4426, { pos: [0, 1.9, -4.4] }),
    part(rbox(3.8, 0.14, 2.8, 0.05), WOOD_L, { pos: [0, 2.48, -4.4] }),
    part(cyl(0.18, 0.24, 10, 8), WOOD_D, { pos: [0, 6.2, 0.6] }),
    part(cyl(0.12, 0.16, 6, 8), WOOD_D, { pos: [0, 5.0, -3.4] }),
    part(cyl(0.55, 0.45, 0.45, 10), WOOD_D, { pos: [0, 9.6, 0.6] }),
    part(cyl(0.08, 0.14, 4.0, 6), WOOD_D, { pos: [0, 2.2, 7.4], rot: [1.15, 0, 0] }),
    part(cyl(0.07, 0.07, 6.2, 6), WOOD_D, { pos: [0, 7.6, 0.6], rot: [0, 0, Math.PI / 2] }),
    part(cyl(0.07, 0.07, 5.0, 6), WOOD_D, { pos: [0, 4.0, 0.6], rot: [0, 0, Math.PI / 2] }),
  ];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) L.push(part(bbox(0.1, 0.32, 0.5), 0x1a1033, { pos: [s * 2.25, 0.95, -2 + i * 2] }));
  return merge(L);
}

function sailGeo() {
  const g = new THREE.PlaneGeometry(5.6, 3.6, 8, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, (1 - (x / 2.8) ** 2) * 0.9 + (1 - ((y) / 1.8) ** 2) * 0.2);
  }
  g.computeVertexNormals();
  const paint = (x, y) => (Math.abs(y) < 0.35 ? 0xe8463c : 0xf6efe0);
  return merge([part(g, 0, { pos: [0, 5.85, 0.75], paint })]);
}

function flagTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1a1033'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#f6efe0'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 14; x <= s - 14; x += 2) { const y = s * 0.55 + Math.sin(x * 0.09) * 12; x === 14 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.32, 13, 0, Math.PI * 2); ctx.fillStyle = '#f6efe0'; ctx.fill();
  });
}

function signTexture(cala = false) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#c9925a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#b98352' : '#d6a565'; ctx.fillRect(0, i * (s / 6), s, s / 12); }
    ctx.strokeStyle = '#5b3a24'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.fillStyle = '#3b2418';
    ctx.textAlign = 'center';
    if (cala) {
      // The Cala's sign: its name, a skull, and the warning in red.
      ctx.font = 'bold 40px "Lilita One", "Titan One", sans-serif';
      ctx.fillText('CALA', s / 2, s * 0.24);
      ctx.fillText('CALAVERA', s / 2, s * 0.42);
      ctx.beginPath(); ctx.arc(s / 2, s * 0.6, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(s / 2 - 16, s * 0.6 + 10, 32, 22);
      ctx.fillStyle = '#c9925a';
      ctx.beginPath(); ctx.arc(s / 2 - 10, s * 0.6 - 2, 7, 0, Math.PI * 2); ctx.arc(s / 2 + 10, s * 0.6 - 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a3201e';
      ctx.font = 'bold 30px "Lilita One", "Titan One", sans-serif';
      ctx.fillText('SIN LEY →', s / 2, s * 0.9);
      return;
    }
    ctx.font = 'bold 44px "Lilita One", "Titan One", sans-serif';
    ctx.fillText('LA CALDERA', s / 2, s * 0.45);
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('↑', s / 2, s * 0.85);
  });
}

// The black flag of the Cala: a skull over crossed bones on black.
function blackFlagTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#15101c'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#f2ead6'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s * 0.22, s * 0.62); ctx.lineTo(s * 0.78, s * 0.9); ctx.moveTo(s * 0.78, s * 0.62); ctx.lineTo(s * 0.22, s * 0.9); ctx.stroke();
    ctx.fillStyle = '#f2ead6';
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.36, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(s * 0.5 - 15, s * 0.36 + 14, 30, 18);
    ctx.fillStyle = '#15101c';
    ctx.beginPath(); ctx.arc(s * 0.5 - 10, s * 0.35, 7, 0, Math.PI * 2); ctx.arc(s * 0.5 + 10, s * 0.35, 7, 0, Math.PI * 2); ctx.fill();
  });
}

// The size an imported model is fitted to when it replaces a procedural piece: { w: largest horizontal extent, h }.
function boxTarget(geo) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox;
  return { w: Math.max(b.max.x - b.min.x, b.max.z - b.min.z), h: b.max.y - b.min.y };
}

export function createProps(map) {
  const group = new THREE.Group();
  group.name = 'props';
  const mat = toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'prop', ...PROP_INK });
  const nm = normalMatFor({ occluder: true });
  const glowMat = glowBasic({ color: 0xffd36a }, 1);
  const townAtlas = assets.texture(TOWN_ALBEDO_ID);
  const townNormal = townAtlas ? assets.texture(TOWN_NORMAL_ID) : null;
  const dockAtlas = assets.texture(RAFT_ATLAS_ID);
  // Reuse the same registry-owned cloth/wood atlas already consumed by the dock and raft.
  const coverBase = townAtlas ? townMaterial(townAtlas, townNormal, mat, PROP_INK)
    : toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'prop', ...PROP_INK });
  const townMat = townCoverMaterial(coverBase, dockAtlas);
  const mappedTown = !!townAtlas;
  const kits = {
    hut: hutGeo(mappedTown), crate: crateGeo(), barrel: barrelGeo(), stall: stallGeo(mappedTown), lantern: townLanternGeometry(mappedTown),
    dockPost: postGeo(mappedTown), brazier: braziersGeo(), pillar: pillarGeo(), gatePost: gatePostGeo(), sign: townSignPostGeometry(mappedTown),
    campfire: rockRingGeo(), rack: rackGeo(), skullPost: skullPostGeo(), palisade: palisadeGeo(), blackFlag: flagPoleGeo(),
  };
  if (mappedTown) for (const kind of ['crate', 'barrel']) {
    const original = kits[kind];
    kits[kind] = portCargoGeometry(original, kind);
    original.dispose();
  }
  if (mappedTown) for (const geo of Object.values(kits)) townNeutral(geo);
  for (const geo of Object.values(kits)) townCoverNeutral(geo);
  const byKind = new Map();
  for (const p of map.props) {
    if (!kits[p.kind]) continue;
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  // Imported models (assets/manifest.json "prop" entries) replace whole kinds: instanced, fitted to the procedural
  // prop's size (so the sim's colliders still match), their own emission instead of the glass / coal / window parts.
  const extOf = new Map(), extAt = new Map();
  for (const kind of byKind.keys()) { const id = assets.propId(kind); if (id) { extOf.set(kind, id); extAt.set(kind, []); } }
  // Static props are baked into one merged mesh per world chunk (few draw calls, culls per chunk).
  const CH = 72;
  const buckets = new Map();
  const glowParts = [], coalParts = [], windowParts = [];
  const lanternGlass = new THREE.BoxGeometry(0.26, 0.3, 0.26);
  const coalDisc = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 10);
  const strip = (g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };
  for (const [kind, list] of byKind) {
    for (const p of list) {
      q.setFromAxisAngle(up, p.rot);
      const s = kind === 'pillar' ? sc.set(1, p.h, 1) : sc.set(p.scale, p.scale, p.scale);
      m4.compose(v.set(p.x, p.y, p.z), q, s);
      if (extOf.has(kind)) { extAt.get(kind).push(m4.clone()); continue; }
      const key = `${Math.floor(p.x / CH)},${Math.floor(p.z / CH)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(kits[kind].clone().applyMatrix4(m4));
      if (kind === 'lantern') glowParts.push(strip(lanternGlass.clone().applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(0.42, 1.78, 0)))));
      if (kind === 'hut') {
        windowParts.push(strip(new THREE.BoxGeometry(0.54, 0.4, 0.04).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(1.15, 2.45, 1.83)))));
        windowParts.push(strip(new THREE.BoxGeometry(0.04, 0.4, 0.54).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(1.83, 2.45, 0)))));
        windowParts.push(strip(new THREE.BoxGeometry(0.1, 1.2, 0.04).applyMatrix4(m4.clone().multiply(new THREE.Matrix4().makeTranslation(0.36, 1.92, 1.83)))));
      }
      if (kind === 'brazier') coalParts.push(strip(coalDisc.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(p.x, p.y + 1.12, p.z))));
    }
  }
  // Doña Sepia's stall (M4.7), render only: 2 u behind her, facing the way she faces (the sim keeps her space clear).
  const sepia = (map.npcs || []).find((n) => n.id === 'tattoo');
  let sepiaKey = null;
  if (sepia) {
    const f = sepia.facing || 0, sx = sepia.x - Math.sin(f) * 2.0, sz = sepia.z - Math.cos(f) * 2.0;
    q.setFromAxisAngle(up, f);
    m4.compose(v.set(sx, map.groundAt(sx, sz), sz), q, sc.set(1, 1, 1));
    const key = `${Math.floor(sx / CH)},${Math.floor(sz / CH)}`;
    sepiaKey = key;
    if (!buckets.has(key)) buckets.set(key, []);
    const sepiaGeo = tattooStallGeo(mappedTown);
    buckets.get(key).push(townCoverNeutral(mappedTown ? townNeutral(sepiaGeo) : sepiaGeo).applyMatrix4(m4));
    const hides = new THREE.PlaneGeometry(2.1, 0.86);
    hides.translate(0, 1.6, -0.62);
    const hm = new THREE.Mesh(hides, toon({ map: tattooHidesTexture(), color: 0xffffff, alphaTest: 0.5, side: THREE.DoubleSide }, { key: 'hides' }));
    hm.applyMatrix4(m4);
    hm.castShadow = true;
    hm.userData.nm = normalMatFor({}, THREE.DoubleSide);
    group.add(hm);
  }
  for (const [key, list] of buckets) {
    const mesh = new THREE.Mesh(merge(list), townMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nm = nm;
    mesh.name = 'propsChunk';
    mesh.userData.townWood = { mapped: mappedTown, normal: !!townNormal, family: 'town-wood-v1' };
    mesh.userData.townCovers = { family: 'town-covers-v1', clothAtlas: dockAtlas ? RAFT_ATLAS_ID : null };
    if (key === sepiaKey) mesh.userData.townFurniture = { family: 'town-furniture-v1', kind: 'sepia', mapped: mappedTown, texturesAdded: 0 };
    group.add(mesh);
  }
  for (const [kind, id] of extOf) {
    const ext = assets.instanced(id, extAt.get(kind), boxTarget(kits[kind]));
    if (ext) {
      if (mappedTown && kind === 'crate' && id === 'prop:storage-crate') paintPortCargoInstances(ext, townMat);
      group.add(ext);
    }
  }
  const coalMat = glowBasic({ color: 0xff7a1a }, 0.85);
  if (glowParts.length) group.add(new THREE.Mesh(mergeGeometries(glowParts), glowMat));
  if (coalParts.length) group.add(new THREE.Mesh(mergeGeometries(coalParts), coalMat));
  // Hut windows and the door crack: lit from inside at dusk and night (color set by the preset).
  const windowMat = glowBasic({ color: 0xffb04a }, 0);
  if (windowParts.length) {
    const win = new THREE.Mesh(mergeGeometries(windowParts), windowMat);
    win.layers.set(LAYER.NO_OUTLINE);
    win.visible = false;
    win.name = 'hutWindows';
    windowMat.userData.mesh = win;
    group.add(win);
  }

  // Dock deck planks.
  const d = map.dock;
  const dockMat = dockWoodMaterial(dockAtlas, mat);
  const dockPart = (geometry, color, transform, variant) => dockWoodPart(geometry, color, transform,
    { mapped: !!dockAtlas, variant });
  const planks = [];
  const n = Math.floor((d.len + 1.5) / 0.5);
  for (let i = 0; i < n; i++) {
    const along = -1.5 + i * 0.5 + 0.22;
    planks.push(dockPart(bbox(d.halfWidth * 2 + 0.1, 0.14, 0.42), i % 3 === 0 ? WOOD_L : i % 3 === 1 ? WOOD : 0xc08a4c, { pos: [0, d.deckY - 0.07, along] }, i));
  }
  planks.push(dockPart(bbox(0.18, 0.18, d.len + 1.5), WOOD_D, { pos: [d.halfWidth, d.deckY - 0.2, d.len / 2 - 0.75] }, 1));
  planks.push(dockPart(bbox(0.18, 0.18, d.len + 1.5), WOOD_D, { pos: [-d.halfWidth, d.deckY - 0.2, d.len / 2 - 0.75] }, 2));
  const deck = new THREE.Mesh(merge(planks), dockMat);
  deck.name = 'dockDeck';
  deck.userData.dockWood = { family: 'dock-wood-v1', atlas: dockAtlas ? RAFT_ATLAS_ID : null,
    mapped: !!dockAtlas, boards: n, beams: 2, texturesAdded: 0 };
  deck.userData.nm = nm;
  deck.position.set(d.base.x, 0, d.base.z);
  deck.rotation.y = Math.atan2(d.dir.x, d.dir.z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const dockRopes = createDockRopes(map, dockAtlas);
  if (dockRopes) group.add(dockRopes);

  // Ship (bobs gently).
  const shipProp = map.props.find((p) => p.kind === 'ship');
  const ship = new THREE.Group();
  // An imported model for the ship at the dock ("ship:dock"), fitted to the procedural hull unless it says its size.
  const shipExt = shipProp && assets.has('ship:dock') ? assets.model('ship:dock', boxTarget(shipGeo())) : null;
  if (shipProp && shipExt) {
    ship.add(shipExt);
    const flag = new THREE.Object3D(); // the procedural flag's flutter keeps a target; the model brings its own flag
    ship.add(flag);
    ship.position.set(shipProp.x, -0.35, shipProp.z);
    ship.rotation.y = shipProp.rot;
    ship.userData.flag = flag;
    group.add(ship);
  } else if (shipProp) {
    const hull = new THREE.Mesh(shipGeo(), mat);
    hull.userData.nm = nm;
    const sailMat = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }, { occluder: true, key: 'sail' });
    const sail = new THREE.Mesh(sailGeo(), sailMat);
    sail.userData.nm = normalMatFor({ occluder: true }, THREE.DoubleSide);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    flag.position.set(0, 11.0, 1.4);
    flag.rotation.y = Math.PI / 2;
    flag.layers.set(LAYER.NO_OUTLINE);
    for (const o of [hull, sail]) { o.castShadow = true; o.receiveShadow = true; }
    ship.add(hull, sail, flag);
    ship.position.set(shipProp.x, -0.35, shipProp.z);
    ship.rotation.y = shipProp.rot;
    ship.userData.flag = flag;
    group.add(ship);
  }

  // Sign boards with text (h 1: the Cala's).
  for (const signP of map.props.filter((p) => p.kind === 'sign')) {
    const board = mappedTown
      ? new THREE.Mesh(townSignGeometry(!!signP.h), townSignMaterial(townAtlas, townNormal, townSignInk(!!signP.h)))
      : new THREE.Mesh(new THREE.BoxGeometry(1.5, signP.h ? 1.45 : 1.1, 0.1), toon({ map: signTexture(!!signP.h), color: 0xffffff }, { key: 'signboard' }));
    board.position.set(signP.x, signP.y + (signP.h ? 1.85 : 1.75), signP.z);
    board.rotation.y = signP.rot;
    board.castShadow = true;
    board.name = 'townSign';
    board.userData.townFixtures = { family: 'town-fixtures-v1', kind: 'sign', cala: !!signP.h, mapped: mappedTown };
    group.add(board);
  }
  // The Cala's black flag (it flutters: GameScene.update).
  const flags = [];
  for (const fp of map.props.filter((p) => p.kind === 'blackFlag')) {
    const g = new THREE.PlaneGeometry(1.9, 1.3, 6, 1);
    g.translate(0.95, 0, 0);
    const flag = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: blackFlagTexture(), side: THREE.DoubleSide }));
    flag.position.set(fp.x, fp.y + 5.5, fp.z);
    flag.rotation.y = fp.rot + 0.6;
    flag.layers.set(LAYER.NO_OUTLINE);
    flag.userData.base = g.attributes.position.array.slice();
    group.add(flag);
    flags.push(flag);
  }

  // Gate doors (open; M3 closes them).
  const gateP = map.props.find((p) => p.kind === 'gate');
  const gate = new THREE.Group();
  if (gateP) {
    const doorPaint = (x, y) => (Math.abs(y - 0.6) < 0.08 || Math.abs(y - 2.6) < 0.08 ? 0x4a4a58 : Math.floor((x + 5) * 3) % 2 ? WOOD_D : 0x6e4426);
    const doorGeo = merge([part(rbox(3.0, 3.4, 0.22, 0.05), 0, { pos: [1.5, 1.7, 0], paint: doorPaint })]);
    const left = new THREE.Mesh(doorGeo, mat); left.userData.nm = nm;
    const right = new THREE.Mesh(doorGeo, mat); right.userData.nm = nm;
    left.position.set(-3.0, 0, 0); right.position.set(3.0, 0, 0);
    right.scale.x = -1;
    left.rotation.y = -1.35; right.rotation.y = 1.35;
    for (const o of [left, right]) { o.castShadow = true; o.receiveShadow = true; }
    gate.add(left, right);
    gate.position.set(gateP.x, map.groundAt(gateP.x, gateP.z), gateP.z);
    gate.rotation.y = gateP.rot - Math.PI / 2;
    gate.userData.doors = [left, right];
    group.add(gate);
  }

  // Floating cargo + rowboat (bobbed in GameScene.update). Water foams around them on its own.
  const floaters = [];
  const floatKits = { 1: rowboatGeo(), 2: crateGeo(), 3: barrelGeo() };
  for (const p of map.props.filter((q) => q.kind === 'float')) {
    const geo = floatKits[p.h];
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.nm = nm;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.position.set(p.x, 0, p.z);
    holder.rotation.y = p.rot;
    if (p.h === 3) { mesh.rotation.z = Math.PI / 2; mesh.position.set(0.5, 0.05, 0); mesh.scale.setScalar(0.9); }
    else if (p.h === 2) { mesh.position.y = -0.55; mesh.scale.setScalar(0.85); }
    holder.add(mesh);
    holder.userData.phase = p.v * 6.28;
    holder.userData.baseRot = p.rot;
    holder.userData.boat = p.h === 1;
    group.add(holder);
    floaters.push(holder);
  }

  return { group, ship, gate, floaters, flags, windowMat, glassMat: glowMat };
}
