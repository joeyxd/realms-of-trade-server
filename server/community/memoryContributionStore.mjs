// Process-local contribution store for the isolated A1a contract. It is neither durable nor mounted.
import {
  ContributionError,
  canonical,
  contributionCharacter,
  contributionDelta,
  contributionProject,
  contributionRequest,
  contributionScopeKey,
} from './contributionContract.mjs';
import { accountScope, characterAllocation, identityRecord } from './identityContract.mjs';
import { bindingAccountKey, bindingCharacterKey, bindingLookup, characterBinding } from './characterBindingContract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const KEY = /^[a-zA-Z0-9:_-]{1,100}$/;
const failInput = () => { throw new ContributionError('input'); };

function checkedUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value) || NIL_UUID.test(value)) failInput();
  return value;
}

function checkedKey(value) {
  if (typeof value !== 'string' || !KEY.test(value)) failInput();
  return value;
}

function scopeId(worldId, worldEpoch, id, validateId) {
  checkedKey(worldId);
  checkedUuid(worldEpoch);
  validateId(id);
  return contributionScopeKey({ worldId, worldEpoch }, id);
}

function copy(value) { return structuredClone(value); }

export function createMemoryContributionStore({ characters = [], projects = [], bindings = [] } = {}) {
  if (!Array.isArray(characters) || !Array.isArray(projects) || !Array.isArray(bindings)) failInput();

  const characterRows = new Map();
  const projectRows = new Map();
  const receipts = new Map();
  const bindingRows = new Map();
  const bindingOwners = new Map();

  for (const raw of characters) {
    const row = contributionCharacter(raw);
    const key = scopeId(row.worldId, row.worldEpoch, row.characterId, checkedUuid);
    if (characterRows.has(key)) failInput();
    characterRows.set(key, row);
  }

  for (const raw of projects) {
    const row = contributionProject(raw);
    const key = scopeId(row.worldId, row.worldEpoch, row.projectId, checkedKey);
    if (projectRows.has(key)) failInput();
    projectRows.set(key, row);
  }

  for (const raw of bindings) {
    const row = characterBinding(raw), accountKey = bindingAccountKey(row), characterKey = bindingCharacterKey(row);
    if (bindingRows.has(accountKey) || bindingOwners.has(characterKey)
      || !characterRows.has(characterKey)) failInput();
    bindingRows.set(accountKey, row);
    bindingOwners.set(characterKey, accountKey);
  }

  return {
    kind: 'community-memory',
    durable: false,

    async loadIdentity(raw) {
      const scope = accountScope(raw);
      const binding = bindingRows.get(contributionScopeKey(scope, scope.accountId));
      if (!binding) return null;
      return identityRecord({ binding, character: characterRows.get(contributionScopeKey(binding, binding.characterId)) }, scope);
    },

    async allocateIdentity(raw) {
      const allocation = characterAllocation(raw), binding = allocation.binding;
      const { accountId, ...scope } = binding;
      const ownerKey = contributionScopeKey(scope, accountId), characterKey = contributionScopeKey(scope, scope.characterId);
      const previous = bindingRows.get(ownerKey);
      if (previous) {
        const record = identityRecord({ binding: previous,
          character: characterRows.get(contributionScopeKey(previous, previous.characterId)) },
        { accountId, worldId: binding.worldId, worldEpoch: binding.worldEpoch });
        return { ok: true, ...record };
      }
      if (bindingOwners.has(characterKey)) return { ok: false, why: 'occupied' };
      // Existing unowned test rows are never adopted or overwritten by an account.
      if (characterRows.has(characterKey)) return { ok: false, why: 'occupied' };
      const character = contributionCharacter({ ...scope, version: 1, data: allocation.data });
      const reply = { ok: true, binding: copy(binding), character: copy(character) };
      const storedBinding = copy(binding), storedCharacter = copy(character);
      // All preparation precedes this synchronous atomic publication, just like contributions.
      characterRows.set(characterKey, storedCharacter);
      bindingRows.set(ownerKey, storedBinding); bindingOwners.set(characterKey, ownerKey);
      return reply;
    },

    async initializeBinding(raw) {
      const binding = characterBinding(raw), accountKey = bindingAccountKey(binding);
      const characterKey = bindingCharacterKey(binding);
      // Existence is checked for every call, including a replay, to match the durable FK boundary.
      if (!characterRows.has(characterKey)) return { ok: false, why: 'missing' };
      const previous = bindingRows.get(accountKey);
      if (previous) return canonical(previous) === canonical(binding)
        ? { ok: true, binding: copy(binding) } : { ok: false, why: 'conflict' };
      if (bindingOwners.has(characterKey)) return { ok: false, why: 'conflict' };
      const stored = copy(binding), reply = { ok: true, binding: copy(binding) };
      bindingRows.set(accountKey, stored); bindingOwners.set(characterKey, accountKey);
      return reply;
    },

    async loadBinding(accountId, worldId, worldEpoch) {
      const scope = bindingLookup(accountId, worldId, worldEpoch);
      const row = bindingRows.get(contributionScopeKey(scope, scope.accountId));
      return row === undefined ? null : copy(row);
    },

    async initializeCharacter(raw) {
      const row = contributionCharacter(raw);
      const key = scopeId(row.worldId, row.worldEpoch, row.characterId, checkedUuid);
      const previous = characterRows.get(key);
      if (previous) return canonical(previous) === canonical(row)
        ? { ok: true, character: copy(row) } : { ok: false, why: 'conflict' };
      const stored = copy(row), reply = { ok: true, character: copy(row) };
      characterRows.set(key, stored);
      return reply;
    },

    async initializeProject(raw) {
      const row = contributionProject(raw);
      const key = scopeId(row.worldId, row.worldEpoch, row.projectId, checkedKey);
      const previous = projectRows.get(key);
      if (previous) return canonical(previous) === canonical(row)
        ? { ok: true, project: copy(row) } : { ok: false, why: 'conflict' };
      const stored = copy(row), reply = { ok: true, project: copy(row) };
      projectRows.set(key, stored);
      return reply;
    },

    async saveCharacter(raw) {
      const row = contributionCharacter(raw);
      if (row.version > 2147483646) failInput();
      const key = scopeId(row.worldId, row.worldEpoch, row.characterId, checkedUuid);
      const previous = characterRows.get(key);
      if (!previous) return { ok: false, why: 'missing' };
      if (previous.version !== row.version) return { ok: false, why: 'conflict' };
      const next = { ...copy(row), version: row.version + 1 };
      const reply = { ok: true, character: copy(next) };
      const stored = copy(next);
      characterRows.set(key, stored);
      return reply;
    },

    async commitContribution(raw) {
      const request = contributionRequest(raw);
      const requestText = canonical(request);
      const previous = receipts.get(request.operationId);
      if (previous) {
        if (canonical(previous.request) !== requestText) return { ok: false, why: 'operation', replay: false };
        return { ...copy(previous.result), replay: true };
      }

      const characterKey = scopeId(request.worldId, request.worldEpoch, request.characterId, checkedUuid);
      const projectKey = scopeId(request.worldId, request.worldEpoch, request.projectId, checkedKey);
      const character = characterRows.get(characterKey);
      const project = projectRows.get(projectKey);
      let outcome;
      if (!character || !project) outcome = { ok: false, why: 'missing', replay: false };
      else {
        const delta = contributionDelta(request, character, project);
        outcome = delta.ok
          ? { ok: true, accepted: delta.accepted, character: delta.character, project: delta.project, replay: false }
          : { ...delta, replay: false };
      }

      // Allocate and clone every published object before the first state write.
      const receipt = { request: copy(request), result: copy(outcome) };
      const reply = copy(outcome);
      const nextCharacter = outcome.ok ? copy(outcome.character) : null;
      const nextProject = outcome.ok ? copy(outcome.project) : null;

      // No await or fallible transformation sits between these synchronous map writes.
      if (outcome.ok) {
        characterRows.set(characterKey, nextCharacter);
        projectRows.set(projectKey, nextProject);
      }
      receipts.set(request.operationId, receipt);
      return reply;
    },

    async loadCharacter(worldId, worldEpoch, characterId) {
      const key = scopeId(worldId, worldEpoch, characterId, checkedUuid);
      const row = characterRows.get(key);
      return row === undefined ? null : copy(row);
    },

    async loadProject(worldId, worldEpoch, projectId) {
      const key = scopeId(worldId, worldEpoch, projectId, checkedKey);
      const row = projectRows.get(key);
      return row === undefined ? null : copy(row);
    },

    async loadContributionReceipt(operationId) {
      checkedUuid(operationId);
      const receipt = receipts.get(operationId);
      return receipt === undefined ? null : copy(receipt);
    },
  };
}
