import { buildMemoryTurn, MEMORY_MAX_BYTES } from './memory-journal.mjs';
import { canonicalJson } from './contract.mjs';

export const LOCAL_CONTEXT_LIMITS = Object.freeze({ maxContextTokens: 65536, maxInputBytes: 65536,
  maxOutputTokens: 512, marginTokens: 256 });
export const SUMMARY_IDLE_MS = 3000;

const live = (entry, nowMs) => entry.createdAtMs <= nowMs &&
  (entry.validUntilMs === null || entry.validUntilMs > nowMs);

// This is a historical continuation cue, never a replacement for current observation.
// Derive it from the validated journal so there is no second writable memory index.
export function continuationCue(journal, nowMs) {
  const entries = (journal?.entries ?? []).filter(entry => live(entry, nowMs));
  const episode = entries.findLast(entry => entry.kind === 'episode');
  const summary = entries.findLast(entry => entry.kind === 'summary');
  return { source: 'local_historical_memory', untrusted: true, revalidateCurrentState: true,
    resumeOrders: false,
    latestEpisode: episode ? { id: episode.id, sessionId: episode.payload.sessionId,
      chat: episode.payload.chat.slice(-2), goals: episode.payload.goals } : null,
    latestSummary: summary ? { id: summary.id, text: summary.payload.text,
      certainty: summary.payload.certainty, sources: summary.payload.sources } : null };
}

export function measuredContinuityContext(report) {
  if (!report) return null;
  const { inputTokens, totalReservedContextTokens, transmittedBytes, countMode } = report;
  const requiredOverBudget = report.requiredOverBudget === true;
  const measured = [inputTokens, totalReservedContextTokens, transmittedBytes].every(Number.isSafeInteger);
  return { inputTokens: inputTokens ?? null, totalReservedContextTokens: totalReservedContextTokens ?? null,
    transmittedBytes: transmittedBytes ?? null, countMode: countMode ?? 'unavailable',
    maxContextTokens: LOCAL_CONTEXT_LIMITS.maxContextTokens, maxInputBytes: LOCAL_CONTEXT_LIMITS.maxInputBytes,
    outputReserveTokens: LOCAL_CONTEXT_LIMITS.maxOutputTokens, marginTokens: LOCAL_CONTEXT_LIMITS.marginTokens,
    pressure: !requiredOverBudget && measured && (totalReservedContextTokens >= LOCAL_CONTEXT_LIMITS.maxContextTokens * .8 ||
      transmittedBytes >= LOCAL_CONTEXT_LIMITS.maxInputBytes * .8 || (report.skipped?.optional_over_budget ?? 0) > 0),
    requiredOverBudget, measurement: measured ? 'adapter_payload_estimate' : 'unavailable' };
}

// At most one compaction reservation in an allowance admits automatic summarization.
// Manual attempts count too, including invalid/unknown responses and process restarts.
export function automaticSummaryRemaining(budget) {
  return budget.entries.some(entry => entry.kind === 'compaction' && entry.state !== 'cancelled') ? 0 : 1;
}

export function summaryCandidates(journal, nowMs) {
  const covered = new Set((journal?.entries ?? []).filter(entry => entry.kind === 'summary' && live(entry, nowMs))
    .flatMap(entry => entry.payload.sources.map(source => source.id)));
  return (journal?.entries ?? []).filter(entry => entry.kind === 'episode' && live(entry, nowMs))
    .slice(-32).map(entry => ({ id: entry.id, createdAtMs: entry.createdAtMs,
      preview: entry.payload.chat.at(-1)?.text.slice(0, 100) ?? entry.payload.goals.items[0]?.text ?? 'Observación guardada',
      summarized: covered.has(entry.id) }));
}

export function automaticSummarySources(snapshot, nowMs) {
  const candidates = summaryCandidates(snapshot.memoryJournal, nowMs).filter(entry => !entry.summarized).slice(-8);
  // Required source bytes have their own strict cap. Never retry a failed paid summary.
  for (let count = candidates.length; count >= 2; count--) {
    const sourceIds = candidates.slice(-count).map(entry => entry.id);
    if (buildMemoryTurn(snapshot, sourceIds, nowMs).ok) return sourceIds;
  }
  return [];
}

export function sameCapture(journal, snapshot) {
  const last = journal?.entries.findLast(entry => entry.kind === 'episode');
  if (!last || last.payload.sessionId !== snapshot.grant.scope.sessionId) return null;
  const chat = snapshot.chat.messages.slice(-4).map(message => message.id);
  const pending = snapshot.required.pending.filter(row => row.kind !== 'remembered_action')
    .map(row => ({ actionId: row.actionId ?? row.requestId, state: row.state ?? 'uncertain' }));
  return JSON.stringify(last.payload.chat.map(message => message.id)) === JSON.stringify(chat) &&
    canonicalJson(last.payload.goals) === canonicalJson({ revision: snapshot.required.goals.revision,
      items: snapshot.required.goals.goals.slice(0, 16).map(goal => ({ id: goal.id, status: goal.status,
        text: goal.text.slice(0, 300).normalize('NFC') })) }) &&
    canonicalJson(last.payload.observation.self) === canonicalJson({ position: snapshot.observation.confirmed.self.position,
      hp: snapshot.observation.confirmed.self.hp, maxHp: snapshot.observation.confirmed.self.maxHp, dead: snapshot.observation.confirmed.self.dead }) &&
    canonicalJson(last.payload.pending) === canonicalJson(pending) &&
    snapshot.goalFeedback.length === 0 ? last : null;
}

export function journalUsage(files) {
  const journal = files.files.memory.journal;
  return { revision: journal.revision, episodes: journal.report.episodes, summaries: journal.report.summaries,
    bytes: Buffer.byteLength(files.files.memory.content, 'utf8'), maxBytes: MEMORY_MAX_BYTES };
}
