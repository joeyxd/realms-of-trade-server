// Fixed-tick swept hull cells against the shared conservative terrain/dock geometry.
// Rotation uses a bounded envelope around the midpoint orientation, not endpoint-only probes.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { NAVAL_DAMAGE as D } from '../../data/navalDamage.js';
import { navalPose } from './handling.js';

const EPS = 1e-9, SKIN = 0.002, MAX_CONTACTS = 4;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const angle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function point(pose, x, z) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { x: pose.x + c * x + s * z, z: pose.z - s * x + c * z };
}

function floats(parts) {
  if (!Array.isArray(parts) || parts.length > 600) throw new TypeError('Invalid coastal hull parts');
  return parts.flatMap((p, index) => {
    if (!Array.isArray(p) || !RAFT_PARTS[p[0]] || !p.slice(1, 4).every(Number.isSafeInteger))
      throw new TypeError('Invalid coastal hull part');
    if (!RAFT_PARTS[p[0]].floats) return [];
    const [w, d] = RAFT_PARTS[p[0]].size || [1, 1];
    return [{ index, x: (p[1] + w / 2) * RAFT.cell, z: (p[2] + d / 2) * RAFT.cell,
      hx: w * RAFT.cell / 2, hz: d * RAFT.cell / 2 }];
  });
}

// SAT time intervals for a translating rectangle. The added radius encloses its true rotating
// corners and the curved center path throughout this tick. False contacts are bounded by that radius.
function sweep(cell, a, b, polygon, yaw, padding) {
  const c = Math.cos(yaw), s = Math.sin(yaw), axes = [{ x: c, z: -s }, { x: s, z: c }];
  const vertices = polygon.vertices;
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i], w = vertices[(i + 1) % vertices.length];
    const dx = w.x - v.x, dz = w.z - v.z, len = Math.hypot(dx, dz);
    if (len > EPS) axes.push({ x: -dz / len, z: dx / len });
  }
  let enter = -Infinity, exit = Infinity, normal = null, overlap = true, depth = Infinity, escape = null;
  for (const n of axes) {
    let lo = Infinity, hi = -Infinity;
    for (const v of vertices) { const q = v.x * n.x + v.z * n.z; lo = Math.min(lo, q); hi = Math.max(hi, q); }
    const radius = cell.hx * Math.abs(c * n.x - s * n.z) + cell.hz * Math.abs(s * n.x + c * n.z) + padding;
    lo -= radius; hi += radius;
    const q = a.x * n.x + a.z * n.z, v = (b.x - a.x) * n.x + (b.z - a.z) * n.z;
    if (q < lo - EPS || q > hi + EPS) overlap = false;
    const left = q - lo, right = hi - q;
    if (left >= -EPS && right >= -EPS && Math.min(left, right) < depth) {
      depth = Math.min(left, right); escape = left < right ? { x: -n.x, z: -n.z } : n;
    }
    if (Math.abs(v) <= EPS) { if (q < lo - EPS || q > hi + EPS) return null; continue; }
    const t0 = (lo - q) / v, t1 = (hi - q) / v, t = Math.min(t0, t1);
    if (t > enter) { enter = t; normal = v > 0 ? { x: -n.x, z: -n.z } : n; }
    exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit + EPS) return null;
  }
  if (exit < -EPS || enter > 1 + EPS) return null;
  if (overlap) return escape ? { t: 0, normal: escape, depth: Math.max(0, depth) } : null;
  return normal && enter >= -EPS ? { t: Math.max(0, Math.min(1, enter)), normal, depth: 0 } : null;
}

function impactPoint(state, rig, cell, normal) {
  const pose = navalPose(state, rig), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const nx = c * normal.x - s * normal.z, nz = s * normal.x + c * normal.z;
  const localX = cell.x - (Math.abs(nx) < EPS ? 0 : Math.sign(nx) * cell.hx);
  const localZ = cell.z - (Math.abs(nz) < EPS ? 0 : Math.sign(nz) * cell.hz);
  return { ...point(pose, localX, localZ), localX, localZ };
}

function validate(before, next, rig, coast) {
  for (const state of [before, next]) if (!state || !Number.isSafeInteger(state.tick) || state.tick < 0 ||
    !['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((k) => finite(state[k])) ||
    Math.abs(state.x) > 1e9 || Math.abs(state.z) > 1e9 || Math.hypot(state.vx, state.vz) > 100 || Math.abs(state.omega) > 10)
    throw new TypeError('Invalid coastal state');
  if (next.tick !== before.tick + 1 || !rig || !['cx', 'cz'].every((k) => finite(rig[k])) ||
    !coast || coast.version !== 1 || typeof coast.query !== 'function') throw new TypeError('Invalid coastal step');
  if (Math.abs(angle(before.yaw, next.yaw)) > 0.2 || Math.hypot(next.x - before.x, next.z - before.z) > 4)
    throw new TypeError('Coastal step exceeds fixed-tick envelope');
}

export function resolveNavalCoast(before, next, rig, parts, coast) {
  validate(before, next, rig, coast);
  const hull = floats(parts), contacts = [];
  let start = { ...before }, target = { ...next };
  for (let pass = 0; pass < MAX_CONTACTS; pass++) {
    const pa = navalPose(start, rig), pb = navalPose(target, rig), turn = angle(pa.yaw, pb.yaw), mid = pa.yaw + turn / 2;
    let chosen = null;
    for (const cell of hull) {
      const a = point(pa, cell.x, cell.z), b = point(pb, cell.x, cell.z);
      const corner = Math.hypot(cell.hx, cell.hz), center = Math.hypot(cell.x - rig.cx, cell.z - rig.cz);
      const padding = 2 * corner * Math.sin(Math.abs(turn) / 4) + center * (1 - Math.cos(turn / 2));
      const radius = corner + padding;
      const obstacles = coast.query(Math.min(a.x, b.x) - radius, Math.min(a.z, b.z) - radius,
        Math.max(a.x, b.x) + radius, Math.max(a.z, b.z) + radius);
      for (const obstacle of obstacles) {
        const hit = sweep(cell, a, b, obstacle, mid, padding);
        if (!hit) continue;
        const at = { ...target, x: start.x + (target.x - start.x) * hit.t,
          z: start.z + (target.z - start.z) * hit.t, yaw: start.yaw + turn * hit.t };
        const p = impactPoint(at, rig, cell, hit.normal);
        const pointVX = target.vx + target.omega * (p.z - at.z), pointVZ = target.vz - target.omega * (p.x - at.x);
        const normalSpeed = pointVX * hit.normal.x + pointVZ * hit.normal.z;
        // Initial overlap may leave freely; motion along a flat coast must not acquire damage.
        if (hit.t === 0 && normalSpeed >= -EPS && (b.x - a.x) * hit.normal.x + (b.z - a.z) * hit.normal.z >= -EPS) continue;
        if (!chosen || hit.t < chosen.hit.t - EPS || (Math.abs(hit.t - chosen.hit.t) <= EPS &&
          (cell.index < chosen.cell.index || (cell.index === chosen.cell.index && obstacle.id < chosen.obstacle.id))))
          chosen = { hit, cell, obstacle, at, p, normalSpeed };
      }
    }
    if (!chosen) break;
    const { hit, obstacle, cell, at, p, normalSpeed } = chosen, n = hit.normal;
    const speed = Math.max(0, -normalSpeed);
    const damage = Math.min(D.maxImpactDamage, Math.round(Math.max(0, speed - D.safeNormalSpeed) ** 2 * D.damageScale));
    const linearNormal = target.vx * n.x + target.vz * n.z;
    const rx = target.x - at.x, rz = target.z - at.z, remainingNormal = rx * n.x + rz * n.z;
    const separation = hit.depth + SKIN;
    at.x += n.x * separation; at.z += n.z * separation;
    const bounce = Math.max(0, -remainingNormal) * D.restitution;
    const vx = linearNormal < 0 ? (target.vx - linearNormal * n.x) * D.tangentRetention - linearNormal * n.x * D.restitution : target.vx;
    const vz = linearNormal < 0 ? (target.vz - linearNormal * n.z) * D.tangentRetention - linearNormal * n.z * D.restitution : target.vz;
    target = { ...target, x: at.x + (rx - remainingNormal * n.x) * D.tangentRetention + n.x * bounce,
      z: at.z + (rz - remainingNormal * n.z) * D.tangentRetention + n.z * bounce,
      yaw: at.yaw, vx, vz, omega: normalSpeed < 0 ? 0 : target.omega };
    contacts.push(Object.freeze({ id: obstacle.id, kind: obstacle.kind, x: p.x, z: p.z,
      normalX: n.x, normalZ: n.z, speed, damage, localX: p.localX, localZ: p.localZ, cell: cell.index }));
    start = { ...at, vx, vz, omega: target.omega };
    // On exhausting the budget, stop at the last separated contact rather than accepting an unchecked slide.
    if (pass === MAX_CONTACTS - 1) target = { ...target, x: start.x, z: start.z, yaw: start.yaw, vx: 0, vz: 0, omega: 0 };
  }
  return { state: target, contacts: Object.freeze(contacts) };
}
