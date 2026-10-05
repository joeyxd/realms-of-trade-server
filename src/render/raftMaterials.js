// Semantic texture regions and UV remapping for La Balsa's procedural atlas material.
// Atlas coordinates use Three.js UV convention (v=0 at image bottom).
export const RAFT_ATLAS_ID = 'tex:raft-comic-v1';

const INSET = 0.012;
const LO = INSET;
const MID_LO = 0.5 + INSET;
const HI = 0.5 - INSET;
const TOP_HI = 1 - INSET;

export const RAFT_ATLAS_RECTS = Object.freeze({
  wood: Object.freeze({ u0: LO, v0: MID_LO, u1: HI, v1: TOP_HI }),       // top-left in image
  iron: Object.freeze({ u0: MID_LO, v0: MID_LO, u1: TOP_HI, v1: TOP_HI }), // top-right
  rope: Object.freeze({ u0: LO, v0: LO, u1: HI, v1: HI }),               // bottom-left
  cloth: Object.freeze({ u0: MID_LO, v0: LO, u1: TOP_HI, v1: HI }),      // bottom-right
});

const WHITE = 0xffffff;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp01 = (n) => Math.max(0, Math.min(1, finite(n, 0.5)));

function colorKey(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? `n${value}` : 'n0';
  if (value && typeof value === 'object' && Number.isFinite(value.r) && Number.isFinite(value.g) && Number.isFinite(value.b)) {
    return `rgb${value.r},${value.g},${value.b}`;
  }
  return `s${String(value)}`;
}

/** Describe an atlas-backed semantic surface and its procedural fallback/tint colors. */
export function surface(kind, fallbackColor, tint = WHITE) {
  return { kind, color: fallbackColor, tint };
}

/** Stable cache key for a semantic surface; a numeric argument denotes a solid-color material. */
export function materialKey(spec) {
  if (typeof spec === 'number') return `solid|${colorKey(spec)}`;
  if (!spec || typeof spec !== 'object') return `solid|${colorKey(spec)}`;
  return `surface|${String(spec.kind)}|${colorKey(spec.color)}|${colorKey(spec.tint ?? WHITE)}`;
}

function boxAxes(geometry, positions, normals) {
  if (!positions || !normals || positions.count !== normals.count || positions.count === 0) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    if (!p.every(Number.isFinite)) return null;
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  }
  return { min, max, extents: max.map((v, i) => v - min[i]) };
}

function faceUv(positions, normals, bounds, i, rawU, rawV) {
  if (!positions || !normals || !bounds) return [rawU, rawV];
  const n = [normals.getX(i), normals.getY(i), normals.getZ(i)];
  if (!n.every(Number.isFinite)) return [rawU, rawV];
  let normalAxis = 0;
  if (Math.abs(n[1]) > Math.abs(n[normalAxis])) normalAxis = 1;
  if (Math.abs(n[2]) > Math.abs(n[normalAxis])) normalAxis = 2;
  const tangent = [0, 1, 2].filter((a) => a !== normalAxis);
  const uAxis = bounds.extents[tangent[0]] >= bounds.extents[tangent[1]] ? tangent[0] : tangent[1];
  const vAxis = uAxis === tangent[0] ? tangent[1] : tangent[0];
  const p = [positions.getX(i), positions.getY(i), positions.getZ(i)];
  const axisUv = (axis) => bounds.extents[axis] > 1e-8 ? (p[axis] - bounds.min[axis]) / bounds.extents[axis] : NaN;
  return [finite(axisUv(uAxis), rawU), finite(axisUv(vAxis), rawV)];
}

/**
 * Remap the UV attribute of a cloned primitive into one inset atlas swatch.
 * For wood, `grain: 'box'` aligns U with the longest local face axis and `'cylinder'`
 * puts cylinder length on U while preserving cap UVs. Return false for unsupported or
 * missing-UV geometry; malformed UV/normals safely fall back to finite raw coordinates.
 */
export function mapRaftUV(geometry, kind, { grain = 'raw', variant = 0 } = {}) {
  const rect = RAFT_ATLAS_RECTS[kind];
  const uv = geometry?.getAttribute?.('uv');
  if (!rect || !uv || uv.count === 0 || typeof uv.getX !== 'function' || typeof uv.setXY !== 'function') return false;

  const isWood = kind === 'wood';
  const positions = geometry.getAttribute?.('position');
  const normals = geometry.getAttribute?.('normal');
  const bounds = isWood && grain === 'box' ? boxAxes(geometry, positions, normals) : null;
  const woodCrop = 0.23;
  const variantIndex = ((Math.trunc(finite(variant, 0)) % 4) + 4) % 4;
  const woodOffset = variantIndex * 0.18;
  const width = rect.u1 - rect.u0, height = rect.v1 - rect.v0;

  for (let i = 0; i < uv.count; i++) {
    const rawU = clamp01(uv.getX(i)), rawV = clamp01(uv.getY(i));
    let u = rawU, v = rawV;
    if (isWood && grain === 'box') [u, v] = faceUv(positions, normals, bounds, i, rawU, rawV);
    else if (isWood && grain === 'cylinder' && normals && Math.abs(finite(normals.getY(i))) < 0.999) [u, v] = [rawV, rawU];

    u = clamp01(u);
    v = clamp01(v);
    if (isWood) v = woodOffset + v * woodCrop;
    uv.setXY(i, rect.u0 + clamp01(u) * width, rect.v0 + clamp01(v) * height);
  }
  uv.needsUpdate = true;
  return true;
}
