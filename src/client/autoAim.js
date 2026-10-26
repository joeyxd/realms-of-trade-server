// Touch / keyboard-only auto-aim (DOM-free, so node tests import it). main.js calls autoAimPoint() every fixed tick
// while nothing aims by hand. Order: 1) the most imminent hostile projectile on a collision course, 2) the nearest
// lockable body inside the lock range (enemies, and other pirates when both are inside the lawless zone),
// 3) the way you are moving, else the way you face.
import { weaponOf, SKILLS } from '../data/weapons.js';
import { ACT } from '../sim/ecs.js';

// Lock range in units. A melee kit keeps 9 u; the pistol kit locks as far as its bullet flies (speed x life of the
// same SKILLS.pistol numbers firePistol shoots with: 20 x 0.9 = 18 u).
export const MELEE_LOCK = 9;
export function lockRange(weaponIndex) {
  if (weaponOf(weaponIndex).basic !== 'pistol') return MELEE_LOCK;
  const P = SKILLS.pistol;
  return Math.max(MELEE_LOCK, P.speed * P.life);
}

// A pirate (another human, never the local player) is a candidate only while it can be hurt: ready, alive and not
// dying, and the same lawless test world.canHit uses holds for both ends (lawlessAt of the local player and of it).
function isLockablePirate(rec, youId, lawlessAt, selfLawless) {
  if (!selfLawless || !rec.human || rec.enemy || rec.id === youId) return false;
  if (!rec.ready || rec.dying || !(rec.r.hp > 0) || rec.r.act === ACT.DEAD) return false;
  return !!lawlessAt(rec.r.x, rec.r.z);
}

// The nearest lock candidate within `range` of ps, or null. Mobs and pirates compete together.
export function pickLockTarget({ ps, entities, youId, lawlessAt, range }) {
  const selfLawless = !!lawlessAt && !!lawlessAt(ps.x, ps.z);
  let best = null, bd = range;
  for (const rec of entities.values()) {
    const mob = rec.enemy && rec.ready && !rec.dying && rec.enemy !== 'cannon';
    if (!mob && !isLockablePirate(rec, youId, lawlessAt, selfLawless)) continue;
    const d = Math.hypot(rec.r.x - ps.x, rec.r.z - ps.z);
    if (d < bd) { bd = d; best = rec; }
  }
  return best;
}

// Writes the aim point into out ({x, y, z}) and returns out.
// ctx: { ps, H (hazards), pt, reach (hurt radius + graze + margin), entities, youId, lawlessAt }.
export function autoAimPoint(ctx, mv, out) {
  const { ps, H, pt, reach } = ctx;
  let threat = -1, tBest = 0.7;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt)) continue;
    const v = H.velocityAt(s, pt), rx = ps.x - H.px(s, pt), rz = ps.z - H.pz(s, pt), v2 = v.x * v.x + v.z * v.z;
    if (v2 < 1e-6) continue;
    const tca = (rx * v.x + rz * v.z) / v2;
    if (tca < 0 || tca > tBest) continue;
    if (Math.hypot(rx - v.x * tca, rz - v.z * tca) > reach + H.r[s]) continue;
    threat = s; tBest = tca;
  }
  if (threat >= 0) { out.x = H.px(threat, pt); out.y = ps.y; out.z = H.pz(threat, pt); return out; }
  const best = pickLockTarget({ ps, entities: ctx.entities, youId: ctx.youId, lawlessAt: ctx.lawlessAt, range: lockRange(ps.weapon) });
  if (best) { out.x = best.r.x; out.y = ps.y; out.z = best.r.z; }
  else if (Math.hypot(mv.x, mv.z) > 0.2) { out.x = ps.x + mv.x * 3; out.y = ps.y; out.z = ps.z + mv.z * 3; }
  else { out.x = ps.x + Math.sin(ps.f) * 3; out.y = ps.y; out.z = ps.z + Math.cos(ps.f) * 3; }
  return out;
}
