// Trusted provisioning contract for immutable account-to-character ownership in a world epoch.
import { ContributionError, canonical, contributionScopeKey } from './contributionContract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const KEY = /^[a-zA-Z0-9:_-]{1,100}$/;
const fail = code => { throw new ContributionError(code); };

function exact(raw, fields) {
  canonical(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).length !== fields.length
    || fields.some(k => !Object.hasOwn(raw, k))
    || fields.some(k => { const d = Object.getOwnPropertyDescriptor(raw, k); return !d.enumerable || !Object.hasOwn(d, 'value'); })) fail('input');
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === NIL_UUID) fail('input');
}
function key(value) { if (typeof value !== 'string' || !KEY.test(value)) fail('input'); }

export function characterBinding(raw) {
  exact(raw, ['accountId', 'worldId', 'worldEpoch', 'characterId']);
  uuid(raw.accountId); key(raw.worldId); uuid(raw.worldEpoch); uuid(raw.characterId);
  return structuredClone(raw);
}

export function bindingLookup(accountId, worldId, worldEpoch) {
  const raw = { accountId, worldId, worldEpoch };
  exact(raw, ['accountId', 'worldId', 'worldEpoch']);
  uuid(accountId); key(worldId); uuid(worldEpoch);
  return structuredClone(raw);
}

export const bindingAccountKey = binding => contributionScopeKey(binding, binding.accountId);
export const bindingCharacterKey = binding => contributionScopeKey(binding, binding.characterId);
