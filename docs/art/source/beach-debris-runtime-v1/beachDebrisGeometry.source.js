import * as THREE from 'three';

export const DEBRIS_STYLES = Object.freeze(['branch', 'log', 'planks']);
export const DEBRIS_IDS = Object.freeze(DEBRIS_STYLES.map((style) => `model:beach-debris-${style}-v1`));

const palette = {
  heart: new THREE.Color(0xb69264),
  light: new THREE.Color(0xd2b586),
  shadow: new THREE.Color(0x806344),
  bark: new THREE.Color(0x574332),
  end: new THREE.Color(0xe1c69a),
  algae: new THREE.Color(0x77734b),
};

// A small flat-shaded mesh assembler. Each section is an octagonal, beveled
// wood cross-section; changing centers makes the long forms visibly crooked.
function createAssembler() {
  const positions = [], colors = [], indices = [];
  function segment(sections, { sides = 8, tint = 0, endGrain = false } = {}) {
    const start = positions.length / 3;
    for (let r = 0; r < sections.length; r++) {
      const section = sections[r];
      const tangent = new THREE.Vector3();
      const before = sections[Math.max(0, r - 1)].center;
      const after = sections[Math.min(sections.length - 1, r + 1)].center;
      tangent.subVectors(after, before).normalize();
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0);
      let u = new THREE.Vector3(0, 1, 0).cross(tangent);
      if (u.lengthSq() < 1e-5) u.set(1, 0, 0).cross(tangent);
      u.normalize();
      const v = tangent.clone().cross(u).normalize();
      for (let s = 0; s < sides; s++) {
        const a = Math.PI * 2 * s / sides + Math.PI / 8;
        const bevel = (s % 2 === 0) ? 0.88 : 1;
        const p = section.center.clone()
          .addScaledVector(u, Math.cos(a) * section.width * bevel)
          .addScaledVector(v, Math.sin(a) * section.height * bevel);
        positions.push(p.x, p.y, p.z);
        let c = (s % 4 === 0) ? palette.shadow : (s % 3 === 0 ? palette.light : palette.heart);
        if (r === 0 || r === sections.length - 1) c = endGrain ? palette.end : palette.shadow;
        if (tint) c = c.clone().lerp(palette.bark, tint);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < sections.length - 1; r++) for (let s = 0; s < sides; s++) {
      const a = start + r * sides + s, b = start + r * sides + (s + 1) % sides;
      const c = a + sides, d = b + sides;
      indices.push(a, b, c, b, d, c);
    }
    // Flat cut faces with a fan; slightly varied end colors read as end grain.
    for (const row of [0, sections.length - 1]) {
      const center = sections[row].center;
      const ci = positions.length / 3;
      positions.push(center.x, center.y, center.z);
      const color = endGrain ? palette.end : palette.shadow;
      colors.push(color.r, color.g, color.b);
      const base = start + row * sides;
      for (let s = 0; s < sides; s++) {
        if (row === 0) indices.push(ci, base + (s + 1) % sides, base + s);
        else indices.push(ci, base + s, base + (s + 1) % sides);
      }
    }
  }
  return { positions, colors, indices, segment };
}

function woodSection(x, y, z, width, height = width) {
  return { center: new THREE.Vector3(x, y, z), width, height };
}

function branchMesh(variant) {
  const a = createAssembler(), sway = (variant % 3) * 0.035;
  // A grounded crooked fork: a main limb plus two raised, tapered offshoots.
  a.segment([
    woodSection(-0.54, 0.09, -0.05, 0.075), woodSection(-0.22, 0.12, 0.02, 0.068),
    woodSection(0.12, 0.16, 0.08, 0.052), woodSection(0.50, 0.20, 0.14, 0.026),
  ], { endGrain: true });
  a.segment([
    woodSection(-0.18, 0.13, 0.02, 0.055), woodSection(-0.28, 0.22, -0.01, 0.041),
    woodSection(-0.46, 0.32, 0.01 + sway, 0.017),
  ], { endGrain: true });
  a.segment([
    woodSection(0.15, 0.16, 0.08, 0.045), woodSection(0.30, 0.27, 0.05, 0.031),
    woodSection(0.45, 0.38, 0.03 + sway, 0.014),
  ], { endGrain: true });
  // Bark scars as short, dark raised slivers attached to the main limb.
  for (let i = 0; i < 3; i++) {
    const x = -0.36 + i * 0.26;
    a.segment([woodSection(x, 0.17, 0.11, 0.012, 0.035), woodSection(x + 0.055, 0.18, 0.105, 0.009, 0.024)], { sides: 4, tint: 0.62 });
  }
  return finish(a);
}

function logMesh(variant) {
  const a = createAssembler(), bend = (variant % 2) * 0.035;
  a.segment([
    woodSection(-0.47, 0.13, 0, 0.15, 0.12),
    woodSection(-0.20, 0.15, 0.015, 0.155, 0.125),
    woodSection(0.12, 0.17, bend, 0.14, 0.115),
    woodSection(0.43, 0.16, 0.025, 0.12, 0.10),
  ], { sides: 8, endGrain: true });
  // Two shallow bark seams on the upper side, still part of the same mesh.
  for (let i = 0; i < 2; i++) {
    const x = -0.18 + i * 0.28;
    a.segment([woodSection(x, 0.275, -0.07, 0.014, 0.018), woodSection(x + 0.12, 0.27, -0.06, 0.01, 0.014)], { sides: 4, tint: 0.65 });
  }
  return finish(a);
}

function plankMesh(variant) {
  const a = createAssembler(), turn = 0.08 + (variant % 2) * 0.035;
  // Two overlapping weathered boards with tapered, chipped ends.
  for (let plank = 0; plank < 2; plank++) {
    const z = plank === 0 ? -0.12 : 0.13;
    const y = plank === 0 ? 0.095 : 0.145;
    const dx = plank === 0 ? 0 : 0.07;
    const angle = plank === 0 ? -turn : turn;
    const board = (x, yy, zz, w, h) => woodSection(x * Math.cos(angle) + zz * Math.sin(angle), yy,
      -x * Math.sin(angle) + zz * Math.cos(angle), w, h);
    a.segment([
      board(-0.48 + dx, y, z, 0.11, 0.035),
      board(-0.28 + dx, y + 0.006, z, 0.12, 0.043),
      board(0.04 + dx, y + 0.01, z, 0.115, 0.04),
      board(0.32 + dx, y + 0.005, z, 0.105, 0.035),
      board(0.49 + dx, y + 0.014, z - 0.025, 0.055, 0.025),
    ], { sides: 8, endGrain: true });
    // Narrow dark grain seams run with the board and add a drawn illustration feel.
    const zz = z - 0.045;
    a.segment([
      board(-0.27 + dx, y + 0.046, zz, 0.008, 0.005),
      board(0.02 + dx, y + 0.05, zz, 0.006, 0.004),
    ], { sides: 4, tint: 0.58 });
  }
  return finish(a);
}

function finish(a) {
  const minY = Math.min(...a.positions.filter((_, i) => i % 3 === 1));
  for (let i = 0; i < a.positions.length; i += 3) {
    a.positions[i] *= 1.8;
    a.positions[i + 1] -= minY;
    a.positions[i + 2] *= 1.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(a.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(a.colors, 3));
  geometry.setIndex(a.indices);
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) { minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i)); }
  const spanX = Math.max(1e-5, maxX - minX), uv = new Float32Array(pos.count * 2);
  const colors = geometry.getAttribute('color');
  const base = new THREE.Color(), dark = new THREE.Color(0x55412f), pale = new THREE.Color(0xd8bd8e);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - minX) / spanX;
    uv[i * 2 + 1] = pos.getZ(i);
    base.fromArray(colors.array, i * 3);
    const underside = THREE.MathUtils.smoothstep(-normal.getY(i), 0.12, 0.9);
    const edgeFacet = Math.max(0, Math.abs(normal.getX(i)) - 0.5) * 0.12;
    base.lerp(dark, underside * 0.38 + edgeFacet);
    base.lerp(pale, THREE.MathUtils.smoothstep(normal.getY(i), 0.42, 0.9) * 0.13);
    base.toArray(colors.array, i * 3);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  colors.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function debrisGeometry(variant = 0, source = null) {
  // Accept a source mesh for the log style when its export is supplied; keep
  // local illustration geometry as the reliable fallback for every style.
  if (!Number.isInteger(variant) || variant < 0 || variant >= DEBRIS_STYLES.length) throw new Error('Unknown beach debris style');
  const style = DEBRIS_STYLES[variant];
  if (style === 'planks' && source) {
    const imported = adaptSourceWood(source);
    if (imported) return imported;
  }
  if (style === 'branch') return branchMesh(variant);
  if (style === 'planks') return plankMesh(variant);
  return logMesh(variant);
}

// Prepare the audited unpainted SM_Logs export as a local, painted beach prop.
// The input may be the raw mesh or the one-part registry payload. Keep its
// topology and never mutate the loader-owned geometry.
export function adaptSourceWood(source) {
  const input = source?.isBufferGeometry ? source : source?.parts?.length === 1 ? source.parts[0]?.geo : null;
  const p = input?.getAttribute('position');
  if (!p || p.itemSize !== 3 || p.count < 3 || p.count > 1000 ||
      Array.from(p.array).some((value) => !Number.isFinite(value)) ||
      (input.index && Array.from(input.index.array).some((value) => !Number.isInteger(value) || value < 0 || value >= p.count)) ||
      !validTriangles(input, p) || (input.index ? input.index.count / 3 > 250 : p.count / 3 > 250)) return null;
  const geo = input.clone();
  const pos = geo.getAttribute('position');
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
    minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
  }
  const width = maxX - minX, depth = maxZ - minZ, height = maxY - minY;
  if (!(width > 1e-5 && depth > 1e-5 && height > 1e-5)) { geo.dispose(); return null; }
  const horizontalScale = 1.5 / Math.max(width, depth), verticalScale = 0.4 / height;
  for (let i = 0; i < pos.count; i++) {
    // The export's longest board axis is Z. Rotate around Y so every debris
    // style uses local X as its longitudinal wood direction for shared grain.
    pos.setXYZ(i, (pos.getZ(i) - (minZ + maxZ) / 2) * horizontalScale,
      (pos.getY(i) - minY) * verticalScale,
      -(pos.getX(i) - (minX + maxX) / 2) * horizontalScale);
  }
  pos.needsUpdate = true;
  for (const key of Object.keys(geo.attributes)) if (key !== 'position') geo.deleteAttribute(key);
  geo.clearGroups();
  geo.computeVertexNormals();
  const normal = geo.getAttribute('normal'), colors = new Float32Array(pos.count * 3);
  const wood = new THREE.Color(0xb39770), sun = new THREE.Color(0xd7bd91);
  const bark = new THREE.Color(0x66513b), cut = new THREE.Color(0xe0c99f), scar = new THREE.Color(0x73583d);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const axial = (x + 0.75) / 1.5;
    const end = Math.min(axial, 1 - axial);
    const lower = 1 - THREE.MathUtils.smoothstep(y, 0.025, 0.19);
    const nY = Math.max(0, normal.getY(i));
    color.copy(wood).lerp(sun, 0.12 + nY * 0.35 + Math.max(0, y / 0.4) * 0.12);
    color.lerp(bark, lower * 0.28);
    // A shaded cut end and sparse longitudinal scars are painted from mesh
    // coordinates, so the export remains self-contained and texture-free.
    if (end < 0.055 && nY < 0.35) color.copy(cut).lerp(bark, 0.16 + (i % 5) * 0.025);
    const along = z;
    const scarBand = Math.abs(((along * 17 + y * 3) % 1 + 1) % 1 - 0.5);
    if (end > 0.08 && scarBand < 0.045 && y > 0.06 && y < 0.33) color.lerp(scar, 0.32);
    color.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) + 0.75) / 1.5; uv[i * 2 + 1] = pos.getZ(i); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

// Kept as a descriptive alias for existing source-preparation callers; the
// audited asset is a compact stacked-board cluster, not a cylindrical log.
export const adaptSourceLogs = adaptSourceWood;

function validTriangles(geometry, position) {
  const index = geometry.index?.array;
  const count = index ? index.length : position.count;
  if (count < 3 || count % 3 !== 0) return false;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index[i] : i, ib = index ? index[i + 1] : i + 1, ic = index ? index[i + 2] : i + 2;
    if (ia >= position.count || ib >= position.count || ic >= position.count) return false;
    const a = new THREE.Vector3().fromBufferAttribute(position, ia);
    const b = new THREE.Vector3().fromBufferAttribute(position, ib);
    const c = new THREE.Vector3().fromBufferAttribute(position, ic);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-12) return false;
  }
  return true;
}

export function loadedDebrisGeometry(data) {
  const geometry = data?.isBufferGeometry ? data : data?.parts?.length === 1 ? data.parts[0]?.geo : null;
  const p = geometry?.getAttribute('position'), n = geometry?.getAttribute('normal'), c = geometry?.getAttribute('color');
  const uv = geometry?.getAttribute('uv');
  if (!p || p.itemSize !== 3 || !n || n.itemSize !== 3 || !c || c.itemSize !== 3 ||
      n.count !== p.count || c.count !== p.count ||
      [p, n, c].some((attribute) => Array.from(attribute.array).some((value) => !Number.isFinite(value))) ||
      (uv && (uv.itemSize !== 2 || uv.count !== p.count || Array.from(uv.array).some((value) => !Number.isFinite(value)))) ||
      Array.from(c.array).some((value) => value < 0 || value > 1) ||
      (geometry.index && Array.from(geometry.index.array).some((value) => !Number.isInteger(value) || value < 0)) ||
      !validTriangles(geometry, p)) return null;
  for (let i = 0; i < n.count; i++) {
    if (Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > 0.015) return null;
  }
  if (geometry.index ? geometry.index.count / 3 > 250 : p.count / 3 > 250) return null;
  let minY = Infinity, maxY = -Infinity, radius = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); radius = Math.max(radius, Math.hypot(x, z));
  }
  if (minY < -1e-4 || maxY > 0.45 + 1e-4 || radius > 1.35 + 1e-4) return null;
  const clone = geometry.clone();
  if (!clone.getAttribute('uv')) {
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < p.count; i++) { minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i)); }
    const span = Math.max(1e-5, maxX - minX), generatedUv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { generatedUv[i * 2] = (p.getX(i) - minX) / span; generatedUv[i * 2 + 1] = p.getZ(i); }
    clone.setAttribute('uv', new THREE.BufferAttribute(generatedUv, 2));
  }
  clone.computeBoundingBox(); clone.computeBoundingSphere();
  return clone;
}
