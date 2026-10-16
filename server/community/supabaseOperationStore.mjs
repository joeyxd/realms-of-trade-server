import { ContributionError } from './contributionContract.mjs';
import { operationEntry, operationId, operationIntent, operationPage,
  pendingOperationPage } from './operationJournalContract.mjs';

const fail = code => { throw new ContributionError(code); };
export function createSupabaseOperationStore(client, { timeoutMs = 10000 } = {}) {
  if (typeof client?.rpc !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000)
    fail('configuration');
  const rpc = async (name, args) => {
    const controller = new AbortController(); let timer;
    try {
      const query = client.rpc(name, args);
      const pending = typeof query?.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
      const reply = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      })]);
      if (!reply || reply.error || !Object.hasOwn(reply, 'data')) fail('unavailable');
      return reply.data;
    } catch { fail('unavailable'); }
    finally { clearTimeout(timer); }
  };
  return {
    kind: 'community-operations-supabase', durable: true,
    async prepareOperation(raw) {
      const intent = operationIntent(raw);
      return operationEntry(await rpc('mn_comm_prepare_operation', { p_intent: structuredClone(intent) }), intent);
    },
    async commitOperation(raw) {
      const intent = operationIntent(raw);
      const entry = operationEntry(await rpc('mn_comm_commit_operation', { p_intent: structuredClone(intent) }), intent);
      if (entry.state !== 'complete') fail('response');
      return entry;
    },
    async loadOperation(rawId) {
      const id = operationId(rawId);
      const raw = await rpc('mn_comm_load_operation', { p_operation_id: id });
      if (raw === null) return null;
      const entry = operationEntry(raw);
      if (entry.intent.operationId !== id) fail('response');
      return entry;
    },
    async listPendingOperations(worldId, worldEpoch, afterOperationId = null, limit = 128) {
      const page = operationPage(worldId, worldEpoch, afterOperationId, limit);
      const raw = await rpc('mn_comm_list_pending_operations', { p_world_id: worldId, p_world_epoch: worldEpoch,
        p_after_operation_id: afterOperationId, p_limit: limit });
      return pendingOperationPage(raw, page);
    },
  };
}
