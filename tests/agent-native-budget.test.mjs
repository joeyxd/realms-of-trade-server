import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AgentMind } from '../tools/agent/mind.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { meteredCost, meteringHash } from '../tools/agent/inference-metering.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { PersistentInferenceBudget, createBudgetAdministration, replayPersistentBudget } from '../tools/agent/persistent-budget.mjs';
import { createOwnerPanel } from '../tools/agent/owner-panel-server.mjs';

const scope = { ownerId: 'owner-native', characterId: 'agent-native', worldId: 'world-native' };
const sessionScope = { ...scope, sessionId: 'session-native' };
const limits = { maxCalls: 4, maxTokens: 10000, maxCostUnits: 100000, maxEntries: 32 };
const mindLimits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 4, marginTokens: 1,
  timeoutMs: 5000, maxDecisionAgeMs: 1500, maxRequests: 8, maxResponseBytes: 8192 };
const metering = {
  providerId: 'canary.provider', modelId: 'canary-model-v1', unit: 'nano_usd',
  inputNanoUsdPerToken: 3, outputNanoUsdPerToken: 7, priceRef: 'price-fixture-1', priceCheckedAtMs: 1000,
};
const responseText = JSON.stringify({ v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } } });
const nativeAdapter = (overrides = {}) => ({
  id: 'native-test-model', metering, countMode: 'measured_tokens',
  countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
  prepare: () => ({ body: '{"fixture":true}', inputTokens: 40, maxCostUnits: meteredCost(metering, 40, mindLimits.maxOutputTokens) }),
  complete: async () => ({ text: responseText, usage: { inputTokens: 40, outputTokens: 2, costUnits: meteredCost(metering, 40, 2) } }),
  ...overrides,
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(t, { native = true, chosenLimits = limits } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-native-budget-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = () => 1000;
  const admin = createBudgetAdministration({ directory, scope, now });
  const initialized = await admin.initialize({ allowanceId: native ? 'native-allowance' : 'legacy-allowance',
    period: { startsAtMs: 0, endsAtMs: 100000 }, limits: chosenLimits, ...(native ? { metering } : {}) });
  assert.equal(initialized.ok, true);
  const open = () => PersistentInferenceBudget.open({ directory, scope, now });
  return { directory, admin, open };
}

async function runBudgetCli(directory, message) {
  const cli = fileURLToPath(new URL('../tools/agent/manage-budget.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, '--files', directory, '--owner', scope.ownerId,
    '--character', scope.characterId, '--world', scope.worldId], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
  child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
  child.stdin.end(`${JSON.stringify(message)}\n`);
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).data);
  assert.equal(lines.length, 1);
  return lines[0];
}

async function nativePanelSetup(t, runner) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-native-panel-'));
  const directory = path.join(root, 'owner'), budgetDirectory = path.join(root, 'budget');
  await fs.mkdir(directory); await fs.mkdir(budgetDirectory);
  await fs.writeFile(path.join(directory, 'personality.md'), '# Brisa\nHabla con calma.\n');
  await fs.writeFile(path.join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1, scope,
    goals: [{ id: 'home', status: 'active', text: 'Return home', constraints: [] }] }));
  await fs.writeFile(path.join(directory, 'memory.jsonl'), '');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const admin = createBudgetAdministration({ directory: budgetDirectory, scope });
  const now = Date.now();
  assert.equal((await admin.initialize({ allowanceId: 'native-panel', period: { startsAtMs: now - 1000, endsAtMs: now + 60000 },
    limits, metering })).ok, true);
  const panel = await createOwnerPanel({ directory, budgetDirectory, scope, runner });
  const listening = await panel.listen();
  t.after(() => panel.close());
  return { admin, panel, ...listening };
}

async function panelRequest(base, route, { method = 'GET', body } = {}) {
  return fetch(`${base.origin}/api/${route}`, { method, headers: {
    authorization: `Bearer ${base.key}`,
    ...(method !== 'GET' ? { origin: base.origin, 'content-type': 'application/json' } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function mindFixture() {
  const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000 });
  const snapshot = { state: 'ready', grant: fixtureGrant({ scope: sessionScope, expiresAtMs: 100000 }), authority: null,
    observation, required: { rules: ['server authority decides'], personality: { text: 'calm' }, tools: ['move'], observation,
      goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home' }] }, pending: [] },
    memory: [], queryTags: [], scope, ownerFileHashes: { personality: 'p1', objectives: 'o1', memory: 'm1' }, taskFence: 'task-native' };
  const state = { orders: [] };
  const readSnapshot = async () => structuredClone(snapshot);
  const submitOrder = (order) => { state.orders.push(structuredClone(order)); return { ok: true, state: 'accepted' }; };
  const makeMind = (budget, adapter = nativeAdapter(), overrides = {}) => new AgentMind({ budget, adapter, readSnapshot,
    submitOrder, now: () => 1000, limits: mindLimits, contextLimits: {}, ...overrides });
  return { state, makeMind };
}

const nativeReservation = (requestId, overrides = {}) => ({ requestId, kind: 'decision', inputTokens: 40,
  outputTokens: 4, maxCostUnits: meteredCost(metering, 40, 4), countMode: 'measured_tokens', ...overrides });
const nativeUsage = (overrides = {}) => ({ inputTokens: 40, outputTokens: 2,
  costUnits: meteredCost(metering, 40, 2), ...overrides });

test('native durable settlement replays with immutable policy hash and explicit non-invoice charge basis', async (t) => {
  const f = await setup(t); const budget = await f.open();
  assert.notEqual(nativeAdapter().id, metering.providerId, 'adapter implementation ID is distinct from pinned provider identity');
  budget.assertAdapter(nativeAdapter());
  assert.throws(() => budget.assertAdapter(nativeAdapter({ metering: { ...metering, outputNanoUsdPerToken: 8 } })), /budget_adapter_mismatch/);
  assert.throws(() => budget.assertAdapter(nativeAdapter({ countMode: 'simulated_tokens' })), /budget_adapter_mismatch/);

  const reserve = await budget.reserve(nativeReservation('native-1'));
  assert.equal(reserve.ok, true);
  assert.equal(reserve.entry.maxCostUnits, 148);
  assert.equal((await budget.markDispatched('native-1')).ok, true);
  const settled = await budget.settle('native-1', nativeUsage());
  assert.equal(settled.ok, true);
  assert.equal(settled.snapshot.entries[0].usageSource, 'adapter_native');
  assert.equal(settled.entry.usage.costUnits, 134);
  assert.equal(settled.snapshot.entries[0].chargeSource, 'pinned_rate_calculation');
  assert.equal(settled.snapshot.entries[0].invoiceCostUnits, null);
  assert.equal(settled.snapshot.meteringSha256, meteringHash(metering));
  assert.equal(settled.snapshot.persistence.unit, 'nano_usd');
  assert.equal(settled.snapshot.persistence.chargeBasis, 'owner_pinned_uncached_rates');
  assert.equal(settled.snapshot.persistence.invoiceConfirmed, false);

  const persisted = JSON.parse(await fs.readFile(path.join(f.directory, 'inference-budget.json'), 'utf8'));
  assert.equal(persisted.schema, 'agent-inference-budget/v2');
  assert.equal(persisted.events.find((event) => event.type === 'reserve').meteringSha256, meteringHash(metering));
  assert.equal(persisted.events.find((event) => event.type === 'settle').meteringSha256, meteringHash(metering));
  const reopened = await f.open();
  assert.equal(reopened.snapshot.entries[0].usageSource, 'adapter_native');
  assert.equal(reopened.snapshot.totals.confirmedCostUnits, 134);
});

test('native reservation must exactly match pinned rates and rejects simulated token mode', async (t) => {
  const f = await setup(t); const budget = await f.open();
  const estimated = await budget.reserve(nativeReservation('estimated', { countMode: 'estimated_tokens' }));
  assert.equal(estimated.ok, true);
  assert.equal((await budget.cancelBeforeDispatch('estimated')).ok, true);
  assert.equal((await budget.reserve(nativeReservation('under', { maxCostUnits: 147 }))).why, 'invalid_reservation');
  assert.equal((await budget.reserve(nativeReservation('over', { maxCostUnits: 149 }))).why, 'invalid_reservation');
  assert.equal((await budget.reserve(nativeReservation('simulated', { countMode: 'simulated_tokens' }))).why, 'invalid_reservation');
  assert.equal((await f.admin.reserve(nativeReservation('admin-under', { maxCostUnits: 147 }))).why, 'invalid_reservation');
  assert.equal((await f.admin.settle('missing', nativeUsage({ costUnits: 135 }))).why, 'invalid_usage');
  assert.equal((await f.admin.inspect()).snapshot.totals.entries, 1);
});

test('unknown native call retains its hold across restart until owner reconciliation', async (t) => {
  const f = await setup(t); const budget = await f.open();
  assert.equal((await budget.reserve(nativeReservation('unknown-1'))).ok, true);
  assert.equal((await budget.markDispatched('unknown-1')).ok, true);
  assert.equal((await budget.markUnknown('unknown-1', 'usage_unknown')).ok, true);
  const reopened = await f.open();
  assert.equal(reopened.snapshot.totals.unknownEntries, 1);
  assert.equal(reopened.snapshot.totals.unresolvedCostUnits, 148);
  const reconciled = await f.admin.settle('unknown-1', nativeUsage(), 'owner_supplied');
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.snapshot.entries[0].usageSource, 'owner_supplied');
  assert.equal((await f.open()).snapshot.totals.unknownEntries, 0);
  assert.equal((await f.open()).snapshot.totals.confirmedCostUnits, 134);
});

test('manual reconciliation cannot settle an inflight native call before its late adapter receipt', async (t) => {
  const f = await setup(t); const budget = await f.open(); const fixture = mindFixture();
  const started = deferred(), answer = deferred();
  const mind = fixture.makeMind(budget, nativeAdapter({ complete: async () => { started.resolve(); return answer.promise; } }));
  const decision = mind.decide();
  await started.promise;

  const inflight = await f.admin.inspect();
  const entry = inflight.snapshot.entries[0];
  assert.equal(entry.state, 'inflight');
  const rejected = await f.admin.settle(entry.requestId, nativeUsage(), 'owner_supplied');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.why, 'manual_reconciliation_requires_unknown');
  assert.equal(rejected.snapshot.persistence.revision, inflight.snapshot.persistence.revision);
  assert.equal(rejected.snapshot.entries[0].state, 'inflight');
  assert.equal(rejected.snapshot.totals.heldCostUnits, 148);

  answer.resolve({ text: responseText, usage: nativeUsage() });
  assert.equal((await decision).ok, true);
  const settled = await f.open();
  assert.equal(settled.snapshot.entries[0].state, 'settled');
  assert.equal(settled.snapshot.entries[0].usageSource, 'adapter_native');
  assert.equal(settled.snapshot.totals.confirmedTokens, 42);
  assert.equal(settled.snapshot.totals.confirmedCostUnits, 134);
  assert.equal(settled.snapshot.totals.unknownEntries, 0);
});

test('replay rejects a tampered manual native settlement event for an inflight request', async (t) => {
  const f = await setup(t); const budget = await f.open();
  assert.equal((await budget.reserve(nativeReservation('inflight-manual'))).ok, true);
  assert.equal((await budget.markDispatched('inflight-manual')).ok, true);
  const state = JSON.parse(await fs.readFile(path.join(f.directory, 'inference-budget.json'), 'utf8'));
  state.events.push({ type: 'settle', atMs: 1000, requestId: 'inflight-manual', usage: nativeUsage(),
    usageSource: 'owner_supplied', meteringSha256: meteringHash(metering) });
  assert.throws(() => replayPersistentBudget(state, scope), /budget_invalid_state/);
});

test('native actual use above the reservation is recorded and latches overrun after restart', async (t) => {
  const f = await setup(t, { chosenLimits: { ...limits, maxTokens: 10000, maxCostUnits: 1000 } });
  const budget = await f.open();
  assert.equal((await budget.reserve(nativeReservation('overrun-1'))).ok, true);
  assert.equal((await budget.markDispatched('overrun-1')).ok, true);
  const result = await budget.settle('overrun-1', nativeUsage({ outputTokens: 5, costUnits: meteredCost(metering, 40, 5) }));
  assert.equal(result.ok, true);
  assert.equal(result.overrun, true);
  assert.equal(result.entry.usage.costUnits, 155);
  assert.equal((await f.open()).snapshot.totals.overrun, true);
  assert.equal((await (await f.open()).reserve(nativeReservation('after-overrun'))).why, 'budget_overrun');
});

test('native mind requires valid usage, keeps unresolved holds, and does not infer usage from response text', async (t) => {
  for (const [label, usage] of [['missing', null], ['incorrect cost', nativeUsage({ costUnits: 1 })]]) {
    await t.test(label, async (st) => {
      const f = await setup(st); const budget = await f.open(); const fixture = mindFixture(); let calls = 0;
      const result = await fixture.makeMind(budget, nativeAdapter({ complete: async () => { calls++; return { text: responseText, usage }; } })).decide();
      assert.equal(result.ok, false);
      assert.equal(result.why, 'native_usage_unavailable');
      assert.equal(calls, 1);
      assert.equal(fixture.state.orders.length, 0);
      const persisted = await f.open();
      assert.equal(persisted.snapshot.totals.unknownEntries, 1);
      assert.equal(persisted.snapshot.totals.confirmedTokens, 0);
    });
  }
});

test('native mind checks output cap from trusted provider counters, not UTF-8 text estimate', async (t) => {
  const f = await setup(t); const budget = await f.open(); const fixture = mindFixture();
  const adapter = nativeAdapter({ countText: () => 50000,
    complete: async () => ({ text: responseText, usage: nativeUsage() }) });
  const result = await fixture.makeMind(budget, adapter).decide();
  assert.equal(result.ok, true);
  assert.equal(fixture.state.orders.length, 1);
  assert.equal((await f.open()).snapshot.totals.confirmedTokens, 42);
});

test('native mind fences a settled response after budget revocation while retaining metering', async (t) => {
  const f = await setup(t); const budget = await f.open(); const fixture = mindFixture();
  const started = deferred(), answer = deferred();
  const resultPromise = fixture.makeMind(budget, nativeAdapter({ complete: async () => { started.resolve(); return answer.promise; } })).decide();
  await started.promise;
  const before = await f.admin.inspect();
  assert.equal((await f.admin.configure({ expectedRevision: before.snapshot.persistence.revision, enabled: false, limits })).ok, true);
  answer.resolve({ text: responseText, usage: nativeUsage() });
  const result = await resultPromise;
  assert.equal(result.why, 'budget_revoked');
  assert.equal(fixture.state.orders.length, 0);
  assert.equal((await f.open()).snapshot.entries[0].usageSource, 'adapter_native');
});

test('native event hash and policy tampering invalidate replay', async (t) => {
  for (const tamper of ['event_hash', 'policy']) await t.test(tamper, async (st) => {
    const f = await setup(st); const budget = await f.open();
    assert.equal((await budget.reserve(nativeReservation('tamper-1'))).ok, true);
    const file = path.join(f.directory, 'inference-budget.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (tamper === 'event_hash') state.events[0].meteringSha256 = '0'.repeat(64);
    else state.metering.inputNanoUsdPerToken += 1;
    await fs.writeFile(file, JSON.stringify(state));
    assert.equal((await f.admin.inspect()).why, 'budget_invalid_state');
  });
});

test('legacy v1 ledger remains simulated and cannot be opened with native adapter identity', async (t) => {
  const f = await setup(t, { native: false }); const budget = await f.open();
  assert.equal(budget.snapshot.persistence.schema, 'agent-inference-budget/v1');
  assert.equal(budget.snapshot.persistence.unit, 'simulated_cost_units');
  assert.throws(() => budget.assertAdapter(nativeAdapter()), /budget_adapter_mismatch/);
  assert.equal((await budget.reserve(nativeReservation('native-on-v1'))).why, 'invalid_reservation');
  const reservation = { requestId: 'legacy-1', kind: 'decision', inputTokens: 5, outputTokens: 2,
    maxCostUnits: 11, countMode: 'simulated_tokens' };
  assert.equal((await budget.reserve(reservation)).ok, true);
  assert.equal((await budget.markDispatched('legacy-1')).ok, true);
  const settled = await budget.settle('legacy-1', { inputTokens: 5, outputTokens: 2, costUnits: 6 });
  assert.equal(settled.ok, true);
  assert.equal(settled.snapshot.entries.find((entry) => entry.requestId === 'legacy-1').usageSource, 'adapter_simulated');
  const reopened = await f.open();
  assert.equal(reopened.snapshot.persistence.schema, 'agent-inference-budget/v1');
  assert.equal(reopened.snapshot.metering, undefined);
  assert.equal(reopened.snapshot.entries.find((entry) => entry.requestId === 'legacy-1').usageSource, 'adapter_simulated');
});

test('manage-budget CLI initializes, inspects, configures, and manually reconciles native v2 without claiming invoice evidence', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-native-budget-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const period = { startsAtMs: 0, endsAtMs: Number.MAX_SAFE_INTEGER };
  const initialized = await runBudgetCli(directory, { type: 'initialize_native', allowanceId: 'native-cli', period, limits, metering });
  assert.equal(initialized.ok, true);
  assert.equal(initialized.snapshot.persistence.schema, 'agent-inference-budget/v2');
  assert.equal(initialized.snapshot.persistence.unit, 'nano_usd');
  assert.equal(initialized.snapshot.persistence.invoiceConfirmed, false);
  assert.equal((await runBudgetCli(directory, { type: 'inspect' })).snapshot.meteringSha256, meteringHash(metering));
  assert.equal((await runBudgetCli(directory, { type: 'configure', expectedRevision: 0, enabled: true, limits })).ok, true);

  const admin = createBudgetAdministration({ directory, scope });
  assert.equal((await admin.reserve(nativeReservation('cli-native'))).ok, true);
  assert.equal((await admin.markDispatched('cli-native')).ok, true);
  assert.equal((await admin.markUnknown('cli-native', 'usage_unknown')).ok, true);
  const reconciled = await runBudgetCli(directory, { type: 'reconcile', requestId: 'cli-native', usage: nativeUsage() });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.snapshot.entries[0].usageSource, 'owner_supplied');
  assert.equal(reconciled.snapshot.entries[0].usage.costUnits, 134);
  assert.equal(reconciled.snapshot.entries[0].invoiceCostUnits, null);
  assert.equal(reconciled.snapshot.persistence.invoiceConfirmed, false);
});

test('owner panel masks native v2 and refuses configure/start/think without invoking lab runner', async (t) => {
  const calls = [];
  const runner = {
    async inspect() { calls.push('inspect'); return { state: 'stopped' }; },
    async start() { calls.push('start'); return { ok: true }; },
    async think() { calls.push('think'); return { ok: true }; },
    async stop() { calls.push('stop'); return { ok: true }; },
    async close() { calls.push('close'); },
  };
  const base = await nativePanelSetup(t, runner);
  const viewResponse = await panelRequest(base, 'view');
  assert.equal(viewResponse.status, 200);
  const view = await viewResponse.json();
  assert.equal(view.ok, true);
  assert.deepEqual(view.budget, { ok: false, why: 'native_budget_panel_unsupported' });
  assert.equal(JSON.stringify(view).includes('nano_usd'), false);
  assert.equal(JSON.stringify(view).includes('simulated_cost_units'), false);

  for (const route of ['configure', 'start', 'think']) {
    const response = await panelRequest(base, route, { method: 'POST', body: route === 'configure' ? {
      expectedRevision: 0, enabled: false, limits,
    } : {} });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, why: 'native_budget_panel_unsupported' });
  }
  assert.equal(calls.includes('start'), false);
  assert.equal(calls.includes('think'), false);
  assert.equal(calls.some((call) => call === 'configure'), false);
  const stopped = await panelRequest(base, 'stop', { method: 'POST', body: {} });
  assert.equal(stopped.status, 200);
  assert.equal(calls.includes('stop'), true);
});

test('native AgentMind requires a persistent budget that is pinned to the adapter policy', async (t) => {
  const fixture = mindFixture();
  const local = new InferenceBudget({ scope, limits });
  assert.throws(() => fixture.makeMind(local, nativeAdapter()), /native_metering_requires_durable_budget/);
});

test('native response with valid usage settles even when generated JSON is malformed', async (t) => {
  const f = await setup(t); const budget = await f.open(); const fixture = mindFixture();
  const result = await fixture.makeMind(budget, nativeAdapter({ complete: async () => ({ text: 'not json', usage: nativeUsage() }) })).decide();
  assert.equal(result.why, 'invalid_decision');
  assert.equal(fixture.state.orders.length, 0);
  const persisted = await f.open();
  assert.equal(persisted.snapshot.totals.unknownEntries, 0);
  assert.equal(persisted.snapshot.totals.confirmedTokens, 42);
  assert.equal(persisted.snapshot.entries[0].usageSource, 'adapter_native');
});

test('removing adapter metering during completion cannot downgrade native settlement or usage accounting', async (t) => {
  const f = await setup(t); const budget = await f.open(); const fixture = mindFixture();
  const adapter = nativeAdapter({ countText: () => 50000,
    complete: async () => {
      delete adapter.metering;
      return { text: responseText, usage: nativeUsage() };
    } });
  const result = await fixture.makeMind(budget, adapter).decide();
  assert.equal(result.why, 'inference_error');
  assert.equal(fixture.state.orders.length, 0);
  const persisted = await f.open();
  assert.equal(persisted.snapshot.totals.confirmedTokens, 42);
  assert.equal(persisted.snapshot.entries[0].usageSource, 'adapter_native');
  assert.equal(persisted.snapshot.meteringSha256, meteringHash(metering));
});

test('native replay rejects a schema accessor without invoking it', async (t) => {
  const f = await setup(t);
  const stored = JSON.parse(await fs.readFile(path.join(f.directory, 'inference-budget.json'), 'utf8'));
  let getterCalls = 0;
  Object.defineProperty(stored, 'schema', { enumerable: true, get() { getterCalls++; return 'agent-inference-budget/v2'; } });
  assert.throws(() => replayPersistentBudget(stored, scope), /budget_invalid_state/);
  assert.equal(getterCalls, 0);
});
