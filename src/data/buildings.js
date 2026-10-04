// Buildings and recipes (M8, PLAN-M8.md). A building stands on a town plot you own; workshops turn goods into goods
// on the game clock (recipes), their output waits in the building's store for you to collect (or sell straight to
// the town's market from a stall). cost: gold + goods, paid when you start; time: game hours to build; upkeep: gold
// per game day (unpaid: production stops); store: units it holds.
export const BUILDINGS = {
  casa: { name: 'Casa', size: 1, cost: { gold: 400, madera: 20 }, time: 6, upkeep: 2, store: 40, notes: 'Punto de reaparición y baúl' },
  puesto: { name: 'Puesto de mercado', size: 1, cost: { gold: 300, madera: 12, lona: 4 }, time: 4, upkeep: 3, store: 30, sells: true },
  almacen: { name: 'Almacén', size: 2, cost: { gold: 900, madera: 40, hierro: 6 }, time: 10, upkeep: 4, store: 300 },
  destileria: { name: 'Destilería', size: 2, cost: { gold: 1200, madera: 30, hierro: 10 }, time: 12, upkeep: 8, store: 60, recipes: ['ron'] },
  panaderia: { name: 'Horno de galleta', size: 1, cost: { gold: 700, madera: 20, hierro: 4 }, time: 8, upkeep: 5, store: 60, recipes: ['galleta'] },
  polvorin: { name: 'Polvorín', size: 2, cost: { gold: 1600, madera: 20, hierro: 16 }, time: 14, upkeep: 10, store: 40, recipes: ['polvora'], noLaw: ['corona'] },
  fundicion: { name: 'Fundición', size: 2, cost: { gold: 2000, madera: 20, hierro: 30 }, time: 16, upkeep: 12, store: 80, recipes: ['balas'] },
  astillero: { name: 'Astillero', size: 3, cost: { gold: 5000, madera: 120, hierro: 40, lona: 30 }, time: 30, upkeep: 20, store: 200, shipyard: true },
  taberna: { name: 'Taberna', size: 2, cost: { gold: 1500, madera: 40 }, time: 12, upkeep: 6, store: 60, recipes: [], notes: 'Tripulación y rumores' },
  fortin: { name: 'Fortín', size: 3, cost: { gold: 6000, madera: 80, hierro: 60, balas: 40 }, time: 36, upkeep: 25, store: 60, defense: 1 },
};
export const BUILDING_IDS = Object.keys(BUILDINGS);

// Recipes: in → out per batch, `hours` of game time per batch (one batch at a time per building).
export const RECIPES = {
  ron: { name: 'Ron', in: { cana: 4 }, out: { ron: 2 }, hours: 4 },
  galleta: { name: 'Galleta de barco', in: { harina: 3 }, out: { galleta: 4 }, hours: 2 },
  polvora: { name: 'Pólvora', in: { azufre: 3 }, out: { polvora: 2 }, hours: 6 },
  balas: { name: 'Balas de cañón', in: { hierro: 2 }, out: { balas: 3 }, hours: 3 },
};
