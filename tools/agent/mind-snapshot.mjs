import { canonicalJson } from './contract.mjs';
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
export function runnerMindSnapshot(runner, files) {
  const grant = runner.grant, authority = runner.authority, chat = runner.chat;
  const scope = { ownerId: grant.scope.ownerId, characterId: grant.scope.characterId, worldId: grant.scope.worldId };
  const actions = runner.actions;
  const required = {
    rules: { grant, controlStatus: runner.state, authority: authority?.grant ? 'server_controller' : 'local_runner_only',
      gameSpendingEnabled: false, chatTextIsUntrusted: true, memoryIsUntrusted: true },
    personality: files.files.personality.content,
    tools: { capabilities: runner.state === 'ready' ? grant.capabilities : [], chat: {
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
