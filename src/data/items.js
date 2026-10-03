// Gear (M4, PLAN-M4.md §2.1): rarities, the stats gear can carry, item bases per slot and the random affixes.
// Pure data, shared by the sim (the server rolls and applies it), the client (tooltips, comparison) and F4.
//
// An item's budget is P = (2 + 0.8·level) × rarity.mul points. Its base spends P on its implicit stats (the
// `stats` weights; weapons with a drawback spend more or less than 1), each affix rolls P × affixRoll more.
// STATS[k].per is what one point buys. `flat` on a base is a fixed extra that ignores the budget.

export const RARITIES = [
  { id: 'common', name: 'Común', color: '#9aa3ad', weight: 55, mul: 1.0, affixes: 0 },
  { id: 'uncommon', name: 'Poco común', color: '#4cd964', weight: 28, mul: 1.3, affixes: 1 },
  { id: 'rare', name: 'Raro', color: '#3fa9ff', weight: 12, mul: 1.7, affixes: 2 },
  { id: 'epic', name: 'Épico', color: '#b36bff', weight: 4.2, mul: 2.2, affixes: 3 },
  { id: 'legendary', name: 'Legendario', color: '#ffc23d', weight: 0.8, mul: 3.0, affixes: 4 },
];
export const RARITY = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 };

export const ITEMS = {
  maxLevel: 15,
  budget: [2, 0.8], // P = budget[0] + budget[1]·level, × rarity.mul
  affixRoll: [0.3, 0.5], // each affix: P × this range
  value: { base: 3, perLevel: 2, rarityPow: 1.4, perAffix: 0.15 }, // gold: (base + perLevel·lvl) × mul^pow × (1 + perAffix·n)
  salvage: 0.25, // breaking an item anywhere pays this share of its value (Tía Perla pays all of it)
  bag: 24,
};

// Equipment slots. Abalorios (trinkets) fit either ring slot.
export const SLOTS = ['weapon', 'head', 'chest', 'boots', 'ring1', 'ring2'];
export const SLOT_NAMES = { weapon: 'Arma', head: 'Cabeza', chest: 'Pecho', boots: 'Botas', ring: 'Abalorio', ring1: 'Abalorio', ring2: 'Abalorio' };
export const slotFits = (baseSlot, slot) => baseSlot === slot || (baseSlot === 'ring' && (slot === 'ring1' || slot === 'ring2'));

// What gear can give. per: value of one budget point; pct: shown as a percentage; cap / min: the totals are
// clamped there; suffix: the name an item gets when this is its biggest affix.
export const STATS = {
  atk: { name: 'Ataque', per: 1, suffix: 'del Tiburón' },
  def: { name: 'Defensa', per: 1, suffix: 'del Arrecife' },
  hp: { name: 'Vida', per: 5, suffix: 'del Kraken' },
  crit: { name: 'Crítico', per: 0.005, pct: true, cap: 0.5, suffix: 'del Halcón' },
  critD: { name: 'Daño crítico', per: 0.03, pct: true, suffix: 'de la Barracuda' },
  spd: { name: 'Velocidad', per: 0.01, pct: true, min: -0.1, cap: 0.25, suffix: 'del Viento' },
  cdr: { name: 'Enfriamiento', per: 0.01, pct: true, cap: 0.3, suffix: 'de la Marea' },
  rip: { name: 'Carga de RIPOSTE', per: 0.03, pct: true, suffix: 'de la Tormenta' },
  refl: { name: 'Daño de reflejos', per: 0.025, pct: true, suffix: 'del Espejo' },
  guard: { name: 'Aguante', per: 3, suffix: 'del Ancla' },
  dash: { name: 'Recarga de dash', per: 0.02, pct: true, cap: 0.3, suffix: 'de la Gaviota' },
  xp: { name: 'Experiencia', per: 0.02, pct: true, suffix: 'del Sabio' },
  gold: { name: 'Oro encontrado', per: 0.04, pct: true, suffix: 'del Corsario' },
  pot: { name: 'Curación de pociones', per: 0.04, pct: true, suffix: 'del Ron' },
  kill: { name: 'Vida al matar', per: 1, suffix: 'de la Sangre' },
  // Base-only extras (never affixes): reflect windows in seconds (± ms on the tooltip), pistol cadence.
  win: { name: 'Ventana de reflejo', ms: true },
  fire: { name: 'Tiempo entre disparos', pct: true },
};
export const STAT_KEYS = Object.keys(STATS);

// Item bases. slot: weapon | head | chest | boots | ring. weapon: the kit it gives (data/weapons.js). min: the
// lowest item level it drops at. stats: how the budget is spent. flat: fixed extras.
export const BASES = {
  // Cutlasses
  sable: { name: 'Sable de cubierta', slot: 'weapon', weapon: 'sable', min: 1, stats: { atk: 1 }, look: 'sable' },
  daga: { name: 'Daga de abordaje', slot: 'weapon', weapon: 'sable', min: 2, stats: { atk: 0.85 }, flat: { win: 0.02 }, look: 'daga' },
  ancla: { name: 'Ancla de mano', slot: 'weapon', weapon: 'sable', min: 4, stats: { atk: 1.35 }, flat: { win: -0.02 }, look: 'ancla' },
  // Pistols
  chispa: { name: 'Pistolas de chispa', slot: 'weapon', weapon: 'pistolas', min: 1, stats: { atk: 1 }, look: 'pistolas' },
  duelo: { name: 'Pistolas de duelo', slot: 'weapon', weapon: 'pistolas', min: 2, stats: { atk: 0.9 }, flat: { crit: 0.04 }, look: 'pistolas' },
  trabuco: { name: 'Trabucos gemelos', slot: 'weapon', weapon: 'pistolas', min: 4, stats: { atk: 1.3 }, flat: { fire: 0.2 }, look: 'pistolas' },
  // Head
  panuelo: { name: 'Pañuelo rojo', slot: 'head', min: 1, stats: { hp: 1 } },
  tricornio: { name: 'Tricornio', slot: 'head', min: 1, stats: { def: 0.6, hp: 0.4 } },
  sombrero: { name: 'Sombrero de capitán', slot: 'head', min: 5, stats: { def: 0.5, crit: 0.5 } },
  // Chest
  chaleco: { name: 'Chaleco de lona', slot: 'chest', min: 1, stats: { hp: 1 } },
  casaca: { name: 'Casaca de oficial', slot: 'chest', min: 1, stats: { def: 1 } },
  coraza: { name: 'Coraza de coral', slot: 'chest', min: 4, stats: { def: 1.4 }, flat: { spd: -0.03 } },
  // Boots
  botas: { name: 'Botas de cubierta', slot: 'boots', min: 1, stats: { spd: 0.6, def: 0.4 } },
  altas: { name: 'Botas altas', slot: 'boots', min: 1, stats: { def: 0.6, hp: 0.4 } },
  viento: { name: 'Botas de viento', slot: 'boots', min: 5, stats: { spd: 0.6, dash: 0.4 } },
  // Trinkets
  anillo: { name: 'Anillo de coral', slot: 'ring', min: 1, stats: { crit: 1 } },
  diente: { name: 'Diente de tiburón', slot: 'ring', min: 1, stats: { atk: 0.7 } },
  brujula: { name: 'Brújula rota', slot: 'ring', min: 2, stats: { cdr: 1 } },
  amuleto: { name: 'Amuleto de ron', slot: 'ring', min: 1, stats: { pot: 0.6, hp: 0.4 } },
  moneda: { name: 'Moneda maldita', slot: 'ring', min: 3, stats: { gold: 0.7, xp: 0.3 } },
};
export const BASE_KINDS = Object.keys(BASES);
// The starting / rack weapon of each kit (common, level 1).
export const STARTER = { sable: 'sable', pistolas: 'chispa' };

// Affixes each slot can roll (an item never repeats one).
export const AFFIXES = {
  weapon: ['atk', 'crit', 'critD', 'cdr', 'rip', 'refl', 'kill'],
  head: ['def', 'hp', 'crit', 'cdr', 'guard', 'xp'],
  chest: ['def', 'hp', 'rip', 'refl', 'guard', 'pot', 'kill'],
  boots: ['def', 'hp', 'spd', 'dash', 'gold'],
  ring: ['atk', 'def', 'hp', 'crit', 'critD', 'spd', 'cdr', 'rip', 'xp', 'gold', 'pot'],
};

// Consumables and quest items (not equipment).
export const CONSUMABLES = {
  potion: { name: 'Poción de ron-coco', heal: 0.4, cd: 2, max: 5, start: 2, price: 25 },
  crate: { name: 'Cofre misterioso', price: 120 },
};
export const QUEST_ITEMS = {
  coral: { name: 'Fragmento de coral', color: '#ff7a8a' },
};
