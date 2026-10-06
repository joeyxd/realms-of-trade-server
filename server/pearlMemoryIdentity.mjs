// Private binding between a memory store and its optional journal. Unbound journals remain useful
// test doubles, but only a bound factory shares SQL008's receipt/intent identity namespace.
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';

const stores = new WeakMap();
export function registerMemoryPearlStore(store, receipts, intents) { stores.set(store, { receipts, intents }); }
export function memoryPearlJournal(store) {
  const namespace = stores.get(store);
  if (!namespace) throw new StoreError('configuration');
  return namespace;
}
export function permitsMemoryPearlReceipt(intents, operationId, family, request) {
  const entry = intents.get(operationId);
  if (!entry) return true;
  if (family !== 'batch') return entry.family !== 'batch';
  return entry.family === 'batch' && entry.scope === request.world && entry.state === 'pending' &&
    canonicalText(entry.request) === canonicalText(request);
}
export function assertMemoryPearlIntent(namespace, entry) {
  const { receipts } = namespace;
  const batch = receipts.batch.get(entry.operationId);
  if (entry.family === 'batch') {
    if (receipts.pearl.has(entry.operationId) || receipts.ground.has(entry.operationId) ||
      (batch && batch.text !== canonicalText(entry.request))) throw new StoreError('operation');
  } else if (batch) throw new StoreError('operation');
}
