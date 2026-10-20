// Skill-tree catalog (PLAN-SKILLS.md sections 2.1, 2.2, 2.3, 2.6, 2.7 and 4): the six trees, the five tiers, the
// practice curves, the 39 nodes and the pure helpers that read them. Data plus pure functions only: no DOM, no UI,
// no render imports. Practice and node ranks live in the profile (plain objects); everything else is derived here.
//   practice  { logging, combat, survival, sailing, crafting, trade }  counters that only go up
//   skills    { nodeId: rank }  rank 0..MAX_NODE_RANK, spent only inside the node's own tree
import { MASTERY, SKILLS, WEAPON_KINDS } from './weapons.js';
import { SKILL_IDS, TATTOO } from './tattoos.js';

export const MAX_TREE_RANK = 10;
export const MAX_NODE_RANK = 3;
export const POINTS_PER_RANK = 2;
export const RESET_FREE = 1;
export const GRID_COLS = 3;

// Display order of the left list. `practiceKeys` are the profile counters that feed the tree's practice.
export const TREES = [
  { id: 'combat', name: { es: 'Combate', en: 'Combat' }, tag: { es: 'Sable, pistolas, tatuajes y perla', en: 'Saber, pistols, tattoos and pearl' }, icon: 'combat', practiceKeys: ['combat'], hero: 'assets/ui/skills/hero-combat.webp', hidden: false },
  { id: 'survival', name: { es: 'Supervivencia', en: 'Survival' }, tag: { es: 'Tala, agua, comida y rescate', en: 'Logging, water, food and rescue' }, icon: 'survival', practiceKeys: ['survival', 'logging'], hero: 'assets/ui/skills/hero-survival.webp', hidden: false },
  { id: 'sailing', name: { es: 'Navegación', en: 'Sailing' }, tag: { es: 'Timón, aparejos y travesía', en: 'Helm, rigging and voyages' }, icon: 'sailing', practiceKeys: ['sailing'], hero: 'assets/ui/skills/hero-sailing.webp', hidden: false },
  { id: 'crafting', name: { es: 'Oficios', en: 'Crafting' }, tag: { es: 'Fabricación, reparación y artesanos', en: 'Making, repairs and artisans' }, icon: 'crafting', practiceKeys: ['crafting'], hero: 'assets/ui/skills/hero-crafting.webp', hidden: false },
  { id: 'trade', name: { es: 'Comercio', en: 'Trade' }, tag: { es: 'Mercado, contactos y contratos', en: 'Market, contacts and contracts' }, icon: 'trade', practiceKeys: ['trade'], hero: 'assets/ui/skills/hero-trade.webp', hidden: false },
  { id: 'exploration', name: { es: 'Exploración', en: 'Exploration' }, tag: { es: 'Reservado para más adelante', en: 'Reserved for later' }, icon: 'exploration', practiceKeys: ['exploration'], hero: 'assets/ui/skills/hero-exploration.webp', hidden: true },
];

// A tier opens when the tree reaches `rank`.
export const TIERS = [
  { n: 1, roman: 'I', name: { es: 'Novato', en: 'Novice' }, rank: 1 },
  { n: 2, roman: 'II', name: { es: 'Marinero', en: 'Rookie' }, rank: 3 },
  { n: 3, roman: 'III', name: { es: 'Veterano', en: 'Veteran' }, rank: 5 },
  { n: 4, roman: 'IV', name: { es: 'Maestro', en: 'Master' }, rank: 7 },
  { n: 5, roman: 'V', name: { es: 'Leyenda', en: 'Legend' }, rank: 9 },
];

// Cumulative practice needed for ranks 2..10 (rank 1 is 0 practice). Combat reuses the weapon-mastery curve.
// The other curves are provisional: PRG-C01 measures them (target: tier II in the first session of the activity,
// rank 10 after about 30 hours of it).
// MASTERY.xp holds the XP of each single mastery level; the tree needs running totals.
const cumulative = (steps) => { let total = 0; return steps.map((n) => (total += n)); };
const PROVISIONAL_CURVE = [60, 160, 320, 600, 1000, 1600, 2500, 3800, 5500];
export const CURVES = {
  combat: cumulative(MASTERY.xp),
  survival: PROVISIONAL_CURVE,
  sailing: PROVISIONAL_CURVE,
  crafting: PROVISIONAL_CURVE,
  trade: PROVISIONAL_CURVE,
  exploration: PROVISIONAL_CURVE,
};

// Rank deltas of a passive: rank r gives base x [1, 1.5, 2][r - 1] (rank 1 equals today's mastery passive).
const scaled = (base) => [1, 1.5, 2].map((m) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(v * m * 10000) / 10000])));
const ACTIVE_RANKS = () => [{ dmg: 0 }, { dmg: TATTOO.dmg }, { dmg: 2 * TATTOO.dmg }];
const DRAFT_RANKS = () => [{}, {}, {}];
const passiveOf = (weapon, id) => MASTERY.passives[weapon].find((p) => p.id === id);

// The mastery passives, read from weapons.js so the numbers never drift.
const temple = passiveOf('sable', 'temple');
const eye = passiveOf('sable', 'eye');
const trigger = passiveOf('pistolas', 'trigger');
const deluge = passiveOf('pistolas', 'deluge');

const active = (o) => ({ kind: 'active', draft: false, icon: o.id, passive: undefined, ...o, ranks: ACTIVE_RANKS() });
const mastered = (o, p, delta) => ({ kind: 'passive', draft: false, icon: o.id, skill: undefined, slot: undefined, ...o, passive: p.id, ranks: scaled(delta) });
const draft = (o) => ({ draft: true, icon: o.id, gate: null, ...o, ranks: DRAFT_RANKS() });

const SABLE = (mastery) => ({ weapon: 'sable', mastery });
const PISTOLAS = (mastery) => ({ weapon: 'pistolas', mastery });
const SEPIA = { knowledge: 'tattoo' };
const PEARL = { pearl: true };

const COMBAT_NODES = [
  // Tier I
  active({ id: 'lunge', tree: 'combat', tier: 1, col: 1, name: { es: 'Estocada', en: 'Lunge' }, desc: { es: 'Embestida del sable que atraviesa lo que encuentra.', en: 'A saber charge that pierces whatever it meets.' }, skill: 'lunge', slot: 'q', gate: SABLE(MASTERY.unlock.q) }),
  active({ id: 'blast', tree: 'combat', tier: 1, col: 2, name: { es: 'Ráfaga', en: 'Blast' }, desc: { es: 'Escopetazo de pistolas que sopla las balas de delante.', en: 'A pistol shotgun cone that blows away the bullets ahead.' }, skill: 'blast', slot: 'q', gate: PISTOLAS(MASTERY.unlock.q) }),
  mastered({ id: 'temple', tree: 'combat', tier: 1, col: 3, name: { es: 'Temple', en: 'Tempered Edge' }, desc: { es: 'Margen de parry +15 ms con el sable.', en: 'Parry margin +15 ms with the saber.' }, gate: SABLE(5) }, temple, { win: temple.win }),
  // Tier II
  active({ id: 'wave', tree: 'combat', tier: 2, col: 1, name: { es: 'Ola', en: 'Wave' }, desc: { es: 'Media luna de viento que vuela hacia el cursor.', en: 'A crescent of wind that flies at the cursor.' }, skill: 'wave', slot: 'q', gate: SABLE(MASTERY.unlock.e) }),
  active({ id: 'blink', tree: 'combat', tier: 2, col: 2, name: { es: 'Parpadeo', en: 'Blink' }, desc: { es: 'Teletransporte corto con fotogramas de invulnerabilidad.', en: 'A short teleport with invulnerability frames.' }, skill: 'blink', slot: 'q', gate: PISTOLAS(MASTERY.unlock.e) }),
  // fireCut is the fraction cut from the fire interval; consumers convert with fire = 1 - fireCut (MASTERY passives store the multiplier).
  mastered({ id: 'trigger', tree: 'combat', tier: 2, col: 3, name: { es: 'Gatillo', en: 'Hair Trigger' }, desc: { es: 'Las pistolas disparan más rápido.', en: 'The pistols fire faster.' }, gate: PISTOLAS(5) }, trigger, { fireCut: Math.round((1 - trigger.fire) * 10000) / 10000 }),
  // Tier III (tattoos, learned from Doña Sepia)
  active({ id: 'tromba', tree: 'combat', tier: 3, col: 1, name: { es: 'Tromba', en: 'Waterspout' }, desc: { es: 'Columna de agua que aturde y borra balas.', en: 'A water column that stuns and erases bullets.' }, skill: 'tromba', slot: 'q', gate: SEPIA }),
  active({ id: 'leap', tree: 'combat', tier: 3, col: 2, name: { es: 'Abordaje', en: 'Boarding Leap' }, desc: { es: 'Salto que cae golpeando y borra balas.', en: 'A leap that lands striking and erases bullets.' }, skill: 'leap', slot: 'q', gate: SEPIA }),
  active({ id: 'wheel', tree: 'combat', tier: 3, col: 3, name: { es: 'Timón', en: 'Helm Throw' }, desc: { es: 'Mantén para cargar: un timón que vuelve a ti.', en: 'Hold to charge: a ship wheel that returns to you.' }, skill: 'wheel', slot: 'q', gate: SEPIA }),
  // Tier IV (the R arts and the saber's late passive)
  active({ id: 'storm', tree: 'combat', tier: 4, col: 1, name: { es: 'Tormenta', en: 'Storm' }, desc: { es: 'Refleja todo a tu alrededor con el sable.', en: 'Reflects everything around you with the saber.' }, skill: 'storm', slot: 'r', gate: SABLE(MASTERY.unlock.r) }),
  active({ id: 'rain', tree: 'combat', tier: 4, col: 2, name: { es: 'Lluvia', en: 'Lead Rain' }, desc: { es: 'Zona de balas en el cursor.', en: 'A zone of bullets at the cursor.' }, skill: 'rain', slot: 'r', gate: PISTOLAS(MASTERY.unlock.r) }),
  mastered({ id: 'eye', tree: 'combat', tier: 4, col: 3, name: { es: 'Ojo de tormenta', en: 'Eye of the Storm' }, desc: { es: 'La Tormenta alcanza más lejos.', en: 'The Storm reaches farther.' }, gate: SABLE(10) }, eye, { stormR: eye.stormR }),
  // Tier V (the pearl)
  draft({ id: 'pearl_affinity', tree: 'combat', tier: 5, col: 1, kind: 'passive', name: { es: 'Afinidad de perla', en: 'Pearl Affinity' }, desc: { es: 'Mejora la perla tragada.', en: 'Strengthens the swallowed pearl.' }, gate: PEARL }),
  mastered({ id: 'deluge', tree: 'combat', tier: 5, col: 2, name: { es: 'Diluvio', en: 'Deluge' }, desc: { es: 'La Lluvia de plomo dura más y crece.', en: 'Lead Rain lasts longer and grows wider.' }, gate: { ...PISTOLAS(10), pearl: true } }, deluge, { rainDur: deluge.rainDur, rainR: deluge.rainR }),
  draft({ id: 'curse_tamed', tree: 'combat', tier: 5, col: 3, kind: 'passive', name: { es: 'Maldición domada', en: 'Curse Tamed' }, desc: { es: 'Reduce la maldición de la perla.', en: 'Reduces the curse of the pearl.' }, gate: PEARL }),
];

// Other trees, tiers I and II (PLAN-SKILLS.md 2.7). Spanish names from the plan; every node is a draft.
const d = (tree, tier, col, id, kind, es, en, desces, descen) => draft({ id, tree, tier, col, kind, name: { es, en }, desc: { es: desces, en: descen } });
const OTHER_NODES = [
  d('survival', 1, 1, 'steady_chop', 'technique', 'Tala firme', 'Steady Chopping', 'Menos tiempo por golpe al talar.', 'Shorter swing time when logging.'),
  d('survival', 1, 2, 'swimmer', 'passive', 'Nadador', 'Swimmer', 'Más alcance al nadar hacia agua dulce.', 'Longer reach when swimming to fresh water.'),
  d('survival', 1, 3, 'iron_stomach', 'passive', 'Estómago de hierro', 'Iron Stomach', 'Mejores efectos de comida y grog.', 'Better food and grog effects.'),
  d('survival', 2, 1, 'woodcutter', 'technique', 'Hachero', 'Woodcutter', 'Menos golpes por árbol.', 'Fewer swings per tree.'),
  d('survival', 2, 2, 'diver', 'technique', 'Buceador', 'Diver', 'Reembarque más fácil tras caer al agua.', 'Easier re-boarding after falling in the water.'),
  d('survival', 2, 3, 'cook', 'passive', 'Cocinero', 'Cook', 'Raciones mejores.', 'Better rations.'),
  d('sailing', 1, 1, 'helmsman', 'technique', 'Timonel', 'Helmsman', 'El timón responde mejor.', 'The helm answers better.'),
  d('sailing', 1, 2, 'rigging', 'passive', 'Aparejos', 'Rigging', 'Mejor manejo de las velas.', 'Better sail handling.'),
  d('sailing', 1, 3, 'sea_reading', 'technique', 'Lectura del mar', 'Sea Reading', 'Interpreta corrientes y viento.', 'Read currents and wind.'),
  d('sailing', 2, 1, 'maneuver', 'technique', 'Maniobra', 'Maneuver', 'Giros más rápidos con la embarcación.', 'Faster turns with the vessel.'),
  d('sailing', 2, 2, 'voyage_repair', 'technique', 'Reparación en travesía', 'Voyage Repair', 'Repara la balsa sin atracar.', 'Repair the raft without docking.'),
  d('sailing', 2, 3, 'cargo_hold', 'passive', 'Bodega', 'Cargo Hold', 'Más espacio de carga a bordo.', 'More cargo space on board.'),
  d('crafting', 1, 1, 'carpentry', 'technique', 'Carpintería', 'Carpentry', 'Trabaja la madera con menos desperdicio.', 'Work wood with less waste.'),
  d('crafting', 1, 2, 'ropework', 'technique', 'Cordelería', 'Ropework', 'Fibra, paja y cuero rinden más.', 'Fiber, thatch and leather go further.'),
  d('crafting', 1, 3, 'mending', 'passive', 'Reparación', 'Mending', 'Las reparaciones cuestan menos.', 'Repairs cost less.'),
  d('crafting', 2, 1, 'artisan_apprentice', 'technique', 'Aprendiz del artesano', 'Artisan Apprentice', 'Aprende recetas del artesano más rápido.', 'Learn artisan recipes faster.'),
  d('crafting', 2, 2, 'components', 'passive', 'Componentes', 'Components', 'Mejor aprovechamiento de componentes.', 'Better use of components.'),
  d('crafting', 2, 3, 'finishing', 'passive', 'Acabados', 'Finishing', 'Mejores acabados en lo fabricado.', 'Better finishes on what you make.'),
  d('trade', 1, 1, 'haggling', 'passive', 'Regateo', 'Haggling', 'Mejores precios con los agentes.', 'Better prices with agents.'),
  d('trade', 1, 2, 'contacts', 'technique', 'Contactos', 'Contacts', 'Más agentes dispuestos a tratar.', 'More agents willing to deal.'),
  d('trade', 1, 3, 'buy_quota', 'technique', 'Cupo de compra', 'Buy Quota', 'Mayor cupo de compra.', 'A larger purchase quota.'),
  d('trade', 2, 1, 'contracts', 'technique', 'Contratos', 'Contracts', 'Abre contratos con los agentes.', 'Opens contracts with agents.'),
  d('trade', 2, 2, 'price_intel', 'technique', 'Información de precios', 'Price Intel', 'Conoce los precios de otros puertos.', 'Learn prices at other ports.'),
  d('trade', 2, 3, 'assortment', 'passive', 'Surtido', 'Assortment', 'Más variedad de género a la venta.', 'A wider range of goods for sale.'),
];

export const NODES = [...COMBAT_NODES, ...OTHER_NODES].map((n) => {
  const out = { ...n };
  if (out.passive === undefined) delete out.passive;
  if (out.skill === undefined) delete out.skill;
  if (out.slot === undefined) delete out.slot;
  return out;
});

const treeOf = (id) => TREES.find((t) => t.id === id) || null;
const nodeIndex = new Map(NODES.map((n) => [n.id, n]));
export const nodeById = (id) => nodeIndex.get(id) || null;

// ---- Practice and rank -----------------------------------------------------------------------------------------

/** Total practice of a tree: the sum of its practiceKeys in a plain counters object (missing keys count 0). */
export function practiceOf(treeId, practice) {
  const t = treeOf(treeId);
  if (!t) return 0;
  let sum = 0;
  for (const k of t.practiceKeys) {
    const v = Number(practice && practice[k]);
    if (Number.isFinite(v) && v > 0) sum += v;
  }
  return sum;
}

/** Tree rank 1..MAX_TREE_RANK: 1 plus the thresholds reached. */
export function treeRank(treeId, practice) {
  const curve = Object.hasOwn(CURVES, treeId) ? CURVES[treeId] : null;
  if (!curve) return 1;
  const p = practiceOf(treeId, practice);
  let rank = 1;
  for (const need of curve) if (p >= need) rank++;
  return Math.min(MAX_TREE_RANK, rank);
}

/** `{have, need}` toward the next rank (cumulative practice), or null at the maximum rank. */
export function practiceToNext(treeId, practice) {
  const curve = Object.hasOwn(CURVES, treeId) ? CURVES[treeId] : null;
  if (!curve) return null;
  const rank = treeRank(treeId, practice);
  if (rank >= MAX_TREE_RANK) return null;
  return { have: practiceOf(treeId, practice), need: curve[rank - 1] };
}

/** True when the tier (1..5) is open at the tree's current rank. */
export function tierOpen(treeId, practice, tierN) {
  const tier = TIERS.find((t) => t.n === tierN);
  return !!tier && treeRank(treeId, practice) >= tier.rank;
}

export const pointsEarned = (treeId, practice) => (treeRank(treeId, practice) - 1) * POINTS_PER_RANK;

// ---- Node ranks and points -------------------------------------------------------------------------------------

/** Rank of a node in a plain `{nodeId: rank}` object: an integer clamped to 0..MAX_NODE_RANK. */
export function nodeRank(skills, id) {
  const v = Math.floor(Number(skills && skills[id]));
  return Number.isFinite(v) ? Math.min(MAX_NODE_RANK, Math.max(0, v)) : 0;
}

/** Points spent in one tree: the ranks of that tree's nodes only. */
export function pointsSpent(treeId, skills) {
  let sum = 0;
  for (const n of NODES) if (n.tree === treeId) sum += nodeRank(skills, n.id);
  return sum;
}

export const pointsFree = (treeId, practice, skills) => Math.max(0, pointsEarned(treeId, practice) - pointsSpent(treeId, skills));

/** The grid of a tree: 5 tiers of GRID_COLS cells, each a node or null (indexed by col - 1). */
export function nodesByTier(treeId) {
  const grid = TIERS.map(() => Array.from({ length: GRID_COLS }, () => null));
  for (const n of NODES) if (n.tree === treeId) grid[n.tier - 1][n.col - 1] = n;
  return grid;
}

/** May the player raise this node one rank? The gate (weapon, knowledge, pearl) is not evaluated here. */
export function canRaise(treeId, nodeId, { practice, skills } = {}) {
  const node = nodeById(nodeId);
  if (!node) return { ok: false, reason: 'unknown' };
  if (node.tree !== treeId) return { ok: false, reason: 'tree' };
  if (!tierOpen(treeId, practice, node.tier)) return { ok: false, reason: 'tier' };
  if (nodeRank(skills, nodeId) >= MAX_NODE_RANK) return { ok: false, reason: 'max' };
  if (pointsFree(treeId, practice, skills) < 1) return { ok: false, reason: 'points' };
  return { ok: true, reason: null };
}

/** Gate check against the live context `{weapon, mastery:{sable, pistolas}, knowledge:[], pearl}`. */
export function gateState(node, ctx = {}) {
  const g = node && node.gate;
  if (!g) return { ok: true, reason: null };
  if (g.weapon) {
    if (ctx.weapon !== g.weapon) return { ok: false, reason: 'weapon' };
    const m = Number(ctx.mastery && ctx.mastery[g.weapon]) || 0;
    if (m < (g.mastery || 0)) return { ok: false, reason: 'mastery' };
  }
  if (g.knowledge && !(Array.isArray(ctx.knowledge) && ctx.knowledge.includes(g.knowledge))) return { ok: false, reason: 'knowledge' };
  if (g.pearl && !ctx.pearl) return { ok: false, reason: 'pearl' };
  return { ok: true, reason: null };
}

/** Old tattoo rank 1..5 (by XP) to the new node rank 0..3 (PLAN-SKILLS.md 2.3). */
export function migrateTattooRank(r) {
  const v = Math.floor(Number(r));
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v === 1) return 1;
  if (v <= 3) return 2;
  return 3;
}

/** Everything a tree view needs, derived from the plain profile objects. */
export function treeSummary(treeId, { practice, skills } = {}) {
  const earned = pointsEarned(treeId, practice);
  const spent = pointsSpent(treeId, skills);
  return {
    id: treeId,
    rank: treeRank(treeId, practice),
    practice: practiceOf(treeId, practice),
    toNext: practiceToNext(treeId, practice),
    points: { earned, spent, free: Math.max(0, earned - spent) },
    tiers: TIERS.map((t) => ({ n: t.n, open: tierOpen(treeId, practice, t.n) })),
    raised: NODES.filter((n) => n.tree === treeId && nodeRank(skills, n.id) > 0).length,
  };
}

// ---- Validation ------------------------------------------------------------------------------------------------

const hasText = (o) => !!o && typeof o.es === 'string' && o.es.length > 0 && typeof o.en === 'string' && o.en.length > 0;

/** Catalog self-check: an array of problem strings, empty when the data is consistent. */
export function validateCatalog() {
  const problems = [];
  const seen = new Set();
  const cells = new Set();
  const masteryPassives = new Set(Object.values(MASTERY.passives).flat().map((p) => p.id));
  for (const n of NODES) {
    if (seen.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    seen.add(n.id);
    if (!treeOf(n.tree)) problems.push(`${n.id}: unknown tree ${n.tree}`);
    if (!(Number.isInteger(n.tier) && n.tier >= 1 && n.tier <= TIERS.length)) problems.push(`${n.id}: bad tier ${n.tier}`);
    if (!(Number.isInteger(n.col) && n.col >= 1 && n.col <= GRID_COLS)) problems.push(`${n.id}: bad col ${n.col}`);
    const cell = `${n.tree}/${n.tier}/${n.col}`;
    if (cells.has(cell)) problems.push(`${n.id}: cell ${cell} already taken`);
    cells.add(cell);
    if (!hasText(n.name)) problems.push(`${n.id}: name needs es and en`);
    if (!hasText(n.desc)) problems.push(`${n.id}: desc needs es and en`);
    if (!Array.isArray(n.ranks) || n.ranks.length !== MAX_NODE_RANK) problems.push(`${n.id}: ranks must have ${MAX_NODE_RANK} entries`);
    if (n.kind === 'active') {
      if (!(n.skill in SKILLS) && !SKILL_IDS.includes(n.skill)) problems.push(`${n.id}: unknown skill ${n.skill}`);
      if (!['q', 'e', 'r', 'g'].includes(n.slot)) problems.push(`${n.id}: bad slot ${n.slot}`);
    } else if (n.kind === 'passive') {
      if (n.passive && !masteryPassives.has(n.passive)) problems.push(`${n.id}: unknown mastery passive ${n.passive}`);
      if (!n.passive && !n.draft) problems.push(`${n.id}: a live passive must name its mastery passive`);
    } else if (n.kind !== 'technique') {
      problems.push(`${n.id}: bad kind ${n.kind}`);
    }
    if (n.gate && n.gate.weapon && !WEAPON_KINDS.includes(n.gate.weapon)) problems.push(`${n.id}: gate weapon ${n.gate.weapon} is not a weapon kind`);
  }
  const count = (id) => NODES.filter((n) => n.tree === id).length;
  if (count('combat') !== 15) problems.push(`combat has ${count('combat')} nodes, expected 15`);
  for (const t of TREES) if (!t.hidden && count(t.id) < 6) problems.push(`${t.id}: fewer than 6 nodes`);
  for (const [id, curve] of Object.entries(CURVES)) {
    const ok = Array.isArray(curve) && curve.length === MAX_TREE_RANK - 1 && curve.every((v, i) => Number.isFinite(v) && (i === 0 || v > curve[i - 1]));
    if (!ok) problems.push(`curve ${id} must be ${MAX_TREE_RANK - 1} strictly increasing numbers`);
  }
  return problems;
}
