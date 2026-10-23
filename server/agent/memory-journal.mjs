import { createHash } from 'node:crypto';
import { canonicalJson, integer } from './contract.mjs';
import { exact, plain, copy, bytes } from './mind-contract.mjs';

export const MEMORY_MAX_BYTES = 1024 * 1024;
const scopeKeys = ['ownerId', 'characterId', 'worldId'];
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/i;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const hash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const safeText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.normalize('NFC') && !/[\p{Cc}\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u.test(v) && !secret.test(v);
export const validMemoryScope = (scope) => exact(scope, scopeKeys) && scopeKeys.every((k) => safeText(scope[k], 160));
const sourceRef = (r) => exact(r, ['id', 'tick']) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 256 && (r.tick === null || integer(r.tick));

// Legacy owner-authored facts remain readable. They are not authenticated game receipts.
export function validLegacyMemory(record, scope) {
  return exact(record, ['id', 'revision', 'scope', 'text', 'certainty', 'createdAtMs', 'validUntilMs', 'tags', 'sources']) &&
    typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 160 && integer(record.revision) &&
    validMemoryScope(record.scope) && same(record.scope, scope) && typeof record.text === 'string' && record.text.length <= 8000 &&
    ['confirmed', 'inferred', 'uncertain'].includes(record.certainty) && integer(record.createdAtMs) &&
    (record.validUntilMs === null || integer(record.validUntilMs)) && Array.isArray(record.tags) && record.tags.length <= 32 &&
    record.tags.every((t) => typeof t === 'string' && t.length <= 128) && Array.isArray(record.sources) && record.sources.length <= 64 && record.sources.every(sourceRef);
}

function seal(kind, scope, createdAtMs, validUntilMs, payload) {
  const data = { v: 2, kind, scope: copy(scope), createdAtMs, validUntilMs, payload: copy(payload) };
  const sha256 = hash(data);
  return { ...data, id: `${kind}:${sha256}`, sha256 };
}
function envelopeValid(entry, scope) {
  if (!exact(entry, ['v', 'kind', 'scope', 'createdAtMs', 'validUntilMs', 'payload', 'id', 'sha256']) || entry.v !== 2 ||
      !['episode', 'summary'].includes(entry.kind) || !validMemoryScope(entry.scope) || !same(entry.scope, scope) || !integer(entry.createdAtMs) ||
      (entry.validUntilMs !== null && (!integer(entry.validUntilMs) || entry.validUntilMs <= entry.createdAtMs)) || !plain(entry.payload)) return false;
  const { id, sha256, ...data } = entry;
  return sha256 === hash(data) && id === `${entry.kind}:${sha256}` && bytes(canonicalJson(entry)) <= 32000 && !secret.test(canonicalJson(entry));
}
function episodeValid(entry) {
  const p = entry.payload;
  return exact(p, ['sessionId', 'controlRevision', 'observation', 'goals', 'feedback', 'chat', 'pending', 'omitted']) && safeText(p.sessionId, 160) &&
    integer(p.controlRevision) && exact(p.observation, ['revision', 'tick', 'self']) && integer(p.observation.revision) && integer(p.observation.tick) &&
    exact(p.observation.self, ['position', 'hp', 'maxHp', 'dead']) && exact(p.observation.self.position, ['x', 'y', 'z']) &&
    Object.values(p.observation.self.position).every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000) &&
    Number.isFinite(p.observation.self.hp) && Number.isFinite(p.observation.self.maxHp) && typeof p.observation.self.dead === 'boolean' &&
    exact(p.goals, ['revision', 'items']) && integer(p.goals.revision) && Array.isArray(p.goals.items) && p.goals.items.length <= 16 &&
    p.goals.items.every((g) => exact(g, ['id', 'status', 'text']) && safeText(g.id, 128) && ['active', 'paused', 'blocked', 'completed'].includes(g.status) && safeText(g.text, 300)) &&
    Array.isArray(p.feedback) && p.feedback.length <= 8 && p.feedback.every((f) => exact(f, ['actionId', 'type', 'state', 'inputAck', 'effects', 'result']) &&
      safeText(f.actionId, 256) && safeText(f.type, 128) && safeText(f.state, 128) && typeof f.inputAck === 'boolean' && Array.isArray(f.effects) && f.effects.length <= 4 &&
      f.effects.every(validEffect) && (f.result === null || validEffect(f.result))) &&
    Array.isArray(p.chat) && p.chat.length <= 4 && p.chat.every((m) => exact(m, ['id', 'tick', 'channel', 'speaker', 'text']) && safeText(m.id, 256) && integer(m.tick) &&
      ['world', 'local', 'whisper'].includes(m.channel) && safeText(m.speaker, 160) && safeText(m.text, 1000)) &&
    Array.isArray(p.pending) && p.pending.length <= 64 && p.pending.every((r) => exact(r, ['actionId', 'state']) && safeText(r.actionId, 256) && safeText(r.state, 128)) &&
    exact(p.omitted, ['goals', 'feedback', 'chat']) && Object.values(p.omitted).every(integer);
}
function validEffect(e) {
  return exact(e, ['evidenceId', 'tick', 'source', 'outcome', 'code', 'effect']) && safeText(e.evidenceId, 256) && integer(e.tick) &&
    ['server', 'fixture'].includes(e.source) && safeText(e.outcome, 128) && safeText(e.code, 128) && safeText(e.effect, 2000);
}
const minValidity = (entries) => entries.reduce((expiry, e) => e.validUntilMs === null ? expiry : expiry === null ? e.validUntilMs : Math.min(expiry, e.validUntilMs), null);
const uncertainEpisode = (e) => e.payload.pending.length > 0 || e.payload.feedback.some((f) => !['confirmed', 'rejected'].includes(f.state) ||
  [...f.effects, ...(f.result ? [f.result] : [])].some((evidence) => evidence.source !== 'server'));

// Snapshot projection is bounded and deliberately excludes credentials, peer names and entity archives.
export function createMemoryEpisode(snapshot) {
  const o = snapshot.observation, goals = snapshot.required.goals;
  if (o.source !== 'server') throw new TypeError('memory_requires_server_observation');
  const effect = (e) => e && Object.fromEntries(['evidenceId', 'tick', 'source', 'outcome', 'code', 'effect'].map((k) => [k, e[k]]));
  const feedback = (snapshot.goalFeedback ?? []).slice(-8).map((f) => ({ actionId: f.actionId, type: f.type, state: f.state,
    inputAck: f.inputAck === true, effects: f.effects.slice(-4).map(effect), result: effect(f.result) ?? null }));
  const messages = snapshot.chat?.messages ?? [];
  if (messages.slice(-4).some((m) => !safeText(m.sender?.id, 160))) throw new TypeError('invalid_memory_speaker');
  const chat = messages.slice(-4).map((m) => ({ id: m.id, tick: m.tick, channel: m.channel,
    speaker: `peer:${hash({ scope: snapshot.scope, sender: m.sender?.id }).slice(0, 24)}`, text: m.text }));
  const pending = snapshot.required.pending.filter((r) => r.kind !== 'remembered_action').map((r) => ({ actionId: r.actionId ?? r.requestId, state: r.state ?? 'uncertain' }));
  if (pending.length > 64) throw new TypeError('memory_pending_capacity');
  const entry = seal('episode', snapshot.scope, o.receivedAtMs, null, {
    sessionId: snapshot.grant.scope.sessionId, controlRevision: snapshot.grant.controlRevision,
    observation: { revision: o.revision, tick: o.tick, self: { position: copy(o.confirmed.self.position), hp: o.confirmed.self.hp, maxHp: o.confirmed.self.maxHp, dead: o.confirmed.self.dead } },
    goals: { revision: goals.revision, items: goals.goals.slice(0, 16).map((g) => ({ id: g.id, status: g.status, text: g.text.slice(0, 300).normalize('NFC') })) },
    feedback, chat, pending, omitted: { goals: Math.max(0, goals.goals.length - 16), feedback: Math.max(0, (snapshot.goalFeedback?.length ?? 0) - 8), chat: Math.max(0, messages.length - 4) },
  });
  if (!envelopeValid(entry, snapshot.scope) || !episodeValid(entry)) throw new TypeError('invalid_memory_episode');
  return entry;
}

function summaryValid(entry, byId) {
  const p = entry.payload;
  if (!exact(p, ['text', 'tags', 'sources', 'certainty']) || !safeText(p.text, 2000) || !Array.isArray(p.tags) || p.tags.length > 16 ||
      !p.tags.every((t) => safeText(t, 128)) || new Set(p.tags).size !== p.tags.length || !Array.isArray(p.sources) || p.sources.length < 1 || p.sources.length > 8 ||
      !p.sources.every((s) => exact(s, ['id', 'sha256']) && byId.get(s.id)?.kind === 'episode' && byId.get(s.id).sha256 === s.sha256) || new Set(p.sources.map((s) => s.id)).size !== p.sources.length) return false;
  const sources = p.sources.map((s) => byId.get(s.id));
  const allowedTags = new Set(sources.flatMap((s) => projectEntry(s).tags));
  return p.tags.every((tag) => allowedTags.has(tag)) && sources.every((s) => s.createdAtMs <= entry.createdAtMs) && entry.validUntilMs === minValidity(sources) &&
    p.certainty === (sources.some(uncertainEpisode) ? 'uncertain' : 'inferred');
}
function projectEntry(entry) {
  if (entry.v !== 2) return { ...copy(entry), certainty: 'uncertain', text: `Owner-authored memory; sources are not authenticated receipts. ${entry.text}`.slice(0, 8000) };
  const p = entry.payload;
  const text = entry.kind === 'summary' ? `Model interpretation of historical sources (${p.certainty}); revalidate current state. ${p.text}` :
    `Historical server-delivered observation, not current state. ${canonicalJson(p)}. ACK is receipt only; partial effects and chat do not prove success or truth.`;
  return { id: entry.id, revision: 1, scope: copy(entry.scope), text: text.slice(0, 8000),
    certainty: entry.kind === 'summary' ? p.certainty : uncertainEpisode(entry) ? 'uncertain' : 'confirmed', createdAtMs: entry.createdAtMs,
    validUntilMs: entry.validUntilMs, tags: entry.kind === 'summary' ? copy(p.tags) : [...new Set([...p.goals.items.filter((g) => g.status === 'active').map((g) => g.id),
      ...(p.observation.self.hp < p.observation.self.maxHp / 2 ? ['health', 'retreat'] : []), ...p.feedback.map((f) => f.type)])].slice(0, 32),
    sources: entry.kind === 'summary' ? p.sources.map((s) => ({ id: s.id, tick: null })) : [{ id: entry.id, tick: p.observation.tick }], };
}

/** One atomic JSONL file holds originals and derived summaries; no separate index can go stale. */
export function parseMemoryJournal(text, scope, { maxBytes = MEMORY_MAX_BYTES } = {}) {
  if (!integer(maxBytes) || maxBytes < 1 || maxBytes > 16 * MEMORY_MAX_BYTES || !validMemoryScope(scope) || typeof text !== 'string' || bytes(text) > maxBytes) throw new TypeError('invalid_memory_journal');
  if (secret.test(text)) throw new TypeError('likely_secret_detected');
  const lines = text.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
  const entries = [], byId = new Map(), legacyVersions = new Map();
  for (const line of lines) {
    if (!line) throw new TypeError('invalid_memory_jsonl');
    let e; try { e = JSON.parse(line); } catch { throw new TypeError('invalid_memory_jsonl'); }
    if (plain(e) && plain(e.scope) && !same(e.scope, scope)) throw new TypeError('scope_mismatch');
    if (e.v === 2) {
      if (!envelopeValid(e, scope) || (e.kind === 'episode' ? !episodeValid(e) : !summaryValid(e, byId)) || byId.has(e.id)) throw new TypeError('invalid_memory_provenance');
      byId.set(e.id, e);
    } else {
      if (!validLegacyMemory(e, scope)) throw new TypeError('invalid_memory_record');
      const key = `${e.id}@${e.revision}`, prior = legacyVersions.get(key);
      if (prior && !same(prior, e)) throw new TypeError('memory_revision_collision');
      legacyVersions.set(key, e);
    }
    entries.push(e);
  }
  // Keep uncertainty across process/session boundaries. Later exact terminal feedback may resolve it.
  const pending = new Map();
  for (const e of entries.filter((r) => r.kind === 'episode')) {
    const p = e.payload, key = (id) => `${p.sessionId}:${id}`;
    for (const r of p.pending) pending.set(key(r.actionId), { actionId: key(r.actionId), state: 'uncertain', kind: 'remembered_action', sourceId: e.id, retryAllowed: false });
    for (const f of p.feedback) {
      if (['confirmed', 'rejected'].includes(f.state)) pending.delete(key(f.actionId));
      else pending.set(key(f.actionId), { actionId: key(f.actionId), state: 'uncertain', kind: 'remembered_action', sourceId: e.id, retryAllowed: false });
    }
  }
  return { revision: entries.length, entries: copy(entries), records: entries.map(projectEntry), pending: [...pending.values()],
    report: { totalRecords: entries.length, episodes: entries.filter((e) => e.kind === 'episode').length, summaries: entries.filter((e) => e.kind === 'summary').length,
      provenance: 'local_content_hashes_not_server_signatures', legacySources: 'owner_authored_not_authenticated', originalHistoryRetained: true } };
}

export function buildMemoryTurn(snapshot, sourceIds, nowMs) {
  const journal = snapshot.memoryJournal;
  if (!integer(nowMs) || !journal || !integer(journal.revision) || !Array.isArray(journal.entries) || !Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 8 ||
      new Set(sourceIds).size !== sourceIds.length || !sourceIds.every((id) => typeof id === 'string')) return { ok: false, why: 'invalid_memory_sources' };
  const sources = sourceIds.map((id) => journal.entries.find((e) => e.id === id && e.kind === 'episode'));
  if (sources.some((e) => !e || e.createdAtMs > nowMs || (e.validUntilMs !== null && e.validUntilMs <= nowMs))) return { ok: false, why: 'memory_source_unavailable' };
  const selected = [...sourceIds].sort();
  if (journal.entries.some((e) => e.kind === 'summary' && same(e.payload.sources.map((s) => s.id).sort(), selected))) return { ok: false, why: 'memory_summary_exists' };
  const turn = { v: 1, expectedRevision: journal.revision, sources: copy(sources),
    policy: { interpretationOnly: true, preserveUncertainty: true, noAuthority: true, allSourcesRequired: true, originalHistoryRetained: true,
      allowedTags: [...new Set(sources.flatMap((s) => projectEntry(s).tags))].sort() } };
  return bytes(canonicalJson(turn)) <= 16000 ? { ok: true, turn } : { ok: false, why: 'memory_sources_over_budget' };
}
export function createMemorySummary(decision, turn, scope, nowMs) {
  if (!exact(decision, ['type', 'args']) || decision.type !== 'summarize_memory' || !exact(decision.args, ['text', 'tags', 'basis']) || !safeText(decision.args.text, 2000) ||
      !Array.isArray(decision.args.tags) || decision.args.tags.length > 16 || !decision.args.tags.every((t) => safeText(t, 128)) || new Set(decision.args.tags).size !== decision.args.tags.length ||
      !Array.isArray(decision.args.basis) || !same([...decision.args.basis].sort(), turn.sources.map((e) => e.id).sort()) || !integer(nowMs) ||
      !validMemoryScope(scope) || !decision.args.tags.every((tag) => turn.sources.some((s) => projectEntry(s).tags.includes(tag))) ||
      turn.sources.some((e) => !same(e.scope, scope) || e.createdAtMs > nowMs || (e.validUntilMs !== null && e.validUntilMs <= nowMs))) return { ok: false, why: 'invalid_memory_summary' };
  const entry = seal('summary', scope, nowMs, minValidity(turn.sources), { text: decision.args.text, tags: copy(decision.args.tags),
    sources: turn.sources.map((e) => ({ id: e.id, sha256: e.sha256 })), certainty: turn.sources.some(uncertainEpisode) ? 'uncertain' : 'inferred' });
  return { ok: true, entry };
}
