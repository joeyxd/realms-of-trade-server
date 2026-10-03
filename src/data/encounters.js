// Encounters (PLAN-M2.5.md §2.3, PLAN-M3.md §2.3): scripted fights on the server. Pure data, edited live by F4 like tuning.
//   startR    stepping inside this circle at the centre of the arena starts it
//   radius    players inside are participants; none alive inside for wipeGrace s → reset
//   waves     groups of [kind, count]; `late` reinforcements come `after` s in (or when the rest is dead)
//   boss      kind and where it rises (u, v offsets from the arena centre, design frame of worldgen.js)
//   coopHp    co-op (M3.6): each participant beyond the first adds this much to every wave enemy's HP
//   coopBossHp      … and this much to the boss's (and its minions')
export const ENCOUNTERS = {
  caldera: {
    name: 'La Prueba de Fuego', startR: 3.2, radius: 21, wipeGrace: 6, intro: 1.5, rest: 4, cooldown: 40,
    spawnR: 14, spawnN: 10, gateGap: 35, riseT: 0.8, coopHp: 0.6, coopBossHp: 0.75,
    // Mareas (M4): how hard the trial is. Beating one opens the next; you pick yours at the runes and in co-op
    // the lowest of the crew that starts it rules. hp / dmg: enemy multipliers (with the co-op one); ilvl:
    // levels added to the loot; rar: rarity bonus (data/items.js); xp, gold: multipliers.
    tiers: [
      { name: 'Marea I', hp: 1, dmg: 1, ilvl: 0, rar: 0, xp: 1, gold: 1 },
      { name: 'Marea II', hp: 1.7, dmg: 1.35, ilvl: 3, rar: 0.5, xp: 1.6, gold: 1.5 },
      { name: 'Marea III', hp: 2.6, dmg: 1.7, ilvl: 6, rar: 1, xp: 2.4, gold: 2.2 },
    ],
    tierR: 6, // u from the runes where you can change your Marea (F)
    waves: [
      { groups: [['grunt', 5], ['archer', 2]] },
      { groups: [['imp', 4], ['grunt', 4], ['archer', 2]], late: { after: 8, groups: [['grunt', 5]] } },
      { groups: [['shaman', 3], ['imp', 3], ['grunt', 6]], late: { after: 10, groups: [['archer', 2], ['imp', 2], ['grunt', 4]] } },
      // M3: the mortar crabs (flank them, or send their own bullets back).
      { groups: [['crab', 2], ['archer', 2], ['imp', 3], ['grunt', 6]], late: { after: 8, groups: [['crab', 1], ['grunt', 5]] } },
      { groups: [['crab', 3], ['shaman', 2], ['grunt', 6]], late: { after: 10, groups: [['imp', 3], ['archer', 2], ['grunt', 5]] } },
    ],
    boss: { kind: 'hellfire', at: [7, 0], intro: 2.5, riseT: 2.0 },
  },
};
