// Server-owned account/character identity in one world generation. No browser profile adoption.
import { ContributionError, canonical, contributionCharacter } from './contributionContract.mjs';
import { bindingLookup, characterBinding } from './characterBindingContract.mjs';
export { characterBinding } from './characterBindingContract.mjs';

const fail = code => { throw new ContributionError(code); };
function exact(raw, fields) {
  canonical(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Reflect.ownKeys(raw).length !== fields.length || fields.some(k => !Object.hasOwn(raw, k))) fail('input');
}
export function accountScope(raw) {
  exact(raw, ['accountId', 'worldId', 'worldEpoch']);
  return bindingLookup(raw.accountId, raw.worldId, raw.worldEpoch);
}
export function characterAllocation(raw) {
  exact(raw, ['binding', 'data']);
  const binding = characterBinding(raw.binding);
  const { accountId: _accountId, ...scope } = binding;
  const character = contributionCharacter({ ...scope, version: 1, data: raw.data });
  return { binding, data: character.data };
}
export function identityRecord(raw, expectedScope) {
  try {
    exact(raw, ['binding', 'character']);
    const binding = characterBinding(raw.binding), scope = accountScope(expectedScope);
    const character = contributionCharacter(raw.character);
    if (Object.keys(scope).some(k => binding[k] !== scope[k])
      || ['worldId', 'worldEpoch', 'characterId'].some(k => character[k] !== binding[k])) fail('response');
    return { binding, character };
  } catch { fail('response'); }
}
