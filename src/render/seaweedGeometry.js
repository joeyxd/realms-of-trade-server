// Broad painted seaweed ribbons shaped for readable underwater silhouettes.
import * as THREE from 'three';

export const SEAWEED_STYLES = Object.freeze(['ribbon', 'fork', 'fan']);

const FORMS = [
  { blades: 5, height: 0.88, width: 0.105, spread: 0.31, bend: 0.16 },
  { blades: 5, height: 0.98, width: 0.092, spread: 0.34, bend: 0.19 },
  { blades: 6, height: 0.70, width: 0.135, spread: 0.34, bend: 0.12 },
];

const PALETTES = [
  [0x354b36, 0x66834a, 0xb6b45d],
  [0x244f4b, 0x43877b, 0x8bc39a],
  [0x574a2e, 0x948043, 0xd0bd67],
];

function appendRibbon(data, { angle, rootX, rootZ, height, width, length, bend, style, phase, low }) {
  const { position, color, uv, flex, index } = data;
  const start = position.length / 3;
  const rows = low ? [0, 1] : [0, 0.34, 0.70, 1];
  const directionX = Math.cos(angle), directionZ = Math.sin(angle);
  const sideX = -directionZ, sideZ = directionX;
  const base = new THREE.Color(PALETTES[style][0]);
  const middle = new THREE.Color(PALETTES[style][1]);
  const tip = new THREE.Color(PALETTES[style][2]);

  for (const t of rows) {
    const wave = Math.sin(t * Math.PI * 1.35 + phase) * bend * t;
    const reach = length * t;
    const cx = rootX + directionX * reach + sideX * wave;
    const cz = rootZ + directionZ * reach + sideZ * wave;
    const cy = height * t;
    const halfWidth = width * (1 - 0.80 * t);
    const ridge = 0.026 * Math.sin(Math.PI * t);
    const points = [
      [cx - sideX * halfWidth, cy - ridge * 0.35, cz - sideZ * halfWidth],
      [cx, cy + ridge, cz],
      [cx + sideX * halfWidth, cy - ridge * 0.35, cz + sideZ * halfWidth],
    ];
    const tint = t < 0.54 ? base.clone().lerp(middle, t / 0.54) : middle.clone().lerp(tip, (t - 0.54) / 0.46);
    for (let across = 0; across < 3; across++) {
      const point = points[across];
      position.push(point[0], point[1], point[2]);
      const edgeShade = across === 1 ? 1.08 : 0.62;
      color.push(tint.r * edgeShade, tint.g * edgeShade, tint.b * edgeShade);
      uv.push(across * 0.5, t);
      flex.push(t);
    }
  }

  for (let row = 0; row < rows.length - 1; row++) {
    const a = start + row * 3, b = a + 3;
    // Two painted ribbon facets meet at the raised center ridge.
    index.push(a, b, a + 1, a + 1, b, b + 1);
    index.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

function makeGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(data.flex, 1));
  geometry.setIndex(data.index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Build one stable, painted clump without using or advancing world randomness. */
export function seaweedGeometry(variant = 0, { low = false } = {}) {
  if (!Number.isInteger(variant) || variant < 0 || variant >= FORMS.length) {
    throw new Error('Unknown seaweed variant');
  }
  const form = FORMS[variant];
  const data = { position: [], color: [], uv: [], flex: [], index: [] };
  const bladeCount = low ? Math.min(form.blades, 4) : form.blades;

  for (let blade = 0; blade < bladeCount; blade++) {
    const angle = (blade / bladeCount) * Math.PI * 2 + variant * 0.41 + (blade % 2) * 0.18;
    const rootRadius = 0.035 + (blade % 3) * 0.021;
    const rootX = Math.cos(angle + 0.6) * rootRadius;
    const rootZ = Math.sin(angle + 0.6) * rootRadius;
    const heightFactor = 0.78 + ((blade * 3 + variant) % 5) * 0.055;
    let width = form.width * (0.78 + (blade % 3) * 0.12);
    let length = form.spread * (0.68 + (blade % 4) * 0.095);
    let bladeHeight = form.height * heightFactor;
    let bend = form.bend * (0.72 + (blade % 3) * 0.17);
    if (variant === 2) {
      // The fan keeps its broad leaves lower and sweeps them outward.
      bladeHeight *= 0.76 + (blade % 2) * 0.12;
      length *= 1.16;
      width *= 1.12;
    }
    appendRibbon(data, { angle, rootX, rootZ, height: bladeHeight, width, length, bend,
      style: variant, phase: blade * 0.83, low });
  }

  if (variant === 1 && !low) {
    // Two short fingers split from the outer kelp stalks to give this form a forked silhouette.
    for (let branch = 0; branch < 2; branch++) {
      const angle = branch * Math.PI + 0.5;
      appendRibbon(data, { angle, rootX: Math.cos(angle) * 0.12, rootZ: Math.sin(angle) * 0.12,
        height: 0.48 + branch * 0.08, width: 0.052, length: 0.17, bend: 0.065,
        style: variant, phase: branch * 0.9, low });
    }
  }
  return makeGeometry(data);
}
