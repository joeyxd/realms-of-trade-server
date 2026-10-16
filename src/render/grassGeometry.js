// Small hand-painted grass clumps made from solid, tapered blade strips.
import * as THREE from 'three';

export const GRASS_STYLES = ['tuft', 'fan', 'wild'];

const FORMS = [
  { blades: 7, height: 0.48, length: 0.35, spread: 0.22, fan: 0.58 },
  { blades: 9, height: 0.59, length: 0.44, spread: 0.29, fan: 0.93 },
  { blades: 11, height: 0.68, length: 0.50, spread: 0.34, fan: 1.30 },
];

const PALETTE = [
  [0x315333, 0x66833b, 0xb3b64d],
  [0x38583a, 0x78903d, 0xc3bd55],
  [0x294c38, 0x71863a, 0xb5aa49],
];

function makeGeometry(positions, colors, uvs, flex, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Build one deterministic clump. Variants are stable and do not touch world RNG. */
export function grassGeometry(variant = 0, { low = false } = {}) {
  if (!Number.isInteger(variant) || variant < 0 || variant >= FORMS.length) {
    throw new Error('Unknown grass variant');
  }

  const form = FORMS[variant];
  const positions = [], colors = [], uvs = [], flex = [], indices = [];
  const palette = PALETTE[variant].map((hex) => new THREE.Color(hex));
  const roots = [
    [-0.085, -0.025], [0.065, -0.055], [0.018, 0.085],
  ];

  for (let blade = 0; blade < form.blades; blade++) {
    const root = roots[blade % roots.length];
    const turn = variant * 0.37 + blade * 2.399963229728653;
    const rootAngle = turn + Math.floor(blade / roots.length) * 0.41;
    const rootRadius = 0.018 + (blade % 3) * 0.012;
    const bx = root[0] + Math.cos(rootAngle) * rootRadius;
    const bz = root[1] + Math.sin(rootAngle) * rootRadius;
    const angle = turn + Math.sin(blade * 1.71 + variant) * form.fan * 0.36;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const px = -dz, pz = dx;
    const height = form.height * (0.77 + ((blade * 5 + variant) % 7) * 0.038);
    const length = form.length * (0.70 + ((blade * 3 + variant) % 5) * 0.065);
    const width = 0.026 + (blade % 3) * 0.005;
    const start = positions.length / 3;
    const rows = low
      ? [
        { t: 0, half: width, bend: 0, lift: 0 },
        { t: 1, half: width * 0.055, bend: 0.045 + (blade % 2) * 0.018, lift: 0 },
      ]
      : [
        { t: 0, half: width, bend: 0, lift: 0 },
        { t: 0.53, half: width * 0.69, bend: 0.025 + (blade % 3) * 0.009, lift: (blade % 2 ? 1 : -1) * 0.013 },
        { t: 1, half: width * 0.055, bend: 0.06 + (blade % 3) * 0.015, lift: 0 },
      ];
    const plane = blade % 3;
    const shade = [0.91, 1.03, 0.97][plane];

    for (const row of rows) {
      const cx = bx + dx * length * row.t + px * row.bend;
      const cz = bz + dz * length * row.t + pz * row.bend;
      const y = height * row.t * (0.92 + 0.08 * row.t);
      for (const side of [-1, 1]) {
        positions.push(cx + px * row.half * side, y + row.lift * side, cz + pz * row.half * side);
        const tint = row.t < 0.01 ? 0 : row.t < 0.75 ? 1 : 2;
        const c = palette[tint];
        colors.push(c.r * shade, c.g * shade, c.b * shade);
        uvs.push(side < 0 ? 0 : 1, row.t);
        flex.push(row.t);
      }
    }

    // Each strip section is a pair of non-degenerate triangles.
    for (let row = 0; row < rows.length - 1; row++) {
      const a = start + row * 2, b = a + 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  return makeGeometry(positions, colors, uvs, flex, indices);
}
