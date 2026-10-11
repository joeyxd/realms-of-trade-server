// The spring channel uses the existing simulation tick. No fuel/needs clock or save writer.
import { C, KIND } from '../ecs.js';
import { FRESHWATER, freshwaterSource, isCanteenCommand } from '../../data/freshwater.js';
import { applyNeedsProfile } from './survival.js';
import { FOODS, SURVIVAL } from '../../data/survival.js';
import { checkedFreshwaterCommand, freshwaterProfileDelta } from './freshwaterProfile.js';
import { readVessels } from '../economy/waterContainers.js';
import { RAFT } from '../../data/raftparts.js';
import { activeRaftParts } from '../naval/condition.js';
import { raftCapacity } from '../economy/raftCapacity.js';

const barrelDistance = (pose,part,position) => {
  const x=(part[1]+.5)*RAFT.cell, z=(part[2]+.5)*RAFT.cell,c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  if (Math.abs(position.y-pose.y-part[3]*RAFT.levelHeight)>.6) return Infinity;
  return Math.hypot(position.x-pose.x-c*x-s*z,position.z-pose.z+s*x-c*z);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const reply = (w, e, cmd, why, extra = {}) => w.emit({ type: 'freshwater', to: e,
  op: cmd.op, opId: cmd.opId, ok: !why, why: why || '', rev: w.profiles.get(e)?.eco.tradeRev || 0, ...extra });

export function freshwaterAccess(w, e, cmd, proof = true) {
  const ecs = w.ecs;
  if (!w.freshwaterEnabled) return 'disabled';
  if (isCanteenCommand(cmd) && !w.survivalEnabled) return 'disabled';
  if (!ecs.alive[e] || ecs.kind[e] !== KIND.PLAYER || ecs.mask[e] & C.BOT || ecs.dead[e] || ecs.hp[e] <= 0) return 'dead';
  if (w.navalPilot?.locked?.(e)) return 'busy';
  if (['fill', 'fillCanteen'].includes(cmd.op)) {
    const source = freshwaterSource(w.map);
    if (!source || cmd.source !== source.id || source.y < .3) return 'source';
    if (Math.hypot(ecs.x[e] - source.x, ecs.z[e] - source.z) > source.radius || Math.abs(ecs.y[e] - source.y) > 2) return 'far';
    if (ecs.regenT[e] < 3) return 'combat';
    if (proof) {
      const ready = w.freshwaterProofs?.get(e);
      if (!ready || !same(ready.command, cmd) || ready.until < w.tick) return 'interrupted';
    }
  }
  if (['deposit', 'withdraw'].includes(cmd.op) || cmd.op === 'refillCanteen' && cmd.source === 'barrel') {
    const active = w.rafts?.get(cmd.ship);
    if (!active || active.owner !== e || active.ship.hp <= 0) return 'owner';
    const entry = active.condition?.entries.find(p => p.id === cmd.part && p.part[0] === 'waterBarrel');
    if (!entry || entry.hp <= 0) return 'condition';
    const pose = { x: ecs.x[active.entity], y: ecs.y[active.entity], z: ecs.z[active.entity], yaw: ecs.facing[active.entity] };
    if (barrelDistance(pose, entry.part, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }) > 3.5) return 'far';
  }
  return '';
}

export function freshwaterDraft(w, e, command, profile) {
  let why = freshwaterAccess(w, e, command);
  const result = why ? null : freshwaterProfileDelta(profile, command);
  why ||= result?.why;
  if (!why && command.op === 'deposit') {
    const active = w.rafts.get(command.ship), ship = result.profile.eco.ships.find(s => s.id === command.ship);
    if (raftCapacity(activeRaftParts(active), ship.hold).overMass > raftCapacity(activeRaftParts(active), active.ship.hold).overMass + 1e-8) why = 'room';
  }
  return { profile: why ? structuredClone(profile) : result.profile,
    ack: { type: 'freshwater', op: command.op, opId: command.opId, ok: !why, why: why || '',
      rev: why ? profile.eco.tradeRev : result.profile.eco.tradeRev } };
}

export function beginFreshwater(w, e, raw, ready) {
  const command = checkedFreshwaterCommand(raw);
  if (!command || !['fill', 'fillCanteen'].includes(command.op)) { reply(w, e, raw || {}, 'command'); return; }
  const previous = w.freshwaterGather?.get(e);
  if (previous) {
    if (!same(previous.command, command)) reply(w, e, command, 'busy');
    else reply(w, e, command, '', { stage: 'gathering', progress: Math.min(1, (w.tick - previous.tick) / FRESHWATER.collectTicks) });
    return;
  }
  const why = freshwaterAccess(w, e, command, false) || freshwaterProfileDelta(w.profiles.get(e), command).why;
  if (why) { reply(w, e, command, why); return; }
  const ecs = w.ecs;
  (w.freshwaterGather ||= new Map()).set(e, { command, ready, tick: w.tick, x: ecs.x[e], z: ecs.z[e], hp: ecs.hp[e], regen: ecs.regenT[e] });
  reply(w, e, command, '', { stage: 'gathering', progress: 0 });
}

// Called before opening the next tick boundary: a completed channel enters the same M5 lane.
export function stepFreshwater(w) {
  for (const [e, g] of w.freshwaterGather || []) {
    const ecs = w.ecs;
    const why = freshwaterAccess(w, e, g.command, false) ||
      (Math.hypot(ecs.x[e] - g.x, ecs.z[e] - g.z) > .15 || ecs.hp[e] < g.hp || ecs.regenT[e] < g.regen ||
        ecs.moveMag[e] > .01 || ecs.dashT[e] >= 0 || ecs.castK[e] > 0 || ecs.castLock[e] > 0 ? 'interrupted' : '');
    g.regen = ecs.regenT[e];
    if (why) { w.freshwaterGather.delete(e); reply(w, e, g.command, why === 'combat' ? 'interrupted' : why); continue; }
    if (w.tick - g.tick < FRESHWATER.collectTicks) continue;
    w.freshwaterGather.delete(e);
    (w.freshwaterProofs ||= new Map()).set(e, { command: g.command, until: w.tick + 1 });
    g.ready(g.command);
  }
}

export function freshwaterStatus(w, e) {
  if (!w.freshwaterEnabled) return { enabled: false, source: null, barrels: [], gathering: 0 };
  const source = freshwaterSource(w.map), ecs = w.ecs, g = w.freshwaterGather?.get(e), barrels = [];
  for (const active of w.rafts?.values() || []) if (active.owner === e) {
    const saved = readVessels(active.ship.hold?.vessels);
    const pose = { x: ecs.x[active.entity], y: ecs.y[active.entity], z: ecs.z[active.entity], yaw: ecs.facing[active.entity] };
    for (const entry of active.condition?.entries || []) if (entry.part[0] === 'waterBarrel') barrels.push({
      ship: active.ship.id, part: entry.id, water: saved.find(v => v.id === entry.id)?.water || 0,
      capacity: FRESHWATER.barrelCapacity, broken: entry.hp <= 0,
      near: barrelDistance(pose, entry.part, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }) <= 3.5 });
  }
  return { enabled: true, canteenEnabled: w.survivalEnabled === true,
    ...(w.survivalEnabled ? { needs: { sat: ecs.sat[e], hyd: ecs.hyd[e], penalty: ecs.needPen[e] } } : {}), source: source && { id: source.id,
    near: Math.hypot(ecs.x[e] - source.x, ecs.z[e] - source.z) <= source.radius && Math.abs(ecs.y[e] - source.y) <= 2 }, barrels,
    gathering: g ? Math.min(1, (w.tick - g.tick) / FRESHWATER.collectTicks) : 0 };
}

export function localFreshwaterCmd(w, e, command, saveFits = () => true) {
  const cache = (w.freshwaterReceipts ||= new Map()).get(e) || new Map(), key = JSON.stringify(command);
  const prior = cache.get(command.opId);
  if (prior) { w.emit(prior.key === key ? { ...prior.ack, replay: true, to: e } :
    { type: 'freshwater', op: command.op, opId: command.opId, ok: false, why: 'duplicate', rev: 0, to: e }); return; }
  const result = freshwaterDraft(w, e, command, w.profiles.get(e));
  if (result.ack.ok && !saveFits(result.profile)) result.ack = { ...result.ack, ok: false, why: 'saveSize', rev: w.profiles.get(e).eco.tradeRev };
  if (result.ack.ok) {
    const p = w.profiles.get(e), next = result.profile;
    p.eco.pack = next.eco.pack; p.eco.tradeRev = next.eco.tradeRev;
    if (next.surv) { p.surv = structuredClone(next.surv); applyNeedsProfile(w, e, p); }
    if (command.op === 'eat' && FOODS[command.source]?.sat > 0)
      w.ecs.hp[e] = Math.min(w.ecs.maxHp[e], w.ecs.hp[e] + w.ecs.maxHp[e] * SURVIVAL.foodHeal);
    p.eco.ships.forEach((ship,index) => { const candidate=next.eco.ships[index]; ship.hold=candidate.hold; ship.rev=candidate.rev; });
    w.profileDirty.add(e);
  }
  cache.set(command.opId, { key, ack: result.ack });
  while (cache.size > 64) cache.delete(cache.keys().next().value);
  w.freshwaterReceipts.set(e, cache); reply(w, e, command, result.ack.why, result.ack);
}
