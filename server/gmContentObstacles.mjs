// Read-only publication guard for durable things that a static GM edit must not bury.
import { RAFT, RAFT_PARTS } from '../src/data/raftparts.js';
import { sanitizeRaftVoyage } from '../src/sim/naval/recovery.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ROWS = 4096, PAGE_SIZE = 100, DROP_RADIUS = 0.75;

export class GmContentObstacleError extends Error {
  constructor(code) { super(code); this.name = 'GmContentObstacleError'; this.code = code; }
}
const unavailable = () => new GmContentObstacleError('gm_content_unavailable');
const occupied = () => new GmContentObstacleError('gm_content_occupied');
const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z);
function circle(c) {
  if (!finitePoint(c) || !Number.isFinite(c.r) || c.r < 0 || c.r > 1e4) throw unavailable();
  return { x: c.x, z: c.z, r: c.r };
}
function newCircles(currentMap, targetMap) {
  if (!Array.isArray(currentMap?.colliders) || !Array.isArray(targetMap?.colliders) ||
      currentMap.seed !== targetMap.seed) throw unavailable();
  const counts = new Map();
  for (const raw of currentMap.colliders) {
    const c = circle(raw), k = `${c.x},${c.z},${c.r}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const added = [];
  for (const raw of targetMap.colliders) {
    const c = circle(raw), k = `${c.x},${c.z},${c.r}`, count = counts.get(k) || 0;
    if (count) counts.set(k, count - 1); else added.push(c);
  }
  return added;
}
function intersects(c, p, radius = 0) {
  return Math.hypot(c.x - p.x, c.z - p.z) <= c.r + radius;
}
function profileCheckpoint(profile) {
  const cp = profile?.cp;
  if (cp === undefined || cp === null || cp === '') return null;
  if (typeof cp !== 'string' || cp.length > 80) throw unavailable();
  return cp;
}
async function allProfiles(store) {
  if (typeof store?.listGmContentProfiles !== 'function') throw unavailable();
  const rows = []; let after = null;
  for (;;) {
    let page;
    try { page = await store.listGmContentProfiles({ after, limit: PAGE_SIZE }); } catch { throw unavailable(); }
    if (!Array.isArray(page) || page.length > PAGE_SIZE || rows.length + page.length > MAX_ROWS) throw unavailable();
    let prior = after;
    for (const row of page) {
      if (!row || typeof row.accountId !== 'string' || !UUID.test(row.accountId) ||
          row.accountId !== row.accountId.toLowerCase() || (prior !== null && row.accountId <= prior) ||
          !row.profile || typeof row.profile !== 'object' || Array.isArray(row.profile)) throw unavailable();
      rows.push(row); prior = row.accountId;
    }
    if (page.length < PAGE_SIZE) return rows;
    after = prior;
  }
}
async function groundRows(store, worldId) {
  if (typeof store?.listPearlGround !== 'function') throw unavailable();
  const rows = []; let afterUid = null;
  for (;;) {
    let page;
    try { page = await store.listPearlGround(worldId, { afterUid, limit: PAGE_SIZE }); } catch { throw unavailable(); }
    if (!Array.isArray(page) || page.length > PAGE_SIZE || rows.length + page.length > MAX_ROWS) throw unavailable();
    let prior = afterUid;
    for (const row of page) {
      if (!row || typeof row.uid !== 'string' || (prior !== null && row.uid <= prior) || row.world !== worldId ||
          !finitePoint(row.ground)) throw unavailable();
      rows.push(row.ground); prior = row.uid;
    }
    if (page.length < PAGE_SIZE) return rows;
    afterUid = prior;
  }
}
async function deathRows(store, worldId) {
  if (typeof store?.listCurrentDeathDrops !== 'function') throw unavailable();
  const rows = []; let after = null;
  for (;;) {
    let page;
    try { page = await store.listCurrentDeathDrops(worldId, { after, limit: PAGE_SIZE }); } catch { throw unavailable(); }
    if (!Array.isArray(page) || page.length > PAGE_SIZE || rows.length + page.length > MAX_ROWS) throw unavailable();
    let prior = after;
    for (const row of page) {
      if (!row || row.state !== 'ground' || row.world !== worldId || !finitePoint(row.ground) ||
          !UUID.test(row.operationId) || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 ||
          (prior !== null && (row.operationId < prior.operationId ||
            (row.operationId === prior.operationId && row.ordinal <= prior.ordinal)))) throw unavailable();
      rows.push(row.ground); prior = { operationId: row.operationId, ordinal: row.ordinal };
    }
    if (page.length < PAGE_SIZE) return rows;
    after = prior;
  }
}
function checkedGrid(ship) {
  const parts = ship?.grid?.parts;
  if (!Array.isArray(parts) || parts.length > RAFT.maxCells * 4) throw unavailable();
  return parts.map((part) => {
    if (!Array.isArray(part) || part.length !== 5 || typeof part[0] !== 'string' || !RAFT_PARTS[part[0]] ||
        !Number.isSafeInteger(part[1]) || !Number.isSafeInteger(part[2]) ||
        !Number.isSafeInteger(part[3]) || !Number.isSafeInteger(part[4])) throw unavailable();
    return { x: part[1], z: part[2] };
  });
}
function sameSeedVoyage(ship, seed) {
  if (ship.voyage === undefined || ship.voyage === null) return null;
  const saved = sanitizeRaftVoyage(ship.voyage);
  if (!saved || Object.keys(ship.voyage).sort().join(',') !== 'pose,seed,v') throw unavailable();
  if (saved.seed !== seed) return null;
  return { x: saved.pose[0], z: saved.pose[1], yaw: saved.pose[2] };
}
function berthBasis(ship, grid) {
  const raw = ship.berthBasis;
  if (raw === undefined || raw === null) {
    const bases = grid.filter(({ x, z }, i) => RAFT_PARTS[ship.grid.parts[i][0]].layer === 'base');
    if (!bases.length) throw unavailable();
    return [Math.min(...bases.map((p) => p.x)), Math.max(...bases.map((p) => p.x)),
      Math.min(...bases.map((p) => p.z)), Math.max(...bases.map((p) => p.z))];
  }
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(Number.isSafeInteger) || raw[0] > raw[1] || raw[2] > raw[3]) throw unavailable();
  return raw;
}
function protectedRafts(profiles, map) {
  const shapes = [], homeKeys = new Set();
  for (const { profile } of profiles) {
    const eco = profile.eco;
    if (eco === undefined || eco === null) throw unavailable();
    if (!eco || typeof eco !== 'object' || Array.isArray(eco) || !Array.isArray(eco.ships) || eco.ships.length > 8) throw unavailable();
    for (const ship of eco.ships) {
      if (!ship || typeof ship !== 'object' || ship.kind !== 'raft') continue;
      const grid = checkedGrid(ship);
      if (!grid.length) continue;
      const voyage = sameSeedVoyage(ship, map.seed);
      if (voyage) {
        for (const part of grid) shapes.push({ pose: voyage, x: part.x, z: part.z });
      }
      if (ship.at !== 'aldea') continue;
      if (!map.dock || !finitePoint(map.dock.base) || !finitePoint(map.dock.dir) ||
          !Number.isFinite(map.dock.halfWidth) || !Number.isFinite(map.dock.len)) throw unavailable();
      const [minX, maxX, minZ, maxZ] = berthBasis(ship, grid), cell = RAFT.cell, dock = map.dock;
      const width = (maxX - minX + 1) * cell, depth = (maxZ - minZ + 1) * cell;
      const homeKey = `${minX},${maxX},${minZ},${maxZ}`;
      if (homeKeys.has(homeKey)) continue;
      homeKeys.add(homeKey);
      const radius = Math.hypot(width / 2, depth / 2);
      const along = Math.max(0, dock.len - 10);
      for (let berth = 0; berth < 64; berth++) {
        const across = (berth % 2 ? -1 : 1) * (dock.halfWidth + width / 2 + 0.15 + Math.floor(berth / 2) * 32);
        shapes.push({ center: { x: dock.base.x + dock.dir.x * along - dock.dir.z * across,
          z: dock.base.z + dock.dir.z * along + dock.dir.x * across }, radius });
      }
    }
  }
  return shapes;
}
function hitsRaft(c, parts) {
  // Test each raft floor cell as an oriented box. Circle-to-box distance includes edges,
  // so a collider cannot slip between the four corners of a saved grid cell.
  const cell = RAFT.cell;
  for (const { pose, x, z } of parts) {
    const co = Math.cos(pose.yaw), si = Math.sin(pose.yaw);
    const cx = pose.x + co * (x * cell + cell / 2) + si * (z * cell + cell / 2);
    const cz = pose.z - si * (x * cell + cell / 2) + co * (z * cell + cell / 2);
    const dx = c.x - cx, dz = c.z - cz;
    const lx = co * dx - si * dz, lz = si * dx + co * dz;
    const ox = Math.max(Math.abs(lx) - cell / 2, 0), oz = Math.max(Math.abs(lz) - cell / 2, 0);
    if (ox * ox + oz * oz <= c.r * c.r) return true;
  }
  return false;
}

/**
 * Reject newly-added static colliders that overlap persisted checkpoints, ground items,
 * death drops, saved same-seed raft voyages, or any possible home berth. Reads are bounded and have no gameplay writes.
 */
export async function validateGmContentObstacles({ store, map, currentMap, targetMap, worldId }) {
  if (!store || typeof worldId !== 'string' || !worldId || worldId.length > 100) throw unavailable();
  const added = newCircles(currentMap, targetMap);
  const profiles = await allProfiles(store);
  const ground = await groundRows(store, worldId);
  const drops = await deathRows(store, worldId);
  if (!map || !Number.isSafeInteger(map.seed) || (map.seed >>> 0) !== currentMap.seed || (map.seed >>> 0) !== targetMap.seed) throw unavailable();
  const rafts = protectedRafts(profiles, map);
  const checkpoints = targetMap.checkpoints;
  if (!checkpoints || typeof checkpoints !== 'object' || Array.isArray(checkpoints)) throw unavailable();
  const activeCheckpoints = new Set();
  for (const row of profiles) {
    const cp = profileCheckpoint(row.profile);
    if (cp !== null) {
      if (!finitePoint(checkpoints[cp])) throw unavailable();
      activeCheckpoints.add(cp);
    }
  }
  for (const c of added) {
    for (const cp of activeCheckpoints) if (intersects(c, checkpoints[cp], 2)) throw occupied();
    for (const p of ground) if (intersects(c, p, DROP_RADIUS)) throw occupied();
    for (const p of drops) if (intersects(c, p, DROP_RADIUS)) throw occupied();
    if (rafts.some((raft) => raft.center
      ? intersects(c, raft.center, raft.radius)
      : hitsRaft(c, [raft]))) throw occupied();
  }
  return { ok: true, checked: { profiles: profiles.length, ground: ground.length, deathDrops: drops.length }, newColliders: added.length };
}
