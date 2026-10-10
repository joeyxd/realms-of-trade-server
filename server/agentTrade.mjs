// Closed agent entry points. Gameplay and persistence remain owned by EconomicAuthority.
import { MSG } from '../src/net/protocol.js';
import { C, KIND } from '../src/sim/ecs.js';
import { GOODS } from '../src/data/goods.js';
import { townAt } from '../src/sim/systems/trade.js';

const histories = new WeakMap();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const opId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function agentTradeReason(h, sock, msg, reserved = false) {
  if (!h.agentTrade || !h.agentPilot || !h.economicAuthority || !sock.agentIdentity || !sock.worldAdmitted) return 'forbidden';
  const state = h.agentControl.byClient(sock.id), c = h.server.clients.get(sock.id),
    s = h.profiles.clients.get(sock.id), w = h.server.world, e = c?.entity;
  if (!state || state.grant.scope.characterId !== sock.agentIdentity || state.grant.scope.worldId !== h.worldState.id ||
      state.grant.scope.sessionId !== sock.agentSessionId || msg.sessionId !== state.grant.scope.sessionId ||
      !h.agentControl.authorize(sock.id, msg.epoch)) return 'stale_session';
  if (!state.grant.capabilities.includes(msg.op === 'buy' ? 'trade_buy' : 'trade_sell')) return 'forbidden';
  if (!e || !c.serverProfile || !c.agentManaged || !s || s.key !== sock.agentIdentity || s.closed || s.failed ||
      h.profiles.accounts.get(s.key) !== s || w.ecs.clientId[e] !== sock.id || w.ecs.kind[e] !== KIND.PLAYER ||
      !(w.ecs.mask[e] & C.PLAYER)) return 'unavailable';
  if (sock.economicClosing || h.closing || !h.sockets.has(sock.id)) return 'stale_session';
  if (c.paused) return 'paused';
  if (!w.ecs.alive[e] || w.ecs.hp[e] <= 0 || w.ecs.dead[e] > 0) return 'dead';
  if (w.navalPilot?.locked?.(e) || w.navalPilot?.aboard?.(e)) return 'busy';
  if (!reserved && !h.profileAvailable(sock.id, e)) return 'gate';
  return null;
}

export function agentTradeMessage(h, sock, msg) {
  const reply = (why, ack = null, budget = null, historical = false) => {
    h.sendTo(sock.id, { t: MSG.AGENT_TRADE_RESULT, opId: opId(msg.opId) ? msg.opId : null,
      epoch: Number.isSafeInteger(msg.epoch) && msg.epoch > 0 ? msg.epoch : null,
      sessionId: uuid(msg.sessionId) ? msg.sessionId : null, ok: ack ? ack.ok === true : false,
      why: ack ? ack.why || null : why, tick: h.server.world.tick, replay: historical, historical,
      receipt: ack ? { op: msg.op, g: msg.g, n: msg.n,
        total: Number.isSafeInteger(ack.total) ? ack.total : msg.expectedTotal, rev: ack.rev, ok: ack.ok, why: ack.why } : null,
      budget });
  };
  if (!exact(msg, ['t', 'opId', 'epoch', 'sessionId', 'op', 'g', 'n', 'expectedTotal']) ||
      !opId(msg.opId) || !uuid(msg.sessionId) || !Number.isSafeInteger(msg.epoch) || msg.epoch < 1 ||
      !['buy', 'sell'].includes(msg.op) || typeof msg.g !== 'string' || !Object.hasOwn(GOODS, msg.g) ||
      !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 500 ||
      !Number.isSafeInteger(msg.expectedTotal) || msg.expectedTotal < 0 || msg.expectedTotal > 1e9) { reply('command'); return; }
  const why = agentTradeReason(h, sock, msg);
  if (why) { reply(why); return; }
  let history = histories.get(sock);
  if (!history || history.sessionId !== msg.sessionId) {
    history = { sessionId: msg.sessionId, requests: new Map() }; histories.set(sock, history);
  }
  const signature = JSON.stringify([msg.op, msg.g, msg.n, msg.expectedTotal]);
  const prior = history.requests.get(msg.opId);
  if (prior && prior !== signature) { reply('duplicate'); return; }
  if (!prior && history.requests.size >= 64) { reply('busy'); return; }
  const town = townAt(h.server.world, h.server.clients.get(sock.id).entity);
  if (!town) { reply('far'); return; }
  history.requests.set(msg.opId, signature);
  const state = h.agentControl.byClient(sock.id);
  const agent = { ownerId: state.grant.scope.ownerId, wire: structuredClone(msg), budgetId: null,
    check: () => agentTradeReason(h, sock, msg, true),
    finish: a => reply(a.denial ?? null, a.agentReceipted ? a.ack : null, a.budget ?? null, a.replay === true && a.agentReceipted === true) };
  h.economicAuthority.handle(sock, { t: MSG.CMD, type: 'commerce', op: msg.op,
    opId: msg.opId, town, g: msg.g, n: msg.n, expectedTotal: msg.expectedTotal }, agent);
}

export async function agentGoodsBudgetMessage(h, sock, msg) {
  const reply = (why, budget = null) => h.sendTo(sock.id, { t: MSG.AGENT_GOODS_BUDGET_RESULT,
    op: ['create', 'read', 'revoke'].includes(msg.op) ? msg.op : null,
    characterId: uuid(msg.characterId) ? msg.characterId : null, ok: why === null, why, budget });
  const keys = msg.op === 'create' ? ['t', 'op', 'characterId', 'budgetId', 'limits'] :
    msg.op === 'revoke' ? ['t', 'op', 'characterId', 'budgetId'] : msg.op === 'read' ? ['t', 'op', 'characterId'] : [];
  if (!keys.length || !exact(msg, keys) || !uuid(msg.characterId) ||
      (msg.op !== 'read' && !uuid(msg.budgetId))) { reply('command'); return; }
  const s = h.profiles.clients.get(sock.id), c = h.server.clients.get(sock.id);
  if (!h.agentTrade || sock.agentIdentity || !sock.worldAdmitted || !c?.serverProfile || !s || s.closed || s.failed ||
      h.profiles.accounts.get(s.key) !== s || !h.agentControl?.ownedBinding(s.key, msg.characterId)) { reply('forbidden'); return; }
  // Owner configuration is separate from agent input and cannot alter a binding's capabilities.
  if (sock.agentBudgetPending || (msg.op !== 'revoke' && (sock.agentBudgetQueries ?? 0) >= 64)) { reply('busy'); return; }
  sock.agentBudgetPending = true; sock.agentBudgetQueries = (sock.agentBudgetQueries ?? 0) + 1;
  try {
    const scope = { world: h.worldState.id, ownerId: s.key, characterId: msg.characterId };
    const budget = msg.op === 'create' ? await h.store.createAgentGoodsBudget({ ...scope, budgetId: msg.budgetId, limits: msg.limits }) :
      msg.op === 'revoke' ? await h.store.revokeAgentGoodsBudget({ ...scope, budgetId: msg.budgetId }) :
        await h.store.loadAgentGoodsBudget(scope);
    if (h.profiles.clients.get(sock.id) === s && !s.closed && h.sockets.get(sock.id) === sock) reply(null, budget);
  } catch { reply('storage'); }
  finally { sock.agentBudgetPending = false; }
}
