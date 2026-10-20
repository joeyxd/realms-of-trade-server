// Skill sheet (SK02, PLAN-SKILLS.md 2.1, 2.3, 2.4 and 3.1 to 3.3): the read-only `tree` kind of the Habilidades tab.
// A pure view model plus html builders: no DOM, no profile writes. The state is derived from the live profile with
// absent-preserving reads (a real `progression` field always wins over the fallbacks below), then drawn as three
// columns: the tree list, the 5x3 node grid and the node detail. The character screen owns selection and clicks.
import { MASTERY, WEAPON_KINDS } from '../data/weapons.js';
import { ARTS } from '../data/tattoos.js';
import {
  CURVES, MAX_NODE_RANK, MAX_TREE_RANK, NODES, TIERS, TREES, gateState, migrateTattooRank, nodeById, nodeRank,
  nodesByTier, pointsEarned, pointsSpent, practiceOf, practiceToNext, tierOpen, treeRank,
} from '../data/skillTree.js';
import { skillIcon } from './hud.js';
import { loggingSkillHtml } from './loggingSkill.js';
import { LINE_ICONS as I, atlasIcon, escHtml as esc, fmtNum, hasAtlasIcon, kitAsset, tr } from './kit.js';

// Trees whose painted hero (assets/ui/skills/hero-<id>.webp) has shipped. Empty today: the box shows the tree icon on the
// plate instead of a request that would 404. Add the id here when its file lands (the same pattern as workbench.js).
export const HERO_ART = new Set();

const PRACTICE_KEYS = ['logging', 'survival', 'sailing', 'crafting', 'trade'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));

// Presentation strings. Node and tree names come from the catalog pairs through tr().
const COPY = {
  es: {
    trees: 'Árboles', points: 'Puntos de habilidad', earned: 'Ganados', spent: 'Gastados', free: 'Libres', freeTip: 'Puntos libres',
    rank: 'Rango', practice: 'Práctica', maxRank: 'Rango máximo', provisional: 'Práctica provisional: suma de la maestría de tus armas.',
    pick: 'Elige una habilidad de la rejilla para ver su detalle.', trained: 'Se entrena con {activity}.',
    kind: { active: 'Activa', technique: 'Técnica', passive: 'Pasiva' },
    now: 'Ahora', next: 'Siguiente', tbd: 'Efecto por definir', none: 'Ninguno',
    nextRank: 'Siguiente rango', onePoint: '1 punto de {tree}', tierNeed: 'Requiere rango {n} de {tree}', maxed: 'Rango máximo alcanzado',
    requires: 'Requiere', needWeapon: '{weapon} en mano', needMastery: 'Maestría de {lower} {n}', needSepia: 'Aprendido con Doña Sepia', needPearl: 'Perla tragada',
    weapons: { sable: 'Sable', pistolas: 'Pistolas' },
    raise: 'Subir', soon: 'Disponible pronto', locked: 'Bloqueada', tierClosed: 'Nivel cerrado',
    fx: { dmg: 'Daño', win: 'Margen de parry', fireCut: 'Intervalo de disparo', stormR: 'Alcance de la Tormenta', rainDur: 'Duración de la Lluvia', rainR: 'Radio de la Lluvia' },
    activity: {
      survival: 'tala, agua dulce, comida y rescate (hoy solo cuenta la tala)', sailing: 'pilotar la nave, atracar y reparar la balsa',
      crafting: 'fabricar recetas y aprender con el artesano', trade: 'comerciar con agentes y cumplir contratos',
    },
  },
  en: {
    trees: 'Trees', points: 'Skill points', earned: 'Earned', spent: 'Spent', free: 'Free', freeTip: 'Free points',
    rank: 'Rank', practice: 'Practice', maxRank: 'Max rank', provisional: 'Provisional practice: the sum of your weapon mastery.',
    pick: 'Pick a skill on the grid to see its detail.', trained: 'Trained by {activity}.',
    kind: { active: 'Active', technique: 'Technique', passive: 'Passive' },
    now: 'Now', next: 'Next', tbd: 'Effect to be defined', none: 'None',
    nextRank: 'Next rank', onePoint: '1 {tree} point', tierNeed: 'Needs {tree} rank {n}', maxed: 'Max rank reached',
    requires: 'Requires', needWeapon: '{weapon} in hand', needMastery: '{weapon} mastery {n}', needSepia: 'Learned from Doña Sepia', needPearl: 'Swallowed pearl',
    weapons: { sable: 'Saber', pistolas: 'Pistols' },
    raise: 'Raise', soon: 'Coming soon', locked: 'Locked', tierClosed: 'Tier closed',
    fx: { dmg: 'Damage', win: 'Parry margin', fireCut: 'Fire interval', stormR: 'Storm reach', rainDur: 'Lead Rain duration', rainR: 'Lead Rain radius' },
    activity: {
      survival: 'logging, fresh water, food and rescue (only logging counts today)', sailing: 'steering the ship, docking and repairing the raft',
      crafting: 'making recipes and learning from the artisan', trade: 'trading with agents and fulfilling contracts',
    },
  },
};
const copy = (lang) => COPY[lang === 'en' ? 'en' : 'es'];
const langOf = (lang) => (lang === 'en' ? 'en' : 'es');

// ---- View model -------------------------------------------------------------------------------------------------------

/**
 * Everything the sheet shows, read from the live profile (null and partial profiles give an all-zero state).
 * `weaponIndex` is the index into WEAPON_KINDS of the weapon in hand.
 */
export function skillSheetState(profile, weaponIndex = 0) {
  const p = isObj(profile) ? profile : null;
  const progression = isObj(p?.progression) ? p.progression : null;
  const weapon = WEAPON_KINDS[weaponIndex | 0];
  // Mastery level of one weapon: 0 when the profile has no entry for it (an absent mast never opens an art).
  const levelAt = (i) => { const v = Math.floor(Number(p?.mast?.[i]?.[0])); return Number.isFinite(v) && v > 0 ? v : 0; };
  const mastery = Object.fromEntries(WEAPON_KINDS.map((kind, i) => [kind, levelAt(i)]));

  const practice = { combat: 0, logging: 0, survival: 0, sailing: 0, crafting: 0, trade: 0 };
  for (const key of PRACTICE_KEYS) practice[key] = count(progression?.practice?.[key]);
  const real = progression?.practice?.combat;
  const provisional = { combat: false };
  if (typeof real === 'number' && Number.isFinite(real)) practice.combat = Math.max(0, real);
  else {
    // No server counter yet: the XP gathered in every weapon's mastery (the levels passed plus the current bar).
    provisional.combat = true;
    let sum = 0;
    WEAPON_KINDS.forEach((_, i) => {
      const level = Math.min(MASTERY.max, levelAt(i));
      if (!level) return;
      for (let n = 0; n < level - 1; n++) sum += MASTERY.xp[n] || 0;
      sum += count(Number(p?.mast?.[i]?.[1]));
    });
    practice.combat = sum;
  }

  const has = isObj(p?.sk?.has) ? p.sk.has : {};
  let skills;
  if (isObj(progression?.skills)) skills = { ...progression.skills };
  else {
    skills = {};
    for (const node of NODES) {
      if (!node.skill) { skills[node.id] = 0; continue; }
      const art = Object.hasOwn(ARTS, node.skill) ? ARTS[node.skill] : null;
      if (Object.hasOwn(has, node.skill) && has[node.skill]) skills[node.id] = migrateTattooRank(has[node.skill][0]);
      else if (art && mastery[art.weapon] >= art.mastery) skills[node.id] = 1;
      else skills[node.id] = 0;
    }
  }

  const pearl = !!p?.pearls?.swallowed;
  const knows = (id) => !!id && Object.hasOwn(has, id) && !!has[id];
  return {
    practice, skills, provisional, weapon, mastery, pearl, progression: progression || undefined,
    knows,
    ctxFor: (node) => ({ weapon, mastery: { ...mastery }, knowledge: knows(node?.skill) ? ['tattoo'] : [], pearl }),
    points: (treeId) => {
      const earned = pointsEarned(treeId, practice), spent = pointsSpent(treeId, skills);
      return { earned, spent, free: Math.max(0, earned - spent) };
    },
  };
}

// ---- Glyphs -----------------------------------------------------------------------------------------------------------

/** One icon rule for nodes and trees: a painted atlas icon when the id has one, else the HUD skill SVG in a `cls` span. */
export function skillGlyph(id, cls = '') {
  return hasAtlasIcon(id) ? atlasIcon(id, cls) : `<span class="${cls}">${skillIcon(id)}</span>`;
}

// ---- Shared bits ------------------------------------------------------------------------------------------------------

const visibleTrees = () => TREES.filter((t) => !t.hidden);
const treeById = (id) => TREES.find((t) => t.id === id && !t.hidden) || null;

// Progress inside the current rank: the bar fills between the last threshold and the next one.
function progress(treeId, practice) {
  const next = practiceToNext(treeId, practice);
  if (!next) return { ratio: 1, have: practiceOf(treeId, practice), need: null };
  const rank = treeRank(treeId, practice), prev = rank >= 2 ? CURVES[treeId][rank - 2] : 0;
  const span = Math.max(1, next.need - prev);
  return { ratio: Math.max(0, Math.min(1, (next.have - prev) / span)), have: next.have, need: next.need };
}
const barHtml = (ratio) => `<span class="kit-bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>`;
const practiceText = (pr, lang, T) => (pr.need === null ? T.maxRank : `${fmtNum(Math.floor(pr.have), lang)} / ${fmtNum(pr.need, lang)}`);

// The hero box: the painted hero when it shipped, else the tree icon on the plate. `ico` holds a large icon over the art.
function heroHtml(tree, cls, ico = '') {
  const art = HERO_ART.has(tree.id);
  const style = art ? ` style="--art:url('${kitAsset(`skills/hero-${tree.id}.webp`)}')"` : '';
  return `<div class="${cls}${art ? '' : ' is-empty'}"${style} aria-hidden="true">${ico || (art ? '' : skillGlyph(tree.icon, 'sk-hero-ico'))}</div>`;
}

/** Cell state of one node: rank, whether its tier is open, the gate result and the classes derived from them. */
export function nodeView(state, node) {
  const rank = nodeRank(state.skills, node.id);
  const open = tierOpen(node.tree, state.practice, node.tier);
  const gate = gateState(node, state.ctxFor(node));
  const locked = !open || !gate.ok;
  return { rank, open, gate, locked, cls: [locked ? 'is-locked' : rank === 0 ? 'is-open' : '', rank > 0 ? 'is-ranked' : ''].filter(Boolean).join(' ') };
}

// ---- Left column: tree list, painting, points ---------------------------------------------------------------------------

export function skillListHtml(state, sel, lang) {
  lang = langOf(lang);
  const T = copy(lang), current = treeById(sel?.tree) || visibleTrees()[0];
  const entries = visibleTrees().map((tree) => {
    const rank = treeRank(tree.id, state.practice), pr = progress(tree.id, state.practice), free = state.points(tree.id).free;
    return `<button class="sk-tree${tree.id === current.id ? ' is-selected' : ''}" type="button" data-tree="${tree.id}" aria-pressed="${tree.id === current.id}">
      <span class="sk-tree-ico">${skillGlyph(tree.icon, 'sk-ico')}</span>
      <span class="sk-tree-body"><b>${esc(tr(tree.name, lang))}</b><small>${esc(T.rank)} ${rank}/${MAX_TREE_RANK}</small>${barHtml(pr.ratio)}</span>
      <b class="sk-badge${free ? '' : ' is-zero'}" title="${esc(T.freeTip)}">${free}</b></button>`;
  }).join('');
  const pts = state.points(current.id);
  return `<h2 class="ch-h"><span class="ch-h-ico">${I.palm}</span>${esc(T.trees)}</h2>
    <div class="sk-trees">${entries}</div>
    ${heroHtml(current, 'sk-paint')}
    <div class="sk-points"><span class="ch-sub">${esc(T.points)} · ${esc(tr(current.name, lang))}</span>
      <div class="sk-points-row"><span>${esc(T.earned)}</span><b>${pts.earned}</b></div>
      <div class="sk-points-row"><span>${esc(T.spent)}</span><b>${pts.spent}</b></div>
      <div class="sk-points-row is-free"><span>${esc(T.free)}</span><b>${pts.free}</b></div></div>`;
}

// ---- Center column: header and the 5x3 grid -----------------------------------------------------------------------------

export function skillCenterHtml(state, sel, lang) {
  lang = langOf(lang);
  const T = copy(lang), tree = treeById(sel?.tree) || visibleTrees()[0];
  const rank = treeRank(tree.id, state.practice), pr = progress(tree.id, state.practice);
  const head = `<header class="sk-head"><span class="sk-head-ico">${skillGlyph(tree.icon, 'sk-ico')}</span>
    <div class="sk-head-name"><h2>${esc(tr(tree.name, lang))}</h2><p>${esc(tr(tree.tag, lang))}</p></div>
    <div class="sk-head-rank"><b>${esc(T.rank)} ${rank}/${MAX_TREE_RANK}</b>${barHtml(pr.ratio)}<small>${esc(practiceText(pr, lang, T))}</small></div></header>`;
  const cells = nodesByTier(tree.id).map((row, i) => {
    const tier = TIERS[i], open = tierOpen(tree.id, state.practice, tier.n);
    const label = `<div class="sk-tier${open ? '' : ' is-closed'}" title="${esc(tr(tier.name, lang))} · ${esc(T.rank)} ${tier.rank}"><b>${tier.roman}</b>
      <small>${esc(T.rank)} ${tier.rank}</small>${open ? '' : `<i class="sk-lock">${I.lock}</i>`}</div>`;
    return label + row.map((node) => {
      if (!node) return '<span class="sk-cell is-empty" aria-hidden="true"></span>';
      const v = nodeView(state, node), name = tr(node.name, lang), on = node.id === sel?.node;
      const pips = Array.from({ length: MAX_NODE_RANK }, (_, n) => `<i${n < v.rank ? ' class="on"' : ''}></i>`).join('');
      return `<button class="sk-cell ${v.cls}${on ? ' is-selected' : ''}" type="button" data-node="${node.id}" aria-pressed="${on}" aria-label="${esc(name)}" title="${esc(name)}${v.locked ? ` · ${esc(v.open ? T.locked : T.tierClosed)}` : ''}">
        <span class="sk-cell-ico">${skillGlyph(node.icon, 'sk-ico')}</span><span class="sk-cell-name">${esc(name)}</span><span class="sk-pips">${pips}</span>${v.locked ? `<i class="sk-lock">${I.lock}</i>` : ''}</button>`;
    }).join('');
  }).join('');
  return `${head}<div class="sk-grid">${cells}</div>`;
}

// ---- Right column: node detail or tree summary ----------------------------------------------------------------------------

// Value of one effect key as text (rank deltas of the catalog: fractions for percentages, seconds for durations).
function effectText(key, v, lang) {
  if (!Number.isFinite(v)) return '—';
  if (key === 'dmg') return `+${fmtNum(v * 100, lang, 1)} %`;
  if (key === 'win') return `+${fmtNum(v * 1000, lang)} ms`;
  if (key === 'fireCut') return `−${fmtNum(v * 100, lang, 1)} %`;
  if (key === 'rainDur') return `+${fmtNum(v, lang, 2)} s`;
  if (key === 'stormR' || key === 'rainR') return `+${fmtNum(v, lang, 2)} u`;
  return fmtNum(v, lang, 2);
}

function ranksHtml(node, rank, T, lang) {
  const keys = [...new Set(node.ranks.flatMap((r) => Object.keys(r || {})))];
  if (!keys.length) return `<p class="sk-tbd">${esc(T.tbd)}</p>`;
  const at = (r, key) => (r >= 1 ? node.ranks[r - 1]?.[key] : 0);
  const rows = keys.map((key) => `<div class="sk-fx"><span>${esc(T.fx[key] || key)}</span><b>${esc(effectText(key, at(rank, key), lang))}</b><i>→</i>
      <b class="is-next">${rank >= MAX_NODE_RANK ? '—' : esc(effectText(key, at(rank + 1, key), lang))}</b></div>`).join('');
  return `<div class="sk-fx sk-fx-head"><span></span><b>${esc(T.now)}</b><i></i><b>${esc(T.next)}</b></div>${rows}`;
}

function requirementsHtml(node, ctx, T) {
  const g = node.gate, items = [];
  if (g?.weapon) {
    const weapon = T.weapons[g.weapon] || g.weapon;
    items.push([ctx.weapon === g.weapon, fill(T.needWeapon, { weapon })]);
    if (g.mastery > 0) items.push([(Number(ctx.mastery?.[g.weapon]) || 0) >= g.mastery, fill(T.needMastery, { weapon, lower: weapon.toLowerCase(), n: g.mastery })]);
  }
  if (g?.knowledge) items.push([Array.isArray(ctx.knowledge) && ctx.knowledge.includes(g.knowledge), T.needSepia]);
  if (g?.pearl) items.push([!!ctx.pearl, T.needPearl]);
  const rows = items.map(([ok, text]) => `<li class="${ok ? 'is-ok' : 'is-miss'}"><i>${ok ? '✓' : '✕'}</i>${esc(text)}</li>`).join('');
  return `<ul class="sk-req">${rows || `<li class="is-ok"><i>✓</i>${esc(T.none)}</li>`}</ul>`;
}

function nodeDetailHtml(state, node, lang, extra) {
  const T = copy(lang), tree = treeById(node.tree) || TREES.find((t) => t.id === node.tree);
  const v = nodeView(state, node), tierN = TIERS[node.tier - 1];
  const treeName = tr(tree.name, lang);
  const pips = Array.from({ length: MAX_NODE_RANK }, (_, n) => `<i${n < v.rank ? ' class="on"' : ''}></i>`).join('');
  const nextLine = v.rank >= MAX_NODE_RANK ? `<li class="is-ok"><i>✓</i>${esc(T.maxed)}</li>`
    : `<li><i>•</i>${esc(fill(T.onePoint, { tree: treeName }))}</li><li class="${v.open ? 'is-ok' : 'is-miss'}"><i>${v.open ? '✓' : '✕'}</i>${esc(fill(T.tierNeed, { n: tierN.rank, tree: treeName }))}</li>`;
  return `<div class="sk-node">
    ${heroHtml(tree, 'sk-hero', skillGlyph(node.icon, 'sk-hero-ico'))}
    <div class="sk-node-head"><h2>${esc(tr(node.name, lang))}</h2>
      <span class="sk-kind is-${node.kind}">${esc(T.kind[node.kind] || node.kind)}</span><span class="sk-node-rank">${v.rank}/${MAX_NODE_RANK}<span class="sk-pips">${pips}</span></span></div>
    <p class="sk-desc">${esc(tr(node.desc, lang))}</p>
    <h3 class="ch-h2">${esc(T.rank)}</h3><div class="sk-fxs">${ranksHtml(node, v.rank, T, lang)}</div>
    <h3 class="ch-h2">${esc(T.nextRank)}</h3><ul class="sk-req">${nextLine}</ul>
    <h3 class="ch-h2">${esc(T.requires)}</h3>${requirementsHtml(node, state.ctxFor(node), T)}
    <div class="sk-act"><button class="btn sk-raise" type="button" disabled title="${esc(T.soon)}">${esc(T.raise)}</button></div>
    ${extra?.tattoo || ''}</div>`;
}

function treeSummaryHtml(state, tree, lang) {
  const T = copy(lang), rank = treeRank(tree.id, state.practice), pr = progress(tree.id, state.practice), pts = state.points(tree.id);
  const trained = Object.hasOwn(T.activity, tree.id) ? `<p class="sk-trained">${esc(fill(T.trained, { activity: T.activity[tree.id] }))}</p>` : '';
  const prov = tree.id === 'combat' && state.provisional.combat ? `<p class="sk-trained">${esc(T.provisional)}</p>` : '';
  return `<div class="sk-node is-summary">
    ${heroHtml(tree, 'sk-hero')}
    <div class="sk-node-head"><h2>${esc(tr(tree.name, lang))}</h2><span class="sk-node-rank">${esc(T.rank)} ${rank}/${MAX_TREE_RANK}</span></div>
    <p class="sk-desc">${esc(tr(tree.tag, lang))}</p>
    <div class="sk-sum-practice"><span>${esc(T.practice)}</span>${barHtml(pr.ratio)}<b>${esc(practiceText(pr, lang, T))}</b></div>
    <div class="sk-points-row"><span>${esc(T.earned)}</span><b>${pts.earned}</b></div>
    <div class="sk-points-row"><span>${esc(T.spent)}</span><b>${pts.spent}</b></div>
    <div class="sk-points-row is-free"><span>${esc(T.free)}</span><b>${pts.free}</b></div>
    ${prov}${trained}
    <p class="sk-pick">${esc(T.pick)}</p>
    ${tree.id === 'survival' ? loggingSkillHtml(state.progression, lang) : ''}</div>`;
}

/**
 * Right column. With a node selected: its detail (`extra.tattoo` is appended, the screen's existing tattoo card);
 * otherwise the tree summary.
 */
export function skillRightHtml(state, sel, lang, extra = {}) {
  lang = langOf(lang);
  const tree = treeById(sel?.tree) || visibleTrees()[0];
  const node = sel?.node ? nodeById(sel.node) : null;
  return node && node.tree === tree.id ? nodeDetailHtml(state, node, lang, extra) : treeSummaryHtml(state, tree, lang);
}
