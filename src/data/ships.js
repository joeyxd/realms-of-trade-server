// Ships (M6, PLAN-M6.md): hull classes, modules in slots, and the numbers a ship sails and fights with. Hold space is
// in the units of data/goods.js `w`. speed: leagues per game hour at sea (voyages) and u/s when sailing for real.
export const SHIP_SLOTS = ['cannon', 'hold', 'mast', 'cabin'];

export const HULLS = {
  bote: { name: 'Bote', hp: 120, speed: 3.0, turn: 2.4, hold: 8, crew: [1, 2], slots: { cannon: 0, hold: 0, mast: 1, cabin: 0 }, cost: 250 },
  balandra: { name: 'Balandra', hp: 400, speed: 4.5, turn: 1.6, hold: 24, crew: [2, 6], slots: { cannon: 2, hold: 1, mast: 1, cabin: 1 }, cost: 1800 },
  goleta: { name: 'Goleta', hp: 700, speed: 5.0, turn: 1.3, hold: 45, crew: [4, 12], slots: { cannon: 4, hold: 2, mast: 2, cabin: 1 }, cost: 5200 },
  bergantin: { name: 'Bergantín', hp: 1100, speed: 4.4, turn: 1.0, hold: 80, crew: [8, 20], slots: { cannon: 8, hold: 3, mast: 2, cabin: 2 }, cost: 12000 },
  galeon: { name: 'Galeón', hp: 2200, speed: 3.4, turn: 0.6, hold: 160, crew: [16, 40], slots: { cannon: 14, hold: 4, mast: 3, cabin: 3 }, cost: 32000 },
};
export const HULL_IDS = Object.keys(HULLS);

// Modules by slot. cannon: the v0 server's weapon table (bronce, metralla, pesado); hold: + space; mast: × speed;
// cabin: crew berths. cost: gold (and goods, built at a shipyard in M8).
export const MODULES = {
  cannon_bronce: { slot: 'cannon', name: 'Cañón de bronce', cooldown: 0.5, projectiles: 1, spread: 0, damage: 1.0, crew: 1, cost: 300 },
  cannon_metralla: { slot: 'cannon', name: 'Metralla', cooldown: 0.8, projectiles: 3, spread: 0.2, damage: 0.7, crew: 1, cost: 420 },
  cannon_pesado: { slot: 'cannon', name: 'Cañón pesado', cooldown: 1.0, projectiles: 1, spread: 0, damage: 2.0, crew: 2, cost: 700 },
  hold_pequena: { slot: 'hold', name: 'Bodega pequeña', capacity: 12, cost: 250 },
  hold_reforzada: { slot: 'hold', name: 'Bodega reforzada', capacity: 24, cost: 600 },
  mast_cangreja: { slot: 'mast', name: 'Vela cangreja', speedMult: 1.0, crew: 1, cost: 200 },
  mast_cuadra: { slot: 'mast', name: 'Vela cuadra', speedMult: 1.12, crew: 2, cost: 520 },
  cabin_litera: { slot: 'cabin', name: 'Literas', crewSlots: 3, cost: 180 },
  cabin_camarote: { slot: 'cabin', name: 'Camarote', crewSlots: 6, cost: 450 },
};

// A ship's numbers from its hull and modules (ids; unknown or misplaced ones ignored, each slot kind capped by the
// hull). Returns { hp, speed, turn, hold, cannons: [module ids], crewMin, crewMax, value }.
export function shipStats(hull, modules = []) {
  const H = HULLS[hull] || HULLS.bote;
  const used = { cannon: 0, hold: 0, mast: 0, cabin: 0 };
  const out = { hp: H.hp, speed: H.speed, turn: H.turn, hold: H.hold, cannons: [], crewMin: H.crew[0], crewMax: H.crew[1], value: H.cost };
  let mastMul = 1, masts = 0;
  for (const id of modules) {
    const M = MODULES[id];
    if (!M || used[M.slot] >= (H.slots[M.slot] || 0)) continue;
    used[M.slot]++;
    out.value += M.cost;
    if (M.slot === 'cannon') { out.cannons.push(id); out.crewMin += M.crew; }
    else if (M.slot === 'hold') out.hold += M.capacity;
    else if (M.slot === 'mast') { mastMul *= M.speedMult; masts++; out.crewMin += M.crew; }
    else if (M.slot === 'cabin') out.crewMax += M.crewSlots;
  }
  if (H.slots.mast && !masts) mastMul = 0.6; // a hull with no sail rows
  out.speed *= mastMul;
  out.crewMin = Math.min(out.crewMin, out.crewMax);
  return out;
}
