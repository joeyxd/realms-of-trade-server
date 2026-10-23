// Raft production chain: nets fish, purifiers make water, and grills turn fish into ship biscuits.
import { GOODS } from '../../data/goods.js';
import { RAFT_PARTS } from '../../data/raftparts.js';
import { load, roomFor, unload } from './cargo.js';

export const PRODUCTION_PARTS = Object.freeze(['net', 'grill', 'purifier']);
export const MAX_PRODUCTION_DAYS_PER_STEP = 1;

const RATE = Object.freeze({ net: RAFT_PARTS.net.makes.pescado, grill: RAFT_PARTS.grill.recipe.perDay,
  purifier: RAFT_PARTS.purifier.makes.agua });

function validTuple(tuple) {
  return Array.isArray(tuple) && PRODUCTION_PARTS.includes(tuple[0])
    && Number.isSafeInteger(tuple[1]) && Number.isSafeInteger(tuple[2])
    && Number.isSafeInteger(tuple[3]) && tuple[3] >= 0
    && Number.isSafeInteger(tuple[4] ?? 0);
}

// A recipe's saved progress follows the complete placed-piece identity, never its array position.
export function productionKey(tuple) {
  if (!validTuple(tuple)) return '';
  return JSON.stringify([tuple[0], tuple[1], tuple[2], tuple[3], tuple[4] ?? 0]);
}

function recipeFor(part) {
  if (part === 'net') return { rate: RATE.net, inputs: {}, outputs: { pescado: 1 } };
  if (part === 'purifier') return { rate: RATE.purifier, inputs: {}, outputs: { agua: 1 } };
  const recipe = RAFT_PARTS.grill.recipe;
  return { rate: RATE.grill, inputs: { ...recipe.in }, outputs: { ...recipe.out } };
}

function validWork(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1;
}

// Keep only bounded fractions belonging to production pieces that still exist on this raft.
export function sanitizeProduction(parts, rawWork) {
  const allowed = new Set();
  for (const tuple of Array.isArray(parts) ? parts.slice(0, 600) : []) {
    const key = productionKey(tuple);
    if (key) allowed.add(key);
  }
  const clean = {};
  if (!rawWork || typeof rawWork !== 'object' || Array.isArray(rawWork)) return clean;
  for (const key of allowed) {
    if (Object.hasOwn(rawWork, key) && validWork(rawWork[key])) clean[key] = rawWork[key];
  }
  return clean;
}

function copyHold(hold) {
  return { cap: hold.cap, goods: { ...hold.goods } };
}

function stageLot(hold, inputs, outputs) {
  const next = copyHold(hold);
  for (const [good, count] of Object.entries(inputs)) {
    if (!Number.isSafeInteger(count) || count < 1 || (next.goods[good] || 0) < count) return null;
  }
  for (const [good, count] of Object.entries(inputs)) if (!unload(next, good, count)) return null;
  for (const [good, count] of Object.entries(outputs)) {
    if (!Object.hasOwn(GOODS, good) || !Number.isSafeInteger(count) || count < 1 || roomFor(next, good) < count) return null;
  }
  for (const [good, count] of Object.entries(outputs)) if (!load(next, good, count)) return null;
  return next;
}

function addCounts(target, source) {
  for (const [good, count] of Object.entries(source)) target[good] = (target[good] || 0) + count;
}

function productionParts(raft) {
  if (!raft || !Array.isArray(raft.parts)) return [];
  const parts = raft.parts.slice(0, 600);
  return PRODUCTION_PARTS.flatMap((part) => parts
    .filter((tuple) => Array.isArray(tuple) && tuple[0] === part && productionKey(tuple))
    .map((tuple) => ({ tuple, part, key: productionKey(tuple), ...recipeFor(part) })));
}

function readiness(hold, inputs, outputs) {
  for (const [good, count] of Object.entries(inputs)) if ((hold.goods[good] || 0) < count) return 'inputs';
  return stageLot(hold, inputs, outputs) ? '' : 'room';
}

function nextWork(raft, hold, record, progress, days, made, used) {
  let elapsed = Math.min(days, MAX_PRODUCTION_DAYS_PER_STEP);
  let fraction = progress;
  const rate = record.rate;
  const epsilon = 1e-12;
  while (elapsed > epsilon) {
    if (readiness(hold, record.inputs, record.outputs)) break;
    const untilLot = (1 - fraction) / rate;
    if (elapsed + epsilon < untilLot) {
      fraction += elapsed * rate;
      elapsed = 0;
      break;
    }
    elapsed = Math.max(0, elapsed - untilLot);
    fraction = 0;
    const next = stageLot(hold, record.inputs, record.outputs);
    if (!next) break;
    hold.goods = next.goods;
    addCounts(used, record.inputs);
    addCounts(made, record.outputs);
  }
  return fraction >= 1 ? 0 : fraction;
}

// Advance at most one game day per call; elapsed time beyond the cap is discarded, never banked.
export function stepRaftProduction(raft, hold, days, { poweredKeys = null } = {}) {
  const made = {}, used = {};
  if (!raft || !Array.isArray(raft.parts) || !hold || !hold.goods
      || !Number.isFinite(days) || days <= 0) return { made, used, changed: false };
  const beforeWork = raft.work && typeof raft.work === 'object' && !Array.isArray(raft.work) ? { ...raft.work } : {};
  const beforeGoods = { ...hold.goods };
  raft.work = sanitizeProduction(raft.parts, raft.work);
  for (const record of productionParts(raft).slice(0, 600)) {
    if (record.part === 'grill' && poweredKeys && !poweredKeys.has(record.key)) continue;
    const progress = raft.work[record.key] || 0;
    const next = nextWork(raft, hold, record, progress, days, made, used);
    if (next > 0) raft.work[record.key] = next;
    else delete raft.work[record.key];
  }
  const workKeys = new Set([...Object.keys(beforeWork), ...Object.keys(raft.work)]);
  const workChanged = [...workKeys].some((key) => beforeWork[key] !== raft.work[key]);
  const goodsKeys = new Set([...Object.keys(beforeGoods), ...Object.keys(hold.goods)]);
  const goodsChanged = [...goodsKeys].some((key) => beforeGoods[key] !== hold.goods[key]);
  return { made, used, changed: workChanged || goodsChanged };
}

const STOPPED = new Set(['saveSize', 'revisionLimit', 'capacity', 'voyage']);

// Describe only the selected production chain; all maps and nested values are detached copies.
export function productionRows(raft, hold, { blocked = '', poweredKeys = null, activeKeys = null } = {}) {
  if (!hold?.goods) return [];
  const work = sanitizeProduction(raft?.parts, raft?.work);
  return productionParts(raft).slice(0, 600).map((record) => {
    const progress = work[record.key] || 0;
    const stopped = STOPPED.has(blocked) ? blocked
      : activeKeys instanceof Set && !activeKeys.has(record.key) ? 'broken'
        : record.part === 'grill' && poweredKeys && !poweredKeys.has(record.key) ? 'fuel'
          : readiness(hold, record.inputs, record.outputs);
    return {
      key: record.key, part: record.part, name: RAFT_PARTS[record.part].name, rate: record.rate,
      inputs: { ...record.inputs }, outputs: { ...record.outputs }, progress,
      status: stopped || 'working', remainingDays: stopped ? null : (1 - progress) / record.rate,
    };
  });
}
