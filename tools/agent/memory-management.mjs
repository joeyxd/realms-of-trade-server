import { canonicalJson, integer } from './contract.mjs';
import { exact, plain, copy } from './mind-contract.mjs';
import { parseMemoryJournal, validMemoryScope } from './memory-journal.mjs';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (why) => ({ ok: false, why });

// Inspect descriptors before reading input so callers cannot smuggle side effects through getters.
function dataOnly(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : ![Object.prototype, null].includes(proto)) return false;
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, String(index))) return false;
  }
  for (const key of keys) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || (key !== 'length' && !descriptor.enumerable) || !dataOnly(descriptor.value, seen)) return false;
  }
  seen.delete(value);
  return true;
}

function validatedJournal(journal, scope) {
  if (!dataOnly(scope) || !validMemoryScope(scope) || !dataOnly(journal) ||
      !exact(journal, ['revision', 'entries', 'records', 'pending', 'report']) || !integer(journal.revision) || !Array.isArray(journal.entries)) return null;
  try {
    const text = journal.entries.map((entry) => JSON.stringify(entry)).join('\n') + (journal.entries.length ? '\n' : '');
    const parsed = parseMemoryJournal(text, copy(scope));
    if (!same(journal, parsed)) return null;
    return parsed;
  } catch { return null; }
}

function samePending(a, b) { return same(a, b); }

/** Propose a pure owner archive operation against a validated journal snapshot. */
export function proposeMemoryRemoval(options = {}) {
  if (!dataOnly(options) || !plain(options)) return fail('invalid_request');
  const { journal, scope, ids, retention, nowMs } = options;
  if (!integer(nowMs)) return fail('invalid_now');
  const parsed = validatedJournal(journal, scope);
  if (!parsed) return fail('invalid_journal');
  const hasIds = ids !== undefined, hasRetention = retention !== undefined;
  if (hasIds === hasRetention) return fail('invalid_selector');
  const expectedKeys = hasIds ? ['journal', 'scope', 'ids', 'nowMs'] : ['journal', 'scope', 'retention', 'nowMs'];
  if (!exact(options, expectedKeys)) return fail('invalid_request');

  let selected = new Set(), requestedIds = [], normalizedRetention = null;
  if (hasIds) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4096 || !dataOnly(ids) ||
        ids.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 256) || new Set(ids).size !== ids.length) return fail('invalid_ids');
    const existing = new Set(parsed.entries.map((entry) => entry.id));
    if (ids.some((id) => !existing.has(id))) return fail('memory_id_not_found');
    requestedIds = [...ids].sort();
    // IDs identify all revisions and duplicate legacy rows, avoiding resurrection of older revisions.
    selected = new Set(parsed.entries.filter((entry) => ids.includes(entry.id)).map((entry) => entry.id));
  } else {
    if (!exact(retention, ['expired', 'beforeMs']) || typeof retention.expired !== 'boolean' ||
        (retention.beforeMs !== null && !integer(retention.beforeMs)) ||
        (!retention.expired && retention.beforeMs === null) || (retention.beforeMs !== null && retention.beforeMs > nowMs) || !dataOnly(retention)) return fail('invalid_retention');
    normalizedRetention = copy(retention);
    for (const entry of parsed.entries) {
      const expired = entry.validUntilMs !== null && entry.validUntilMs <= nowMs;
      const before = retention.beforeMs !== null && entry.createdAtMs < retention.beforeMs;
      if ((retention.expired && expired) || before) { selected.add(entry.id); requestedIds.push(entry.id); }
    }
    requestedIds = [...new Set(requestedIds)].sort();
    // Retention treats a legacy id as one record family: remove every revision when any qualifies.
    for (const entry of parsed.entries) if (selected.has(entry.id)) requestedIds.push(entry.id);
    requestedIds = [...new Set(requestedIds)].sort();
    const qualifying = new Set(requestedIds);
    for (const entry of parsed.entries) if (qualifying.has(entry.id)) selected.add(entry.id);
  }

  // Derived summaries and legacy owner-authored claims cannot outlive deleted sources.
  const sourceIdentities = new Set();
  const addIdentities = () => {
    sourceIdentities.clear();
    for (const entry of parsed.entries) if (selected.has(entry.id)) {
      sourceIdentities.add(entry.id);
      if (entry.v !== 2) sourceIdentities.add(`${entry.id}@${entry.revision}`);
    }
  };
  addIdentities();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const entry of parsed.entries) {
      if (selected.has(entry.id)) continue;
      const derived = entry.kind === 'summary'
        ? entry.payload.sources.some((source) => sourceIdentities.has(source.id))
        : entry.v !== 2 && entry.sources.some((source) => sourceIdentities.has(source.id));
      if (derived) {
        selected.add(entry.id); expanded = true; addIdentities();
      }
    }
  }
  const removeIds = [...selected].sort();
  const removedEntries = parsed.entries.filter((entry) => selected.has(entry.id));
  const nextEntries = parsed.entries.filter((entry) => !selected.has(entry.id));
  let next;
  try {
    const text = nextEntries.map((entry) => JSON.stringify(entry)).join('\n') + (nextEntries.length ? '\n' : '');
    next = parseMemoryJournal(text, scope);
  } catch { return fail('memory_archive_invalid'); }
  if (!samePending(parsed.pending, next.pending)) return fail('memory_pending_evidence');

  return { ok: true, plan: {
    removeIds, requestedIds, derivedIds: removeIds.filter((id) => !requestedIds.includes(id)),
    beforeRevision: parsed.revision, afterRevision: next.revision,
    affectedRecords: removedEntries.length, retainedRecords: next.entries.length,
    retention: normalizedRetention, scope: copy(scope), nowMs,
    migrationPolicy: 'v1_read_compatibility_no_semantic_upgrade',
  } };
}

function normalize(text) {
  return text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');
}

/** Inspect owner-visible memory records. This is metadata and history, not acting retrieval. */
export function inspectMemoryArchive(options = {}) {
  if (!dataOnly(options) || !plain(options) || Object.keys(options).some((key) => !['journal', 'scope', 'nowMs', 'query', 'limit', 'offset'].includes(key)))
    throw new TypeError('invalid_memory_inspection');
  const { journal, scope, nowMs, query = '', limit = 100, offset = 0 } = options;
  if (!integer(nowMs) || typeof query !== 'string' || query.length > 8000 || !integer(limit) || limit < 1 || limit > 100 ||
      !integer(offset) || offset > 1000000) throw new TypeError('invalid_memory_inspection');
  const parsed = validatedJournal(journal, scope);
  if (!parsed) throw new TypeError('invalid_memory_journal');
  const needle = normalize(query.trim());
  const records = parsed.records.map((record, index) => {
    const entry = parsed.entries[index];
    const freshness = record.createdAtMs > nowMs ? 'future' : record.validUntilMs !== null && record.validUntilMs <= nowMs ? 'expired' : 'current';
    return { id: record.id, revision: record.revision, text: record.text, certainty: record.certainty,
      createdAtMs: record.createdAtMs, validUntilMs: record.validUntilMs, freshness,
      tags: copy(record.tags), sources: copy(record.sources), provenance: entry.v === 2 ? entry.kind : 'legacy_owner_authored',
      provenanceSources: entry.kind === 'summary' ? copy(entry.payload.sources) : entry.kind === 'episode' ? [{ id: entry.id, sha256: entry.sha256 }] : copy(entry.sources) };
  }).filter((record) => !needle || normalize(`${record.text} ${record.tags.join(' ')}`).includes(needle));
  return { scope: copy(scope), revision: parsed.revision, nowMs, total: records.length,
    offset, limit, records: copy(records.slice(offset, offset + limit)), pending: copy(parsed.pending) };
}
