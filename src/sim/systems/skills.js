// Weapons and their skills (M3.5). One step per command, after movement, inside stepPlayerCombat:
// shared verbatim by the server and the client's prediction, like the rest of player combat.
//
//   Equip  cmd.w = weapon + 1. Only next to a rack (map.racks, RACK_R): a swing, the guard and a cast in
//          progress are dropped; the cooldowns carry over.
import { WEAPON_KINDS, RACK_R } from '../../data/weapons.js';

// The rack within reach of (x, z), or null.
export function rackNear(map, x, z, r = RACK_R) {
  for (const k of map.racks || []) if (Math.hypot(x - k.x, z - k.z) <= r) return k;
  return null;
}

export function stepEquip(world, e, cmd) {
  const ecs = world.ecs, want = (cmd.w | 0) - 1;
  if (want < 0 || want >= WEAPON_KINDS.length || want === ecs.weapon[e] || ecs.dead[e] > 0) return false;
  if (!rackNear(world.map, ecs.x[e], ecs.z[e])) return false;
  setWeapon(world, e, want, cmd.seq >>> 0);
  return true;
}

export function setWeapon(world, e, w, seq = 0) {
  const ecs = world.ecs;
  ecs.weapon[e] = w;
  ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0; ecs.lastStage[e] = 0;
  ecs.guardT[e] = -1;
  ecs.castK[e] = 0; ecs.castT[e] = 0; ecs.qBuf[e] = ecs.eBuf[e] = 0; ecs.shotCd[e] = 0; ecs.shotN[e] = 0;
  world.emit({ type: 'equip', e, weapon: w, seq, x: ecs.x[e], z: ecs.z[e] });
}
