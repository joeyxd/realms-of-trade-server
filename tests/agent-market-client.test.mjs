import test from 'node:test';
import assert from 'node:assert/strict';
import { GOODS } from '../src/data/goods.js';
import { MSG } from '../src/net/protocol.js';
import { MARKET_FAILURES, MARKET_QUERY_LIMIT, MARKET_READ_CAPABILITY, validMarketProjection,
  validMarketQuery, validMarketResult } from '../src/net/agentMarket.js';
import { AgentMarket } from '../tools/agent/market.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { labLimits } from '../tools/agent/contract.mjs';

const copy = (v) => structuredClone(v);
const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'world-1', sessionId: 'session-1' };
const grant = (capabilities = ['move', MARKET_READ_CAPABILITY]) => fixtureGrant({ scope, controlRevision: 5,
  expiresAtMs: 100000, capabilities });
const observation = (g = grant(), overrides = {}) => fixtureObservation({ scope: g.scope,
  controlRevision: g.controlRevision, revision: 2, tick: 10, receivedAtMs: 100, source: 'server', ...overrides });
const authority = (g = grant()) => ({ state: 'active', taskRevision: 0, grant: copy(g), task: null });
const row = (g = 'madera') => ({ g, stock: 50, buy: 10, sell: 8, trend: 0, illegal: !!GOODS[g].illegal });
const listMarket = () => ({ v: 1, op: 'list', town: 'aldea', rows: [row()] });
const quoteMarket = (overrides = {}) => ({ v: 1, op: 'quote', town: 'aldea', g: 'madera', n: 4,
  side: 'buy', total: 40, avg: 10, law: 'libre', ...overrides });
const query = (g = grant(), requestId = 'market-1', op = 'list', fields = {}) => ({ v: 1, requestId,
  scope: copy(g.scope), controlRevision: g.controlRevision, op, ...fields });
function result(request, market = listMarket(), overrides = {}) {
  return { t: MSG.AGENT_MARKET_RESULT, requestId: request.requestId, epoch: request.epoch,
    sessionId: request.sessionId, ok: true, why: null, tick: 11, replay: false, market, ...overrides };
}
function failure(request, overrides = {}) {
  return { t: MSG.AGENT_MARKET_RESULT, requestId: request.requestId, epoch: request.epoch,
    sessionId: request.sessionId, ok: false, why: 'far', tick: 11, replay: false, market: null, ...overrides };
}
function harness({ currentTime = 100, capabilities, onSend } = {}) {
  let now = currentTime;
  const sent = [], feedback = [], g = grant(capabilities);
  const manager = new AgentMarket({ now: () => now, limits: labLimits(), timeoutMs: 100,
    send: (m) => { sent.push(copy(m)); onSend?.(m); }, onFeedback: (type, data) => feedback.push({ type, data }) });
  const update = (overrides = {}, contextOverrides = {}) => manager.updateContext({ ready: true, authenticated: true,
    grant: g, authority: authority(g), observation: observation(g, { receivedAtMs: now, ...overrides }), ...contextOverrides });
  update();
  return { manager, sent, feedback, grant: g, update, setNow: (v) => { now = v; } };
}

test('market wire and projection validators enforce exact bounded shapes without town selectors', () => {
  const base = { t: MSG.AGENT_MARKET, requestId: 'market-1', epoch: 5, sessionId: scope.sessionId, op: 'list' };
  assert.equal(validMarketQuery(base), true);
  assert.equal(validMarketQuery({ ...base, town: 'aldea' }), false);
  assert.equal(validMarketQuery({ ...base, op: 'quote', g: 'madera', n: 500, side: 'sell' }), true);
  assert.equal(validMarketQuery({ ...base, op: 'quote', g: 'unknown', n: 1, side: 'buy' }), false);
  assert.equal(validMarketQuery({ ...base, op: 'quote', g: ['madera'], n: 1, side: 'buy' }), false);
  assert.equal(validMarketQuery({ ...base, op: 'quote', g: 'madera', n: 501, side: 'buy' }), false);
  assert.equal(validMarketProjection(listMarket()), true);
  let getterCalled = false;
  const accessor = Object.defineProperty({ ...listMarket() }, 'town', { enumerable: true,
    get() { getterCalled = true; return 'aldea'; } });
  assert.equal(validMarketProjection(accessor), false);
  assert.equal(getterCalled, false, 'projection validation never evaluates accessor properties');
  assert.equal(validMarketProjection({ ...listMarket(), town: 'sol' }), false, 'unwalkable towns are rejected');
  assert.equal(validMarketProjection(quoteMarket()), true);
  assert.equal(validMarketProjection(quoteMarket({ n: 501 })), false);
  assert.equal(validMarketProjection({ ...listMarket(), rows: [{ ...row(), g: ['madera'] }] }), false);
  assert.equal(validMarketProjection(quoteMarket({ g: ['madera'] })), false);
  assert.equal(validMarketProjection(quoteMarket({ avg: 9 })), false);
  assert.equal(validMarketProjection(quoteMarket({ law: 'sinley' })), false);
  assert.equal(validMarketProjection(quoteMarket({ side: 'buy', total: 0, avg: 0 })), false);
  const malformed = { t: MSG.AGENT_MARKET_RESULT, requestId: null, epoch: null, sessionId: null,
    ok: false, why: 'invalid_request', tick: 0, replay: false, market: null };
  assert.equal(validMarketResult(malformed), true, 'malformed wire input can receive a bounded null-ID failure');
  assert.equal(validMarketResult({ ...malformed, requestId: 'bad request', epoch: 5 }), false);
  assert.equal(validMarketResult({ ...malformed, requestId: 'market-1', epoch: 5, sessionId: null }), true,
    'each malformed identity field may be nulled independently');
  assert.equal(validMarketResult({ ...failure({ requestId: 'market-1', epoch: 5, sessionId: scope.sessionId }), replay: true }), true,
    'an identified cached failure may be replayed');
  assert.equal(validMarketResult({ ...malformed, replay: true }), false, 'malformed failures cannot be replayed');
  assert.deepEqual(MARKET_FAILURES.includes('far') && MARKET_FAILURES.includes('request_id_conflict'), true);
});

test('market client requires a fresh authenticated active authority and market_read capability', () => {
  const h = harness();
  assert.equal(h.manager.read({ ...query(h.grant), town: 'aldea' }).why, 'invalid_request');
  assert.equal(h.manager.read({ ...query(h.grant, 'bad-epoch'), controlRevision: 4 }).why, 'control_mismatch');
  assert.equal(h.sent.length, 0);

  const denied = harness({ capabilities: ['move'] });
  assert.equal(denied.manager.read(query(denied.grant)).why, 'forbidden');
  const stale = harness(); stale.setNow(2000); stale.update({ receivedAtMs: 100 });
  assert.equal(stale.manager.read(query(stale.grant)).why, 'unavailable');
  const dead = harness(); dead.update({ confirmed: { self: { hp: 0, dead: true } } });
  assert.equal(dead.manager.read(query(dead.grant)).why, 'dead');
  const unauthenticated = harness(); unauthenticated.update({}, { authenticated: false });
  assert.equal(unauthenticated.manager.read(query(unauthenticated.grant)).why, 'unavailable');
});

test('market client sends exact list and quote shapes, single-flights, and binds quote result to request', () => {
  const h = harness();
  assert.equal(h.manager.read(query(h.grant)).ok, true);
  assert.deepEqual(h.sent[0], { t: MSG.AGENT_MARKET, requestId: 'market-1', epoch: 5,
    sessionId: scope.sessionId, op: 'list' });
  assert.equal(h.manager.read(query(h.grant)).replay, true);
  assert.equal(h.sent.length, 1, 'local replay does not resend');
  assert.equal(h.manager.read(query(h.grant, 'market-2')).why, 'request_pending');
  assert.equal(h.manager.receive(result(h.sent[0], { ...listMarket(), rows: [{ ...row(), extra: 1 }] })), false);
  assert.equal(h.manager.receive(result(h.sent[0])), true);
  assert.equal(h.manager.state.fresh, true);
  assert.equal(h.manager.state.market.op, 'list');
  assert.equal(h.manager.receive(result(h.sent[0])), false, 'duplicate result ignored');

  const quote = query(h.grant, 'quote-1', 'quote', { g: 'madera', n: 4, side: 'buy' });
  assert.equal(h.manager.read(quote).ok, true);
  assert.deepEqual(h.sent.at(-1), { t: MSG.AGENT_MARKET, requestId: 'quote-1', epoch: 5,
    sessionId: scope.sessionId, op: 'quote', g: 'madera', n: 4, side: 'buy' });
  assert.equal(h.manager.receive(result(h.sent.at(-1), quoteMarket({ side: 'sell' }))), false,
    'switched quote sides are not accepted');
  assert.equal(h.manager.receive(result(h.sent.at(-1), quoteMarket())), true);
  assert.equal(h.manager.state.market.side, 'buy');

  const failed = harness(); failed.manager.read(query(failed.grant));
  assert.equal(failed.manager.receive(failure(failed.sent[0], { replay: true })), true);
  assert.equal(failed.manager.requests[0].result.replay, true);
});

test('market view requires a new server read after movement or a newer denial', () => {
  const h = harness();
  h.manager.read(query(h.grant));
  assert.equal(h.manager.receive(result(h.sent[0])), true);
  h.setNow(110);
  h.update({ tick: 12, revision: 3, confirmed: { self: { position: { x: 1, y: 0, z: 0 } } } });
  assert.equal(h.manager.state.market, null);
  assert.equal(h.manager.state.staleWhy, 'actor_moved');
  h.update({ tick: 12, revision: 3 });
  assert.equal(h.manager.state.market, null, 'returning to the old position cannot revive the retired view');
  h.manager.read(query(h.grant, 'after-move'));
  assert.equal(h.manager.receive(result(h.sent.at(-1), listMarket(), { tick: 12 })), true);
  assert.equal(h.manager.state.fresh, true);
  h.manager.read(query(h.grant, 'new-denial'));
  assert.equal(h.manager.receive(failure(h.sent.at(-1), { tick: 12 })), true);
  assert.equal(h.manager.state.market, null, 'a newer denial retires a previously successful view');
});

test('market cached replay does not refresh time and only current fresh authorized views expose data', () => {
  const h = harness();
  h.manager.read(query(h.grant));
  assert.equal(h.manager.receive(result(h.sent[0])), true);
  h.setNow(110);
  h.update({ revision: 3, tick: 12 });
  assert.equal(h.manager.state.fresh, true, 'a newer routine snapshot does not expire the market early');
  assert.deepEqual(h.manager.state.market, listMarket());
  assert.equal(h.manager.state.receivedAtMs, 100);
  assert.equal(h.manager.read(query(h.grant, 'market-2')).ok, true);
  assert.equal(h.manager.receive(result(h.sent.at(-1), listMarket(), { tick: 12, replay: true })), true);
  assert.equal(h.manager.state.receivedAtMs, 100);
  h.setNow(1601);
  assert.equal(h.manager.state.fresh, false);
  assert.equal(h.manager.state.market, null, 'stale market is never forwarded as current');
  assert.equal(h.manager.state.tick, 11);

  const fresh = harness(); fresh.manager.read(query(fresh.grant));
  fresh.setNow(110);
  fresh.update({ revision: 3, tick: 12, receivedAtMs: 110 });
  assert.equal(fresh.manager.receive(result(fresh.sent[0], listMarket(), { tick: 11 })), false,
    'a result already stale when it arrives is rejected');
  assert.equal(fresh.manager.state.market, null);
});

test('market epoch changes, revocation, stop, timeout, and the 64-query limit invalidate reads safely', () => {
  const h = harness(); h.manager.read(query(h.grant));
  h.manager.receive(result(h.sent[0]));
  const next = { ...h.grant, scope: { ...h.grant.scope, sessionId: 'session-2' }, controlRevision: 6 };
  h.manager.updateContext({ ready: true, authenticated: true, grant: next, authority: authority(next),
    observation: fixtureObservation({ scope: next.scope, controlRevision: 6, revision: 3, tick: 12,
      receivedAtMs: 100, source: 'server' }) });
  assert.equal(h.manager.state.market, null);
  assert.equal(h.manager.receive(result(h.sent[0])), false);
  const revoked = harness(); revoked.manager.read(query(revoked.grant));
  const noMarket = { ...revoked.grant, capabilities: ['move'] };
  revoked.manager.updateContext({ ready: true, authenticated: true, grant: noMarket, authority: authority(noMarket),
    observation: observation(noMarket, { receivedAtMs: 100 }) });
  assert.equal(revoked.manager.requests[0].state, 'uncertain');
  assert.equal(revoked.manager.receive(result(revoked.sent[0])), false);
  assert.equal(revoked.manager.state.market, null);
  h.manager.read(query(next, 'stop-pending'));
  h.manager.stop();
  assert.equal(h.manager.state.market, null);
  assert.equal(h.manager.requests.at(-1).state, 'uncertain');
  assert.equal(h.manager.receive(result(h.sent.at(-1))), false);

  const timeout = harness(); timeout.manager.read(query(timeout.grant));
  timeout.setNow(200); timeout.manager.expire();
  assert.equal(timeout.manager.requests[0].state, 'uncertain');
  assert.equal(timeout.manager.receive(result(timeout.sent[0])), false);

  const limited = harness();
  for (let i = 0; i < MARKET_QUERY_LIMIT; i++) {
    assert.equal(limited.manager.read(query(limited.grant, `market-${i}`)).ok, true);
    assert.equal(limited.manager.receive(result(limited.sent.at(-1))), true);
  }
  assert.equal(limited.manager.read(query(limited.grant, 'market-65')).why, 'query_limit');
  assert.equal(limited.sent.length, MARKET_QUERY_LIMIT);
});
