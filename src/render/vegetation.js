// Instanced vegetation and rocks, chunked spatially so frustum culling works per chunk.
// Palms sway in the vertex shader (paired normal material sways identically for the outlines).
import * as THREE from 'three';
import { part, merge, ico, sphere, cyl, lumpy } from './geo.js';
import { toon, normalMatFor } from './toon.js';
import { LAYER } from './pipeline.js';
import { INK_GLSL, INK_WN } from './inkGlsl.js';

const CHUNK = 48;

// Ink pass (P5), albedo only. Rocks: ink cracks like the terrain slopes. Palm trunks: ring bands every ~0.32 u of height
// (darker band above each joint, thin ink line on the joint), in object space so they sway with the trunk. Bushes: two-tone
// brush strokes, lighter on the upward-facing side.
const ROCK_INK = {
  vertPars: INK_WN.vertPars,
  vertBody: INK_WN.vertBody,
  fragPars: INK_GLSL + INK_WN.fragPars,
  albedo: /* glsl */ `
    {
      float fade = mnDetailFade();
      float cr = mnCracks(vMnWorld, normalize(vMnWN), 0.26, 0.022, 0.5, fade > 0.01);
      diffuseColor.rgb = mix(diffuseColor.rgb, MN_INK, 0.65 * cr * fade);
    }
  `,
};
const TRUNK_INK = {
  vertPars: 'varying vec3 vMnObj;\n',
  vertBody: 'vMnObj = position;\n',
  fragPars: INK_GLSL + 'varying vec3 vMnObj;\n',
  albedo: /* glsl */ `
    {
      float fade = mnDetailFade();
      if (fade > 0.01) {
        float f = fract((vMnObj.y + vMnObj.z * 0.25) / 0.32); // rings tilt a little across the trunk
        float ringZone = (1.0 - smoothstep(5.2, 5.6, vMnObj.y)) * fade; // none on the crown and coconuts
        float band = mix(0.82, 1.0, smoothstep(0.0, 0.55, f));
        diffuseColor.rgb *= mix(1.0, band, ringZone);
        diffuseColor.rgb = mix(diffuseColor.rgb, MN_INK, 0.55 * mnLine(min(f, 1.0 - f) * 0.32, 0.016) * ringZone);
      }
    }
  `,
};
const BUSH_INK = {
  vertPars: INK_WN.vertPars,
  vertBody: INK_WN.vertBody,
  fragPars: INK_GLSL + INK_WN.fragPars,
  albedo: /* glsl */ `
    {
      float fade = mnDetailFade();
      if (fade > 0.01) {
        vec3 wn = normalize(vMnWN);
        mat2 r = mat2(0.866, 0.5, -0.5, 0.866);
        float b = texture2D(mnNoiseTex, r * mnTri(vMnWorld, wn) * vec2(1.1, 0.35)).b; // strokes: fbm stretched along one axis
        float top = smoothstep(0.15, 0.7, wn.y);
        vec3 c = diffuseColor.rgb;
        c = mix(c, c * 1.24 + vec3(0.03, 0.03, 0.0), smoothstep(0.56, 0.64, b) * top);
        c *= 1.0 - 0.22 * smoothstep(0.44, 0.36, b) * (1.0 - top);
        diffuseColor.rgb = mix(diffuseColor.rgb, c, fade);
      }
    }
  `,
};
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

function palmTrunkGeometry() {
  const H = 6, rings = 9, radial = 7;
  const pos = [], col = [], flex = [], idx = [];
  const light = new THREE.Color(0xb98352), dark = new THREE.Color(0x8a5a34);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const cx = 1.15 * t * t, cy = t * H;
    const r = 0.3 * (1 - 0.42 * t) + 0.12 * Math.max(0, 0.15 - t) * 6;
    const c = Math.floor(t * 13) % 2 ? light : dark;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r);
      col.push(c.r, c.g, c.b);
      flex.push(t * t);
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < radial; k++) {
    const a = i * radial + k, b = i * radial + ((k + 1) % radial), c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Crown knob + coconuts.
  const top = new THREE.Vector3(1.15, H, 0);
  const extra = [
    part(sphere(0.34, 8, 6), 0x6f8f3a, { pos: [top.x, top.y + 0.05, 0] }),
    part(sphere(0.2, 6, 5), 0x6b4423, { pos: [top.x + 0.22, top.y - 0.18, 0.12] }),
    part(sphere(0.2, 6, 5), 0x6b4423, { pos: [top.x - 0.18, top.y - 0.2, 0.18] }),
    part(sphere(0.2, 6, 5), 0x7a5230, { pos: [top.x + 0.02, top.y - 0.22, -0.24] }),
  ].map((e) => { e.setAttribute('aFlex', new THREE.Float32BufferAttribute(new Float32Array(e.attributes.position.count).fill(1), 1)); return e; });
  const gNon = g.toNonIndexed();
  const merged = merge([gNon, ...extra]);
  return { geo: merged, top };
}

function palmFrondGeometry(top) {
  const leaves = 8, segs = 7;
  const pos = [], col = [], flex = [], idx = [];
  const vein = new THREE.Color(0x86d64e), edge = new THREE.Color(0x3c9a3c), tip = new THREE.Color(0x2f7f39);
  let base = 0;
  for (let l = 0; l < leaves; l++) {
    const a = (l / leaves) * Math.PI * 2 + (l % 2) * 0.2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const L = 2.7 + (l % 3) * 0.3;
    const lift = 0.55 + (l % 2) * 0.25;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.75) + 0.04;
      const cx = top.x + dir.x * t * L, cz = dir.z * t * L;
      const cy = top.y + t * lift * 1.6 - t * t * (1.9 + lift);
      const fold = w * 0.38;
      const cc = new THREE.Color().copy(vein).lerp(tip, t * 0.7);
      const ce = new THREE.Color().copy(edge).lerp(tip, t * 0.5);
      // left edge, center, right edge (V-fold)
      pos.push(cx - side.x * w, cy + fold, cz - side.z * w); col.push(ce.r, ce.g, ce.b);
      pos.push(cx, cy, cz); col.push(cc.r, cc.g, cc.b);
      pos.push(cx + side.x * w, cy + fold, cz + side.z * w); col.push(ce.r, ce.g, ce.b);
      flex.push(2, 2, 2);
    }
    for (let s = 0; s < segs; s++) {
      const r0 = base + s * 3, r1 = r0 + 3;
      idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1, r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
    }
    base += (segs + 1) * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bushGeometry(variant) {
  const paint = (x, y) => (y > 0.55 ? 0x63c24a : y > 0.25 ? 0x47a63d : 0x2f8236);
  const list = [
    part(lumpy(ico(0.62, 1), 0.12, 1 + variant), 0, { pos: [0, 0.45, 0], scale: [1, 0.85, 1], paint }),
    part(lumpy(ico(0.48, 0), 0.1, 2 + variant), 0, { pos: [0.5, 0.32, 0.18], paint }),
    part(lumpy(ico(0.44, 0), 0.1, 3 + variant), 0, { pos: [-0.42, 0.3, -0.2], paint }),
  ];
  if (variant === 1) {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      list.push(part(ico(0.075, 0), i % 2 ? 0xff5f8a : 0xffd166, { pos: [Math.cos(a) * 0.45, 0.62 + (i % 3) * 0.08, Math.sin(a) * 0.45] }));
    }
  }
  return merge(list);
}

function rockGeometry(variant) {
  const paint = (x, y) => (y > 0.35 ? 0xb3aaa1 : 0x8f857d);
  const g = lumpy(ico(0.7, 1), 0.22, 4 + variant * 3);
  return merge([part(g, 0, { pos: [0, 0.3, 0], scale: [1.15, 0.75, 1], paint })]);
}

// Seaweed: a tuft of curved, tapered ribbons; aFlex grows with height so tips sway most.
function seaweedGeometry() {
  const blades = 5, rows = 6;
  const pos = [], col = [], flex = [], idx = [];
  const base = new THREE.Color(0x1f6b45), tip = new THREE.Color(0x6fd08a);
  let v0 = 0;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const r0 = 0.06 + (b % 2) * 0.05;
    const H = 0.75 + (b % 3) * 0.18;
    const bend = 0.18 + (b % 2) * 0.12;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const w = 0.07 * (1 - t * 0.85);
      const c = new THREE.Vector3().copy(dir).multiplyScalar(r0 + bend * t * t);
      c.y = t * H;
      const k = new THREE.Color().copy(base).lerp(tip, t);
      for (const sgn of [-1, 1]) {
        pos.push(c.x + side.x * w * sgn, c.y, c.z + side.z * w * sgn);
        col.push(k.r, k.g, k.b);
        flex.push(Math.pow(t, 1.5) * 0.9);
      }
    }
    for (let r = 0; r < rows; r++) {
      const a0 = v0 + r * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
    v0 += (rows + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function pebbleGeometry() {
  return merge([
    part(lumpy(ico(0.14, 0), 0.2, 5), 0xffffff, { scale: [1.2, 0.45, 1], pos: [0, 0.03, 0] }),
    part(lumpy(ico(0.09, 0), 0.2, 7), 0xffffff, { scale: [1.1, 0.5, 1], pos: [0.2, 0.02, 0.1] }),
  ]);
}

function flowerGeometry(color) {
  const list = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    list.push(part(ico(0.075, 0), color, { pos: [Math.cos(a) * 0.08, 0.16, Math.sin(a) * 0.08], scale: [1, 0.45, 1] }));
  }
  list.push(part(ico(0.045, 0), 0xffe066, { pos: [0, 0.18, 0] }));
  list.push(part(cyl(0.015, 0.015, 0.16, 3), 0x3c8f3c, { pos: [0, 0.08, 0] }));
  list.push(part(ico(0.09, 0), 0x4aa53f, { pos: [0.08, 0.03, 0], scale: [1, 0.3, 0.6] }));
  return merge(list);
}

// Build chunked InstancedMeshes for a list of props.
function chunked(name, props, geo, mat, nm, place, colorOf, opts = {}) {
  const group = new THREE.Group();
  group.name = name;
  const buckets = new Map();
  for (const p of props) {
    const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      place(p, m4);
      mesh.setMatrixAt(i, m4);
      if (colorOf) mesh.setColorAt(i, colorOf(p));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = true;
    if (nm) mesh.userData.nm = nm;
    if (opts.noOutline) mesh.layers.set(LAYER.NO_OUTLINE);
    group.add(mesh);
  }
  return group;
}

export function createVegetation(map) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const swayU = { value: 0.3 };
  const palmOpts = { sway: true, occluder: true, swayUniform: swayU, key: 'palm' };
  const trunkMat = toon({ color: 0xffffff, vertexColors: true }, { ...palmOpts, ...TRUNK_INK });
  const frondMat = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }, { ...palmOpts, key: 'frond' });
  const trunkNm = normalMatFor(palmOpts);
  const frondNm = normalMatFor(palmOpts, THREE.DoubleSide);
  const { geo: trunkGeo, top } = palmTrunkGeometry();
  const frondGeo = palmFrondGeometry(top);

  const palms = map.props.filter((p) => p.kind === 'palm');
  const placePalm = (p, m) => {
    const s = (p.h / 6) * p.scale;
    q.setFromAxisAngle(up, p.rot);
    m.compose(v.set(p.x, p.y - 0.1, p.z), q, sc.set(s, s, s));
  };
  group.add(chunked('palmTrunks', palms, trunkGeo, trunkMat, trunkNm, placePalm));
  group.add(chunked('palmFronds', palms, frondGeo, frondMat, frondNm, placePalm));

  const bushMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'bush', ...BUSH_INK });
  const bushes = map.props.filter((p) => p.kind === 'bush');
  const tint = new THREE.Color();
  for (let variant = 0; variant < 2; variant++) {
    const list = bushes.filter((p, i) => (p.v < 0.25 ? 1 : 0) === variant);
    group.add(chunked('bushes' + variant, list, bushGeometry(variant), bushMat, null, (p, m) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(v.set(p.x, p.y - 0.12, p.z), q, sc.setScalar(p.scale));
    }, (p) => tint.setHSL(0.27 + (p.v - 0.5) * 0.06, 0.55, 0.62 + p.v * 0.12).clone(), { castShadow: false }));
  }

  const rockMat = toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'rock', ...ROCK_INK });
  const rockNm = normalMatFor({ occluder: true });
  const rocks = map.props.filter((p) => p.kind === 'rock');
  for (let variant = 0; variant < 2; variant++) {
    const list = rocks.filter((p) => (p.v < 0.5 ? 0 : 1) === variant);
    group.add(chunked('rocks' + variant, list, rockGeometry(variant), rockMat, rockNm, (p, m) => {
      q.setFromEuler(new THREE.Euler(p.v * 0.4 - 0.2, p.rot, p.v * 0.3 - 0.15));
      m.compose(v.set(p.x, p.y, p.z), q, sc.set(p.scale, p.scale * (0.8 + p.v * 0.4), p.scale));
    }, (p) => {
      const volc = map.masks(p.x, p.z).volcanic;
      return new THREE.Color(0xffffff).lerp(new THREE.Color(0x5b4b5e), volc);
    }));
  }

  const flowerMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'flower', comic: false });
  const flowers = map.props.filter((p) => p.kind === 'flower');
  const fColors = [0xff5f8a, 0xffd166, 0xffffff, 0xff8a3d];
  fColors.forEach((c, ci) => {
    const list = flowers.filter((p) => Math.floor(p.v * fColors.length) === ci);
    if (!list.length) return;
    group.add(chunked('flowers' + ci, list, flowerGeometry(c), flowerMat, null, (p, m) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(v.set(p.x, p.y - 0.02, p.z), q, sc.setScalar(p.scale * 1.4));
    }, null, { castShadow: false, noOutline: true }));
  });

  // Underwater: seaweed (slow sway) and pale pebbles.
  const weedSway = { value: 0.1 };
  const weedOpts = { sway: true, swayUniform: weedSway, key: 'seaweed', comic: false };
  const weedMat = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }, weedOpts);
  const weedNm = normalMatFor(weedOpts, THREE.DoubleSide);
  const weeds = map.props.filter((p) => p.kind === 'seaweed');
  group.add(chunked('seaweed', weeds, seaweedGeometry(), weedMat, weedNm, (p, m) => {
    q.setFromAxisAngle(up, p.rot);
    m.compose(v.set(p.x, p.y - 0.05, p.z), q, sc.setScalar(p.scale));
  }, null, { castShadow: false }));
  const pebbleMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'pebble', comic: false });
  const pebbles = map.props.filter((p) => p.kind === 'pebble');
  const pebbleColors = [0xf4f1ea, 0xc9d8e6, 0xe8d3b0, 0xf2b8a8, 0x9fb4c6].map((c) => new THREE.Color(c));
  group.add(chunked('pebbles', pebbles, pebbleGeometry(), pebbleMat, null, (p, m) => {
    q.setFromAxisAngle(up, p.rot);
    m.compose(v.set(p.x, p.y - 0.02, p.z), q, sc.setScalar(p.scale));
  }, (p) => pebbleColors[Math.floor(p.v * pebbleColors.length)], { castShadow: false }));

  return { group, swayU };
}
