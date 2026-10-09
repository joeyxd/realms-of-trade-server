// W01 is dormant storage. No host mounts it and no player request can call it directly.
import { AssetRegistryError, requestOf, assetOf, uuid, canonical, sourceOf, registerAsset,
  operationOf, checkedPrepare, checkedOutcome, pageOf, checkedPage, claimOf, checkedClaim } from './assetContract.mjs';
export { AssetRegistryError } from './assetContract.mjs';

const copy = (value) => structuredClone(value);
const failure = (why, replay = false) => ({ ok: false, replay, why });

export function createMemoryAssetRegistry() {
  const assets = new Map(), operations = new Map();
  const pending = () => [...operations.values()].filter((op) => op.state === 'pending');
  const eligibility = (r) => {
    const asset = assets.get(r.assetId);
    if (r.action === 'register') {
      if (asset) return 'conflict';
      if ([...assets.values()].some((a) => sourceOf(a) === sourceOf(r))) return 'identity';
    } else {
      if (!asset || asset.worldId !== r.worldId || asset.worldGeneration !== r.worldGeneration
        || asset.version !== r.expectedVersion) return 'conflict';
      if (asset.ownerId !== r.from) return 'ownership';
    }
    return null;
  };
  const terminal = (id, cancel) => {
    const op = operations.get(uuid(id));
    if (!op) return failure('missing');
    if (op.state !== 'pending') return copy({ ...op.result, replay: true });
    const r = op.request, why = cancel ? 'cancelled' : eligibility(r);
    if (why) { op.state = cancel ? 'cancelled' : 'rejected'; op.result = { ok: false, why }; }
    else {
      const asset = r.action === 'register' ? registerAsset(r)
        : { ...assets.get(r.assetId), ownerId: r.to, version: r.expectedVersion + 1 };
      assets.set(r.assetId, asset); op.state = 'committed'; op.result = { ok: true, asset: copy(asset) };
    }
    return copy({ ...op.result, replay: false });
  };
  // Memory mutations deliberately contain no awaits; concurrent callers observe a complete transition.
  return {
    kind: 'memory', durable: false,
    async prepare(raw) {
      const request = requestOf(raw), previous = operations.get(request.operationId);
      if (previous) return canonical(previous.request) === canonical(request)
        ? copy({ ok: true, replay: true, operation: previous }) : failure('operation');
      if (pending().some((op) => op.request.assetId === request.assetId
        || (request.action === 'register' && sourceOf(op.request.action === 'register'
          ? op.request : assets.get(op.request.assetId)) === sourceOf(request)))) return failure('busy');
      const why = eligibility(request); if (why) return failure(why);
      const operation = { operationId: request.operationId, request, state: 'pending', result: null };
      operations.set(request.operationId, operation);
      return copy({ ok: true, replay: false, operation });
    },
    async commit(id) { return terminal(id, false); },
    async cancel(id) { return terminal(id, true); },
    async loadAsset(id) { return copy(assets.get(uuid(id)) ?? null); },
    async loadOperation(id) { return copy(operations.get(uuid(id)) ?? null); },
    async listPending(worldId, worldGeneration, options) {
      const page = pageOf(worldId, worldGeneration, options);
      return copy(pending().filter((op) => op.request.worldId === page.worldId
        && op.request.worldGeneration === page.worldGeneration
        && (page.afterId === null || op.operationId > page.afterId))
        .sort((a, b) => a.operationId < b.operationId ? -1 : 1).slice(0, page.limit));
    },
    async checkClaim(raw) {
      const claim = claimOf(raw), asset = assets.get(claim.assetId);
      const why = pending().some((op) => op.request.assetId === claim.assetId) ? 'busy' : !asset ? 'missing'
        : asset.ownerId !== claim.ownerId ? 'ownership' : asset.version !== claim.version ? 'conflict' : null;
      return why ? { ok: false, why } : { ok: true };
    },
  };
}

export function createSupabaseAssetRegistry(client) {
  if (!client || typeof client.rpc !== 'function') throw new AssetRegistryError('input');
  async function rpc(name, args) {
    let reply;
    try { reply = await client.rpc(name, args); }
    catch { throw new AssetRegistryError('unavailable'); }
    if (reply?.error) throw new AssetRegistryError(reply.error.code === 'MNW01' ? 'input' : 'unavailable');
    if (!reply || !Object.hasOwn(reply, 'data')) throw new AssetRegistryError('response');
    return reply.data;
  }
  const registry = {
    kind: 'supabase', durable: true,
    async prepare(raw) {
      const request = requestOf(raw);
      return checkedPrepare(await rpc('mn_web3_prepare', { p_request: request }), request);
    },
    async commit(id) {
      uuid(id);
      const raw = await rpc('mn_web3_commit', { p_operation_id: id });
      return checkedOutcome(raw, await registry.loadOperation(id));
    },
    async cancel(id) {
      uuid(id);
      const raw = await rpc('mn_web3_cancel', { p_operation_id: id });
      return checkedOutcome(raw, await registry.loadOperation(id));
    },
    async loadAsset(id) {
      uuid(id); const raw = await rpc('mn_web3_load_asset', { p_asset_id: id });
      if (raw === null) return null;
      const asset = assetOf(raw);
      if (asset.assetId !== id) throw new AssetRegistryError('response');
      return asset;
    },
    async loadOperation(id) {
      uuid(id); const raw = await rpc('mn_web3_load_operation', { p_operation_id: id });
      return raw === null ? null : operationOf(raw, id);
    },
    async listPending(worldId, worldGeneration, options) {
      const page = pageOf(worldId, worldGeneration, options);
      return checkedPage(await rpc('mn_web3_list_pending', { p_world_id: page.worldId,
        p_world_generation: page.worldGeneration, p_after_id: page.afterId, p_limit: page.limit }), page);
    },
    async checkClaim(raw) {
      const claim = claimOf(raw);
      return checkedClaim(await rpc('mn_web3_check_claim', { p_asset_id: claim.assetId,
        p_owner_id: claim.ownerId, p_version: claim.version }));
    },
  };
  return registry;
}
