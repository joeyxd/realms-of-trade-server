// Painted fixtures reuse the town samplers; lettering is a small generated canvas, not a download.
import * as THREE from 'three';
import { part, merge, rbox, bbox, cyl, cone, canvasTexture } from './geo.js';
import { townPart, townRect, TOWN_NORMAL_STRENGTH } from './townMaterials.js';
import { toon } from './toon.js';

export function townLanternGeometry(mapped = false) {
  const P = (g, color, transform, role) => townPart(g, color, transform, { mapped, role });
  const pieces = [
    P(cyl(.07, .09, 2.2, 6), 0x8a5a2e, { pos: [0, 1.1, 0] }, 'timber'),
    P(rbox(.5, .06, .06, .02), 0x8a5a2e, { pos: [.2, 2.15, 0] }, 'beam'),
    P(rbox(.34, .06, .34, .02), 0x3a2a20, { pos: [.42, 1.95, 0] }),
    P(cone(.24, .18, 4), 0x3a2a20, { pos: [.42, 2.07, 0], rot: [0, Math.PI / 4, 0] }),
  ];
  if (mapped) {
    // Opaque corner bars leave the existing emissive glass visible. No alpha sorting or new pass.
    for (const x of [-.145, .145]) for (const z of [-.145, .145])
      pieces.push(P(bbox(.035, .30, .035), 0x302820, { pos: [.42 + x, 1.78, z] }));
    pieces.push(P(bbox(.34, .05, .34), 0x3a2a20, { pos: [.42, 1.605, 0] }));
    pieces.push(P(cyl(.025, .025, .09, 5), 0x302820, { pos: [.42, 2.155, 0] }));
  }
  const geometry = merge(pieces);
  for (const piece of pieces) piece.dispose();
  geometry.userData.townFixtures = { family: 'town-fixtures-v1', kind: 'lantern', mapped,
    addedTriangles: mapped ? 80 : 0, texturesDownloaded: 0 };
  return geometry;
}

export function townSignPostGeometry(mapped = false) {
  return townPart(cyl(.08, .1, 2.2, 6), 0x8a5a2e, { pos: [0, 1.1, 0] }, { mapped, role: 'timber' });
}

export function townSignGeometry(cala = false) {
  const box = bbox(1.5, cala ? 1.45 : 1.1, .1), source = box.toNonIndexed();
  box.dispose();
  // Put the plank in front of the round post; the authored prop placement and collider stay unchanged.
  source.translate(0, 0, .16);
  const uv = source.attributes.uv, normals = source.attributes.normal;
  const ink = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    ink[i * 3] = uv.getX(i); ink[i * 3 + 1] = uv.getY(i);
    ink[i * 3 + 2] = normals.getZ(i) > .5 ? 1 : 0;
  }
  const geometry = townPart(source, 0xffffff, {}, { mapped: true, role: 'planks' });
  // The supplied plank painting has vertical grain: rotate its UV crop by a quarter turn.
  const rect = townRect('planks'), mappedUv = geometry.attributes.uv;
  for (let i = 0; i < mappedUv.count; i++) {
    const u = (mappedUv.getX(i) - rect.u0) / (rect.u1 - rect.u0);
    const v = (mappedUv.getY(i) - rect.v0) / (rect.v1 - rect.v0);
    mappedUv.setXY(i, rect.u0 + v * (rect.u1 - rect.u0), rect.v0 + (1 - u) * (rect.v1 - rect.v0));
  }
  geometry.setAttribute('aSignInk', new THREE.BufferAttribute(ink, 3));
  geometry.userData.townFixtures = { family: 'town-fixtures-v1', kind: 'sign', cala };
  return geometry;
}

export function townSignInk(cala = false) {
  const texture = canvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = '#342318'; ctx.lineWidth = 9; ctx.strokeRect(6, 6, s - 12, s - 12);
    for (const x of [17, s - 17]) for (const y of [17, s - 17]) {
      ctx.fillStyle = '#2d251e'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const label = (text, y, size, color = '#ffe5ad') => {
      ctx.font = `900 ${size}px Arial, sans-serif`; ctx.lineWidth = 4; ctx.strokeStyle = '#342318';
      ctx.strokeText(text, s / 2, y, s - 34); ctx.fillStyle = color; ctx.fillText(text, s / 2, y, s - 34);
    };
    if (cala) {
      label('CALA', 55, 40); label('CALAVERA', 100, 36);
      ctx.fillStyle = '#ffe5ad'; ctx.beginPath(); ctx.arc(128, 145, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(113, 152, 30, 21); ctx.fillStyle = '#342318';
      for (const x of [120, 136]) { ctx.beginPath(); ctx.arc(x, 144, 5, 0, Math.PI * 2); ctx.fill(); }
      label('SIN LEY →', 222, 30, '#ffad84');
    } else {
      label('LA', 61, 38); label('CALDERA', 111, 42); label('↑', 219, 92);
    }
  });
  texture.name = cala ? 'town-sign:cala-ink' : 'town-sign:caldera-ink';
  return texture;
}

export function townSignMaterial(albedo, normal, ink) {
  const material = toon({ color: 0xffffff, map: albedo,
    ...(normal ? { normalMap: normal, normalScale: new THREE.Vector2(TOWN_NORMAL_STRENGTH, TOWN_NORMAL_STRENGTH) } : {}) }, {
    key: 'town-sign-v1', hatchMask: '0.0',
    uniforms: { mnSignInk: { value: ink } },
    vertPars: 'attribute vec3 aSignInk; varying vec3 vSignInk;\n',
    vertBody: 'vSignInk = aSignInk;\n',
    fragPars: 'uniform sampler2D mnSignInk; varying vec3 vSignInk;\n',
    albedo: `vec4 letters = texture2D(mnSignInk, vSignInk.xy);
      diffuseColor.rgb = mix(diffuseColor.rgb, letters.rgb, letters.a * vSignInk.z);`,
  });
  material.name = 'town:painted-sign';
  material.userData.townFixtures = { family: 'town-fixtures-v1', ink, normalStrength: normal ? TOWN_NORMAL_STRENGTH : 0 };
  return material;
}
