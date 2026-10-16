const SCOPE_KEYS = ['ownerId', 'characterId', 'worldId'];
const TERM_LIMIT = 64;
const QUERY_LIMIT = 8000;

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sameScope(a, b) {
  return plain(a) && plain(b) && Object.keys(a).length === 3 && Object.keys(b).length === 3 &&
    SCOPE_KEYS.every((key) => typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]);
}
function validRecord(record) {
  return plain(record) && typeof record.id === 'string' && record.id.length > 0 && Number.isSafeInteger(record.revision) &&
    typeof record.text === 'string' && ['confirmed', 'inferred', 'uncertain'].includes(record.certainty) &&
    Number.isSafeInteger(record.createdAtMs) && record.createdAtMs >= 0 &&
    (record.validUntilMs === null || (Number.isSafeInteger(record.validUntilMs) && record.validUntilMs >= 0)) &&
    Array.isArray(record.tags) && Array.isArray(record.sources);
}
function normalize(text) {
  return text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('und');
}
function tokens(text) {
  return [...normalize(text).matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]);
}
function recordText(record) {
  return `${record.text} ${record.tags.join(' ')}`;
}
function duplicateKey(record) {
  return `${normalize(record.text)}\u0000${record.certainty}\u0000${[...record.tags].map(normalize).sort().join('\u0001')}`;
}
function clone(value) { return structuredClone(value); }

/** Rank a validated journal without truncating its append-ordered history. */
export function retrievePersistentMemory({ journal, scope, queryText = '', queryTags = [], nowMs, maxCandidates = 64 } = {}) {
  if (!plain(journal) || !Array.isArray(journal.records)) throw new TypeError('journal.records must be an array');
  if (!sameScope(scope, scope)) throw new TypeError('scope must include ownerId, characterId and worldId');
  if (typeof queryText !== 'string' || queryText.length > QUERY_LIMIT) throw new TypeError('queryText must be a string of at most 8000 characters');
  if (!Array.isArray(queryTags) || queryTags.length > 128 || queryTags.some((tag) => typeof tag !== 'string' || tag.length > 128)) throw new TypeError('queryTags must be short strings');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('nowMs must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 128) throw new RangeError('maxCandidates must be between 1 and 128');

  const terms = [...new Set(tokens(queryText))].slice(0, TERM_LIMIT);
  const wantedTags = new Set(queryTags.map((tag) => normalize(tag)));
  const summarySources = new Map();
  for (const entry of journal.entries ?? []) {
    if (entry?.kind === 'summary' && Array.isArray(entry.payload?.sources)) {
      summarySources.set(entry.id, new Set(entry.payload.sources.map((source) => source.id)));
    }
  }
  const newest = new Map();
  let expired = 0, future = 0, invalid = 0, scopeMismatch = 0;
  for (const record of journal.records) {
    if (!validRecord(record)) { invalid++; continue; }
    if (!sameScope(record.scope, scope)) { scopeMismatch++; continue; }
    const previous = newest.get(record.id);
    if (!previous || record.revision > previous.revision) newest.set(record.id, record);
  }

  const eligibleRecords = [];
  for (const record of newest.values()) {
    if (record.createdAtMs > nowMs) { future++; continue; }
    if (record.validUntilMs !== null && record.validUntilMs <= nowMs) { expired++; continue; }
    eligibleRecords.push(record);
  }
  const candidates = eligibleRecords.map((record) => {
    const words = tokens(recordText(record));
    const frequency = new Map();
    for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    const matchedTerms = terms.filter((term) => frequency.has(term));
    const exactTagMatches = record.tags.reduce((count, tag) => count + (wantedTags.has(normalize(tag)) ? 1 : 0), 0);
    // Bounded BM25-like term weighting; recency is deliberately a small tie-break influence.
    const lexical = matchedTerms.reduce((score, term) => score + (1 + Math.log1p(frequency.get(term))) * (1 + Math.log(1 + 1 / Math.max(1, terms.length))), 0);
    const recency = Math.max(0, 1 - (nowMs - record.createdAtMs) / (365 * 24 * 60 * 60 * 1000));
    const score = lexical + exactTagMatches * 3 + recency * 0.2;
    return { record, score, lexical, exactTagMatches, matchedTerms, matched: lexical > 0 || exactTagMatches > 0 };
  });

  // A summary can stand in for its source episodes only when it independently answers this query.
  const summaries = candidates.filter((item) => summarySources.has(item.record.id) && item.matched);
  const suppressed = new Set();
  for (const summary of summaries) for (const episodeId of summarySources.get(summary.record.id)) {
    const episode = candidates.find((item) => item.record.id === episodeId && item.matched);
    if (episode && summary.score >= episode.score) suppressed.add(episode.record.id);
  }

  const rank = (a, b) => {
    if (duplicateKey(a.record) === duplicateKey(b.record)) {
      const expiryA = a.record.validUntilMs ?? Number.POSITIVE_INFINITY;
      const expiryB = b.record.validUntilMs ?? Number.POSITIVE_INFINITY;
      if (expiryA !== expiryB) return expiryA - expiryB;
    }
    return b.score - a.score || b.record.createdAtMs - a.record.createdAtMs || a.record.id.localeCompare(b.record.id, 'en');
  };
  const matches = candidates.filter((item) => item.matched && !suppressed.has(item.record.id)).sort(rank);
  const zeroMatches = candidates.filter((item) => !item.matched).sort(rank);
  // Cap repeated identical prose so a burst of duplicates cannot crowd distinct relevant facts.
  const selected = [];
  const duplicateCounts = new Map();
  for (const item of [...matches, ...zeroMatches]) {
    if (selected.length >= maxCandidates) break;
    const fingerprint = duplicateKey(item.record);
    const duplicateLimit = item.matched ? 2 : 1;
    const count = duplicateCounts.get(fingerprint) ?? 0;
    if (count >= duplicateLimit) continue;
    selected.push(item); duplicateCounts.set(fingerprint, count + 1);
  }
  const selectedIds = selected.map((item) => item.record.id);
  const scores = Object.fromEntries(selected.map((item) => [item.record.id, {
    score: Number(item.score.toFixed(6)), lexical: Number(item.lexical.toFixed(6)), exactTagMatches: item.exactTagMatches,
    matchedTerms: item.matchedTerms,
  }]));
  return {
    records: selected.map((item) => clone(item.record)),
    report: {
      scanned: journal.records.length, total: journal.records.length, eligible: candidates.length, selected: selected.length,
      expired, future, invalid, scopeMismatch,
      legacy: candidates.filter((item) => !String(item.record.id).startsWith('episode:') && !String(item.record.id).startsWith('summary:')).length,
      selectedIds, rankingPolicy: terms.length || wantedTags.size ? 'lexical_bm25_like_plus_exact_tags_plus_modest_recency; matches_before_zero_match_recent_fallback' : 'recent_valid_first',
      queryTerms: terms, queryTags: [...wantedTags], scores,
      suppressedBySummary: [...suppressed].sort((a, b) => a.localeCompare(b, 'en')),
      historyTruncated: false,
    },
  };
}
