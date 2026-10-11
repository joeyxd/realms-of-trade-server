import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/net/protocol.js';
import { AGENT_TRADE_LIMIT, validAgentTradeRequest, validAgentTradeResult } from '../src/net/agentTrade.js';
import { AgentTrade } from '../tools/agent/trade.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { labLimits } from '../tools/agent/contract.mjs';

const copy = (value) => structuredClone(value);
const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'world-1', sessionId: 'session-1' };
const grant = (capabilities = ['move', 'trade_buy']) => fixtureGrant({ scope, controlRevision: 5,
  expiresAtMs: 100000, capabilities });
const observation = (g, overrides = {}) => fixtureObservation({ scope: g.scope, controlRevision: g.controlRevision,
  revision: 2, tick: 10, receivedAtMs: 100, source: 'server', ...overrides });
const authority = (g) => ({ state: 'active', taskRevision: 0, grant: copy(g), task: null });
const budget = (overrides = {}) => ({ v: 1, budgetId: '11111111-1111-4111-8111-111111111111', enabled: true,
  limits: { buyGold: 1000, buyGoldPerTrade: 500, sellUnits: { madera: 20 }, sellUnitsPerTrade: 10 },
  buyGoldUsed: 40, sellUnitsUsed: {}, ...overrides });
const request = (overrides = {}) => ({ opId: 'buy-1', op: 'buy', g: 'madera', n: 4, expectedTotal: 40, ...overrides });
function result(sent, overrides = {}) {
  return { t: MSG.AGENT_TRADE_RESULT, opId: sent.opId, epoch: sent.epoch, sessionId: sent.sessionId,
    ok: true, why: '', tick: 11, replay: false, historical: false,
    receipt: { op: sent.op, g: sent.g, n: sent.n, total: sent.expectedTotal, rev: 1, ok: true, why: '' }, budget: budget(), ...overrides };
}
function harness({ capabilities, operations = new Map(), currentTime = 100 } = {}) {
  let now = currentTime;
  const sent = [], feedback = [], g = grant(capabilities);
  const manager = new AgentTrade({ now: () => now, timeoutMs: 100,
    operations, send: (message) => sent.push(copy(message)), onFeedback: (type, data) => feedback.push({ type, data }) });
  const update = (grantValue = g, overrides = {}, contextOverrides = {}) => manager.updateContext({ ready: true,
    authenticated: true, grant: grantValue, authority: authority(grantValue), observation: observation(grantValue,
      { receivedAtMs: now, ...overrides }), limits: labLimits(), ...contextOverrides });
  update();
  return { manager, sent, feedback, grant: g, update, setNow: (value) => { now = value; } };
}

test('trade wire and result contracts are exact, bounded, and hide account/town selectors', () => {
  const wire = { t: MSG.AGENT_TRADE, opId: 'buy-1', epoch: 5, sessionId: scope.sessionId,
    op: 'buy', g: 'madera', n: 500, expectedTotal: 1e9 };
  assert.equal(validAgentTradeRequest(wire), true);
  for (const invalid of [
    { ...wire, town: 'aldea' }, { ...wire, ownerId: scope.ownerId }, { ...wire, n: 501 },
    { ...wire, expectedTotal: 1.5 }, { ...wire, opId: 'bad id' }, { ...wire, op: 'transfer' },
  ]) assert.equal(validAgentTradeRequest(invalid), false);
  assert.equal(validAgentTradeRequest({ ...wire, op: 'sell' }), true);
  assert.equal(AGENT_TRADE_LIMIT, 64);
  const sent = { ...wire, n: 4, expectedTotal: 40 };
  assert.equal(validAgentTradeResult(result(sent)), true);
  assert.equal(validAgentTradeResult({ ...result(sent), unexpected: true }), false);
  assert.equal(validAgentTradeResult(result(sent, { budget: { ...budget(), budgetId: 'BAD' } })), false);
  assert.equal(validAgentTradeResult(result(sent, { receipt: { ...result(sent).receipt, n: 5 } })), true,
    'wire shape is valid; client correlation rejects a receipt for another command');
});

test('trade requires a fresh active authenticated grant with side-specific capability and sends a closed payload', () => {
  const h = harness();
  assert.equal(h.manager.trade({ ...request(), town: 'aldea' }).why, 'invalid_request');
  assert.equal(h.manager.trade(request({ op: 'sell', opId: 'sell-1' })).why, 'forbidden');
  const denied = harness({ capabilities: ['move'] });
  assert.equal(denied.manager.trade(request()).why, 'forbidden');
  const unauthenticated = harness(); unauthenticated.update(unauthenticated.grant, {}, { authenticated: false });
  assert.equal(unauthenticated.manager.trade(request()).why, 'unavailable');
  const inactive = harness(); inactive.update(inactive.grant, {}, { authority: { ...authority(inactive.grant), state: 'revoked' } });
  assert.equal(inactive.manager.trade(request()).why, 'unavailable');
  const stale = harness(); stale.setNow(2000); stale.update(stale.grant, { receivedAtMs: 100 });
  assert.equal(stale.manager.trade(request()).why, 'unavailable');
  assert.equal(h.manager.trade(request()).ok, true);
  assert.deepEqual(h.sent[0], { t: MSG.AGENT_TRADE, ...request(), epoch: 5, sessionId: scope.sessionId });
  assert.equal(Object.hasOwn(h.sent[0], 'town'), false);
  assert.equal(Object.hasOwn(h.sent[0], 'ownerId'), false);
});

test('trade binds immutable opIds, ignores stale results, times out uncertain, and recovers only by explicit same-body resend', () => {
  const h = harness();
  assert.equal(h.manager.trade(request()).ok, true);
  assert.equal(h.manager.trade(request()).why, 'request_pending');
  assert.equal(h.manager.trade(request({ expectedTotal: 41 })).why, 'op_id_conflict');
  assert.equal(h.manager.receive(result(h.sent[0], { epoch: 4 })), false);
  assert.equal(h.manager.receive(result(h.sent[0], { sessionId: 'other-session' })), false);
  h.setNow(200); h.manager.expire();
  assert.equal(h.manager.operations[0].state, 'uncertain');
  const nextGrant = { ...h.grant, scope: { ...h.grant.scope, sessionId: 'session-2' }, controlRevision: 6 };
  h.update(nextGrant, { tick: 12, revision: 3, receivedAtMs: 200 });
  assert.equal(h.manager.trade(request()).ok, true, 'same immutable opId is explicitly resent under the current session');
  assert.deepEqual(h.sent[1], { t: MSG.AGENT_TRADE, ...request(), epoch: 6, sessionId: 'session-2' });
  assert.equal(h.manager.receive(result(h.sent[1], { historical: true, replay: true, tick: 12 })), true);
  assert.equal(h.manager.state.budget, null, 'historical recovery never hydrates a current budget view');
  assert.equal(h.manager.operations[0].attempts, 2);
  assert.deepEqual(h.manager.operations[0].sessions, ['session-1', 'session-2']);
  assert.equal(h.manager.trade(request()).replay, true, 'the terminal result is locally inspectable in the current session');
});

test('trade rejects mismatched receipts, keeps historical results out of the budget view, and expires projections', () => {
  const h = harness(); h.manager.trade(request());
  assert.equal(h.manager.receive(result(h.sent[0], { receipt: { ...result(h.sent[0]).receipt, g: 'fruta' } })), false);
  assert.equal(h.manager.receive(result(h.sent[0], { receipt: { ...result(h.sent[0]).receipt, op: 'sell' } })), false,
    'receipt correlation includes the authorized trade side');
  assert.equal(h.manager.receive(result(h.sent[0])), true);
  assert.equal(h.manager.state.fresh, true);
  assert.deepEqual(h.manager.state.budget, budget());
  h.setNow(1700);
  assert.equal(h.manager.state.fresh, false);
  assert.equal(h.manager.state.budget, null);
  const stopped = harness(); stopped.manager.trade(request()); stopped.manager.stop();
  assert.equal(stopped.manager.state.budget, null);
  assert.equal(stopped.manager.operations[0].state, 'uncertain');
});

test('side-specific availability and known-disabled budgets gate new trades, while dispatched receipts still reconcile', () => {
  const h = harness({ capabilities: ['move', 'trade_sell'] });
  assert.equal(h.manager.state.buyAvailable, false);
  assert.equal(h.manager.state.sellAvailable, true);
  assert.equal(h.manager.trade(request()).why, 'forbidden');
  const sell = request({ opId: 'sell-1', op: 'sell' });
  assert.equal(h.manager.trade(sell).ok, true);
  const sameSessionWithoutSell = { ...h.grant, capabilities: ['move', 'trade_buy'] };
  h.update(sameSessionWithoutSell);
  assert.equal(h.manager.receive(result(h.sent[0])), true,
    'a capability update after dispatch cannot discard the durable receipt');
  assert.equal(h.manager.state.sellAvailable, false);

  const disabled = harness(); disabled.manager.trade(request());
  assert.equal(disabled.manager.receive(result(disabled.sent[0], { budget: budget({ enabled: false }) })), true);
  assert.equal(disabled.manager.state.available, false, 'a known disabled budget is not reported available');
  assert.equal(disabled.manager.state.buyAvailable, false);
  assert.equal(disabled.manager.state.sellAvailable, false);
  assert.equal(disabled.manager.trade(request({ opId: 'buy-2' })).why, 'budget_disabled');
  disabled.setNow(1700);
  disabled.update(disabled.grant, { receivedAtMs: 1700 });
  assert.equal(disabled.manager.state.fresh, false, 'the old budget projection has expired');
  assert.equal(disabled.manager.state.budget, null);
  assert.equal(disabled.manager.state.available, false, 'a fresh observation cannot revive a known revoked budget');
  assert.equal(disabled.manager.state.buyAvailable, false);
  assert.equal(disabled.manager.state.sellAvailable, false);
  const next = { ...disabled.grant, scope: { ...disabled.grant.scope, sessionId: 'session-2' }, controlRevision: 6 };
  disabled.update(next, { tick: 12, revision: 3, receivedAtMs: 1700 });
  assert.equal(disabled.manager.trade(request()).ok, true,
    'same opId can still be resent explicitly to recover a receipt after budget revocation');
});
