import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { buildMindContext } from '../tools/agent/mind-context.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { MIND_INSTRUCTIONS, MIND_RESPONSE_SCHEMA } from '../tools/agent/mind-contract.mjs';

const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'lab-world' };
const sessionScope = { ...scope, sessionId: 'lab-session-1' };
const required = {
  rules: ['server authority decides'], personality: { text: 'calm' }, tools: ['move', 'wait'],
  observation: { revision: 1 }, goals: { current: 'stay safe' }, pending: [],
};
const hashes = { personality: 'p1', objectives: 'o1', memory: 'm1' };
const snapshot = (overrides = {}) => {
  const observation = fixtureObservation({ scope: sessionScope, source: 'server' });
  return { state: 'ready', grant: fixtureGrant({ scope: sessionScope }), authority: null,
    observation, required: { ...structuredClone(required), observation }, memory: [], queryTags: [],
    scope: { ...scope }, ownerFileHashes: { ...hashes }, taskFence: 'task-1', ...overrides };
};
const limits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  timeoutMs: 1000, maxDecisionAgeMs: 1500, maxRequests: 64, maxResponseBytes: 8192 };
const budget = (overrides = {}) => new InferenceBudget({ scope, limits: {
  maxCalls: 64, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 64, ...overrides,
} });
const answer = (decision = { type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } }) => JSON.stringify({ v: 1, decision });
function adapter(overrides = {}) {
  return { id: 'test-model', countMode: 'simulated_tokens', countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: (request) => ({ body: JSON.stringify(request), inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4), maxCostUnits: 5 }),
    complete: async () => ({ text: answer(), usage: { inputTokens: 100, outputTokens: 20, costUnits: 2 } }), ...overrides };
}
const fixture = (overrides = {}) => {
  const state = { value: snapshot(), submits: [], reads: 0, clock: 1000 };
  return { state, readSnapshot: async () => { state.reads++; return structuredClone(state.value); },
    submitOrder: (order) => { state.submits.push(structuredClone(order)); return { ok: true, state: 'accepted', actionId: order.actionId }; },
    now: () => state.clock, ...overrides };
};

test('mind context measures exact provider wrapper and preserves the transmitted body', () => {
  const a = adapter();
  const result = buildMindContext({ snapshot: snapshot(), adapter: a, requestId: 'req-1', limits, nowMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.prepared.body, JSON.stringify({ v: 1, model: a.id, requestId: 'req-1',
    instructions: MIND_INSTRUCTIONS, responseSchema: MIND_RESPONSE_SCHEMA,
    context: result.document, maxOutputTokens: limits.maxOutputTokens }));
  assert.equal(result.report.transmittedBytes, Buffer.byteLength(result.prepared.body));
  assert.equal(result.report.inputTokens, a.prepare(JSON.parse(result.prepared.body)).inputTokens);
  assert.equal(result.report.countMode, a.countMode);
});

test('mind context rejects required content when the full wrapper exceeds limits', () => {
  const a = adapter();
  const result = buildMindContext({ snapshot: snapshot(), adapter: a, requestId: 'req-2',
    limits: { ...limits, maxInputBytes: 100 }, nowMs: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'required_context_over_budget');
});

test('mind context can use either a measured or estimated adapter without provider coupling', () => {
  for (const mode of ['measured_tokens', 'estimated_tokens']) {
    const result = buildMindContext({ snapshot: snapshot(), adapter: adapter({ id: `model-${mode}`, countMode: mode }),
      requestId: `req-${mode}`, limits, nowMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.report.countMode, mode);
  }
});

test('decide reserves usage before adapter I/O and accepts only a validated action', async () => {
  const f = fixture();
  let duringCall;
  const a = adapter({ complete: async ({ body }) => {
    duringCall = budgetRef.snapshot.totals.inflightEntries;
    assert.equal(typeof body, 'string');
    return { text: answer(), usage: { inputTokens: 100, outputTokens: 20, costUnits: 2 } };
  } });
  const budgetRef = budget();
  const mind = new AgentMind({ ...f, adapter: a, budget: budgetRef, limits, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(duringCall, 1);
  assert.equal(result.ok, true);
  assert.ok(result.action);
  assert.equal(f.state.submits.length, 1);
  assert.equal(f.state.submits[0].scope.sessionId, sessionScope.sessionId);
  assert.equal(f.state.submits[0].actionId, result.action.actionId);
  assert.equal(budgetRef.snapshot.totals.confirmedTokens, 120);
  assert.equal(budgetRef.snapshot.totals.unknownEntries, 0);
});

test('a throwing submitOrder reports an uncertain action and does not retry automatically', async () => {
  const f = fixture(); let completions = 0;
  const mind = new AgentMind({ ...f, submitOrder: () => { throw new Error('commit result unavailable'); },
    adapter: adapter({ complete: async () => { completions++; return { text: answer(),
      usage: { inputTokens: 10, outputTokens: 5, costUnits: 1 } }; } }),
    budget: budget(), limits, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(result.why, 'order_submission_uncertain');
  assert.equal(result.action.state, 'uncertain');
  assert.equal(result.action.actionId, result.requestId);
  assert.equal(completions, 1);
  assert.equal(f.state.submits.length, 0);
});

test('missing provider usage remains unresolved and never reports zero spend', async () => {
  const f = fixture(); const ledger = budget();
  const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => ({ text: answer(), usage: null }) }),
    budget: ledger, limits, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(result.ok, true);
  assert.equal(ledger.snapshot.totals.confirmedTokens, 0);
  assert.equal(ledger.snapshot.totals.unknownEntries, 1);
  assert.ok(ledger.snapshot.totals.unresolvedTokens > 0);
});

test('invalid provider response still reconciles known usage and creates no order', async () => {
  const f = fixture(); const ledger = budget();
  const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => ({ text: '```json\n{}\n```',
    usage: { inputTokens: 21, outputTokens: 4, costUnits: 1 } }) }), budget: ledger, limits, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(result.ok, false);
  assert.equal(f.state.submits.length, 0);
  assert.equal(ledger.snapshot.totals.confirmedTokens, 25);
  assert.equal(ledger.snapshot.totals.unknownEntries, 0);
});

test('response output token budget is enforced even when native usage is absent or underreports it', async (t) => {
  for (const usage of [null, { inputTokens: 10, outputTokens: 1, costUnits: 0 }]) await t.test(
    usage ? 'underreported native output usage' : 'missing native usage', async () => {
      const f = fixture(); const ledger = budget(); const text = answer();
      const a = adapter({ countText: (value) => value === text ? limits.maxOutputTokens + 1 : Math.ceil(Buffer.byteLength(value) / 4),
        complete: async () => ({ text, usage }) });
      const mind = new AgentMind({ ...f, adapter: a, budget: ledger, limits, contextLimits: {} });
      const result = await mind.decide();
      assert.equal(result.why, 'response_over_budget');
      assert.equal(f.state.submits.length, 0);
      if (usage) assert.equal(ledger.snapshot.totals.confirmedTokens, 11);
      else assert.equal(ledger.snapshot.totals.unknownEntries, 1);
    });
});

test('extra identity, control and capability fields in a response never reach submitOrder', async (t) => {
  const malformed = [
    { v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 100 } }, requestId: 'invented' },
    { v: 1, decision: { type: 'move', controlRevision: 99, args: { mx: 1, mz: 0, durationMs: 100 } } },
    { v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 100, scope: sessionScope } } },
    { v: 1, decision: { type: 'chat', args: { text: 'hello' } } },
  ];
  for (const response of malformed) await t.test(JSON.stringify(response), async () => {
    const f = fixture();
    const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => ({ text: JSON.stringify(response),
      usage: { inputTokens: 5, outputTokens: 5, costUnits: 1 } }) }), budget: budget(), limits, contextLimits: {} });
    await mind.decide();
    assert.equal(f.state.submits.length, 0);
  });
});

test('minimum context over budget avoids reservation and all adapter I/O', async () => {
  const f = fixture(); const ledger = budget(); let prepared = 0; let completed = 0;
  const a = adapter({ prepare: (req) => { prepared++; return { body: JSON.stringify(req), inputTokens: 100000, maxCostUnits: 1 }; },
    complete: async () => { completed++; return { text: answer(), usage: null }; } });
  const mind = new AgentMind({ ...f, adapter: a, budget: ledger, limits, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(result.ok, false);
  assert.equal(result.why, 'required_context_over_budget');
  assert.ok(prepared > 0, 'the pure adapter sizing hook may measure the candidate request');
  assert.equal(completed, 0);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('clock deadline reached synchronously during prepare skips paid provider I/O and reservation', async () => {
  const f = fixture(); const ledger = budget(); let completed = 0;
  const a = adapter({ prepare: (req) => {
    f.state.clock = 1050;
    return { body: JSON.stringify(req), inputTokens: 20, maxCostUnits: 2 };
  }, complete: async () => { completed++; return { text: answer(), usage: null }; } });
  const mind = new AgentMind({ ...f, adapter: a, budget: ledger, limits: { ...limits, timeoutMs: 50 }, contextLimits: {} });
  const result = await mind.decide();
  assert.equal(result.why, 'inference_timeout');
  assert.equal(completed, 0);
  assert.equal(ledger.snapshot.totals.entries, 0);
});

test('stale authority, task fence, file hashes, and death each prevent application', async (t) => {
  const mutations = [
    ['control epoch', (s) => { s.grant.controlRevision++; }],
    ['task fence', (s) => { s.taskFence = 'new-task'; }],
    ['owner file revision', (s) => { s.ownerFileHashes.personality = 'p2'; }],
    ['death', (s) => { s.observation.confirmed.self = { ...s.observation.confirmed.self, hp: 0, dead: true };
      s.required.observation = structuredClone(s.observation); }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const f = fixture();
    const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => {
      mutate(f.state.value); return { text: answer(), usage: { inputTokens: 2, outputTokens: 1, costUnits: 1 } };
    } }), budget: budget(), limits, contextLimits: {} });
    const result = await mind.decide();
    assert.equal(result.action, undefined);
    assert.equal(f.state.submits.length, 0);
  });
});

test('current target life and direct owner priority are checked at application time', async (t) => {
  await t.test('target dies during inference', async () => {
    const f = fixture();
    const attack = answer({ type: 'attack_pve', args: { target: { entityId: 7, life: 'enemy-life-1' }, durationMs: 100 } });
    const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => {
      f.state.value.observation.confirmed.entities[0].hp = 0;
      f.state.value.required.observation = structuredClone(f.state.value.observation);
      return { text: attack, usage: { inputTokens: 2, outputTokens: 1, costUnits: 1 } };
    } }), budget: budget(), limits, contextLimits: {} });
    const result = await mind.decide();
    assert.equal(result.action, undefined);
    assert.equal(f.state.submits.length, 0);
  });
  await t.test('direct priority blocks before provider call', async () => {
    const f = fixture(); let calls = 0;
    f.state.value.authority = { state: 'active', task: { priority: 'direct' } };
    const mind = new AgentMind({ ...f, adapter: adapter({ complete: async () => { calls++; return { text: answer(), usage: null }; } }),
      budget: budget(), limits, contextLimits: {} });
    const result = await mind.decide();
    assert.equal(result.why, 'owner_priority');
    assert.equal(calls, 0);
    assert.equal(f.state.submits.length, 0);
  });
});

test('timeouts and cancellation suppress late results and keep the one-query slot until provider settles', async () => {
  let resolveCall; let completions = 0;
  const f = fixture(); const ledger = budget();
  const a = adapter({ complete: () => { completions++; return new Promise((resolve) => { resolveCall = resolve; }); } });
  const mind = new AgentMind({ ...f, adapter: a, budget: ledger, limits: { ...limits, timeoutMs: 20 }, contextLimits: {} });
  const first = mind.decide();
  while (!resolveCall) await new Promise((resolve) => setTimeout(resolve, 0));
  const timed = await first;
  assert.equal(timed.ok, false);
  assert.equal((await mind.decide()).why, 'inference_busy');
  resolveCall({ text: answer(), usage: { inputTokens: 1, outputTokens: 1, costUnits: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.state.submits.length, 0);
  assert.equal(completions, 1);
  assert.equal(ledger.snapshot.totals.confirmedTokens, 2);

  const pending = mind.decide();
  while (completions < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  mind.cancel();
  resolveCall({ text: answer(), usage: { inputTokens: 1, outputTokens: 1, costUnits: 1 } });
  await pending;
  assert.equal(f.state.submits.length, 0);
});

test('an independent body pump continues while inference awaits the provider', async () => {
  let resolveCall; let waiting = false; let ticks = 0;
  const f = fixture();
  const mind = new AgentMind({ ...f, adapter: adapter({ complete: () => {
    waiting = true; return new Promise((resolve) => { resolveCall = resolve; });
  } }), budget: budget(), limits: { ...limits, timeoutMs: 2000 }, contextLimits: {} });
  const pending = mind.decide();
  while (!waiting) await new Promise((resolve) => setTimeout(resolve, 0));
  // The host-owned pump keeps running while the provider promise remains unresolved.
  const pump = setInterval(() => { ticks++; }, 2);
  try {
    const deadline = Date.now() + 500;
    while (ticks < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(ticks >= 1);
  } finally {
    clearInterval(pump);
    resolveCall({ text: answer(), usage: { inputTokens: 1, outputTokens: 1, costUnits: 1 } });
  }
  assert.equal((await pending).ok, true);
});

test('closed mind rejects future decisions and state is a detached projection', async () => {
  const f = fixture(); const mind = new AgentMind({ ...f, adapter: adapter(), budget: budget(), limits, contextLimits: {} });
  const view = mind.state;
  view.closed = true; view.ledger.totals.calls = 999;
  assert.equal(mind.state.closed, false);
  mind.close();
  assert.equal((await mind.decide()).why, 'mind_closed');
});
