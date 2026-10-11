import { createHash } from 'node:crypto';

const REQUIRED_BLOCKS = ['rules', 'personality', 'tools', 'observation', 'goals', 'pending'];

export const DEFAULT_CONTEXT_LIMITS = Object.freeze({
  maxInputBytes: 12000,
  maxContextUnits: 4096,
  outputReserveUnits: 512,
  marginUnits: 256,
  maxMemoryUnits: 1000,
  maxCandidates: 2000,
  maxSelected: 32,
});

const MAX_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 8000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 128;
const MAX_SOURCES = 64;
const MAX_SOURCE_ID_LENGTH = 256;

function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateLimits(limits) {
  if (!isPlainObject(limits)) throw new TypeError('limits must be a plain object');
  const result = { ...DEFAULT_CONTEXT_LIMITS };
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULT_CONTEXT_LIMITS)) throw new TypeError(`unknown context limit: ${key}`);
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${key} must be a non-negative safe integer`);
    result[key] = value;
  }
  return result;
}

function validateCounter(countUnits) {
  if (countUnits === undefined) return { count: (text) => utf8Bytes(text), mode: 'estimated_utf8_bytes' };
  if (typeof countUnits !== 'function') throw new TypeError('countUnits must be a function');
  return {
    count(text) {
      const value = countUnits(text);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('countUnits must return a non-negative safe integer');
      }
      return value;
    },
    mode: 'injected_units',
  };
}

function validScope(scope) {
  return isPlainObject(scope)
    && Object.keys(scope).length === 3
    && ['ownerId', 'characterId', 'worldId'].every((key) => Object.hasOwn(scope, key))
    && ['ownerId', 'characterId', 'worldId'].every((key) => typeof scope[key] === 'string' && scope[key].length > 0 && scope[key].length <= MAX_ID_LENGTH);
}

function validMemoryRecord(record) {
  if (!isPlainObject(record)) return false;
  const keys = Object.keys(record).sort();
  const expected = ['certainty', 'createdAtMs', 'id', 'revision', 'scope', 'sources', 'tags', 'text', 'validUntilMs'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (typeof record.id !== 'string' || !record.id.length || record.id.length > MAX_ID_LENGTH) return false;
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) return false;
  if (typeof record.text !== 'string' || record.text.length > MAX_TEXT_LENGTH) return false;
  if (!['confirmed', 'inferred', 'uncertain'].includes(record.certainty)) return false;
  if (!validScope(record.scope)) return false;
  if (!Number.isSafeInteger(record.createdAtMs) || record.createdAtMs < 0) return false;
  if (record.validUntilMs !== null && (!Number.isSafeInteger(record.validUntilMs) || record.validUntilMs < 0)) return false;
  if (!Array.isArray(record.tags) || record.tags.length > MAX_TAGS
      || record.tags.some((tag) => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH)) return false;
  if (!Array.isArray(record.sources) || record.sources.length > MAX_SOURCES
      || record.sources.some((source) => !isPlainObject(source)
        || Object.keys(source).length !== 2
        || !Object.hasOwn(source, 'id') || !Object.hasOwn(source, 'tick')
        || typeof source.id !== 'string' || !source.id.length || source.id.length > MAX_SOURCE_ID_LENGTH
        || (source.tick !== null && (!Number.isSafeInteger(source.tick) || source.tick < 0)))) return false;
  return true;
}

function compareRevision(a, b) {
  return a - b;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function sourceKey(source) {
  return `${source.id}\u0000${source.tick === null ? '' : source.tick}`;
}

function contentKey(record) {
  return stableStringify({
    scope: record.scope,
    text: record.text,
    certainty: record.certainty,
    validUntilMs: record.validUntilMs,
    tags: sortedUnique(record.tags),
  });
}

/**
 * Mechanically deduplicate equivalent records without generating or paraphrasing facts.
 * Every output source retains an explicit original record id and revision.
 */
export function compactMemory(records, { scope, maxSources = 16 } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!validScope(scope)) throw new TypeError('scope must include ownerId, characterId and worldId');
  if (!Number.isSafeInteger(maxSources) || maxSources < 1 || maxSources > MAX_SOURCES) throw new RangeError('maxSources must be a positive safe integer at most 64');

  const newestById = new Map();
  for (const record of records) {
    if (!validMemoryRecord(record) || stableStringify(record.scope) !== stableStringify(scope)) continue;
    const previous = newestById.get(record.id);
    if (!previous || compareRevision(record.revision, previous.revision) > 0) newestById.set(record.id, record);
  }

  const groups = new Map();
  for (const record of newestById.values()) {
    const key = contentKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const output = [];
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    group.sort((a, b) => a.id.localeCompare(b.id, 'en') || compareRevision(a.revision, b.revision));
    const representative = group[0];
    const createdAtMs = Math.max(...group.map((record) => record.createdAtMs));
    const validUntilMs = group.some((record) => record.validUntilMs === null)
      ? null
      : Math.max(...group.map((record) => record.validUntilMs));
    const refs = [];
    for (const record of group) {
      refs.push({ id: `${record.id}@${record.revision}`, tick: null });
      refs.push(...record.sources);
    }
    const uniqueRefs = [...new Map(refs.map((ref) => [sourceKey(ref), { id: ref.id, tick: ref.tick }])).values()]
      .sort((a, b) => sourceKey(a).localeCompare(sourceKey(b), 'en'));
    const chunks = [];
    for (let index = 0; index < uniqueRefs.length; index += maxSources) chunks.push(uniqueRefs.slice(index, index + maxSources));
    if (chunks.length === 0) chunks.push([]);
    // Bounded content-addressed ids remain valid even when original ids are long.
    const digest = createHash('sha256').update(stableStringify({ key, createdAtMs, validUntilMs, uniqueRefs })).digest('hex');
    chunks.forEach((sources, index) => {
      output.push({
        id: `compact:${digest}:${index + 1}`,
        revision: 1,
        scope: { ...representative.scope },
        text: representative.text,
        certainty: representative.certainty,
        createdAtMs,
        validUntilMs,
        tags: sortedUnique(representative.tags),
        sources: sources.map((source) => ({ ...source })),
      });
    });
  }
  return output;
}

function requiredIsValid(required) {
  return isPlainObject(required)
    && REQUIRED_BLOCKS.every((key) => Object.hasOwn(required, key))
    && Object.keys(required).every((key) => REQUIRED_BLOCKS.includes(key));
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('required blocks must contain JSON-safe values');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    if (!isPlainObject(value)) throw new TypeError('required blocks must contain plain JSON objects');
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

function makeDocument(required, memory) {
  return { v: 1, required, memory };
}

/** Build a bounded provider-neutral context document; required blocks are never pruned. */
export function buildContext({ required, memory = [], queryTags = [], candidateRanks = null, scope, nowMs, limits = {}, countUnits } = {}) {
  if (!requiredIsValid(required)) throw new TypeError(`required must contain exactly: ${REQUIRED_BLOCKS.join(', ')}`);
  assertJsonValue(required);
  if (!Array.isArray(memory)) throw new TypeError('memory must be an array');
  if (!validScope(scope)) throw new TypeError('scope must include ownerId, characterId and worldId');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('nowMs must be a non-negative safe integer');
  if (!Array.isArray(queryTags) || queryTags.some((tag) => typeof tag !== 'string')) throw new TypeError('queryTags must be an array of strings');
  const config = validateLimits(limits);
  const counter = validateCounter(countUnits);
  const requiredSnapshot = JSON.parse(JSON.stringify(required));
  const requiredOnly = makeDocument(requiredSnapshot, []);
  const requiredText = JSON.stringify(requiredOnly);
  const requiredUnits = counter.count(requiredText);
  const requiredBytes = utf8Bytes(requiredText);
  const usableUnits = config.maxContextUnits - config.outputReserveUnits - config.marginUnits;
  const baseReport = {
    countMode: counter.mode,
    requiredUnits,
    requiredBytes,
    usableContextUnits: Math.max(0, usableUnits),
    outputReserveUnits: config.outputReserveUnits,
    marginUnits: config.marginUnits,
    selectedIds: [],
    skipped: {},
    invalidCount: 0,
    scopeMismatchCount: 0,
    expiredCount: 0,
    futureCount: 0,
    duplicateIdCount: 0,
    duplicateContentCount: 0,
    scannedCandidates: 0,
    truncatedCandidates: 0,
    missingHistory: false,
    selectedMemoryUnits: 0,
    selectedContextUnits: requiredUnits,
    selectedInputBytes: requiredBytes,
  };
  const requiredOver = requiredUnits > usableUnits || requiredBytes > config.maxInputBytes;
  if (requiredOver) {
    return { ok: false, why: 'required_context_over_budget', report: { ...baseReport, requiredOverBudget: true } };
  }

  // Input is an append-ordered candidate log; old history cannot crowd out new entries.
  const scanned = config.maxCandidates === 0 ? [] : candidateRanks === null ? memory.slice(-config.maxCandidates) : memory.slice(0, config.maxCandidates);
  baseReport.scannedCandidates = scanned.length;
  baseReport.truncatedCandidates = Math.max(0, memory.length - scanned.length);
  baseReport.missingHistory = baseReport.truncatedCandidates > 0;
  if (baseReport.missingHistory) baseReport.skipped.candidate_limit = baseReport.truncatedCandidates;

  const newestById = new Map();
  for (const record of scanned) {
    if (!validMemoryRecord(record)) {
      baseReport.invalidCount += 1;
      baseReport.skipped.invalid = (baseReport.skipped.invalid || 0) + 1;
      continue;
    }
    if (stableStringify(record.scope) !== stableStringify(scope)) {
      baseReport.scopeMismatchCount += 1;
      baseReport.skipped.scope = (baseReport.skipped.scope || 0) + 1;
      continue;
    }
    if (record.createdAtMs > nowMs) {
      baseReport.futureCount += 1;
      baseReport.skipped.future = (baseReport.skipped.future || 0) + 1;
      continue;
    }
    const prior = newestById.get(record.id);
    if (!prior) newestById.set(record.id, record);
    else {
      baseReport.duplicateIdCount += 1;
      baseReport.skipped.duplicate_id = (baseReport.skipped.duplicate_id || 0) + 1;
      if (compareRevision(record.revision, prior.revision) > 0) newestById.set(record.id, record);
    }
  }

  const idDeduped = [...newestById.values()].filter((record) => {
    if (record.validUntilMs !== null && record.validUntilMs <= nowMs) {
      baseReport.expiredCount += 1;
      baseReport.skipped.expired = (baseReport.skipped.expired || 0) + 1;
      return false;
    }
    return true;
  });
  const contentKeys = new Set(idDeduped.map(contentKey));
  const compacted = compactMemory(idDeduped, { scope, maxSources: 16 });
  baseReport.duplicateContentCount = idDeduped.length - contentKeys.size;
  if (baseReport.duplicateContentCount) baseReport.skipped.duplicate_content = baseReport.duplicateContentCount;
  const tags = new Set(queryTags);
  if (candidateRanks !== null && (!isPlainObject(candidateRanks) || Object.values(candidateRanks).some((rank) => !Number.isSafeInteger(rank) || rank < 0 || rank > 128)))
    throw new TypeError('invalid memory candidate ranks');
  const persistentRank = (record) => candidateRanks === null ? 0 : Math.max(0, candidateRanks[record.id] ?? 0,
    ...record.sources.map((s) => candidateRanks[s.id] ?? candidateRanks[s.id.replace(/@\d+$/, '')] ?? 0));
  const ranked = compacted.map((record) => ({
    record,
    persistentRank: persistentRank(record),
    relevance: record.tags.reduce((count, tag) => count + (tags.has(tag) ? 1 : 0), 0),
  })).sort((a, b) => b.persistentRank - a.persistentRank || b.relevance - a.relevance
    || b.record.createdAtMs - a.record.createdAtMs
    || a.record.id.localeCompare(b.record.id, 'en'));

  let selected = [];
  for (const { record } of ranked) {
    if (selected.length >= config.maxSelected) {
      baseReport.skipped.selected_limit = (baseReport.skipped.selected_limit || 0) + 1;
      continue;
    }
    const proposed = [...selected, record];
    const text = JSON.stringify(makeDocument(requiredSnapshot, proposed));
    const bytes = utf8Bytes(text);
    const units = counter.count(text);
    const memoryText = JSON.stringify(proposed);
    const memoryUnits = counter.count(memoryText);
    if (bytes > config.maxInputBytes || units > usableUnits || memoryUnits > config.maxMemoryUnits) {
      baseReport.skipped.optional_over_budget = (baseReport.skipped.optional_over_budget || 0) + 1;
      continue;
    }
    selected = proposed;
  }

  const document = makeDocument(requiredSnapshot, selected);
  const text = JSON.stringify(document);
  const inputBytes = utf8Bytes(text);
  const contextUnits = counter.count(text);
  const memoryUnits = selected.length ? counter.count(JSON.stringify(selected)) : 0;
  return {
    ok: true,
    document,
    text,
    report: {
      ...baseReport,
      selectedIds: selected.map((record) => record.id),
      selectedMemoryUnits: memoryUnits,
      selectedContextUnits: contextUnits,
      selectedInputBytes: inputBytes,
      requiredOverBudget: false,
    },
  };
}
