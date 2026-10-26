// Voyages between towns (M6, PLAN-M6.md): the shortest sea path, how long it takes a ship, and what happens on the
// way. Until sailing is real, a voyage is a timed trip (the ship is away; you arrive at the port's market) whose
// events are rolled at departure from a seeded RNG, so the server and a replay agree. When M6 makes the sea a zone,
// the same rolls place the encounters on the lane.
import { TOWNS, LANES } from '../../data/towns.js';
import { GOODS } from '../../data/goods.js';

export const VOYAGE = {
  hoursPerLeague: 1, // game hours per league at speed 1 (a ship's speed divides it)
  minHours: 0.5,
  // Per league of danger: chance of each event (× lane danger), and what it does.
  events: {
    storm: { p: 0.06, hold: 0.08, hull: 0.1, hours: 1.5 }, // loses a share of the cargo, damages the hull, delays
    pirates: { p: 0.05, fight: true }, // a boarding fight (M6: a real encounter; now: lose a share unless escorted)
    patrol: { p: 0.04, contraband: true }, // the Crown searches: illegal goods confiscated, a fine
    calm: { p: 0.03, hours: 2 },
  },
};

// Shortest path from a to b over LANES (Dijkstra; leagues). Returns { path: [town ids], leagues, danger (the
// league-weighted mean) } or null.
export function seaPath(a, b) {
  if (!TOWNS[a] || !TOWNS[b]) return null;
  if (a === b) return { path: [a], leagues: 0, danger: 0 };
  const dist = { [a]: 0 }, prev = {}, dang = { [a]: 0 }, open = new Set([a]), done = new Set();
  while (open.size) {
    let u = null;
    for (const x of open) if (u === null || dist[x] < dist[u]) u = x;
    open.delete(u); done.add(u);
    if (u === b) break;
    for (const [p, q, L, d] of LANES) {
      const v = p === u ? q : q === u ? p : null;
      if (!v || done.has(v)) continue;
      const nd = dist[u] + L;
      if (dist[v] === undefined || nd < dist[v]) { dist[v] = nd; prev[v] = u; dang[v] = dang[u] + L * d; open.add(v); }
    }
  }
  if (dist[b] === undefined) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev[path[0]]);
  return { path, leagues: dist[b], danger: dist[b] ? dang[b] / dist[b] : 0 };
}

// Game hours a ship with `speed` takes over `leagues`.
export const voyageHours = (leagues, speed) => Math.max(VOYAGE.minHours, (leagues * VOYAGE.hoursPerLeague) / Math.max(0.1, speed));

// Plan a voyage: path, duration and the events on the way (rolled now). rng: seeded () → [0, 1).
// Returns { ok, why, path, leagues, hours, events: [{ kind, at (0..1 of the trip) }] }.
export function planVoyage(from, to, ship, rng) {
  const sp = seaPath(from, to);
  if (!sp) return { ok: false, why: 'route' };
  if (sp.leagues === 0) return { ok: false, why: 'here' };
  const events = [];
  for (let l = 0; l < Math.ceil(sp.leagues); l++) {
    for (const [kind, E] of Object.entries(VOYAGE.events)) if (rng() < E.p * (0.5 + sp.danger * 2)) events.push({ kind, at: (l + rng()) / Math.ceil(sp.leagues) });
  }
  events.sort((x, y) => x.at - y.at);
  let hours = voyageHours(sp.leagues, ship.speed);
  for (const ev of events) hours += VOYAGE.events[ev.kind].hours || 0;
  return { ok: true, path: sp.path, leagues: sp.leagues, danger: sp.danger, hours, events };
}

// Apply a voyage's events to a hold (and report): storms spill a share, patrols take illegal goods (and fine
// `fineK` × their base value), pirates take a share unless `escort`. Returns { lost: {g: n}, fine, hull (damage
// share), log: [strings for the UI] }. rng for which goods.
export function resolveVoyage(plan, hold, { rng, escort = false, fineK = 0.5, lawAt = () => 'libre' } = {}) {
  const out = { lost: {}, fine: 0, hull: 0, log: [] };
  const take = (share, why) => {
    for (const [g, n] of Object.entries(hold.goods)) {
      const k = Math.floor(n * share * (0.7 + 0.6 * rng()));
      if (k > 0) { hold.goods[g] -= k; if (!hold.goods[g]) delete hold.goods[g]; out.lost[g] = (out.lost[g] || 0) + k; }
    }
    out.log.push(why);
  };
  for (const ev of plan.events) {
    const E = VOYAGE.events[ev.kind];
    if (ev.kind === 'storm') { take(E.hold, 'storm'); out.hull += E.hull; }
    else if (ev.kind === 'pirates') { if (!escort) take(0.25, 'pirates'); else out.log.push('pirates-escaped'); }
    else if (ev.kind === 'patrol') {
      // Patrols sail the Crown's waters: they search when the voyage touches a Crown town.
      if (!plan.path.some((t) => lawAt(t) === 'corona')) continue;
      for (const [g, n] of Object.entries(hold.goods)) {
        if (!GOODS[g].illegal) continue;
        out.lost[g] = (out.lost[g] || 0) + n; out.fine += Math.round(n * GOODS[g].base * fineK);
        delete hold.goods[g];
      }
      out.log.push('patrol');
    } else out.log.push(ev.kind);
  }
  return out;
}
