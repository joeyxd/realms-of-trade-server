// M5's server-only storage contract. Memory exercises the same optimistic writes as Postgres;
// it does not survive a process restart. Account identity must come from a trusted host resolver.
import { createClient } from '@supabase/supabase-js';
import { groundClockOperation, groundClockResult, checkedGroundClock, checkedGroundClockResult, checkedGroundClockReceipt } from './groundClockOperation.mjs';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { pearlOperation, canonicalText, managedPearl, pearlKind, validPearlMove, assertManagedPearls,
  pearlResult, checkedPearlResult, checkedPearlReceipt } from './pearlOperations.mjs';
import { groundOperation, groundResult, checkedGroundResult, checkedGroundReceipt, checkedLocation,
  groundKey, groundPage, checkedGroundPage, assertGroundLocations } from './pearlGround.mjs';
import { batchOperation, batchResult, checkedBatchResult, checkedBatchReceipt, validBatchDelta } from './pearlBatch.mjs';
import { deathOperation, deathResult, checkedDeathResult, checkedDeathReceipt,
  deathDropPage, checkedDeathDropPage } from './deathOperation.mjs';
import { deathDropOperation, deathDropResult, deathDropInWindow, deathDropKey, currentDeathDropPage,
  checkedDeathDropResult, checkedDeathDropReceipt, checkedCurrentDeathDrop, checkedCurrentDeathDropPage } from './deathDropOperation.mjs';
import { registerMemoryPearlStore, permitsMemoryPearlReceipt } from './pearlMemoryIdentity.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_KEY = /^[0-9a-f]{64}$/;
const MAX_VERSION = 2147483647;
export class StoreError extends Error {
  constructor(code) { super(`Storage: ${code}`); this.name = 'StoreError'; this.code = code; }
}
export function playerKey(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new StoreError('identity');
  return id.toLowerCase();
}
function key(value, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new StoreError('key');
  return value;
}
function version(value, min = 0, max = MAX_VERSION) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new StoreError('version');
  return value;
}
function json(value, maxBytes = 2 * 1024 * 1024) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError('data');
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > maxBytes) throw new Error('large');
    return JSON.parse(encoded);
  } catch { throw new StoreError('data'); }
}
function profile(value) {
  const p = sanitizeProfile(json(value, 128 * 1024));
  if (!p) throw new StoreError('profile');
  return p;
}
function legacyKey(value) {
  if (typeof value !== 'string' || !LEGACY_KEY.test(value)) throw new StoreError('legacy_key');
  return value;
}
const conflict = () => ({ ok: false, why: 'conflict' });

export function createMemoryStore() {
  const profiles = new Map(), worlds = new Map(), uniques = new Map(), legacyImports = new Map(), pearlReceipts = new Map();
  const locations = new Map(), groundReceipts = new Map(), batchReceipts = new Map();
  const deathReceipts = new Map(), deathDrops = new Map(), dropReceipts = new Map(), deathDropStates = new Map();
  const groundClocks = new Map(), clockReceipts = new Map();
  const intents = new Map();
  const load = (map, id) => map.has(id) ? structuredClone(map.get(id)) : null;
  const save = (map, id, data, expected) => {
    const current = map.get(id);
    if ((current?.version ?? 0) !== expected) return conflict();
    if (map === profiles) {
      const candidate = new Map(profiles); candidate.set(id, { data });
      assertManagedPearls(candidate, uniques);
    }
    map.set(id, { data, version: expected + 1 });
    return { ok: true, version: expected + 1 };
  };
  const preparePearl = (request, nextLocations = locations) => {
    for (const p of request.profiles) if (profiles.get(p.id)?.version !== p.expectedVersion) return conflict();
    const current = uniques.get(request.uid);
    if (current && current.kind !== pearlKind(request.kind)) return { ok: false, why: 'kind' };
    if ((current?.version ?? 0) !== request.expectedVersion || (current?.holder ?? null) !== request.from) return conflict();
    if (!validPearlMove(request, profiles)) return { ok: false, why: 'ownership' };
    const nextProfiles = new Map(profiles), nextUniques = new Map(uniques);
    for (const p of request.profiles) nextProfiles.set(p.id, { data: p.data, version: p.expectedVersion + 1 });
    const unique = { kind: pearlKind(request.kind), holder: request.to, version: request.expectedVersion + 1 };
    nextUniques.set(request.uid, unique);
    try { assertManagedPearls(nextProfiles, nextUniques); assertGroundLocations(nextUniques, nextLocations); }
    catch { return { ok: false, why: 'ownership' }; }
    return { nextProfiles, unique };
  };
  const applyPearl = (request, candidate) => {
    for (const p of request.profiles) profiles.set(p.id, candidate.nextProfiles.get(p.id));
    uniques.set(request.uid, candidate.unique);
  };
  const store = {
    kind: 'memory', durable: false,
    async loadProfile(id) { return load(profiles, playerKey(id)); },
    async saveProfile(id, data, expected) { return save(profiles, playerKey(id), profile(data), version(expected, 0, MAX_VERSION - 1)); },
    async initializeProfile(id, data, importedKey = null) {
      id = playerKey(id);
      data = profile(data);
      if (importedKey !== null) importedKey = legacyKey(importedKey);
      const existing = profiles.get(id);
      if (existing) return structuredClone(existing);
      if (importedKey !== null && legacyImports.has(importedKey) && legacyImports.get(importedKey) !== id) {
        throw new StoreError('legacy_used');
      }
      const candidate = new Map(profiles); candidate.set(id, { data });
      assertManagedPearls(candidate, uniques);
      profiles.set(id, { data, version: 1 });
      if (importedKey !== null) legacyImports.set(importedKey, id);
      return { data: structuredClone(data), version: 1 };
    },
    async legacyClaimed(importedKey) { return legacyImports.has(legacyKey(importedKey)); },
    async loadWorld(id) { return load(worlds, key(id)); },
    async saveWorld(id, data, expected) { return save(worlds, key(id), json(data), version(expected, 0, MAX_VERSION - 1)); },
    async loadGroundClock(world) { world = groundKey(world); return structuredClone(groundClocks.get(world) ?? null); },
    async loadGroundClockOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = clockReceipts.get(operationId);
      return receipt ? checkedGroundClockReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async commitGroundClock(raw) {
      const { operationId, request } = groundClockOperation(raw), text = canonicalText(request);
      const receipt = clockReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      if (intents.has(operationId) || [pearlReceipts,groundReceipts,batchReceipts,deathReceipts,dropReceipts].some(r => r.has(operationId))) {
        return { ok: false, why: 'operation' };
      }
      const current = groundClocks.get(request.world);
      if ((current?.version ?? 0) !== request.expectedVersion || (current?.tick ?? 0) !== request.expectedTick) return conflict();
      const result = groundClockResult(request, operationId), clock = structuredClone(result.clock), stored = { text, result }, reply = structuredClone(result);
      // No await or fallible preparation follows the first write: checkpoint and receipt commit together.
      groundClocks.set(request.world, clock); clockReceipts.set(operationId, stored);
      return reply;
    },
    async loadUnique(uid) { return load(uniques, key(uid, 160)); },
    async loadPearlOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = pearlReceipts.get(operationId);
      return receipt ? checkedPearlReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async commitPearl(raw) {
      const { operationId, request } = pearlOperation(raw), text = canonicalText(request);
      if (clockReceipts.has(operationId)) return { ok: false, why: 'operation' };
      if (!permitsMemoryPearlReceipt(intents, operationId, 'pearl', request)) return { ok: false, why: 'operation' };
      if (groundReceipts.has(operationId) || batchReceipts.has(operationId) || deathReceipts.has(operationId) || dropReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const receipt = pearlReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      const candidate = preparePearl(request);
      if (candidate.ok === false) return candidate;
      const result = pearlResult(request);
      // No await or fallible validation follows the first mutation: all three maps commit as one JS turn.
      applyPearl(request, candidate); pearlReceipts.set(operationId, { text, result });
      return structuredClone(result);
    },
    async loadPearlLocation(uid) { return load(locations, groundKey(uid)); },
    async listPearlGround(world, options = {}) {
      const page = groundPage(world, options);
      return [...locations.entries()].filter(([uid, row]) => row.world === page.world && row.ground &&
        (page.afterUid === null || uid > page.afterUid)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .slice(0, page.limit).map(([uid, row]) => ({ uid, kind: uniques.get(uid).kind.slice(6), ...structuredClone(row) }));
    },
    async loadPearlGroundOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = groundReceipts.get(operationId);
      return receipt ? checkedGroundReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async commitPearlGround(raw) {
      const { operationId, request } = groundOperation(raw), text = canonicalText(request);
      if (clockReceipts.has(operationId)) return { ok: false, why: 'operation' };
      if (!permitsMemoryPearlReceipt(intents, operationId, 'ground', request)) return { ok: false, why: 'operation' };
      const receipt = groundReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      if (pearlReceipts.has(operationId) || batchReceipts.has(operationId) || deathReceipts.has(operationId) || dropReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const nextLocations = new Map(locations);
      const location = { world: request.world, ground: request.ground, version: request.expectedVersion + 1 };
      nextLocations.set(request.uid, location);
      const candidate = preparePearl(request, nextLocations);
      if (candidate.ok === false) return candidate;
      const previous = locations.get(request.uid);
      if (previous && (previous.world !== request.world || previous.version !== request.expectedVersion ||
        (request.from === null) !== (previous.ground !== null))) return { ok: false, why: 'ownership' };
      if (!previous && request.from === null && request.expectedVersion !== 0) return { ok: false, why: 'ownership' };
      const result = groundResult(request);
      const base = { ...request }; delete base.world; delete base.ground;
      // Prepare every receipt/snapshot before changing maps; ground/profile/ledger have one commit point.
      const baseReceipt = request.profiles.length && request.from !== request.to ?
        { text: canonicalText(base), result: pearlResult(base) } : null;
      applyPearl(request, candidate); locations.set(request.uid, location);
      if (baseReceipt) pearlReceipts.set(operationId, baseReceipt);
      groundReceipts.set(operationId, { text, result });
      return structuredClone(result);
    },
    async loadPearlBatchOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = batchReceipts.get(operationId);
      return receipt ? checkedBatchReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async commitPearlBatch(raw) {
      const { operationId, request } = batchOperation(raw), text = canonicalText(request);
      if (clockReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const receipt = batchReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      if (!permitsMemoryPearlReceipt(intents, operationId, 'batch', request)) return { ok: false, why: 'operation' };
      if (pearlReceipts.has(operationId) || groundReceipts.has(operationId) || deathReceipts.has(operationId) || dropReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const p = request.profile, old = profiles.get(p.id);
      if (old?.version !== p.expectedVersion) return conflict();
      const nextProfiles = new Map(profiles), nextUniques = new Map(uniques), nextLocations = new Map(locations);
      for (const q of request.items) {
        const current = uniques.get(q.uid), location = locations.get(q.uid);
        if (current && current.kind !== pearlKind(q.kind)) return { ok: false, why: 'kind' };
        if (!current || current.holder !== p.id || current.version !== q.expectedVersion) return conflict();
        if (location && (location.world !== request.world || location.version !== q.expectedVersion ||
          location.ground !== null)) return { ok: false, why: 'ownership' };
        nextUniques.set(q.uid, { kind: pearlKind(q.kind), holder: q.ground === null ? p.id : null, version: q.expectedVersion + 1 });
        nextLocations.set(q.uid, { world: request.world, ground: q.ground, version: q.expectedVersion + 1 });
      }
      if (!validBatchDelta(request, old.data)) return { ok: false, why: 'ownership' };
      nextProfiles.set(p.id, { data: p.data, version: p.expectedVersion + 1 });
      try { assertManagedPearls(nextProfiles, nextUniques); assertGroundLocations(nextUniques, nextLocations); }
      catch { return { ok: false, why: 'ownership' }; }
      const result = batchResult(request), stored = { text, result }, reply = structuredClone(result);
      // All checks and clones precede the first write; all UIDs, the profile and receipt commit in one turn.
      profiles.set(p.id, nextProfiles.get(p.id));
      for (const q of request.items) { uniques.set(q.uid, nextUniques.get(q.uid)); locations.set(q.uid, nextLocations.get(q.uid)); }
      batchReceipts.set(operationId, stored);
      return reply;
    },
    async loadDeathOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = deathReceipts.get(operationId);
      return receipt ? checkedDeathReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async listDeathDrops(world, options = {}) {
      const page = deathDropPage(world, options);
      const rows = [...deathDrops.values()].filter((d) => d.world === page.world && (!page.after ||
        d.operationId > page.after.operationId || (d.operationId === page.after.operationId && d.ordinal > page.after.ordinal)))
        .sort((a,b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : a.ordinal - b.ordinal);
      return checkedDeathDropPage(structuredClone(rows.slice(0, page.limit)), page);
    },
    async commitDeath(raw) {
      const { operationId, request } = deathOperation(raw), text = canonicalText(request);
      if (clockReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const receipt = deathReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      if (pearlReceipts.has(operationId) || groundReceipts.has(operationId) || batchReceipts.has(operationId) || dropReceipts.has(operationId) ||
          !permitsMemoryPearlReceipt(intents, operationId, 'death', request)) return { ok: false, why: 'operation' };
      for (const p of request.profiles) {
        const old = profiles.get(p.id);
        if (old?.version !== p.expectedVersion || canonicalText(old.data) !== canonicalText(p.before)) return conflict();
      }
      const nextProfiles = new Map(profiles), nextUniques = new Map(uniques), nextLocations = new Map(locations);
      for (const p of request.profiles) nextProfiles.set(p.id, { data: p.data, version: p.expectedVersion + 1 });
      for (const q of request.pearls) {
        const current = uniques.get(q.uid), location = locations.get(q.uid);
        if (current && current.kind !== pearlKind(q.kind)) return { ok: false, why: 'kind' };
        if (!current || current.holder !== request.victim || current.version !== q.expectedVersion) return conflict();
        if (location && (location.world !== request.world || location.version !== q.expectedVersion || location.ground !== null)) {
          return { ok: false, why: 'ownership' };
        }
        nextUniques.set(q.uid, { kind: pearlKind(q.kind), holder: null, version: q.expectedVersion + 1 });
        nextLocations.set(q.uid, { world: request.world, ground: q.ground, version: q.expectedVersion + 1 });
      }
      try { assertManagedPearls(nextProfiles, nextUniques); assertGroundLocations(nextUniques, nextLocations); }
      catch { return { ok: false, why: 'ownership' }; }
      const result = deathResult(request, operationId), reply = structuredClone(result), stored = { text, result };
      const states = result.drops.map((d) => ({ ...structuredClone(d), state: 'ground', version: 1, holder: null, transitionOperationId: null }));
      // No await or fallible preparation after this point. Both profiles, all pearl rows, ordinary
      // drops and the receipt become visible together in this JS turn.
      for (const p of request.profiles) profiles.set(p.id, nextProfiles.get(p.id));
      for (const q of request.pearls) { uniques.set(q.uid, nextUniques.get(q.uid)); locations.set(q.uid, nextLocations.get(q.uid)); }
      for (const d of result.drops) deathDrops.set(`${operationId}:${d.ordinal}`, d);
      for (const d of states) deathDropStates.set(`${operationId}:${d.ordinal}`, d);
      deathReceipts.set(operationId, stored);
      return reply;
    },
    async loadDeathDropOperation(operationId) {
      operationId = playerKey(operationId);
      const receipt = dropReceipts.get(operationId);
      return receipt ? checkedDeathDropReceipt({ request: JSON.parse(receipt.text), result: receipt.result }, operationId) : null;
    },
    async loadDeathDrop(operationId, ordinal) {
      const source = deathDropKey(operationId, ordinal);
      return checkedCurrentDeathDrop(load(deathDropStates, `${source.operationId}:${source.ordinal}`), source);
    },
    async listCurrentDeathDrops(world, options = {}) {
      const page = currentDeathDropPage(world, options);
      const rows = [...deathDropStates.values()].filter((d) => d.state === 'ground' && d.world === page.world && (!page.after ||
        d.operationId > page.after.operationId || (d.operationId === page.after.operationId && d.ordinal > page.after.ordinal)))
        .sort((a,b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : a.ordinal - b.ordinal);
      return checkedCurrentDeathDropPage(structuredClone(rows.slice(0, page.limit)), page);
    },
    async commitDeathDrop(raw) {
      const { operationId, request } = deathDropOperation(raw), text = canonicalText(request);
      if (clockReceipts.has(operationId)) return { ok: false, why: 'operation' };
      const receipt = dropReceipts.get(operationId);
      if (receipt) return receipt.text === text ? { ...structuredClone(receipt.result), replay: true } : { ok: false, why: 'operation' };
      if (pearlReceipts.has(operationId) || groundReceipts.has(operationId) || batchReceipts.has(operationId) ||
          deathReceipts.has(operationId) || !permitsMemoryPearlReceipt(intents, operationId, 'drop', request)) return { ok: false, why: 'operation' };
      const p = request.profile, old = p && profiles.get(p.id);
      if (p && (old?.version !== p.expectedVersion || canonicalText(old.data) !== canonicalText(p.before))) return conflict();
      const sourceKey = `${request.drop.operationId}:${request.drop.ordinal}`, current = deathDropStates.get(sourceKey);
      if (!current || current.version !== request.drop.expectedVersion) return conflict();
      const { state, version: generation, holder, transitionOperationId, ...fields } = current;
      const { expectedVersion, ...wanted } = request.drop;
      if (state !== 'ground') return conflict();
      if (canonicalText(fields) !== canonicalText(wanted) || !deathDropInWindow(request)) {
        return { ok: false, why: 'ownership' };
      }
      const nextProfiles = new Map(profiles);
      if (p) nextProfiles.set(p.id, { data: p.data, version: p.expectedVersion + 1 });
      try { assertManagedPearls(nextProfiles, uniques); }
      catch { return { ok: false, why: 'ownership' }; }
      const result = deathDropResult(request, operationId), next = structuredClone(result.drop), reply = structuredClone(result);
      const stored = { text, result };
      // No await or fallible preparation follows the first mutation. Receiver, tombstone and
      // exact historical receipt commit together; the source death receipt stays immutable.
      if (p) profiles.set(p.id, nextProfiles.get(p.id));
      deathDropStates.set(sourceKey, next); dropReceipts.set(operationId, stored);
      return reply;
    },
    async claimUnique(uid, kind, holder) {
      key(uid, 160); key(kind); holder = playerKey(holder);
      if (managedPearl(kind)) throw new StoreError('operation');
      const current = uniques.get(uid);
      if (current && current.kind !== kind) return { ok: false, why: 'kind' };
      if (current?.holder && current.holder !== holder) return { ok: false, why: 'occupied' };
      if (current?.holder === holder) return { ok: true, version: current.version };
      const next = (current?.version ?? 0) + 1;
      version(next);
      uniques.set(uid, { kind, holder, version: next });
      return { ok: true, version: next };
    },
    async releaseUnique(uid, holder, generation) {
      key(uid, 160); holder = playerKey(holder); version(generation, 1);
      const current = uniques.get(uid);
      if (current && managedPearl(current.kind)) throw new StoreError('operation');
      if (!current || current.holder !== holder || current.version !== generation) return conflict();
      version(current.version + 1);
      current.holder = null; current.version++;
      return { ok: true, version: current.version };
    },
  };
  registerMemoryPearlStore(store, { pearl: pearlReceipts, ground: groundReceipts, batch: batchReceipts, death: deathReceipts, drop: dropReceipts, clock: clockReceipts }, intents);
  return store;
}

export function createSupabaseStore(client) {
  if (!client || typeof client.rpc !== 'function') throw new StoreError('configuration');
  async function rpc(name, args, duplicateCode = null) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) {
        if (duplicateCode && result?.error?.code === duplicateCode) throw new StoreError('legacy_used');
        if (result?.error?.code === 'MNP01') throw new StoreError('ownership');
        if (result?.error?.code === 'MNP02') throw new StoreError('operation');
        throw new Error('rpc');
      }
      return result.data;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError('unavailable'); // Never forward credential-bearing provider errors.
    }
  }
  function record(raw, sanitize) {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') throw new StoreError('response');
    return { data: sanitize(raw.data), version: version(raw.version, 1) };
  }
  function written(raw, reasons = ['conflict']) {
    if (raw?.ok === true) return { ok: true, version: version(raw.version, 1) };
    if (raw?.ok === false && reasons.includes(raw.why)) return { ok: false, why: raw.why };
    throw new StoreError('response');
  }
  return {
    kind: 'supabase', durable: true,
    async loadProfile(id) { return record(await rpc('mn_load_profile', { p_player_id: playerKey(id) }), profile); },
    async initializeProfile(id, data, importedKey = null) {
      if (importedKey !== null) importedKey = legacyKey(importedKey);
      const raw = await rpc('mn_initialize_profile', {
        p_player_id: playerKey(id), p_data: profile(data), p_legacy_key: importedKey,
      }, 'MNL01');
      if (!raw) throw new StoreError('response');
      return record(raw, profile);
    },
    async legacyClaimed(importedKey) {
      const result = await rpc('mn_legacy_claimed', { p_legacy_key: legacyKey(importedKey) });
      if (typeof result !== 'boolean') throw new StoreError('response');
      return result;
    },
    async saveProfile(id, data, expected) {
      return written(await rpc('mn_save_profile', { p_player_id: playerKey(id), p_data: profile(data), p_expected_version: version(expected, 0, MAX_VERSION - 1) }));
    },
    async loadWorld(id) { return record(await rpc('mn_load_world', { p_world: key(id) }), json); },
    async saveWorld(id, data, expected) {
      return written(await rpc('mn_save_world', { p_world: key(id), p_data: json(data), p_expected_version: version(expected, 0, MAX_VERSION - 1) }));
    },
    async loadGroundClock(world) {
      world = groundKey(world);
      const raw = await rpc('mn_load_ground_clock', { p_world: world });
      return raw === null ? null : checkedGroundClock(raw, world);
    },
    async commitGroundClock(raw) {
      const { operationId, request } = groundClockOperation(raw);
      return checkedGroundClockResult(await rpc('mn_commit_ground_clock', { p_operation_id: operationId, p_request: request }), request, operationId);
    },
    async loadGroundClockOperation(operationId) {
      operationId = playerKey(operationId);
      return checkedGroundClockReceipt(await rpc('mn_load_ground_clock_operation', { p_operation_id: operationId }), operationId);
    },
    async loadUnique(uid) {
      const raw = await rpc('mn_load_unique', { p_uid: key(uid, 160) });
      if (raw === null) return null;
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('record');
        return { kind: key(raw.kind), holder: raw.holder === null ? null : playerKey(raw.holder), version: version(raw.version, 1) };
      } catch { throw new StoreError('response'); }
    },
    async commitPearl(raw) {
      const { operationId, request } = pearlOperation(raw);
      return checkedPearlResult(await rpc('mn_commit_pearl', { p_operation_id: operationId, p_request: request }), request);
    },
    async loadPearlOperation(operationId) {
      operationId = playerKey(operationId);
      let raw;
      try {
        // SQL 003 already restricts this table to service_role; no user JWT reaches this client.
        const reply = await client.from('mn_pearl_operations').select('request,result').eq('operation_id', operationId).maybeSingle();
        if (!reply || reply.error) throw new Error('read');
        raw = reply.data;
      } catch { throw new StoreError('unavailable'); }
      return checkedPearlReceipt(raw, operationId);
    },
    async loadPearlLocation(uid) {
      return checkedLocation(await rpc('mn_load_pearl_location', { p_uid: groundKey(uid) }));
    },
    async listPearlGround(world, options = {}) {
      const page = groundPage(world, options);
      const raw = await rpc('mn_list_pearl_ground', { p_world: page.world, p_after_uid: page.afterUid, p_limit: page.limit });
      return checkedGroundPage(raw, page);
    },
    async loadPearlGroundOperation(operationId) {
      operationId = playerKey(operationId);
      return checkedGroundReceipt(await rpc('mn_load_pearl_ground_operation', { p_operation_id: operationId }), operationId);
    },
    async commitPearlGround(raw) {
      const { operationId, request } = groundOperation(raw);
      return checkedGroundResult(await rpc('mn_commit_pearl_ground', { p_operation_id: operationId, p_request: request }), request);
    },
    async loadPearlBatchOperation(operationId) {
      operationId = playerKey(operationId);
      return checkedBatchReceipt(await rpc('mn_load_pearl_batch_operation', { p_operation_id: operationId }), operationId);
    },
    async commitPearlBatch(raw) {
      const { operationId, request } = batchOperation(raw);
      return checkedBatchResult(await rpc('mn_commit_pearl_batch', { p_operation_id: operationId, p_request: request }), request);
    },
    async commitDeath(raw) {
      const { operationId, request } = deathOperation(raw);
      return checkedDeathResult(await rpc('mn_commit_death', { p_operation_id: operationId, p_request: request }), request, operationId);
    },
    async loadDeathOperation(operationId) {
      operationId = playerKey(operationId);
      return checkedDeathReceipt(await rpc('mn_load_death_operation', { p_operation_id: operationId }), operationId);
    },
    async listDeathDrops(world, options = {}) {
      const page = deathDropPage(world, options);
      const raw = await rpc('mn_list_death_drops', { p_world: page.world,
        p_after_operation_id: page.after?.operationId ?? null, p_after_ordinal: page.after?.ordinal ?? null, p_limit: page.limit });
      return checkedDeathDropPage(raw, page);
    },
    async commitDeathDrop(raw) {
      const { operationId, request } = deathDropOperation(raw);
      return checkedDeathDropResult(await rpc('mn_commit_death_drop', { p_operation_id: operationId, p_request: request }), request, operationId);
    },
    async loadDeathDropOperation(operationId) {
      operationId = playerKey(operationId);
      return checkedDeathDropReceipt(await rpc('mn_load_death_drop_operation', { p_operation_id: operationId }), operationId);
    },
    async loadDeathDrop(operationId, ordinal) {
      const source = deathDropKey(operationId, ordinal);
      return checkedCurrentDeathDrop(await rpc('mn_load_death_drop', { p_operation_id: source.operationId, p_ordinal: source.ordinal }), source);
    },
    async listCurrentDeathDrops(world, options = {}) {
      const page = currentDeathDropPage(world, options);
      return checkedCurrentDeathDropPage(await rpc('mn_list_current_death_drops', { p_world: page.world,
        p_after_operation_id: page.after?.operationId ?? null, p_after_ordinal: page.after?.ordinal ?? null, p_limit: page.limit }), page);
    },
    async claimUnique(uid, kind, holder) {
      if (managedPearl(kind)) throw new StoreError('operation');
      return written(await rpc('mn_claim_unique', { p_uid: key(uid, 160), p_kind: key(kind), p_holder: playerKey(holder) }), ['kind', 'occupied']);
    },
    async releaseUnique(uid, holder, generation) {
      return written(await rpc('mn_release_unique', { p_uid: key(uid, 160), p_holder: playerKey(holder), p_version: version(generation, 1) }));
    },
  };
}

// Configuration is explicit until P2 supplies verified account identity. Partial credentials are an
// error, never an implicit fall back to memory. The service client must never receive a user's JWT.
export function storeFromEnv(env = process.env, factory = createClient) {
  const url = env.SUPABASE_URL, serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!url && !serviceKey) return createMemoryStore();
  if (typeof url !== 'string' || typeof serviceKey !== 'string' || !serviceKey.trim()) throw new StoreError('configuration');
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('url');
    const client = factory(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
    return createSupabaseStore(client);
  } catch { throw new StoreError('configuration'); }
}
