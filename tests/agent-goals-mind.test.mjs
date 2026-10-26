import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';

const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'lab-world' };
const sessionScope = { ...scope, sessionId: 'lab-session-1' };
const hashes = Object.fromEntries(['personality', 'objectives', 'memory'].map((key, i) => [key, String(i + 1).repeat(64)]));
const initialGoals = [{ id: 'gather-wood', status: 'active', text: 'Gather local wood', constraints: ['Stay near the shore'] }];
const required = { rules: ['server authority decides'], personality: { text: 'calm' }, tools: ['move', 'wait'],
  observation: { revision: 1 }, goals: { revision: 7, goals: initialGoals }, pending: [] };
const limits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  timeoutMs: 1000, maxDecisionAgeMs: 1500, maxRequests: 64, maxResponseBytes: 8192 };
const budget = (overrides = {}) => new InferenceBudget({ scope, limits: {
  maxCalls: 64, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 64, ...overrides,
} });
const response = (decision) => JSON.stringify({ v: 1, decision });
const validProposal = (revision = 1) => ({ type: 'revise_goals', args: { goals: [
  { id: 'gather-wood', status: 'active', text: 'Gather enough local wood', constraints: ['Stay near the shore'] },
], reason: 'The last observation shows the task is still underway.', basis: [`observation:${revision}`] } });
function adapter(overrides = {}) {
  return { id: 'test-model', countMode: 'simulated_tokens', countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: (request) => ({ body: JSON.stringify(request), inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4), maxCostUnits: 5 }),
    complete: async () => ({ text: response(validProposal()), usage: { inputTokens: 100, outputTokens: 20, costUnits: 2 } }), ...overrides };
}
function fixture(overrides = {}) {
  const observation = fixtureObservation({ scope: sessionScope, source: 'server' });
  const state = { value: { state: 'ready', grant: fixtureGrant({ scope: sessionScope }), authority: null,
    observation, required: { ...structuredClone(required), observation }, goalFeedback: [], memory: [], queryTags: [],
    scope: { ...scope }, ownerFileHashes: { ...hashes }, taskFence: 'task-1' }, reads: 0, commits: [], orders: [], clock: 1000 };
  const readCommitSnapshot = () => structuredClone(state.value);
  const commitGoals = async (request) => {
    state.commits.push(structuredClone({ ...request, guard: undefined }));
    const guard = request.guard();
    if (!guard?.ok) return { ok: false, why: guard?.why ?? 'guard_rejected' };
    const revision = request.expectedRevision + 1;
    const receipt = { ok: true, revision, sha256: 'a'.repeat(64), goals: structuredClone(request.goals) };
    state.value.required.goals = { revision, goals: structuredClone(request.goals) };
    return receipt;
  };
  return { state, readSnapshot: async () => { state.reads++; return structuredClone(state.value); },
    readCommitSnapshot, commitGoals, submitOrder: (order) => { state.orders.push(structuredClone(order)); return { ok: true }; }, now: () => state.clock, ...overrides };
}
function mind(f, options = {}) {
  return new AgentMind({ ...f, adapter: adapter(), budget: budget(), limits, contextLimits: {}, ...options });
}

test('reviseGoals pins exact owner goals and selected feedback in required.tools.goalRevision', async () => {
  const f = fixture(); let providerBody;
  f.state.value.goalFeedback = [{ id: 'action:action-1', kind: 'action', actionId: 'action-1', state: 'confirmed',
    inputAck: true, effects: [], result: null, body: null, navigation: null,
    interpretation: 'ACK is receipt only; partial effects and absent targets do not prove an encounter completed' }];
  const result = await mind(f, { adapter: adapter({ complete: async ({ body }) => {
    providerBody = JSON.parse(body);
    return { text: response({ type: 'wait', args: {} }), usage: { inputTokens: 10, outputTokens: 3, costUnits: 1 } };
  } }) }).reviseGoals();
  assert.equal(result.ok, true);
  const turn = providerBody.context.required.tools.goalRevision;
  assert.equal(turn.v, 1);
  assert.equal(turn.expectedRevision, 7);
  assert.deepEqual(turn.beforeGoals, initialGoals);
  assert.deepEqual(turn.feedback.map((item) => item.id), ['observation:1', 'action:action-1']);
  assert.equal(f.state.commits.length, 0);
});

test('valid goal proposal commits only through the synchronous final guard and verifies the receipt', async () => {
  const f = fixture();
  const result = await mind(f, { adapter: adapter({ complete: async () => ({ text: response(validProposal()),
    usage: { inputTokens: 10, outputTokens: 3, costUnits: 1 } }) }) }).reviseGoals();
  assert.equal(result.ok, true);
  assert.equal(result.objective.revision, 8);
  assert.equal(f.state.commits.length, 1);
  assert.equal(f.state.commits[0].expectedRevision, 7);
  assert.deepEqual(f.state.commits[0].expectedHashes, hashes);
  assert.deepEqual(f.state.commits[0].goals, validProposal().args.goals);
  assert.equal(f.state.value.required.goals.revision, 8);
});

test('goal revision is disabled without both trusted commit callbacks', async () => {
  const f = fixture({ commitGoals: null, readCommitSnapshot: null }); let calls = 0;
  const result = await mind(f, { adapter: adapter({ complete: async () => {
    calls++; return { text: response(validProposal()), usage: null };
  } }) }).reviseGoals();
  assert.equal(result.why, 'goals_disabled');
  assert.equal(calls, 0);
});

test('wait and malformed or ungrounded proposals never write owner goals', async (t) => {
  const malformed = [
    { ...validProposal(), surprise: true },
    { type: 'revise_goals', controlRevision: 2, args: validProposal().args },
    { type: 'move', args: { mx: 1, mz: 0, durationMs: 250 } },
    { type: 'revise_goals', args: { ...validProposal().args, basis: ['invented-feedback'] } },
    { type: 'revise_goals', args: { ...validProposal().args, revision: 7 } },
    { type: 'revise_goals', args: { ...validProposal().args, channel: 'whisper' } },
    { type: 'revise_goals', args: { ...validProposal().args, body: { mode: 'aggressive' } } },
    { type: 'revise_goals', args: { ...validProposal().args, goals: [{ ...validProposal().args.goals[0], status: 'completed' }] } },
    { type: 'revise_goals', args: { ...validProposal().args, goals: [{ ...validProposal().args.goals[0], text: 'Use api_key=secret123456789' }] } },
  ];
  for (const [name, decision] of [['wait', { type: 'wait', args: {} }], ...malformed.map((d, i) => [`invalid ${i}`, d])])
    await t.test(name, async () => {
      const f = fixture();
      const result = await mind(f, { adapter: adapter({ complete: async () => ({ text: response(decision),
        usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } }) }) }).reviseGoals();
      if (decision.type === 'wait') assert.equal(result.ok, true);
      else assert.equal(result.ok, false);
      assert.equal(f.state.commits.length, 0);
      assert.equal(f.state.orders.length, 0);
    });
});

test('owner task and authority changes after inference reject commit', async (t) => {
  const mutations = [
    ['objective revision', (s) => { s.required.goals.revision++; }],
    ['owner file hash', (s) => { s.ownerFileHashes.objectives = 'b'.repeat(64); }],
    ['task fence', (s) => { s.taskFence = 'task-2'; }],
    ['control revision', (s) => { s.grant.controlRevision++; s.observation.controlRevision++; s.required.observation = structuredClone(s.observation); }],
    ['direct owner priority', (s) => { s.authority = { state: 'active', task: { priority: 'direct' } }; }],
    ['death', (s) => { s.observation.confirmed.self.dead = true; s.required.observation = structuredClone(s.observation); }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const f = fixture();
    const result = await mind(f, { adapter: adapter({ complete: async () => {
      mutate(f.state.value); return { text: response(validProposal()), usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } };
    } }) }).reviseGoals();
    assert.equal(result.ok, false);
    assert.equal(f.state.commits.length, 0);
  });
});

test('expired grant and stale observation after inference prevent goal commit', async (t) => {
  for (const [name, mutate] of [
    ['expired grant', (s, clock) => { s.grant.expiresAtMs = clock; }],
    ['stale observation', (s, clock) => { s.observation.receivedAtMs = clock - 2000; s.required.observation = structuredClone(s.observation); }],
  ]) await t.test(name, async () => {
    const f = fixture();
    const result = await mind(f, { adapter: adapter({ complete: async () => {
      mutate(f.state.value, f.state.clock); return { text: response(validProposal()), usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } };
    } }) }).reviseGoals();
    assert.equal(result.ok, false);
    assert.equal(f.state.commits.length, 0);
  });
});

test('missing or mismatched commit receipt makes uncertainty sticky and preserves mandatory pending context', async () => {
  const f = fixture({ commitGoals: async () => { throw new Error('commit result unavailable'); } });
  let body; let calls = 0;
  const m = mind(f, { adapter: adapter({ complete: async ({ body: b }) => {
    if (++calls === 1) return { text: response(validProposal()), usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } };
    body = JSON.parse(b); return { text: response({ type: 'wait', args: {} }), usage: null };
  } }) });
  const first = await m.reviseGoals();
  assert.equal(first.why, 'objective_commit_uncertain');
  assert.equal((await m.reviseGoals()).why, 'objective_commit_uncertain');
  await m.decide();
  assert.ok(body.context.required.pending.some((item) => item.kind === 'objective_commit' && item.retryAllowed === false));
});

test('an invalid successful receipt is uncertain and is never retried', async () => {
  const f = fixture({ commitGoals: async () => ({ ok: true, revision: 999, sha256: 'c'.repeat(64), goals: [] }) });
  const m = mind(f, { adapter: adapter({ complete: async () => ({ text: response(validProposal()),
    usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } }) }) });
  assert.equal((await m.reviseGoals()).why, 'objective_commit_uncertain');
  assert.equal((await m.reviseGoals()).why, 'objective_commit_uncertain');
  assert.equal(f.state.commits.length, 0);
});

test('owner stop during commit keeps the write pending, then exposes its late receipt without retry', async () => {
  let finishCommit; let writes = 0; let beginCommit;
  const started = new Promise((resolve) => { beginCommit = resolve; });
  const f = fixture({ commitGoals: (request) => {
    const guard = request.guard();
    assert.equal(guard.ok, true);
    writes++;
    const revision = request.expectedRevision + 1;
    f.state.value.required.goals = { revision, goals: structuredClone(request.goals) };
    beginCommit();
    return new Promise((resolve) => { finishCommit = () => resolve({ ok: true, revision, sha256: 'd'.repeat(64),
      goals: structuredClone(request.goals) }); });
  } });
  const m = mind(f, { adapter: adapter({ complete: async () => ({ text: response(validProposal()),
    usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } }) }) });
  const pending = m.reviseGoals();
  await started;
  f.state.value.state = 'stopped';
  m.cancel();
  const interrupted = await pending;
  assert.equal(interrupted.why, 'inference_cancelled');
  assert.equal(interrupted.objective.state, 'uncertain');
  assert.equal(m.state.goals.submissionUncertain, true);
  assert.equal((await m.reviseGoals()).why, 'objective_commit_uncertain');
  assert.equal((await m.decide()).why, 'inference_busy');
  assert.equal(writes, 1);
  finishCommit();
  for (let i = 0; i < 10 && !m.state.records[0].lateObjective; i++) await new Promise((r) => setTimeout(r, 0));
  const record = m.state.records[0];
  assert.equal(record.lateObjective.state, 'committed');
  assert.equal(record.lateObjective.afterInterruption, true);
  assert.equal(record.lateObjective.revision, 8);
  assert.equal(record.lateObjective.gameplaySuccess, false);
  assert.equal(m.state.goals.submissionUncertain, false);
  assert.equal(writes, 1);
});

test('interrupted commit with unknown late outcome remains sticky and visible', async () => {
  let failCommit; let beginCommit;
  const started = new Promise((resolve) => { beginCommit = resolve; });
  const f = fixture({ commitGoals: (request) => {
    assert.equal(request.guard().ok, true);
    beginCommit();
    return new Promise((_, reject) => { failCommit = () => reject(new Error('commit result unavailable')); });
  } });
  const m = mind(f, { adapter: adapter({ complete: async () => ({ text: response(validProposal()),
    usage: { inputTokens: 5, outputTokens: 2, costUnits: 1 } }) }) });
  const pending = m.reviseGoals();
  await started;
  m.cancel();
  await pending;
  failCommit();
  for (let i = 0; i < 10 && !m.state.records[0].lateObjective; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(m.state.records[0].lateObjective.state, 'uncertain');
  assert.equal(m.state.records[0].lateObjective.retryAllowed, false);
  assert.equal(m.state.goals.submissionUncertain, true);
  assert.equal((await m.reviseGoals()).why, 'objective_commit_uncertain');
});

test('same flight, timeout, cancellation, and usage settlement apply to goal turns', async () => {
  let resolve; let completed = 0;
  const f = fixture(); const ledger = budget();
  const m = mind(f, { budget: ledger, sendChat: () => ({ ok: true }), limits: { ...limits, timeoutMs: 25 }, adapter: adapter({ complete: () => {
    completed++; return new Promise((r) => { resolve = r; });
  } }) });
  const first = m.reviseGoals();
  while (!resolve) await new Promise((r) => setTimeout(r, 0));
  assert.equal((await m.converse({ messageId: 'msg-1' })).why, 'inference_busy');
  assert.equal((await first).why, 'inference_timeout');
  resolve({ text: response(validProposal()), usage: { inputTokens: 2, outputTokens: 1, costUnits: 1 } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.state.commits.length, 0);
  assert.equal(ledger.snapshot.totals.confirmedTokens, 3);
  assert.equal(completed, 1);
});

test('cancelled provider response reconciles native usage and never commits', async () => {
  let resolve; let entered = false;
  const f = fixture(); const ledger = budget();
  const m = mind(f, { budget: ledger, adapter: adapter({ complete: () => {
    entered = true; return new Promise((r) => { resolve = r; });
  } }) });
  const pending = m.reviseGoals();
  while (!entered) await new Promise((r) => setTimeout(r, 0));
  m.cancel();
  const result = await pending;
  assert.equal(result.why, 'inference_cancelled');
  resolve({ text: response(validProposal()), usage: { inputTokens: 7, outputTokens: 2, costUnits: 1 } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ledger.snapshot.totals.confirmedTokens, 9);
  assert.equal(f.state.commits.length, 0);
});

test('budget rejection occurs before provider I/O or commit', async () => {
  const f = fixture(); let calls = 0;
  const ledger = budget({ maxCalls: 1, maxTokens: 1, maxCostUnits: 1 });
  const result = await mind(f, { budget: ledger, adapter: adapter({ complete: async () => {
    calls++; return { text: response(validProposal()), usage: null };
  } }) }).reviseGoals();
  assert.equal(result.why, 'max_tokens');
  assert.equal(calls, 0);
  assert.equal(f.state.commits.length, 0);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('goal context over budget performs no provider call or reservation', async () => {
  const f = fixture(); const ledger = budget(); let calls = 0;
  const result = await mind(f, { budget: ledger, limits: { ...limits, maxInputBytes: 100 },
    adapter: adapter({ complete: async () => { calls++; return { text: response({ type: 'wait', args: {} }), usage: null }; } }) }).reviseGoals();
  assert.equal(result.why, 'required_context_over_budget');
  assert.equal(calls, 0);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('legacy files with more goals than the writer capacity cannot be silently reduced by inference', async () => {
  const f = fixture(); let calls = 0;
  f.state.value.required.goals.goals = Array.from({ length: 33 }, (_, i) => ({ ...initialGoals[0], id: `goal-${i}` }));
  const ledger = budget();
  const result = await mind(f, { budget: ledger, adapter: adapter({ complete: async () => {
    calls++; return { text: response(validProposal()), usage: null };
  } }) }).reviseGoals();
  assert.equal(result.why, 'goal_capacity');
  assert.equal(calls, 0);
  assert.equal(f.state.commits.length, 0);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('an existing completed objective may be preserved unchanged without claiming new gameplay success', async () => {
  const f = fixture();
  const completed = { id: 'owner-completed', status: 'completed', text: 'Owner-recorded completion', constraints: [] };
  f.state.value.required.goals.goals.push(completed);
  const decision = validProposal(); decision.args.goals.push(completed);
  const result = await mind(f, { adapter: adapter({ complete: async () => ({ text: response(decision),
    usage: { inputTokens: 10, outputTokens: 5, costUnits: 1 } }) }) }).reviseGoals();
  assert.equal(result.ok, true);
  assert.equal(result.objective.gameplaySuccess, false);
  assert.deepEqual(result.objective.goals.at(-1), completed);
});
