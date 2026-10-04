// Trade goods (M7, PLAN-M7.md): what towns make, eat and pay for, what holds carry. Prices are per unit; `w` is the
// hold space one unit takes; `perish`: the fraction a stock (and a hold) loses per game day; `illegal`: confiscated
// in towns under the Crown (law 'corona') and paid × LAW.sinley.contraband in lawless ones.
export const GOOD_CATS = {
  food: 'Víveres', drink: 'Bebida', material: 'Materiales', arms: 'Armamento', luxury: 'Lujo',
};

export const GOODS = {
  pescado: { name: 'Pescado salado', cat: 'food', base: 6, w: 1, perish: 0.01 },
  fruta: { name: 'Fruta tropical', cat: 'food', base: 5, w: 1, perish: 0.04 },
  harina: { name: 'Harina', cat: 'food', base: 7, w: 1 },
  galleta: { name: 'Galleta de barco', cat: 'food', base: 9, w: 1 },
  ron: { name: 'Ron', cat: 'drink', base: 22, w: 1 },
  cana: { name: 'Caña de azúcar', cat: 'material', base: 6, w: 2, perish: 0.02 },
  madera: { name: 'Madera', cat: 'material', base: 9, w: 3 },
  hierro: { name: 'Hierro', cat: 'material', base: 16, w: 3 },
  azufre: { name: 'Azufre', cat: 'material', base: 11, w: 2 },
  lona: { name: 'Lona', cat: 'material', base: 13, w: 2 },
  polvora: { name: 'Pólvora', cat: 'arms', base: 28, w: 1, illegal: true },
  balas: { name: 'Balas de cañón', cat: 'arms', base: 14, w: 3 },
  tabaco: { name: 'Tabaco', cat: 'luxury', base: 26, w: 1 },
  especias: { name: 'Especias', cat: 'luxury', base: 42, w: 1 },
  seda: { name: 'Seda', cat: 'luxury', base: 58, w: 1 },
  coral: { name: 'Coral rojo', cat: 'luxury', base: 34, w: 1 },
  perlas: { name: 'Perlas blancas', cat: 'luxury', base: 75, w: 1 },
};
export const GOOD_IDS = Object.keys(GOODS);

// How towns treat law and goods. tax: on every trade; contraband: × price of illegal goods (0 = cannot be sold).
export const LAW = {
  libre: { name: 'Libre', tax: 0.04, contraband: 1.0 },
  mercante: { name: 'Gremio mercante', tax: 0.08, contraband: 1.0 },
  corona: { name: 'La Corona', tax: 0.12, contraband: 0 },
  sinley: { name: 'Sin ley', tax: 0, contraband: 1.5 },
};
