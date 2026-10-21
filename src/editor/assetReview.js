export const REVIEW_SCHEMA = 'marea.asset-review.v1';
export const DECISIONS = Object.freeze([
  { id: 'unreviewed', label: 'Sin revisar' },
  { id: 'use', label: 'Usar' },
  { id: 'adapt', label: 'Adaptar' },
  { id: 'reserve', label: 'Reservar' },
  { id: 'reject', label: 'Descartar para este uso' },
  { id: 'inspect', label: 'Necesita inspección' },
]);
export const REVIEW_TASKS = Object.freeze([
  { id: 'retexture', label: 'Retexturizar' },
  { id: 'optimize', label: 'Optimizar' },
  { id: 'rig', label: 'Preparar rig' },
  { id: 'pivot', label: 'Ajustar pivote' },
  { id: 'materials', label: 'Revisar materiales' },
  { id: 'dependencies', label: 'Resolver dependencias' },
  { id: 'mobile', label: 'Preparar versión móvil' },
]);

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2000;
const MAX_HISTORY = 24;
const MAX_NOTES = 5000;
const MAX_TEXT = 160;
const validText = (value, max = MAX_TEXT) => typeof value === 'string' && value.length <= max;
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
const recordKey = ({ assetId, sourceRevision, variantId }) => JSON.stringify([assetId, sourceRevision, variantId]);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesOf = (text) => new TextEncoder().encode(text).byteLength;
const clone = (value) => structuredClone(value);

function cleanScope(scope) {
  if (!scope || !validId(scope.accountId) || !validId(scope.serverId)) {
    throw new TypeError('La revisión requiere accountId y serverId válidos.');
  }
  return { accountId: scope.accountId, serverId: scope.serverId };
}

function emptyDocument(scope) {
  return { schema: REVIEW_SCHEMA, scope, revision: 0, records: [] };
}

function validDecision(value) { return DECISIONS.some((item) => item.id === value); }
function validTasks(value) {
  return Array.isArray(value) && value.length <= REVIEW_TASKS.length &&
    value.every((task) => REVIEW_TASKS.some((allowed) => allowed.id === task)) && new Set(value).size === value.length;
}
function validTimestamp(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }

function validateSnapshot(item, parent) {
  return item && typeof item === 'object' && !Array.isArray(item) &&
    item.assetId === parent.assetId && item.sourceRevision === parent.sourceRevision && item.variantId === parent.variantId &&
    validDecision(item.decision) && validTasks(item.tasks) && validText(item.use) && validText(item.collection) &&
    validText(item.notes, MAX_NOTES) && Number.isSafeInteger(item.revision) && item.revision >= 1 && validTimestamp(item.updatedAt);
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      !validId(record.assetId) || !validId(record.sourceRevision) || !validId(record.variantId) ||
      !validDecision(record.decision) || !validTasks(record.tasks) ||
      !validText(record.notes, MAX_NOTES) || !validText(record.use) || !validText(record.collection) ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || !validTimestamp(record.updatedAt) ||
      !Array.isArray(record.history) || record.history.length > MAX_HISTORY) return false;
  return record.history.every((item) => validateSnapshot(item, record));
}

function validateDocument(document, scope) {
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      document.schema !== REVIEW_SCHEMA || !document.scope ||
      document.scope.accountId !== scope.accountId || document.scope.serverId !== scope.serverId ||
      !Number.isSafeInteger(document.revision) || document.revision < 0 ||
      !Array.isArray(document.records) || document.records.length > MAX_RECORDS ||
      document.records.some((record) => !validateRecord(record))) {
    throw new TypeError('El archivo de revisiones no coincide con la cuenta/servidor o contiene datos inválidos.');
  }
  const keys = new Set();
  for (const record of document.records) {
    const key = recordKey(record);
    if (keys.has(key)) throw new TypeError('El archivo de revisiones contiene claves duplicadas.');
    keys.add(key);
  }
  if (bytesOf(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) throw new TypeError('El archivo de revisiones supera 2 MiB.');
  return document;
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function byKey(records) { return new Map(records.map((record) => [recordKey(record), record])); }

/** Merge local unsaved changes onto a fresh storage read, without replacing concurrent edits. */
function mergeLocalChanges(local, baseline, remote) {
  const localMap = byKey(local.records);
  const baseMap = byKey(baseline.records);
  const remoteMap = byKey(remote.records);
  for (const [key, localRecord] of localMap) {
    const baseRecord = baseMap.get(key);
    if (sameJson(localRecord, baseRecord)) continue;
    const remoteRecord = remoteMap.get(key);
    if (!sameJson(remoteRecord, baseRecord)) return { conflict: { local: localRecord, remote: remoteRecord } };
    remoteMap.set(key, localRecord);
  }
  for (const key of baseMap.keys()) {
    if (localMap.has(key)) continue;
    const remoteRecord = remoteMap.get(key);
    if (!sameJson(remoteRecord, baseMap.get(key))) return { conflict: { local: null, remote: remoteRecord } };
    remoteMap.delete(key);
  }
  return { document: { ...remote, revision: Math.max(remote.revision, local.revision), records: [...remoteMap.values()] } };
}

/** Account/server scoped local drafts. This store never publishes to world or gameplay state. */
export class AssetReviewStore {
  constructor({ scope, storage = defaultStorage(), now = () => new Date() } = {}) {
    this.scope = cleanScope(scope);
    this.storage = storage;
    this.now = now;
    this.key = `${REVIEW_SCHEMA}:${encodeURIComponent(this.scope.accountId)}:${encodeURIComponent(this.scope.serverId)}`;
    this.document = emptyDocument(this.scope);
    this.persistedDocument = emptyDocument(this.scope);
    this.persistenceError = '';
    this.load();
  }

  readLatest() {
    if (!this.storage) return { ok: false, error: 'El almacenamiento local no está disponible.' };
    try {
      const raw = this.storage.getItem(this.key);
      if (raw == null) return { ok: true, document: emptyDocument(this.scope) };
      if (typeof raw !== 'string' || bytesOf(raw) > MAX_DOCUMENT_BYTES) throw new TypeError('El borrador guardado excede 2 MiB.');
      return { ok: true, document: clone(validateDocument(JSON.parse(raw), this.scope)) };
    } catch (error) {
      return { ok: false, error: `No se pudo leer el borrador guardado: ${error.message || error}` };
    }
  }

  load() {
    const result = this.readLatest();
    if (!result.ok) { this.persistenceError = result.error; return this.document; }
    this.document = clone(result.document);
    this.persistedDocument = clone(result.document);
    this.persistenceError = '';
    return this.document;
  }

  get(entry, variantId = 'base') {
    if (!entry || typeof entry.id !== 'string' || typeof entry.sourceRevision !== 'string') return null;
    return this.document.records.find((record) => record.assetId === entry.id &&
      record.sourceRevision === entry.sourceRevision && record.variantId === variantId) || null;
  }

  getHistory(entry, variantId = 'base') {
    return this.document.records.filter((record) => record.assetId === entry?.id && record.variantId === variantId);
  }

  history(entry, variantId = 'base') { return this.getHistory(entry, variantId); }

  save(entry, input = {}, { expectedRevision = this.get(entry, input.variantId || 'base')?.revision || 0 } = {}) {
    if (!entry || !validId(entry.id) || !validId(entry.sourceRevision)) return { ok: false, error: 'Ficha de asset inválida.' };
    if (!validId(input.variantId || 'base') || !validText(input.use) ||
        !validDecision(input.decision) || !validTasks(input.tasks) ||
        !validText(input.notes || '', MAX_NOTES) || !validText(input.collection || '')) {
      return { ok: false, error: 'La revisión tiene campos inválidos o excede el límite permitido.' };
    }
    const variantId = input.variantId || 'base';
    const key = recordKey({ assetId: entry.id, sourceRevision: entry.sourceRevision, variantId });
    const localRecord = this.document.records.find((record) => recordKey(record) === key);
    const baselineRecord = this.persistedDocument.records.find((record) => recordKey(record) === key);
    const hasLocalPendingRetry = !sameJson(localRecord, baselineRecord) && (baselineRecord?.revision || 0) === expectedRevision;
    if ((localRecord?.revision || 0) !== expectedRevision && !hasLocalPendingRetry) {
      return { ok: false, error: 'conflict', expectedRevision, actualRevision: localRecord?.revision || 0 };
    }

    let current = this.document;
    if (this.storage) {
      const latest = this.readLatest();
      if (!latest.ok) {
        this.persistenceError = latest.error;
        return { ok: false, error: latest.error, record: localRecord, persisted: false, recoverable: true };
      }
      const combined = mergeLocalChanges(this.document, this.persistedDocument, latest.document);
      if (combined.conflict) {
        const actualRevision = combined.conflict.remote?.revision || 0;
        return { ok: false, error: 'conflict', expectedRevision, actualRevision };
      }
      current = combined.document;
      const currentRecord = current.records.find((record) => recordKey(record) === key);
      if ((currentRecord?.revision || 0) !== (localRecord?.revision || 0)) {
        return { ok: false, error: 'conflict', expectedRevision, actualRevision: currentRecord?.revision || 0 };
      }
    }

    const existingIndex = current.records.findIndex((record) => recordKey(record) === key);
    const prior = existingIndex >= 0 ? current.records[existingIndex] : null;
    const timestamp = this.now().toISOString();
    const history = [...(prior?.history || [])];
    if (prior) history.push({
      assetId: prior.assetId, sourceRevision: prior.sourceRevision, variantId: prior.variantId,
      decision: prior.decision, tasks: [...prior.tasks], use: prior.use, collection: prior.collection,
      notes: prior.notes, revision: prior.revision, updatedAt: prior.updatedAt,
    });
    const record = {
      assetId: entry.id, sourceRevision: entry.sourceRevision, variantId,
      decision: input.decision, tasks: [...input.tasks], use: input.use,
      collection: input.collection || '', notes: input.notes || '',
      revision: (prior?.revision || 0) + 1, updatedAt: timestamp, history: history.slice(-MAX_HISTORY),
    };
    const next = { ...current, revision: current.revision + 1, records: [...current.records] };
    if (existingIndex >= 0) next.records[existingIndex] = record;
    else {
      if (next.records.length >= MAX_RECORDS) return { ok: false, error: 'Se alcanzó el límite de revisiones guardadas.' };
      next.records.push(record);
    }
    if (!validateRecord(record) || bytesOf(JSON.stringify(next)) > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: 'La revisión superaría los límites del archivo.' };
    }
    this.document = next;
    if (!this.storage) {
      this.persistenceError = 'El almacenamiento local no está disponible; conserva la sesión exportándola.';
      return { ok: false, error: this.persistenceError, record, documentRevision: next.revision, persisted: false, recoverable: true };
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(next));
      this.persistedDocument = clone(next);
      this.persistenceError = '';
      return { ok: true, record, documentRevision: next.revision, persisted: true };
    } catch (error) {
      this.persistenceError = `No se pudo guardar el borrador: ${error.message || error}`;
      return { ok: false, error: this.persistenceError, record, documentRevision: next.revision, persisted: false, recoverable: true };
    }
  }

  export() {
    const text = JSON.stringify(this.document, null, 2);
    if (bytesOf(text) > MAX_DOCUMENT_BYTES) throw new RangeError('El archivo de revisiones supera 2 MiB.');
    return text;
  }

  import(text, { mode = 'merge' } = {}) {
    if (mode !== 'merge') return { ok: false, error: 'Solo se admite combinar sin sobrescribir revisiones.' };
    if (typeof text !== 'string' || bytesOf(text) > MAX_DOCUMENT_BYTES) return { ok: false, error: 'El archivo de revisión excede 2 MiB.' };
    let incoming;
    let pendingDrafts = [];
    try {
      const parsed = JSON.parse(text);
      if (Object.hasOwn(parsed || {}, 'pendingDrafts')) {
        if (!Array.isArray(parsed.pendingDrafts) || parsed.pendingDrafts.length > MAX_RECORDS ||
            bytesOf(JSON.stringify(parsed.pendingDrafts)) > MAX_DOCUMENT_BYTES) throw new TypeError('La lista de borradores pendientes no es válida.');
        pendingDrafts = parsed.pendingDrafts;
        for (const draft of pendingDrafts) {
          if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !validId(draft.assetId) ||
              !validId(draft.sourceRevision) || !validId(draft.variantId) || !Number.isSafeInteger(draft.expectedRevision) ||
              draft.expectedRevision < 0 || !validDecision(draft.decision) || !validTasks(draft.tasks) ||
              !validText(draft.use) || !validText(draft.collection) || !validText(draft.notes, MAX_NOTES)) {
            throw new TypeError('La lista contiene un borrador pendiente inválido.');
          }
        }
      }
      incoming = validateDocument(parsed, this.scope);
    } catch (error) { return { ok: false, error: `No se importó ningún cambio: ${error.message || error}` }; }
    if (pendingDrafts.length) return { ok: false, error: 'pending_drafts', recoverableDrafts: clone(pendingDrafts) };

    let remote = emptyDocument(this.scope);
    if (this.storage) {
      const latest = this.readLatest();
      if (!latest.ok) { this.persistenceError = latest.error; return { ok: false, error: latest.error, recoverable: true }; }
      remote = latest.document;
    }
    const combined = mergeLocalChanges(this.document, this.persistedDocument, remote);
    if (combined.conflict) return { ok: false, error: 'conflict', recoverable: true };
    const records = byKey(combined.document.records);
    for (const record of incoming.records) {
      const key = recordKey(record);
      const current = records.get(key);
      if (current && !sameJson(current, record)) return { ok: false, error: `Conflicto en ${record.assetId}; no se importó ningún cambio.` };
      if (!current) records.set(key, record);
    }
    if (records.size > MAX_RECORDS) return { ok: false, error: 'La importación superaría el límite de revisiones.' };
    const next = { ...combined.document, revision: Math.max(combined.document.revision, incoming.revision) + 1, records: [...records.values()] };
    if (bytesOf(JSON.stringify(next)) > MAX_DOCUMENT_BYTES) return { ok: false, error: 'La importación superaría el límite de 2 MiB.' };
    this.document = next;
    if (!this.storage) {
      this.persistenceError = 'El almacenamiento local no está disponible; conserva la sesión exportándola.';
      return { ok: false, error: this.persistenceError, document: next, persisted: false, recoverable: true };
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(next));
      this.persistedDocument = clone(next);
      this.persistenceError = '';
      return { ok: true, document: next, persisted: true };
    } catch (error) {
      this.persistenceError = `No se pudo guardar la importación: ${error.message || error}`;
      return { ok: false, error: this.persistenceError, document: next, persisted: false, recoverable: true };
    }
  }
}
