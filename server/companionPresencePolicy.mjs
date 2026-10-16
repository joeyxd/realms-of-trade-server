import { tuning, DT } from '../src/data/tuning.js';
import { ENEMIES, ENEMY_KINDS } from '../src/data/enemies.js';
import { C } from '../src/sim/ecs.js';
import { beamSeg, segDist } from '../src/sim/projectiles.js';
import { canStand, moveWithCollision } from '../src/sim/systems/movement.js';

export const PRESENCE_RADIUS = 12;
export const PRESENCE_ANCHOR_RADIUS = 3;
const DANGER_RADIUS = 24;
const ROUTE_STEP = 0.15;
const BEAM = { ax: 0, az: 0, bx: 0, bz: 0, cx: 0, cz: 0, ox: 0, oz: 0, ang: 0 };

const finite = Number.isFinite;
const distance = (x0, z0, x1, z1) => Math.hypot(x1 - x0, z1 - z0);

export function presenceAnchor(world) {
  const anchor = world?.map?.landmarks?.spawn;
  if (!anchor || !finite(anchor.x) || !finite(anchor.z)) return null;
  return { x: anchor.x, z: anchor.z };
}

function nearPractice(world, x, z, radius) {
  const practice = world.map.practice;
  if (!practice) return false;
  const ring = practice.ring;
  if (ring && finite(ring.x) && finite(ring.z) && finite(ring.r) &&
      distance(x, z, ring.x, ring.z) <= ring.r + radius) return true;
  for (const [point, colliderRadius] of [[practice.cannon, 0.75], [practice.dummy, 0.35]]) {
    if (point && finite(point.x) && finite(point.z) && distance(x, z, point.x, point.z) <= colliderRadius + radius) return true;
  }
  return false;
}

function withinPresenceFootprint(world, x, z) {
  const anchor = presenceAnchor(world);
  if (!anchor || !finite(x) || !finite(z) || distance(x, z, anchor.x, anchor.z) > PRESENCE_RADIUS) return false;
  const map = world.map;
  const radius = tuning.player.radius;
  if (nearPractice(world, x, z, radius)) return false;
  if (map.lawlessAt?.(x, z) || map.onDock(x, z)) return false;
  if (world.raftDeck?.surface(x, z)) return false;
  const ground = map.groundAt(x, z);
  if (tuning.world.waterLevel - ground > tuning.world.wadeMax) return false;
  return true;
}

export function presencePointAllowed(world, x, z) {
  return !!world?.map && withinPresenceFootprint(world, x, z) &&
    canStand(world, x, z, tuning.player.radius);
}

function unsettledAction(ecs, e) {
  return ecs.iframes[e] > 0 ||
    ecs.atkStage[e] > 0 || ecs.atkBuf[e] > 0 || ecs.dashT[e] >= 0 || ecs.dashBuffer[e] > 0 ||
    ecs.castK[e] > 0 || ecs.castLock[e] > 0 || ecs.rBuf[e] > 0 || ecs.qBuf[e] > 0 || ecs.eBuf[e] > 0 ||
    Math.hypot(ecs.kbx[e], ecs.kbz[e]) > 1e-6 || Math.hypot(ecs.vx[e], ecs.vz[e]) > 0.05;
}

function nearbyDanger(world, e) {
  const ecs = world.ecs, x = ecs.x[e], z = ecs.z[e];
  if (ecs.hp[e] < ecs.maxHp[e] || ecs.stagger[e] > 0 || ecs.hurtInv[e] > 0) return true;
  // Burn damage is scheduled independently of nearby projectiles, so a body with an
  // active server burn is unsafe even after the original attacker has left.
  const burn = world.burns?.get(e);
  if (burn && burn.until >= world.tick) return true;
  // Comet trails are persistent damaging segments, not entries in the projectile
  // hazard pool. Check both the body and its fixed safe anchor so admission cannot
  // strand a companion beside a trail that crosses the arrival point.
  const anchor = presenceAnchor(world);
  for (const trail of world.fireTrails || []) {
    if (!trail || !finite(trail.until) || trail.until < world.tick ||
        !finite(trail.x0) || !finite(trail.z0) || !finite(trail.x1) || !finite(trail.z1)) continue;
    const radius = DANGER_RADIUS + 0.85;
    if (segDist(x, z, trail.x0, trail.z0, trail.x1, trail.z1, BEAM) <= radius ||
        (anchor && segDist(anchor.x, anchor.z, trail.x0, trail.z0, trail.x1, trail.z1, BEAM) <= radius)) return true;
  }
  for (let other = 1; other < ecs.cap; other++) {
    if (other === e || !ecs.alive[other] || !(ecs.mask[other] & C.ENEMY) || ecs.dead[other] > 0) continue;
    const def = ENEMIES[ENEMY_KINDS[ecs.enemy[other]]];
    if (!def || def.practice) continue;
    if (distance(x, z, ecs.x[other], ecs.z[other]) <= DANGER_RADIUS + ecs.radius[other]) return true;
  }

  const hazards = world.hazards;
  if (hazards) {
    const tick = world.tick;
    for (let s = 0; s < hazards.cap; s++) {
      if (!hazards.live(s, tick)) continue;
      const p = hazards._path(s, tick);
      if (distance(x, z, p.x, p.z) <= DANGER_RADIUS + hazards.r[s]) return true;
    }
    for (const a of hazards.aoes || []) {
      if (a.cancel || (!a.keep && a.tAct < tick) || (a.tEnd !== undefined && a.tEnd < tick)) continue;
      if (distance(x, z, a.x, a.z) <= DANGER_RADIUS + (a.r || 0)) return true;
    }
    for (const b of hazards.beams || []) {
      if (b.cancel || b.tEnd <= tick || b.tAct > tick + Math.ceil(0.5 / DT)) continue;
      beamSeg(b, Math.max(tick, b.tAct), BEAM);
      if (segDist(x, z, BEAM.ax, BEAM.az, BEAM.bx, BEAM.bz, BEAM) <= DANGER_RADIUS + (b.w || 0)) return true;
    }
    const lava = hazards.lava;
    if (lava && lava.t0 <= tick && distance(x, z, lava.cx, lava.cz) <= DANGER_RADIUS + lava.R) return true;
  }
  return false;
}

export function presenceSafety(world, entity, { anchor = false, fullHealth = false } = {}) {
  const ecs = world?.ecs;
  if (!ecs || !Number.isSafeInteger(entity) || entity < 1 || entity >= ecs.cap || !ecs.alive[entity] ||
      ecs.dead[entity] > 0 || ecs.hp[entity] <= 0) return 'dead';
  if (fullHealth && ecs.hp[entity] < ecs.maxHp[entity]) return 'hurt';
  const x = ecs.x[entity], z = ecs.z[entity], safeAnchor = presenceAnchor(world);
  if (anchor && (!safeAnchor || distance(x, z, safeAnchor.x, safeAnchor.z) > PRESENCE_ANCHOR_RADIUS)) return 'outside_anchor';
  if (!presencePointAllowed(world, x, z)) return 'outside_zone';
  if (nearbyDanger(world, entity) || ((anchor || fullHealth) && unsettledAction(ecs, entity))) return 'danger';
  return null;
}

function pointOnRouteReason(world, x0, z0, x1, z1) {
  const length = distance(x0, z0, x1, z1), steps = Math.max(1, Math.ceil(length / ROUTE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    if (!withinPresenceFootprint(world, x, z)) return 'outside_zone';
    if (!canStand(world, x, z, tuning.player.radius)) return 'blocked';
  }
  return null;
}

// Moves one ordinary walking step. Invalid collision resolution is rolled back to the
// exact prior pose in this tick; this prevents the collider push from escaping the zone.
export function advancePresence(world, entity, target) {
  const ecs = world?.ecs;
  if (!ecs || !Number.isSafeInteger(entity) || entity < 1 || entity >= ecs.cap || !ecs.alive[entity]) {
    return { moved: 0, reason: 'dead' };
  }
  ecs.moveMag[entity] = 0;
  if (ecs.dead[entity] > 0 || ecs.hp[entity] <= 0) return { moved: 0, reason: 'dead' };
  const safetyReason = presenceSafety(world, entity);
  if (safetyReason) return { moved: 0, reason: safetyReason };
  if (!target || !finite(target.x) || !finite(target.z)) return { moved: 0, reason: 'outside_zone' };
  const x0 = ecs.x[entity], y0 = ecs.y[entity], z0 = ecs.z[entity];
  const startReason = pointOnRouteReason(world, x0, z0, x0, z0);
  if (startReason) return { moved: 0, reason: startReason };
  const targetReason = pointOnRouteReason(world, target.x, target.z, target.x, target.z);
  if (targetReason) return { moved: 0, reason: targetReason };
  const dx = target.x - x0, dz = target.z - z0, d = Math.hypot(dx, dz);
  if (d <= 1e-9) return { moved: 0, reason: null };
  const step = Math.min(d, Math.max(0, ecs.speed[entity]) * DT);
  const nx = x0 + dx / d * step, nz = z0 + dz / d * step;
  const routeReason = pointOnRouteReason(world, x0, z0, nx, nz);
  if (routeReason) return { moved: 0, reason: routeReason };

  const oldFacing = ecs.facing[entity];
  const moved = moveWithCollision(world, entity, nx - x0, nz - z0);
  const actual = distance(x0, z0, ecs.x[entity], ecs.z[entity]);
  if (!presencePointAllowed(world, ecs.x[entity], ecs.z[entity]) || actual > step + 1e-6) {
    ecs.x[entity] = x0; ecs.y[entity] = y0; ecs.z[entity] = z0; ecs.facing[entity] = oldFacing;
    return { moved: 0, reason: actual > step + 1e-6 ? 'blocked' : 'outside_zone' };
  }
  if (moved > 1e-9) {
    ecs.facing[entity] = Math.atan2(ecs.x[entity] - x0, ecs.z[entity] - z0);
    ecs.moveMag[entity] = Math.min(1, actual / (Math.max(ecs.speed[entity], 1e-9) * DT));
  }
  return { moved, reason: moved + 1e-9 < step ? 'blocked' : null };
}
