// Server-only, exact-request journal. This is recovery for one authority, not a lease between hosts.
import { StoreError, playerKey } from './store.mjs';
import { pearlOperation, canonicalText } from './pearlOperations.mjs';
import { groundOperation, groundKey } from './pearlGround.mjs';
import { batchOperation } from './pearlBatch.mjs';
import { deathOperation } from './deathOperation.mjs';
import { deathDropOperation } from './deathDropOperation.mjs';
import { memoryPearlJournal, assertMemoryPearlIntent } from './pearlMemoryIdentity.mjs';

const states = ['pending', 'committed', 'conflict', 'rejected'];
const operations = { pearl: pearlOperation, ground: groundOperation, batch: batchOperation, death: deathOperation, drop: deathDropOperation };
export function journalEntry(scope, family, concrete, state = 'pending') {
  scope = groundKey(scope);
  if (!Object.hasOwn(operations, family) || !states.includes(state)) throw new StoreError('operation');
  const { operationId, request } = operations[family](concrete);
  // Normalization must not quietly change a persisted request or a builder's concrete payload.
  if (canonicalText({ operationId, ...request }) !== canonicalText(concrete) ||
    (family !== 'pearl' && request.world !== scope)) throw new StoreError('operation');
  return { operationId, scope, family, request, state };
}
export function checkedJournalEntry(raw, scope) {
  try {
    const entry = journalEntry(scope, raw.family, { operationId: raw.operationId, ...raw.request }, raw.state);
    if (canonicalText(raw) !== canonicalText(entry)) throw new Error('record');
    return entry;
  } catch { throw new StoreError('response'); }
}
const sameIdentity = (a, b) => canonicalText({ ...a, state: 'pending' }) === canonicalText({ ...b, state: 'pending' });
function pageOptions(options = {}) {
  const afterId = options.afterId === undefined || options.afterId === null ? null : playerKey(options.afterId);
  const limit = options.limit ?? 64;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new StoreError('operation');
  return { afterId, limit };
}

// Share this factory across reconstructed sessions to model restart; a new factory loses all rows.
export function createMemoryPearlJournals(store = null) {
  const namespace = store === null ? null : memoryPearlJournal(store);
  const rows = namespace?.intents ?? new Map();
  return (scope) => {
    scope = groundKey(scope);
    return {
      scope, durable: false,
      async prepare(family, concrete) {
        const entry = journalEntry(scope, family, concrete), old = rows.get(entry.operationId);
        if (old && !sameIdentity(old, entry)) throw new StoreError('operation');
        if (!old && namespace) assertMemoryPearlIntent(namespace, entry);
        if (!old) rows.set(entry.operationId, entry);
        return structuredClone(old ?? entry);
      },
      async resolve(family, concrete, state) {
        const entry = journalEntry(scope, family, concrete, state), old = rows.get(entry.operationId);
        if (state === 'pending' || !old || !sameIdentity(old, entry) ||
          (old.state !== 'pending' && old.state !== state)) throw new StoreError('operation');
        rows.set(entry.operationId, entry);
        return structuredClone(entry);
      },
      async list(options = {}) {
        const { afterId, limit } = pageOptions(options);
        return [...rows.values()].filter((r) => r.scope === scope && r.state === 'pending' &&
          (afterId === null || r.operationId > afterId)).sort((a, b) => a.operationId < b.operationId ? -1 : 1)
          .slice(0, limit).map((r) => structuredClone(r));
      },
    };
  };
}

export function createSupabasePearlJournal(client, scope) {
  scope = groundKey(scope);
  if (!client || typeof client.rpc !== 'function') throw new StoreError('configuration');
  async function rpc(name, args) {
    try {
      const reply = await client.rpc(name, args);
      if (!reply || reply.error) {
        if (reply?.error?.code === 'MNP02') throw new StoreError('operation');
        throw new Error('rpc');
      }
      return reply.data;
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError('unavailable'); // Never expose provider errors or credentials.
    }
  }
  async function write(name, family, concrete, state) {
    const expected = journalEntry(scope, family, concrete, state ?? 'pending');
    const raw = await rpc(name, { p_scope: scope, p_family: family, p_operation_id: expected.operationId,
      p_request: expected.request, ...(state ? { p_state: state } : {}) });
    const result = checkedJournalEntry(raw, scope);
    if (!sameIdentity(result, expected) || (state && result.state !== state)) throw new StoreError('response');
    return result;
  }
  return {
    scope, durable: true,
    prepare: (family, concrete) => write('mn_prepare_pearl_intent', family, concrete),
    resolve(family, concrete, state) {
      if (!states.includes(state) || state === 'pending') return Promise.reject(new StoreError('operation'));
      return write('mn_resolve_pearl_intent', family, concrete, state);
    },
    async list(options = {}) {
      const { afterId, limit } = pageOptions(options);
      const raw = await rpc('mn_list_pearl_intents', { p_scope: scope, p_after_id: afterId, p_limit: limit });
      if (!Array.isArray(raw) || raw.length > limit) throw new StoreError('response');
      let previous = afterId;
      return raw.map((r) => {
        const entry = checkedJournalEntry(r, scope);
        if (entry.state !== 'pending' || (previous !== null && entry.operationId <= previous)) throw new StoreError('response');
        previous = entry.operationId;
        return entry;
      });
    },
  };
}
