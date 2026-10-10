// Authoritative market and raft cargo commands for the D06a local commerce loop.
import { GOODS } from '../../data/goods.js';
import { TOWNS } from '../../data/towns.js';
import { EDITOR_RADIUS } from '../../data/raftEditor.js';
import { holdUsed, load, roomFor, unload } from '../economy/cargo.js';
import { raftStats } from '../economy/raft.js';
import { raftGangplank } from '../raftGeometry.js';
import { publicRafts } from './rafts.js';
import { townAt, TRADE } from './trade.js';
import { CLOCK } from '../../data/clock.js';
import { productionRows } from '../economy/raftProduction.js';
import { ownerRaftCapacity } from './raftCapacity.js';
import { holdLoadIncreases } from '../economy/raftCapacity.js';
import { activeRaftParts } from '../naval/condition.js';

const MAX_REV = 2147483647;
const MAX_OPS = 64;
const MAX_OWNERS = 256;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const has = (object, key) => Object.hasOwn(object, key);
const validGood = (g) => typeof g === 'string' && has(GOODS, g);
const validTown = (town) => typeof town === 'string' && has(TOWNS, town);
const cloneHold = (h) => ({ cap: h.cap, goods: { ...h.goods } });
const cloneAck = (ack) => JSON.parse(JSON.stringify(ack));

function emit(w, e, msg, ok, why = '', rev = 0, extra = null) {
  const ack = { type: 'commerce', to: e,
    op: typeof msg?.op === 'string' && msg.op.length <= 16 ? msg.op : '',
    opId: typeof msg?.opId === 'string' ? msg.opId.slice(0, 64) : '', ok, why, rev };
  if (extra) for (const [key, value] of Object.entries(extra)) {
    if (!['type', 'to', 'op', 'opId', 'ok', 'why', 'rev'].includes(key)) ack[key] = value;
  }
  w.emit(ack);
  return ack;
}

function receipts(w, e) {
  if (!w.commerceReceipts) w.commerceReceipts = new Map();
  let own = w.commerceReceipts.get(e);
  if (!own) own = new Map();
  else w.commerceReceipts.delete(e);
  w.commerceReceipts.set(e, own);
  while (w.commerceReceipts.size > MAX_OWNERS)
    w.commerceReceipts.delete(w.commerceReceipts.keys().next().value);
  return own;
}

export function clearCommerceReceipts(w, e) {
  w?.commerceReceipts?.delete(e);
}

function signature(msg) {
  switch (msg.op) {
    case 'buy': case 'sell':
      return JSON.stringify([msg.op, msg.opId, msg.town, msg.g, msg.n, msg.expectedTotal]);
    case 'transfer':
      return JSON.stringify([msg.op, msg.opId, msg.id, msg.expectedRev, msg.g, msg.n, msg.side]);
    default: return '';
  }
}

function exactKeys(msg) {
  const common = new Set(['t', 'type', 'cmd', 'op', 'opId']);
  const schema = {
    list: ['town'], quote: ['town', 'g', 'n', 'side'], cargo: ['id'],
    buy: ['town', 'g', 'n', 'expectedTotal'], sell: ['town', 'g', 'n', 'expectedTotal'],
    transfer: ['id', 'expectedRev', 'g', 'n', 'side'],
  };
  if (typeof msg.op !== 'string' || !has(schema, msg.op)) return false;
  const fields = schema[msg.op];
  if (!fields) return false;
  const allowed = new Set([...common, ...fields]);
  return Object.keys(msg).every((k) => allowed.has(k))
    && (!msg.t || msg.t === 'cmd') && (!msg.type || msg.type === 'commerce')
    && (!msg.cmd || msg.cmd === 'commerce') && Object.hasOwn(msg, 'opId');
}

function alive(w, e) {
  return !!w.ecs.alive[e] && !(w.ecs.dead[e] > 0);
}

function busy(w, e, requireStationary = false) {
  const c = w.ecs;
  if (c.dashT[e] >= 0 || c.dashBuffer[e] > 0 || c.castK[e] > 0 || c.castLock[e] > 0) return true;
  return requireStationary && (c.moveMag[e] > 1e-6 || Math.hypot(c.vx[e], c.vz[e]) > 1e-6);
}

function nearRaft(w, e, record) {
  const c = w.ecs;
  if (w.raftDeck.surface(c.x[e], c.z[e], c.y[e])?.id === record.ship.id) return true;
  const d = w.map.dock;
  const px = d.base.x + d.dir.x * Math.max(0, d.len - 10);
  const pz = d.base.z + d.dir.z * Math.max(0, d.len - 10);
  if ((c.x[e] - px) ** 2 + (c.z[e] - pz) ** 2 > EDITOR_RADIUS ** 2) return false;
  const pub = publicRafts(w).find((r) => r.id === record.ship.id);
  const plank = pub && raftGangplank({ ...pub, parts: record.ship.grid.parts }, d);
  return !!plank && (c.x[e] - plank.x) ** 2 + (c.z[e] - plank.z) ** 2 <= 2.5 ** 2;
}

function ownRaft(w, e, profile, id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 120) return null;
  const ships = Array.isArray(profile.eco.ships) ? profile.eco.ships : [];
  const primary = ships.find((s) => s?.kind === 'raft' && s.at === 'aldea'
    && s.grid?.parts?.length && s.hp > 0);
  const active = w.rafts?.get(id);
  if (!active || active.owner !== e || active.ship !== primary || active.ship.id !== id
      || active.ship.at !== 'aldea') return null;
  return active;
}

function cargoState(w, e, profile, active) {
  const ship = active.ship;
  return { id: ship.id, hold: { cap: ship.hold.cap, goods: { ...ship.hold.goods } },
    pack: { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } },
    gold: profile.gold, stats: raftStats(ship.grid, ship.hold), raftRev: ship.rev,
    capacity: ownerRaftCapacity(w, e),
    production: productionRows({ ...ship.grid, parts: activeRaftParts(active) }, ship.hold, { blocked: active.productionBlocked || '' }),
    productionBlocked: active.productionBlocked || '', daySec: CLOCK.daySec };
}

function saveCandidate(saveFits, profile, eco, gold) {
  const candidate = { ...profile, gold, eco };
  try { return saveFits(candidate) === true; } catch { return false; }
}

function cloneEco(profile, pack, ship, hold, tradeRev) {
  return { ...profile.eco, tradeRev, pack,
    ships: profile.eco.ships.map((s) => s === ship ? { ...s, hold, rev: s.rev + 1 } : s) };
}

function marketRows(w, town) {
  return w.economy?.board(town) || [];
}

function readTradeRev(eco) {
  return Number.isSafeInteger(eco.tradeRev) && eco.tradeRev >= 0 && eco.tradeRev <= MAX_REV ? eco.tradeRev : 0;
}

function exactReadMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(msg))) return false;
  const keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(msg));
  const descriptors = Object.getOwnPropertyDescriptors(msg), op = descriptors.op?.value;
  if (!descriptors.op?.enumerable || !Object.hasOwn(descriptors.op, 'value')) return false;
  const expected = op === 'list' ? ['op', 'town'] : op === 'quote'
    ? ['op', 'town', 'g', 'n', 'side'] : [];
  if (!expected.length || keys.length !== expected.length ||
      keys.some((key) => typeof key !== 'string' || !expected.includes(key))) return false;
  return expected.every((key) => descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
}

// Pure private read projection shared by local commerce and trusted host adapters.
// The caller owns transport and authorization; this function enforces physical service.
export function readCommerce(w, e, msg) {
  const fail = (why, rev = 0, extra = {}) => ({ ok: false, why, rev, ...extra });
  if (!exactReadMessage(msg)) return fail('command');

  const profile = w.profiles?.get(e);
  const tradeRev = readTradeRev(profile?.eco || {});
  if (w.navalPilot?.locked?.(e)) return fail('busy', tradeRev);
  if (!profile?.eco || !alive(w, e)) return fail('dead', tradeRev);

  const town = msg.town;
  if (!validTown(town) || town.length > 32 || !TOWNS[town].walkable || townAt(w, e) !== town)
    return fail('far', tradeRev);
  if (msg.op === 'list') {
    return { ok: true, why: '', rev: tradeRev, town,
      rows: marketRows(w, town).map(({ g, stock, buy, sell, trend, illegal }) =>
        ({ g, stock, buy, sell, trend, illegal })),
      pack: { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } },
      used: holdUsed(profile.eco.pack), gold: profile.gold };
  }

  if (!validGood(msg.g) || !['buy', 'sell'].includes(msg.side) ||
      !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 500)
    return fail('command', tradeRev);
  const q = w.economy?.quote(town, msg.g, msg.n, msg.side);
  if (!q?.ok) return fail(q?.why || 'market', tradeRev,
    { town, g: msg.g, n: msg.n, side: msg.side, total: q?.total || 0 });
  return { ok: true, why: '', rev: tradeRev, town, g: msg.g, n: q.n,
    side: msg.side, total: q.total, avg: q.avg, law: q.law };
}

function cargoCommand(w, e, msg, profile, active, saveFits) {
  const ship = active.ship, rev = ship.rev;
  if (!Number.isSafeInteger(msg.expectedRev) || msg.expectedRev !== rev)
    return emit(w, e, msg, false, 'revision', readTradeRev(profile.eco), { raftRev: rev });
  if (rev >= MAX_REV) return emit(w, e, msg, false, 'revisionLimit', readTradeRev(profile.eco), { raftRev: rev });
  if (!validGood(msg.g) || !['deposit', 'withdraw'].includes(msg.side)
      || !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 500)
    return emit(w, e, msg, false, 'command', readTradeRev(profile.eco));
  const tradeRev = readTradeRev(profile.eco);
  if (tradeRev >= MAX_REV)
    return emit(w, e, msg, false, 'revisionLimit', tradeRev);
  if (busy(w, e, true)) return emit(w, e, msg, false, 'busy', tradeRev);
  if (w.ecs.regenT[e] < TRADE.calm) return emit(w, e, msg, false, 'calm', tradeRev);
  if (!nearRaft(w, e, active)) return emit(w, e, msg, false, 'far', tradeRev);

  const pack = cloneHold(profile.eco.pack), hold = cloneHold(ship.hold);
  const from = msg.side === 'deposit' ? pack : hold, to = msg.side === 'deposit' ? hold : pack;
  if ((has(from.goods, msg.g) ? from.goods[msg.g] : 0) < msg.n)
    return emit(w, e, msg, false, 'have', tradeRev);
  if (roomFor(to, msg.g) < msg.n)
    return emit(w, e, msg, false, 'room', tradeRev);
  if (!unload(from, msg.g, msg.n) || !load(to, msg.g, msg.n))
    return emit(w, e, msg, false, 'room', tradeRev);
  if (msg.side === 'deposit' && holdLoadIncreases(activeRaftParts(w.rafts.get(ship.id)), ship.hold, hold))
    return emit(w, e, msg, false, 'capacity', tradeRev);

  const nextTradeRev = tradeRev + 1;
  const eco = cloneEco(profile, pack, ship, hold, nextTradeRev);
  if (!saveCandidate(saveFits, profile, eco, profile.gold))
    return emit(w, e, msg, false, 'saveSize', tradeRev);

  ship.hold = hold;
  ship.rev++;
  profile.eco.pack = pack;
  profile.eco.tradeRev = nextTradeRev;
  w.profileDirty?.add(e);
  return emit(w, e, msg, true, '', nextTradeRev, cargoState(w, e, profile, active));
}

export function commerceCmd(w, e, msg, saveFits = () => true) {
  const fail = (why, rev = 0, extra = null) => emit(w, e, msg || {}, false, why, rev, extra);
  if (!msg || (msg.type !== 'commerce' && msg.cmd !== 'commerce')
      || typeof msg.opId !== 'string' || !OP_ID.test(msg.opId)
      || typeof msg.op !== 'string' || !['list', 'quote', 'cargo', 'buy', 'sell', 'transfer'].includes(msg.op)
      || !exactKeys(msg))
    return fail('command');
  const profile = w.profiles?.get(e);
  if (w.navalPilot?.locked?.(e)) return fail('busy', readTradeRev(profile?.eco || {}));
  const tradeRev = readTradeRev(profile?.eco || {});
  const mutating = ['buy', 'sell', 'transfer'].includes(msg.op);
  if (mutating) {
    const bounded = msg.op === 'transfer'
      ? typeof msg.id === 'string' && msg.id.length >= 1 && msg.id.length <= 120
        && Number.isSafeInteger(msg.expectedRev) && msg.expectedRev >= 1 && msg.expectedRev <= MAX_REV
        && validGood(msg.g) && Number.isSafeInteger(msg.n) && msg.n >= 1 && msg.n <= 500
        && ['deposit', 'withdraw'].includes(msg.side)
      : validTown(msg.town) && msg.town.length <= 32 && validGood(msg.g)
        && Number.isSafeInteger(msg.n) && msg.n >= 1 && msg.n <= 500
        && Number.isSafeInteger(msg.expectedTotal) && msg.expectedTotal >= 0 && msg.expectedTotal <= 1e9;
    if (!bounded) return fail('command', tradeRev);
  }
  const cache = receipts(w, e), sig = mutating ? signature(msg) : '';
  if (mutating && cache.has(msg.opId)) {
    const prior = cache.get(msg.opId);
    if (prior.signature !== sig) return fail('duplicate', tradeRev);
    const ack = cloneAck(prior.ack);
    w.emit(ack);
    return ack;
  }
  if (!profile?.eco || !alive(w, e)) return fail('dead', tradeRev);

  if (msg.op === 'cargo' || msg.op === 'transfer') {
    const active = ownRaft(w, e, profile, msg.id);
    if (!active) return fail('owner', tradeRev);
    if (msg.op === 'cargo') {
      if (!nearRaft(w, e, active)) return fail('far', tradeRev);
      return emit(w, e, msg, true, '', tradeRev, cargoState(w, e, profile, active));
    }
    if (!alive(w, e)) return fail('dead', tradeRev);
    const out = cargoCommand(w, e, msg, profile, active, saveFits);
    if (out.ok) {
      cache.set(msg.opId, { signature: sig, ack: cloneAck(out) });
      while (cache.size > MAX_OPS) cache.delete(cache.keys().next().value);
    }
    return out;
  }

  const town = msg.town;
  if (msg.op === 'list' || msg.op === 'quote') {
    const read = readCommerce(w, e, msg.op === 'list'
      ? { op: msg.op, town }
      : { op: msg.op, town, g: msg.g, n: msg.n, side: msg.side });
    const { ok, why, rev, ...extra } = read;
    return emit(w, e, msg, ok, why, rev, extra);
  }
  if (!validTown(town) || !TOWNS[town].walkable || townAt(w, e) !== town)
    return fail('far', tradeRev);
  if (!validGood(msg.g) || !['buy', 'sell'].includes(msg.op)
      || !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 500)
    return fail('command', tradeRev);
  const side = msg.op;
  const q = w.economy?.quote(town, msg.g, msg.n, side);

  if (!Number.isSafeInteger(msg.expectedTotal) || msg.expectedTotal < 0 || msg.expectedTotal > 1e9)
    return fail('command', tradeRev);
  if (busy(w, e) || w.ecs.regenT[e] < TRADE.calm)
    return fail('calm', tradeRev);
  if (!q?.ok) return emit(w, e, msg, false, 'price', tradeRev,
    { town, g: msg.g, n: msg.n, side, total: q?.total || 0, marketWhy: q?.why || 'market' });
  if (q.total !== msg.expectedTotal)
    return emit(w, e, msg, false, 'price', tradeRev, { town, g: msg.g, n: q.n, side, total: q.total, avg: q.avg });
  if (tradeRev >= MAX_REV) return fail('revisionLimit', tradeRev);
  const stock = { ...w.economy.markets[town].stock };
  const last = { ...w.economy.markets[town].last };
  const staged = Object.create(w.economy);
  staged.markets = { ...w.economy.markets, [town]: { ...w.economy.markets[town], stock, last } };
  const wallet = { gold: profile.gold, hold: cloneHold(profile.eco.pack) };
  const result = staged.trade(town, msg.g, msg.n, side, wallet);
  if (!result.ok) return emit(w, e, msg, false, result.why, tradeRev, { town, g: msg.g, n: msg.n });
  if (!Number.isSafeInteger(wallet.gold) || wallet.gold < 0 || wallet.gold > 1e9)
    return fail('gold', tradeRev);
  const eco = { ...profile.eco, tradeRev: tradeRev + 1, pack: wallet.hold };
  if (!saveCandidate(saveFits, profile, eco, wallet.gold)) return fail('saveSize', tradeRev);

  w.economy.markets[town].stock = stock;
  w.economy.markets[town].last = last;
  profile.gold = wallet.gold;
  profile.eco.pack = wallet.hold;
  profile.eco.tradeRev = tradeRev + 1;
  w.profileDirty?.add(e);
  const ack = emit(w, e, msg, true, '', profile.eco.tradeRev, { town, g: msg.g, n: result.n, side,
    total: result.total, avg: result.avg, gold: profile.gold,
    pack: { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } }, rows: marketRows(w, town) });
  cache.set(msg.opId, { signature: sig, ack: cloneAck(ack) });
  while (cache.size > MAX_OPS) cache.delete(cache.keys().next().value);
  return ack;
}
