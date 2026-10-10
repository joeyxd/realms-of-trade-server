import { createIndexedDbDraftSource } from './draftStore.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, status) => Object.assign(new Error(code), { code, status });
const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Persist exact activation attempts before sending. A transport failure is not a rejection. */
export class GmContentClient {
  constructor({ auth, accountId, httpBase, localScope, source, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    Object.assign(this, { auth, accountId, fetchImpl });
    this.base = new URL('api/gm/', httpBase); this.key = `content-pending:${localScope}`;
    this.source = source || createIndexedDbDraftSource(); this.pending = null; this.epoch = 0; this.enabled = true;
  }
  identity() {
    if (!this.enabled || !this.auth.state?.signedIn || this.auth.state.accountId !== this.accountId) throw fail('auth');
  }
  resume() { this.enabled = true; }
  cancel() { this.enabled = false; this.epoch++; this.controller?.abort(); }
  async request(route, method, input) {
    this.identity();
    if (this.controller) throw fail('busy');
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const identity = await this.auth.sessionIdentity();
      this.identity();
      if (identity.accountId !== this.accountId || epoch !== this.epoch) throw fail('auth');
      const response = await this.fetchImpl(new URL(route, this.base), { method, cache: 'no-store', signal: controller.signal,
        headers: { authorization: `Bearer ${identity.token}`, ...(input ? { 'content-type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) });
      const body = await response.json(); this.identity();
      if (epoch !== this.epoch || controller.signal.aborted) throw fail('cancelled');
      if (!response.ok || body?.ok !== true) throw fail(body?.code || 'gm_content_unavailable', response.status);
      return body;
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }
  async record() {
    const row = await this.source.read(this.key) ?? { revision: 0, operation: null };
    if (!Number.isSafeInteger(row.revision) || row.revision < 0 || row.operation !== null &&
        (!UUID.test(row.operation?.operationId) || !Number.isSafeInteger(row.operation.expectedGeneration) ||
         row.operation.expectedGeneration < 0 || row.operation.revisionId !== null && !HASH.test(row.operation.revisionId))) throw fail('local_recovery_invalid');
    this.pending = clone(row.operation); return row;
  }
  async replace(row, operation) {
    if (!await this.source.compareAndSwap(this.key, row.revision, { revision: row.revision + 1, operation })) throw fail('local_attempt_conflict');
    this.pending = clone(operation);
  }
  async inspect() {
    await this.record(); const result = await this.request('revisions', 'GET');
    if (!Number.isSafeInteger(result.active?.generation) || !Array.isArray(result.revisions) || result.revisions.length > 100 ||
        result.active.revisionId !== null && !HASH.test(result.active.revisionId)) throw fail('response');
    for (const row of result.revisions) if (!HASH.test(row.revisionId) || !Number.isSafeInteger(row.objects) || !Number.isSafeInteger(row.baseChanges)) throw fail('response');
    return result;
  }
  register(expectedRevision, revisionId) { return this.request('revisions', 'POST', { expectedRevision, revisionId }); }
  async activate(revisionId, expectedGeneration) {
    this.identity(); const row = await this.record();
    if (row.operation) throw fail('pending');
    const operation = { operationId: globalThis.crypto.randomUUID(), expectedGeneration, revisionId };
    await this.replace(row, operation); return this.sendPending(operation);
  }
  async retry() {
    this.identity(); const row = await this.record();
    if (!row.operation) throw fail('no_pending');
    return this.sendPending(row.operation);
  }
  async sendPending(operation) {
    try {
      const result = await this.request('activate', 'POST', operation);
      if (!Number.isSafeInteger(result.generation) || result.generation !== operation.expectedGeneration + 1 || result.revisionId !== operation.revisionId) throw fail('response');
      const row = await this.record(); if (!same(row.operation, operation)) throw fail('local_attempt_conflict');
      await this.replace(row, null); return result;
    } catch (error) {
      if ([400, 409, 413, 429].includes(error.status)) {
        const row = await this.record(); if (same(row.operation, operation)) await this.replace(row, null);
      }
      throw error;
    }
  }
}
