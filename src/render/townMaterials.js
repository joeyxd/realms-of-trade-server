// Painted town surfaces share two atlases; unrelated pieces keep their original vertex paint.
import * as THREE from 'three';
import { part } from './geo.js';
import { toon } from './toon.js';

export const TOWN_ALBEDO_ID = 'tex:town-wood-albedo-v1';
export const TOWN_NORMAL_ID = 'tex:town-wood-normal-v1';
export const TOWN_TILES = Object.freeze(['planks', 'patched', 'floor', 'beam', 'timber', 'iron', 'corner', 'door', 'window']);
export const TOWN_NORMAL_STRENGTH = 0.18;
const gutter = 16 / 512;

export function townRect(role) {
  const tile = TOWN_TILES.indexOf(role);
  if (tile < 0) throw new Error('Unknown town surface: ' + role);
  const x = tile % 4, y = Math.floor(tile / 4);
  return { u0: (x + gutter) / 4, u1: (x + 1 - gutter) / 4,
    v0: 1 - (y + 1 - gutter) / 4, v1: 1 - (y + gutter) / 4 };
}

// All members of a merged chunk must have matching attributes, including untextured roof/cloth/metal.
export function townNeutral(geometry) {
  const n = geometry.attributes.position.count;
  if (!geometry.hasAttribute('uv')) {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uv[i * 2] = .875; uv[i * 2 + 1] = .125; }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (!geometry.hasAttribute('aTownWood')) geometry.setAttribute('aTownWood', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geometry;
}

// Planar projection happens before the ordinary part bake, so grain follows each local face.
// Crops use normalized bottom-left image coordinates, identically for albedo and normal.
export function townPart(geometry, color, transform = {}, { mapped = false, role = null,
  crop = [0, 0, 1, 1], longU = false } = {}) {
  if (!mapped) return part(geometry, color, transform);
  if (!role) return townNeutral(part(geometry, color, transform));
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  source.computeBoundingBox();
  const min = source.boundingBox.min.toArray(), max = source.boundingBox.max.toArray(), ext = max.map((x, i) => x - min[i]);
  const p = source.attributes.position, normal = source.attributes.normal, rect = townRect(role);
  const uv = new Float32Array(p.count * 2), mask = new Float32Array(p.count).fill(1);
  for (let i = 0; i < p.count; i++) {
    const xyz = [p.getX(i), p.getY(i), p.getZ(i)], n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    let axis = 0;
    for (let a = 1; a < 3; a++) if (Math.abs(n[a]) > Math.abs(n[axis])) axis = a;
    let ua = axis === 0 ? 2 : 0, va = axis === 1 ? 2 : 1;
    if (longU && ext[va] > ext[ua]) [ua, va] = [va, ua];
    let u = ext[ua] > 1e-8 ? (xyz[ua] - min[ua]) / ext[ua] : .5;
    const v = ext[va] > 1e-8 ? (xyz[va] - min[va]) / ext[va] : .5;
    if ((axis === 2 && n[axis] < 0) || (axis === 0 && n[axis] > 0)) u = 1 - u;
    uv[i * 2] = rect.u0 + (crop[0] + u * (crop[2] - crop[0])) * (rect.u1 - rect.u0);
    uv[i * 2 + 1] = rect.v0 + (crop[1] + v * (crop[3] - crop[1])) * (rect.v1 - rect.v0);
  }
  source.dispose();
  const result = part(geometry, color, transform);
  result.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  result.setAttribute('aTownWood', new THREE.BufferAttribute(mask, 1));
  return result;
}

export function townMaterial(albedo, normal, fallback, ink) {
  if (!albedo) return fallback;
  const mat = toon({ color: 0xffffff, vertexColors: true, map: albedo,
    ...(normal ? { normalMap: normal, normalScale: new THREE.Vector2(TOWN_NORMAL_STRENGTH, TOWN_NORMAL_STRENGTH) } : {}) }, {
    occluder: true, key: 'town-wood-v1', hatchMask: '(1.0 - vTownWood)',
    vertPars: ink.vertPars + 'attribute float aTownWood;\nvarying float vTownWood;\n',
    vertBody: ink.vertBody + 'vTownWood = aTownWood;\n',
    fragPars: ink.fragPars + 'varying float vTownWood;\n',
    albedo: `
      // The supplied paint already includes broad highlights and ink. Avoid a second wood tint/grain.
      if (vTownWood > 0.5) diffuseColor.rgb = texture2D(map, vMapUv).rgb;
      else { ${ink.albedo} }
    `,
  });
  const compile = mat.onBeforeCompile;
  mat.onBeforeCompile = shader => {
    compile(shader);
    // Neutral surfaces retain their geometric lighting; no sampled normal touches cloth or thatch.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      'if (vTownWood > 0.5) {\n#include <normal_fragment_maps>\n}');
  };
  mat.name = 'town:painted-wood';
  mat.userData.townWood = { family: 'town-wood-v1', albedo: TOWN_ALBEDO_ID,
    normal: normal ? TOWN_NORMAL_ID : null, strength: normal ? TOWN_NORMAL_STRENGTH : 0 };
  return mat;
}
