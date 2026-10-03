// Quests and what the island's people say (M4, PLAN-M4.md §2.5). Pure data: the server tracks progress
// (systems/quests.js), the client draws the tracker, the journal and the dialogs from it.
//   goal.kind  zone {zone} · talk {npc} · kill {enemy: [kinds] | enc: encounter id, n} · win {enc} ·
//              collect {item, n} (quest items drop only while the quest wants them)
//   auto       starts by itself (the main chain: one leads to the next, no walking back)
//   giver      the NPC who offers it (talk to accept); turnin: the NPC who takes it back (else it completes at once)
//   requires   another quest done first · repeat: can be taken again once handed in
//   reward     {xp, gold, potions, item: {slot, rarity}} (the item is of your level)
export const QUESTS = {
  tierra: {
    name: 'Tierra firme', text: 'Sigue los faroles de la playa hasta la Aldea Coralina.',
    auto: true, goal: { kind: 'zone', zone: 'aldea' }, reward: { xp: 40 }, next: 'brea',
  },
  brea: {
    name: 'La capitana del puerto', text: 'Habla con la Capitana Brea, junto al muelle de la aldea.',
    auto: true, goal: { kind: 'talk', npc: 'captain' }, reward: { xp: 100, gold: 20 }, next: 'sendero',
  },
  sendero: {
    name: 'Limpia el camino', text: 'Derrota a 3 arqueros esqueleto en el Sendero del Humo.',
    auto: true, goal: { kind: 'kill', enemy: ['archer'], n: 3 }, reward: { xp: 200, potions: 2 }, next: 'guardianes',
  },
  guardianes: {
    name: 'Los guardianes', text: 'Vence a los 2 centinelas que duermen a las puertas de La Caldera.',
    auto: true, goal: { kind: 'kill', enemy: ['sentinel'], n: 2 }, reward: { xp: 150, gold: 40 }, next: 'prueba',
  },
  prueba: {
    name: 'Sobrevive a La Caldera', text: 'Pisa las runas del centro de La Caldera, aguanta las oleadas y vence a HELLFIRE.',
    auto: true, goal: { kind: 'win', enc: 'caldera' }, reward: { xp: 300, gold: 100 },
  },
  coral: {
    name: 'Coral para la tía', text: 'Tía Perla quiere 6 fragmentos de coral. Los sueltan los chamanes, los cangrejos y algún grumete.',
    giver: 'vendor', turnin: 'vendor', requires: 'brea', goal: { kind: 'collect', item: 'coral', n: 6 },
    reward: { potions: 2, gold: 60, item: { slot: 'ring', rarity: 1 } },
  },
  caza: {
    name: 'Caza en La Caldera', text: 'Derrota a 40 enemigos de la Prueba de Fuego (en cualquier Marea).',
    giver: 'captain', turnin: 'captain', requires: 'prueba', repeat: true, goal: { kind: 'kill', enc: 'caldera', n: 40 },
    reward: { gold: 120, potions: 1 },
  },
};
export const QUEST_IDS = Object.keys(QUESTS);
export const QST = { NONE: 0, ACTIVE: 1, DONE: 2, READY: 3 }; // profile.quests[id] = [state, progress]
export const goalCount = (q) => q.goal.n || 1;

// The people of the island: their lines (one per talk, in turn) and what they say about their quests.
export const NPC_TALK = {
  captain: {
    name: 'Capitana Brea',
    lines: [
      '¡Un náufrago más! Te doy la bienvenida a la Aldea Coralina. Aquí nadie pregunta de dónde vienes.',
      '¿Ves el humo del volcán? Allí está La Caldera. Quien la cruza sale con un cofre… o no sale.',
      'Antes de ir, practica el dash. Esquivar a tiempo te salva más que cualquier espada.',
      'Mi barco zarpará cuando el mar se calme. Mientras tanto, la isla es tuya.',
    ],
    quests: {
      brea: { done: 'Bien, tienes agallas. Los arqueros malditos tienen tomado el Sendero del Humo: despéjalo y sigue hasta La Caldera.' },
      caza: { offer: 'La Caldera escupe bichos sin parar. Tráeme 40 cabezas y te pagaré bien.', ready: 'Cuarenta, ni uno menos. Aquí tienes tu paga.' },
    },
  },
  vendor: {
    name: 'Tía Perla',
    lines: [
      '¡Cocos, ron y vendas! Si traes oro, algo encontraremos, corazón.',
      'Dicen que en La Caldera hasta los cangrejos escupen fuego. Yo no me acercaría.',
      'Lo que no te sirva, tráemelo: te lo pago bien, que yo de todo saco provecho.',
    ],
    quests: {
      coral: { offer: 'Mi ron de coral necesita coral, ¿sabes? Seis fragmentos. Los chamanes y los cangrejos de La Caldera lo llevan encima.', ready: '¡Qué coral más bonito! Toma, para que no te falte de nada.' },
    },
    shop: true,
  },
};
