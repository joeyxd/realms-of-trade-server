// One detached numeric row for pearl helpers. Reads of other entities remain read-only; writes
// outside this row fail closed. Typed single-cell buffers preserve the live column's conversion.
import { applyPearlChange } from '../src/sim/systems/pearlEffect.js';
import { StoreError } from './store.mjs';
import { PEARL_ACTION_BUFFERS } from '../src/net/pearlInputBoundary.js';

export function pearlEcsDraft(live, entity) {
  const ecs = { cap: live.cap }, columns = new Map(), written = new Set();
  let applied = false;
  for (const [key, column] of Object.entries(live)) {
    if (!ArrayBuffer.isView(column) || column instanceof DataView) continue;
    const cell = new column.constructor(1); cell[0] = column[entity];
    const before = column[entity];
    columns.set(key, { column, cell, before });
    ecs[key] = new Proxy(Object.create(null), {
      get(_target, index) {
        if (index === 'length') return column.length;
        if (index === String(entity)) return cell[0];
        if (typeof index === 'string' && /^(0|[1-9]\d*)$/.test(index)) return column[Number(index)];
        throw new StoreError('effect');
      },
      set(_target, index, value) {
        if (index !== String(entity) || !Number.isFinite(value)) throw new StoreError('effect');
        const previous = cell[0];
        cell[0] = value;
        if (!Number.isFinite(cell[0])) { cell[0] = previous; throw new StoreError('effect'); }
        written.add(key); return true;
      },
    });
  }
  // calm() reads nearby brains. No nested object in the draft refers to live authority.
  ecs.brain = structuredClone(live.brain);
  Object.freeze(ecs);
  const assertCurrent = (current) => {
    if (current !== live) throw new StoreError('effect');
    for (const [key, { column, before }] of columns) {
      if (current[key] !== column || !Object.is(column[entity], before)) throw new StoreError('effect');
    }
  };
  return {
    ecs,
    assertCurrent,
    apply(current) {
      assertCurrent(current);
      applied = true;
      for (const key of written) columns.get(key).column[entity] = columns.get(key).cell[0];
    },
    rollback() {
      if (!applied) return;
      for (const key of written) columns.get(key).column[entity] = columns.get(key).before;
      applied = false;
    },
  };
}

// Eligibility belongs to the accepted swallowPearl preflight. Apply the shared pearl-change
// rule to current state without re-running calm after a durable commit.
export function pearlSwallowEffect(world, entity, profile, { clearInputs = false } = {}) {
  const draft = pearlEcsDraft(world.ecs, entity);
  applyPearlChange({ ecs: draft.ecs, profiles: new Map([[entity, structuredClone(profile)]]) }, entity);
  // Compose with the same draft: independent live writes would invalidate its numeric snapshot.
  if (clearInputs) for (const column of PEARL_ACTION_BUFFERS) draft.ecs[column][entity] = 0;
  return draft;
}
