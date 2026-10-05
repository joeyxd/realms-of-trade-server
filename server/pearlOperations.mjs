// Canonical, detached requests for the server-owned atomic pearl boundary. The command layer chooses
// prices and gameplay eligibility; storage verifies identities, generations and ownership conservation.
import { PEARLS, sanitizePearl } from '../src/data/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { playerKey, StoreError } from './store.mjs';

const MAX_VERSION = 2147483647;
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const generation = (v, min = 0) => Number.isSafeInteger(v) && v >= min && v < MAX_VERSION;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const pearlKind = (kind) => `pearl:${kind}`;
export const managedPearl = (kind) => typeof kind === 'string' && kind.startsWith('pearl:');

export function canonicalText(value) {
  return JSON.stringify(value, (_key, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
}

export function pearlOperation(raw) {
  if (!object(raw)) throw new StoreError('operation');
  const operationId = playerKey(raw.operationId);
  const pearl = sanitizePearl(raw);
  if (!pearl || !generation(raw.expectedVersion)) throw new StoreError('operation');
  const from = raw.from === null ? null : playerKey(raw.from), to = raw.to === null ? null : playerKey(raw.to);
  if (from === to || (raw.expectedVersion === 0 && from !== null)) throw new StoreError('operation');
  const endpoints = [from, to].filter(Boolean).sort(order);
  if (!Array.isArray(raw.profiles) || raw.profiles.length !== endpoints.length) throw new StoreError('operation');
  const profiles = raw.profiles.map((p) => {
    if (!object(p) || !generation(p.expectedVersion, 1) || !object(p.data)) throw new StoreError('operation');
    let data;
    try {
      const encoded = JSON.stringify(p.data);
      if (Buffer.byteLength(encoded) > 128 * 1024) throw new Error('large');
      data = sanitizeProfile(JSON.parse(encoded));
    } catch { throw new StoreError('profile'); }
    if (!data) throw new StoreError('profile');
    return { id: playerKey(p.id), expectedVersion: p.expectedVersion, data };
  }).sort((a, b) => order(a.id, b.id));
  if (profiles.some((p, i) => p.id !== endpoints[i])) throw new StoreError('operation');
  return { operationId, request: { ...pearl, from, to, expectedVersion: raw.expectedVersion, profiles } };
}

export function profilePearls(data) {
  return [...(Array.isArray(data?.pearls?.bag) ? data.pearls.bag : []), ...(data?.pearls?.swallowed ? [data.pearls.swallowed] : [])];
}

export function validPearlMove(request, profiles) {
  for (const p of request.profiles) {
    const old = profiles.get(p.id)?.data;
    if (!old) return false;
    const oldAll = profilePearls(old), newAll = profilePearls(p.data);
    const was = oldAll.filter((q) => q.uid === request.uid), next = newAll.filter((q) => q.uid === request.uid);
    if (was.length !== (p.id === request.from ? 1 : 0) || next.length !== (p.id === request.to ? 1 : 0) ||
      [...was, ...next].some((q) => q.kind !== request.kind)) return false;
    const others = (ps) => canonicalText(ps.filter((q) => q.uid !== request.uid).map(({ uid, kind }) => ({ uid, kind })).sort((a, b) => order(a.uid, b.uid)));
    if (others(oldAll) !== others(newAll)) return false;
  }
  return true;
}

export function assertManagedPearls(profiles, uniques) {
  for (const [uid, row] of uniques) {
    if (!managedPearl(row.kind)) continue;
    const kind = row.kind.slice(6), claims = [];
    if (!Object.hasOwn(PEARLS, kind)) throw new StoreError('ownership');
    for (const [id, p] of profiles) for (const q of profilePearls(p.data)) if (q.uid === uid) claims.push({ id, kind: q.kind });
    if (row.holder === null ? claims.length !== 0 : claims.length !== 1 || claims[0].id !== row.holder || claims[0].kind !== kind) {
      throw new StoreError('ownership');
    }
  }
}

export function pearlResult(request, replay = false) {
  return { ok: true, replay,
    profiles: request.profiles.map(({ id, expectedVersion }) => ({ id, version: expectedVersion + 1 })),
    unique: { uid: request.uid, kind: pearlKind(request.kind), holder: request.to, version: request.expectedVersion + 1 } };
}

export function checkedPearlResult(raw, request) {
  if (raw?.ok === false && ['conflict', 'kind', 'ownership', 'operation'].includes(raw.why)) return { ok: false, why: raw.why };
  if (raw?.ok !== true || typeof raw.replay !== 'boolean' || !Array.isArray(raw.profiles) || !object(raw.unique)) throw new StoreError('response');
  const wanted = pearlResult(request, raw.replay);
  if (canonicalText(raw) !== canonicalText(wanted)) throw new StoreError('response');
  return wanted;
}
