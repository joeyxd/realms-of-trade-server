// Atomic multi-UID storage for the pearl portion of death and confirmed replacement. The caller
// supplies geometry and time; this boundary neither awards progress nor activates gameplay.
import { PEARL, sanitizePearl } from '../src/data/pearls.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText, pearlProfiles, profilePearls, pearlKind } from './pearlOperations.mjs';
import { groundKey, groundData } from './pearlGround.mjs';

const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, expected) => object(v) && Object.keys(v).sort().join(',') === expected;
const version = (v) => Number.isSafeInteger(v) && v >= 1 && v < 2147483647;

export function batchOperation(raw) {
  if (!keys(raw, 'items,mode,operationId,profile,world') || !['death', 'replace'].includes(raw.mode) ||
    !keys(raw.profile, 'data,expectedVersion,id') || !Array.isArray(raw.items) ||
    raw.items.length < 1 || raw.items.length > PEARL.bag + 1) throw new StoreError('operation');
  const operationId = playerKey(raw.operationId), world = groundKey(raw.world);
  const profile = pearlProfiles([raw.profile], [playerKey(raw.profile.id)])[0];
  // Sanitizing away any requested field would turn an invalid delta into a different operation.
  if (canonicalText(profile.data) !== canonicalText(raw.profile.data)) throw new StoreError('profile');
  let previous = null;
  const items = Array.from(raw.items, (q) => {
    const pearl = sanitizePearl(q);
    if (!keys(q, 'expectedVersion,ground,kind,uid') || !pearl || !version(q.expectedVersion) ||
      (previous !== null && pearl.uid <= previous)) throw new StoreError('operation');
    previous = pearl.uid;
    return { ...pearl, expectedVersion: q.expectedVersion,
      ground: q.ground === null ? null : JSON.parse(JSON.stringify(groundData(q.ground))) };
  });
  if (raw.mode === 'death' ? items.some((q) => q.ground === null) :
    items.length !== 2 || items.filter((q) => q.ground === null).length !== 1) throw new StoreError('operation');
  return { operationId, request: { world, mode: raw.mode, profile, items } };
}

export function validBatchDelta(request, before) {
  if (!keys(before?.pearls, 'bag,swallowed') || !Array.isArray(before.pearls.bag) ||
    before.pearls.bag.length > PEARL.bag) return false;
  const all = profilePearls(before), seen = new Set();
  for (const q of all) {
    if (!keys(q, 'kind,uid') || !sanitizePearl(q) || seen.has(q.uid)) return false;
    seen.add(q.uid);
  }
  if (before.pearls.swallowed !== null && !object(before.pearls.swallowed)) return false;
  for (const q of request.items) if (!all.some((p) => p.uid === q.uid && p.kind === q.kind)) return false;
  const expected = structuredClone(before);
  if (request.mode === 'death') {
    if (all.length !== request.items.length) return false;
    expected.pearls = { swallowed: null, bag: [] };
  } else {
    const incoming = request.items.find((q) => q.ground === null);
    const outgoing = request.items.find((q) => q.ground !== null);
    if (before.pearls.swallowed?.uid !== outgoing.uid ||
      !before.pearls.bag.some((q) => q.uid === incoming.uid)) return false;
    expected.pearls.bag = before.pearls.bag.filter((q) => q.uid !== incoming.uid);
    expected.pearls.swallowed = { uid: incoming.uid, kind: incoming.kind };
  }
  return canonicalText(expected) === canonicalText(request.profile.data);
}

export function batchResult(request, replay = false) {
  return { ok: true, replay, profiles: [{ id: request.profile.id, version: request.profile.expectedVersion + 1 }],
    uniques: request.items.map((q) => ({ uid: q.uid, kind: pearlKind(q.kind),
      holder: q.ground === null ? request.profile.id : null, version: q.expectedVersion + 1 })),
    locations: request.items.map((q) => ({ uid: q.uid, world: request.world,
      ground: structuredClone(q.ground), version: q.expectedVersion + 1 })) };
}
export function checkedBatchResult(raw, request) {
  if (raw?.ok === false && ['conflict', 'kind', 'ownership', 'operation'].includes(raw.why) &&
    keys(raw, 'ok,why')) return { ok: false, why: raw.why };
  if (raw?.ok !== true || typeof raw.replay !== 'boolean') throw new StoreError('response');
  const wanted = batchResult(request, raw.replay);
  if (canonicalText(raw) !== canonicalText(wanted)) throw new StoreError('response');
  return wanted;
}
export function checkedBatchReceipt(raw, operationId) {
  if (raw === null) return null;
  try {
    if (!keys(raw, 'request,result')) throw new Error('record');
    const { request } = batchOperation({ ...raw.request, operationId });
    if (canonicalText(request) !== canonicalText(raw.request)) throw new Error('request');
    const result = checkedBatchResult(raw.result, request);
    if (!result.ok || result.replay) throw new Error('result');
    return { request, result };
  } catch { throw new StoreError('response'); }
}
