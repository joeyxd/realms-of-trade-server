// Encounters (PLAN-M2.5.md §2.3): scripted fights on the server. Pure data, edited live by F4 like tuning.
//   startR    stepping inside this circle at the centre of the arena starts it
//   radius    players inside are participants; none alive inside for wipeGrace s → reset
//   waves     groups of [kind, count]; `late` reinforcements come `after` s in (or when the rest is dead)
//   boss      kind and where it rises (u, v offsets from the arena centre, design frame of worldgen.js)
export const ENCOUNTERS = {
  caldera: {
    name: 'La Prueba de Fuego', startR: 3.2, radius: 21, wipeGrace: 6, intro: 1.5, rest: 4, cooldown: 40,
    spawnR: 14, spawnN: 10, gateGap: 35, riseT: 0.8,
    waves: [
      { groups: [['grunt', 5], ['archer', 2]] },
      { groups: [['imp', 4], ['grunt', 4], ['archer', 2]], late: { after: 8, groups: [['grunt', 5]] } },
      { groups: [['shaman', 3], ['imp', 3], ['grunt', 6]], late: { after: 10, groups: [['archer', 2], ['imp', 2], ['grunt', 4]] } },
    ],
    boss: { kind: 'hellfire', at: [7, 0], intro: 2.5, riseT: 2.0 },
  },
};
