// SRV01 needs run in the existing M5 command authority and reuse its attached profile.
import { FOODS, SURVIVAL, meterValue, needPenalty, readSurvField, staminaRegenMul } from '../../data/survival.js';
import { refreshStats } from './stats.js';

const clamp = (v) => Math.max(0, Math.min(SURVIVAL.max, v));
const integerPart = (v) => Math.floor(v + 1e-9);

function updateStats(world, e) {
  const ecs = world.ecs, next = needPenalty(ecs.sat[e], ecs.hyd[e]);
  if (next === ecs.needPen[e]) return false;
  const hp = ecs.hp[e];
  ecs.needPen[e] = next;
  refreshStats(world, e);
  // A larger maximum from restored needs never heals current HP.
  if (ecs.dead[e] > 0) ecs.hp[e] = 0;
  else ecs.hp[e] = Math.min(hp, ecs.maxHp[e]);
  return true;
}

function writeSurv(profile, ecs, e) {
  const sat = meterValue(ecs.sat[e]), hyd = meterValue(ecs.hyd[e]);
  if (sat >= SURVIVAL.max && hyd >= SURVIVAL.max) {
    // Keep an explicit full meter when the durable profile already carries one. Some M5 deltas
    // distinguish an omitted field from a deliberate full value.
    if (!readSurvField(profile).present) return;
  } else profile.surv = { v: SURVIVAL.version, sat, hyd };
  if (sat >= SURVIVAL.max && hyd >= SURVIVAL.max) profile.surv = { v: SURVIVAL.version, sat, hyd };
}

export function syncNeeds(profile, ecs, e) {
  if (!(ecs.needs[e] > 0) || !profile) return false;
  writeSurv(profile, ecs, e);
  return true;
}

function setNeeds(world, e, sat, hyd, { dirty = true } = {}) {
  const ecs = world.ecs, oldSat = ecs.sat[e], oldHyd = ecs.hyd[e];
  ecs.sat[e] = clamp(sat); ecs.hyd[e] = clamp(hyd);
  if (world.isServer) syncNeeds(world.profiles?.get(e), ecs, e);
  const changed = updateStats(world, e);
  if (dirty && world.isServer && world.profileDirty &&
      (integerPart(oldSat) !== integerPart(ecs.sat[e]) || integerPart(oldHyd) !== integerPart(ecs.hyd[e]))) {
    world.profileDirty.add(e);
  }
  return changed;
}

export function stepNeeds(world, e, cmd, dt) {
  const ecs = world.ecs;
  if (world.survivalEnabled !== true || !(ecs.needs[e] > 0) || ecs.dead[e] > 0) return false;
  const active = Math.hypot(cmd.mx || 0, cmd.mz || 0) > 0.05 || ecs.swim[e] > 0;
  const rate = dt * (active ? SURVIVAL.active : 1);
  return setNeeds(world, e, ecs.sat[e] - SURVIVAL.drain.sat * rate, ecs.hyd[e] - SURVIVAL.drain.hyd * rate);
}

export function attachNeeds(world, e, profile) {
  if (world.survivalEnabled !== true) return false;
  const field = readSurvField(profile);
  if (field.present && !field.value) return false;
  const surv = field.value;
  const ecs = world.ecs;
  ecs.needs[e] = 1;
  ecs.sat[e] = surv ? surv.sat : SURVIVAL.max;
  ecs.hyd[e] = surv ? surv.hyd : SURVIVAL.max;
  ecs.needPen[e] = needPenalty(ecs.sat[e], ecs.hyd[e]);
  return true;
}

// Apply a profile already committed by the existing M5 writer; this helper owns no persistence or inventory.
export function applyNeedsProfile(world, e, profile) {
  if (world.survivalEnabled !== true || !profile) return false;
  const field = readSurvField(profile);
  if (field.present && !field.value) return false;
  if (world.profiles?.has(e)) world.profiles.set(e, profile);
  const surv = field.value, ecs = world.ecs;
  ecs.needs[e] = 1;
  ecs.sat[e] = surv ? surv.sat : SURVIVAL.max;
  ecs.hyd[e] = surv ? surv.hyd : SURVIVAL.max;
  updateStats(world, e);
  return true;
}

export function respawnNeeds(world, e) {
  if (world.survivalEnabled !== true || !(world.ecs.needs[e] > 0)) return false;
  setNeeds(world, e, SURVIVAL.respawn, SURVIVAL.respawn);
  return true;
}

// Pure pack-operation helper: returns a cloned profile with the candidate restored meters, or null if invalid/no-op.
export function consumeNeeds(profile, food) {
  if (!profile || typeof profile !== 'object' || !food || typeof food !== 'string' || !Object.hasOwn(FOODS, food)) return null;
  const field = readSurvField(profile);
  if (field.present && !field.value) return null;
  const sat0 = field.value?.sat ?? SURVIVAL.max, hyd0 = field.value?.hyd ?? SURVIVAL.max;
  const gain = FOODS[food], sat = meterValue(sat0 + gain.sat), hyd = meterValue(hyd0 + gain.hyd);
  if (sat === sat0 && hyd === hyd0) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(profile); } catch { return null; }
  const candidate = {};
  for (const [key, d] of Object.entries(descriptors)) {
    if (!d.enumerable) continue;
    if (!Object.hasOwn(d, 'value')) return null;
    candidate[key] = d.value;
  }
  candidate.surv = { v: SURVIVAL.version, sat, hyd };
  return candidate;
}

export { staminaRegenMul };
