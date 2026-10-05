// The world's economy (M7 / M8, PLAN-M7.md): the game clock, every town's market and building plots, stepped by
// the server at a low rate. Shared by all players (the markets are the same for everyone). Deterministic from the
// seed; serialize() / Economy.from() are what M5 stores in the database (in solo it lives as long as the session).
//
// The clock: one game day = ECON.daySec seconds of sim time (the render's day–night cycle should follow it:
// economy.hours % 24). Players' own trade state (gold, pack, ships, plot deeds) lives in their profile (p.eco,
// systems/trade.js); here only what towns hold.
import { TOWNS, TOWN_IDS } from '../../data/towns.js';
import { mulberry32 } from '../../core/rng.js';
import { newMarket, stepMarket, quote, settle, board } from './market.js';
import { newPlots, stepPlot } from './plots.js';
import { load, unload, roomFor } from './cargo.js';
import { BUILDINGS, RECIPES } from '../../data/buildings.js';
import { GOOD_IDS } from '../../data/goods.js';
import { CLOCK } from '../../data/clock.js';

const upkeepOf = (p) => (BUILDINGS[p.b] ? BUILDINGS[p.b].upkeep : 0);

export const ECON = {
  daySec: CLOCK.daySec, // one game day in sim seconds (16 min, the day–night cycle's length)
  tickSec: 5, // how often markets and plots advance
  startHour: CLOCK.startHour,
};

export class Economy {
  constructor(seed = 1, { startHour = ECON.startHour } = {}) {
    this.rng = mulberry32((seed ^ 0x0ec0ec0) >>> 0);
    this.hours = startHour;
    this.acc = 0;
    this.markets = {};
    this.plots = {};
    for (const id of TOWN_IDS) { this.markets[id] = newMarket(id, TOWNS[id]); this.plots[id] = newPlots(id); }
    // Upkeep of owned buildings: (ownerKey, gold) → true when paid. The world wires it to the owners' profiles.
    this.payUpkeep = () => true;
  }

  get day() { return Math.floor(this.hours / 24); }
  get hourOfDay() { return this.hours % 24; }

  // Sim seconds pass (called every tick with DT; work happens every ECON.tickSec).
  step(dt) {
    this.acc += dt;
    while (this.acc >= ECON.tickSec) { this.acc -= ECON.tickSec; this.advance(ECON.tickSec); }
  }

  // Jump `sec` sim seconds (also: a voyage's or a test's fast-forward).
  advance(sec) {
    const h = (sec / ECON.daySec) * 24, from = this.hours, to = from + h;
    for (const id of TOWN_IDS) stepMarket(this.markets[id], TOWNS[id], h / 24, this.rng);
    for (const id of TOWN_IDS) {
      for (const p of this.plots[id]) {
        if (!p.owner) continue;
        // Upkeep accrues by the fraction and is paid in whole coins as it comes due.
        stepPlot(p, from, to, (pl, days) => {
          pl.owed = (pl.owed || 0) + upkeepOf(pl) * days;
          const due = Math.floor(pl.owed);
          if (due <= 0) return true;
          if (!this.payUpkeep(pl.owner, due)) return false;
          pl.owed -= due;
          return true;
        });
      }
    }
    this.hours = to;
  }

  quote(town, g, n, side) {
    const T = TOWNS[town], m = this.markets[town];
    if (!T || !m) return { ok: false, why: 'town', n: 0, total: 0 };
    return quote(m, T, g, n, side);
  }

  // Trade with a wallet { gold, hold }: buy moves goods into the hold and gold out; sell the reverse. Returns the
  // quote with ok / why ('gold', 'room', 'have', and quote's 'good' | 'n' | 'law' | 'stock').
  trade(town, g, n, side, wallet) {
    const q = this.quote(town, g, n, side);
    if (!q.ok) return q;
    if (side === 'buy') {
      if (wallet.gold < q.total) return { ...q, ok: false, why: 'gold' };
      if (roomFor(wallet.hold, g) < q.n) return { ...q, ok: false, why: 'room' };
      wallet.gold -= q.total;
      load(wallet.hold, g, q.n);
    } else {
      if ((wallet.hold.goods[g] || 0) < q.n) return { ...q, ok: false, why: 'have' };
      unload(wallet.hold, g, q.n);
      wallet.gold += q.total;
    }
    settle(this.markets[town], g, q.n, side);
    return q;
  }

  board(town) { const T = TOWNS[town]; return T ? board(this.markets[town], T) : []; }

  serialize() {
    return { v: 2, hours: this.hours, acc: this.acc, rng: this.rng.state(), markets: this.markets, plots: this.plots };
  }
  static from(json, seed = 1) {
    const e = new Economy(seed);
    if (!json || ![1, 2].includes(json.v)) return e;
    e.hours = Number.isFinite(json.hours) && json.hours >= 0 ? json.hours : ECON.startHour;
    e.acc = Number.isFinite(json.acc) && json.acc >= 0 && json.acc < ECON.tickSec ? json.acc : 0;
    if (json.v === 2 && Number.isInteger(json.rng) && json.rng >= 0 && json.rng <= 0xffffffff) e.rng = mulberry32(json.rng);
    for (const id of TOWN_IDS) {
      const m = json.markets && json.markets[id];
      if (m && m.stock) for (const g of Object.keys(e.markets[id].stock)) if (Number.isFinite(m.stock[g])) e.markets[id].stock[g] = Math.max(0, m.stock[g]);
      if (m && m.last) for (const g of Object.keys(e.markets[id].stock)) {
        if (Object.hasOwn(m.last, g) && [-1, 0, 1].includes(m.last[g])) e.markets[id].last[g] = m.last[g];
      }
      const ps = json.plots && json.plots[id];
      if (Array.isArray(ps)) ps.forEach((p, i) => {
        const out = e.plots[id][i];
        if (!out || !p || typeof p !== 'object') return;
        out.owner = typeof p.owner === 'string' && /^[a-z0-9]{1,24}$/.test(p.owner) ? p.owner : '';
        out.b = Object.hasOwn(BUILDINGS, p.b) ? p.b : '';
        out.state = out.b && ['building', 'ready'].includes(p.state) ? p.state : 'empty';
        out.recipe = (BUILDINGS[out.b]?.recipes || []).includes(p.recipe) ? p.recipe : '';
        for (const k of ['done', 'debt', 'owed']) out[k] = Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : 0;
        const batchHours = RECIPES[out.recipe]?.hours || 0;
        out.batchT = Number.isFinite(p.batchT) && p.batchT >= 0 && p.batchT < batchHours ? p.batchT : 0;
        out.store = {};
        if (p.store && typeof p.store === 'object') for (const g of GOOD_IDS) {
          if (Number.isFinite(p.store[g]) && p.store[g] > 0) out.store[g] = p.store[g];
        }
      });
    }
    return e;
  }
}
