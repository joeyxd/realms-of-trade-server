import { ContributionError, canonical } from './contributionContract.mjs';
import { accountScope, characterAllocation, identityRecord } from './identityContract.mjs';

const fail = code => { throw new ContributionError(code); };
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) fail('response');
}

export function createSupabaseIdentityStore(client, { timeoutMs = 10000 } = {}) {
  if (typeof client?.rpc !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) fail('configuration');
  const rpc = async (name, args) => {
    const controller = new AbortController(); let timer;
    try {
      const query = client.rpc(name, args);
      const pending = typeof query?.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
      const response = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      })]);
      if (!response || response.error || !Object.hasOwn(response, 'data')) fail('unavailable');
      return response.data;
    } catch { fail('unavailable'); }
    finally { clearTimeout(timer); }
  };
  return {
    kind: 'community-identity-supabase', durable: true,
    async loadIdentity(rawScope) {
      const scope = accountScope(rawScope);
      const raw = await rpc('mn_comm_load_identity', {
        p_account_id: scope.accountId, p_world_id: scope.worldId, p_world_epoch: scope.worldEpoch,
      });
      if (raw === null) return null;
      return identityRecord(raw, scope);
    },
    async allocateIdentity(raw) {
      const allocation = characterAllocation(raw);
      const result = await rpc('mn_comm_allocate_identity', {
        p_binding: allocation.binding, p_data: allocation.data,
      });
      try {
        if (result?.ok === false) {
          exact(result, ['ok', 'why']);
          if (result.why !== 'occupied') fail('response');
          return structuredClone(result);
        }
        exact(result, ['ok', 'binding', 'character']);
        if (result.ok !== true) fail('response');
        const record = identityRecord({ binding: result.binding, character: result.character }, {
          accountId: allocation.binding.accountId, worldId: allocation.binding.worldId,
          worldEpoch: allocation.binding.worldEpoch,
        });
        canonical(record);
        return { ok: true, ...structuredClone(record) };
      } catch { fail('response'); }
    },
  };
}
