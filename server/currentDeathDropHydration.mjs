// Read-only current-state preparation for the shared startup hydrator. It never installs World,
// consumes drops, emits historical events or grants a cross-process lease. Explicit projection is local only.
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { checkedDeathReceipt } from './deathOperation.mjs';
import { currentDeathDropPage, checkedCurrentDeathDropPage, checkedCurrentDeathDrop } from './deathDropOperation.mjs';
import { snapshotDropData } from './deathDropApply.mjs';

const same = (a, b) => canonicalText(a) === canonicalText(b);

export class CurrentDeathDropHydration {
  #store; #worldId; #pageSize; #maxRows; #assertCurrent; #deadlineClock; #rows = null;

  constructor(store, worldId, pageSize, maxRows, assertCurrent, deadlineClock = null) {
    if (['listCurrentDeathDrops','loadDeathDrop','loadDeathOperation'].some(k => typeof store?.[k] !== 'function')) {
      throw new StoreError('configuration');
    }
    this.#store = store; this.#worldId = worldId; this.#pageSize = pageSize; this.#maxRows = maxRows;
    this.#assertCurrent = assertCurrent; this.#deadlineClock = deadlineClock;
  }

  async #scan() {
    const rows = []; let after = null;
    for (;;) {
      this.#assertCurrent();
      const page = currentDeathDropPage(this.#worldId, { after, limit: this.#pageSize });
      const raw = await this.#store.listCurrentDeathDrops(page.world, { after: page.after, limit: page.limit });
      this.#assertCurrent();
      const next = checkedCurrentDeathDropPage(snapshotDropData(raw), page);
      if (rows.length + next.length > this.#maxRows) throw new StoreError('capacity');
      rows.push(...next);
      if (next.length < page.limit) return rows;
      after = { operationId: next.at(-1).operationId, ordinal: next.at(-1).ordinal };
    }
  }

  async read() {
    if (this.#rows !== null) throw new StoreError('operation');
    const rows = await this.#scan(), receipts = new Map();
    for (const row of rows) {
      this.#assertCurrent();
      const reads = await Promise.allSettled([
        Promise.resolve().then(() => this.#store.loadDeathDrop(row.operationId, row.ordinal)),
        Promise.resolve().then(() => receipts.has(row.operationId) ? receipts.get(row.operationId) : this.#store.loadDeathOperation(row.operationId)),
      ]);
      this.#assertCurrent();
      const failed = reads.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
      const current = checkedCurrentDeathDrop(snapshotDropData(reads[0].value), row);
      const receipt = checkedDeathReceipt(snapshotDropData(reads[1].value), row.operationId);
      if (!current || !same(current, row) || !receipt) throw new StoreError('ownership');
      const { state, version, holder, transitionOperationId, ...creation } = row;
      if (!same(creation, receipt.result.drops[row.ordinal - 1])) throw new StoreError('ownership');
      receipts.set(row.operationId, receipt);
    }
    this.#assertCurrent(); this.#rows = rows;
    return structuredClone(rows);
  }

  async verify() {
    if (this.#rows === null) throw new StoreError('operation');
    if (!same(await this.#scan(), this.#rows)) throw new StoreError('conflict');
    this.#assertCurrent();
  }

  plan(startId, drops) {
    if (this.#rows === null) throw new StoreError('operation');
    // A duplicate or partial durable marker already in World is an authority error; preserve it.
    for (const drop of drops.values()) {
      const checked = snapshotDropData(drop);
      const fields = checked && typeof checked === 'object' ? Object.getOwnPropertyDescriptors(checked) : {};
      if (Object.hasOwn(fields, 'operationId') || Object.hasOwn(fields, 'ordinal')) throw new StoreError('ownership');
    }
    return this.#rows.map((row, i) => {
      const id = startId + i;
      if (drops.has(id)) throw new StoreError('ownership');
      const drop = { id, to: 0, kind: row.kind, operationId: row.operationId, ordinal: row.ordinal,
        x: row.ground.x, z: row.ground.z,
        ...(this.#deadlineClock ? this.#deadlineClock.project(row.ground,'drop') :
          {pickAt:row.ground.availableAt,t:row.ground.expiresAt}) };
      if (row.kind === 'item') drop.item = structuredClone(row.item);
      return { drop };
    });
  }
}
