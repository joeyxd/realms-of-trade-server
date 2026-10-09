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

export function createMemoryContributionStore({ characters = [], projects = [] } = {}) {
  if (!Array.isArray(characters) || !Array.isArray(projects)) failInput();

  const characterRows = new Map();
  const projectRows = new Map();
  const receipts = new Map();

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

  return {
    kind: 'community-memory',
    durable: false,

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
