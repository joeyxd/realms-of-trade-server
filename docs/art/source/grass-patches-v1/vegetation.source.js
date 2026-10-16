// Instanced vegetation and rocks, chunked spatially so frustum culling works per chunk.
// Palms sway in the vertex shader (paired normal material sways identically for the outlines).
import * as THREE from 'three';
import { part, merge, ico, cyl, lumpy } from './geo.js';
import { toon, normalMatFor } from './toon.js';
import { LAYER } from './pipeline.js';
import { INK_GLSL, INK_WN } from './inkGlsl.js';
import { assets } from './assets/registry.js';
import { COAST_ROCK_ID, coastRockGeometry, coastRockVariant, coastRockBase, isCoastRock } from './coastRockGeometry.js';
import { BEACH_SHELL_IDS, BEACH_PEBBLES_ID, buildBeachDetails, shellGeometry, beachPebbleGeometry } from './beachDetails.js';
import { PALM_IDS, PALM_STYLES, palmGeometry, palmVariant, loadedPalmGeometry } from './palmGeometry.js';
import { palmMaterials } from './palmMaterials.js';
import { PALM_BASE_IDS, PALM_BASE_STYLES, PALM_BASE_LIMIT, palmBaseGeometry, loadedPalmBaseGeometry, buildPalmBases } from './palmBaseGeometry.js';
import { palmBaseMaterials } from './palmBaseMaterials.js';
import { SHRUB_IDS, SHRUB_STYLES, shrubGeometry, loadedShrubGeometry } from './shrubGeometry.js';
import { SHRUB_LIMIT, buildShrubs } from './shrubPlacement.js';
import { shrubMaterials } from './shrubMaterials.js';
import { createGrassPatches } from './grassPatches.js';

const CHUNK = 48;

// Ink pass (P5), albedo only. Rocks: ink cracks like the terrain slopes. Bushes: two-tone
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
const COAST_ROCK_INK = {
  vertPars: INK_WN.vertPars,
  vertBody: INK_WN.vertBody,
  fragPars: INK_GLSL + INK_WN.fragPars,
  albedo: /* glsl */ `
    {
      float fade = mnDetailFade();
      vec3 wn = normalize(vMnWN);
      float cr = mnCracks(vMnWorld, wn, 0.16, 0.013, 0.57, fade > 0.01);
      diffuseColor.rgb = mix(diffuseColor.rgb, MN_INK, 0.52 * cr * fade);
      // Broad painted variation, quiet at gameplay distance. Wetness follows the waterline.
      float brush = texture2D(mnNoiseTex, mnTri(vMnWorld, wn) * vec2(0.24, 0.10)).b;
      diffuseColor.rgb *= 1.0 + (brush - 0.5) * 0.18 * fade;
      float wet = 1.0 - smoothstep(0.04, 0.38, vMnWorld.y);
      diffuseColor.rgb *= 1.0 - 0.27 * wet;
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
// Broad radial ribs are part of the shell paint, including on low; antialias before they become subpixel noise.
const SHELL_PAINT = {
  vertPars: 'varying vec3 vShellPoint;\n',
  vertBody: 'vShellPoint = position;\n',
  fragPars: 'varying vec3 vShellPoint; uniform float mnShellOval;\n',
  albedo: /* glsl */ `
    {
      vec2 p = mix(vShellPoint.xz + vec2(0.0, 0.2), vShellPoint.xz / vec2(0.73, 1.1), mnShellOval);
      float r = length(p);
      float angle = atan(p.x, p.y);
      float count = mix(10.0 / 2.64, 12.0 / 6.2831853, mnShellOval);
      float phase = (angle + mix(1.32, 0.0, mnShellOval)) * count;
      float f = fract(phase);
      float d = min(f, 1.0 - f) * r / count;
      float aa = fwidth(d) * 0.8 + 0.0001;
      float rib = 1.0 - smoothstep(0.009 - aa, 0.009 + aa, d);
      float fade = (1.0 - smoothstep(18.0, 38.0, distance(vMnWorld, cameraPosition))) * smoothstep(0.03, 0.12, r);
      float top = smoothstep(0.014, 0.025, vShellPoint.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.13, 0.085), rib * fade * top * 0.68);
    }
  `,
};
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);


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
    if (opts.boundPad) mesh.boundingSphere.radius += opts.boundPad;
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = true;
    if (nm) mesh.userData.nm = nm;
    if (opts.depth) mesh.customDepthMaterial = opts.depth;
    if (opts.noOutline) mesh.layers.set(LAYER.NO_OUTLINE);
    group.add(mesh);
  }
  return group;
}

export function createVegetation(map) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const swayU = { value: 0.3 };
  const palms = map.props.filter((p) => p.kind === 'palm');
  const palmMats = palmMaterials(assets, swayU), palmLoaded = [], palmCounts = [];
  const placePalm = (p, m) => {
    const s = (p.h / 6) * p.scale;
    q.setFromAxisAngle(up, p.rot);
    m.compose(v.set(p.x, p.y - 0.1, p.z), q, sc.set(s, s, s));
  };
  for (let variant = 0; variant < 3; variant++) {
    const list = palms.filter((p) => palmVariant(p) === variant);
    const imported = palmMats.painted ? loadedPalmGeometry(assets.data(PALM_IDS[variant])) : null;
    const geometry = imported || palmGeometry(variant, { cards: palmMats.painted });
    if (imported) palmLoaded.push(PALM_IDS[variant]);
    palmCounts.push({ style: PALM_STYLES[variant], count: list.length });
    // Wind padding covers the maximum local sway after scale; palm scale is bounded by world generation.
    const boundPad = Math.max(0, ...list.map((p) => (p.h / 6) * p.scale)) * 0.5;
    group.add(chunked('palmTrunks' + variant, list, geometry.trunk, palmMats.trunk, palmMats.trunkNm, placePalm, null,
      { depth: palmMats.trunkDepth, boundPad }));
    group.add(chunked('palmFronds' + variant, list, geometry.fronds, palmMats.fronds, palmMats.frondNm, placePalm, null,
      { depth: palmMats.frondDepth, boundPad }));
  }
  group.userData.palms = { total: palms.length, variants: palmCounts, loaded: palmLoaded, textures: palmMats.textures,
    painted: palmMats.painted, normal: palmMats.normal, cosmetic: true };

  const bases = buildPalmBases(map), baseMats = palmBaseMaterials(assets, swayU, palmMats);
  const baseLoaded = [], baseCounts = [], baseYaw = new THREE.Quaternion(), baseUp = new THREE.Vector3();
  const baseGroup = new THREE.Group(); baseGroup.name = 'palmBases';
  const placeBase = (p, m) => {
    q.setFromUnitVectors(up, baseUp.set(p.nx, p.ny, p.nz));
    baseYaw.setFromAxisAngle(up, p.rot); q.multiply(baseYaw);
    m.compose(v.set(p.x, p.y, p.z), q, sc.setScalar(p.scale));
  };
  for (let variant = 0; variant < 2; variant++) {
    const list = bases.filter((p) => p.variant === variant);
    const imported = baseMats.painted ? loadedPalmBaseGeometry(assets.data(PALM_BASE_IDS[variant])) : null;
    const geometry = imported || palmBaseGeometry(variant, { cards: baseMats.painted });
    if (imported) baseLoaded.push(PALM_BASE_IDS[variant]);
    baseCounts.push({ style: PALM_BASE_STYLES[variant], count: list.length });
    if (!list.length) { geometry.roots.dispose(); geometry.leaves.dispose(); continue; }
    const boundPad = Math.max(...list.map((p) => p.scale)) * 0.5;
    baseGroup.add(chunked('palmBaseRoots' + variant, list, geometry.roots, baseMats.roots, baseMats.rootNm, placeBase, null,
      { depth: baseMats.rootDepth }));
    baseGroup.add(chunked('palmBaseLeaves' + variant, list, geometry.leaves, baseMats.leaves, baseMats.leafNm, placeBase, null,
      { depth: baseMats.leafDepth, boundPad }));
  }
  baseGroup.userData.bases = { total: bases.length, limit: PALM_BASE_LIMIT, variants: baseCounts, loaded: baseLoaded,
    textures: baseMats.textures, rootTextures: palmMats.textures, painted: baseMats.painted, normal: baseMats.normal, cosmetic: true };
  group.add(baseGroup);

  const bushes = map.props.filter((p) => p.kind === 'bush');
  const shrubs = buildShrubs(map), shrubMats = shrubMaterials(assets, swayU);
  const shrubGroup = new THREE.Group(); shrubGroup.name = 'shrubs';
  const shrubLoaded = [], shrubCounts = [], shrubYaw = new THREE.Quaternion(), shrubUp = new THREE.Vector3();
  const placeShrub = (p, m) => {
    q.setFromUnitVectors(up, shrubUp.set(p.nx, p.ny, p.nz));
    shrubYaw.setFromAxisAngle(up, p.rot); q.multiply(shrubYaw);
    m.compose(v.set(p.x, p.y, p.z), q, sc.setScalar(p.scale));
  };
  for (let variant = 0; variant < SHRUB_STYLES.length; variant++) {
    const list = shrubs.filter((p) => p.variant === variant);
    const imported = shrubMats.painted ? loadedShrubGeometry(assets.data(SHRUB_IDS[variant])) : null;
    const geometry = imported || shrubGeometry(variant, { cards: shrubMats.painted });
    if (imported) shrubLoaded.push(SHRUB_IDS[variant]);
    shrubCounts.push({ style: SHRUB_STYLES[variant], count: list.length });
    if (!list.length) { geometry.stems.dispose(); geometry.leaves.dispose(); continue; }
    const boundPad = Math.max(...list.map((p) => p.scale)) * 0.5;
    shrubGroup.add(chunked('shrubStems' + variant, list, geometry.stems, shrubMats.stems, shrubMats.stemNm, placeShrub, null,
      { depth: shrubMats.stemDepth }));
    shrubGroup.add(chunked('shrubLeaves' + variant, list, geometry.leaves, shrubMats.leaves, shrubMats.leafNm, placeShrub, null,
      { depth: shrubMats.leafDepth, boundPad }));
  }
  const replaced = new Set(shrubs.map((p) => p.original).filter(Boolean));
  shrubGroup.userData.shrubs = { total: shrubs.length, limit: SHRUB_LIMIT, replaced: replaced.size,
    scatter: shrubs.length - replaced.size, retained: bushes.length - replaced.size, variants: shrubCounts,
    loaded: shrubLoaded, textures: shrubMats.textures, painted: shrubMats.painted, normal: shrubMats.normal, cosmetic: true };
  group.add(shrubGroup);

  const grass = createGrassPatches(map, { shrubs });
  group.add(grass.group);

  // Keep the original silhouettes at unsafe steep/crowded anchors, preserving visible collider feedback.
  const bushMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'bush', ...BUSH_INK });
  const tint = new THREE.Color();
  for (let variant = 0; variant < 2; variant++) {
    const list = bushes.filter((p) => !replaced.has(p) && (p.v < 0.25 ? 1 : 0) === variant);
    group.add(chunked('bushes' + variant, list, bushGeometry(variant), bushMat, null, (p, m) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(v.set(p.x, p.y - 0.12, p.z), q, sc.setScalar(p.scale));
    }, (p) => tint.setHSL(0.27 + (p.v - 0.5) * 0.06, 0.55, 0.62 + p.v * 0.12).clone(), { castShadow: false }));
  }

  const rockMat = toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'rock', ...ROCK_INK });
  const rockNm = normalMatFor({ occluder: true });
  const allRocks = map.props.filter((p) => p.kind === 'rock');
  const coastSource = assets.data(COAST_ROCK_ID)?.parts?.[0]?.geo;
  const coastRocks = coastSource ? allRocks.filter((p) => isCoastRock(map, p)) : [];
  const coastSet = new Set(coastRocks);
  const rocks = allRocks.filter((p) => !coastSet.has(p));
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

  if (coastRocks.length) {
    const coastMat = toon({ color: 0xffffff, vertexColors: true }, { occluder: true, key: 'coast-rock-v1', ...COAST_ROCK_INK });
    const coastNm = normalMatFor({ occluder: true });
    for (let variant = 0; variant < 3; variant++) {
      const list = coastRocks.filter((p, i) => coastRockVariant(p, i) === variant);
      if (!list.length) continue;
      group.add(chunked('coastRocks' + variant, list, coastRockGeometry(coastSource, variant), coastMat, coastNm, (p, m) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(v.set(p.x, coastRockBase(map, p), p.z), q, sc.setScalar(p.scale));
      }));
    }
  }
  group.userData.coastRocks = { asset: coastRocks.length ? COAST_ROCK_ID : null, count: coastRocks.length, variants: 3 };

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

  // Independent beach silhouettes complement the tiny shells painted in S01's sand albedo.
  const detail = buildBeachDetails(map), detailYaw = new THREE.Quaternion(), detailUp = new THREE.Vector3();
  const detailMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'beach-detail-v1', comic: false });
  const placeDetail = (p, m) => {
    q.setFromUnitVectors(up, detailUp.set(p.nx, p.ny, p.nz));
    detailYaw.setFromAxisAngle(up, p.rot); q.multiply(detailYaw);
    m.compose(v.set(p.x, p.y, p.z), q, sc.setScalar(p.scale));
  };
  const detailGroup = new THREE.Group(); detailGroup.name = 'beachDetails';
  const loaded = [];
  for (let variant = 0; variant < 3; variant++) {
    const source = assets.data(BEACH_SHELL_IDS[variant])?.parts?.[0]?.geo;
    if (source) loaded.push(BEACH_SHELL_IDS[variant]);
    const list = detail.shells.filter((p) => p.variant === variant);
    const shellMat = toon({ color: 0xffffff, vertexColors: true }, { key: 'beach-shell-v1-' + variant, comic: false,
      ...SHELL_PAINT, uniforms: { mnShellOval: { value: variant === 1 ? 1 : 0 } } });
    if (list.length) detailGroup.add(chunked('beachShells' + variant, list, source || shellGeometry(variant), shellMat, null,
      placeDetail, null, { castShadow: false, noOutline: true }));
  }
  if (detail.pebbles.length) {
    const source = assets.data(BEACH_PEBBLES_ID)?.parts?.[0]?.geo;
    if (source) loaded.push(BEACH_PEBBLES_ID);
    detailGroup.add(chunked('beachPebbleClusters', detail.pebbles, source || beachPebbleGeometry(coastSource), detailMat, null,
      placeDetail, null, { castShadow: false, noOutline: true }));
  }
  detailGroup.userData.details = { shells: detail.shells.length, pebbleClusters: detail.pebbles.length,
    loaded, source: 'S04 painted geometry; SM_Rock pebble derivative', cosmetic: true };
  group.add(detailGroup);

  return { group, swayU, grass };
}
