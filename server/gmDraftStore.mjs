import { validateDocument } from '../src/editor/document.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORLD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const clone = value => structuredClone(value);

export class GmDraftStoreError extends Error {
  constructor(code) { super(`GM draft store: ${code}`); this.name = 'GmDraftStoreError'; this.code = code; }
}

function checkedScope(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner)) throw new GmDraftStoreError('scope');
  return { world: raw.world, owner: raw.owner.toLowerCase() };
}

function checkedOperation(raw) {
  if (typeof raw !== 'string' || !UUID.test(raw) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(raw)) {
    throw new GmDraftStoreError('operation');
  }
  return raw.toLowerCase();
}

function checkedRevision(raw, max = 2147483646) {
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > max) throw new GmDraftStoreError('revision');
  return raw;
}

function checkedDocument(raw) {
  let document;
  try { document = validateDocument(raw); } catch { throw new GmDraftStoreError('document'); }
  let encoded;
  try { encoded = JSON.stringify(document); } catch { throw new GmDraftStoreError('document'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) throw new GmDraftStoreError('document_size');
  return document;
}

function checkedHead(raw) {
  if (raw === null) return { revision: 0, document: null, savedAt: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 3 ||
      !Object.hasOwn(raw, 'revision') || !Object.hasOwn(raw, 'document') || !Object.hasOwn(raw, 'savedAt') ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.revision > 2147483647 ||
      typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt))) throw new GmDraftStoreError('response');
  return { revision: raw.revision, document: checkedDocument(raw.document), savedAt: raw.savedAt };
}

function checkedSaveResult(raw) {
  if (raw?.ok === false && raw.why === 'conflict' && Number.isSafeInteger(raw.revision) && raw.revision >= 0) {
    return { ok: false, why: 'conflict', revision: raw.revision };
  }
  if (raw?.ok === false && raw.why === 'operation') return { ok: false, why: 'operation' };
  if (raw?.ok !== true || typeof raw.replay !== 'boolean') throw new GmDraftStoreError('response');
  return { ok: true, head: checkedHead(raw.head), replay: raw.replay };
}

function normalizedSave(raw) {
  const scope = checkedScope(raw);
  const operationId = checkedOperation(raw?.operationId);
  const expectedRevision = checkedRevision(raw?.expectedRevision);
  const document = checkedDocument(raw?.document);
  const request = { ...scope, expectedRevision, document };
  return { scope, operationId, expectedRevision, document, request };
}

export function createMemoryGmDraftMethods() {
  const heads = new Map(), receipts = new Map();
  const key = ({ world, owner }) => `${world}\0${owner}`;
  const canonical = value => JSON.stringify(value);
  return Object.freeze({
    async checkGmDrafts() { return { version: 1 }; },
    async loadGmDraft(raw) {
      const scope = checkedScope(raw);
      return checkedHead(heads.get(key(scope)) ?? null);
    },
    async saveGmDraft(raw) {
      const input = normalizedSave(raw), receipt = receipts.get(input.operationId), text = canonical(input.request);
      if (receipt) {
        if (receipt.text !== text) return { ok: false, why: 'operation' };
        return receipt.result.ok ? { ...clone(receipt.result), replay: true } : clone(receipt.result);
      }
      const id = key(input.scope), current = heads.get(id) ?? null;
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        const result = { ok: false, why: 'conflict', revision: currentRevision };
        receipts.set(input.operationId, { text, result: clone(result) });
        return result;
      }
      const head = { revision: currentRevision + 1, document: clone(input.document), savedAt: new Date().toISOString() };
      const result = { ok: true, head: clone(head), replay: false };
      heads.set(id, head);
      receipts.set(input.operationId, { text, result: clone(result) });
      return result;
    },
  });
}

export function createSupabaseGmDraftMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new GmDraftStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) {
        if (result?.error?.code === 'MNG01') throw new GmDraftStoreError('operation');
        throw new Error('rpc');
      }
      return result.data;
    } catch (error) {
      if (error instanceof GmDraftStoreError) throw error;
      throw new GmDraftStoreError('unavailable');
    }
  }
  return Object.freeze({
    async checkGmDrafts() {
      const raw = await rpc('mn_gm_drafts_ready', {});
      if (!raw || Object.keys(raw).length !== 1 || raw.version !== 1) throw new GmDraftStoreError('response');
      return { version: 1 };
    },
    async loadGmDraft(raw) {
      const scope = checkedScope(raw);
      return checkedHead(await rpc('mn_load_gm_draft', { p_world: scope.world, p_owner: scope.owner }));
    },
    async saveGmDraft(raw) {
      const input = normalizedSave(raw);
      const result = await rpc('mn_save_gm_draft', { p_operation_id: input.operationId, p_request: input.request });
      return checkedSaveResult(result);
    },
  });
}
