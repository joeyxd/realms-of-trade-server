// Loot tables (M4, PLAN-M4.md §2.3). Every player with a right to an enemy's XP rolls its table for
// themselves (personal loot). gold: [chance, min, max] · item / potion: chance · quest: {item: chance}, only
// while that quest is active. Item level = enemy level (+ the Marea's bonus).
export const LOOT = {
  grunt: { gold: [0.4, 1, 3], item: 0.03, potion: 0.02, quest: { coral: 0.1 } },
  archer: { gold: [0.6, 2, 5], item: 0.08, potion: 0.04 },
  imp: { gold: [0.5, 2, 4], item: 0.05, potion: 0.03 },
  shaman: { gold: [0.7, 4, 8], item: 0.12, potion: 0.06, quest: { coral: 0.5 } },
  crab: { gold: [0.8, 5, 10], item: 0.15, potion: 0.06, quest: { coral: 0.4 } },
  sentinel: { gold: [1, 8, 14], item: 0.35, potion: 0.15 },
  hellfire: { gold: [1, 40, 60], item: 0, potion: 0 }, // and a chest for each pirate who fought him
};

export const DROPS = {
  life: 120, // s on the ground
  pickR: 1.5, // walk this close and it is yours (a chest is opened with F instead)
  openR: 3,
  scatter: [0.7, 1.9], // u from the corpse
  // The boss chest: one item of at least `minRarity`, raised a step `upRolls` times with `upChance`, plus
  // `items` normal ones, gold and potions.
  chest: { minRarity: 2, upRolls: 2, upChance: 0.35, items: 2, gold: [60, 100], potions: 1 },
  profileEvery: 15, // ticks between two profile messages to the same player (pickups are shown at once anyway)
};
