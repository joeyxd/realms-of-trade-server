import { validateDocument } from './document.js';
import { createIndexedDbDraftSource, MAX_DRAFT_EXPORT_BYTES } from './draftStore.js';
import { verifyPreparedRevision } from './publicationArtifact.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => structuredClone(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class RemoteDraftError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'RemoteDraftError'; this.code = code; Object.assign(this, details); }
}

/** Explicit remote saves. Persist the exact attempt before sending; an abort is never an ACK. */
export class RemoteDraftClient {
  constructor({ auth, accountId, httpBase, localScope, source, fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 12000 }) {
    if (!UUID.test(accountId) || !localScope || !auth?.sessionIdentity) throw new RemoteDraftError('configuration');
    Object.assign(this, { auth, accountId, fetchImpl, timeoutMs });
    this.url = new URL('api/gm/draft', httpBase);
    this.key = `remote-pending:${localScope}`;
    this.source = source || createIndexedDbDraftSource();
    this.pending = null; this.scope = null; this.controller = null; this.epoch = 0; this.enabled = true;
  }

  resume() { this.enabled = true; }
  cancel() { this.enabled = false; this.epoch++; this.controller?.abort(); this.controller = null; }

  async _pendingRecord() {
    let record;
    try { record = await this.source.read(this.key); }
    catch { throw new RemoteDraftError('local_recovery_unavailable'); }
    if (record === null) return { revision: 0, operation: null };
    if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= 2147483647 ||
        !Object.hasOwn(record, 'operation')) throw new RemoteDraftError('local_recovery_invalid');
    if (record.operation !== null) {
      const op = record.operation;
      if (!UUID.test(op?.operationId) || !Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0 ||
          op.expectedRevision >= 2147483647) throw new RemoteDraftError('local_recovery_invalid');
      try { op.document = validateDocument(op.document); } catch { throw new RemoteDraftError('local_recovery_invalid'); }
    }
    return record;
  }

  async _replacePending(record, operation) {
    try {
      if (!await this.source.compareAndSwap(this.key, record.revision, { revision: record.revision + 1, operation })) {
        throw new RemoteDraftError('local_attempt_conflict');
      }
    } catch (error) { throw error instanceof RemoteDraftError ? error : new RemoteDraftError('local_recovery_unavailable'); }
    this.pending = clone(operation);
  }

  async _clearPending(operation) {
    const record = await this._pendingRecord();
    if (record.operation === null) { this.pending = null; return; }
    if (!same(record.operation, operation)) throw new RemoteDraftError('local_attempt_conflict');
    await this._replacePending(record, null);
  }

  _checkIdentity() {
    if (!this.enabled || !this.auth.state?.signedIn || this.auth.state.accountId !== this.accountId) throw new RemoteDraftError('auth');
  }

  _head(head) {
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 0 || head.revision > 2147483647 ||
        (head.revision === 0 ? head.document !== null || head.savedAt !== null : typeof head.savedAt !== 'string')) {
      throw new RemoteDraftError('response');
    }
    return { revision: head.revision, document: head.revision ? validateDocument(head.document) : null, savedAt: head.savedAt };
  }

  async _request(method, operation = null, { expectedDocument = null } = {}) {
    if (this.controller) throw new RemoteDraftError('busy');
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this._checkIdentity();
      const identity = await this.auth.sessionIdentity();
      if (identity.accountId !== this.accountId || epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('auth');
      const response = await this.fetchImpl(method === 'POST' ? new URL('prepare', this.url) : this.url, { method, headers: {
        authorization: `Bearer ${identity.token}`, ...(operation ? { 'content-type': 'application/json' } : {}),
      }, cache: 'no-store', signal: controller.signal, ...(operation ? { body: JSON.stringify(operation) } : {}) });
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      const length = Number(response.headers?.get?.('content-length'));
      if (length > MAX_DRAFT_EXPORT_BYTES + 1024 * 1024) throw new RemoteDraftError('response');
      const body = await response.json();
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      if (!response.ok) throw new RemoteDraftError(body?.code || 'unavailable', { status: response.status, currentRevision: body?.revision });
      const scope = body?.scope;
      if (body.ok !== true || typeof body.durable !== 'boolean' || !scope || typeof scope.worldId !== 'string' ||
          !Number.isSafeInteger(scope.seed) || typeof scope.baseRevision !== 'string' || (method !== 'GET' && this.scope && !same(scope, this.scope))) {
        throw new RemoteDraftError('response');
      }
      if (method === 'POST') {
        const preparation = body.preparation, report = preparation?.report;
        if (body.headRevision !== operation.expectedRevision || typeof report?.valid !== 'boolean' ||
            !Array.isArray(report.issues) || report.issues.length > 200 ||
            report.issues.some((issue) => !['error', 'warning'].includes(issue.severity) || typeof issue.code !== 'string') ||
            !Number.isSafeInteger(report.summary?.errors) || !Number.isSafeInteger(report.summary?.warnings) ||
            report.summary.errors < 0 || report.summary.warnings < 0 || report.valid !== (report.summary.errors === 0)) throw new RemoteDraftError('response');
        if (report.valid) {
          await verifyPreparedRevision(preparation.revision, { scope, draftRevision: body.headRevision, document: expectedDocument });
          if (!same(report, preparation.revision.content.validation)) throw new RemoteDraftError('response');
        } else if (preparation.revision !== null) throw new RemoteDraftError('response');
        this._checkIdentity();
        if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
        return { preparation, durable: body.durable, scope: clone(scope), headRevision: body.headRevision };
      }
      const head = this._head(body.head);
      if (method === 'PUT' && head.document && (head.document.base.seed !== scope.seed || head.document.base.revision !== scope.baseRevision)) {
        throw new RemoteDraftError('response');
      }
      this.scope = clone(scope);
      return { head, durable: body.durable, scope: clone(scope), replay: body.replay === true };
    } catch (error) {
      throw error instanceof RemoteDraftError ? error : new RemoteDraftError('unavailable');
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }

  async inspect() {
    this.pending = clone((await this._pendingRecord()).operation);
    return this._request('GET');
  }

  async prepareRevision(expectedRevision, document) {
    this._checkIdentity();
    const epoch = this.epoch;
    const checked = validateDocument(document);
    if (!this.scope || checked.base.seed !== this.scope.seed || checked.base.revision !== this.scope.baseRevision ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 2147483647) throw new RemoteDraftError('base');
    this.pending = clone((await this._pendingRecord()).operation);
    if (this.pending !== null) throw new RemoteDraftError('pending');
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._request('POST', { expectedRevision }, { expectedDocument: checked });
  }

  async save(document, expectedRevision) {
    this._checkIdentity();
    const epoch = this.epoch;
    const checked = validateDocument(document);
    if (!this.scope || checked.base.seed !== this.scope.seed || checked.base.revision !== this.scope.baseRevision ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) throw new RemoteDraftError('base');
    if (new TextEncoder().encode(JSON.stringify(checked)).byteLength > MAX_DRAFT_EXPORT_BYTES) throw new RemoteDraftError('document_limit');
    const record = await this._pendingRecord();
    if (record.operation !== null) throw new RemoteDraftError('pending');
    const operation = { operationId: globalThis.crypto.randomUUID(), expectedRevision, document: checked };
    await this._replacePending(record, operation);
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._sendPending(operation);
  }

  async retry() {
    this._checkIdentity();
    const epoch = this.epoch;
    const operation = (await this._pendingRecord()).operation;
    if (!operation) throw new RemoteDraftError('no_pending');
    this.pending = clone(operation);
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._sendPending(operation);
  }

  async _sendPending(operation) {
    try {
      const result = await this._request('PUT', operation);
      if (result.head.revision !== operation.expectedRevision + 1 || !same(result.head.document, operation.document)) throw new RemoteDraftError('response');
      await this._clearPending(operation);
      return result;
    } catch (error) {
      // These statuses guarantee rejection. Timeouts/provider/transport errors retain the exact attempt.
      if ([400, 409, 413, 429].includes(error.status)) await this._clearPending(operation);
      throw error;
    }
  }
}
