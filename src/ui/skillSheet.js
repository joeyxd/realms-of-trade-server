// Skill sheet (SK02, PLAN-SKILLS.md 2.1, 2.3, 2.4 and 3.1 to 3.3): the read-only `tree` kind of the Habilidades tab.
// A pure view model plus html builders: no DOM, no profile writes. The state is derived from the live profile with
// absent-preserving reads (combat practice always comes from weapon mastery), then drawn as three
// columns: the tree list, the 5x3 node grid and the node detail. The character screen owns selection and clicks.
import { WEAPON_KINDS } from '../data/weapons.js';
import { ARTS, DEFAULT_LOADOUT, isArt } from '../data/tattoos.js';
import { BASES, SLOTS as GEAR_SLOTS } from '../data/items.js';
import { effectiveRank, grantedSkills } from '../data/grants.js';
import { itemName } from '../sim/items.js';
import { translateData } from '../core/i18n.js';
import {
  CURVES, MAX_NODE_RANK, MAX_TREE_RANK, SKILL_RESET_GOLD, TIERS, TREES, combatPractice, gateState, legacySkills, nodeById, nodeRank,
  nodesByTier, pointsEarned, pointsFree, pointsSpent, practiceOf, practiceToNext, skillGrant, tierOpen, treeRank,
} from '../data/skillTree.js';
import { skillIcon } from './hud.js';
import { loggingSkillHtml } from './loggingSkill.js';
import { LINE_ICONS as I, atlasIcon, escHtml as esc, fmtNum, hasAtlasIcon, kitAsset, tr } from './kit.js';

// Trees whose painted hero (assets/ui/skills/hero-<id>.webp and -mobile, cut by tools/crafting-ui/skill_icons.py) has shipped;
// the hidden exploration tree has none and shows its icon on the plate instead (the same pattern as workbench.js).
export const HERO_ART = new Set(['combat', 'survival', 'sailing', 'crafting', 'trade']);

const PRACTICE_KEYS = ['logging', 'survival', 'sailing', 'crafting', 'trade'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));

// Presentation strings. Node and tree names come from the catalog pairs through tr().
const COPY = {
  es: {
    trees: 'Árboles', points: 'Puntos de habilidad', earned: 'Ganados', spent: 'Gastados', free: 'Libres', freeTip: 'Puntos libres',
    rank: 'Rango', practice: 'Práctica', maxRank: 'Rango máximo', combatPractice: 'Práctica de combate: suma de la maestría de tus armas.',
    pick: 'Elige una habilidad de la rejilla para ver su detalle.', trained: 'Se entrena con {activity}.',
    kind: { active: 'Activa', technique: 'Técnica', passive: 'Pasiva' },
    now: 'Ahora', next: 'Siguiente', tbd: 'Efecto por definir', none: 'Ninguno',
    nextRank: 'Siguiente rango', onePoint: '1 punto de {tree}', tierNeed: 'Requiere rango {n} de {tree}', maxed: 'Rango máximo alcanzado',
    lentBy: 'Prestado por {item}', putSlot: 'Poner en {slot}', onSlot: 'En {slot}',
    requires: 'Requiere', needWeapon: '{weapon} en mano', needMastery: 'Maestría de {lower} {n}', needSepia: 'Aprendido con Doña Sepia', needPearl: 'Perla tragada',
    weapons: { sable: 'Sable', pistolas: 'Pistolas' },
    raise: 'Subir', soon: 'Disponible pronto', locked: 'Bloqueada', tierClosed: 'Nivel cerrado', noPoints: 'Sin puntos libres',
    reset: 'Reiniciar árbol', resetFree: 'Primer reinicio gratis', resetGold: 'Cuesta {gold} de oro', resetEmpty: 'No hay puntos gastados',
    resetNoGold: 'Oro insuficiente', actionsOff: 'Las acciones están deshabilitadas.', retry: 'Reintentar',
    waiting: 'Enviando...', synced: 'Guardado', sessionOnly: 'Guardado solo en esta sesión', deniedGeneric: 'La operación fue rechazada.',
    denied: {
      command: 'Operación inválida.', profile: 'Perfil inválido.', limit: 'Se alcanzó el límite de reinicios.', conflict: 'El perfil cambió; inténtalo de nuevo.',
      draft: 'Esta habilidad aún no está disponible.', tier: 'Nivel cerrado.', max: 'Rango máximo alcanzado.', points: 'No hay puntos libres.',
      gate: 'No cumples los requisitos.', empty: 'No hay puntos gastados en este árbol.', gold: 'No tienes oro suficiente.',
      disabled: 'Las acciones están deshabilitadas.', account_required: 'Necesitas una cuenta para esto.', busy: 'Hay otra operación pendiente.',
      storage: 'No se pudo confirmar el guardado.',
    },
    fx: { dmg: 'Daño', win: 'Margen de parry', fireCut: 'Intervalo de disparo', stormR: 'Alcance de la Tormenta', rainDur: 'Duración de la Lluvia', rainR: 'Radio de la Lluvia' },
    activity: {
      survival: 'tala, agua dulce, comida y rescate (hoy solo cuenta la tala)', sailing: 'pilotar la nave, atracar y reparar la balsa',
      crafting: 'fabricar recetas y aprender con el artesano', trade: 'comerciar con agentes y cumplir contratos',
    },
  },
  en: {
    trees: 'Trees', points: 'Skill points', earned: 'Earned', spent: 'Spent', free: 'Free', freeTip: 'Free points',
    rank: 'Rank', practice: 'Practice', maxRank: 'Max rank', combatPractice: 'Combat practice: the sum of your weapon mastery.',
    pick: 'Pick a skill on the grid to see its detail.', trained: 'Trained by {activity}.',
    kind: { active: 'Active', technique: 'Technique', passive: 'Passive' },
    now: 'Now', next: 'Next', tbd: 'Effect to be defined', none: 'None',
    nextRank: 'Next rank', onePoint: '1 {tree} point', tierNeed: 'Needs {tree} rank {n}', maxed: 'Max rank reached',
    lentBy: 'Lent by {item}', putSlot: 'Put in {slot}', onSlot: 'In {slot}',
    requires: 'Requires', needWeapon: '{weapon} in hand', needMastery: '{weapon} mastery {n}', needSepia: 'Learned from Doña Sepia', needPearl: 'Swallowed pearl',
    weapons: { sable: 'Saber', pistolas: 'Pistols' },
    raise: 'Raise', soon: 'Coming soon', locked: 'Locked', tierClosed: 'Tier closed', noPoints: 'No free points',
    reset: 'Reset tree', resetFree: 'First reset is free', resetGold: 'Costs {gold} gold', resetEmpty: 'No points spent',
    resetNoGold: 'Not enough gold', actionsOff: 'Actions are disabled.', retry: 'Retry',
    waiting: 'Sending...', synced: 'Saved', sessionOnly: 'Saved for this session only', deniedGeneric: 'The operation was rejected.',
    denied: {
      command: 'Invalid operation.', profile: 'Invalid profile.', limit: 'Reset limit reached.', conflict: 'The profile changed; try again.',
      draft: 'This skill is not available yet.', tier: 'Tier closed.', max: 'Max rank reached.', points: 'No free points.',
      gate: 'Requirements not met.', empty: 'No points spent in this tree.', gold: 'Not enough gold.',
      disabled: 'Actions are disabled.', account_required: 'You need an account for this.', busy: 'Another operation is pending.',
      storage: 'The save could not be confirmed.',
    },
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

  const practice = { combat: combatPractice(p?.mast), logging: 0, survival: 0, sailing: 0, crafting: 0, trade: 0 };
  for (const key of PRACTICE_KEYS) practice[key] = count(progression?.practice?.[key]);

  const has = isObj(p?.sk?.has) ? p.sk.has : {};
  const adopted = isObj(progression?.skills);
  const skills = adopted ? { ...progression.skills } : legacySkills(has, mastery);

  const pearl = !!p?.pearls?.swallowed;
  const knows = (id) => !!id && Object.hasOwn(has, id) && !!has[id];
  // Skills the worn items lend (SK05a): derived from the profile's own equipment and the BASES catalog, never sent by
  // anyone. `lent[id] = { rank, by: [item names] }`; `skills` and the points below stay OWNED ranks only.
  const eq = isObj(p?.eq) ? p.eq : {}, lent = {};
  for (const [id, g] of Object.entries(grantedSkills(eq)))
    lent[id] = { rank: g.rank, by: g.by.map((b) => { const it = GEAR_SLOTS.map((s) => eq[s]).find((x) => x && x.b === b); return it ? itemName(it) : BASES[b].name; }) };
  const row = p?.sk?.lo?.[weaponIndex | 0];
  return {
    practice, skills, weapon, mastery, pearl, progression: progression || undefined, lent,
    loadout: Array.isArray(row) ? [...row] : [...(DEFAULT_LOADOUT[weapon] || [])],
    knows, gold: count(p?.gold),
    resets: (treeId) => (Object.hasOwn(progression?.skr ?? {}, treeId) ? count(progression.skr[treeId]) : 0),
    ctxFor: (node) => ({ weapon, mastery: { ...mastery }, knowledge: knows(node?.skill) ? ['tattoo'] : [], pearl }),
    points: (treeId) => {
      const grant = adopted ? count(progression?.skg?.[treeId]) : skillGrant(treeId, practice, skills);
      const earned = pointsEarned(treeId, practice) + grant, spent = pointsSpent(treeId, skills);
      return { earned, spent, free: pointsFree(treeId, practice, skills, grant) };
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
  const style = art ? ` style="--art:url('${kitAsset(`skills/hero-${tree.id}.webp`)}');--art-m:url('${kitAsset(`skills/hero-${tree.id}-mobile.webp`)}')"` : '';
  return `<div class="${cls}${art ? '' : ' is-empty'}"${style} aria-hidden="true">${ico || (art ? '' : skillGlyph(tree.icon, 'sk-hero-ico'))}</div>`;
}

/** Cell state of one node: rank, whether its tier is open, the gate result and the classes derived from them. */
export function nodeView(state, node) {
  // `owned` is what Subir, points and tier gates see; `rank` is what the sheet shows: the higher of owned and lent.
  const owned = nodeRank(state.skills, node.id);
  const lent = state.lent && Object.hasOwn(state.lent, node.id) ? state.lent[node.id] : null;
  const rank = Math.min(MAX_NODE_RANK, effectiveRank(owned, lent));
  const open = tierOpen(node.tree, state.practice, node.tier);
  const gate = gateState(node, state.ctxFor(node));
  const locked = !open || !gate.ok;
  const dim = locked && !lent; // a lent node is usable whatever its tier or weapon gate says
  return { rank, owned, lent, open, gate, locked, cls: [dim ? 'is-locked' : rank === 0 ? 'is-open' : '', rank > 0 ? 'is-ranked' : '', lent ? 'is-lent' : ''].filter(Boolean).join(' ') };
}

// "Lent by <item name>" for the cell title and the detail (item names are Spanish game data: translateData).
const lentText = (lent, T) => fill(T.lentBy, { item: lent.by.map((n) => translateData(n)).join(', ') });

// ---- Controls (SK04b) ---------------------------------------------------------------------------------------------------

// What the screen passes from SkillControls.view(); the default is the closed sheet (flag off), so plain calls stay read-only.
const CLOSED = { enabled: false, busy: false, retryReady: false, statusKey: 'idle', statusWhy: '' };
const controlsOf = (controls) => ({ ...CLOSED, ...(isObj(controls) ? controls : {}) });

// Why Subir is off, as a COPY key, or '' when the local check passes. It mirrors the server (skillPlan.js): the gate is
// checked against the weapon the node asks for, not the one in hand.
function raiseWhy(state, node, view, ctl) {
  if (!ctl.enabled || node.draft) return 'soon';
  if (ctl.busy) return 'waiting';
  if (!view.open) return 'tierClosed';
  if (view.owned >= MAX_NODE_RANK) return 'maxed';
  if (state.points(node.tree).free < 1) return 'noPoints';
  return gateState(node, { ...state.ctxFor(node), weapon: node.gate?.weapon }).ok ? '' : 'locked';
}

// Why the tree reset is off, as a COPY key, or ''. The first reset of a tree is free, then SKILL_RESET_GOLD.
function resetWhy(state, tree, ctl) {
  if (!ctl.enabled) return 'actionsOff';
  if (ctl.busy) return 'waiting';
  if (state.points(tree).spent < 1) return 'resetEmpty';
  return state.resets(tree) < 1 || state.gold >= SKILL_RESET_GOLD ? '' : 'resetNoGold';
}

// The locked note (flag off) and the status line of the last operation.
function statusHtml(ctl, T) {
  const text = ctl.statusKey === 'denial' ? (Object.hasOwn(T.denied, ctl.statusWhy) ? T.denied[ctl.statusWhy] : T.deniedGeneric)
    : ctl.statusKey === 'idle' ? '' : (T[ctl.statusKey] || '');
  // After a lost ack the sheet stays busy: the retry button (the one enabled while busy) resends the same command.
  const retry = ctl.retryReady === true && ctl.enabled && ctl.busy
    ? `<button class="btn sk-retry" type="button" data-skill-op="retry" data-tree="${esc(ctl.pendingTree ?? '')}">${esc(T.retry)}</button>` : '';
  return `${ctl.enabled ? '' : `<p class="sk-note">${esc(T.actionsOff)}</p>`}<p class="sk-status" data-status="${esc(ctl.statusKey)}" role="status">${esc(text)}</p>${retry}`;
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

// `controls` is accepted so the screen passes one view to both columns; the grid itself has no actions.
export function skillCenterHtml(state, sel, lang, controls) {
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
      return `<button class="sk-cell ${v.cls}${on ? ' is-selected' : ''}" type="button" data-node="${node.id}" aria-pressed="${on}" aria-label="${esc(name)}" title="${esc(name)}${v.lent ? ` · ${esc(lentText(v.lent, T))}` : v.locked ? ` · ${esc(v.open ? T.locked : T.tierClosed)}` : ''}">
        <span class="sk-cell-ico">${skillGlyph(node.icon, 'sk-ico')}</span><span class="sk-cell-name">${esc(name)}</span><span class="sk-pips">${pips}</span>${v.lent ? `<i class="sk-chain">${I.chain}</i>` : v.locked ? `<i class="sk-lock">${I.lock}</i>` : ''}</button>`;
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

// The Subir button: it carries its action only when the local check passes; otherwise it is disabled with the reason.
function raiseButtonHtml(state, node, v, ctl, T) {
  const why = raiseWhy(state, node, v, ctl);
  return why ? `<button class="btn sk-raise" type="button" disabled title="${esc(T[why])}">${esc(T.raise)}</button>`
    : `<button class="btn sk-raise" type="button" data-skill-op="assign" data-tree="${node.tree}" data-node="${node.id}">${esc(T.raise)}</button>`;
}

// Q / E for a lent art of the OTHER weapon (the owned and native flow lives in the character screen's tattoo card):
// the buttons carry the art id because no card selected it. The server decides (setLoadout, calm and lent checks).
function lentUseHtml(state, node, v, T) {
  const id = node.skill;
  if (!v.lent || node.kind !== 'active' || !id || !isArt(id) || ARTS[id].weapon === state.weapon) return '';
  const btn = (slot, i) => (state.loadout[i] === id
    ? `<button class="btn secondary" type="button" disabled>${esc(fill(T.onSlot, { slot: slot.toUpperCase() }))}</button>`
    : `<button class="btn" type="button" data-put="${slot}" data-id="${esc(id)}">${esc(fill(T.putSlot, { slot: slot.toUpperCase() }))}</button>`);
  return `<div class="sk-tt"><div class="tt-actions">${btn('q', 0)}${btn('e', 1)}</div></div>`;
}

function nodeDetailHtml(state, node, lang, extra, ctl) {
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
    ${v.lent ? `<p class="sk-lent"><i class="sk-chain">${I.chain}</i>${esc(lentText(v.lent, T))}</p>` : ''}${lentUseHtml(state, node, v, T)}
    <h3 class="ch-h2">${esc(T.rank)}</h3><div class="sk-fxs">${ranksHtml(node, v.rank, T, lang)}</div>
    <h3 class="ch-h2">${esc(T.nextRank)}</h3><ul class="sk-req">${nextLine}</ul>
    <h3 class="ch-h2">${esc(T.requires)}</h3>${requirementsHtml(node, state.ctxFor(node), T)}
    <div class="sk-act">${raiseButtonHtml(state, node, v, ctl, T)}</div>
    ${statusHtml(ctl, T)}
    ${extra?.tattoo || ''}</div>`;
}

// The tree reset: the button, what it costs, and the status line (the summary is where no node is selected).
function resetHtml(state, tree, ctl, T) {
  const why = resetWhy(state, tree.id, ctl);
  const price = state.resets(tree.id) < 1 ? T.resetFree : fill(T.resetGold, { gold: SKILL_RESET_GOLD });
  const button = why ? `<button class="btn sk-reset" type="button" disabled title="${esc(T[why])}">${esc(T.reset)}</button>`
    : `<button class="btn sk-reset" type="button" data-skill-op="reset" data-tree="${tree.id}">${esc(T.reset)}</button>`;
  return `<div class="sk-act sk-reset-row"><small class="sk-price">${esc(price)}</small>${button}</div>${statusHtml(ctl, T)}`;
}

function treeSummaryHtml(state, tree, lang, ctl) {
  const T = copy(lang), rank = treeRank(tree.id, state.practice), pr = progress(tree.id, state.practice), pts = state.points(tree.id);
  const trained = Object.hasOwn(T.activity, tree.id) ? `<p class="sk-trained">${esc(fill(T.trained, { activity: T.activity[tree.id] }))}</p>` : '';
  const combat = tree.id === 'combat' ? `<p class="sk-trained">${esc(T.combatPractice)}</p>` : '';
  return `<div class="sk-node is-summary">
    ${heroHtml(tree, 'sk-hero')}
    <div class="sk-node-head"><h2>${esc(tr(tree.name, lang))}</h2><span class="sk-node-rank">${esc(T.rank)} ${rank}/${MAX_TREE_RANK}</span></div>
    <p class="sk-desc">${esc(tr(tree.tag, lang))}</p>
    <div class="sk-sum-practice"><span>${esc(T.practice)}</span>${barHtml(pr.ratio)}<b>${esc(practiceText(pr, lang, T))}</b></div>
    <div class="sk-points-row"><span>${esc(T.earned)}</span><b>${pts.earned}</b></div>
    <div class="sk-points-row"><span>${esc(T.spent)}</span><b>${pts.spent}</b></div>
    <div class="sk-points-row is-free"><span>${esc(T.free)}</span><b>${pts.free}</b></div>
    ${combat}${trained}
    <p class="sk-pick">${esc(T.pick)}</p>
    ${resetHtml(state, tree, ctl, T)}
    ${tree.id === 'survival' ? loggingSkillHtml(state.progression, lang) : ''}</div>`;
}

/**
 * Right column. With a node selected: its detail (`extra.tattoo` is appended, the screen's existing tattoo card);
 * otherwise the tree summary. `controls` is SkillControls.view(): without it the actions stay closed.
 */
export function skillRightHtml(state, sel, lang, extra = {}, controls) {
  lang = langOf(lang);
  const tree = treeById(sel?.tree) || visibleTrees()[0];
  const node = sel?.node ? nodeById(sel.node) : null;
  const ctl = controlsOf(controls);
  return node && node.tree === tree.id ? nodeDetailHtml(state, node, lang, extra, ctl) : treeSummaryHtml(state, tree, lang, ctl);
}
