// TA02: hold-to-chop numbers (spec-tala-v1.md). Axe tier = profile.tools.axe (1 stone, 2 iron, 3 steel); ticks are sim ticks (DT 1/60).
const frozen = (rows) => Object.freeze(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, Object.freeze(v)])));
export const AXES = frozen({ 1: { cadence: 54, learned: 45, damage: 1 }, 2: { cadence: 33, learned: 27, damage: 2 }, 3: { cadence: 24, learned: 20, damage: 3 } });
export const PALM_SIZES = frozen({ small: { hp: 4, logs: 2, critBonusMax: 1 }, medium: { hp: 7, logs: 3, critBonusMax: 2 }, large: { hp: 12, logs: 5, critBonusMax: 3 } });
export const palmSize = (scale) => !Number.isFinite(scale) || scale <= 0 ? 'medium' : scale < .74 ? 'small' : scale < .92 ? 'medium' : 'large';
export const CHOP = Object.freeze({ slack: 4, healTicks: 1800, pileRadius: 1.6, pileOffset: 1.5, pileTicks: 18000, maxPiles: 48, dy: 1.5,
  rankGreen: Object.freeze([10, 14, 18]) });
// Green window length: the timing rank's width, never more than half a swing.
export const greenTicks = (rank, cadence) => Math.min(CHOP.rankGreen[Math.min(Math.max(rank | 0, 1), 3) - 1], Math.floor(cadence / 2));
// Same shape as CRAFT_RECIPES; bench only (no `hand`). Kept apart until the v4 economy (TA04) whitelists them.
export const CHOP_RECIPES = Object.freeze({
  hacha_hierro: Object.freeze({ id: 'hacha_hierro', name: 'Hacha de hierro', inputs: Object.freeze({ madera: 2, mineral_hierro: 3 }), tool: 'axe', tier: 2, count: 1, max: 1 }),
  hacha_acero: Object.freeze({ id: 'hacha_acero', name: 'Hacha de acero', inputs: Object.freeze({ madera: 3, hierro: 4 }), tool: 'axe', tier: 3, count: 1, max: 1 }),
});
