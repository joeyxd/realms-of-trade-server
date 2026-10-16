// Moored raft walk surfaces and blockers, shared by authority and prediction. Geometry is compiled
// only when a public blueprint/pose changes; rendering and inventory never decide where a body stands.
import { RAFT, RAFT_PARTS } from '../data/raftparts.js';
import { isDoorOpen } from './naval/shelter.js';

export const STAIR = Object.freeze({ width: 1.55, steps: 8 });
const CELL = RAFT.cell, HEIGHT = RAFT.levelHeight, STEP = 0.6, EPS = 1e-8;
const FORWARD = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const local = (r, x, z) => {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = x - r.x, dz = z - r.z;
  return [c * dx - s * dz, s * dx + c * dz];
};
const point = (r, x, z) => ({ x: r.x + Math.cos(r.yaw) * x + Math.sin(r.yaw) * z,
  z: r.z - Math.sin(r.yaw) * x + Math.cos(r.yaw) * z });

// A short, explicit dock join, not an invisible water surface or a bridge to remote prototype berths.
// Its local +Z runs from dock to raft. Both endpoints overlap their supporting deck by 0.3 units.
export function raftGangplank(r, dock) {
  if (!dock || r.pilot || !Array.isArray(r.parts)) return null;
  const bases = r.parts.filter((p) => RAFT_PARTS[p[0]]?.layer === 'base');
  if (!bases.length || Math.cos(r.yaw) * dock.dir.z + Math.sin(r.yaw) * dock.dir.x < 0.9999) return null;
  const minX = Math.min(...bases.map((p) => p[1])), maxX = Math.max(...bases.map((p) => p[1]));
  const minZ = Math.min(...bases.map((p) => p[2])), maxZ = Math.max(...bases.map((p) => p[2]));
  const center = point(r, (minX + maxX + 1) * CELL / 2, (minZ + maxZ + 1) * CELL / 2);
  const dx = center.x - dock.base.x, dz = center.z - dock.base.z;
  const along = dx * dock.dir.x + dz * dock.dir.z;
  const across = -dx * dock.dir.z + dz * dock.dir.x, half = (maxX - minX + 1) * CELL / 2;
  const gap = Math.abs(across) - dock.halfWidth - half;
  if (gap < -EPS || gap > 0.35 || along < 0.7 || along > dock.len - 0.7) return null;
  const sign = Math.sign(across), ux = -dock.dir.z * sign, uz = dock.dir.x * sign;
  const start = { x: dock.base.x + dock.dir.x * along + ux * (dock.halfWidth - 0.3),
    z: dock.base.z + dock.dir.z * along + uz * (dock.halfWidth - 0.3) };
  const end = { x: center.x - ux * (half - 0.3), z: center.z - uz * (half - 0.3) };
  const [ex, ez] = local(r, end.x, end.z);
  if (!bases.some((p) => ex >= p[1] * CELL && ex < (p[1] + 1) * CELL && ez >= p[2] * CELL && ez < (p[2] + 1) * CELL)) return null;
  return { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2, y: (dock.deckY + r.y) / 2,
    yaw: Math.atan2(ux, uz), length: Math.hypot(end.x - start.x, end.z - start.z),
    width: 1.2, rise: r.y - dock.deckY };
}

const segmentDistance2 = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2;
};

function compile(r, dock) {
  const floors = [], stairs = [], edges = [], roofs = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [id, x, z, level, dir = 0] of r.parts) {
    const p = RAFT_PARTS[id];
    if (!p || !Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(level)) continue;
    const x0 = x * CELL, z0 = z * CELL, y = r.y + level * HEIGHT;
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x0 + CELL);
    minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z0 + CELL);
    if (p.layer === 'base' || p.layer === 'floor') floors.push({ x0, z0, y });
    if (p.layer === 'roof') roofs.push({ x0, z0, y });
    if (id === 'stairs') {
      const [fx, fz] = FORWARD[(dir & 3)];
      stairs.push({ x: x0 + CELL / 2, z: z0 + CELL / 2, y, fx, fz });
      // Sides constrain entry to the two ends and are visible as stair stringers/rails.
      for (const sign of [-1, 1]) {
        const sx = x0 + CELL / 2 + fz * STAIR.width / 2 * sign, sz = z0 + CELL / 2 - fx * STAIR.width / 2 * sign;
        edges.push({ a: [sx - fx * CELL / 2, sz - fz * CELL / 2], b: [sx + fx * CELL / 2, sz + fz * CELL / 2], y, h: HEIGHT, thick: 0.035 });
      }
    }
    if (p.layer === 'edge') {
      const d = dir & 3;
      const a = d === 0 ? [x0, z0] : d === 1 ? [x0 + CELL, z0] : d === 2 ? [x0, z0 + CELL] : [x0, z0];
      const b = d === 0 ? [x0 + CELL, z0] : d === 1 ? [x0 + CELL, z0 + CELL] : d === 2 ? [x0 + CELL, z0 + CELL] : [x0, z0 + CELL];
      if (id === 'door' && isDoorOpen(r.openDoors, [id, x, z, level, dir])) {
        const tx = (b[0] - a[0]) / CELL, tz = (b[1] - a[1]) / CELL;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const at = (u) => [mid[0] + tx * u, mid[1] + tz * u];
        const hinge = at(-0.675), normal = d === 0 ? [0, -1] : d === 1 ? [1, 0] : d === 2 ? [0, 1] : [-1, 0];
        for (const [from, to] of [[a, at(-0.70)], [at(0.70), b],
          [hinge, [hinge[0] + normal[0] * 1.35, hinge[1] + normal[1] * 1.35]]])
          edges.push({ a: from, b: to, y, h: HEIGHT - 0.18, thick: 0.09 });
      } else edges.push({ a, b, y, h: id === 'railing' ? 0.75 : HEIGHT - 0.18, thick: id === 'railing' ? 0.05 : 0.09 });
    }
  }
  for (const edge of edges) for (const [x, z] of [edge.a, edge.b]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { record: r, floors, stairs, edges, roofs, minX, maxX, minZ, maxZ, plank: raftGangplank(r, dock) };
}

export class RaftDeck {
  constructor(map) { this.map = map; this.entries = new Map(); }
  get size() { return this.entries.size; }

  update(records) {
    const next = new Map();
    for (const r of records || []) {
      if (!r || !Array.isArray(r.parts) || ![r.x, r.y, r.z, r.yaw].every(Number.isFinite)) continue;
      const key = `${r.x}|${r.y}|${r.z}|${r.yaw}|${r.rev}|${r.pilot?.epoch || 0}|${JSON.stringify(r.parts)}|${JSON.stringify(r.openDoors || [])}`;
      const prior = this.entries.get(r.id);
      next.set(r.id, prior?.key === key ? prior : { key, ...compile(r, this.map.dock) });
    }
    this.entries = next;
  }

  surface(x, z, referenceY) {
    let found = null, distance = Infinity;
    const consider = (y, kind, id) => {
      const d = Number.isFinite(referenceY) ? Math.abs(y - referenceY) : y;
      if (Number.isFinite(referenceY) && d >= STEP - EPS) return;
      if (d < distance) { found = { y, kind, id }; distance = d; }
    };
    for (const g of this.entries.values()) {
      const r = g.record, plank = g.plank;
      if (plank) {
        const [px, pz] = local(plank, x, z);
        if (Math.abs(px) <= plank.width / 2 && Math.abs(pz) <= plank.length / 2)
          consider(plank.y + pz / plank.length * plank.rise, 'gangplank', r.id);
      }
      const [lx, lz] = local(r, x, z);
      if (lx < g.minX - EPS || lx > g.maxX + EPS || lz < g.minZ - EPS || lz > g.maxZ + EPS) continue;
      let stairSurface = null;
      for (const s of g.stairs) {
        const ox = lx - s.x, oz = lz - s.z, run = ox * s.fx + oz * s.fz + CELL / 2;
        if (run < 0 || run >= CELL || Math.abs(ox * s.fz - oz * s.fx) > STAIR.width / 2) continue;
        const y = s.y + Math.ceil(Math.max(EPS, run) / CELL * STAIR.steps) * HEIGHT / STAIR.steps;
        if (Number.isFinite(referenceY) && Math.abs(y - referenceY) < STEP - EPS) stairSurface = { y, kind: 'stairs', id: r.id };
      }
      // A traversable stair overrides the flat foundation beneath it, otherwise it would never climb.
      if (stairSurface) { found = stairSurface; distance = 0; continue; }
      for (const f of g.floors) if (lx >= f.x0 - EPS && lx < f.x0 + CELL && lz >= f.z0 - EPS && lz < f.z0 + CELL)
        consider(f.y, 'deck', r.id);
    }
    return found;
  }

  blocked(x, z, y, radius) {
    for (const g of this.entries.values()) {
      const [lx, lz] = local(g.record, x, z);
      if (lx < g.minX - radius || lx > g.maxX + radius || lz < g.minZ - radius || lz > g.maxZ + radius) continue;
      for (const e of g.edges) if (y < e.y + e.h - EPS && y + 1.6 > e.y + 0.1 &&
        segmentDistance2(lx, lz, e.a, e.b) < (radius + e.thick) ** 2 - EPS) return true;
      // There is no crawl-under-stairs mode. Reject a leap/teleport that would stand inside a tread.
      for (const s of g.stairs) {
        const ox = lx - s.x, oz = lz - s.z, run = ox * s.fx + oz * s.fz + CELL / 2;
        if (run >= 0 && run < CELL && Math.abs(ox * s.fz - oz * s.fx) < STAIR.width / 2) {
          const h = s.y + Math.ceil(Math.max(EPS, run) / CELL * STAIR.steps) * HEIGHT / STAIR.steps;
          if (y >= s.y - EPS && h - y >= STEP - EPS) return true;
        }
      }
    }
    return false;
  }

  // A roof is cover, never a new walkable storey. Used for the local interior cutaway;
  // weather, rest and lighting benefits remain separate systems.
  shelterAt(x, z, y) {
    for (const g of this.entries.values()) {
      const [lx, lz] = local(g.record, x, z);
      for (const roof of g.roofs) if (Math.abs(y - roof.y) < STEP &&
          lx >= roof.x0 && lx < roof.x0 + CELL && lz >= roof.z0 && lz < roof.z0 + CELL)
        return { id: g.record.id, y: roof.y + HEIGHT };
    }
    return null;
  }
}
