import assert from 'node:assert/strict';
import test from 'node:test';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';

const scope = { ownerId: 'owner-1', characterId: 'character-1', worldId: 'world-1' };
const limits = { maxCalls: 3, maxTokens: 100, maxCostUnits: 50, maxEntries: 12 };
const budget = (overrides = {}) => new InferenceBudget({ scope, limits: { ...limits, ...overrides } });
const reserve = (ledger, id, overrides = {}) => ledger.reserve({ requestId: id, kind: 'decision',
  inputTokens: 10, outputTokens: 10, maxCostUnits: 5, countMode: 'estimated_tokens', ...overrides });

test('concurrent synchronous reservations cannot pass the same remaining cap', () => {
  const ledger = budget({ maxCalls: 1, maxTokens: 20, maxCostUnits: 5 });
  const results = [reserve(ledger, 'a'), reserve(ledger, 'b')];
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(ledger.snapshot.totals.calls, 1);
  assert.equal(ledger.snapshot.totals.heldTokens, 20);
});

test('all request kinds draw from the same call and usage caps', () => {
  const ledger = budget({ maxCalls: 4 });
  for (const [index, kind] of ['decision', 'compaction', 'embedding', 'retry'].entries()) {
    assert.equal(reserve(ledger, `kind-${index}`, { kind }).ok, true);
  }
  assert.equal(reserve(ledger, 'fifth').why, 'max_calls');
});

test('same reservation replays without consuming capacity; collision is rejected', () => {
  const ledger = budget({ maxCalls: 1 });
  assert.equal(reserve(ledger, 'same').replay, false);
  assert.equal(reserve(ledger, 'same').replay, true);
  assert.equal(reserve(ledger, 'same', { outputTokens: 19 }).why, 'request_id_conflict');
  assert.equal(ledger.snapshot.totals.calls, 1);
});

test('unknown calls retain full holds until trusted usage reconciliation', () => {
  const ledger = budget({ maxCalls: 2, maxTokens: 30, maxCostUnits: 10 });
  reserve(ledger, 'uncertain');
  ledger.markDispatched('uncertain');
  ledger.markUnknown('uncertain', 'connection ended after dispatch');
  const snap = ledger.snapshot.totals;
  assert.equal(snap.unresolvedTokens, 20);
  assert.equal(snap.unresolvedCostUnits, 5);
  assert.equal(snap.heldTokens, 0);
  assert.equal(snap.availableTokens, 10);
  reserve(ledger, 'second', { inputTokens: 10, outputTokens: 0, maxCostUnits: 5 });
  assert.equal(reserve(ledger, 'blocked', { inputTokens: 1, outputTokens: 0, maxCostUnits: 0 }).why, 'max_calls');
  const usage = { inputTokens: 8, outputTokens: 7, costUnits: 3 };
  assert.equal(ledger.settle('uncertain', usage).ok, true);
  assert.equal(ledger.settle('uncertain', usage).replay, true);
  assert.equal(ledger.settle('uncertain', { ...usage, costUnits: 4 }).why, 'usage_conflict');
  assert.deepEqual({ ...ledger.snapshot.totals }, { calls: 2, confirmedTokens: 15, confirmedCostUnits: 3,
    heldTokens: 10, heldCostUnits: 5, unresolvedTokens: 0, unresolvedCostUnits: 0, availableTokens: 5,
    availableCostUnits: 2, entries: 2, reservedEntries: 1, inflightEntries: 0, unknownEntries: 0,
    settledEntries: 1, cancelledEntries: 0, overrun: false });
});

test('actual usage beyond a reservation is recorded truthfully and blocks new admissions', () => {
  const ledger = budget({ maxTokens: 25, maxCostUnits: 10 });
  reserve(ledger, 'large-actual');
  ledger.markDispatched('large-actual');
  const result = ledger.settle('large-actual', { inputTokens: 20, outputTokens: 15, costUnits: 12 });
  assert.equal(result.overrun, true);
  assert.equal(ledger.snapshot.totals.confirmedTokens, 35);
  assert.equal(ledger.snapshot.totals.confirmedCostUnits, 12);
  assert.equal(ledger.snapshot.totals.availableTokens, 0);
  assert.equal(reserve(ledger, 'after-overrun').why, 'budget_overrun');
});

test('cancel before dispatch releases holds and a call but retains the bounded identity', () => {
  const ledger = budget({ maxCalls: 1, maxTokens: 20 });
  reserve(ledger, 'cancel-me');
  assert.equal(ledger.cancelBeforeDispatch('cancel-me').ok, true);
  assert.equal(ledger.snapshot.totals.calls, 0);
  assert.equal(ledger.snapshot.totals.heldTokens, 0);
  assert.equal(reserve(ledger, 'next').ok, true);
  assert.equal(reserve(ledger, 'cancel-me').replay, true);
  assert.equal(ledger.markDispatched('cancel-me').ok, false);
});

test('snapshot and returned entries are detached copies', () => {
  const ledger = budget();
  const receipt = reserve(ledger, 'copy');
  receipt.entry.kind = 'embedding';
  receipt.entry.usage = { inputTokens: 1, outputTokens: 1, costUnits: 1 };
  const snap = ledger.snapshot;
  snap.scope.ownerId = 'tampered';
  snap.limits.maxTokens = 1;
  snap.totals.heldTokens = 0;
  assert.equal(ledger.snapshot.scope.ownerId, 'owner-1');
  assert.equal(ledger.snapshot.limits.maxTokens, 100);
  assert.equal(ledger.snapshot.totals.heldTokens, 20);
  assert.equal(reserve(ledger, 'copy', { kind: 'decision' }).replay, true);
});

test('malformed, zero-work, and overflowing estimates fail closed', () => {
  const ledger = budget();
  for (const input of [
    { requestId: '', kind: 'decision', inputTokens: 1, outputTokens: 0, maxCostUnits: 0, countMode: 'measured_tokens' },
    { requestId: 'bad', kind: 'other', inputTokens: 1, outputTokens: 0, maxCostUnits: 0, countMode: 'measured_tokens' },
    { requestId: 'zero', kind: 'decision', inputTokens: 0, outputTokens: 0, maxCostUnits: 0, countMode: 'measured_tokens' },
    { requestId: 'overflow', kind: 'decision', inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, maxCostUnits: 0, countMode: 'measured_tokens' },
    { requestId: 'bad-mode', kind: 'decision', inputTokens: 1, outputTokens: 0, maxCostUnits: 0, countMode: 'unknown' },
  ]) assert.equal(ledger.reserve(input).ok, false);
  assert.equal(ledger.settle('missing', { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, costUnits: 0 }).ok, false);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('entry capacity never evicts identities and cancellation does not reopen space', () => {
  const ledger = budget({ maxEntries: 2 });
  reserve(ledger, 'one');
  reserve(ledger, 'two');
  assert.equal(ledger.cancelBeforeDispatch('one').ok, true);
  assert.equal(reserve(ledger, 'three').why, 'entry_capacity');
  assert.equal(ledger.snapshot.totals.entries, 2);
});

test('constructor rejects malformed scope or limits', () => {
  assert.throws(() => new InferenceBudget({ scope: { ...scope, extra: true }, limits }));
  assert.throws(() => new InferenceBudget({ scope, limits: { ...limits, maxCalls: 0 } }));
  assert.throws(() => new InferenceBudget({ scope, limits: { ...limits, maxEntries: 257 } }));
  assert.throws(() => new InferenceBudget({ scope: Object.assign(Object.create({ extra: true }), scope), limits }));
  assert.throws(() => new InferenceBudget({ scope, limits: Object.assign(Object.create(null), limits) }));
});

test('request and usage payloads require exact plain own fields and safe request IDs', () => {
  const ledger = budget();
  const base = { requestId: 'safe:id_1-2', kind: 'decision', inputTokens: 1, outputTokens: 0,
    maxCostUnits: 0, countMode: 'measured_tokens' };
  assert.equal(ledger.reserve({ ...base, extra: true }).ok, false);
  assert.equal(ledger.reserve(Object.assign(Object.create({ inputTokens: 1 }), {
    requestId: 'inherited', kind: 'decision', outputTokens: 0, maxCostUnits: 0, countMode: 'measured_tokens',
  })).ok, false);
  assert.equal(ledger.reserve({ ...base, requestId: 'unsafe/id' }).ok, false);
  assert.equal(ledger.reserve({ ...base, requestId: 'non-ascii-é' }).ok, false);
  assert.equal(ledger.reserve(base).ok, true);
  assert.equal(ledger.settle(base.requestId, { inputTokens: 1, outputTokens: 0, costUnits: 0 }).why, 'not_settleable');
  ledger.markDispatched(base.requestId);
  assert.equal(ledger.settle(base.requestId, { inputTokens: 1, outputTokens: 0, costUnits: 0, extra: 0 }).ok, false);
  assert.equal(ledger.settle(base.requestId, Object.assign(Object.create({ costUnits: 0 }), {
    inputTokens: 1, outputTokens: 0,
  })).ok, false);
});

test('provider use beyond a per-call reservation is an overrun even below the global cap', () => {
  const ledger = budget({ maxTokens: 100, maxCostUnits: 50 });
  reserve(ledger, 'per-call');
  ledger.markDispatched('per-call');
  const settled = ledger.settle('per-call', { inputTokens: 11, outputTokens: 10, costUnits: 5 });
  assert.equal(settled.overrun, true);
  assert.equal(ledger.snapshot.totals.overrun, true);
  assert.equal(reserve(ledger, 'next').why, 'budget_overrun');
});

test('settlement arithmetic overflow fails closed and latches the overrun gate', () => {
  const ledger = budget({ maxTokens: Number.MAX_SAFE_INTEGER, maxCostUnits: Number.MAX_SAFE_INTEGER });
  reserve(ledger, 'overflow-settle', { inputTokens: 1, outputTokens: 0, maxCostUnits: 1 });
  ledger.markDispatched('overflow-settle');
  // The incoming value is individually safe, while adding it to the ledger total is not.
  ledger.reserve({ requestId: 'fill-cost', kind: 'decision', inputTokens: 1, outputTokens: 0,
    maxCostUnits: Number.MAX_SAFE_INTEGER - 1, countMode: 'estimated_tokens' });
  ledger.settle('overflow-settle', { inputTokens: 1, outputTokens: 0, costUnits: 1 });
  ledger.markDispatched('fill-cost');
  assert.equal(ledger.settle('fill-cost', { inputTokens: 1, outputTokens: 0,
    costUnits: Number.MAX_SAFE_INTEGER }).why, 'totals_overflow');
  assert.equal(ledger.snapshot.totals.overrun, true);
  assert.equal(reserve(ledger, 'after-overflow').why, 'budget_overrun');
});

test('snapshot exposes detached copies of every ledger entry', () => {
  const ledger = budget();
  reserve(ledger, 'visible');
  const snap = ledger.snapshot;
  assert.equal(snap.entries.length, 1);
  snap.entries[0].kind = 'embedding';
  assert.equal(ledger.snapshot.entries[0].kind, 'decision');
});
