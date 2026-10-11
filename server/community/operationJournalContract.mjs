// Exact durable requests. Completed snapshots are evidence, never a world publication event.
import { ContributionError, canonical, contributionCharacter, contributionProject,
  contributionRequest } from './contributionContract.mjs';
import { characterBinding } from './characterBindingContract.mjs';

const fail = code => { throw new ContributionError(code); };
export function operationId(raw) {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)
    || raw === '00000000-0000-0000-0000-000000000000') fail('input');
  return raw;
}
function exact(raw, keys) {
  canonical(raw);
  if (!raw || Array.isArray(raw) || typeof raw !== 'object'
    || Reflect.ownKeys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k))) fail('input');
}
const matches = (a, b) => ['worldId', 'worldEpoch', 'characterId'].every(k => a[k] === b[k]);

export function operationScope(worldId, worldEpoch) {
  contributionCharacter({ worldId, worldEpoch, characterId: '00000000-0000-4000-8000-000000000001',
    version: 1, data: { v: 1, eco: { pack: { goods: {} } } } });
  return { worldId, worldEpoch };
}
export function operationPage(worldId, worldEpoch, afterOperationId = null, limit = 128) {
  const scope = operationScope(worldId, worldEpoch);
  if (afterOperationId !== null) operationId(afterOperationId);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('input');
  return { ...scope, afterOperationId, limit };
}
export function operationIntent(raw) {
  exact(raw, ['operationId', 'binding', 'kind', 'request']);
  operationId(raw.operationId);
  const binding = characterBinding(raw.binding);
  let request;
  if (raw.kind === 'save') {
    request = contributionCharacter(raw.request);
    if (request.version >= 2147483647) fail('input');
  } else if (raw.kind === 'contribution') {
    request = contributionRequest(raw.request);
    if (request.operationId !== raw.operationId) fail('input');
  } else fail('input');
  if (!matches(binding, request)) fail('input');
  return { operationId: raw.operationId, binding, kind: raw.kind, request };
}
export function operationResult(raw, intent) {
  try {
    if (intent.kind === 'save') {
      if (raw?.ok === false) {
        exact(raw, ['ok', 'why']);
        if (!['missing', 'conflict'].includes(raw.why)) fail('response');
      } else {
        exact(raw, ['ok', 'character']);
        if (raw.ok !== true || canonical(contributionCharacter(raw.character))
          !== canonical({ ...intent.request, version: intent.request.version + 1 })) fail('response');
      }
    } else {
      if (raw?.ok === false) {
        exact(raw, ['ok', 'why', 'replay']);
        if (!['missing', 'scope', 'conflict', 'material', 'complete', 'goods'].includes(raw.why)) fail('response');
      } else {
        exact(raw, ['ok', 'accepted', 'character', 'project', 'replay']);
        const c = contributionCharacter(raw.character), p = contributionProject(raw.project), r = intent.request;
        if (raw.ok !== true || !Number.isSafeInteger(raw.accepted) || raw.accepted < 1 || raw.accepted > r.amount
          || !matches(c, r) || c.version !== r.expectedCharacterVersion + 1
          || p.worldId !== r.worldId || p.worldEpoch !== r.worldEpoch || p.projectId !== r.projectId
          || p.version !== r.expectedProjectVersion + 1) fail('response');
      }
      if (raw.replay !== false) fail('response');
    }
    return structuredClone(raw);
  } catch { fail('response'); }
}
export function operationEntry(raw, expectedIntent = null) {
  try {
    exact(raw, ['intent', 'state', 'result']);
    const intent = operationIntent(raw.intent);
    if (expectedIntent && canonical(intent) !== canonical(operationIntent(expectedIntent))) fail('response');
    if (raw.state === 'pending' && raw.result === null) return { intent, state: 'pending', result: null };
    if (raw.state !== 'complete') fail('response');
    return { intent, state: 'complete', result: operationResult(raw.result, intent) };
  } catch { fail('response'); }
}
export function pendingOperationPage(raw, page) {
  try {
    if (!Array.isArray(raw) || raw.length > page.limit) fail('response');
    let previous = page.afterOperationId;
    return raw.map(value => {
      const entry = operationEntry(value), { operationId: id, binding: b } = entry.intent;
      if (entry.state !== 'pending' || b.worldId !== page.worldId || b.worldEpoch !== page.worldEpoch
        || (previous !== null && id <= previous)) fail('response');
      previous = id;
      return entry;
    });
  } catch { fail('response'); }
}
