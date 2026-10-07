// Moored player rafts (M6 P1). Saved ships stay private; only their visible blueprint and a server-selected
// berth are replicated. Active vessels are ECS vehicles, never character spawns. Their shared walk geometry
// accepts edits only through the authoritative raft editor, not client-owned blueprints or poses.
import { C, KIND } from '../ecs.js';
import { RAFT } from '../../data/raftparts.js';
import { SLOTS, slotSkill } from '../../data/tattoos.js';
import { indexRaft } from '../economy/raft.js';
import { newEco } from './trade.js';

export function installRafts(w, namespace) {
  w.rafts = new Map(); // stable ship id -> active vehicle, profile reference is server-only
  w.raftNamespace = namespace;
  w.nextRaft = 1;
  w.nextRaftOwner = 1;
}

// Identity generation uses the session namespace supplied outside the deterministic simulation. These keys
// survive signed saves / account saves; they never contain the current player entity or an account token.
export function prepareRaftProfile(w, p) {
  const eco = p.eco || (p.eco = newEco());
  const live = [...w.profiles.values()];
  if (!eco.id) {
    const prefix = w.raftNamespace.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'raft';
    do { eco.id = prefix + (w.nextRaftOwner++).toString(36); } while (live.some((q) => q.eco?.id === eco.id));
  }
  // Signed anonymous saves can be replayed. Fence simultaneous clones in this process, without claiming
  // durable custody: public risk and cross-process ownership still require M5 accounts/transactions.
  if (live.some((q) => q.eco?.id === eco.id)) return false;
  const taken = new Set(live.flatMap((q) => (q.eco?.ships || []).map((s) => s.id).filter(Boolean)));
  const reserved = new Set([...taken, ...eco.ships.map((s) => s.id).filter(Boolean)]);
  const seen = new Set();
  for (const s of eco.ships) {
    if (s.kind !== 'raft') continue;
    if (s.id && taken.has(s.id)) return false;
    if (!s.id || seen.has(s.id)) {
      do { s.id = `${w.raftNamespace}:r${w.nextRaft++}`; } while (reserved.has(s.id) || seen.has(s.id));
    }
    seen.add(s.id);
  }
  return true;
}

// The first two berths sit on opposite sides of the dock. Further rows are spaced for the technical maximum
// grid width, so even legacy blueprints do not overlap each other. This is a local mooring prototype, not a
// decision about sea regions or port ownership. Pose is derived afresh, never copied from a saved x/z/yaw.
function mooring(map, ship, berth) {
  const [minX, maxX, minZ, maxZ] = ship.berthBasis, cell = RAFT.cell, d = map.dock;
  const cx = (minX + maxX + 1) * cell / 2;
  const cz = (minZ + maxZ + 1) * cell / 2;
  const width = (maxX - minX + 1) * cell;
  const across = (berth % 2 ? -1 : 1) * (d.halfWidth + width / 2 + 0.15 + Math.floor(berth / 2) * 32);
  const along = Math.max(0, d.len - 10);
  const x = d.base.x + d.dir.x * along - d.dir.z * across;
  const z = d.base.z + d.dir.z * along + d.dir.x * across;
  return { x: x - d.dir.z * cx - d.dir.x * cz, y: 0.72,
    z: z + d.dir.x * cx - d.dir.z * cz, yaw: Math.atan2(d.dir.x, d.dir.z) };
}

function insideMap(map, ship, pose) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), limit = map.half - 0.5;
  return ship.grid.parts.every((p) => {
    for (const dx of [0, RAFT.cell]) for (const dz of [0, RAFT.cell]) {
      const lx = p[1] * RAFT.cell + dx, lz = p[2] * RAFT.cell + dz;
      if (Math.abs(pose.x + c * lx + s * lz) > limit || Math.abs(pose.z - s * lx + c * lz) > limit) return false;
    }
    return true;
  });
}

export function attachRafts(w, owner, p) {
  // Only the primary raft moored in the current island has a world presence in P1. Other ports and fleets
  // remain saved; logging in must not teleport a vessel back from sea or grant another starter.
  const ship = p.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea' && s.grid.parts.length && s.hp > 0);
  if (!ship) return;
  if (!ship.berthBasis) {
    const ix = indexRaft(ship.grid.parts);
    ship.berthBasis = [ix.minX, ix.maxX, ix.minZ, ix.maxZ];
  }
  const used = new Set([...w.rafts.values()].map((r) => r.ship.berth));
  const candidates = [ship.berth, ...Array.from({ length: 64 }, (_, i) => i)];
  const berth = candidates.find((b) => b >= 0 && b <= 63 && !used.has(b) && insideMap(w.map, ship, mooring(w.map, ship, b)));
  if (berth === undefined) return; // preserve the saved vessel when no valid prototype berth fits
  ship.berth = berth;
  const pose = mooring(w.map, ship, berth), ecs = w.ecs;
  const entity = ecs.create(KIND.SHIP, C.POS | C.VEHICLE);
  ecs.x[entity] = pose.x; ecs.y[entity] = pose.y; ecs.z[entity] = pose.z; ecs.facing[entity] = pose.yaw;
  w.rafts.set(ship.id, { entity, owner, ship });
  w.raftDeck.update(publicRafts(w));
  w.profileDirty.add(owner);
}

export function detachRafts(w, owner) {
  w.navalTrial?.removeOwner(owner);
  w.raftEditReceipts?.delete(owner);
  const removed = new Set([...w.rafts.values()].filter((r) => r.owner === owner).map((r) => r.ship.id));
  // A guest must not remain hovering over deep water after the owner's logout removes the moored deck.
  const guests = [...w.ecs.each(C.PLAYER)].filter((e) => {
    const ecs = w.ecs;
    if (removed.has(w.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e])?.id)) return true;
    // Abordaje may be over unsupported water when its planned landing disappears.
    const slot = SLOTS[ecs.castK[e] - 1];
    return !!slot && slotSkill(ecs, e, slot) === 'leap'
      && removed.has(w.raftDeck.surface(ecs.lpX1[e], ecs.lpZ1[e], ecs.y[e])?.id);
  });
  for (const [id, r] of w.rafts) if (r.owner === owner) {
    w.ecs.destroy(r.entity);
    w.rafts.delete(id);
  }
  w.raftDeck.update(publicRafts(w));
  for (const e of guests) {
    const d = w.map.dock, ecs = w.ecs;
    ecs.x[e] = d.base.x + d.dir.x * Math.max(0, d.len - 10);
    ecs.z[e] = d.base.z + d.dir.z * Math.max(0, d.len - 10);
    ecs.y[e] = w.map.groundAt(ecs.x[e], ecs.z[e]);
    ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = 0;
    ecs.dashT[e] = -1;
    ecs.castK[e] = ecs.castT[e] = ecs.castLock[e] = ecs.chg[e] = 0;
  }
}

// Full lists repair late joins, dropped snapshots and logout removals. Private holds, eco owner keys and
// profile data never enter this whitelist. Editor acknowledgements remain private; this list repairs edits.
export function publicRafts(w) {
  const ecs = w.ecs;
  return [...w.rafts.entries()].map(([id, r]) => ({ id, entity: r.entity, owner: r.owner, rev: r.ship.rev,
    name: r.ship.n, berth: r.ship.berth, x: ecs.x[r.entity], y: ecs.y[r.entity], z: ecs.z[r.entity],
    yaw: ecs.facing[r.entity], parts: r.ship.grid.parts.map((p) => [...p]),
    look: r.ship.look ? { banner: r.ship.look.banner, paint: r.ship.look.paint } : null }));
}
