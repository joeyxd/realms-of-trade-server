// Building plots (M8, PLAN-M8.md): every town has a few; a player buys one, raises a building on it (paying gold +
// goods, waiting its build time), and workshops run their recipe batch after batch on the game clock while their
// inputs last and their upkeep is paid. Output waits in the building's store. Plain data, deterministic.
import { BUILDINGS, RECIPES } from '../../data/buildings.js';
import { TOWNS } from '../../data/towns.js';

export const PLOTS = { price: 500, hoursPerDay: 24 };

// A town's plots: [{ town, i, owner: '' (player key) , b: building id | '', state: 'empty' | 'building' | 'ready',
// done: game hour it finishes, recipe, batchT (hours into the batch), store: {g: n}, debt: unpaid upkeep days,
// owed: upkeep accrued but not yet paid (paid in whole coins) }].
export function newPlots(town) {
  const n = TOWNS[town]?.plots || 0;
  return Array.from({ length: n }, (_, i) => ({ town, i, owner: '', b: '', state: 'empty', done: 0, recipe: '', batchT: 0, store: {}, debt: 0, owed: 0 }));
}

const storeUsed = (p) => Object.values(p.store).reduce((a, n) => a + n, 0);

// Can `owner` (with wallet { gold, hold }) put building `kind` on plot p? Returns '' or the reason: 'owner', 'busy',
// 'unknown', 'law', 'gold', 'goods'. Goods come from the wallet's hold.
export function canBuild(p, kind, owner, wallet) {
  const B = BUILDINGS[kind];
  if (!B) return 'unknown';
  if (p.owner !== owner) return 'owner';
  if (p.state !== 'empty') return 'busy';
  if (B.noLaw && B.noLaw.includes(TOWNS[p.town].law)) return 'law';
  if (wallet.gold < (B.cost.gold || 0)) return 'gold';
  for (const [g, n] of Object.entries(B.cost)) if (g !== 'gold' && (wallet.hold.goods[g] || 0) < n) return 'goods';
  return '';
}

// Pay and start building (the caller checked canBuild). now: game hours.
export function startBuild(p, kind, wallet, now) {
  const B = BUILDINGS[kind];
  wallet.gold -= B.cost.gold || 0;
  for (const [g, n] of Object.entries(B.cost)) if (g !== 'gold') { wallet.hold.goods[g] -= n; if (!wallet.hold.goods[g]) delete wallet.hold.goods[g]; }
  Object.assign(p, { b: kind, state: 'building', done: now + B.time, recipe: (B.recipes || [])[0] || '', batchT: 0, store: {}, debt: 0 });
}

// Put goods into a building's store (inputs for its recipe), up to its space. Returns how many went in.
export function stock(p, g, n) {
  const B = BUILDINGS[p.b];
  if (!B) return 0;
  const k = Math.max(0, Math.min(n, B.store - storeUsed(p)));
  if (k > 0) p.store[g] = (p.store[g] || 0) + k;
  return k;
}
// Take goods out (to a hold or a market). Returns how many came out.
export function take(p, g, n) {
  const k = Math.max(0, Math.min(n, p.store[g] || 0));
  if (k > 0) { p.store[g] -= k; if (!p.store[g]) delete p.store[g]; }
  return k;
}

// Advance a plot from game hour `from` to `to`: finish building, then run recipe batches (inputs from the store,
// outputs into it while there is space). upkeep(p, days) → true when paid (the caller takes the gold); unpaid days
// pile up as debt and stop production until paid.
export function stepPlot(p, from, to, upkeep = () => true) {
  if (p.state === 'building' && to >= p.done) { p.state = 'ready'; from = Math.max(from, p.done); }
  if (p.state !== 'ready' || to <= from) return;
  const B = BUILDINGS[p.b];
  const days = (to - from) / PLOTS.hoursPerDay;
  if (B.upkeep && !upkeep(p, days)) { p.debt += days; return; }
  const R = RECIPES[p.recipe];
  if (!R) return;
  let t = to - from;
  while (t > 0) {
    const need = R.hours - p.batchT;
    if (p.batchT === 0) { // a batch starts only with its inputs and room for its outputs
      const hasIn = Object.entries(R.in).every(([g, n]) => (p.store[g] || 0) >= n);
      const outN = Object.values(R.out).reduce((a, n) => a + n, 0), inN = Object.values(R.in).reduce((a, n) => a + n, 0);
      if (!hasIn || storeUsed(p) - inN + outN > B.store) return;
      for (const [g, n] of Object.entries(R.in)) take(p, g, n);
      p.batchT = 1e-9;
    }
    if (t < need) { p.batchT += t; return; }
    t -= need;
    for (const [g, n] of Object.entries(R.out)) p.store[g] = (p.store[g] || 0) + n;
    p.batchT = 0;
  }
}
