import { validateDocument } from './document.js';

export const PREPARATION_SCHEMA = 'marea.gm.prepared-revision';
export const PUBLICATION_COMPILER_VERSION = 2;
// Schema 2 (GM07b0): revisionId hashes the content only, with the files it uses (its models and their manifest
// variants). The release that prepared it (game and protocol versions, runtime files with both asset indexes,
// every manifest file) is kept beside the content in `preparedWith`, outside the hash, for audit.
// Schema 1 revisions hash the release too and are never rewritten.
export const PREPARATION_VERSION = 2;

// Object keys are canonical; array order remains meaningful (rendering and collision order).
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  throw new TypeError('Invalid canonical content');
}

function validPreparedWith(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.gameVersion === 'string' &&
    Number.isSafeInteger(value.protocolVersion) && !!value.runtime && /^[a-f0-9]{64}$/.test(value.runtime.sha256) &&
    Array.isArray(value.runtime.files) && Array.isArray(value.baselineAssets);
}

/** Hashes the compiler derives from the stored source; a rebuild must reproduce every one of them. */
export function derivedContentHashes(content) {
  return { documentHash: content?.documentHash ?? null, base: content?.base ?? null, collision: content?.collision ?? null,
    resources: content?.resources ?? null, terrain: content?.terrain ?? null };
}

/**
 * Release compatibility of a stored revision against its rebuild by the running code.
 * Schema 1: the rebuilt id (which covers the runtime digest and versions) must be equal, as before GM07b0.
 * Schema 2: the rebuilt id and every derived hash must be equal; the preparing release does not matter.
 */
export function sameRevisionIdentity(stored, built) {
  if (!stored || !built || typeof stored.revisionId !== 'string') return false;
  if (stored.version !== PREPARATION_VERSION) return built.revisionId === stored.revisionId;
  return built.version === PREPARATION_VERSION && built.revisionId === stored.revisionId &&
    canonicalJson(derivedContentHashes(built.content)) === canonicalJson(derivedContentHashes(stored.content));
}

/** Check a download before offering it as a revision. This grants no activation permission. */
export async function verifyPreparedRevision(revision, { scope, draftRevision, document } = {}) {
  if (!revision || revision.schema !== PREPARATION_SCHEMA || ![1, PREPARATION_VERSION].includes(revision.version) ||
      (revision.version === PREPARATION_VERSION ? !validPreparedWith(revision.preparedWith) : revision.preparedWith !== undefined) ||
      !/^[a-f0-9]{64}$/.test(revision.revisionId) || !revision.content ||
      revision.content.compilerVersion !== PUBLICATION_COMPILER_VERSION ||
      revision.content.worldId !== scope?.worldId || revision.content.sourceRevision !== draftRevision ||
      revision.content.document?.base?.seed !== scope.seed || revision.content.document?.base?.revision !== scope.baseRevision ||
      canonicalJson(validateDocument(revision.content.document)) !== canonicalJson(document) ||
      !Array.isArray(revision.content.assets) || !revision.content.runtime ||
      !Array.isArray(revision.content.runtime.files) || !revision.content.validation?.valid) throw new TypeError('Invalid prepared revision');
  const bytes = new TextEncoder().encode(canonicalJson(revision.content));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== revision.revisionId) throw new TypeError('Prepared revision hash mismatch');
  return revision;
}
