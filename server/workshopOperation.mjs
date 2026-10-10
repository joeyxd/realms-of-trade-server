// First-storage quest and personal backpack upgrades use M5's existing profile transaction.
import { CARRY, carryLimits, nextBackpack, readCarryField } from '../src/data/carry.js';
import { readWorkshop, workshopPlan, WorkshopError } from '../src/sim/systems/workshop.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { holdMass, holdUsed } from '../src/sim/economy/cargo.js';
import { communityAccess } from './communityProject.mjs';

const PACK_COSTS = Object.freeze({ 1: Object.freeze({ lona: 3, madera: 2 }), 2: Object.freeze({ lona: 5, madera: 4 }) });
const exact = (raw, keys) => raw && typeof raw === 'object' && !Array.isArray(raw)
  && [Object.prototype, null].includes(Object.getPrototypeOf(raw))
  && Reflect.ownKeys(Object.getOwnPropertyDescriptors(raw)).length === keys.length
  && keys.every(key => { const d = Object.getOwnPropertyDescriptor(raw, key); return d?.enumerable && Object.hasOwn(d, 'value'); });
const safeRev = n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483646;

function carryView(carry, profile) {
  const limits = carryLimits(carry, profile.lvl);
  return { v: CARRY.version, backpack: carry.backpack, volume: limits.volume,
    strength: limits.strength, maxMass: limits.maxMass };
}

function profileCarryView(profile) {
  const field = readCarryField(profile);
  if (field.present && !field.value) return null;
  return carryView(field.value || { v: CARRY.version, backpack: 0 }, profile);
}

function workshopValue(profile) {
  const state = readWorkshop(profile?.workshop);
  if (profile?.workshop === undefined && readProgression(profile?.progression).knowledge.includes('raft_storage')) {
    state.boards = 10; state.storageCredit = false;
  }
  return state;
}

function upgradePack(profile) {
  const rev = profile?.eco?.tradeRev;
  if (!safeRev(rev)) return { why: 'profile' };
  if (rev >= 2147483646) return { why: 'limit' };
  let workshop;
  try { workshop = workshopValue(profile); } catch { return { why: 'profile' }; }
  const field = readCarryField(profile);
  if (field.present && !field.value) return { why: 'carry' };
  const current = field.value || { v: CARRY.version, backpack: 0 };
  const next = nextBackpack(current);
  if (!next) return { why: 'max' };
  const cost = PACK_COSTS[next.backpack], pack = profile.eco?.pack, goods = pack?.goods;
  if (!cost || !goods || typeof goods !== 'object' || Array.isArray(goods)) return { why: 'profile' };
  for (const [good, count] of Object.entries(cost)) if (!Number.isSafeInteger(goods[good] ?? 0) || (goods[good] ?? 0) < count) return { why: 'goods' };
  const cloned = structuredClone(profile);
  for (const [good, count] of Object.entries(cost)) {
    cloned.eco.pack.goods[good] -= count;
    if (!cloned.eco.pack.goods[good]) delete cloned.eco.pack.goods[good];
  }
  const limits = carryLimits(next, profile.lvl);
  if (holdUsed(cloned.eco.pack) > limits.volume || holdMass(cloned.eco.pack) > limits.maxMass) return { why: 'capacity' };
  cloned.carry = next;
  cloned.eco.pack.cap = limits.volume;
  cloned.eco.pack.maxMass = limits.maxMass;
  cloned.eco.tradeRev++;
  return { profile: cloned, carry: carryView(next, cloned), workshop, why: '' };
}

function validCommand(command) {
  if (!command || !['contribute', 'craftCrate', 'upgradePack'].includes(command.op)) return false;
  const keys = command.op === 'contribute'
    ? ['t', 'type', 'op', 'opId', 'expectedRev', 'amount'] : ['t', 'type', 'op', 'opId', 'expectedRev'];
  const wire = Object.hasOwn(command, 't');
  const shape = wire ? exact(command, keys) : exact(command, keys.filter(key => key !== 't'));
  return shape && (!wire || command.t === 'cmd') && command.type === 'artisan'
    && typeof command.opId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(command.opId)
    && safeRev(command.expectedRev)
    && (command.op !== 'contribute' || Number.isSafeInteger(command.amount) && command.amount >= 1 && command.amount <= 10);
}

// Deterministic profile delta shared by memory/SQL validation and the authorized host draft.
export function workshopProfileDelta(profile, command) {
  if (!validCommand(command) || !profile || typeof profile !== 'object') return { profile, why: 'command' };
  const rev = profile?.eco?.tradeRev;
  if (!safeRev(rev) || command.expectedRev !== rev) return { profile, why: 'conflict' };
  try {
    let result;
    if (command.op === 'upgradePack') result = upgradePack(profile);
    else result = workshopPlan(profile, { type: command.op === 'contribute' ? 'contribute' : 'craftCrate',
      ...(command.op === 'contribute' ? { amount: command.amount } : {}), expectedRev: command.expectedRev });
    if (result.why) return { profile, why: result.why };
    const next = result.profile;
    return { profile: next, why: '', workshop: result.workshop || next.workshop || workshopValue(next),
      carry: result.carry || profileCarryView(next) };
  } catch (error) {
    return { profile, why: error instanceof WorkshopError ? error.code : 'profile' };
  }
}

export function draftWorkshop({ command, profile, world, entity, state }) {
  const initialRev = Number.isSafeInteger(profile?.eco?.tradeRev) ? profile.eco.tradeRev : 0;
  const ack = { type: 'artisan', op: command?.op || '', opId: command?.opId || '', ok: false,
    why: '', rev: initialRev, workshop: null, carry: null };
  let why = '';
  try { why = communityAccess(world, entity); } catch { why = 'disabled'; }
  if (!why && !validCommand(command)) why = 'command';
  if (!why && command.expectedRev !== initialRev) why = 'conflict';
  if (!why) {
    const delta = workshopProfileDelta(profile, command);
    if (delta.why) why = delta.why;
    else {
      ack.ok = true; ack.rev = delta.profile.eco.tradeRev;
      ack.workshop = delta.workshop; ack.carry = delta.carry;
      return { profile: delta.profile, community: state, ack };
    }
  }
  ack.why = why;
  return { profile, community: state, ack };
}

export { PACK_COSTS };
