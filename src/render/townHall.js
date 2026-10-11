// A port-facing landmark dresses one existing hut without changing its ground footprint.
import * as THREE from 'three';
import { bbox, cyl, part, merge, canvasTexture } from './geo.js';
import { townPart } from './townMaterials.js';
import { toon } from './toon.js';

export function selectTownHall(map) {
  const port = map.dock?.base;
  if (!port) return null;
  let selected = null, nearest = Infinity;
  for (const hut of map.props) {
    if (hut.kind !== 'hut') continue;
    const dx = port.x - hut.x, dz = port.z - hut.z, distance = Math.hypot(dx, dz);
    // Prefer an existing door that already faces the arrival route; do not rotate or move the house.
    if (distance < 1e-6 || (Math.sin(hut.rot) * dx + Math.cos(hut.rot) * dz) / distance < .35) continue;
    if (distance < nearest) { nearest = distance; selected = hut; }
  }
  return selected;
}

export function townHallSupportsGeometry() {
  const pieces = [], source = [];
  const P = (geometry, color, transform, role = null) => {
    source.push(geometry);
    const result = townPart(geometry, color, transform, { mapped: true, role });
    pieces.push(result);
  };
  // All attachments sit above the doorway, within the existing roof overhang.
  for (const x of [-1.48, 1.48]) {
    P(bbox(.12, 1.48, .12), 0x8a5a2e, { pos: [x, 4.10, 2.70] }, 'timber');
    P(bbox(.12, .12, 1.23), 0x8a5a2e, { pos: [x, 4.76, 2.14] }, 'beam');
  }
  P(cyl(.07, .07, 3.14, 8), 0x8a5a2e, { pos: [0, 4.79, 2.72], rot: [0, 0, Math.PI / 2] }, 'beam');
  P(cyl(.055, .085, 2.05, 8), 0x8a5a2e, { pos: [0, 6.14, 0] }, 'timber');
  P(cyl(.11, .11, .10, 8), 0x3b2b24, { pos: [0, 7.19, 0] });
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([.07, 7.04, 0, 1.08, 6.82, .08, .07, 6.57, 0], 3));
  pennant.computeVertexNormals();
  // Two wound faces keep the opaque pennant readable from either side in the chunk's single-sided material.
  const back = pennant.clone();
  back.setAttribute('position', new THREE.Float32BufferAttribute([.07, 6.57, 0, 1.08, 6.82, .08, .07, 7.04, 0], 3));
  back.computeVertexNormals();
  for (const geometry of [pennant, back]) {
    source.push(geometry); pieces.push(part(geometry, 0xb7362e, {}));
    // Neutral atlas coordinates preserve native red paint.
    const last = pieces.at(-1), n = last.attributes.position.count;
    last.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(.875), 2));
    last.setAttribute('aTownWood', new THREE.BufferAttribute(new Float32Array(n), 1));
  }
  const geometry = merge(pieces);
  // The port-facing doorway stays untouched; the adjacent roof side reads in the usual isometric view.
  geometry.rotateY(-Math.PI / 2); geometry.computeBoundingSphere();
  for (const item of new Set([...pieces, ...source])) item.dispose();
  geometry.userData.townHall = { family: 'town-hall-v1', kind: 'supports', texturesDownloaded: 0 };
  return geometry;
}

export function townHallBannerGeometry() {
  const geometry = new THREE.PlaneGeometry(2.82, 1.36, 12, 3), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), hanging = (.68 - y) / 1.36;
    p.setXYZ(i, x, y + 4.06 - .035 * Math.cos(x * 4) * hanging,
      2.77 + .04 * Math.sin(x * 7) * hanging);
  }
  geometry.computeVertexNormals(); geometry.rotateY(-Math.PI / 2); geometry.computeBoundingSphere();
  geometry.userData.townHall = { family: 'town-hall-v1', kind: 'banner', static: true };
  return geometry;
}

export function townHallBannerTexture() {
  const texture = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#a7352c'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#bd4735'; ctx.fillRect(9, 9, s - 18, s - 18);
    ctx.strokeStyle = '#4b241f'; ctx.lineWidth = 5; ctx.strokeRect(7, 7, s - 14, s - 14);
    ctx.strokeStyle = '#dfad77'; ctx.lineWidth = 2;
    for (const x of [13, s - 13]) { ctx.beginPath(); ctx.moveTo(x, 17); ctx.lineTo(x, s - 17); ctx.stroke(); }
    // Cream nautical emblem, separated from the lettering for readability at game camera distance.
    ctx.strokeStyle = '#ffe2a6'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(53, 78, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(53, 90); ctx.lineTo(53, 178); ctx.moveTo(32, 112); ctx.lineTo(74, 112); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, 150); ctx.quadraticCurveTo(53, 208, 82, 150); ctx.stroke();
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    for (const [text, y] of [['SALTY', 107], ['SHORE', 161]]) {
      ctx.font = '900 41px Arial, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#4b241f';
      ctx.strokeText(text, 166, y, 143); ctx.fillStyle = '#ffe2a6'; ctx.fillText(text, 166, y, 143);
    }
    ctx.strokeStyle = '#dfad77'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(105, 186); ctx.lineTo(233, 186); ctx.stroke();
  });
  texture.name = 'town-hall:salty-shore-banner';
  return texture;
}

export function townHallBannerMaterial() {
  const material = toon({ color: 0xffffff, map: townHallBannerTexture(), side: THREE.DoubleSide },
    { occluder: true, key: 'town-hall-banner-v1', hatchMask: '0.0' });
  material.name = 'town:salty-shore-banner';
  material.userData.townHall = { family: 'town-hall-v1', canvas: [256, 256], texturesDownloaded: 0 };
  return material;
}
