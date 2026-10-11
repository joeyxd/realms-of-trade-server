// Whole-death storage DTOs. Trusted authority supplies rules, identities and frozen geometry;
// storage conserves a persisted baseline, all losses and all drops in one receipt, including zero pearls.
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizeItem } from '../src/sim/items.js';
import { SLOTS, ITEMS, BASES, STARTER, CONSUMABLES } from '../src/data/items.js';
import { sanitizePearl, PEARL } from '../src/data/pearls.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText, profilePearls, pearlKind } from './pearlOperations.mjs';
import { groundKey, groundData } from './pearlGround.mjs';

const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === expected;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const version = (n) => integer(n, 1, 2147483646);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const MAX_DEATH_DROPS = ITEMS.bag + SLOTS.length + CONSUMABLES.potion.max;
const same = (a, b) => canonicalText(a) === canonicalText(b);
function profile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new StoreError('profile');
  let data;
  try {
    const text = JSON.stringify(raw);
    if (Buffer.byteLength(text) > 131072) throw new Error('large');
    data = sanitizeProfile(JSON.parse(text));
    if (!data || !same(data, raw)) throw new Error('canonical');
  } catch { throw new StoreError('profile'); }
  return data;
}
export function deathGround(raw) {
  if (!keys(raw, 'availableAt,expiresAt,x,z') ||
      ![raw.x, raw.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6) ||
      !integer(raw.availableAt, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(raw.expiresAt, 0, Number.MAX_SAFE_INTEGER) || raw.expiresAt <= raw.availableAt) {
    throw new StoreError('operation');
  }
  return { x: raw.x, z: raw.z, availableAt: raw.availableAt, expiresAt: raw.expiresAt };
}
function drop(raw, i) {
  if (!keys(raw, 'ground,item,kind,ordinal') || raw.ordinal !== i + 1 || !['item', 'potion'].includes(raw.kind)) {
    throw new StoreError('operation');
  }
  const item = raw.item === null ? null : sanitizeItem(raw.item);
  if (raw.kind === 'item' ? !item || !same(item, raw.item) : raw.item !== null) throw new StoreError('operation');
  return { ordinal: raw.ordinal, kind: raw.kind, item, ground: deathGround(raw.ground) };
}

export function deathOperation(raw) {
  if (!keys(raw, 'drops,killer,operationId,pearls,profiles,rules,victim,world') ||
      !keys(raw.rules, 'lawless,xpBefore,xpLossFraction') || typeof raw.rules.lawless !== 'boolean' ||
      !Number.isFinite(raw.rules.xpLossFraction) || raw.rules.xpLossFraction < 0 || raw.rules.xpLossFraction > 1 ||
      !Number.isFinite(raw.rules.xpBefore) || raw.rules.xpBefore < 0 || raw.rules.xpBefore > 1e6 ||
      !Array.isArray(raw.profiles) || !Array.isArray(raw.pearls) || raw.pearls.length > PEARL.bag + 1 ||
      !Array.isArray(raw.drops) || raw.drops.length > MAX_DEATH_DROPS) throw new StoreError('operation');
  const operationId = playerKey(raw.operationId), world = groundKey(raw.world), victim = playerKey(raw.victim);
  const killer = raw.killer === null ? null : playerKey(raw.killer);
  if (killer !== null && (!raw.rules.lawless || killer === victim)) throw new StoreError('operation');
  const endpoints = [victim, killer].filter(Boolean).sort(order);
  if (raw.profiles.length !== endpoints.length) throw new StoreError('operation');
  const profiles = raw.profiles.map((p, i) => {
    if (!keys(p, 'before,data,expectedVersion,id') || !version(p.expectedVersion) ||
        playerKey(p.id) !== endpoints[i]) throw new StoreError('operation');
    return { id: endpoints[i], expectedVersion: p.expectedVersion, before: profile(p.before), data: profile(p.data) };
  });
  let previous = null;
  const pearls = raw.pearls.map((q) => {
    const p = sanitizePearl(q);
    if (!keys(q, 'expectedVersion,ground,kind,uid') || !p || !version(q.expectedVersion) ||
        (previous !== null && p.uid <= previous)) throw new StoreError('operation');
    previous = p.uid;
    return { ...p, expectedVersion: q.expectedVersion, ground: groundData(q.ground) };
  });
  const request = { world, victim, killer, rules: { ...raw.rules }, profiles, pearls, drops: raw.drops.map(drop) };
  if (!validDeathDelta(request)) throw new StoreError('ownership');
  return { operationId, request };
}

// Exact conservation, rather than accepting a caller's arbitrary post-death profile. Raw SQL has
// the same patch rule and also conserves future JSON fields not yet supported by the JS sanitizer.
export function validDeathDelta(request) {
  const p = request.profiles.find((q) => q.id === request.victim), before = p?.before;
  if (!before || before.xp !== Math.round(request.rules.xpBefore * 100) / 100 ||
      !before.pirateId || !integer(before.stats.deaths, 0, 999999999)) return false;
  const expected = structuredClone(before), items = [];
  if (request.rules.lawless) for (const slot of SLOTS) {
    const it = before.eq[slot];
    if (!it || (slot === 'weapon' && it.s === 1)) continue;
    items.push(it); expected.eq[slot] = null;
  }
  items.push(...before.bag);
  expected.bag = []; expected.pearls = { bag: [], swallowed: null };
  if (!expected.eq.weapon) {
    if (!integer(before.uid, 1, 2147483646)) return false;
    const kit = BASES[before.eq.weapon?.b]?.weapon || 'sable';
    expected.eq.weapon = { u: expected.uid++, b: STARTER[kit], r: 0, l: 1, a: [], s: 1 };
  }
  const pots = request.rules.lawless ? before.pot : 0;
  if (request.rules.lawless) expected.pot = 0;
  expected.stats.deaths++;
  expected.xp = Math.round(request.rules.xpBefore * (1 - request.rules.xpLossFraction) * 100) / 100;
  if (!same(expected, p.data) || request.drops.length !== items.length + pots) return false;
  if (!request.drops.every((d, i) => i < items.length ? d.kind === 'item' && same(d.item, items[i]) :
      d.kind === 'potion' && d.item === null)) return false;
  const all = profilePearls(before).sort((a, b) => order(a.uid, b.uid));
  if (all.length !== request.pearls.length || !all.every((q, i) =>
      q.uid === request.pearls[i].uid && q.kind === request.pearls[i].kind)) return false;
  if (request.killer !== null) {
    const k = request.profiles.find((q) => q.id === request.killer);
    if (!k || !integer(k.before.stats.pk, 0, 999999999)) return false;
    const next = structuredClone(k.before); next.stats.pk++;
    if (!same(next, k.data)) return false;
  }
  return true;
}

export function deathResult(request, operationId, replay = false) {
  return { ok: true, replay,
    profiles: request.profiles.map((p) => ({ id: p.id, version: p.expectedVersion + 1 })),
    uniques: request.pearls.map((q) => ({ uid: q.uid, kind: pearlKind(q.kind), holder: null, version: q.expectedVersion + 1 })),
    locations: request.pearls.map((q) => ({ uid: q.uid, world: request.world,
      ground: structuredClone(q.ground), version: q.expectedVersion + 1 })),
    drops: request.drops.map((d) => ({ operationId, world: request.world, victim: request.victim, ...structuredClone(d) })) };
}
export function checkedDeathResult(raw, request, operationId) {
  if (keys(raw, 'ok,why') && raw.ok === false && ['conflict', 'kind', 'ownership', 'operation'].includes(raw.why)) {
    return { ok: false, why: raw.why };
  }
  if (raw?.ok !== true || typeof raw.replay !== 'boolean') throw new StoreError('response');
  const wanted = deathResult(request, operationId, raw.replay);
  if (!same(wanted, raw)) throw new StoreError('response');
  return wanted;
}
export function checkedDeathReceipt(raw, operationId) {
  if (raw === null) return null;
  try {
    if (!keys(raw, 'request,result')) throw new Error('record');
    const { request } = deathOperation({ ...raw.request, operationId });
    if (!same(request, raw.request)) throw new Error('request');
    const result = checkedDeathResult(raw.result, request, operationId);
    if (!result.ok || result.replay) throw new Error('result');
    return { request, result };
  } catch { throw new StoreError('response'); }
}
export function deathDropPage(world, options = {}) {
  world = groundKey(world);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((k) => !['after', 'limit'].includes(k))) throw new StoreError('operation');
  const after = options.after ?? null, limit = options.limit ?? 64;
  if (!integer(limit, 1, 256) || (after !== null && (!keys(after, 'operationId,ordinal') ||
      !integer(after.ordinal, 1, MAX_DEATH_DROPS)))) throw new StoreError('operation');
  return { world, after: after === null ? null : { operationId: playerKey(after.operationId), ordinal: after.ordinal }, limit };
}
export function checkedDeathDropPage(raw, page) {
  try {
    if (!Array.isArray(raw) || raw.length > page.limit) throw new Error('page');
    let previous = page.after;
    return raw.map((row) => {
      if (!keys(row, 'ground,item,kind,operationId,ordinal,victim,world') || row.world !== page.world ||
          !integer(row.ordinal, 1, MAX_DEATH_DROPS)) throw new Error('row');
      const id = playerKey(row.operationId), victim = playerKey(row.victim);
      const data = { operationId: id, world: page.world, victim,
        ...drop({ ordinal: row.ordinal, kind: row.kind, item: row.item, ground: row.ground }, row.ordinal - 1) };
      if (!same(data, row) || (previous && (id < previous.operationId ||
          (id === previous.operationId && row.ordinal <= previous.ordinal)))) throw new Error('order');
      previous = { operationId: id, ordinal: row.ordinal }; return data;
    });
  } catch { throw new StoreError('response'); }
}
