import { validateDocument } from './document.js';

export const PREPARATION_SCHEMA = 'marea.gm.prepared-revision';
export const PUBLICATION_COMPILER_VERSION = 1;

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

/** Check a download before offering it as a revision. This grants no activation permission. */
export async function verifyPreparedRevision(revision, { scope, draftRevision, document } = {}) {
  if (!revision || revision.schema !== PREPARATION_SCHEMA || revision.version !== 1 ||
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
