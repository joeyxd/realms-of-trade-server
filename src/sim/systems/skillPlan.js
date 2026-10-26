// Pure SK04 candidate planner: spend one tree point on one node rank, or reset a tree.
// Returning ok never means storage committed or replay-safe; the M5 economic authority does that.
import { SKILLS_PROGRESSION_VERSION } from '../../data/progression.js';
import { WEAPON_KINDS } from '../../data/weapons.js';
import {
  NODES, RESET_FREE, SKILL_RESET_GOLD, TREES, canRaise, combatPractice, gateState, legacySkills, nodeById,
  pointsEarned, pointsSpent, skillGrant,
} from '../../data/skillTree.js';
import { readProgression } from './progression.js';

const MAX_REV_BEFORE_INCREMENT = 2147483645;
// readProgression caps skr[tree] at 1000 resets.
const MAX_RESETS = 1000;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NODE_ID = /^[a-z][a-z0-9_]{0,39}$/;
const PRACTICE_KEYS = ['logging', 'survival', 'sailing', 'crafting', 'trade'];
export const SKILL_TREE_IDS = Object.freeze(TREES.filter((t) => !t.hidden).map((t) => t.id));
const INVALID_CLONE = Symbol('unsupported canonical profile');
const objectLike = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

function plain(raw) {
  if (!objectLike(raw)) return false;
  try {
    const proto = Object.getPrototypeOf(raw);
    return proto === Object.prototype || proto === null;
  } catch { return false; }
}

function ownData(raw, key) {
  try {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    return d?.enumerable && Object.hasOwn(d, 'value') ? { present: true, value: d.value } : { present: false };
  } catch { return { present: false }; }
}

function exactKeys(raw, keys) {
  if (!plain(raw)) return false;
  try {
    const own = Reflect.ownKeys(raw);
    return own.length === keys.length && keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(raw, key);
      return d?.enumerable && Object.hasOwn(d, 'value');
    });
  } catch { return false; }
}

/** The exact command shape, or null. Catalog membership of the node is checked by the plan. */
export function parseSkillCommand(command) {
  if (!plain(command)) return null;
  const opField = ownData(command, 'op');
  if (!opField.present) return null;
  const op = opField.value;
  const keys = op === 'assign' ? ['type', 'op', 'opId', 'expectedRev', 'tree', 'node']
    : op === 'reset' ? ['type', 'op', 'opId', 'expectedRev', 'tree'] : null;
  if (!keys || !exactKeys(command, keys)) return null;
  const values = Object.fromEntries(keys.map((key) => [key, ownData(command, key).value]));
  if (values.type !== 'skills' || typeof values.opId !== 'string' || !OP_ID.test(values.opId) ||
      !Number.isSafeInteger(values.expectedRev) || values.expectedRev < 0 || values.expectedRev > MAX_REV_BEFORE_INCREMENT ||
      typeof values.tree !== 'string' || !SKILL_TREE_IDS.includes(values.tree)) return null;
  if (op === 'assign' && (typeof values.node !== 'string' || !NODE_ID.test(values.node))) return null;
  return values;
}

function error(why, profile) { return { ok: false, why, profile }; }

// The source must be a plain JSON DTO. Read descriptors instead of properties so accessors never run.
function cloneCanonical(value, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_CLONE;
  if (!objectLike(value) && !Array.isArray(value)) return INVALID_CLONE;
  if (active.has(value)) return INVALID_CLONE;
  active.add(value);
  try {
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (proto !== Array.prototype) return INVALID_CLONE;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) return INVALID_CLONE;
      const out = new Array(lengthDescriptor.value), keys = Reflect.ownKeys(value);
      if (keys.length !== lengthDescriptor.value + 1) return INVALID_CLONE;
      for (let i = 0; i < lengthDescriptor.value; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) return INVALID_CLONE;
        const copied = cloneCanonical(d.value, active);
        if (copied === INVALID_CLONE) return INVALID_CLONE;
        out[i] = copied;
      }
      return out;
    }
    if (proto !== Object.prototype && proto !== null) return INVALID_CLONE;
    const out = Object.create(proto), keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (typeof key !== 'string') return INVALID_CLONE;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) return INVALID_CLONE;
      const copied = cloneCanonical(d.value, active);
      if (copied === INVALID_CLONE) return INVALID_CLONE;
      Object.defineProperty(out, key, { value: copied, enumerable: true, writable: true, configurable: true });
    }
    return out;
  } catch { return INVALID_CLONE; }
  finally { active.delete(value); }
}

// Same derivation as the sheet (src/ui/skillSheet.js skillSheetState), from the canonical clone.
function inspectProfile(profile) {
  if (!plain(profile)) return { why: 'profile' };
  const clone = cloneCanonical(profile);
  if (clone === INVALID_CLONE) return { why: 'profile' };
  const ecoField = ownData(clone, 'eco'), goldField = ownData(clone, 'gold');
  if (!ecoField.present || !plain(ecoField.value) || !goldField.present ||
      !Number.isSafeInteger(goldField.value) || goldField.value < 0) return { why: 'profile' };
  const revField = ownData(ecoField.value, 'tradeRev');
  if (!revField.present || !Number.isSafeInteger(revField.value) || revField.value < 0 || revField.value > 2147483646) return { why: 'profile' };
  const progressionField = ownData(clone, 'progression');
  let progression;
  try { progression = readProgression(progressionField.present ? progressionField.value : undefined); }
  catch { return { why: 'profile' }; }

  const mast = clone.mast;
  const levelAt = (i) => { const v = Math.floor(Number(mast?.[i]?.[0])); return Number.isFinite(v) && v > 0 ? v : 0; };
  const mastery = Object.fromEntries(WEAPON_KINDS.map((kind, i) => [kind, levelAt(i)]));
  const practice = { combat: combatPractice(mast) };
  for (const key of PRACTICE_KEYS) practice[key] = count(progression.practice[key]);
  const has = plain(clone.sk) && plain(clone.sk.has) ? clone.sk.has : {};
  const knows = (id) => !!id && Object.hasOwn(has, id) && !!has[id];
  const pearl = !!clone.pearls?.swallowed;
  return { clone, gold: goldField.value, tradeRev: revField.value, progression, practice, mastery, has, knows, pearl };
}

// The first skills operation adopts: legacy tattoo/art ranks become node ranks and the migrated
// overspend becomes each visible tree's permanent grant. skg never changes afterwards.
function adopt(source) {
  const p = source.progression;
  if (Object.hasOwn(p, 'skills')) {
    return { skills: { ...p.skills }, skr: Object.hasOwn(p, 'skr') ? { ...p.skr } : undefined,
      skg: Object.hasOwn(p, 'skg') ? { ...p.skg } : undefined };
  }
  const skills = legacySkills(source.has, source.mastery);
  const skg = Object.fromEntries(SKILL_TREE_IDS.map((id) => [id, skillGrant(id, source.practice, skills)]));
  return { skills, skr: Object.hasOwn(p, 'skr') ? { ...p.skr } : {}, skg };
}

function treePoints(tree, practice, skills, grant) {
  const earned = pointsEarned(tree, practice) + grant, spent = pointsSpent(tree, skills);
  return { earned, spent, free: Math.max(0, earned - spent) };
}

/** Pure validation/planning for one node rank (`assign`) or a tree reset (`reset`). */
export function planSkillChange(profile, command) {
  const parsed = parseSkillCommand(command);
  if (!parsed) return error('command', profile);
  const node = parsed.op === 'assign' ? nodeById(parsed.node) : null;
  if (parsed.op === 'assign' && (!node || node.tree !== parsed.tree)) return error('command', profile);
  const source = inspectProfile(profile);
  if (source.why) return error(source.why, profile);
  if (source.tradeRev > MAX_REV_BEFORE_INCREMENT) return error('limit', profile);
  if (parsed.expectedRev !== source.tradeRev) return error('conflict', profile);

  const tree = parsed.tree, state = adopt(source);
  const grant = state.skg && Object.hasOwn(state.skg, tree) ? state.skg[tree] : 0;
  let gold = source.gold;
  if (parsed.op === 'assign') {
    if (node.draft) return error('draft', profile);
    const raise = canRaise(tree, node.id, { practice: source.practice, skills: state.skills, grant });
    if (!raise.ok) return error(raise.reason === 'unknown' || raise.reason === 'tree' ? 'command' : raise.reason, profile);
    // Spending ignores the weapon in hand; mastery, knowledge and the pearl still gate the rank.
    const ctx = { weapon: node.gate?.weapon, mastery: { ...source.mastery },
      knowledge: source.knows(node.skill) ? ['tattoo'] : [], pearl: source.pearl };
    if (!gateState(node, ctx).ok) return error('gate', profile);
    state.skills[node.id] = (Object.hasOwn(state.skills, node.id) ? state.skills[node.id] : 0) + 1;
  } else {
    if (pointsSpent(tree, state.skills) === 0) return error('empty', profile);
    const used = state.skr && Object.hasOwn(state.skr, tree) ? state.skr[tree] : 0;
    if (used >= MAX_RESETS) return error('limit', profile);
    const price = used >= RESET_FREE ? SKILL_RESET_GOLD : 0;
    if (gold < price) return error('gold', profile);
    for (const n of NODES) if (n.tree === tree && Object.hasOwn(state.skills, n.id)) state.skills[n.id] = 0;
    state.skr = { ...(state.skr ?? {}), [tree]: used + 1 };
    gold -= price;
  }

  const p = source.progression;
  const progression = { v: SKILLS_PROGRESSION_VERSION, practice: { ...p.practice }, milestones: [...p.milestones],
    knowledge: [...p.knowledge], skills: state.skills,
    ...(state.skr ? { skr: state.skr } : {}), ...(state.skg ? { skg: state.skg } : {}) };
  // The written block must stay readable by the shared reader (round-trip).
  try { readProgression(progression); } catch { return error('profile', profile); }
  const next = source.clone;
  next.progression = progression;
  next.gold = gold;
  next.eco.tradeRev = source.tradeRev + 1;
  return { ok: true, why: '', profile: next, points: treePoints(tree, source.practice, state.skills, grant) };
}
