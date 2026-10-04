// A town's market (M7, PLAN-M7.md): stock per good, a price that rises as stock falls below what the town wants to
// keep (and falls above it), the town making and eating goods on the game clock, and trades that move the price
// as they go (buying 50 costs more than 50 × the first unit). Pure and deterministic: the server owns the state.
//
// Price of one unit at stock s with the town's wanted stock W: base × clamp((W / s) ^ elastic, minK, maxK). Buying
// pays the unit price + half the spread + tax; selling gets − half the spread − tax. Illegal goods: × the law's
// contraband factor (0: refused).
//
// Where the stock sits on its own (the equilibrium E, what NPC traders and the town's life pull it back to): a town
// that makes a good and eats little of it holds more than it wants (cheap there), one that eats it and makes none
// holds less (dear): E = W × exp(swing × (produce − consume) / (produce + consume + balK)). That gap between towns
// is the trade: buy where E > W, sell where E < W, and your trades move both markets until they recover.
import { GOODS, LAW } from '../../data/goods.js';

export const MARKET = {
  elastic: 0.8, // how hard scarcity bites
  minK: 0.35, maxK: 4.0, // price floor / ceiling × base
  spread: 0.12, // buy − sell gap (the house's cut), before tax
  maxTrade: 500, // units per trade
  relax: 4, // game days for a market a player drained or flooded to get most of the way back (see stepMarket)
  minTarget: 4, // a good the town trades in but keeps none of: still priced as if it wanted a few
  swing: 1.0, balK: 2, // how far from W a pure producer / consumer sits (up to e: about 0.45 / 2.2 × base)
  wobble: 0.06, // day-to-day noise on the equilibrium
};

// A fresh market for town definition T: every stock at its equilibrium.
export function newMarket(id, T) {
  const stock = {};
  for (const g of goodsOf(T)) stock[g] = equilibrium(T, g);
  return { id, stock, last: {} };
}

// Where the stock of g settles in town T (see the header).
export function equilibrium(T, g) {
  const p = T.produce?.[g] || 0, c = T.consume?.[g] || 0;
  return target(T, g) * Math.exp(MARKET.swing * (p - c) / (p + c + MARKET.balK));
}

// The goods a town trades in: what it makes, eats or keeps.
export function goodsOf(T) {
  return [...new Set([...Object.keys(T.produce || {}), ...Object.keys(T.consume || {}), ...Object.keys(T.stock || {})])].filter((g) => GOODS[g]);
}
const target = (T, g) => Math.max(MARKET.minTarget, T.stock?.[g] ?? 0);

// Price of one unit of g at stock s (without spread or tax).
export function unitPrice(T, g, s) {
  const G = GOODS[g];
  const k = Math.pow(target(T, g) / Math.max(1, s), MARKET.elastic);
  return G.base * Math.min(MARKET.maxK, Math.max(MARKET.minK, k));
}

// What n units would cost (side 'buy') or fetch ('sell') right now, unit by unit as the stock moves.
// Returns { ok, why, n, total (gold, rounded), avg, unit (the next unit's price), law }.
export function quote(m, T, g, n, side) {
  const G = GOODS[g], law = LAW[T.law] || LAW.libre;
  n = Math.floor(n);
  if (!G || !(g in m.stock)) return { ok: false, why: 'good', n: 0, total: 0 };
  if (!(n > 0) || n > MARKET.maxTrade) return { ok: false, why: 'n', n: 0, total: 0 };
  const cf = G.illegal ? law.contraband : 1;
  if (cf <= 0) return { ok: false, why: 'law', n: 0, total: 0 };
  if (side === 'buy' && m.stock[g] < n) return { ok: false, why: 'stock', n: 0, total: 0, have: Math.floor(m.stock[g]) };
  const k = side === 'buy' ? (1 + MARKET.spread / 2) * (1 + law.tax) : (1 - MARKET.spread / 2) * (1 - law.tax);
  let s = m.stock[g], sum = 0;
  for (let i = 0; i < n; i++) {
    if (side === 'buy') { sum += unitPrice(T, g, s); s -= 1; } else { s += 1; sum += unitPrice(T, g, s); }
  }
  const total = Math.max(side === 'buy' ? 1 : 0, Math.round(sum * k * cf));
  return { ok: true, n, total, avg: total / n, unit: unitPrice(T, g, m.stock[g]) * k * cf, law: T.law };
}

// Carry out a quote: the stock moves (the caller moves the gold and the goods).
export function settle(m, g, n, side) {
  m.stock[g] += side === 'buy' ? -n : n;
  m.last[g] = side === 'buy' ? 1 : -1; // the latest pressure (UI trend arrow)
}

// One step of the town's life over `days` game days: spoilage, then the town (making, eating) and the NPC traders
// pull every stock toward its equilibrium (with a little wobble), so a market a player drained or flooded is most
// of the way back in about MARKET.relax days. rng: () → [0, 1).
export function stepMarket(m, T, days, rng = Math.random) {
  const pull = 1 - Math.exp(-days / MARKET.relax);
  for (const g of Object.keys(m.stock)) {
    const G = GOODS[g];
    let s = m.stock[g];
    if (G.perish) s *= Math.pow(1 - G.perish, days);
    const E = equilibrium(T, g) * (1 + MARKET.wobble * (2 * rng() - 1));
    s += (E - s) * pull;
    m.stock[g] = Math.max(0, s);
  }
}

// What the UI lists: every good with its stock and the buy / sell price of one unit.
export function board(m, T) {
  return Object.keys(m.stock).map((g) => {
    const b = quote(m, T, g, 1, 'buy'), s = quote(m, T, g, 1, 'sell');
    return { g, stock: Math.floor(m.stock[g]), buy: b.ok ? b.total : 0, sell: s.ok ? s.total : 0, trend: m.last[g] || 0, illegal: !!GOODS[g].illegal };
  });
}
