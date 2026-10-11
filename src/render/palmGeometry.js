// Painted palm silhouettes. Local render-only selection leaves world generation and RNG untouched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALM_STYLES = ['tall', 'curved', 'short'];
export const PALM_IDS = PALM_STYLES.map((style) => `model:palm-${style}-v1`);
const FORMS = [
  { height: 6, bend: 0.25, leaves: 9, length: 2.7, width: 0.55, droop: 1.7 },
  { height: 5.7, bend: 1.22, leaves: 10, length: 2.85, width: 0.61, droop: 1.8 },
  { height: 4.2, bend: 0.4, leaves: 11, length: 2.95, width: 0.65, droop: 1.35 },
];

export function palmVariant(prop) {
  // Coordinates survive filtering/reordering of the prop list; no index or world RNG is involved.
  let h = Math.imul(Math.round(prop.x * 100), 73856093) ^ Math.imul(Math.round(prop.z * 100), 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) % 3;
}

function finish(pos, colors, flex, paint, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 2));
  if (indices) g.setIndex(indices);
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function atlasUV(tile, x, y) {
  return [(tile % 2) * 0.5 + 1 / 64 + x * 15 / 32, (tile < 2 ? 0.5 : 0) + 1 / 64 + y * 15 / 32];
}

function trunkGeometry(form) {
  const pos = [], colors = [], flex = [], paint = [], uv = [], indices = [];
  const radial = 7, segments = 12;
  const base = new THREE.Color(0xb8793e), light = new THREE.Color(0xd39b54), ink = new THREE.Color(0x644027);
  // Separate flat-sided blocks with a dark narrow neck and a lit projecting rim.
  for (let s = 0; s < segments; s++) {
    const t0 = s / segments, t1 = (s + 1) / segments;
    const radius = 0.30 * (1 - 0.44 * t0) + (s === 0 ? 0.035 : 0);
    const ringTs = [t0, t0 + 0.018, t1 - 0.015, t1];
    const ringRs = [radius * 0.88, radius * 1.03, radius * 0.98, radius * 0.83];
    for (let k = 0; k < radial; k++) {
      const offset = pos.length / 3, a0 = k * Math.PI * 2 / radial, a1 = (k + 1) * Math.PI * 2 / radial;
      for (let r = 0; r < 4; r++) {
        const t = ringTs[r], c = r === 0 || r === 3 ? ink : r === 1 ? light : base;
        const shade = 0.90 + 0.1 * Math.cos(a0 - 0.8);
        for (const a of [a0, a1]) {
          pos.push(form.bend * t * t + Math.cos(a) * ringRs[r], t * form.height, Math.sin(a) * ringRs[r]);
          colors.push(c.r * shade, c.g * shade, c.b * shade); flex.push(t * t); paint.push(t, a / (Math.PI * 2));
          uv.push(...atlasUV(0, a / (Math.PI * 2), t));
        }
      }
      for (let r = 0; r < 3; r++) { const n = offset + r * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
    }
  }
  const body = finish(pos, colors, flex, paint, indices);
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const parts = [body.toNonIndexed()]; body.dispose();
  const extras = [
    [0.30, form.bend, form.height, 0, 0x65723a],
    [0.25, form.bend + 0.20, form.height - 0.27, 0.13, 0xa5a64c],
    [0.27, form.bend - 0.15, form.height - 0.30, 0.22, 0xc0a252],
    [0.24, form.bend + 0.02, form.height - 0.38, -0.23, 0x8d8e42],
  ];
  for (const [radius, x, y, z, color] of extras) {
    const g = new THREE.IcosahedronGeometry(radius, 0); g.scale(1, 1.25, 1); g.translate(x, y, z);
    const c = new THREE.Color(color), p = g.attributes.position, cs = [], fs = [], ps = [];
    for (let i = 0; i < p.count; i++) { const f = 0.82 + 0.18 * (p.getY(i) - y + radius * 1.25) / (radius * 2.5); cs.push(c.r * f, c.g * f, c.b * f); fs.push(1); ps.push(-1, -1); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3)); g.setAttribute('aFlex', new THREE.Float32BufferAttribute(fs, 1));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(ps, 2));
    const uvs = [];
    for (let i = 0; i < p.count; i++) {
      uvs.push(...atlasUV(3, (p.getX(i) - x + radius) / (2 * radius),
        (p.getY(i) - y + radius * 1.25) / (radius * 2.5)));
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); parts.push(g);
  }
  const merged = mergeGeometries(parts, false); merged.computeBoundingBox(); merged.computeBoundingSphere();
  for (const part of parts) part.dispose();
  return merged;
}

function frondGeometry(form, cards) {
  const pos = [], colors = [], flex = [], paint = [], uv = [], indices = [], rows = 12;
  const green = new THREE.Color(0x718e30), bright = new THREE.Color(0xa6b849), edge = new THREE.Color(0x456729);
  for (let l = 0; l < form.leaves; l++) {
    const a = l / form.leaves * Math.PI * 2 + (l % 2) * 0.11;
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
    const length = form.length * (0.90 + (l % 3) * 0.07), lift = 0.62 + (l % 3) * 0.15;
    const start = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows, width = cards ? form.width : form.width * Math.pow(Math.sin(Math.PI * t), 0.75) + 0.012;
      const y = form.height + t * lift * 1.8 - t * t * (form.droop + lift);
      // Cards follow the supplied alpha silhouette; the no-texture fallback keeps geometric edge cuts.
      for (let k = -1; k <= 1; k++) {
        const cut = !cards && r > 2 && r < rows - 1 && (r + l + (k < 0 ? 1 : 0)) % 3 === 0 ? 0.43 : 1;
        const w = k * width * cut;
        pos.push(form.bend + dx * t * length + sx * w, y + (k === 0 ? width * 0.24 : -width * 0.12), dz * t * length + sz * w);
        const c = k === 0 ? bright : (l % 3 === 0 ? green : edge);
        const f = 1 - t * 0.16; colors.push(c.r * f, c.g * f, c.b * f);
        flex.push(1 + t); paint.push(t, (k + 1) / 2);
        uv.push(...atlasUV(l % 2 ? 2 : 1, (k + 1) / 2, 1 - t));
      }
    }
    for (let r = 0; r < rows; r++) {
      const n = start + r * 3;
      indices.push(n, n + 1, n + 3, n + 1, n + 4, n + 3, n + 1, n + 2, n + 4, n + 2, n + 5, n + 4);
    }
  }
  const g = finish(pos, colors, flex, paint, indices); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}

export function palmGeometry(variant = 0, { cards = false } = {}) {
  const form = FORMS[variant] || FORMS[0];
  return { trunk: trunkGeometry(form), fronds: frondGeometry(form, cards) };
}

// GLTFLoader lowercases custom semantics. Validate both parts before replacing the native family.
export function loadedPalmGeometry(data) {
  if (data?.parts?.length !== 2) return null;
  const parts = data.parts.map(({ geo }) => {
    if (!geo) return null;
    const flex = geo.getAttribute('_flex'), paint = geo.getAttribute('_paint'), p = geo.getAttribute('position');
    if (!p || flex?.count !== p.count || paint?.count !== p.count || flex.itemSize !== 1 || paint.itemSize !== 2 ||
        !geo.getAttribute('normal') || !geo.getAttribute('color') || geo.getAttribute('uv')?.count !== p.count) return null;
    const g = geo.clone(); g.setAttribute('aFlex', flex.clone()); g.setAttribute('aPaint', paint.clone());
    g.deleteAttribute('_flex'); g.deleteAttribute('_paint'); return g;
  });
  if (parts.some((g) => !g)) { parts.forEach((g) => g?.dispose()); return null; }
  return { trunk: parts[0], fronds: parts[1] };
}
