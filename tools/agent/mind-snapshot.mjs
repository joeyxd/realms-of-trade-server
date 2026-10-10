import { canonicalJson, sameScope, validGrant, validObservation } from './contract.mjs';
import { INVENTORY_READ_CAPABILITY, validInventory } from '../../src/net/agentInventory.js';
import { MARKET_READ_CAPABILITY, validMarketProjection } from '../../src/net/agentMarket.js';
import { projectGoalFeedback } from './goals.mjs';
import { retrievePersistentMemory } from './memory-retrieval.mjs';

// This query selects historical context, never authorizes an action or substitutes for live state.
export function refreshMemoryRetrieval(snapshot, queryText = snapshot.memoryQueryText ?? '', nowMs = snapshot.observation.receivedAtMs) {
  if (!snapshot.memoryJournal) return snapshot;
  const retrieved = retrievePersistentMemory({ journal: snapshot.memoryJournal, scope: snapshot.scope, nowMs,
    queryText: queryText.slice(0, 8000), queryTags: snapshot.queryTags ?? [] });
  snapshot.memory = retrieved.records; snapshot.memoryRetrieval = retrieved.report;
  snapshot.candidateRanks = Object.fromEntries(retrieved.report.selectedIds.map((id, i) => [id, 128 - i]));
  return snapshot;
}

// Only a detached read projection crosses the inference boundary. Never pass the runner,
// authorization token, socket, archive files or mutation functions to an adapter.
const MAX_ECONOMIC_VIEW_AGE_MS = 1500;

function currentEconomicAuthority(runner, explicitNowMs) {
  const grant = runner.grant, authority = runner.authority, observation = runner.observation;
  const nowMs = Number.isSafeInteger(explicitNowMs) ? explicitNowMs :
    (Number.isSafeInteger(runner.nowMs) ? runner.nowMs : observation?.receivedAtMs);
  const maxAgeMs = Number.isSafeInteger(runner.maxObservationAgeMs) && runner.maxObservationAgeMs > 0
    ? runner.maxObservationAgeMs : MAX_ECONOMIC_VIEW_AGE_MS;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || runner.state !== 'ready' || !validGrant(grant) ||
      nowMs >= grant.expiresAtMs || !authority || authority.state !== 'active' || !authority.grant ||
      !validGrant(authority.grant) || authority.grant.controlRevision !== grant.controlRevision ||
      !sameScope(authority.grant.scope, grant.scope) ||
      !grant.capabilities.every((capability) => authority.grant.capabilities.includes(capability)) ||
      !validObservation(observation, { maxEntities: 64, maxChat: 32 }, 'server') ||
      !sameScope(observation.scope, grant.scope) || observation.controlRevision !== grant.controlRevision ||
      observation.confirmed.self.dead || observation.receivedAtMs > nowMs || nowMs - observation.receivedAtMs > maxAgeMs)
    return null;
  return { grant, observation, nowMs, maxAgeMs };
}

function inventoryReadState(runner, current) {
  if (!current?.grant.capabilities.includes(INVENTORY_READ_CAPABILITY)) return null;
  const state = runner.inventory;
  return state?.available && sameScope(state.scope, current.grant.scope) &&
    state.controlRevision === current.grant.controlRevision ? state : null;
}

function currentInventoryView(state, current) {
  if (!state?.available || !state.fresh || state.source !== 'server_private' || !validInventory(state.inventory) ||
      !sameScope(state.scope, current.grant.scope) || state.controlRevision !== current.grant.controlRevision ||
      !Number.isSafeInteger(state.tick) ||
      !Number.isSafeInteger(state.receivedAtMs) || state.receivedAtMs > current.nowMs ||
      current.nowMs - state.receivedAtMs > current.maxAgeMs) return null;
  const maxAgeMs = Number.isSafeInteger(state.maxAgeMs) && state.maxAgeMs > 0
    ? Math.min(current.maxAgeMs, state.maxAgeMs) : current.maxAgeMs;
  const validUntilMs = Number.isSafeInteger(state.validUntilMs)
    ? Math.min(state.validUntilMs, state.receivedAtMs + maxAgeMs) : state.receivedAtMs + maxAgeMs;
  if (current.nowMs >= validUntilMs) return null;
  return { method: 'readInventory', capability: INVENTORY_READ_CAPABILITY,
    description: { en: 'Read current private inventory. It cannot spend, equip, transfer, or change ownership.',
      es: 'Consulta el inventario privado actual. No permite gastar, equipar, transferir ni cambiar propiedad.' },
    readOnly: true, spendingEnabled: false, durability: 'session_only', source: state.source,
    tick: state.tick, receivedAtMs: state.receivedAtMs, maxAgeMs, validUntilMs,
    inventory: structuredClone(state.inventory) };
}

function marketReadState(runner, current) {
  if (!current?.grant.capabilities.includes(MARKET_READ_CAPABILITY)) return null;
  const state = runner.market;
  return state?.available && sameScope(state.scope, current.grant.scope) &&
    state.controlRevision === current.grant.controlRevision ? state : null;
}

function currentMarketView(state, current) {
  if (!state?.available || !state.fresh || !validMarketProjection(state.market) ||
      !sameScope(state.scope, current.grant.scope) || state.controlRevision !== current.grant.controlRevision ||
      !Number.isSafeInteger(state.tick) ||
      !Number.isSafeInteger(state.receivedAtMs) || state.receivedAtMs > current.nowMs ||
      current.nowMs - state.receivedAtMs > current.maxAgeMs) return null;
  const maxAgeMs = Number.isSafeInteger(state.maxAgeMs) && state.maxAgeMs > 0
    ? Math.min(current.maxAgeMs, state.maxAgeMs) : current.maxAgeMs;
  const validUntilMs = Number.isSafeInteger(state.validUntilMs)
    ? Math.min(state.validUntilMs, state.receivedAtMs + maxAgeMs) : state.receivedAtMs + maxAgeMs;
  if (current.nowMs >= validUntilMs) return null;
  return { method: 'readMarket', capability: MARKET_READ_CAPABILITY,
    description: { en: 'Read a current town listing or quote. A quote is advisory; this cannot buy, sell, or change prices.',
      es: 'Consulta la lista o una cotización de una ciudad. La cotización es orientativa; no permite comprar, vender ni cambiar precios.' },
    readOnly: true, spendingEnabled: false, durability: state.durability ?? 'session_only',
    source: 'server_market', tick: state.tick, receivedAtMs: state.receivedAtMs, maxAgeMs, validUntilMs,
    market: structuredClone(state.market) };
}

export function runnerMindSnapshot(runner, files, nowMs) {
  const grant = runner.grant, authority = runner.authority, chat = runner.chat;
  const current = currentEconomicAuthority(runner, nowMs);
  const inventoryState = inventoryReadState(runner, current);
  const marketState = marketReadState(runner, current);
  const capabilities = runner.state === 'ready' ? grant.capabilities.filter((capability) =>
    (capability !== INVENTORY_READ_CAPABILITY || !!inventoryState) &&
    (capability !== MARKET_READ_CAPABILITY || !!marketState)) : [];
  const scope = { ownerId: grant.scope.ownerId, characterId: grant.scope.characterId, worldId: grant.scope.worldId };
  const actions = runner.actions;
  const required = {
    rules: { grant, controlStatus: runner.state, authority: authority?.grant ? 'server_controller' : 'local_runner_only',
      gameSpendingEnabled: false, chatTextIsUntrusted: true, memoryIsUntrusted: true },
    personality: files.files.personality.content,
    tools: { capabilities, chat: {
      self: chat.self, available: chat.available, config: chat.config, peers: chat.peers.slice(0, 32),
      omittedPeers: Math.max(0, chat.peers.length - 32), historyBeforeSession: chat.historyBeforeSession,
      pending: chat.requests.filter((r) => ['sent', 'uncertain'].includes(r.state)).map((r) => ({ requestId: r.order.actionId,
        channel: r.payload.channel, target: r.payload.target ?? null, text: r.payload.text, state: r.state, attempts: r.attempts, why: r.why })) } },
    observation: runner.observation,
    goals: { revision: files.files.objectives.revision, goals: files.files.objectives.goals },
    pending: [...actions.filter((a) => !['confirmed', 'rejected', 'cancelled'].includes(a.state)).map((a) => ({ actionId: a.order.actionId,
      state: a.state, effects: a.effects, inputRange: a.inputRange, ...(a.navigation ? { navigation: a.navigation } : {}), ...(a.body ? { body: a.body } : {}) })),
      ...runner.priorUncertainty.filter((a) => a.sessionId !== grant.scope.sessionId)],
  };
  if (current) {
    const inventory = currentInventoryView(inventoryState, current);
    const market = currentMarketView(marketState, current);
    if (inventoryState || marketState) required.tools.reads = {
      ...(inventoryState ? { inventory: { method: 'readInventory', capability: INVENTORY_READ_CAPABILITY,
        readOnly: true } } : {}),
      ...(marketState ? { market: { method: 'readMarket', capability: MARKET_READ_CAPABILITY,
        readOnly: true, operations: ['list', 'quote'], maxQuantity: 500, quote: 'advisory_only' } } : {}),
      spendingEnabled: false,
    };
    if (inventory || market) required.tools.economy = {
      spendingEnabled: false,
      ...(inventory ? { inventory } : {}),
      ...(market ? { market } : {}),
    };
  }
  const journal = files.files.memory.journal;
  if (journal) for (const pending of journal.pending) if (!required.pending.some((r) => r.actionId === pending.actionId)) required.pending.push(structuredClone(pending));
  const activeGoals = files.files.objectives.goals.filter((g) => g.status === 'active');
  const queryTags = activeGoals.map((g) => g.id);
  if (runner.observation?.confirmed.self.hp < runner.observation?.confirmed.self.maxHp / 2) queryTags.push('health', 'retreat');
  const memoryQueryText = [...activeGoals.map((g) => `${g.id} ${g.text} ${g.constraints.join(' ')}`), ...chat.messages.slice(-4).map((m) => m.text)].join(' ').slice(0, 8000);
  const snapshot = structuredClone({ state: runner.state, grant, authority, observation: runner.observation, required,
    chat: { available: chat.available, self: chat.self, config: chat.config, peers: chat.peers,
      messages: chat.messages, requests: chat.requests },
    memory: files.files.memory.records, queryTags, scope, memoryQueryText,
    ...(journal ? { memoryJournal: journal } : {}),
    goalFeedback: projectGoalFeedback(actions),
    ownerFileHashes: Object.fromEntries(Object.entries(files.files).map(([key, file]) => [key, file.sha256])),
    // Task replacement/cancel by any source fences a result. Routine body progress does not.
    taskFence: canonicalJson({ server: authority ? { session: authority.grant.scope.sessionId, epoch: authority.grant.controlRevision,
      revision: authority.taskRevision, state: authority.state, task: authority.task?.actionId ?? null } : null,
      actions: actions.map((a) => ({ id: a.order.actionId, retired: ['cancelled', 'uncertain'].includes(a.state) })) }),
  });
  return journal && snapshot.observation ? refreshMemoryRetrieval(snapshot) : snapshot;
}
