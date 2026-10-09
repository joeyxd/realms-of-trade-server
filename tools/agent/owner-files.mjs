import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMemoryJournal } from './memory-journal.mjs';

const FILES = Object.freeze({ personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl' });
const DEFAULT_LIMITS = Object.freeze({
  maxPersonalityBytes: 64 * 1024,
  maxObjectivesBytes: 256 * 1024,
  maxMemoryBytes: 1024 * 1024,
  maxCandidates: 2000,
});
const HARD_MAX = Object.freeze({
  maxPersonalityBytes: 1024 * 1024,
  maxObjectivesBytes: 2 * 1024 * 1024,
  maxMemoryBytes: 16 * 1024 * 1024,
  maxCandidates: 10000,
});
const SCOPE_KEYS = ['ownerId', 'characterId', 'worldId'];
const CERTAINTIES = new Set(['confirmed', 'inferred', 'uncertain']);
const GOAL_STATUSES = new Set(['active', 'paused', 'completed', 'blocked']);

export class OwnerFilesError extends Error {
  constructor(code) {
    super(`owner files rejected: ${code}`);
    this.name = 'OwnerFilesError';
    this.code = code;
  }
}

function fail(code) {
  throw new OwnerFilesError(code);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validId(value, max = 160) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validScope(scope) {
  return exactKeys(scope, SCOPE_KEYS)
    && SCOPE_KEYS.every((key) => validId(scope[key]));
}

function validateLimits(limits) {
  if (!plainObject(limits)) fail('invalid_limits');
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > HARD_MAX[key]) {
      fail('invalid_limits');
    }
    result[key] = value;
  }
  return result;
}

function hasLikelySecret(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/i.test(text);
}

function ensureSameFile(a, b) {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;
}

async function readBoundedRegularFile(root, filename, maxBytes) {
  const candidate = path.join(root, filename);
  let before;
  try {
    before = await fs.lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('missing_file');
    fail('file_access_denied');
  }
  if (!before.isFile() || before.isSymbolicLink()) fail('unsafe_file_type');
  if (before.size > maxBytes) fail('file_too_large');

  let real;
  try {
    real = await fs.realpath(candidate);
  } catch { fail('unsafe_path'); }
  if (path.dirname(real) !== root) fail('unsafe_path');

  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await fs.open(candidate, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    const current = await fs.lstat(candidate);
    if (!ensureSameFile(before, opened) || !ensureSameFile(opened, current) || current.isSymbolicLink()) fail('unsafe_path');
    const chunks = [];
    let total = 0;
    const buffer = Buffer.alloc(Math.min(16 * 1024, maxBytes + 1));
    while (total <= maxBytes) {
      const requested = Math.min(buffer.length, maxBytes + 1 - total);
      const { bytesRead } = await handle.read(buffer, 0, requested, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
    }
    if (total > maxBytes) fail('file_too_large');
    const after = await fs.lstat(candidate);
    const finalPath = await fs.realpath(candidate);
    if (!ensureSameFile(opened, after) || after.isSymbolicLink() || path.dirname(finalPath) !== root) fail('unsafe_path');
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof OwnerFilesError) throw error;
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP') fail('unsafe_path');
    fail('file_access_denied');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('invalid_utf8'); }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function memoryRecordValid(record, scope) {
  const keys = ['id', 'revision', 'scope', 'text', 'certainty', 'createdAtMs', 'validUntilMs', 'tags', 'sources'];
  if (!exactKeys(record, keys) || !validId(record.id, 160) || !Number.isSafeInteger(record.revision) || record.revision < 0) return false;
  if (!validScope(record.scope) || SCOPE_KEYS.some((key) => record.scope[key] !== scope[key])) return false;
  if (typeof record.text !== 'string' || record.text.length > 8000 || !CERTAINTIES.has(record.certainty)) return false;
  if (!Number.isSafeInteger(record.createdAtMs) || record.createdAtMs < 0) return false;
  if (record.validUntilMs !== null && (!Number.isSafeInteger(record.validUntilMs) || record.validUntilMs < 0)) return false;
  if (!Array.isArray(record.tags) || record.tags.length > 32 || record.tags.some((tag) => typeof tag !== 'string' || tag.length > 128)) return false;
  return Array.isArray(record.sources) && record.sources.length <= 64 && record.sources.every((source) =>
    exactKeys(source, ['id', 'tick']) && validId(source.id, 256)
    && (source.tick === null || (Number.isSafeInteger(source.tick) && source.tick >= 0)));
}

function parseObjectives(text, scope) {
  let value;
  try { value = JSON.parse(text); } catch { fail('invalid_objectives_json'); }
  if (!exactKeys(value, ['v', 'revision', 'scope', 'goals']) || value.v !== 1
      || !Number.isSafeInteger(value.revision) || value.revision < 1 || !validScope(value.scope)) fail('invalid_objectives');
  if (SCOPE_KEYS.some((key) => value.scope[key] !== scope[key])) fail('scope_mismatch');
  if (!Array.isArray(value.goals) || value.goals.length > 128) fail('invalid_objectives');
  for (const goal of value.goals) {
    if (!exactKeys(goal, ['id', 'status', 'text', 'constraints']) || !validId(goal.id, 128)
        || !GOAL_STATUSES.has(goal.status) || typeof goal.text !== 'string' || !goal.text.length || goal.text.length > 2000
        || !Array.isArray(goal.constraints) || goal.constraints.length > 32
        || goal.constraints.some((constraint) => typeof constraint !== 'string' || constraint.length > 500)) fail('invalid_objectives');
  }
  if (new Set(value.goals.map((goal) => goal.id)).size !== value.goals.length) fail('invalid_objectives');
  return value;
}

function parseMemory(text, scope, maxCandidates, maxBytes) {
  let journal;
  try { journal = parseMemoryJournal(text, scope, { maxBytes }); }
  catch (error) { fail(error.message); }
  const records = journal.records;
  const truncatedRecords = Math.max(0, records.length - maxCandidates);
  return {
    records: records.slice(-maxCandidates).map((record) => structuredClone(record)), journal,
    report: { totalRecords: records.length, returnedRecords: Math.min(records.length, maxCandidates), truncatedRecords, missingHistory: truncatedRecords > 0 },
  };
}

function fileEntry(root, filename, bytes, content, extra = {}) {
  return { path: path.join(root, filename), content, bytes: bytes.length, sha256: sha256(bytes), ...extra };
}

/** Read the three owner-visible files without creating, rewriting or exporting them. */
export async function loadOwnerFiles({ directory, scope, limits = {} } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('directory_must_be_absolute');
  if (!validScope(scope)) fail('invalid_scope');
  const config = validateLimits(limits);

  let root;
  try {
    const supplied = await fs.lstat(directory);
    if (!supplied.isDirectory() || supplied.isSymbolicLink()) fail('unsafe_directory');
    root = await fs.realpath(directory);
    if (path.dirname(root) === root) {
      // A filesystem root is not a character-owned directory.
      fail('unsafe_directory');
    }
  } catch (error) {
    if (error instanceof OwnerFilesError) throw error;
    fail(error?.code === 'ENOENT' ? 'directory_not_found' : 'unsafe_directory');
  }

  const personalityBytes = await readBoundedRegularFile(root, FILES.personality, config.maxPersonalityBytes);
  const objectiveBytes = await readBoundedRegularFile(root, FILES.objectives, config.maxObjectivesBytes);
  const memoryBytes = await readBoundedRegularFile(root, FILES.memory, config.maxMemoryBytes);
  const personalityText = decodeUtf8(personalityBytes);
  const objectivesText = decodeUtf8(objectiveBytes);
  const memoryText = decodeUtf8(memoryBytes);
  if (!personalityText.trim()) fail('invalid_personality');
  if ([personalityText, objectivesText, memoryText].some(hasLikelySecret)) fail('likely_secret_detected');
  const objectives = parseObjectives(objectivesText, scope);
  const parsedMemory = parseMemory(memoryText, scope, config.maxCandidates, config.maxMemoryBytes);

  return {
    ok: true,
    scope: { ...scope },
    files: {
      personality: fileEntry(root, FILES.personality, personalityBytes, personalityText),
      objectives: fileEntry(root, FILES.objectives, objectiveBytes, objectivesText, {
        revision: objectives.revision,
        scope: structuredClone(objectives.scope),
        goals: structuredClone(objectives.goals),
      }),
      memory: fileEntry(root, FILES.memory, memoryBytes, memoryText, {
        records: parsedMemory.records,
        report: parsedMemory.report,
        revision: parsedMemory.journal.revision,
        journal: parsedMemory.journal,
      }),
    },
  };
}

export { DEFAULT_LIMITS as DEFAULT_OWNER_FILE_LIMITS };
