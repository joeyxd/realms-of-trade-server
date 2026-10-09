// A1b1's optional scoped backend. It must not be mounted alongside M5 profile saves without
// a session authority bridge; these rows do not import or replace the live account profiles.
import {
  ContributionError, canonical, contributionCharacter, contributionProject, contributionRequest,
} from './contributionContract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-zA-Z0-9:_-]{1,100}$/;
const fail = code => { throw new ContributionError(code); };
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === '00000000-0000-0000-0000-000000000000') fail('input');
  return value;
}
function key(value) { if (typeof value !== 'string' || !KEY.test(value)) fail('input'); return value; }
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) fail('response');
}
function scoped(row, worldId, worldEpoch, id, field) {
  if (row.worldId !== worldId || row.worldEpoch !== worldEpoch || row[field] !== id) fail('response');
  return row;
}
function checkedOutcome(raw, request, stored = false) {
  try {
    if (raw?.ok === false) {
      exact(raw, ['ok', 'why', 'replay']);
      if (!['missing', 'scope', 'conflict', 'material', 'complete', 'goods', 'operation'].includes(raw.why)) fail('response');
      if (stored && raw.why === 'operation') fail('response');
    } else {
      exact(raw, ['ok', 'accepted', 'character', 'project', 'replay']);
      if (raw.ok !== true || !Number.isSafeInteger(raw.accepted) || raw.accepted < 1 || raw.accepted > request.amount) fail('response');
      const c = scoped(contributionCharacter(raw.character), request.worldId, request.worldEpoch, request.characterId, 'characterId');
      const p = scoped(contributionProject(raw.project), request.worldId, request.worldEpoch, request.projectId, 'projectId');
      if (c.version !== request.expectedCharacterVersion + 1 || p.version !== request.expectedProjectVersion + 1
        || !Object.hasOwn(p.requirements, request.good) || p.contributed[request.good] < raw.accepted) fail('response');
    }
    if (typeof raw.replay !== 'boolean' || (stored && raw.replay) || (raw.why === 'operation' && raw.replay)) fail('response');
    canonical(raw);
    return structuredClone(raw);
  } catch { fail('response'); }
}

export function createSupabaseContributionStore(client, { timeoutMs = 10000 } = {}) {
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
  const scopeArgs = (worldId, worldEpoch) => ({ p_world_id: key(worldId), p_world_epoch: uuid(worldEpoch) });
  const initialize = async (kind, raw, validate) => {
    const row = validate(raw);
    const result = await rpc(`mn_comm_initialize_${kind}`, { [`p_${kind}`]: row });
    try {
      if (result?.ok === false) {
        exact(result, ['ok', 'why']); if (result.why !== 'conflict') fail('response');
      } else {
        exact(result, ['ok', kind]);
        if (result.ok !== true || canonical(validate(result[kind])) !== canonical(row)) fail('response');
      }
      return structuredClone(result);
    } catch { fail('response'); }
  };
  return {
    kind: 'community-supabase', durable: true,
    initializeCharacter: raw => initialize('character', raw, contributionCharacter),
    initializeProject: raw => initialize('project', raw, contributionProject),
    async commitContribution(raw) {
      const request = contributionRequest(raw);
      return checkedOutcome(await rpc('mn_comm_commit_contribution', { p_request: request }), request);
    },
    async loadCharacter(worldId, worldEpoch, characterId) {
      const raw = await rpc('mn_comm_load_character', { ...scopeArgs(worldId, worldEpoch), p_character_id: uuid(characterId) });
      if (raw === null) return null;
      try { return scoped(contributionCharacter(raw), worldId, worldEpoch, characterId, 'characterId'); }
      catch { fail('response'); }
    },
    async loadProject(worldId, worldEpoch, projectId) {
      const raw = await rpc('mn_comm_load_project', { ...scopeArgs(worldId, worldEpoch), p_project_id: key(projectId) });
      if (raw === null) return null;
      try { return scoped(contributionProject(raw), worldId, worldEpoch, projectId, 'projectId'); }
      catch { fail('response'); }
    },
    async loadContributionReceipt(operationId) {
      const raw = await rpc('mn_comm_load_receipt', { p_operation_id: uuid(operationId) });
      if (raw === null) return null;
      try {
        exact(raw, ['request', 'result']);
        const request = contributionRequest(raw.request);
        if (request.operationId !== operationId) fail('response');
        return { request, result: checkedOutcome(raw.result, request, true) };
      } catch { fail('response'); }
    },
  };
}
