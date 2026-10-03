// La Cala Calavera (M4.5, PLAN-M4.5.md): the island's lawless corner. Pure data, shared by the sim and the client.
// Inside the ring of skulls (map.lawlessAt) every pirate's blow lands on every other pirate in it, the loot is
// whoever's who walks over it first, and a pirate who falls there drops everything they carry.
export const LAWLESS = {
  pvpDmg: 0.6, // a pirate's blow on another pirate: × this (before their DEF)
  heavyStagger: 0.3, // the third hit, the lunge and the storm stagger a pirate this long
  shockStagger: 0.5, // a perfect guard staggers the pirate who struck it from close by
  shockR: 3.2,
  // What a fallen pirate leaves: seconds on the ground, u from the body.
  spill: { life: 180, scatter: [0.8, 2.6] },
  // Loot rolled inside lies there as long.
  publicLife: 150,
  // The Cala's mobs are harder and pay better (like a Marea: enemy HP and damage, item levels, rarity, XP, gold).
  tier: { name: 'Sin ley', hp: 1.6, dmg: 1.4, ilvl: 3, rar: 0.6, xp: 1.5, gold: 1.5 },
  // Mobs inside hurt each other: a bullet or a blow of one lands on any other mob inside (× this), and the one hit
  // turns on whoever hit it for `foe` s (a pirate's blow turns it back on the pirate). A mob that another mob finishes
  // off is still the kill of the last pirate who hurt it within `assist` s; with none, its loot drops for anyone and
  // nobody earns XP for watching.
  mobDmg: 1,
  foe: 6,
  assist: 8,
  rise: 1.1, // s a mob takes to stand up when it comes back (the Cala refills even with pirates around)
  // Who lives there: [kind, u, v] from the centre of the fort (the design frame of worldgen.js).
  spawns: [
    ['grunt', -8.5, 3.5], ['grunt', -8, 10], ['grunt', 9.5, -8.5], ['grunt', 11, -4.5],
    ['archer', 14, 6], ['archer', -13, -9], ['imp', 5.5, 11.5], ['imp', -4, -12],
    ['shaman', 12, -11], ['crab', -14, 8],
    // The Desalmados: renegade pirates who hunt pirates and mobs alike (not each other).
    ['renegado', 3, -6], ['pistolera', -7, 2], ['renegado', 15, -1],
  ],
  // Their names (one each, by spawn order).
  names: ['Cuervo Malasangre', 'La Viuda Roja', 'Tuerto Salazar', 'Garfio Mendoza', 'Mala Espina', 'Diente de Plata'],
  preferPirates: 0.7, // a Desalmado weighs a pirate's distance × this (it would rather hunt you)
  wake: 18, // u beyond the ring: with a pirate this close, the Desalmados hunt the mobs too
};
