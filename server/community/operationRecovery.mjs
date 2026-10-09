// A single owner's admission barrier. It is not a distributed host lease or an ECS publisher.
import { ContributionError, canonical } from './contributionContract.mjs';
import { operationEntry, operationIntent, operationPage, operationScope,
  pendingOperationPage } from './operationJournalContract.mjs';

const fail = code => { throw new ContributionError(code); };
export class CommunityOperationRecovery {
  #store; #scope; #pageSize; #maxPending;
  #phase = 'closed'; #reason = null; #active = 0;
  #known = new Map(); #characters = new Set();
  constructor(store, { worldId, worldEpoch, pageSize = 128, maxPending = 8192, allowVolatile = false } = {}) {
    if (['prepareOperation', 'commitOperation', 'loadOperation', 'listPendingOperations']
      .some(k => typeof store?.[k] !== 'function') || typeof allowVolatile !== 'boolean'
      || (store.durable !== true && !allowVolatile)) fail('configuration');
    try {
      this.#scope = operationScope(worldId, worldEpoch);
      operationPage(worldId, worldEpoch, null, pageSize);
      if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 65536) fail('input');
    } catch { fail('configuration'); }
    this.#store = store; this.#pageSize = pageSize; this.#maxPending = maxPending;
  }
  canAdmit() { return this.#phase === 'ready'; }
  view() { return { phase: this.#phase, ready: this.canAdmit(), unresolved: this.#known.size,
    active: this.#active, reason: this.#reason }; }
  // A session may discover unreadable/missing evidence after execution or publication.
  // Only a complete recovery scan may reopen this single-owner barrier.
  invalidate(reason = 'response', raw = null) {
    if (!['response', 'unavailable', 'pending'].includes(reason)) fail('input');
    if (raw !== null) this.#remember(this.#intent(raw));
    this.#fence(new ContributionError(reason));
  }
  #intent(raw) {
    const intent = operationIntent(raw), b = intent.binding;
    if (b.worldId !== this.#scope.worldId || b.worldEpoch !== this.#scope.worldEpoch) fail('scope');
    return intent;
  }
  #remember(intent) {
    const previous = this.#known.get(intent.operationId);
    if (previous && canonical(previous) !== canonical(intent)) fail('response');
    // Retain an independent request before I/O; neither SDK nor caller can edit a retry.
    this.#known.set(intent.operationId, structuredClone(intent));
  }
  #fence(err) {
    this.#phase = 'fenced';
    this.#reason = err instanceof ContributionError ? err.code : 'unavailable';
  }
  async #scan() {
    let after = null, count = 0;
    for (;;) {
      const { worldId, worldEpoch } = this.#scope;
      const page = operationPage(worldId, worldEpoch, after, this.#pageSize);
      const rows = pendingOperationPage(await this.#store.listPendingOperations(
        worldId, worldEpoch, after, this.#pageSize), page);
      // Read a terminal empty page even after a short page, so a bad adapter cannot
      // accidentally truncate the startup proof at the first partial response.
      if (!rows.length) return;
      count += rows.length;
      if (count > this.#maxPending) fail('capacity');
      for (const entry of rows) this.#remember(entry.intent);
      after = rows.at(-1).intent.operationId;
    }
  }
  async execute(raw, { canContinue = () => true } = {}) {
    const intent = this.#intent(raw);
    if (typeof canContinue !== 'function' || canContinue.constructor?.name === 'AsyncFunction') fail('configuration');
    if (!this.canAdmit()) fail('startup');
    const key = intent.binding.characterId;
    if (this.#characters.has(key)) fail('busy');
    this.#remember(intent); this.#characters.add(key); this.#active++;
    try {
      if (canContinue() !== true) fail('identity');
      let entry = operationEntry(await this.#store.prepareOperation(structuredClone(intent)), intent);
      if (entry.state === 'pending') {
        // Revocation cannot undo a dispatched write. It can prevent dispatching the
        // next phase after prepare; that durable pending request then needs recovery.
        if (canContinue() !== true) fail('identity');
        entry = operationEntry(await this.#store.commitOperation(structuredClone(intent)), intent);
      }
      if (entry.state !== 'complete') fail('response');
      this.#known.delete(intent.operationId);
      return entry;
    } catch (err) { this.#fence(err); return { ok: false, why: this.#reason }; }
    finally { this.#active--; this.#characters.delete(key); }
  }
  // Read-only by default. A missing prepare reply is also uncertain: only an exact
  // explicit retry can establish/finish that request when no durable row is visible.
  async recover({ retry = false } = {}) {
    if (typeof retry !== 'boolean') fail('input');
    if (this.#phase === 'recovering' || this.#active) fail('busy');
    this.#phase = 'recovering'; this.#reason = null;
    try {
      await this.#scan();
      for (const [id, original] of [...this.#known]) {
        const raw = await this.#store.loadOperation(id);
        let entry = raw === null ? null : operationEntry(raw, original);
        if (entry === null && retry) entry = operationEntry(
          await this.#store.prepareOperation(structuredClone(original)), original);
        if (entry?.state === 'pending' && retry) entry = operationEntry(
          await this.#store.commitOperation(structuredClone(original)), original);
        if (entry?.state === 'complete') this.#known.delete(id);
      }
      // Never open from a historical complete receipt while another pending request
      // exists. Recovery does not emit its snapshots into a character or world.
      await this.#scan();
      if (this.#known.size) { this.#phase = 'closed'; this.#reason = 'pending'; }
      else this.#phase = 'ready';
    } catch (err) { this.#fence(err); }
    return this.view();
  }
}
