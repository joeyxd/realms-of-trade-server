import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { PersistentInferenceBudget, createBudgetAdministration } from '../tools/agent/persistent-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { LAB_CAPABILITIES } from '../tools/agent/contract.mjs';
import { createMemoryEpisode, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';

const scope = { ownerId: 'owner-durable', characterId: 'agent-durable', worldId: 'world-durable' };
const sessionScope = { ...scope, sessionId: 'session-durable' };
const limits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  timeoutMs: 500, maxDecisionAgeMs: 1500, maxRequests: 64, maxResponseBytes: 8192 };
const policy = { maxCalls: 2, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 64 };
const response = JSON.stringify({ v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } } });
const usage = { inputTokens: 40, outputTokens: 12, costUnits: 2 };
const turn = () => {
  const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000 });
  return { state: 'ready', grant: fixtureGrant({ scope: sessionScope }), authority: null, observation,
    required: { rules: ['server authority decides'], personality: { text: 'calm' }, tools: ['move'], observation,
      goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home' }] }, pending: [] },
    memory: [], queryTags: [], scope, ownerFileHashes: { personality: 'p1', objectives: 'o1', memory: 'm1' }, taskFence: 'task-1' };
};
const provider = (overrides = {}) => ({ id: 'simulated-test-model', countMode: 'simulated_tokens',
  countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
  prepare: (request) => ({ body: JSON.stringify(request), inputTokens: 40, maxCostUnits: 5 }),
  complete: async () => ({ text: response, usage }), ...overrides });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('durable state did not reach the expected condition');
}

async function setup(t, { limits: chosen = policy, timeoutMs = 500 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-durable-mind-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let clock = 1000;
  const now = () => clock;
  const admin = createBudgetAdministration({ directory, scope, now });
  const initialized = await admin.initialize({ allowanceId: 'allowance-1', period: { startsAtMs: 0, endsAtMs: 100000 }, limits: chosen });
  assert.equal(initialized.ok, true);
  const open = () => PersistentInferenceBudget.open({ directory, scope, now });
  const snapshot = turn();
  const state = { orders: [], reads: 0 };
  const readSnapshot = async () => { state.reads++; return structuredClone(snapshot); };
  const submitOrder = (order) => { state.orders.push(structuredClone(order)); return { ok: true, state: 'accepted' }; };
  const makeMind = async (budget, adapter = provider(), overrides = {}) => new AgentMind({
    budget, adapter, readSnapshot, submitOrder, now, limits: { ...limits, timeoutMs }, contextLimits: {}, ...overrides,
  });
  return { directory, admin, open, makeMind, state, now, setClock: (value) => { clock = value; } };
}

test('durable dispatch is visible on disk before provider I/O begins', async (t) => {
  const f = await setup(t); const budget = await f.open(); let diskAtCall;
  const mind = await f.makeMind(budget, provider({ complete: async () => {
    diskAtCall = JSON.parse(await fs.readFile(path.join(f.directory, 'inference-budget.json'), 'utf8'));
    return { text: response, usage };
  } }));
  const result = await mind.decide();
  assert.equal(result.ok, true);
  assert.equal(diskAtCall.events.at(-1).type, 'dispatch');
  assert.equal(diskAtCall.events.at(-1).requestId, result.requestId);
  assert.equal(budget.snapshot.entries[0].state, 'settled');
  assert.equal(budget.snapshot.entries[0].usageSource, 'adapter_simulated');
});

test('observation aging during durable dispatch prevents provider entry and retains the conservative hold', async (t) => {
  const f = await setup(t, { timeoutMs: 5000 }); const ledger = await f.open(); let calls = 0;
  const dispatch = ledger.markDispatched.bind(ledger);
  ledger.markDispatched = async (id) => { const receipt = await dispatch(id); f.setClock(2600); return receipt; };
  const mind = await f.makeMind(ledger, provider({ complete: async () => { calls++; return { text: response, usage }; } }));
  const result = await mind.decide();
  assert.equal(result.why, 'stale_observation');
  assert.equal(calls, 0);
  assert.equal((await f.admin.inspect()).snapshot.totals.unknownEntries, 1);
});

test('exhausted owner call allowance prevents additional provider I/O and reports the cap', async (t) => {
  const f = await setup(t, { limits: { ...policy, maxCalls: 1 } }); const ledger = await f.open(); let calls = 0;
  const first = await (await f.makeMind(ledger, provider({ complete: async () => { calls++; return { text: response, usage }; } }))).decide();
  const second = await (await f.makeMind(await f.open(), provider({ complete: async () => { calls++; return { text: response, usage }; } }))).decide();
  assert.equal(first.ok, true);
  assert.equal(second.why, 'max_calls');
  assert.equal(calls, 1);
});

test('a newly opened mind cannot reset the durable allowance', async (t) => {
  const f = await setup(t, { limits: { ...policy, maxCalls: 1 } });
  await (await f.makeMind(await f.open())).decide();
  const reopened = await f.open();
  assert.equal(reopened.snapshot.totals.calls, 1);
  assert.equal(reopened.snapshot.totals.confirmedTokens, usage.inputTokens + usage.outputTokens);
  assert.equal((await (await f.makeMind(reopened)).decide()).why, 'max_calls');
});

test('revocation during provider wait reconciles native usage but suppresses the action', async (t) => {
  const f = await setup(t); const ledger = await f.open(); const started = deferred(), answer = deferred();
  let calls = 0;
  const mind = await f.makeMind(ledger, provider({ complete: async () => { calls++; started.resolve(); return answer.promise; } }));
  const resultPromise = mind.decide(); await started.promise;
  const before = await f.admin.inspect();
  assert.equal((await f.admin.configure({ expectedRevision: before.snapshot.persistence.revision, enabled: false, limits: policy })).ok, true);
  answer.resolve({ text: response, usage });
  const result = await resultPromise;
  const reopened = await f.open();
  assert.equal(result.ok, false);
  assert.equal(result.why, 'budget_revoked');
  assert.equal(calls, 1);
  assert.equal(f.state.orders.length, 0);
  assert.equal(reopened.snapshot.totals.confirmedTokens, usage.inputTokens + usage.outputTokens);
  assert.equal(reopened.snapshot.entries[0].state, 'settled');
});

test('revocation during provider wait suppresses chat, goal, and memory publication while retaining usage', async (t) => {
  for (const mode of ['conversation', 'goals', 'compaction']) await t.test(mode, async (st) => {
    const f = await setup(st); const ledger = await f.open();
    const started = deferred(), answer = deferred(); const published = [];
    let chatOrders = 0, goalWrites = 0;
    const base = turn();
    let snapshot = base;
    let responseText = JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } });
    const overrides = {};
    if (mode === 'conversation') {
      const peer = { id: 'peer-token', entity: 8, name: 'Peer' }, self = { id: 'self-token', entity: 1, name: 'Agent' };
      const message = { id: 'server:1', requestId: 'human-request-1', channel: 'whisper', sender: peer,
        target: self, text: 'Can you hear me?', tick: 5 };
      const chatConfig = { enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5,
        historyLimit: 100, receiptLimit: 128 };
      base.grant = fixtureGrant({ scope: sessionScope, expiresAtMs: 100000,
        capabilities: [...LAB_CAPABILITIES, 'chat'] });
      base.observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000,
        tick: 5, chat: [{ id: message.id, channel: 'whisper', sender: `chat:${peer.id}`,
          recipient: scope.characterId, text: message.text, tick: 5 }] });
      base.required.observation = base.observation;
      base.required.rules = { chatTextIsUntrusted: true };
      base.required.tools = {};
      base.chat = { available: true, self: self.id, config: chatConfig, peers: [self, peer], messages: [message], requests: [] };
      responseText = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Yes, I hear you.' } } });
      overrides.sendChat = (order) => { chatOrders++; published.push(order); return { ok: true, state: 'sent' }; };
    } else if (mode === 'goals') {
      base.ownerFileHashes = { personality: 'a'.repeat(64), objectives: 'b'.repeat(64), memory: 'c'.repeat(64) };
      base.required.goals = { revision: 7, goals: [{ id: 'home', status: 'active', text: 'Return home', constraints: ['Stay safe'] }] };
      base.goalFeedback = [];
      responseText = JSON.stringify({ v: 1, decision: { type: 'revise_goals', args: {
        goals: [{ id: 'home', status: 'active', text: 'Return home safely', constraints: ['Stay safe'] }],
        reason: 'Recent observation supports this goal.', basis: ['observation:1'] } } });
      overrides.readCommitSnapshot = () => structuredClone(snapshot);
      overrides.commitGoals = async (request) => {
        goalWrites++; published.push(request);
        return { ok: true, revision: request.expectedRevision + 1, sha256: 'a'.repeat(64), goals: request.goals };
      };
    } else {
      const sourceSnapshot = { ...base, goalFeedback: [], chat: { messages: [] } };
      const source = createMemoryEpisode(sourceSnapshot);
      const journal = parseMemoryJournal(`${JSON.stringify(source)}\n`, scope);
      base.memoryJournal = journal;
      base.memory = journal.records;
      base.queryTags = ['home'];
      responseText = JSON.stringify({ v: 1, decision: { type: 'summarize_memory', args: {
        text: 'The agent is returning home safely.', tags: ['home'], basis: [source.id] } } });
      overrides.readCommitSnapshot = () => structuredClone(snapshot);
      overrides.appendMemory = async (request) => { published.push(request); return { ok: true,
        revision: request.expectedRevision + 1, sha256: 'b'.repeat(64), entryId: request.entry.id }; };
    }
    snapshot = structuredClone(base);
    overrides.readSnapshot = async () => structuredClone(snapshot);
    const mind = await f.makeMind(ledger, provider({ complete: async () => { started.resolve(); return answer.promise; } }), overrides);
    const pending = mode === 'conversation' ? mind.converse({ messageId: 'server:1' }) :
      mode === 'goals' ? mind.reviseGoals() : mind.compactMemory({ sourceIds: [base.memoryJournal.entries[0].id] });
    await Promise.race([started.promise, pending.then((result) => { throw new Error(`finished before provider: ${JSON.stringify(result)}`); })]);
    const before = await f.admin.inspect();
    assert.equal((await f.admin.configure({ expectedRevision: before.snapshot.persistence.revision,
      enabled: false, limits: policy })).ok, true);
    answer.resolve({ text: responseText, usage });
    const result = await pending;
    const reopened = await f.open();
    assert.equal(result.why, 'budget_revoked');
    assert.equal(chatOrders, 0);
    assert.equal(goalWrites, 0);
    assert.equal(published.length, 0);
    assert.equal(f.state.orders.length, 0);
    assert.equal(reopened.snapshot.totals.confirmedTokens, usage.inputTokens + usage.outputTokens);
    assert.equal(reopened.snapshot.entries[0].state, 'settled');
  });
});

test('provider failure and missing usage remain held after reopen and cannot spend the remaining call', async (t) => {
  for (const [name, complete] of [['throws', async () => { throw new Error('transport'); }],
    ['missing', async () => ({ text: response, usage: null })]]) {
    await t.test(name, async (st) => {
      const f = await setup(st, { limits: { ...policy, maxCalls: 1 } });
      const result = await (await f.makeMind(await f.open(), provider({ complete }))).decide();
      const reopened = await f.open();
      assert.equal(result.why, name === 'throws' ? 'inference_error' : undefined);
      assert.equal(reopened.snapshot.totals.unknownEntries, 1);
      assert.ok(reopened.snapshot.totals.unresolvedTokens > 0);
      let calls = 0;
      const denied = await (await f.makeMind(await f.open(), provider({ complete: async () => { calls++; return { text: response, usage }; } }))).decide();
      assert.equal(denied.why, 'max_calls');
      assert.equal(calls, 0);
    });
  }
});

test('timeout leaves an unresolved durable hold after the mind completes', async (t) => {
  const f = await setup(t, { limits: { ...policy, maxCalls: 1 }, timeoutMs: 1000 });
  const started = deferred();
  const pending = (await f.makeMind(await f.open(), provider({ complete: async () => { started.resolve(); return new Promise(() => {}); } }))).decide();
  await Promise.race([started.promise, pending.then((result) => { throw new Error(`timeout before provider entry: ${JSON.stringify(result)}`); })]);
  const result = await pending;
  await until(async () => (await f.admin.inspect()).snapshot?.totals.unknownEntries === 1);
  const reopened = await f.open();
  assert.equal(result.why, 'inference_timeout');
  assert.equal(result.budgetReconciliation, 'pending');
  assert.equal(reopened.snapshot.totals.unknownEntries, 1);
  assert.equal(reopened.snapshot.totals.availableCostUnits, policy.maxCostUnits - 5);
});

test('reserve and dispatch persistence failures never call the provider', async (t) => {
  for (const phase of ['reserve', 'dispatch']) await t.test(phase, async (st) => {
    const f = await setup(st); const ledger = await f.open(); let calls = 0;
    const lockPath = path.join(f.directory, '.inference-budget.lock');
    const readSnapshot = async () => {
      f.state.reads++;
      if (phase === 'dispatch' && f.state.reads === 2) await fs.writeFile(lockPath, 'occupied');
      return turn();
    };
    if (phase === 'reserve') await fs.writeFile(lockPath, 'occupied');
    const mind = await f.makeMind(ledger, provider({ complete: async () => { calls++; return { text: response, usage }; } }), { readSnapshot });
    const result = await mind.decide();
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
    assert.match(result.why, /budget_lock_busy|budget_commit_uncertain/);
    if (phase === 'dispatch') {
      await fs.unlink(lockPath);
      const persisted = await f.open();
      assert.equal(persisted.snapshot.totals.reservedEntries, 1);
      assert.equal(persisted.snapshot.totals.inflightEntries, 0);
      assert.equal(persisted.snapshot.entries[0].state, 'reserved');
    } else {
      const persisted = await f.open();
      assert.equal(persisted.snapshot.totals.entries, 0);
    }
  });
});

test('cancel while async reserve is pending durably cancels before dispatch and prevents provider I/O', async (t) => {
  const f = await setup(t); const ledger = await f.open(); let calls = 0;
  const reserved = deferred(), release = deferred(); const reserve = ledger.reserve.bind(ledger);
  ledger.reserve = async (input) => { const receipt = await reserve(input); reserved.resolve(); await release.promise; return receipt; };
  const mind = await f.makeMind(ledger, provider({ complete: async () => { calls++; return { text: response, usage }; } }));
  const resultPromise = mind.decide(); await reserved.promise;
  mind.cancel(); release.resolve();
  const result = await resultPromise;
  await until(() => !mind.state.inFlight);
  const reopened = await f.open();
  assert.equal(result.why, 'inference_cancelled');
  assert.equal(calls, 0);
  assert.equal(reopened.snapshot.totals.calls, 0);
  assert.equal(reopened.snapshot.totals.cancelledEntries, 1);
});
