// La Cala Calavera (M4.5, PLAN-M4.5.md §2.5): the mobs inside hurt each other. Server only, once per world step.
// A hostile bullet or ground circle that reaches a mob inside the Cala (any mob but the one that made it) lands on
// it; the mob hit turns on whoever hit it (damageEnemy sets its foe, pickTarget keeps it). Pirates still get hit by
// the same bullets through their own commands (systems/combat.js): whatever touches first takes it.
import { C } from '../ecs.js';
import { KILL, PTYPE } from '../projectiles.js';
import { damageEnemy } from './enemies.js';
import { LAWLESS } from '../../data/lawless.js';

const inside = [];

export function stepInfighting(world) {
  const map = world.map, K = map.cala;
  if (!map.lawlessAt || !K) return;
  const ecs = world.ecs, H = world.hazards, t = world.tick;
  // The Cala only boils while a pirate is near it (the Desalmados hunt mobs then: pickTarget).
  if (t % 30 === 0) {
    world.calaAwake = false;
    for (let p = 1; p < ecs.cap && !world.calaAwake; p++) {
      if (ecs.alive[p] && (ecs.mask[p] & C.PLAYER) && !(ecs.mask[p] & C.BOT) && Math.hypot(ecs.x[p] - K.x, ecs.z[p] - K.z) < K.r + LAWLESS.wake) world.calaAwake = true;
    }
  }
  inside.length = 0;
  for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && !(ecs.dead[o] > 0) && map.lawlessAt(ecs.x[o], ecs.z[o])) inside.push(o);
  if (!inside.length) return;
  const R2 = (K.r + 1) ** 2;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, t) || !H.armed(s, t)) continue;
    const own = H.owner[s];
    if (!own) continue; // the environment's (tests, practice): nobody's
    const x = H.px(s, t), z = H.pz(s, t);
    if ((x - K.x) ** 2 + (z - K.z) ** 2 > R2) continue;
    for (const o of inside) {
      if (o === own || ecs.dead[o] > 0) continue;
      const rr = ecs.hurtR[o] + H.r[s];
      if ((ecs.x[o] - x) ** 2 + (ecs.z[o] - z) ** 2 > rr * rr) continue;
      H.remove(s, t, KILL.HIT, o, 0);
      world.emit({ type: 'phit', pid: H.id[s], e: o, seq: 0, x, z, ff: 1 });
      damageEnemy(world, o, H.dmg[s] * LAWLESS.mobDmg, { by: own, kind: 'ff', x: x - H.vx[s] * 0.05, z: z - H.vz[s] * 0.05, knock: 3, heavy: H.type[s] === PTYPE.HEAVY });
      break;
    }
  }
  // Ground circles bursting this tick (bites, cleaves, mortar shells).
  for (const a of H.aoes) {
    if (a.cancel || a.tAct !== t || !a.owner) continue;
    if ((a.x - K.x) ** 2 + (a.z - K.z) ** 2 > R2) continue;
    for (const o of inside) {
      if (o === a.owner || !ecs.alive[o] || ecs.dead[o] > 0) continue;
      if (Math.hypot(ecs.x[o] - a.x, ecs.z[o] - a.z) > a.r + ecs.hurtR[o] * 0.5) continue;
      damageEnemy(world, o, a.dmg * LAWLESS.mobDmg, { by: a.owner, kind: 'ff', x: a.sx ?? a.x, z: a.sz ?? a.z, knock: 5 });
    }
  }
}
