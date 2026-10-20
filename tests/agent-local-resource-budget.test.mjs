import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { LocalResourceBudget } from '../tools/agent/local-resource-budget.mjs';

const scope = { ownerId: 'owner-local', characterId: 'companion-local', worldId: 'world-local' };
const limits = { maxCalls: 3, maxTokens: 1000, maxCostUnits: 1000, maxEntries: 16 };
const policy = { baseUrl: 'http://127.0.0.1:8080/v1', modelId: 'qwen3.8-flash-next-coder-iq1_m', thinkingMode: 'server_default' };
let clock = 100;

async function harness(t, extra = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mn-local-resource-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { directory, scope, expiresAtMs: 10_000, ...policy, now: () => clock, ...extra };
  return { directory, config };
}

async function fresh(t, extra = {}) {
  const h = await harness(t, extra);
  const budget = await LocalResourceBudget.initialize({ ...h.config, limits: extra.limits ?? limits });
  return { ...h, budget };
}

function reservation(requestId = 'request-1', inputTokens = 30, outputTokens = 20) {
  return { requestId, kind: 'decision', inputTokens, outputTokens,
    maxCostUnits: inputTokens + outputTokens, countMode: 'estimated_tokens' };
}

test('persists local compute units and settled usage across reopen without USD fields', async (t) => {
  const { config, budget } = await fresh(t);
  assert.equal(budget instanceof InferenceBudget, true);
  assert.equal(budget.snapshot.persistence.schema, 'agent-local-resource-budget/v1');
  assert.equal(budget.snapshot.persistence.unit, 'local_compute_tokens');
  assert.equal(budget.snapshot.persistence.costNanoUsd, null);
  const reserved = await budget.reserve(reservation());
  assert.equal(reserved.ok, true);
  assert.equal(reserved.entry.maxCostUnits, 50);
  assert.equal(reserved.snapshot.persistence.costNanoUsd, null);
  assert.equal((await budget.markDispatched('request-1')).ok, true);
  assert.equal((await budget.checkActive('request-1')).ok, true);
  assert.equal((await budget.settle('request-1', { inputTokens: 30, outputTokens: 7, costUnits: 37 })).ok, true);

  const reopened = await LocalResourceBudget.open(config);
  assert.equal(reopened.snapshot.totals.confirmedTokens, 37);
  assert.equal(reopened.snapshot.totals.confirmedCostUnits, 37);
  assert.equal(reopened.snapshot.entries[0].countMode, 'estimated_tokens');
  assert.equal(reopened.snapshot.persistence.unit, 'local_compute_tokens');
  assert.equal(reopened.snapshot.persistence.costNanoUsd, null);
});

test('durably records each lifecycle step and rejects malformed or under-reserved arithmetic', async (t) => {
  const { budget } = await fresh(t);
  assert.equal((await budget.reserve(reservation('bad-mode', 20, 10))).ok, true);
  assert.equal((await budget.markDispatched('bad-mode')).ok, true);
  const malformed = await budget.settle('bad-mode', { inputTokens: 20, outputTokens: 8, costUnits: 29 });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.why, 'local_resource_budget_invalid_state');
  assert.equal(budget.snapshot.entries.find((entry) => entry.requestId === 'bad-mode').state, 'inflight');
  const other = await fresh(t);
  assert.equal((await other.budget.reserve({ ...reservation('wrong-cost'), maxCostUnits: 1 })).why, 'invalid_reservation');
  assert.equal((await other.budget.reserve({ ...reservation('wrong-mode'), countMode: 'simulated_tokens' })).why, 'invalid_reservation');
});

test('process loss with in-flight or unknown work preserves holds and blocks later dispatch', async (t) => {
  for (const unresolved of ['inflight', 'unknown']) {
    const { config, budget } = await fresh(t);
    assert.equal((await budget.reserve(reservation('request-1'))).ok, true);
    assert.equal((await budget.markDispatched('request-1')).ok, true);
    if (unresolved === 'unknown') {
      assert.equal((await budget.markUnknown('request-1', 'usage_unknown')).ok, true);
      assert.equal((await budget.reserve(reservation('same-process-retry'))).why, 'local_resource_outcome_unresolved');
    }
    const reopened = await LocalResourceBudget.open(config);
    assert.equal(reopened.snapshot.persistence.unresolvedOnOpen, true);
    assert.equal(unresolved === 'unknown' ? reopened.snapshot.totals.unresolvedTokens : reopened.snapshot.totals.heldTokens, 50);
    assert.equal((await reopened.reserve(reservation('request-2'))).why, 'local_resource_outcome_unresolved');
    assert.equal((await reopened.markDispatched('request-1')).why, 'local_resource_outcome_unresolved');
  }
});

test('event timestamps and policy expiry are pinned during replay', async (t) => {
  const { config, budget, directory } = await fresh(t);
  assert.equal((await budget.reserve(reservation())).ok, true);
  const filename = path.join(directory, 'inference-budget.json');
  const state = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(state.events[0].expiresAtMs, config.expiresAtMs);
  state.events[0].atMs = config.expiresAtMs;
  await writeFile(filename, JSON.stringify(state));
  await assert.rejects(LocalResourceBudget.open(config), /local_resource_budget_invalid_state/);

  state.events[0].atMs = 100;
  state.expiresAtMs += 1000;
  await writeFile(filename, JSON.stringify(state));
  await assert.rejects(LocalResourceBudget.open(config), /local_resource_budget_invalid_state/);
});

test('call, token, and local unit caps are enforced; cancellation before dispatch frees the reservation', async (t) => {
  const { budget } = await fresh(t, { limits: { maxCalls: 1, maxTokens: 40, maxCostUnits: 100, maxEntries: 8 } });
  assert.equal((await budget.reserve(reservation('large', 30, 20))).why, 'max_tokens');
  assert.equal((await budget.reserve(reservation('first', 20, 20))).ok, true);
  assert.equal((await budget.cancelBeforeDispatch('first')).ok, true);
  assert.equal((await budget.reserve(reservation('second', 20, 20))).ok, true);
  assert.equal((await budget.reserve(reservation('third', 20, 20))).why, 'max_calls');

  const costLimited = await fresh(t, { limits: { maxCalls: 3, maxTokens: 100, maxCostUnits: 40, maxEntries: 8 } });
  assert.equal((await costLimited.budget.reserve(reservation('over-cost', 25, 20))).why, 'max_cost_units');

  const overrun = await fresh(t, { limits: { maxCalls: 3, maxTokens: 100, maxCostUnits: 100, maxEntries: 8 } });
  assert.equal((await overrun.budget.reserve(reservation('first', 10, 10))).ok, true);
  assert.equal((await overrun.budget.reserve(reservation('held', 10, 10))).ok, true);
  assert.equal((await overrun.budget.markDispatched('first')).ok, true);
  assert.equal((await overrun.budget.settle('first', { inputTokens: 10, outputTokens: 25, costUnits: 35 })).overrun, true);
  assert.equal((await overrun.budget.markDispatched('held')).why, 'budget_overrun');
  assert.equal(overrun.budget.snapshot.persistence.admissionWhy, 'budget_overrun');
});

test('scope, endpoint, model, and thinking policy cannot be changed on reopen or adapter assertion', async (t) => {
  const { config, budget } = await fresh(t);
  for (const change of [
    { scope: { ...scope, ownerId: 'other-owner' } },
    { baseUrl: 'http://127.0.0.1:9000/v1' },
    { modelId: 'different-model' },
    { thinkingMode: 'disabled' },
    { expiresAtMs: 10_001 },
  ]) await assert.rejects(LocalResourceBudget.open({ ...config, ...change }));
  const matching = { countMode: 'estimated_tokens', localResourcePolicy: policy };
  assert.doesNotThrow(() => budget.assertAdapter(matching));
  assert.throws(() => budget.assertAdapter({ ...matching, localResourcePolicy: { ...policy, modelId: 'other' } }), /local_resource_adapter_mismatch/);
  assert.throws(() => budget.assertAdapter({ ...matching, metering: {} }), /local_resource_adapter_mismatch/);
});

test('expired allowances and filesystem failures fail closed', async (t) => {
  const { config, budget } = await fresh(t);
  assert.equal(budget.snapshot.persistence.admissionWhy, null);
  assert.equal(budget.snapshot.persistence.cached, true);
  clock = 10_000;
  assert.equal(budget.snapshot.persistence.admissionWhy, 'local_resource_budget_expired',
    'diagnostics reflect expiry even when no ledger operation has refreshed the cached snapshot');
  assert.equal((await budget.reserve(reservation())).why, 'local_resource_budget_expired');
  clock = 100;
  const missing = path.join(os.tmpdir(), `mn-missing-local-budget-${process.pid}-${Date.now()}`);
  await assert.rejects(LocalResourceBudget.open({ ...config, directory: missing }), /budget_file_missing/);
  await rm(config.directory, { recursive: true, force: true });
  const blocked = await budget.reserve(reservation());
  assert.equal(blocked.ok, false);
  assert.equal(blocked.why, 'budget_file_missing');
});


const registryPolicy = { endpointId: '0123456789abcdef', modelId: 'Provider model:1', thinkingMode: 'disabled' };
async function registryBudget(t) {
  const { config } = await harness(t); delete config.baseUrl; Object.assign(config, registryPolicy);
  return { config, budget: await LocalResourceBudget.initialize({ ...config, limits }) };
}

test('registry policy is accepted, persisted and reopened without a URL or key', async t => {
  const { config, budget } = await registryBudget(t);
  assert.deepEqual(budget.snapshot.persistence.policy, registryPolicy);
  budget.assertAdapter({ countMode: 'estimated_tokens', localResourcePolicy: registryPolicy });
  assert.deepEqual((await LocalResourceBudget.open(config)).snapshot.persistence.policy, registryPolicy);
});

test('budget options reject both baseUrl and endpointId on initialize and open', async t => {
  const { config } = await harness(t);
  await assert.rejects(LocalResourceBudget.initialize({ ...config, limits, endpointId: registryPolicy.endpointId }), TypeError);
  await assert.rejects(LocalResourceBudget.open({ ...config, endpointId: registryPolicy.endpointId }), TypeError);
});

test('budget options reject neither baseUrl nor endpointId on initialize and open', async t => {
  const { config } = await harness(t); delete config.baseUrl;
  await assert.rejects(LocalResourceBudget.initialize({ ...config, limits }), TypeError);
  await assert.rejects(LocalResourceBudget.open(config), TypeError);
});

test('registry budget rejects a loopback adapter', async t => {
  const { budget } = await registryBudget(t);
  assert.throws(() => budget.assertAdapter({ countMode: 'estimated_tokens', localResourcePolicy: policy }), /local_resource_adapter_mismatch/);
});

test('loopback budget rejects a registry adapter', async t => {
  const { budget } = await fresh(t);
  assert.throws(() => budget.assertAdapter({ countMode: 'estimated_tokens', localResourcePolicy: registryPolicy }), /local_resource_adapter_mismatch/);
});

test('loopback budget written with the pre-binding schema loads unchanged', async t => {
  const { directory, config } = await harness(t);
  const bytes = JSON.stringify({ schema: 'agent-local-resource-budget/v1', scope, limits,
    expiresAtMs: config.expiresAtMs, policy, events: [] });
  const file = path.join(directory, 'inference-budget.json'); await writeFile(file, bytes);
  const budget = await LocalResourceBudget.open(config);
  assert.deepEqual(budget.snapshot.persistence.policy, policy);
  budget.assertAdapter({ countMode: 'estimated_tokens', localResourcePolicy: policy });
  assert.equal(await readFile(file, 'utf8'), bytes);
});

test('registry budget rejects invalid endpoint and model ids and extra policy fields', async t => {
  const { config } = await registryBudget(t);
  for (const change of [{ endpointId: 'A'.repeat(16) }, { modelId: ' ' }, { modelId: 'x'.repeat(129) },
    { modelId: 'bad' + String.fromCharCode(10) }, { apiKey: 'forbidden' }, { thinkingMode: 'enabled' }]) {
    await assert.rejects(LocalResourceBudget.open({ ...config, ...change }), TypeError);
  }
});
