// Exact-envelope recovery for one stopped M5 authority. Preparation is not a gameplay ACK or lease.
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { groundTransactionOperation, checkedGroundTransactionResult, checkedGroundTransactionReceipt } from './groundTransaction.mjs';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys;
const worldKey = world => {
  if (typeof world !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(world)) fail('configuration');
  return world;
};
const operationKey = raw => {
  const key = playerKey(raw);
  if (key !== raw || key === '00000000-0000-0000-0000-000000000000') fail('operation');
  return key;
};
const terminal = result => result.ok ? 'committed' : result.why === 'conflict' ? 'conflict' : 'rejected';
const original = result => result.ok ? { ...result, replay: false } : result;

export function checkedGroundTransactionIntent(input, worldId, expectedId = null) {
  try {
    const raw = snapshotDropData(input);
    if (!exact(raw, 'operationId,request,result,state')) fail('response');
    const concrete = groundTransactionOperation({ operationId: raw.operationId, request: raw.request });
    if (concrete.request.world !== worldId || expectedId !== null && concrete.operationId !== expectedId ||
        !['pending', 'committed', 'conflict', 'rejected'].includes(raw.state)) fail('response');
    if (raw.state === 'pending') {
      if (raw.result !== null) fail('response');
    } else {
      const result = checkedGroundTransactionResult(raw.result, concrete.request, concrete.operationId);
      if (result.ok && result.replay || terminal(result) !== raw.state) fail('response');
    }
    return { ...concrete, state: raw.state, result: clone(raw.result) };
  } catch { fail('response'); }
}

export function createSupabaseGroundTransactionJournal(client, worldId) {
  const scope = worldKey(worldId);
  if (!client || typeof client.rpc !== 'function') fail('configuration');
  async function rpc(name, args) {
    try {
      const reply = await client.rpc(name, args);
      if (!reply || reply.error) {
        if (reply?.error?.code === 'MNP02') fail('operation');
        throw new Error('rpc');
      }
      return reply.data;
    } catch (error) { throw error instanceof StoreError ? error : new StoreError('unavailable'); }
  }
  return Object.freeze({
    scope, durable: true,
    async check() {
      const raw = await rpc('mn_ground_transaction_journal_ready', {});
      let value;
      try { value = snapshotDropData(raw); } catch { fail('response'); }
      if (!exact(value, 'version') || value.version !== 1) fail('response');
      return { version: 1 };
    },
    async prepare(input) {
      const raw = groundTransactionOperation(input);
      if (raw.request.world !== scope) fail('operation');
      const row = checkedGroundTransactionIntent(await rpc('mn_prepare_ground_transaction_intent', {
        p_operation_id: raw.operationId, p_request: raw.request,
      }), scope, raw.operationId);
      if (!same(row.request, raw.request)) fail('response');
      return row;
    },
    async load(input) {
      const operationId = operationKey(input);
      const raw = await rpc('mn_load_ground_transaction_intent', { p_operation_id: operationId });
      return raw === null ? null : checkedGroundTransactionIntent(raw, scope, operationId);
    },
    async list(options = {}) {
      let value;
      try { value = snapshotDropData(options); } catch { fail('operation'); }
      if (!value || Array.isArray(value) || Object.keys(value).some(key => !['afterId', 'limit'].includes(key))) fail('operation');
      const afterId = value.afterId == null ? null : operationKey(value.afterId), limit = value.limit ?? 64;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) fail('operation');
      const raw = await rpc('mn_list_ground_transaction_intents', { p_world: scope, p_after_id: afterId, p_limit: limit });
      let rows;
      try { rows = snapshotDropData(raw); } catch { fail('response'); }
      if (!Array.isArray(rows) || rows.length > limit) fail('response');
      let previous = afterId;
      return rows.map(input => {
        const row = checkedGroundTransactionIntent(input, scope);
        if (row.state !== 'pending' || previous !== null && row.operationId <= previous) fail('response');
        previous = row.operationId;
        return row;
      });
    },
  });
}

export function assertGroundTransactionJournal(journal, worldId) {
  if (!journal || journal.scope !== worldKey(worldId) || journal.durable !== true ||
      ['check', 'prepare', 'load', 'list'].some(name => typeof journal[name] !== 'function')) fail('configuration');
  return journal;
}

function checkedIntent(row, journal, raw) {
  const value = checkedGroundTransactionIntent(row, journal.scope, raw.operationId);
  if (!same(value.request, raw.request)) fail('response');
  return value;
}

export async function prepareGroundTransactionIntent(journal, raw, assertActive = () => {}) {
  try {
    const row = checkedIntent(await journal.prepare(clone(raw)), journal, raw); assertActive();
    return row;
  } catch (error) {
    assertActive();
    if (error instanceof StoreError && ['operation', 'response', 'cancelled'].includes(error.code)) throw error;
    // The prepare reply can be lost too. Never dispatch without observing the exact durable row.
    const row = await journal.load(raw.operationId); assertActive();
    if (row !== null) return checkedIntent(row, journal, raw);
    const retried = checkedIntent(await journal.prepare(clone(raw)), journal, raw); assertActive();
    return retried;
  }
}

export async function confirmGroundTransactionIntent(store, journal, raw, result, assertActive = () => {}) {
  const row = checkedIntent(await journal.load(raw.operationId), journal, raw); assertActive();
  if (row.state !== terminal(result) || !same(row.result, original(result))) fail('response');
  const receipt = checkedGroundTransactionReceipt(await store.loadGroundTransaction(raw.operationId), raw.operationId);
  assertActive();
  if (result.ok) {
    if (!receipt || !same(receipt.request, raw.request) || !same(receipt.result, row.result)) fail('response');
  } else if (receipt !== null) fail('response');
  return row;
}

// Startup resolves pending effects and subsequently reloads CURRENT rows. No historical snapshot,
// profile, event or ACK is applied by recovery, even when the exact transaction is replayed.
export async function recoverGroundTransactionIntents({ store, journal, worldId, assertActive = () => {} }) {
  assertGroundTransactionJournal(journal, worldId);
  if (!store || ['commitGroundTransaction', 'loadGroundTransaction'].some(key => typeof store[key] !== 'function') ||
      typeof assertActive !== 'function') fail('configuration');
  const capability = await journal.check(); assertActive();
  if (!same(capability, { version: 1 })) fail('response');
  const summary = { committed: 0, conflicts: 0, rejected: 0 };
  // SQL019 permits one pending envelope per world. A second row is an incompatible authority.
  const rows = await journal.list({ limit: 2 }); assertActive();
  if (!Array.isArray(rows) || rows.length > 1) fail('response');
  for (const input of rows) {
    const row = checkedGroundTransactionIntent(input, worldId);
    if (row.state !== 'pending') fail('response');
    const raw = { operationId: row.operationId, request: row.request };
    let result;
    try {
      result = checkedGroundTransactionResult(await store.commitGroundTransaction(clone(raw)), raw.request, raw.operationId);
      assertActive();
    } catch (error) {
      assertActive();
      if (error instanceof StoreError && ['response', 'cancelled'].includes(error.code)) throw error;
      const current = checkedIntent(await journal.load(raw.operationId), journal, raw); assertActive();
      if (current.state !== 'pending') result = current.result;
      else {
        result = checkedGroundTransactionResult(await store.commitGroundTransaction(clone(raw)), raw.request, raw.operationId);
        assertActive();
      }
    }
    await confirmGroundTransactionIntent(store, journal, raw, result, assertActive);
    assertActive();
    summary[result.ok ? 'committed' : result.why === 'conflict' ? 'conflicts' : 'rejected']++;
  }
  const pending = await journal.list({ limit: 1 }); assertActive();
  if (!Array.isArray(pending) || pending.length !== 0) fail('conflict');
  return summary;
}
