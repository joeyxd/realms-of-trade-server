// Pure PRG01a logging plans. No live profile/node mutation, I/O, receipts or gameplay activation.
// Only a trusted host may call this after validating a hit (tool, range, calm, capacity, etc.).
// A plan is not a durable reward. M5 must commit the final node + all profiles + receipt together.
import { LOGGING, LOGGING_LESSON, PROGRESSION_VERSION } from '../../data/progression.js';
import { HARVEST, RESOURCE_KINDS } from '../../data/resources.js';

const PALM = RESOURCE_KINDS.palm;
const ACTOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const actorId = a => typeof a === 'string' && ACTOR.test(a) && a !== NIL;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o)
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
function exact(o, keys) {
  if (!object(o)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(o);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(k => {
    const d = descriptors[k];
    return d?.enumerable && Object.hasOwn(d, 'value');
  });
}
function list(a, max) {
  if (!Array.isArray(a) || Object.getPrototypeOf(a) !== Array.prototype
      || a.length > max || Reflect.ownKeys(a).length !== a.length + 1) return false;
  for (let i = 0; i < a.length; i++) {
    const d = Object.getOwnPropertyDescriptor(a, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return false;
  }
  return true;
}
const fail = code => { throw new ProgressionError(code); };
export class ProgressionError extends Error {
  constructor(code) { super(`Progression: ${code}`); this.name = 'ProgressionError'; this.code = code; }
}

export function newProgression() {
  return { v: PROGRESSION_VERSION, practice: { logging: 0 }, milestones: [], knowledge: [] };
}

// An absent legacy field is empty. Present corrupt/future data must not be silently erased.
// PRG01b1 preserves legacy omission in the profile DTO; activity integration follows separately.
export function readProgression(raw) {
  if (raw === undefined) return newProgression();
  if (!exact(raw, ['v', 'practice', 'milestones', 'knowledge']) || raw.v !== PROGRESSION_VERSION
      || !exact(raw.practice, ['logging']) || !integer(raw.practice.logging, 0, LOGGING.maxPractice)
      || !list(raw.milestones, 1) || raw.milestones.some(id => id !== LOGGING.milestone)
      || !list(raw.knowledge, 1) || raw.knowledge.some(id => id !== LOGGING_LESSON.id)) fail('progression');
  return { v: raw.v, practice: { logging: raw.practice.logging },
    milestones: [...raw.milestones], knowledge: [...raw.knowledge] };
}

export function loggingStatus(raw) {
  const p = readProgression(raw);
  const trained = p.milestones.includes(LOGGING.milestone) || p.practice.logging >= LOGGING.firstMilestoneAt;
  return { practice: p.practice.logging, rank: trained ? 2 : 1,
    actionTicks: trained ? LOGGING.learnedActionTicks : LOGGING.baseActionTicks,
    nextAt: trained ? null : LOGGING.firstMilestoneAt,
    canLearnStorage: trained && !p.knowledge.includes(LOGGING_LESSON.id) };
}

function contributions(raw, total, code) {
  if (!list(raw, PALM.hits)) fail(code);
  const seen = new Set(), out = [];
  let sum = 0;
  for (const row of raw) {
    if (!exact(row, ['actor', 'hits']) || !actorId(row.actor) || seen.has(row.actor)
        || !integer(row.hits, 1, PALM.hits)) fail(code);
    seen.add(row.actor); sum += row.hits; out.push({ actor: row.actor, hits: row.hits });
  }
  if (sum !== total) fail(code);
  return out.sort((a, b) => cmp(a.actor, b.actor));
}

// Largest remainder conserves the fixed cycle budget, independent of input order/finisher.
export function loggingShares(raw) {
  const rows = contributions(raw, PALM.hits, 'contribution').map(c => {
    const units = LOGGING.practicePerPalm * c.hits;
    return { actor: c.actor, amount: Math.floor(units / PALM.hits), remainder: units % PALM.hits };
  });
  let left = LOGGING.practicePerPalm - rows.reduce((n, r) => n + r.amount, 0);
  rows.sort((a, b) => b.remainder - a.remainder || cmp(a.actor, b.actor));
  for (const r of rows) if (left > 0) { r.amount++; left--; }
  return rows.sort((a, b) => cmp(a.actor, b.actor)).map(({ actor, amount }) => ({ actor, amount }));
}

export function newLoggingNode(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) fail('node');
  return { id, kind: 'palm', rev: 1, cycle: 1, hits: 0, readyTick: 0, contributors: [] };
}

function readNode(raw) {
  if (!exact(raw, ['id', 'kind', 'rev', 'cycle', 'hits', 'readyTick', 'contributors'])
      || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) || raw.kind !== 'palm'
      || !integer(raw.rev, 1, HARVEST.maxRev) || !integer(raw.cycle, 1, HARVEST.maxRev)
      || !integer(raw.hits, 0, PALM.hits) || !integer(raw.readyTick, 0, Number.MAX_SAFE_INTEGER)
      || raw.rev !== 1 + PALM.hits * (raw.cycle - 1) + raw.hits
      || (raw.hits === PALM.hits ? raw.readyTick === 0 : raw.readyTick !== 0)) fail('node');
  return { id: raw.id, kind: raw.kind, rev: raw.rev, cycle: raw.cycle, hits: raw.hits,
    readyTick: raw.readyTick, contributors: contributions(raw.contributors, raw.hits, 'node') };
}

function beneficiaries(raw, actors) {
  if (!list(raw, PALM.hits) || raw.length !== actors.length) fail('beneficiary');
  const result = new Map();
  for (const row of raw) {
    // The host must explicitly project a loaded profile, even if its legacy field is undefined.
    if (!exact(row, ['actor', 'progression']) || !actorId(row.actor)
        || result.has(row.actor) || !actors.includes(row.actor)) fail('beneficiary');
    try { result.set(row.actor, readProgression(row.progression)); }
    catch { fail('beneficiary'); }
  }
  return result;
}

function award(actor, amount, p) {
  const credited = Math.min(amount, LOGGING.maxPractice - p.practice.logging);
  p.practice.logging += credited;
  const milestones = [];
  if (p.practice.logging >= LOGGING.firstMilestoneAt && !p.milestones.includes(LOGGING.milestone)) {
    p.milestones.push(LOGGING.milestone); milestones.push(LOGGING.milestone);
  }
  return { actor, amount, credited, progression: p, milestones };
}

// `actor` is a stable host-resolved account/character UUID, never a socket/entity/client claim.
// `tick` belongs to the host's pause-offline resource clock, not wall time or a client timestamp.
// Partial hits need only the hitter's progression; completion requires every contributor, even offline.
// Old expectedRev is rejected against the current node. Durable replay identity belongs to M5 receipts.
export function planLoggingHit(rawNode, command, rawBeneficiaries) {
  const node = readNode(rawNode);
  if (!exact(command, ['actor', 'expectedRev', 'tick']) || !actorId(command.actor)
      || !integer(command.expectedRev, 1, HARVEST.maxRev)
      || !integer(command.tick, 0, Number.MAX_SAFE_INTEGER)) fail('input');
  if (command.expectedRev !== node.rev) fail('conflict');
  if (node.readyTick > command.tick) fail('depleted');
  if (node.rev === HARVEST.maxRev) fail('limit');
  if (node.hits === PALM.hits) {
    node.cycle++; node.hits = 0; node.readyTick = 0; node.contributors = [];
  }
  const contributor = node.contributors.find(r => r.actor === command.actor);
  if (contributor) contributor.hits++;
  else node.contributors.push({ actor: command.actor, hits: 1 });
  node.contributors.sort((a, b) => cmp(a.actor, b.actor));
  node.hits++; node.rev++;
  const final = node.hits === PALM.hits;
  const actors = final ? node.contributors.map(r => r.actor) : [command.actor];
  const profiles = beneficiaries(rawBeneficiaries, actors);
  const actionTicks = loggingStatus(profiles.get(command.actor)).actionTicks;
  if (!final) return { node, actionTicks, materials: [], awards: [] };
  if (command.tick > Number.MAX_SAFE_INTEGER - HARVEST.respawnTicks) fail('limit');
  node.readyTick = command.tick + HARVEST.respawnTicks;
  const awards = loggingShares(node.contributors).map(({ actor, amount }) => award(actor, amount, profiles.get(actor)));
  // Preserve the current material rule; cooperative practice is separate from cargo allocation.
  return { node, actionTicks, materials: [{ actor: command.actor, good: PALM.good, count: PALM.yield }], awards };
}
