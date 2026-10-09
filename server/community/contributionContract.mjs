// A1a's isolated server contract. Trusted callers supply scoped character and project baselines;
// this module neither authenticates a player nor establishes physical access to the receiving site.
import { GOODS } from '../../src/data/goods.js';

const MAX_VERSION = 2147483647;
const MAX_UNITS = 1000000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-zA-Z0-9:_-]{1,100}$/;
const REQUEST = ['operationId', 'worldId', 'worldEpoch', 'characterId', 'projectId', 'good',
  'amount', 'expectedCharacterVersion', 'expectedProjectVersion'];
const fail = (code) => { throw new ContributionError(code); };
export class ContributionError extends Error {
  constructor(code) { super(`Community contribution: ${code}`); this.name = 'ContributionError'; this.code = code; }
}
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v)); }
function exact(v, fields) {
  if (!object(v) || Reflect.ownKeys(v).length !== fields.length
    || fields.some(k => !Object.hasOwn(v, k))
    || fields.some(k => { const d = Object.getOwnPropertyDescriptor(v, k); return !d.enumerable || !Object.hasOwn(d, 'value'); })) fail('input');
}
function uuid(v) { if (typeof v !== 'string' || !UUID.test(v) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v)) fail('input'); }
function key(v) { if (typeof v !== 'string' || !KEY.test(v)) fail('input'); }
function integer(v, min, max) { if (!Number.isSafeInteger(v) || v < min || v > max) fail('input'); }
function material(v) { if (typeof v !== 'string' || !Object.hasOwn(GOODS, v) || GOODS[v].cat !== 'material') fail('input'); }
function scope(v) { key(v.worldId); uuid(v.worldEpoch); }
function json(v, seen = new Set(), depth = 0) {
  if (depth > 64) fail('input');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('input'); return; }
  if ((!Array.isArray(v) && !object(v)) || seen.has(v)) fail('input');
  seen.add(v);
  if (Array.isArray(v)) {
    if (Reflect.ownKeys(v).length !== v.length + 1) fail('input');
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, i);
      if (!d || !Object.hasOwn(d, 'value')) fail('input');
      json(d.value, seen, depth + 1);
    }
  } else for (const k of Reflect.ownKeys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (typeof k !== 'string' || !Object.hasOwn(d, 'value') || !d.enumerable) fail('input');
    json(d.value, seen, depth + 1);
  }
  seen.delete(v);
}
export function canonical(v) {
  json(v);
  const sort = x => Array.isArray(x) ? x.map(sort) : object(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(v));
}
export function contributionRequest(raw) {
  exact(raw, REQUEST); uuid(raw.operationId); scope(raw); uuid(raw.characterId); key(raw.projectId);
  material(raw.good); integer(raw.amount, 1, MAX_UNITS);
  integer(raw.expectedCharacterVersion, 1, MAX_VERSION - 1);
  integer(raw.expectedProjectVersion, 1, MAX_VERSION - 1);
  return Object.fromEntries(REQUEST.map(k => [k, raw[k]]));
}
export function contributionCharacter(raw) {
  exact(raw, ['worldId', 'worldEpoch', 'characterId', 'version', 'data']); scope(raw); uuid(raw.characterId);
  integer(raw.version, 1, MAX_VERSION); json(raw.data);
  if (!object(raw.data) || raw.data.v !== 1 || !object(raw.data.eco)
    || !object(raw.data.eco.pack) || !object(raw.data.eco.pack.goods)
    || Buffer.byteLength(JSON.stringify(raw.data)) > 131072) fail('input');
  if (Object.hasOwn(raw.data.eco, 'tradeRev')) integer(raw.data.eco.tradeRev, 0, MAX_VERSION);
  for (const [g, n] of Object.entries(raw.data.eco.pack.goods)) {
    if (!Object.hasOwn(GOODS, g)) fail('input');
    integer(n, 1, MAX_UNITS);
  }
  return structuredClone(raw);
}
export function contributionProject(raw) {
  exact(raw, ['worldId', 'worldEpoch', 'projectId', 'version', 'requirements', 'contributed']);
  scope(raw); key(raw.projectId); integer(raw.version, 1, MAX_VERSION);
  json(raw.requirements); json(raw.contributed);
  if (!object(raw.requirements) || !object(raw.contributed)) fail('input');
  const keys = Object.keys(raw.requirements);
  if (!keys.length || keys.length > 16 || Object.keys(raw.contributed).length !== keys.length) fail('input');
  for (const g of keys) {
    material(g); integer(raw.requirements[g], 1, MAX_UNITS);
    if (!Object.hasOwn(raw.contributed, g)) fail('input');
    integer(raw.contributed[g], 0, raw.requirements[g]);
  }
  return structuredClone(raw);
}
export const contributionScopeKey = (v, id) => canonical([v.worldId, v.worldEpoch, id]);
export function contributionDelta(rawRequest, rawCharacter, rawProject) {
  const r = contributionRequest(rawRequest), c = contributionCharacter(rawCharacter), p = contributionProject(rawProject);
  const denied = why => ({ ok: false, why });
  if (c.worldId !== r.worldId || p.worldId !== r.worldId || c.worldEpoch !== r.worldEpoch
    || p.worldEpoch !== r.worldEpoch || c.characterId !== r.characterId || p.projectId !== r.projectId) return denied('scope');
  if (c.version !== r.expectedCharacterVersion || p.version !== r.expectedProjectVersion) return denied('conflict');
  if (!Object.hasOwn(p.requirements, r.good)) return denied('material');
  const accepted = Math.min(r.amount, p.requirements[r.good] - p.contributed[r.good]);
  if (!accepted) return denied('complete');
  if ((c.data.eco.pack.goods[r.good] ?? 0) < accepted) return denied('goods');
  if (c.data.eco.tradeRev === MAX_VERSION) return denied('conflict');
  const remaining = c.data.eco.pack.goods[r.good] - accepted;
  if (remaining) c.data.eco.pack.goods[r.good] = remaining;
  else delete c.data.eco.pack.goods[r.good];
  // The profile's economy revision is preserved unless it already has the ordinary trade field.
  if (Object.hasOwn(c.data.eco, 'tradeRev')) {
    integer(c.data.eco.tradeRev, 0, MAX_VERSION - 1);
    c.data.eco.tradeRev++;
  }
  c.version++; p.version++; p.contributed[r.good] += accepted;
  return { ok: true, accepted, character: c, project: p };
}
