// «La Balsa» (PLAN-M6.md): a raft is a list of placed pieces on a grid (data/raftparts.js). This module says where a
// piece may go (connected foundations, supported floors, free cells, edges next to a deck), places and removes
// pieces paying from / refunding to a hold, works out what the raft does (floats, carries, sails, crew, turrets),
// and runs its production on the game clock (water → crops, nets → fish, grill and still recipes). Plain data,
// deterministic, saved in the profile with the ship (p.eco.ships[i].grid).
//
// A piece: [id, x, z, level, dir]. dir: edges only, 0 north (−z side of the cell), 1 east (+x), 2 south, 3 west.
import { RAFT, RAFT_PARTS, STARTER_RAFT } from '../../data/raftparts.js';
import { load, unload, holdUsed } from './cargo.js';

const key = (x, z, l) => `${x},${z},${l}`;
// An edge's canonical key: the north or west side of some cell.
const edgeKey = (x, z, l, d) => (d === 0 ? `${x},${z},${l},n` : d === 3 ? `${x},${z},${l},w` : d === 1 ? `${x + 1},${z},${l},w` : `${x},${z + 1},${l},n`);
const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Lookup tables of a piece list (rebuilt on change; rafts are small).
export function indexRaft(parts) {
  const ix = { base: new Set(), floor: new Set(), pillar: new Set(), roof: new Set(), tile: new Map(), edge: new Map(), minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let first = true;
  parts.forEach((p, i) => {
    const [id, x, z, l, d] = p, P = RAFT_PARTS[id];
    if (!P) return;
    if (P.layer === 'base') {
      ix.base.add(key(x, z, 0));
      if (first) { ix.minX = ix.maxX = x; ix.minZ = ix.maxZ = z; first = false; }
      ix.minX = Math.min(ix.minX, x); ix.maxX = Math.max(ix.maxX, x); ix.minZ = Math.min(ix.minZ, z); ix.maxZ = Math.max(ix.maxZ, z);
    } else if (P.layer === 'floor') ix.floor.add(key(x, z, l));
    else if (P.layer === 'pillar') ix.pillar.add(key(x, z, l));
    else if (P.layer === 'roof') ix.roof.add(key(x, z, l));
    else if (P.layer === 'edge') ix.edge.set(edgeKey(x, z, l, d), i);
    else if (P.layer === 'tile') { const [w, dd] = P.size || [1, 1]; for (let a = 0; a < w; a++) for (let b = 0; b < dd; b++) ix.tile.set(key(x + a, z + b, l), i); }
  });
  return ix;
}
// Is there something to stand on at (x, z, l): the deck (level 0) or a floor.
const standable = (ix, x, z, l) => (l === 0 ? ix.base.has(key(x, z, 0)) : ix.floor.has(key(x, z, l)));
// Does a floor at (x, z, l ≥ 1) have support right under it: a pillar, or a supporting wall on one of its edges.
function heldUp(ix, parts, x, z, l) {
  if (ix.pillar.has(key(x, z, l - 1))) return true;
  for (let d = 0; d < 4; d++) {
    const i = ix.edge.get(edgeKey(x, z, l - 1, d));
    if (i !== undefined && RAFT_PARTS[parts[i][0]].supports) return true;
  }
  return false;
}

// '' when piece [id, x, z, l, d] can go on the raft, else why: 'unknown', 'level', 'size' (too big a raft), 'adjacent'
// (a foundation must touch the raft), 'overlap', 'support' (a floor needs a pillar / wall under it or a held-up
// neighbour), 'deck' (nothing to stand on), 'edge' (an edge needs a deck or floor on one side).
export function canPlace(parts, piece, ix = indexRaft(parts)) {
  const [id, x, z, l = 0, d = 0] = piece, P = RAFT_PARTS[id];
  if (!P) return 'unknown';
  if (!(l >= 0 && l < RAFT.levels) || !Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(l)) return 'level';
  if (P.layer === 'base') {
    if (l !== 0) return 'level';
    if (ix.base.has(key(x, z, 0))) return 'overlap';
    if (ix.base.size >= RAFT.maxCells) return 'size';
    if (ix.base.size && !NB.some(([a, b]) => ix.base.has(key(x + a, z + b, 0)))) return 'adjacent';
    const w = Math.max(ix.maxX, x) - Math.min(ix.minX, x) + 1, dd = Math.max(ix.maxZ, z) - Math.min(ix.minZ, z) + 1;
    if (ix.base.size && (w > 12 || dd > 12)) return 'size';
    return '';
  }
  if (P.layer === 'floor') {
    if (l < 1) return 'level';
    if (ix.floor.has(key(x, z, l))) return 'overlap';
    if (heldUp(ix, parts, x, z, l)) return '';
    // One cell of overhang from a floor that is held up itself.
    return NB.some(([a, b]) => ix.floor.has(key(x + a, z + b, l)) && heldUp(ix, parts, x + a, z + b, l)) ? '' : 'support';
  }
  if (P.layer === 'pillar' || P.layer === 'roof') {
    const set = P.layer === 'pillar' ? ix.pillar : ix.roof;
    if (set.has(key(x, z, l))) return 'overlap';
    if (!standable(ix, x, z, l)) return 'deck';
    if (P.layer === 'pillar' && ix.tile.has(key(x, z, l))) return 'overlap';
    return '';
  }
  if (P.layer === 'edge') {
    if (!(d >= 0 && d <= 3)) return 'level';
    if (ix.edge.has(edgeKey(x, z, l, d))) return 'overlap';
    const [a, b] = NB[d];
    return standable(ix, x, z, l) || standable(ix, x + a, z + b, l) ? '' : 'edge';
  }
  const [w, dd] = P.size || [1, 1];
  for (let a = 0; a < w; a++) for (let b = 0; b < dd; b++) {
    if (!standable(ix, x + a, z + b, l)) return 'deck';
    if (ix.tile.has(key(x + a, z + b, l)) || ix.pillar.has(key(x + a, z + b, l))) return 'overlap';
  }
  if (P.rim && !NB.some(([a, b]) => !ix.base.has(key(x + a, z + b, 0)))) return 'edge'; // a net hangs over the water
  return '';
}

// A fresh raft (the starter by default).
export function newRaft(pieces = STARTER_RAFT) {
  const parts = [];
  for (const p of pieces) if (!canPlace(parts, p)) parts.push([p[0], p[1] | 0, p[2] | 0, p[3] | 0, p[4] | 0]);
  return { parts };
}

// Place a piece paying its cost from `store` (a hold: the raft's own, or your pack). Returns '' or why ('goods',
// or canPlace's).
export function place(raft, piece, store) {
  const why = canPlace(raft.parts, piece);
  if (why) return why;
  const P = RAFT_PARTS[piece[0]];
  for (const [g, n] of Object.entries(P.cost)) if ((store.goods[g] || 0) < n) return 'goods';
  for (const [g, n] of Object.entries(P.cost)) unload(store, g, n);
  raft.parts.push([piece[0], piece[1], piece[2], piece[3] || 0, piece[4] || 0]);
  return '';
}

// Remove piece i, refunding RAFT.refund of its cost into `store` (what fits). Refused ('needed') when another piece
// stops being valid without it (a foundation under a sail, a pillar under a floor, the link between two halves).
export function remove(raft, i, store) {
  const p = raft.parts[i];
  if (!p) return 'unknown';
  const rest = raft.parts.filter((_, k) => k !== i);
  const rebuilt = newRaft(rest).parts; // what survives being placed again in order
  if (rebuilt.length !== rest.length || !connected(rest)) return 'needed';
  raft.parts = rest;
  const P = RAFT_PARTS[p[0]];
  if (store) for (const [g, n] of Object.entries(P.cost)) { const k = Math.floor(n * RAFT.refund); if (k > 0) load(store, g, k); }
  return '';
}
function connected(parts) {
  const ix = indexRaft(parts), cells = [...ix.base];
  if (cells.length < 2) return true;
  const seen = new Set([cells[0]]), stack = [cells[0]];
  while (stack.length) {
    const [x, z] = stack.pop().split(',').map(Number);
    for (const [a, b] of NB) { const k = key(x + a, z + b, 0); if (ix.base.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); } }
  }
  return seen.size === cells.length;
}

// What the raft does. cargo: the hold's goods weigh too (half their space). Returns { cells, buoyancy, weight, load
// (weight / buoyancy: over 1 it rides low and slows), hold (space), speed (leagues per game hour, like
// data/ships.js), sail, engines, crew, turrets, research, light, anchor, respawn, makes {g: per day},
// needs {g: per day} }.
export function raftStats(raft, cargo = null) {
  const s = { cells: 0, buoyancy: 0, weight: 0, load: 0, hold: 0, speed: 0, sail: 0, engines: 0, crew: 0, turrets: 0, research: 0, light: 0, anchor: false, respawn: false, makes: {}, needs: {} };
  const ix = indexRaft(raft.parts);
  for (const [id, x, z, l] of raft.parts) {
    const P = RAFT_PARTS[id];
    if (!P) continue;
    s.weight += P.weight;
    if (P.floats) { s.cells++; s.buoyancy += RAFT.buoyancy; }
    s.hold += P.hold || 0; s.sail += P.sail || 0; s.engines += P.engine || 0; s.crew += P.crew || 0;
    s.turrets += P.turret || 0; s.research += P.research || 0; s.light += P.light || 0;
    if (P.anchor) s.anchor = true;
    if (P.respawn) s.respawn = true;
    for (const [g, n] of Object.entries(P.makes || {})) {
      const bonus = P.roofBonus && ix.roof.has(key(x, z, l)) ? P.roofBonus : 0; // a roof over the purifier catches rain
      s.makes[g] = (s.makes[g] || 0) + n + bonus;
    }
    for (const [g, n] of Object.entries(P.needs || {})) s.needs[g] = (s.needs[g] || 0) + n;
  }
  if (cargo) s.weight += holdUsed(cargo) * 0.5;
  s.load = s.buoyancy ? s.weight / s.buoyancy : 99;
  const power = s.sail + s.engines;
  let v = (RAFT.bareSpeed + 2.2 * power) / Math.sqrt(Math.max(1, s.weight / 40));
  if (s.load > 1) v *= Math.max(0.15, 1 - (s.load - 1) * 2); // overloaded: it wallows
  s.speed = Math.min(8, power > 0 ? v : RAFT.bareSpeed * 0.5); // no sail: you paddle
  return s;
}

// Run the raft's work over `days` game days with its hold: purifiers make water, crops drink it and grow (as far
// as the water goes), nets fish, the grill and the still work through their inputs, engines burn wood while
// `sailing`. Whatever does not fit in the hold is lost. Returns { made: {g: n}, used: {g: n} } (whole units moved;
// the fractions carry over in raft.acc).
export function stepRaft(raft, hold, days, { sailing = false } = {}) {
  const st = raftStats(raft), acc = raft.acc || (raft.acc = {});
  const made = {}, used = {};
  const add = (g, x) => { acc[g] = (acc[g] || 0) + x; const k = Math.floor(acc[g]); if (k > 0) { acc[g] -= k; if (load(hold, g, k)) made[g] = (made[g] || 0) + k; } };
  const take = (g, n) => { const k = Math.min(n, hold.goods[g] || 0); if (k > 0) { unload(hold, g, k); used[g] = (used[g] || 0) + k; } return k; };
  // Water first: what the purifiers make goes straight to the crops; the rest is stored.
  const water = (st.makes.agua || 0) * days, thirst = (st.needs.agua || 0) * days;
  const fromStore = thirst > water ? take('agua', Math.ceil(thirst - water)) : 0;
  const wet = thirst > 0 ? Math.min(1, (water + fromStore) / thirst) : 1;
  if (water > thirst) add('agua', water - thirst);
  for (const [g, n] of Object.entries(st.makes)) if (g !== 'agua') add(g, n * days * (RAFT_FED.has(g) ? wet : 1));
  // Recipes: each still / grill runs up to perDay batches a day while its inputs last.
  raft.parts.forEach(([id], i) => {
    const R = RAFT_PARTS[id] && RAFT_PARTS[id].recipe;
    if (!R) return;
    const k = '#' + i;
    acc[k] = (acc[k] || 0) + R.perDay * days;
    let batches = Math.floor(acc[k]);
    acc[k] -= batches;
    while (batches-- > 0 && Object.entries(R.in).every(([g, n]) => (hold.goods[g] || 0) >= n)) {
      for (const [g, n] of Object.entries(R.in)) take(g, n);
      for (const [g, n] of Object.entries(R.out)) add(g, n);
    }
  });
  if (sailing && st.engines) for (const [id] of raft.parts) { const P = RAFT_PARTS[id]; if (P && P.engine) take('madera', Math.ceil((P.needs.madera || 0) * days)); }
  return { made, used };
}
const RAFT_FED = new Set(['fruta', 'cana']); // the crops that need water

// A saved raft made safe: known pieces, placed again in order (whatever no longer fits is dropped), at most 600.
export function sanitizeRaft(raw) {
  const src = raw && Array.isArray(raw.parts) ? raw.parts.slice(0, 600) : null;
  if (!src) return newRaft();
  const parts = [];
  for (const p of src) {
    if (!Array.isArray(p) || !RAFT_PARTS[p[0]]) continue;
    const q = [p[0], p[1] | 0, p[2] | 0, p[3] | 0, p[4] | 0];
    if (!canPlace(parts, q)) parts.push(q);
  }
  return parts.length ? { parts } : newRaft();
}
