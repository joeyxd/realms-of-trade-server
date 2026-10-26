// Small opaque furniture shares the town paint; tool metal retains its vertex colour.
import * as THREE from 'three';
import { bbox, cyl, merge } from './geo.js';
import { toon } from './toon.js';
import { townPart, TOWN_NORMAL_STRENGTH } from './townMaterials.js';

export function townWorkbenchGeometry() {
  const pieces = [];
  const add = (geometry, colour, transform, role = null, options = {}) => {
    pieces.push(townPart(geometry, colour, transform, { mapped: true, role, ...options }));
    geometry.dispose();
  };
  // Four separated boards, a lower shelf and braced legs read clearly from the game camera.
  for (let i = 0; i < 4; i++) add(bbox(1.48, .09, .16), 0xb5803f,
    { pos: [0, .72, -.255 + i * .17] }, 'floor', { crop: [0, i / 4, 1, (i + 1) / 4], longU: true });
  for (const x of [-.60, .60]) for (const z of [-.25, .25])
    add(bbox(.13, .675, .13), 0x8a5a2e, { pos: [x, .3375, z] }, 'timber');
  for (const z of [-.26, .26]) add(bbox(1.31, .12, .07), 0x8a5a2e,
    { pos: [0, .59, z] }, 'beam', { longU: true });
  for (const x of [-.60, .60]) add(bbox(.08, .08, .56), 0x8a5a2e,
    { pos: [x, .24, 0] }, 'beam', { longU: true });
  add(bbox(1.20, .05, .39), 0xb5803f, { pos: [0, .26, 0] }, 'floor', { longU: true });
  // A compact vise and a laid-down hammer are silhouettes, with no extra meshes or textures.
  add(bbox(.22, .065, .20), 0x41424a, { pos: [.46, .7975, .15] });
  add(bbox(.17, .15, .09), 0x515461, { pos: [.46, .895, .13] });
  add(bbox(.17, .095, .055), 0x33353e, { pos: [.46, .9225, .245] });
  add(cyl(.022, .022, .22, 6), 0x626574,
    { pos: [.46, .86, .265], rot: [Math.PI / 2, 0, 0] });
  add(cyl(.014, .014, .16, 6), 0x41424a, { pos: [.46, .86, .37] });
  add(bbox(.32, .035, .04), 0x8a5a2e, { pos: [-.24, .79, -.08], rot: [0, -.28, 0] }, 'beam', { longU: true });
  add(bbox(.085, .075, .19), 0x4a4e5b, { pos: [-.395, .8125, -.035], rot: [0, -.28, 0] });
  add(bbox(.31, .035, .13), 0xd6a565, { pos: [-.16, .80, .20], rot: [0, .17, 0] }, 'floor', { longU: true });
  const result = merge(pieces);
  pieces.forEach(piece => piece.dispose());
  result.userData.townFurniture = { family: 'town-furniture-v1', kind: 'workbench', texturesAdded: 0 };
  return result;
}

export function townFurnitureMaterial(albedo, normal) {
  if (!albedo) return null;
  const mat = toon({ color: 0xffffff, vertexColors: true, map: albedo,
    ...(normal ? { normalMap: normal, normalScale: new THREE.Vector2(TOWN_NORMAL_STRENGTH, TOWN_NORMAL_STRENGTH) } : {}) }, {
    comic: false, key: 'town-furniture-v1',
    vertPars: 'attribute float aTownWood;\nvarying float vTownWood;\n',
    vertBody: 'vTownWood = aTownWood;\n',
    fragPars: 'varying float vTownWood;\n',
    albedo: 'if (vTownWood > 0.5) diffuseColor.rgb = texture2D(map, vMapUv).rgb;',
  });
  const compile = mat.onBeforeCompile;
  mat.onBeforeCompile = shader => {
    compile(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      'if (vTownWood > 0.5) {\n#include <normal_fragment_maps>\n}');
  };
  mat.name = 'town:workbench';
  mat.userData.townFurniture = { family: 'town-furniture-v1', normalStrength: normal ? TOWN_NORMAL_STRENGTH : 0 };
  return mat;
}
