// Three compact tropical shrubs built from woody stems and painted leaf cards.
import * as THREE from 'three';

export const SHRUB_STYLES = ['round', 'low', 'tall'];
export const SHRUB_IDS = SHRUB_STYLES.map((style) => `model:shrub-${style}-v1`);

const FORMS = [
  { height: 1.6, spread: 0.88, stems: 3, leaves: 13, crown: 0.68 },
  { height: 0.9, spread: 0.92, stems: 4, leaves: 14, crown: 0.43 },
  { height: 2.1, spread: 0.82, stems: 3, leaves: 14, crown: 0.82 },
];

function makeGeometry(position, color, uv, flex, paint, indices = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 2));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function stemGeometry(form, variant) {
  const position = [], color = [], uv = [], flex = [], paint = [], indices = [];
  const wood = new THREE.Color(0x86512f), lit = new THREE.Color(0xb7773f), ink = new THREE.Color(0x503525);
  const rings = 6, sides = 6;
  for (let stem = 0; stem < form.stems; stem++) {
    const angle = stem / form.stems * Math.PI * 2 + variant * 0.24;
    const lean = 0.12 + (stem % 2) * 0.06;
    const startRadius = form.spread * (0.16 + (stem % 3) * 0.025);
    const offset = position.length / 3;
    for (let row = 0; row <= rings; row++) {
      const t = row / rings;
      const r = 0.075 * (1 - t * 0.72);
      const cx = Math.cos(angle) * startRadius * (1 - t) + lean * t * t;
      const cz = Math.sin(angle) * startRadius * (1 - t);
      const y = t * (form.height * 0.83);
      for (let side = 0; side <= sides; side++) {
        const a = side / sides * Math.PI * 2;
        position.push(cx + Math.cos(a) * r, y + Math.sin(a) * r, cz + Math.sin(a) * r);
        const shade = side % sides === 0 ? 1.08 : 0.83 + 0.17 * Math.max(0, Math.cos(a - 0.8));
        const c = (row === 0 || row === rings) ? ink : (side % 3 === 0 ? lit : wood);
        color.push(c.r * shade, c.g * shade, c.b * shade);
        uv.push(0.25, 0.25); flex.push(0); paint.push(0, 0);
      }
    }
    const rowSize = sides + 1;
    for (let row = 0; row < rings; row++) for (let side = 0; side < sides; side++) {
      const a = offset + row * rowSize + side, b = a + rowSize;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return makeGeometry(position, color, uv, flex, paint, indices);
}

function leafGeometry(form, variant, cards) {
  const position = [], color = [], uv = [], flex = [], paint = [], indices = [];
  const rows = 4, columns = 2;
  const deep = new THREE.Color(0x47732c), bright = new THREE.Color(0xa5b83b);
  for (let leaf = 0; leaf < form.leaves; leaf++) {
    const angle = leaf / form.leaves * Math.PI * 2 + (leaf % 3) * 0.13 + variant * 0.19;
    const dx = Math.cos(angle), dz = Math.sin(angle), px = -dz, pz = dx;
    const length = form.spread * (0.78 + (leaf % 4) * 0.055);
    const width = length * (0.50 + (leaf % 3) * 0.025);
    const apical = leaf < 3;
    const startY = apical ? form.height * 0.30 : form.height * (0.22 + ((leaf * 7) % form.leaves) / (form.leaves - 1) * 0.60);
    const lift = apical ? form.height * 0.68 : form.height * (0.10 + (leaf % 2) * 0.05);
    const droop = apical ? form.height * 0.08 : form.height * (0.13 + (leaf % 3) * 0.018);
    const start = position.length / 3;
    const tile = (leaf + Math.floor(leaf / 3)) % 4;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const centerX = dx * length * t + 0.1 * Math.sin(Math.PI * t);
      const centerZ = dz * length * t;
      const y = startY + lift * Math.sin(t * Math.PI * 0.76) - droop * t * t;
      const halfWidth = cards ? width : width * Math.pow(Math.sin(Math.PI * t), 0.72);
      for (let col = 0; col <= columns; col++) {
        const across = col / columns * 2 - 1;
        const fold = (1 - Math.abs(across)) * width * 0.12;
        position.push(centerX + px * halfWidth * across, y + fold, centerZ + pz * halfWidth * across);
        const base = deep.clone().lerp(bright, (1 - t) * 0.22 + (leaf % 4) * 0.045);
        const shade = col === 1 ? 1.08 : 0.92;
        color.push(base.r * shade, base.g * shade, base.b * shade);
        const tileX = tile % 2, tileY = Math.floor(tile / 2);
        // UVs keep the full isolated leaf inside its own atlas tile with filtering room.
        const gutter = 8 / 512, span = 240 / 512;
        const baseV = (1 - tileY) * 0.5 + gutter;
        uv.push(tileX * 0.5 + gutter + (col / columns) * span, baseV + t * span);
        flex.push(t);
        paint.push(t, across * 0.5 + 0.5);
      }
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const a = start + row * (columns + 1) + col, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return makeGeometry(position, color, uv, flex, paint, indices);
}

export function shrubGeometry(variant = 0, { cards = true } = {}) {
  if (!Number.isInteger(variant) || variant < 0 || variant >= FORMS.length) throw new Error('Unknown shrub variant');
  const form = FORMS[variant];
  // Cards are always present; the option is accepted to match the foliage geometry API.
  return { stems: stemGeometry(form, variant), leaves: leafGeometry(form, variant, cards) };
}

export function loadedShrubGeometry(data) {
  if (data?.parts?.length !== 2) return null;
  const copies = data.parts.map(({ geo }) => {
    const p = geo?.getAttribute('position'), normal = geo?.getAttribute('normal'), color = geo?.getAttribute('color');
    const uv = geo?.getAttribute('uv'), flex = geo?.getAttribute('_flex'), paint = geo?.getAttribute('_paint');
    if (!p || p.itemSize !== 3 || !normal || normal.itemSize !== 3 || !color || color.itemSize !== 3 ||
        !uv || uv.itemSize !== 2 || !flex || flex.itemSize !== 1 || !paint || paint.itemSize !== 2 ||
        [normal, color, uv, flex, paint].some((attribute) => attribute.count !== p.count) ||
        [p, normal, color, uv, flex, paint].some((attribute) => Array.from(attribute.array).some((value) => !Number.isFinite(value)))) return null;
    const copy = geo.clone();
    copy.setAttribute('aFlex', flex.clone()); copy.setAttribute('aPaint', paint.clone());
    copy.deleteAttribute('_flex'); copy.deleteAttribute('_paint');
    return copy;
  });
  if (copies.some((geometry) => !geometry)) { copies.forEach((geometry) => geometry?.dispose()); return null; }
  return { stems: copies[0], leaves: copies[1] };
}
