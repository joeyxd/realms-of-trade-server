// «La Balsa» (PLAN-M6.md): your ship is a floating home you build piece by piece on a grid, from a bare raft to a
// floating fortress. Every piece has a place on the grid (a cell, a cell edge, or the deck under it), a cost in
// goods, a weight, and what it does (float, carry, sail, grow, fish, cook, defend, sleep). The numbers a raft
// sails and works with come from its pieces (sim/economy/raft.js raftStats).
//
// Grid: cells of RAFT.cell u, levels 0 (the deck on the foundations) up to RAFT.levels − 1.
//   base   a foundation (level 0 only): floats (+ buoyancy), the deck you stand on
//   floor  a floor on a level ≥ 1 (needs support below: a pillar or a wall, or a supported floor next to it)
//   tile   sits on a deck or floor cell, one per cell (storage, crop plot, grill, bed, sail, engine, turret…)
//   edge   on a cell edge (wall, door, window, railing): needs a deck or floor on one side
//   pillar holds up the floor above its cell
//   roof   tops a cell (shade; rain catch with a purifier under it)
//   stairs a tile that joins a level with the one above
// size: [w, d] cells (tiles). cost: goods (and gold) to place; weight: units against the raft's buoyancy.
export const RAFT = { cell: 2, levelHeight: 2.6, levels: 3, maxCells: 12 * 12, buoyancy: 14, refund: 0.5, bareSpeed: 0.6 };

export const RAFT_PARTS = {
  foundation: { name: 'Cimiento', layer: 'base', cost: { madera: 4 }, weight: 4, hp: 60, floats: 1 },
  floor: { name: 'Piso', layer: 'floor', cost: { madera: 3 }, weight: 3, hp: 40 },
  pillar: { name: 'Pilar', layer: 'pillar', cost: { madera: 2 }, weight: 2, hp: 50 },
  wall: { name: 'Pared', layer: 'edge', cost: { madera: 3 }, weight: 3, hp: 50, supports: true },
  door: { name: 'Puerta', layer: 'edge', cost: { madera: 3, hierro: 1 }, weight: 3, hp: 40, supports: true, open: true },
  window: { name: 'Ventana', layer: 'edge', cost: { madera: 3 }, weight: 3, hp: 35, supports: true },
  railing: { name: 'Barandilla', layer: 'edge', cost: { madera: 1 }, weight: 1, hp: 20, open: true },
  roof: { name: 'Techo', layer: 'roof', cost: { madera: 2, lona: 1 }, weight: 2, hp: 30 },
  stairs: { name: 'Escalera', layer: 'tile', size: [1, 1], cost: { madera: 4 }, weight: 3, hp: 30, climb: 1 },
  ladder: { name: 'Escala', layer: 'tile', size: [1, 1], cost: { madera: 2 }, weight: 1, hp: 20, climb: 1 },
  sail: { name: 'Vela', layer: 'tile', size: [1, 1], cost: { madera: 6, lona: 6 }, weight: 4, hp: 40, sail: 1.0 },
  bigSail: { name: 'Vela mayor', layer: 'tile', size: [2, 2], cost: { madera: 14, lona: 16, hierro: 2 }, weight: 10, hp: 80, sail: 2.6 },
  engine: { name: 'Motor de vapor', layer: 'tile', size: [1, 1], cost: { hierro: 12, madera: 4 }, weight: 10, hp: 80, engine: 1.4, needs: { madera: 4 } },
  anchor: { name: 'Ancla', layer: 'tile', size: [1, 1], cost: { hierro: 6 }, weight: 5, hp: 60, anchor: 1 },
  storage: { name: 'Bodega', layer: 'tile', size: [1, 1], cost: { madera: 6 }, weight: 3, hp: 40, hold: 20 },
  chest: { name: 'Cofre', layer: 'tile', size: [1, 1], cost: { madera: 3, hierro: 1 }, weight: 2, hp: 30, hold: 8, locked: true },
  crate: { name: 'Caja', layer: 'tile', size: [1, 1], cost: { madera: 2 }, weight: 1, hp: 15, hold: 6 },
  cropPlot: { name: 'Huerto', layer: 'tile', size: [1, 1], cost: { madera: 3, fruta: 2 }, weight: 4, hp: 25, makes: { fruta: 5 }, needs: { agua: 2 } },
  canePlot: { name: 'Cañaveral', layer: 'tile', size: [1, 1], cost: { madera: 3, cana: 2 }, weight: 4, hp: 25, makes: { cana: 4 }, needs: { agua: 2 } },
  purifier: { name: 'Purificador', layer: 'tile', size: [1, 1], cost: { hierro: 3, madera: 2 }, weight: 3, hp: 30, makes: { agua: 10 }, roofBonus: 4 },
  net: { name: 'Red de pesca', layer: 'tile', size: [1, 1], cost: { lona: 3, madera: 2 }, weight: 2, hp: 20, makes: { pescado: 6 }, rim: true },
  grill: { name: 'Parrilla', layer: 'tile', size: [1, 1], cost: { hierro: 2, madera: 2 }, weight: 3, hp: 30, recipe: { in: { pescado: 2 }, out: { galleta: 2 }, perDay: 6 } },
  still: { name: 'Alambique', layer: 'tile', size: [1, 1], cost: { hierro: 6, madera: 4 }, weight: 5, hp: 40, recipe: { in: { cana: 4 }, out: { ron: 2 }, perDay: 3 } },
  research: { name: 'Mesa de cartas', layer: 'tile', size: [1, 1], cost: { madera: 6, lona: 2 }, weight: 3, hp: 30, research: 1 },
  bed: { name: 'Hamaca', layer: 'tile', size: [1, 1], cost: { madera: 2, lona: 3 }, weight: 1, hp: 15, crew: 1, respawn: true },
  bunk: { name: 'Litera', layer: 'tile', size: [1, 1], cost: { madera: 5, lona: 4 }, weight: 3, hp: 25, crew: 2 },
  lantern: { name: 'Farol', layer: 'tile', size: [1, 1], cost: { hierro: 1, madera: 1 }, weight: 1, hp: 10, light: 1 },
  turret: { name: 'Cañón giratorio', layer: 'tile', size: [1, 1], cost: { hierro: 10, madera: 4, balas: 6 }, weight: 8, hp: 90, turret: 1 },
  decor: { name: 'Adorno', layer: 'tile', size: [1, 1], cost: { madera: 1 }, weight: 1, hp: 10 },
};
export const RAFT_PART_IDS = Object.keys(RAFT_PARTS);

// What you start with: a bare 2 × 2 raft with a sail and a crate.
export const STARTER_RAFT = [
  ['foundation', 0, 0, 0], ['foundation', 1, 0, 0], ['foundation', 0, 1, 0], ['foundation', 1, 1, 0],
  ['sail', 0, 0, 0], ['crate', 1, 1, 0],
];

// Flags and paint (cosmetic, PLAN-M6.md): the banner flown and the deck's colour.
export const RAFT_LOOKS = {
  banners: ['calavera', 'franjas', 'kraken', 'ojo'],
  paints: [0x9a6a3c, 0xc39a6a, 0x5a3a22, 0x3a5a7a, 0x7a3a3a, 0x3a7a5a, 0xc9a24a, 0x2a2a2a],
};
