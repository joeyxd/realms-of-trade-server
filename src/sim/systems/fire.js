// Private fire uses one paid fuel unit and the shared simulation clock. Public town props are exempt.
import { C, KIND } from '../ecs.js';
import { fireClockSeconds } from '../../data/fire.js';
import { readFire, fireRows, changeFireSlot } from '../economy/fire.js';
import { fireProfileDelta } from './fireProfile.js';
import { litLanternParts, lanternDistance, LANTERN_REACH } from '../naval/lantern.js';

export const poweredFireKeys = (w, active) => w.fireEnabled ? new Set(litLanternParts(active, w).map(part => JSON.stringify(part))) : null;
export const fireSeconds = w => fireClockSeconds(w.economy.hours);
export function fireAccess(w, e, command) {
  const ecs = w.ecs;
  if (!ecs.alive[e] || ecs.kind[e] !== KIND.PLAYER || !(ecs.mask[e] & C.PLAYER) ||
      ecs.mask[e] & C.BOT || ecs.hp[e] <= 0 || ecs.dead[e]) return 'condition';
  if (command.ship === '' && command.part === 'hand') return '';
  const active = w.rafts?.get(command.ship);
  if (!active || active.owner !== e || active.ship.hp <= 0) return 'owner';
  const entry = active.condition?.entries.find(p => p.id === command.part && p.hp > 0 && p.part[0] === command.kind);
  if (!entry) return 'condition';
  const record = { x: ecs.x[active.entity], y: ecs.y[active.entity], z: ecs.z[active.entity], yaw: ecs.facing[active.entity] };
  return lanternDistance(record, entry.part, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }) <= LANTERN_REACH ? '' : 'far';
}

export function fireStatus(w, e) {
  if (w.fireEnabled !== true) return { enabled: false, rev: 0, slots: [] };
  const profile = w.profiles.get(e);
  const state = readFire(profile?.fire);
  return { enabled: w.fireEnabled === true, rev: state.rev, slots: fireRows(state, fireSeconds(w)) };
}

export function syncFireLight(w, e) {
  if (!w.fireEnabled) return;
  const hand = fireStatus(w, e).slots.find(slot => slot.key === 'hand');
  w.ecs.lantern[e] = Number(!!hand?.lit && !w.ecs.dead[e] && w.ecs.hp[e] > 0 && !w.fireHandOff?.has(e));
}

// Death/reentry hides the hand flame without giving back fuel or resetting its paid clock.
export function hideHandFire(w, e) {
  const profile = w.profiles.get(e);
  if (profile?.fire?.slots?.hand?.lit) {
    const next = changeFireSlot(profile.fire, 'hand', { op: 'set', lit: false, kind: 'handTorch' }, fireSeconds(w));
    if (!next.why) { profile.fire = next.state; w.profileDirty.add(e); }
  }
  (w.fireHandOff ||= new Set()).add(e);
  if (w.ecs.lantern) w.ecs.lantern[e] = 0;
}

export function applyFireProfile(w, e, next) {
  const profile = w.profiles.get(e);
  profile.fire = structuredClone(next.fire);
  profile.eco.pack = structuredClone(next.eco.pack);
  profile.eco.tradeRev = next.eco.tradeRev;
  for (const ship of profile.eco.ships) {
    const candidate = next.eco.ships.find(s => s.id === ship.id);
    if (candidate) ship.hold = structuredClone(candidate.hold);
  }
  w.fireHandOff?.delete(e);
  syncFireLight(w, e);
  w.profileDirty.add(e);
}

// Solo uses the same candidate math. Online intercepts this command in M5 before LocalServer.
export function localFireCmd(w, e, command, saveFits = () => true) {
  const { t, ...payload } = command;
  const key = JSON.stringify(payload);
  const cache = (w.fireReceipts ||= new Map()).get(e) || new Map();
  const prior = cache.get(command.opId);
  if (prior) {
    const ack = prior.key === key ? { ...prior.ack, replay: true } : { type: 'fire', op: command.op, opId: command.opId, ok: false, why: 'duplicate', rev: readFire(w.profiles.get(e)?.fire).rev, to: e };
    w.emit(ack); return ack;
  }
  let why = w.fireEnabled ? fireAccess(w, e, command) : 'disabled';
  let result;
  if (!why) {
    try { result = fireProfileDelta(w.profiles.get(e), payload, fireSeconds(w)); why = result.why; }
    catch { why = 'command'; }
  }
  if (!why && !saveFits(result.profile)) why = 'saveSize';
  if (!why) applyFireProfile(w, e, result.profile);
  const ack = { type: 'fire', op: command.op, opId: command.opId, ok: !why, why: why || '',
    rev: readFire(w.profiles.get(e)?.fire).rev, to: e };
  cache.set(command.opId, { key, ack });
  while (cache.size > 64) cache.delete(cache.keys().next().value);
  w.fireReceipts.set(e, cache);
  while (w.fireReceipts.size > 256) w.fireReceipts.delete(w.fireReceipts.keys().next().value);
  w.emit(ack);
  return ack;
}
