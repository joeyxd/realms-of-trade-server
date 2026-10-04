// Towns and the sea between them (M6 / M7, PLAN-M6.md, PLAN-M7.md). Each town is a market (and later a zone you
// walk in): what it makes and eats per game day, its law, its building plots. Only the Isla de la Marea is a place
// you can walk today (the Aldea and the Cala); the others are reached by sailing (M6: until real sailing exists, a
// voyage is a timed trip with its risks, and the port is a market screen).
//
// produce / consume: units per game day at full population. stock: the stock the market drifts toward (its prices
// are base there); unset goods: none kept (the town buys them only if it consumes them). plots: building plots (M8).

export const ISLANDS = {
  marea: { name: 'Isla de la Marea', at: [0, 0], zone: 'marea' },
  sol: { name: 'Isla del Sol', at: [62, -18], zone: null },
  ceniza: { name: 'Isla Ceniza', at: [28, 46], zone: null },
  corona: { name: 'Isla de la Corona', at: [96, 22], zone: null },
  coral: { name: 'Arrecife de Coral', at: [-34, 52], zone: null },
};

export const TOWNS = {
  aldea: {
    name: 'Aldea de la Marea', island: 'marea', law: 'libre', walkable: true, plots: 6,
    // Where it is on the island (worldgen landmark) and how near you must be to trade (u).
    landmark: 'village', r: 22,
    produce: { pescado: 40, fruta: 30, cana: 18, madera: 12 },
    consume: { ron: 10, galleta: 12, hierro: 3, polvora: 2, lona: 3, tabaco: 3 },
    stock: { pescado: 120, fruta: 90, cana: 60, madera: 50, ron: 25, galleta: 30, hierro: 10, polvora: 6, lona: 10, tabaco: 8 },
  },
  cala: {
    name: 'Cala Calavera', island: 'marea', law: 'sinley', walkable: true, plots: 3,
    landmark: 'cala', r: 24,
    produce: { ron: 6, polvora: 2 },
    consume: { polvora: 5, especias: 3, seda: 3, tabaco: 4, galleta: 4, perlas: 1 },
    stock: { ron: 30, polvora: 12, especias: 4, seda: 2, tabaco: 10, galleta: 10, perlas: 2 },
  },
  sol: {
    name: 'Puerto Sol', island: 'sol', law: 'mercante', plots: 8,
    produce: { seda: 4, especias: 6, harina: 30, galleta: 20, lona: 12, tabaco: 8 },
    consume: { pescado: 25, fruta: 20, ron: 12, coral: 3, perlas: 1, madera: 10 },
    stock: { seda: 20, especias: 30, harina: 120, galleta: 80, lona: 50, tabaco: 40, pescado: 60, fruta: 50, ron: 30, coral: 8, perlas: 3, madera: 30 },
  },
  ceniza: {
    name: 'Bahía Ceniza', island: 'ceniza', law: 'libre', plots: 5,
    produce: { hierro: 20, azufre: 24, balas: 10, polvora: 4 },
    consume: { madera: 14, galleta: 14, ron: 8, fruta: 10, harina: 8 },
    stock: { hierro: 80, azufre: 90, balas: 40, polvora: 15, madera: 30, galleta: 30, ron: 20, fruta: 20, harina: 20 },
  },
  corona: {
    name: 'Fuerte Real', island: 'corona', law: 'corona', plots: 4,
    produce: { balas: 14, galleta: 16, hierro: 6 },
    consume: { ron: 14, tabaco: 6, madera: 12, lona: 8, pescado: 12, especias: 2, azufre: 6 },
    stock: { balas: 60, galleta: 60, hierro: 20, ron: 30, tabaco: 16, madera: 30, lona: 20, pescado: 30, especias: 6, azufre: 15 },
  },
  coral: {
    name: 'Arrecife', island: 'coral', law: 'libre', plots: 3,
    produce: { coral: 6, perlas: 2, pescado: 30 },
    consume: { harina: 10, ron: 6, hierro: 4, lona: 4, galleta: 6 },
    stock: { coral: 24, perlas: 6, pescado: 80, harina: 25, ron: 12, hierro: 8, lona: 10, galleta: 15 },
  },
};
export const TOWN_IDS = Object.keys(TOWNS);

// Sea lanes between towns: [a, b, leagues, danger 0..1 (storms, pirates, the Crown's patrols)]. Towns on the same
// island are a short coastal hop. Voyages take the shortest path (sim/economy/voyage.js).
export const LANES = [
  ['aldea', 'cala', 1, 0.15],
  ['aldea', 'sol', 6, 0.2],
  ['aldea', 'coral', 5, 0.25],
  ['aldea', 'ceniza', 6, 0.3],
  ['cala', 'coral', 4, 0.35],
  ['cala', 'ceniza', 5, 0.35],
  ['sol', 'corona', 4, 0.1],
  ['sol', 'ceniza', 6, 0.25],
  ['ceniza', 'corona', 7, 0.3],
];
