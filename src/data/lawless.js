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
};
