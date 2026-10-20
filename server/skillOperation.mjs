// Skill points use the existing M5 economic lane. This module builds and checks a candidate only.
import { planSkillChange } from '../src/sim/systems/skillPlan.js';
import { RESET_FREE, SKILL_RESET_GOLD } from '../src/data/skillTree.js';
import { canonicalText } from './pearlOperations.mjs';

export const skillMutation = command => command?.type === 'skills';

export function draftSkills(profile, command) {
  const planned = planSkillChange(profile, command);
  return { profile: planned.profile, ack: {
    type: 'skills', op: command.op, opId: command.opId, ok: planned.ok, why: planned.why,
    rev: planned.profile.eco.tradeRev,
  } };
}

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const without = (v, keys) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const TREE_IDS = ['combat', 'survival', 'sailing', 'crafting', 'trade', 'exploration'];
const NODE_ID = /^[a-z][a-z0-9_]{0,39}$/;

// SQL041's persisted schema bounds, independent of today's catalog membership and grant caps.
function storedProgression(p) {
  if (!object(p) || !integer(p.v, 1, 3)) return false;
  const required = ['v', 'practice', 'milestones', 'knowledge'], optional = ['skills', 'skr', 'skg'];
  if (!exact(p, [...required, ...(p.v === 3 ? optional.filter(k => Object.hasOwn(p, k)) : [])]) ||
      !object(p.practice) || !integer(p.practice.logging, 0, 1000000000) ||
      Object.entries(p.practice).some(([k, n]) => !(p.v === 3
        ? ['logging', 'survival', 'sailing', 'crafting', 'trade'] : ['logging']).includes(k) || !integer(n, 0, 1000000000)) ||
      !Array.isArray(p.milestones) || p.milestones.length > (p.v === 1 ? 1 : 2) ||
      p.milestones.some(k => k !== 'logging_steady' && !(p.v >= 2 && k === 'pilot_coastal')) ||
      new Set(p.milestones).size !== p.milestones.length ||
      !Array.isArray(p.knowledge) || p.knowledge.length > 1 || p.knowledge.some(k => k !== 'raft_storage')) return false;
  if (Object.hasOwn(p, 'skills') && (!object(p.skills) || Object.keys(p.skills).length > 90 ||
      Object.entries(p.skills).some(([k, n]) => !NODE_ID.test(k) || !integer(n, 0, 3)))) return false;
  return ['skr', 'skg'].every(k => !Object.hasOwn(p, k) || object(p[k]) &&
    Object.entries(p[k]).every(([tree, n]) => TREE_IDS.includes(tree) && integer(n, 0, k === 'skr' ? 1000 : 45)));
}

// The caller checks the JSON envelope and non-progression profile fields. Mirror
// mn_valid_skill_request's diff, never re-plan a historical receipt with current gameplay rules.
export function validStoredSkillRequest(request) {
  try {
    const { before: b, profile: n, command: cmd, ack } = request;
    if (!object(cmd) || !['assign', 'reset'].includes(cmd.op) ||
        !exact(cmd, ['type', 'op', 'opId', 'expectedRev', 'tree', ...(cmd.op === 'assign' ? ['node'] : [])]) ||
        cmd.type !== 'skills' || typeof cmd.opId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cmd.opId) ||
        !integer(cmd.expectedRev, 0, 2147483645) || !TREE_IDS.includes(cmd.tree) ||
        cmd.op === 'assign' && (typeof cmd.node !== 'string' || !NODE_ID.test(cmd.node))) return false;
    if (!exact(ack, ['type', 'op', 'opId', 'ok', 'why', 'rev']) ||
        ack.type !== 'skills' || ack.op !== cmd.op || ack.opId !== cmd.opId ||
        typeof ack.ok !== 'boolean' || typeof ack.why !== 'string' || ack.why.length > 64 ||
        !object(b) || !object(n) || !object(b.eco) || !object(n.eco) ||
        !integer(b.eco.tradeRev, 0, 2147483646)) return false;
    for (const p of [b, n]) if (Object.hasOwn(p, 'progression') && !storedProgression(p.progression)) return false;
    if (!ack.ok) return same(n, b) && ack.rev === b.eco.tradeRev && ack.why !== '';
    if (ack.why !== '' || cmd.expectedRev !== b.eco.tradeRev || ack.rev !== cmd.expectedRev + 1 ||
        n.eco.tradeRev !== ack.rev || !same(without(n, ['progression', 'gold', 'eco']), without(b, ['progression', 'gold', 'eco'])) ||
        !same(without(n.eco, ['tradeRev']), without(b.eco, ['tradeRev'])) ||
        !integer(b.gold, 0, 1000000000) || !integer(n.gold, 0, 1000000000)) return false;
    const bp = b.progression ?? { v: 1, practice: { logging: 0 }, milestones: [], knowledge: [] }, np = n.progression;
    if (!object(np) || np.v !== 3 || !Object.hasOwn(np, 'skills') ||
        ['practice', 'milestones', 'knowledge'].some(k => !same(np[k], bp[k]))) return false;
    const adopted = Object.hasOwn(bp, 'skills'), used = bp.skr?.[cmd.tree] ?? 0;
    if (adopted ? !same(without(np, ['skills', 'skr']), without(bp, ['skills', 'skr']))
      : !exact(np, ['v', 'practice', 'milestones', 'knowledge', 'skills', 'skr', 'skg'])) return false;
    if (cmd.op === 'assign') {
      return n.gold === b.gold && same(np.skr, adopted ? bp.skr : bp.skr ?? {}) &&
        integer(np.skills[cmd.node], 1, 3) && (!adopted ||
          same(without(np.skills, [cmd.node]), without(bp.skills, [cmd.node])) &&
          np.skills[cmd.node] === (Object.hasOwn(bp.skills, cmd.node) ? bp.skills[cmd.node] : 0) + 1);
    }
    const price = used >= RESET_FREE ? SKILL_RESET_GOLD : 0;
    if (used >= 1000 || !same(np.skr, { ...(bp.skr ?? {}), [cmd.tree]: used + 1 }) || n.gold !== b.gold - price) return false;
    return !adopted || same(Object.keys(np.skills).sort(), Object.keys(bp.skills).sort()) &&
      Object.entries(np.skills).every(([k, rank]) => rank === bp.skills[k] || rank === 0) &&
      Object.entries(np.skills).some(([k, rank]) => rank === 0 && bp.skills[k] > 0);
  } catch { return false; }
}

// Exact transition against the locked profile is checked separately by the store.
// The world's only allowed change is its already-owned, monotonic resource checkpoint.
export function skillWorldTransition(currentWorld, request) {
  if (!skillMutation(request.command)) return true;
  try {
    const old = structuredClone(currentWorld), next = structuredClone(request.worldData);
    if (old.resources && next.resources) {
      if (!Number.isSafeInteger(next.resources.tick) || next.resources.tick < old.resources.tick) return false;
      old.resources.tick = next.resources.tick;
    }
    if (canonicalText(old) !== canonicalText(next)) return false;
    const planned = draftSkills(request.before, request.command);
    return canonicalText(planned.profile) === canonicalText(request.profile) &&
      canonicalText(planned.ack) === canonicalText(request.ack);
  } catch { return false; }
}

// Every other economic writer keeps node ranks, resets, grants and the peaceful practice
// counters (all but logging) byte-equal; only a skills receipt may change the first three.
const frozenSkillState = profile => {
  const p = profile?.progression, practice = { ...(p?.practice ?? {}) };
  delete practice.logging;
  return { skills: p?.skills ?? null, skr: p?.skr ?? null, skg: p?.skg ?? null, practice };
};
export function skillStatePreserved(before, after) {
  return canonicalText(frozenSkillState(before)) === canonicalText(frozenSkillState(after));
}
