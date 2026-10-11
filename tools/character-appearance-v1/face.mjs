// Face details are separate meshes so appearance choices can be rebuilt independently.
import * as THREE from 'three';
import { frontZ } from '../characters-base-v3/head.mjs';

export const EYE_STYLES = [
  { id: 'neutral', label: 'Serenos' },
  { id: 'keen', label: 'Atentos' },
  { id: 'soft', label: 'Suaves' },
];

export const BROW_STYLES = [
  { id: 'natural', label: 'Naturales' },
  { id: 'bold', label: 'Marcadas' },
  { id: 'arched', label: 'Arqueadas' },
];

export const IRIS_PALETTES = [
  { id: 'amber', label: 'Ámbar', color: '#8A6038' },
  { id: 'sea', label: 'Mar', color: '#477E82' },
  { id: 'leaf', label: 'Oliva', color: '#607747' },
  { id: 'slate', label: 'Gris', color: '#657586' },
];

const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const validId = (list, id, fallback) => list.some(item => item.id === id) ? id : fallback;
const paletteColor = id => IRIS_PALETTES.find(item => item.id === id)?.color ?? IRIS_PALETTES[0].color;

class FaceSurface {
  constructor(name) {
    this.name = name;
    this.positions = [];
    this.colors = [];
    this.uvs = [];
    this.indices = [];
  }

  vertex(x, y, z, color, uv = [0.5, 0.5]) {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.colors.push(...new THREE.Color(color).toArray());
    this.uvs.push(...uv.map(value => clamp(value, 0, 1)));
    return index;
  }

  point(x, y, color, R, kind, offset, uv) {
    return this.vertex(x, R.neck + y, frontZ(x, y, kind) + offset, color, uv);
  }

  // Filled rings keep disks well shaped and avoid the pinched UVs of a single center fan.
  disk(cx, cy, rx, ry, color, R, kind, offset, { almond = false, segments = 24 } = {}) {
    const rings = [];
    for (const scale of [0.52, 1]) {
      const ring = [];
      for (let i = 0; i < segments; i++) {
        const angle = TAU * i / segments;
        const unitX = Math.cos(angle);
        const unitY = Math.sin(angle);
        const x = cx + rx * scale * unitX;
        const almondFactor = almond ? Math.pow(Math.max(0, 1 - unitX * unitX), 0.38) : 1;
        const y = cy + ry * scale * unitY * almondFactor;
        ring.push(this.point(x, y, color, R, kind, offset, [0.5 + (x - cx) / (2 * rx), 0.5 + (y - cy) / (2 * ry)]));
      }
      rings.push(ring);
    }
    const center = this.point(cx, cy, color, R, kind, offset, [0.5, 0.5]);
    const first = rings[0];
    for (let i = 0; i < segments; i++) this.indices.push(center, first[i], first[(i + 1) % segments]);
    for (let r = 0; r < rings.length - 1; r++) {
      const inner = rings[r], outer = rings[r + 1];
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        this.indices.push(inner[i], outer[i], outer[next], inner[i], outer[next], inner[next]);
      }
    }
  }

  eyePatch(cx, cy, halfWidth, halfHeight, style, side, margin, color, R, kind, offset) {
    const halfW = halfWidth + margin;
    const halfH = halfHeight + margin;
    const upper = [], lower = [];
    const points = 24;
    for (let i = 0; i <= points; i++) {
      const dx = (1 - i / points * 2) * halfW;
      const profile = eyeProfile(style, halfW, halfH, side, dx);
      upper.push([dx, profile.upper]);
    }
    // Omit the shared corner points so the closed outline contains no zero-length edges.
    for (let i = 1; i < points; i++) {
      const dx = (i / points * 2 - 1) * halfW;
      const profile = eyeProfile(style, halfW, halfH, side, dx);
      lower.push([dx, profile.lower]);
    }
    const boundary = [...upper, ...lower];
    const rings = [];
    for (const scale of [0.5, 1]) {
      rings.push(boundary.map(([dx, dy]) => this.point(
        cx + dx * scale,
        cy + dy * scale,
        color,
        R,
        kind,
        offset,
        [0.5 + dx * scale / (2 * halfW), 0.5 + dy * scale / (2 * halfH)],
      )));
    }
    const center = this.point(cx, cy, color, R, kind, offset, [0.5, 0.5]);
    const count = boundary.length;
    for (let i = 0; i < count; i++) this.indices.push(center, rings[0][i], rings[0][(i + 1) % count]);
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      // The outline travels counter-clockwise in XY, so these faces point toward +Z.
      this.indices.push(rings[0][i], rings[1][i], rings[1][next]);
      this.indices.push(rings[0][i], rings[1][next], rings[0][next]);
    }
  }

  ribbon(points, halfWidth, color, R, kind, offset, uvMap = null) {
    const ids = [];
    for (const [x, y] of points) {
      for (const sign of [-1, 1]) {
        const py = y + sign * halfWidth;
        const uv = uvMap ? uvMap(x, py) : [0.5 + x * 2, (0.314 - py) / 0.326];
        ids.push(this.point(x, py, color, R, kind, offset, uv));
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2;
      this.indices.push(ids[a], ids[a + 2], ids[a + 3], ids[a], ids[a + 3], ids[a + 1]);
    }
  }

  geometry() {
    const count = this.positions.length / 3;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      skinIndex[i * 4] = 8;
      skinWeight[i * 4] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.name = this.name;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

function eyeProfile(style, halfWidth, halfHeight, side, dx) {
  const u = dx / halfWidth;
  const edge = Math.max(0, 1 - u * u);
  const tilt = side * dx * 0.045 * edge;
  if (style === 'keen') {
    return { upper: halfHeight * (0.91 * edge + 0.13 * side * u * Math.sqrt(edge)) + tilt, lower: -halfHeight * (0.57 * edge) + tilt };
  }
  if (style === 'soft') {
    return { upper: halfHeight * 0.87 * Math.sqrt(edge) + 0.00025, lower: -halfHeight * 0.78 * Math.sqrt(edge) + tilt };
  }
  return { upper: halfHeight * edge + tilt, lower: -halfHeight * 0.70 * edge + tilt };
}

function appendEyes(surface, kind, R, style, iris) {
  const female = kind === 'female';
  const white = '#D9CDB9';
  const scleraRim = '#49392F';
  const lidUpper = '#513B31';
  const lidLower = '#916B53';
  const irisTint = paletteColor(iris);
  const halfWidth = female ? 0.0245 : 0.0235;
  const halfHeight = female ? 0.0102 : 0.0094;
  const irisRx = female ? 0.0082 : 0.0076;
  const irisOffsetY = -0.00025;

  for (const side of [-1, 1]) {
    const cx = side * 0.041;
    const cy = 0.173;
    const upper = [], lower = [];
    for (let i = 0; i <= 20; i++) {
      const dx = (i / 20 * 2 - 1) * halfWidth;
      const profile = eyeProfile(style, halfWidth, halfHeight, side, dx);
      upper.push([cx + dx, cy + profile.upper]);
      lower.push([cx + dx, cy + profile.lower]);
    }

    // Both sclera boundaries share the selected lid profile; the rim adds only a narrow margin.
    surface.eyePatch(cx, cy, halfWidth, halfHeight, style, side, 0.0010, scleraRim, R, kind, 0.0034);
    surface.eyePatch(cx, cy, halfWidth, halfHeight, style, side, 0, white, R, kind, 0.0044);

    // Fit the iris to the narrowest opening across its width so neither iris nor pupil crosses a lid.
    const irisRx = female ? 0.0074 : 0.0068;
    const irisCx = cx - side * 0.0007;
    const irisCy = cy + irisOffsetY;
    let irisRy = Infinity;
    for (let i = 0; i <= 12; i++) {
      const dx = (i / 12 * 2 - 1) * irisRx + (irisCx - cx);
      const opening = eyeProfile(style, halfWidth, halfHeight, side, dx);
      irisRy = Math.min(irisRy, opening.upper - irisOffsetY, irisOffsetY - opening.lower);
    }
    irisRy = Math.max(0.001, irisRy * 0.68);
    surface.disk(irisCx, irisCy, irisRx, irisRy, irisTint, R, kind, 0.0060);
    surface.disk(irisCx, irisCy, irisRx * 0.47, irisRy * 0.76, '#292724', R, kind, 0.0070);
    surface.disk(irisCx - irisRx * 0.30, irisCy + irisRy * 0.28, irisRx * 0.12, irisRy * 0.15, '#F4E8D7', R, kind, 0.0080, { segments: 16 });

    // Both lids ride above the sculpted relief and trace the eye opening edges.
    surface.ribbon(upper, female ? 0.0011 : 0.0010, lidUpper, R, kind, 0.0080);
    surface.ribbon(lower, 0.00055, lidLower, R, kind, 0.0070);
  }
}

function appendBrows(surface, kind, R, style, hairColor) {
  const female = kind === 'female';
  for (const side of [-1, 1]) {
    const cx = side * 0.041;
    const points = [];
    const halfWidth = style === 'bold' ? 0.027 : 0.026;
    for (let i = 0; i <= 16; i++) {
      const dx = (i / 16 * 2 - 1) * halfWidth;
      const u = dx / halfWidth;
      const arch = style === 'arched' ? 0.0040 * (1 - u * u) : 0.0025 * (1 - u * u);
      const y = 0.201 + arch + side * dx * 0.07;
      points.push([cx + dx, y]);
    }
    const width = style === 'bold' ? (female ? 0.0032 : 0.0040) : (female ? 0.0020 : 0.0025);
    surface.ribbon(points, width, hairColor, R, kind, 0.0030);
  }
}

function appendAccents(surface, kind, R) {
  for (const side of [-1, 1]) {
    const nostril = [];
    for (let i = 0; i <= 8; i++) {
      const t = side < 0 ? 1 - i / 8 : i / 8;
      nostril.push([side * (0.009 + t * 0.0096), 0.116 - 0.0016 * Math.sin(t * Math.PI)]);
    }
    surface.ribbon(nostril, 0.00065, '#8F5E48', R, kind, 0.0032);
  }

  const halfMouth = kind === 'female' ? 0.030 : 0.033;
  const mouth = [];
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24 - 0.5) * halfMouth * 2;
    const y = 0.072 + (kind === 'female' ? 0.0024 : 0.0015) * Math.cos(x / halfMouth * Math.PI);
    mouth.push([x, y]);
  }
  surface.ribbon(mouth, 0.00075, '#825F4E', R, kind, 0.0040);
}

export function createFace(kind, R, { eyes = 'neutral', brows = 'natural', iris = 'amber', hairColor = '#65452F' } = {}) {
  if (kind !== 'male' && kind !== 'female') throw new TypeError(`Unknown character kind: ${kind}`);
  if (!R || !Number.isFinite(R.neck)) throw new TypeError('R.neck must be finite');
  const eyeStyle = validId(EYE_STYLES, eyes, 'neutral');
  const browStyle = validId(BROW_STYLES, brows, 'natural');
  const irisStyle = validId(IRIS_PALETTES, iris, 'amber');
  const safeHairColor = new THREE.Color(hairColor);

  const eyeSurface = new FaceSurface('face_eyes');
  const browSurface = new FaceSurface('face_brows');
  const accentSurface = new FaceSurface('face_accents');
  appendEyes(eyeSurface, kind, R, eyeStyle, irisStyle);
  appendBrows(browSurface, kind, R, browStyle, `#${safeHairColor.getHexString()}`);
  appendAccents(accentSurface, kind, R);

  return { eyes: eyeSurface.geometry(), brows: browSurface.geometry(), accents: accentSurface.geometry() };
}
