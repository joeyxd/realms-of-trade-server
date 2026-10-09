// Trade goods (M7, PLAN-M7.md): prices and independent mass/volume per unit. Both dimensions
// use abstract game units; w remains a legacy volume alias. Masses are initial tuning, not kg.
// `perish`: the fraction a stock (and a hold) loses per game day; `illegal`: confiscated
// in towns under the Crown (law 'corona') and paid × LAW.sinley.contraband in lawless ones.
export const GOOD_CATS = {
  food: 'Víveres', drink: 'Bebida', material: 'Materiales', arms: 'Armamento', luxury: 'Lujo',
};

export const GOODS = {
  pescado: { name: 'Pescado salado', cat: 'food', base: 6, w: 1, volume: 1, mass: 1, perish: 0.01 },
  fruta: { name: 'Fruta tropical', cat: 'food', base: 5, w: 1, volume: 1, mass: 1, perish: 0.04 },
  harina: { name: 'Harina', cat: 'food', base: 7, w: 1, volume: 1, mass: 1 },
  galleta: { name: 'Galleta de barco', cat: 'food', base: 9, w: 1, volume: 1, mass: 1 },
  ron: { name: 'Ron', cat: 'drink', base: 22, w: 1, volume: 1, mass: 1 },
  agua: { name: 'Agua dulce', cat: 'drink', base: 2, w: 1, volume: 1, mass: 1 }, // rafts make it (purifier) and drink it (crops)
  cana: { name: 'Caña de azúcar', cat: 'material', base: 6, w: 2, volume: 2, mass: 2, perish: 0.02 },
  madera: { name: 'Madera', cat: 'material', base: 9, w: 3, volume: 3, mass: 3 },
  tronco: { name: 'Tronco recogido', cat: 'material', base: 5, w: 3, volume: 3, mass: 3 },
  piedra: { name: 'Piedra', cat: 'material', base: 4, w: 2, volume: 2, mass: 4 },
  hierro: { name: 'Hierro', cat: 'material', base: 16, w: 3, volume: 3, mass: 6 },
  mineral_hierro: { name: 'Mineral de hierro', cat: 'material', base: 8, w: 3, volume: 3, mass: 6 }, // raw ore; no refining recipe or automatic town stock
  azufre: { name: 'Azufre', cat: 'material', base: 11, w: 2, volume: 2, mass: 2 },
  lona: { name: 'Lona', cat: 'material', base: 13, w: 2, volume: 2, mass: 1 },
  polvora: { name: 'Pólvora', cat: 'arms', base: 28, w: 1, volume: 1, mass: 1, illegal: true },
  balas: { name: 'Balas de cañón', cat: 'arms', base: 14, w: 3, volume: 3, mass: 5 },
  tabaco: { name: 'Tabaco', cat: 'luxury', base: 26, w: 1, volume: 1, mass: 0.5 },
  especias: { name: 'Especias', cat: 'luxury', base: 42, w: 1, volume: 1, mass: 1 },
  seda: { name: 'Seda', cat: 'luxury', base: 58, w: 1, volume: 1, mass: 0.25 },
  coral: { name: 'Coral rojo', cat: 'luxury', base: 34, w: 1, volume: 1, mass: 1 },
  perlas: { name: 'Perlas blancas', cat: 'luxury', base: 75, w: 1, volume: 1, mass: 1 },
};
export const GOOD_IDS = Object.keys(GOODS);

// How towns treat law and goods. tax: on every trade; contraband: × price of illegal goods (0 = cannot be sold).
export const LAW = {
  libre: { name: 'Libre', tax: 0.04, contraband: 1.0 },
  mercante: { name: 'Gremio mercante', tax: 0.08, contraband: 1.0 },
  corona: { name: 'La Corona', tax: 0.12, contraband: 0 },
  sinley: { name: 'Sin ley', tax: 0, contraband: 1.5 },
};
