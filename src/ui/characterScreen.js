// Character screen (UI kit, the author's "character details" reference): one full-screen sheet with tabs.
// Personaje: who you are, live vitals, core stats, your 3D figure on a turntable, what you wear and the tool belt.
// Inventario: the gear bag (or Tía Perla's stall) and the goods backpack. Habilidades / Diario / Perlas reuse the
// CharPanel bodies in one wide plate. Every action is still the CharPanel `cmd`; the server answers with a profile.
import { CharPanel } from './charpanel.js';
import { BASES, RARITIES, ITEMS, CONSUMABLES, STATS, slotFits } from '../data/items.js';
import { WEAPONS, WEAPON_KINDS } from '../data/weapons.js';
import { ARTS, DEFAULT_LOADOUT } from '../data/tattoos.js';
import { TREES, nodeById } from '../data/skillTree.js';
import { GOOD_IDS } from '../data/goods.js';
import { tuning } from '../data/tuning.js';
import { GAME } from '../data/meta.js';
import { SKINS } from '../render/characters.js';
import { itemName, itemValue, itemScore } from '../sim/items.js';
import { gearTotals, statsFor } from '../sim/systems/stats.js';
import { holdMass, holdUsed } from '../sim/economy/cargo.js';
import { CARRY, readCarryField } from '../data/carry.js';
import { packComfort } from '../sim/economy/carry.js';
import { readAttrField } from '../data/attributes.js';
import { FOODS } from '../data/survival.js';
import { statLines, compareLines, targetSlot } from './itemui.js';
import { skillIcon } from './hud.js';
import { pearlHtml } from './pearlpanel.js';
import { createFigureLoop } from './figureLoop.js';
import { loggingSkillHtml } from './loggingSkill.js';
import { skillSheetState, skillListHtml, skillCenterHtml, skillRightHtml } from './skillSheet.js';
import { sfx } from '../audio/sfx.js';
import { goodName } from './craftingCatalog.js';
import { provisionsGuideHtml } from './provisionInfo.js';
import { translateData } from '../core/i18n.js';
import { LINE_ICONS as I, atlasIcon, escHtml as esc, fmtNum, onLocaleChange, uiLang } from './kit.js';

const TEXT = {
  es: {
    dialog: 'Personaje', close: 'Cerrar', tagline: 'Explora · Recolecta · Sobrevive', motto: 'Más audaz\nMás lejos',
    tabs: { stats: 'Personaje', gear: 'Inventario', skills: 'Habilidades', quests: 'Diario', pearl: 'Perlas' },
    details: 'Detalles del personaje', level: 'Nivel', health: 'Salud', stamina: 'Aguante', carry: 'Carga',
    core: 'Atributos', allStats: 'Ver todos', back: 'Volver', equipment: 'Equipo', itemDetails: 'Detalles del objeto',
    slot: { head: 'Cabeza', chest: 'Pecho', boots: 'Botas', weapon: 'Arma', ring1: 'Abalorio', ring2: 'Abalorio' },
    pack: 'Mochila', potions: 'Pociones', belt: 'Cinturón de herramientas', gold: 'Oro', soon: 'Próximamente',
    volume: 'Volumen', weight: 'Peso', backpackTier: 'Mochila {n} de {max}', pending: 'Llegando',
    food: 'Saciedad', water: 'Hidratación', needPen: 'Hambre y sed: −{n} % de vida y aguante máximos', noRegen: 'sin recuperar aguante',
    eat: 'Comer', drink: 'Beber', eatHint: '{verb} {name} · {gain} · en Agua y provisiones', gainSat: '+{n} saciedad', gainHyd: '+{n} hidratación',
    beltTools: { axe: 'Hacha de piedra', pickaxe: 'Pico de piedra' }, axes: ['Hacha de piedra', 'Hacha de hierro', 'Hacha de acero'], missing: 'Sin fabricar',
    quick: 'Acceso rápido', rotate: 'Girar', zoom: 'Zoom', reset: 'Restablecer vista',
    views: ['Frente', 'Perfil', 'Espalda'], hintBack: 'Volver', hintEquip: 'Equipar', dbl: 'Doble clic',
    empty: 'Vacío', inBag: 'En tu bolsa', noneInBag: 'No llevas nada para este hueco.', pick: 'Elige un hueco o un objeto para verlo.',
    bag: 'Bolsa', goods: 'Mochila', lv: 'Nv.', value: 'Valor', goldUnit: 'oro', fresh: 'NUEVO', vsWorn: 'Frente a lo equipado',
    equip: 'Equipar', unequip: 'Quitar', salvage: 'Desguazar +{v}', sell: 'Vender +{v}', sure: '¿Seguro? +{v}',
    kit: 'Cambia tu kit a {name}.', scale: 'Barra: base del nivel {n}', capScale: 'Barra: tope {n}',
    stat: { atk: 'Ataque', def: 'Defensa', hp: 'Vida', crit: 'Crítico', speed: 'Velocidad', cdr: 'Enfriamiento' },
    quick8: { lmb: 'Ataque', lmbPistol: 'Disparo rápido', rmb: 'Guardia', rmbPistol: 'Disparo potente', dash: 'Dash', pot: 'Poción' },
    quote: '«Mismo cielo.\nHistorias distintas.»', quote2: '«Cosas simples.\nLugares extraordinarios.»', noProfile: 'Aún no has subido a bordo.',
    looks: ['Corsario curtido en mil abordajes; nunca le falta un plan ni una salida.', 'Exploradora de costas y cuevas, siempre detrás del siguiente horizonte.',
      'Bucanero de puerto en puerto, rápido con el sable y con la lengua.', 'Hija de la tormenta: lee el viento antes de que cambie.',
      'Brasa de la fragua volcánica; donde otros ven ceniza, él ve oficio.'],
  },
  en: {
    dialog: 'Character', close: 'Close', tagline: 'Explore · Gather · Survive', motto: 'Bolder\nFarther',
    tabs: { stats: 'Character', gear: 'Inventory', skills: 'Skills', quests: 'Journal', pearl: 'Pearls' },
    details: 'Character details', level: 'Level', health: 'Health', stamina: 'Stamina', carry: 'Carry',
    core: 'Core stats', allStats: 'View all', back: 'Back', equipment: 'Equipment', itemDetails: 'Item details',
    slot: { head: 'Head', chest: 'Chest', boots: 'Boots', weapon: 'Main hand', ring1: 'Trinket', ring2: 'Trinket' },
    pack: 'Backpack', potions: 'Potions', belt: 'Tool belt', gold: 'Gold', soon: 'Coming soon',
    volume: 'Volume', weight: 'Weight', backpackTier: 'Backpack {n} of {max}', pending: 'Arriving',
    food: 'Satiety', water: 'Hydration', needPen: 'Hunger and thirst: −{n}% max health and stamina', noRegen: 'no stamina recovery',
    eat: 'Eat', drink: 'Drink', eatHint: '{verb} {name} · {gain} · in Water and provisions', gainSat: '+{n} satiety', gainHyd: '+{n} hydration',
    beltTools: { axe: 'Stone Axe', pickaxe: 'Stone Pickaxe' }, axes: ['Stone Axe', 'Iron Axe', 'Steel Axe'], missing: 'Not crafted',
    quick: 'Quick access', rotate: 'Rotate', zoom: 'Zoom', reset: 'Reset view',
    views: ['Front', 'Side', 'Back'], hintBack: 'Back', hintEquip: 'Equip', dbl: 'Double-click',
    empty: 'Empty', inBag: 'In your bag', noneInBag: 'Nothing in your bag fits this slot.', pick: 'Pick a slot or an item to inspect it.',
    bag: 'Bag', goods: 'Backpack', lv: 'Lv.', value: 'Value', goldUnit: 'gold', fresh: 'NEW', vsWorn: 'Against what you wear',
    equip: 'Equip', unequip: 'Unequip', salvage: 'Salvage +{v}', sell: 'Sell +{v}', sure: 'Sure? +{v}',
    kit: 'Switches your kit to {name}.', scale: 'Bar: level {n} base', capScale: 'Bar: cap {n}',
    stat: { atk: 'Attack', def: 'Defense', hp: 'Health', crit: 'Critical', speed: 'Speed', cdr: 'Cooldown' },
    quick8: { lmb: 'Attack', lmbPistol: 'Quick shot', rmb: 'Guard', rmbPistol: 'Power shot', dash: 'Dash', pot: 'Potion' },
    quote: '“Same sky.\nDifferent stories.”', quote2: '“Simple things.\nExtraordinary places.”', noProfile: 'You have not come aboard yet.',
    looks: ['A corsair hardened by a thousand boardings; never short of a plan or a way out.', 'An explorer of coasts and caves, always chasing the next horizon.',
      'A buccaneer from port to port, quick with the cutlass and quicker with words.', 'A daughter of the storm: she reads the wind before it turns.',
      'An ember of the volcanic forge; where others see ash, he sees a trade.'],
  },
};
const TAB_ORDER = [['stats', 'C', 'person'], ['gear', 'I', 'backpack'], ['skills', 'T', 'skills'], ['quests', 'L', 'journal'], ['pearl', 'P', 'pearl']];
const RARITY_VAR = ['common', 'uncommon', 'rare', 'epic', 'legend'];
const SLOT_ICON = { head: 'head', chest: 'chest', boots: 'boots', weapon: 'sword', ring1: 'ring', ring2: 'ring' };
const STAT_ICON = { atk: 'sword', def: 'shield', hp: 'heart', crit: 'crit', critD: 'crit', spd: 'speed', cdr: 'cooldown', rip: 'bolt', refl: 'shield',
  guard: 'shield', dash: 'speed', xp: 'stats', gold: 'gold', pot: 'heart', kill: 'heart', win: 'clock', fire: 'clock' };
const VIEWS = [0, Math.PI / 2, Math.PI];
const HOME_YAW = 0.38;
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
const pct = (v) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
const comfortOf = (p, pack) => packComfort({ ...p, eco: { ...p.eco, pack } });

export class CharacterScreen extends CharPanel {
  constructor(root, opts) {
    super(root, opts);
    Object.assign(this, { vitals: opts.vitals, figure: opts.figure, slots: opts.slots, tools: opts.tools, onFood: opts.onFood,
      weapon: opts.weapon || (() => this.stats().weapon), figureAnimated: opts.figureAnimated || (() => false), reducedMotion: opts.reducedMotion || (() => false) });
    this.tab = 'stats';
    this.statsAll = false;
    this.slotFocus = null;
    this.skTree = 'combat'; // SK02: the tree and the node picked on the Habilidades sheet (kept across re-renders)
    this.skNode = null;
    this.cam = { yaw: HOME_YAW, zoom: 1 };
    this.figureLoop = createFigureLoop({ shouldRun: () => this.shouldAnimateFigure(), draw: (delta) => this.drawFigure(false, { delta }) });
    this.onFigureVisibilityChange = () => this.syncFigureLoop();
    document.addEventListener('visibilitychange', this.onFigureVisibilityChange);
    root.addEventListener('pointerdown', (e) => this.dragStart(e));
    root.addEventListener('wheel', (e) => { if (!e.target.closest('.ch-model')) return; e.preventDefault(); this.zoomBy(e.deltaY); }, { passive: false });
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = onLocaleChange(() => { this.shellKey = ''; this.refresh(); });
  }

  t() { return TEXT[uiLang()]; }
  open(tab, opts) {
    // Inventory hotkey + stall keep their tab; everything else lands on the character sheet.
    if (tab && tab !== this.tab) { this.statsAll = false; this.slotFocus = null; }
    super.open(tab, opts);
    document.body.classList.add('char-sheet'); // styles/character.css: the HUD steps aside behind the sheet
    clearInterval(this.live); this.live = setInterval(() => this.updateLive(), 250);
    this.syncFigureLoop();
  }
  close() { this.figureLoop.stop(); clearInterval(this.live); this.live = 0; this.drag = null; document.body.classList.remove('char-sheet'); super.close(); }
  // A new selection starts its card at the top (the box keeps its scroll across innerHTML swaps).
  renderDetail() {
    const key = JSON.stringify([this.pinned, this.hover, this.slotFocus]);
    super.renderDetail();
    if (key === this.detailKey) return;
    this.detailKey = key;
    const box = this.root.querySelector('.ch-item .cp-detail');
    if (box) box.scrollTop = 0;
  }

  onClick(e) {
    const t = e.target;
    if (t.closest('[data-all-stats]')) { this.statsAll = !this.statsAll; this.render(); return; }
    const eat = t.closest('[data-eat]');
    if (eat) { this.onFood?.(eat.dataset.eat); return; } // RNV07b: eat and drink in the water and provisions panel
    if (t.closest('[data-goto-gear]')) { this.tab = 'gear'; this.pinned = null; this.render(); return; }
    const view = t.closest('[data-view]');
    if (view) { this.cam.yaw = VIEWS[+view.dataset.view] ?? HOME_YAW; this.requestFigure(); return; }
    if (t.closest('[data-view-reset]')) { this.cam = { yaw: HOME_YAW, zoom: 1 }; this.requestFigure(); return; }
    if (this.kind() === 'tree') {
      const tree = t.closest('[data-tree]'), node = t.closest('[data-node]');
      const op = t.closest('[data-skill-op]');
      if (op) { if (!op.disabled) { this.skills.act(op.dataset.skillOp, { tree: op.dataset.tree, node: op.dataset.node }); this.render(); sfx.click(); } return; }
      if (tree && TREES.some((x) => x.id === tree.dataset.tree && !x.hidden)) { this.skTree = tree.dataset.tree; this.skNode = null; this.render(); sfx.click(); return; }
      if (node && nodeById(node.dataset.node)?.tree === this.skSelection().tree) { this.skNode = this.skNode === node.dataset.node ? null : node.dataset.node; this.render(); sfx.click(); return; }
    }
    const slot = t.closest('[data-slot]');
    if (slot) { this.slotFocus = slot.dataset.slot; if (!this.profile()?.eq?.[this.slotFocus]) { this.pinned = null; this.renderDetail(); this.mark(); return; } }
    else if (t.closest('[data-tab]')) { this.slotFocus = null; this.statsAll = false; }
    super.onClick(e);
  }

  // ---- 3D figure ------------------------------------------------------------------------------------------
  dragStart(e) {
    const model = e.target.closest('.ch-model');
    if (!model || e.button > 0 || e.target.closest('button')) return;
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, id: e.pointerId };
    model.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (!this.drag || ev.pointerId !== this.drag.id) return;
      // The stage may be rotated on an upright phone: use the larger screen-space delta.
      const dx = document.body.classList.contains('rotated') ? ev.clientY - this.drag.y : ev.clientX - this.drag.x;
      this.cam.yaw = this.drag.yaw + dx * 0.012; this.requestFigure();
    };
    const up = () => { this.drag = null; model.removeEventListener('pointermove', move); model.removeEventListener('pointerup', up); model.removeEventListener('pointercancel', up); };
    model.addEventListener('pointermove', move); model.addEventListener('pointerup', up); model.addEventListener('pointercancel', up);
  }
  zoomBy(dy) { this.cam.zoom = Math.max(0.85, Math.min(2.4, this.cam.zoom * (1 - Math.sign(dy) * 0.1))); this.requestFigure(); }
  shouldAnimateFigure() {
    if (!this.isOpen || this.root.hidden || !this.profile() || this.kind() !== 'sheet' || typeof this.figure !== 'function') return false;
    if (typeof this.figureAnimated !== 'function' || !this.figureAnimated()) return false;
    if (typeof this.reducedMotion === 'function' && this.reducedMotion()) return false;
    if (globalThis.document?.hidden) return false;
    const canvas = this.root.querySelector('.ch-model canvas');
    if (!canvas || !canvas.getClientRects().length) return false;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  syncFigureLoop() { this.figureLoop.sync(); }
  requestFigure() {
    this.syncFigureLoop();
    if (this.figureLoop.pending) return;
    if (this.figQueued) return;
    this.figQueued = true;
    requestAnimationFrame(() => { this.figQueued = false; this.drawFigure(); });
  }
  sizeCanvas(c, cap = 1.5) {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, cap), w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w < 8 || h < 8) return false;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return true;
  }
  drawFigure(thumbs = false, { delta = 0 } = {}) {
    if (!this.isOpen || typeof this.figure !== 'function' || this.kind() !== 'sheet') return; // the tree kind has no figure
    const main = this.root.querySelector('.ch-model canvas');
    try {
      if (main && this.sizeCanvas(main)) this.figure(main, { yaw: this.cam.yaw, zoom: this.cam.zoom, idle: true, delta, still: false });
      if (thumbs) this.root.querySelectorAll('[data-view] canvas').forEach((c, i) => {
        if (this.sizeCanvas(c, 1.25)) this.figure(c, { yaw: VIEWS[i], zoom: 1, idle: true, delta: 0, still: true });
      });
    } catch { /* the figure is decoration; the sheet works without it */ }
    const views = this.root.querySelectorAll('[data-view]');
    views.forEach((b, i) => b.classList.toggle('on', Math.abs(((this.cam.yaw - VIEWS[i]) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.5));
  }

  // ---- Rendering -------------------------------------------------------------------------------------------
  // 'tree' is the read-only skill sheet; the Doña Sepia flow (learn) keeps the wide tattoo list with its learn buttons.
  kind() {
    if (this.tab === 'skills' && !this.learn) return 'tree';
    return (this.tab === 'stats' && !this.statsAll) || this.tab === 'gear' ? 'sheet' : 'wide';
  }
  render() {
    const p = this.profile(), lang = uiLang(), T = TEXT[lang], kind = p ? this.kind() : 'wide';
    const shellKey = `${lang}|${this.tab}|${kind}|${this.shop}|${!!p}`;
    if (shellKey !== this.shellKey) {
      this.shellKey = shellKey; this.parts = {}; this.detail = null;
      this.root.innerHTML = this.shellHtml(T, kind);
      if (kind === 'sheet') requestAnimationFrame(() => this.drawFigure(true));
    }
    this.syncFigureLoop();
    this.root.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === this.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    if (!p) { this.part('wide', `<p class="cp-empty">${esc(T.noProfile)}</p>`); return; }
    if (kind === 'wide') {
      const scroll = this.root.querySelector('.ch-wide')?.scrollTop || 0;
      const body = this.tab === 'stats' ? `<div class="ch-wide-head"><button class="ch-link" data-all-stats>‹ ${esc(T.back)}</button></div>${this.statsHtml(p)}`
        : this.tab === 'skills' ? loggingSkillHtml(p.progression, lang) + this.tattooHtml(p) : this.tab === 'pearl' ? pearlHtml(p, null, this.nearby?.() || []) : this.questsHtml(p);
      if (this.part('wide', body) && this.renderedTab === this.tab) this.root.querySelector('.ch-wide').scrollTop = scroll;
      this.renderedTab = this.tab;
      return;
    }
    if (kind === 'tree') { this.renderTree(p, T, lang); return; }
    if (this.tab === 'stats') { this.part('left', this.detailsHtml(p, T, lang)); this.part('right', this.equipHtml(p, T, lang)); }
    else { this.part('left', this.shop ? this.shopHtml(p) + this.bagHtml(p, T, lang) : this.bagHtml(p, T, lang)); this.part('right', this.goodsHtml(p, T, lang)); }
    this.part('quick', this.quickHtml(p, T, lang));
    this.renderedTab = this.tab;
    this.updateLive();
    this.renderDetail(); this.mark();
  }
  // SK02 skill sheet: three regions from the live profile, plus the same quick bar as the sheet kind.
  renderTree(p, T, lang) {
    const sel = this.skSelection(), key = `${sel.tree}|${sel.node}`, same = key === this.skKey;
    const scrolls = ['left', 'center', 'right'].map((name) => [name, this.root.querySelector(`[data-part="${name}"]`)]);
    const tops = scrolls.map(([, el]) => el?.scrollTop || 0);
    const html = this.treeParts(p, lang);
    for (const name of ['left', 'center', 'right']) this.part(name, html[name]);
    this.part('quick', this.quickHtml(p, T, lang));
    // A new selection starts at the top; a profile refresh keeps the reader where they were.
    scrolls.forEach(([, el], i) => { if (el) el.scrollTop = same ? tops[i] : 0; });
    this.skKey = key;
    this.renderedTab = this.tab;
  }
  // The selection, always valid: a visible tree and (optionally) one of its nodes.
  skSelection() {
    const tree = TREES.find((x) => x.id === this.skTree && !x.hidden)?.id || 'combat';
    const node = this.skNode && nodeById(this.skNode)?.tree === tree ? this.skNode : null;
    return { tree, node };
  }
  treeParts(p, lang) {
    const state = skillSheetState(p, this.stats().weapon | 0), sel = this.skSelection(), node = sel.node ? nodeById(sel.node) : null;
    const controls = this.skills?.view();
    return { left: skillListHtml(state, sel, lang), center: skillCenterHtml(state, sel, lang, controls),
      right: skillRightHtml(state, sel, lang, { tattoo: node ? this.skillTattooBlock(p, node) : '' }, controls) };
  }
  // The existing tattoo card (Poner en Q / E, forms) for an active node whose art or tattoo can be used now.
  skillTattooBlock(p, node) {
    if (node.kind !== 'active' || !node.skill) return '';
    const w = this.stats().weapon | 0, kind = WEAPON_KINDS[w], sk = p.sk || { has: {}, lo: [], free: 1 };
    const has = (id) => sk.has?.[id], art = Object.hasOwn(ARTS, node.skill) ? ARTS[node.skill] : null;
    if (!has(node.skill) && !(art && art.weapon === kind)) return '';
    this.ttSel = node.skill; // tattooClick reads it for data-put and data-form
    const lo = sk.lo?.[w] || DEFAULT_LOADOUT[kind], mlvl = (p.mast?.[w] || [1])[0];
    return `<div class="sk-tt">${this.tattooDetail(p, node.skill, { lo, has, mlvl, kind, price: '' })}</div>`;
  }
  // Replaces one region only when its markup changed (profiles arrive often; the pointer must not lose its cell).
  part(name, html) {
    if (this.parts[name] === html) return false;
    const el = this.root.querySelector(`[data-part="${name}"]`);
    if (!el) return false;
    const guideOpen = el.querySelector('.provision-guide')?.open;
    this.parts[name] = html; el.innerHTML = html;
    const guide = el.querySelector('.provision-guide'); if (guide && guideOpen) guide.open = true;
    return true;
  }

  shellHtml(T, kind) {
    const tabs = TAB_ORDER.map(([id, key, icon]) => `<button class="ch-tab" type="button" role="tab" data-tab="${id}"><span class="ch-tab-ico">${I[icon]}</span><span>${esc(T.tabs[id])}</span><span class="kit-key">${key}</span></button>`).join('');
    const top = `<header class="ch-top">
        <div class="ch-brand"><span class="ch-brand-palm">${I.palm}</span><div><b>${esc(GAME.title || 'Marea Negra')}</b><small>${esc(T.tagline)}</small></div></div>
        <nav class="ch-tabs" role="tablist">${tabs}</nav>
        <p class="ch-motto" aria-hidden="true">${esc(T.motto)}<span>${I.palm}</span></p>
        <button class="ch-x" type="button" data-close aria-label="${esc(T.close)}">${I.close}</button>
      </header>`;
    const hints = `<div class="ch-hints ch-hints-l"><span><span class="kit-key">ESC</span>${esc(T.hintBack)}</span></div>
      <div class="ch-hints ch-hints-r"><span><span class="kit-key">${esc(T.dbl)}</span>${esc(T.hintEquip)}</span></div>`;
    if (kind === 'tree') return `<div class="cp ch-screen is-tree ch-on-${this.tab} interactive" role="dialog" aria-label="${esc(T.dialog)}">${top}
      <section class="ch-left kit-plate" data-part="left"></section>
      <section class="ch-center kit-plate" data-part="center"></section>
      <section class="ch-right kit-plate" data-part="right"></section>
      <footer class="ch-quick kit-plate" data-part="quick"></footer>${hints}</div>`;
    if (kind === 'wide') return `<div class="cp ch-screen is-wide interactive" role="dialog" aria-label="${esc(T.dialog)}">${top}<section class="ch-wide kit-plate" data-part="wide"></section>${hints}</div>`;
    const views = T.views.map((label, i) => `<button class="ch-view" type="button" data-view="${i}" aria-label="${esc(label)}" title="${esc(label)}"><canvas></canvas></button>`).join('');
    return `<div class="cp ch-screen is-sheet ch-on-${this.tab} interactive" role="dialog" aria-label="${esc(T.dialog)}">${top}
      <section class="ch-left kit-plate" data-part="left"></section>
      <section class="ch-center">
        <div class="ch-views">${views}</div>
        <div class="ch-model" title="${esc(T.rotate)} · ${esc(T.zoom)}"><i class="ch-floor"></i><canvas></canvas></div>
        <div class="ch-cam"><span><i class="ch-cam-ico">${I.rotate}</i>${esc(T.rotate)}</span><span><i class="ch-cam-ico">${I.mouse}</i>${esc(T.zoom)}</span>
          <button type="button" data-view-reset><span class="kit-key">↺</span>${esc(T.reset)}</button></div>
      </section>
      <section class="ch-right">
        <div class="ch-right-top kit-plate" data-part="right"></div>
        <div class="ch-item kit-plate"><h2 class="ch-h"><span class="ch-h-ico">${I.palm}</span>${esc(T.itemDetails)}</h2><div class="cp-detail"></div><p class="ch-quote2">${esc(T.quote2)}</p></div>
      </section>
      <footer class="ch-quick kit-plate" data-part="quick"></footer>${hints}</div>`;
  }

  // Character details: identity, live vitals (filled by updateLive) and the core stats.
  detailsHtml(p, T, lang) {
    const st = this.stats(), v = this.vitals?.() || {}, skin = Math.max(0, Math.min(4, v.skin | 0)), look = SKINS[skin];
    const g = gearTotals(p), top = statsFor(ITEMS.maxLevel);
    const crit = tuning.stats.crit + Math.min(STATS.crit.cap - tuning.stats.crit, g.crit);
    const rows = [
      ['atk', 'sword', st.atk, st.atk / (top.atk * 1.6), fmtNum(st.atk, lang), fill(T.scale, { n: ITEMS.maxLevel })],
      ['def', 'shield', st.def, st.def / (top.def * 1.6), fmtNum(st.def, lang), fill(T.scale, { n: ITEMS.maxLevel })],
      ['hp', 'heart', st.maxHp, st.maxHp / (top.hp * 1.6), fmtNum(st.maxHp, lang), fill(T.scale, { n: ITEMS.maxLevel })],
      ['crit', 'crit', crit, crit / STATS.crit.cap, `${fmtNum(crit * 100, lang, 1)} %`, fill(T.capScale, { n: `${STATS.crit.cap * 100} %` })],
      ['speed', 'speed', st.speed, st.speed / (tuning.player.runSpeed * (1 + STATS.spd.cap)), `${fmtNum(st.speed, lang, 2)} u/s`, fill(T.capScale, { n: `+${STATS.spd.cap * 100} %` })],
      ['cdr', 'cooldown', st.cdr, st.cdr / STATS.cdr.cap, st.cdr > 0 ? `−${fmtNum(st.cdr * 100, lang)} %` : '—', fill(T.capScale, { n: `${STATS.cdr.cap * 100} %` })],
    ].map(([k, icon, , ratio, text, tip]) => `<div class="ch-stat" title="${esc(tip)}"><span class="ch-stat-ico">${I[icon]}</span><span class="ch-stat-name">${esc(T.stat[k])}</span><span class="kit-bar"><i style="width:${pct(ratio)}"></i></span><b>${esc(text)}</b></div>`).join('');
    return `<h2 class="ch-h"><span class="ch-h-ico">${I.palm}</span>${esc(T.details)}</h2>
      <div class="ch-id"><b class="ch-name">${esc(v.name || '—')}</b>
        <div class="ch-level"><span>${esc(T.level)} <b data-live="level">${st.level}</b></span><span class="kit-bar ch-xp"><i data-live="xpbar"></i></span><small data-live="xp"></small></div></div>
      <div class="ch-class"><span class="ch-class-ico">${I.palm}</span><div><b>${esc(translateData(look?.name || ''))}</b><p>${esc(T.looks[skin] || '')}</p></div></div>
      <div class="ch-vitals">
        <div class="ch-vital is-hp"><span class="ch-vital-ico">${I.heart}</span><span>${esc(T.health)}</span><span class="kit-bar"><i data-live="hpbar"></i></span><b data-live="hp"></b></div>
        <div class="ch-vital is-stam"><span class="ch-vital-ico">${I.bolt}</span><span>${esc(T.stamina)}</span><span class="kit-bar"><i data-live="stbar"></i></span><b data-live="st"></b></div>
        ${this.carryVital(p, T, lang)}
        <div class="ch-needs" data-live="needs">
          <div class="ch-need is-food" data-live="needs-food" title="${esc(T.food)}"><span class="ch-vital-ico">${I.food}</span><span class="ch-need-name">${esc(T.food)}</span><span class="kit-bar"><i data-live="satbar"></i></span><b data-live="sat"></b></div>
          <div class="ch-need is-water" data-live="needs-water" title="${esc(T.water)}"><span class="ch-vital-ico">${I.survival}</span><span class="ch-need-name">${esc(T.water)}</span><span class="kit-bar"><i data-live="hydbar"></i></span><b data-live="hyd"></b></div>
        </div>
        <p class="ch-need-pen" data-live="needpen" hidden></p>
      </div>
      ${this.attributes.html(lang)}
      <h3 class="ch-h2">${esc(T.core)}<button class="ch-link" type="button" data-all-stats>${esc(T.allStats)} ›</button></h3>
      <div class="ch-core">${rows}</div>
      <p class="ch-quote">${esc(T.quote)}<span>${I.palm}</span></p>`;
  }
  // Weight against the comfortable load (volume for legacy packs without a weight limit).
  carryVital(p, T, lang) {
    const pack = p.eco.pack, weighed = Number.isFinite(pack.maxMass), used = weighed ? holdMass(pack) : holdUsed(pack);
    const max = weighed ? comfortOf(p, pack) : pack.cap;
    return `<div class="ch-vital is-load${used > max ? ' is-over' : ''}"><span class="ch-vital-ico">${I.weight}</span><span>${esc(T.carry)}</span><span class="kit-bar"><i style="width:${pct(used / (max || 1))}"></i></span><b>${fmtNum(used, lang, 1)} / ${fmtNum(max, lang)}</b></div>`;
  }
  // Numbers that move without a new profile (HP, guard stamina, XP).
  updateLive() {
    this.syncFigureLoop();
    if (!this.isOpen) return;
    const v = this.vitals?.(), lang = uiLang();
    if (!v) return;
    const set = (k, f) => { const el = this.root.querySelector(`[data-live="${k}"]`); if (el) f(el); };
    set('hpbar', (el) => { el.style.width = pct(v.hp / (v.maxHp || 1)); });
    set('hp', (el) => { el.textContent = `${fmtNum(Math.ceil(v.hp), lang)} / ${fmtNum(v.maxHp, lang)}`; });
    set('stbar', (el) => { el.style.width = pct(v.guard / (v.guardMax || 1)); });
    set('st', (el) => { el.textContent = `${fmtNum(Math.floor(v.guard), lang)} / ${fmtNum(Math.round(v.guardMax), lang)}`; });
    set('xpbar', (el) => { el.style.width = pct(v.xpNext ? v.xp / v.xpNext : 1); });
    set('xp', (el) => { el.textContent = v.xpNext ? `${fmtNum(Math.floor(v.xp), lang)} / ${fmtNum(v.xpNext, lang)} XP` : 'MAX'; });
    set('level', (el) => { el.textContent = String(v.level); });
    // SRV01: hunger and thirst (hidden for a body without them).
    const needs = v.needs > 0, T = TEXT[lang];
    set('needs', (el) => { el.hidden = !needs; });
    set('needs-food', (el) => { el.classList.toggle('is-low', v.sat < 30); });
    set('needs-water', (el) => { el.classList.toggle('is-low', v.hyd < 30); });
    set('satbar', (el) => { el.style.width = pct((v.sat ?? 100) / 100); });
    set('hydbar', (el) => { el.style.width = pct((v.hyd ?? 100) / 100); });
    set('sat', (el) => { el.textContent = fmtNum(Math.ceil(v.sat ?? 100), lang); });
    set('hyd', (el) => { el.textContent = fmtNum(Math.ceil(v.hyd ?? 100), lang); });
    set('needpen', (el) => {
      const pen = Math.round((v.needPen || 0) * 100);
      el.hidden = !needs || pen <= 0;
      el.textContent = pen > 0 ? fill(T.needPen, { n: fmtNum(pen, lang) }) + (Math.min(v.sat ?? 100, v.hyd ?? 100) <= 0 ? ` · ${T.noRegen}` : '') : '';
    });
  }

  slotCell(p, slot, T) {
    const it = p.eq[slot], r = it ? it.r : 0;
    const icon = it ? atlasIcon(BASES[it.b] ? it.b : '', 'ch-slot-ico') || this.legacyIcon(it) : `<span class="ch-slot-plus">${I.plus}</span>`;
    return `<button class="ch-slot${it ? ` r${r}` : ' is-empty'}${this.slotFocus === slot ? ' focus' : ''}" type="button" data-slot="${slot}" style="--rc:var(--r-${RARITY_VAR[r]})" aria-label="${esc(T.slot[slot])}">
      <span class="ch-slot-label">${esc(T.slot[slot])}</span><span class="ch-slot-box">${icon}${it ? `<i class="lv">${it.l}</i>` : `<i class="ch-slot-ghost">${I[SLOT_ICON[slot]]}</i>`}</span></button>`;
  }
  legacyIcon() { return `<span class="ch-slot-plus">${I.box}</span>`; }
  equipHtml(p, T, lang) {
    const st = this.stats(), tools = p.tools || {}, used = holdUsed(p.eco.pack);
    const fixed = (cls, label, icon, value, attrs = '') => `<div class="ch-slot ch-fixed ${cls}" ${attrs}><span class="ch-slot-label">${esc(label)}</span><span class="ch-slot-box">${icon}<b class="ch-count">${value}</b></span></div>`;
    const toolName = (tool) => tool === 'axe' && tools.axe >= 1 ? T.axes[Math.min(3, tools.axe) - 1] : T.beltTools[tool]; // TA03: the axe is a tier 1..3
    const belt = [['axe', 'hacha_piedra'], ['pickaxe', 'pico_piedra']].map(([tool, id]) => `<span class="ch-belt-slot ${tools[tool] >= 1 ? 'is-owned' : 'is-missing'}" title="${esc(toolName(tool))}${tools[tool] >= 1 ? '' : ` · ${esc(T.missing)}`}">${atlasIcon(id, 'ch-belt-ico')}</span>`).join('')
      + `<span class="ch-belt-slot is-soon" title="${esc(T.soon)}">${I.plus}</span>`.repeat(2);
    return `<h2 class="ch-h"><span class="ch-h-ico">${I.palm}</span>${esc(T.equipment)}</h2>
      <div class="ch-equip">
        ${this.slotCell(p, 'head', T)}${this.slotCell(p, 'chest', T)}${this.slotCell(p, 'boots', T)}
        <button class="ch-slot ch-fixed is-pack" type="button" data-goto-gear><span class="ch-slot-label">${esc(T.pack)}</span><span class="ch-slot-box">${atlasIcon('mochila', 'ch-slot-ico')}<b class="ch-count">${fmtNum(used, lang)}/${fmtNum(p.eco.pack.cap, lang)}</b></span></button>
        ${this.slotCell(p, 'weapon', T)}${this.slotCell(p, 'ring1', T)}${this.slotCell(p, 'ring2', T)}
        ${fixed('is-pot', T.potions, atlasIcon('potion', 'ch-slot-ico'), `${st.potions}/${CONSUMABLES.potion.max}`)}
      </div>
      <div class="ch-equip-foot">
        <div class="ch-belt"><span class="ch-sub">${esc(T.belt)}</span><div class="ch-belt-row">${belt}</div></div>
        <div class="ch-gold"><span class="ch-sub">${esc(T.gold)}</span><div class="ch-gold-row">${atlasIcon('oro', 'ch-gold-ico')}<b>${fmtNum(st.gold, lang)}</b></div></div>
      </div>`;
  }

  bagHtml(p, T, lang) {
    const st = this.stats();
    const cells = p.bag.map((it) => `<button class="ch-cell r${it.r}" type="button" data-bag="${it.u}" style="--rc:var(--r-${RARITY_VAR[it.r]})" aria-label="${esc(translateData(itemName(it)))}">${atlasIcon(it.b, 'ch-cell-ico')}<i class="lv">${it.l}</i>${this.seen.has(it.u) ? '' : `<b class="new">${esc(T.fresh)}</b>`}</button>`).join('')
      + '<span class="ch-cell is-empty"></span>'.repeat(Math.max(0, ITEMS.bag - p.bag.length));
    return `<h2 class="ch-h"><span class="ch-h-ico">${I.backpack}</span>${esc(T.bag)}<small>${p.bag.length} / ${ITEMS.bag}</small></h2>
      <div class="ch-purse"><span>${atlasIcon('oro', 'ch-purse-ico')}<b>${fmtNum(st.gold, lang)}</b> ${esc(T.goldUnit)}</span><span>${atlasIcon('potion', 'ch-purse-ico')}<b>${st.potions}/${CONSUMABLES.potion.max}</b></span></div>
      <div class="ch-bag">${cells}</div>`;
  }
  goodsHtml(p, T, lang) {
    const view = this.backpack?.() || {}, pack = view.pack || p.eco.pack, pending = view.pendingGoods || {};
    const used = holdUsed(pack), goods = GOOD_IDS.filter((g) => pack.goods[g] > 0), tools = p.tools || {};
    const carry = readCarryField(p), tier = carry.present && carry.value ? carry.value.backpack : null;
    const mass = holdMass(pack), weighed = Number.isFinite(pack.maxMass), comfort = weighed ? comfortOf(p, pack) : 0;
    const slots = Math.max(6, Math.ceil((goods.length + 1) / 6) * 6);
    let grid = '';
    for (let i = 0; i < slots; i++) {
      const g = goods[i];
      const food = g && Object.hasOwn(FOODS, g) && !pending[g] ? FOODS[g] : null;
      if (food) {
        const verb = food.sat > 0 ? T.eat : T.drink, gain = [food.sat ? fill(T.gainSat, { n: food.sat }) : '', food.hyd ? fill(T.gainHyd, { n: food.hyd }) : ''].filter(Boolean).join(' · ');
        const hint = fill(T.eatHint, { verb, name: goodName(g, lang), gain });
        grid += `<button class="ch-good is-food" type="button" data-eat="${g}" title="${esc(hint)} · ${fmtNum(pack.goods[g], lang)}" aria-label="${esc(hint)}">${atlasIcon(g, 'ch-good-ico')}<b>${fmtNum(pack.goods[g], lang)}</b><i class="ch-eat">${esc(verb)}</i></button>`;
      } else grid += g ? `<div class="ch-good${pending[g] ? ' is-pending' : ''}" title="${esc(goodName(g, lang))} · ${fmtNum(pack.goods[g], lang)}${pending[g] ? ` · ${esc(T.pending)}` : ''}">${atlasIcon(g, 'ch-good-ico')}<b>${fmtNum(pack.goods[g], lang)}</b></div>` : '<div class="ch-good is-empty"></div>';
    }
    const toolName = (tool) => tool === 'axe' && tools.axe >= 1 ? T.axes[Math.min(3, tools.axe) - 1] : T.beltTools[tool]; // TA03: the axe is a tier 1..3
    const belt = [['axe', 'hacha_piedra'], ['pickaxe', 'pico_piedra']].map(([tool, id]) => `<span class="ch-belt-slot ${tools[tool] >= 1 ? 'is-owned' : 'is-missing'}" title="${esc(toolName(tool))}">${atlasIcon(id, 'ch-belt-ico')}</span>`).join('');
    return `<h2 class="ch-h"><span class="ch-h-ico">${I.backpack}</span>${esc(T.goods)}${tier === null ? '' : `<small>${esc(fill(T.backpackTier, { n: tier + 1, max: CARRY.maxBackpack + 1 }))}</small>`}</h2>
      <div class="ch-meter"><span>${esc(T.volume)}</span><span class="ch-cap"><i style="width:${pct(used / (pack.cap || 1))}"></i></span><b>${fmtNum(used, lang)} / ${fmtNum(pack.cap, lang)}</b></div>
      ${weighed ? `<div class="ch-meter"><span>${esc(T.weight)}</span><span class="ch-cap is-weight${mass > comfort ? ' is-over' : ''}"><i style="width:${pct(mass / (comfort || 1))}"></i></span><b>${fmtNum(mass, lang, 1)} / ${fmtNum(comfort, lang)}</b></div>` : ''}
      <div class="ch-goods">${grid}</div>
      ${provisionsGuideHtml(goods, lang)}
      <div class="ch-belt"><span class="ch-sub">${esc(T.belt)}</span><div class="ch-belt-row">${belt}</div></div>`;
  }

  quickHtml(p, T) {
    const st = this.stats();
    let ids = {};
    try { ids = this.slots?.() || {}; } catch { ids = {}; }
    const w = p.eq.weapon, pistols = WEAPON_KINDS[this.weapon() | 0] === 'pistolas';
    const cell = (key, icon, label, count = '') => `<div class="ch-q" title="${esc(label)}"><span class="ch-q-key">${esc(key)}</span><span class="ch-q-ico">${icon}</span>${count !== '' ? `<b>${count}</b>` : ''}</div>`;
    const svgIcon = (id) => (id ? skillIcon(id) : '');
    return `<span class="ch-sub">${esc(T.quick)}</span><div class="ch-q-row">
      ${cell('LMB', pistols ? svgIcon('pistol') : w ? atlasIcon(w.b, 'ch-q-art') : I.sword, pistols ? T.quick8.lmbPistol : T.quick8.lmb)}
      ${cell('RMB', pistols ? svgIcon('pistolLong') : svgIcon('shield'), pistols ? T.quick8.rmbPistol : T.quick8.rmb)}
      ${cell('ESP', svgIcon('dash'), T.quick8.dash)}
      ${cell('Q', svgIcon(ids.q), ids.q || 'Q')}${cell('E', svgIcon(ids.e), ids.e || 'E')}${cell('G', svgIcon(ids.g), ids.g || 'G')}
      ${cell('R', svgIcon(ids.r || 'storm'), 'R')}
      ${cell('1', atlasIcon('potion', 'ch-q-art'), T.quick8.pot, st.potions)}</div>`;
  }

  // ---- Item details (CharPanel calls this through renderDetail) --------------------------------------------
  detailHtml(box, p) {
    const T = this.t(), lang = uiLang(), sel = this.pinned || this.hover;
    let it = null, where = '', slot = this.slotFocus;
    if (sel?.where === 'bag') { it = p.bag.find((x) => x.u === sel.uid) || null; where = 'bag'; if (!it && this.pinned) this.pinned = null; }
    else if (sel?.where === 'worn') { slot = sel.slot; it = p.eq[slot] || null; where = 'worn'; }
    else if (slot) { it = p.eq[slot] || null; where = 'worn'; }
    if (!it && !slot) { box.innerHTML = `<p class="ch-pick">${esc(T.pick)}</p>`; return; }
    const card = it ? this.cardHtml(it, where, p, T, lang) : `<div class="ch-card is-empty"><span class="ch-card-art">${I[SLOT_ICON[slot]] || ''}</span><div class="ch-card-body"><b class="ch-card-name">${esc(T.empty)}</b><small>${esc(T.slot[slot])}</small></div></div>`;
    let strip = '';
    if (slot && (where === 'worn' || (it && slotFits(BASES[it.b].slot, slot)))) {
      const fits = p.bag.filter((x) => slotFits(BASES[x.b].slot, slot));
      strip = `<div class="ch-cands"><span class="ch-sub">${esc(T.inBag)}</span>${fits.length ? `<div class="ch-cands-row">${fits.map((x) => `<button class="ch-cell r${x.r}" type="button" data-bag="${x.u}" style="--rc:var(--r-${RARITY_VAR[x.r]})" title="${esc(translateData(itemName(x)))}">${atlasIcon(x.b, 'ch-cell-ico')}<i class="lv">${x.l}</i></button>`).join('')}</div>` : `<p>${esc(T.noneInBag)}</p>`}</div>`;
    }
    box.innerHTML = card + strip;
  }
  cardHtml(it, where, p, T, lang) {
    const B = BASES[it.b], R = RARITIES[it.r] || RARITIES[0], pinned = !!this.pinned;
    const worn = where === 'bag' ? p.eq[targetSlot(it, p.eq, itemScore)] : null;
    const delta = where === 'bag' ? new Map(compareLines(it, worn).map((d) => [d.k, d])) : new Map();
    const val = (k, v) => { const S = STATS[k], sign = v >= 0 ? '+' : '−', a = Math.abs(v); return S.ms ? `${sign}${Math.round(a * 1000)} ms` : S.pct ? `${sign}${fmtNum(a * 100, lang, a * 100 >= 10 ? 0 : 1)} %` : `${sign}${fmtNum(Math.round(a), lang)}`; };
    const lines = statLines(it);
    const rows = lines.map((l) => { const d = delta.get(l.k); delta.delete(l.k);
      return `<div class="ch-cs${l.bad ? ' is-bad' : ''}"><span class="ch-cs-ico">${I[STAT_ICON[l.k]] || I.stats}</span><span>${esc(translateData(STATS[l.k].name))}</span><b>${val(l.k, l.v)}</b>${d ? `<em class="${d.up ? 'up' : 'down'}">${d.up ? '▲' : '▼'} ${val(d.k, d.d)}</em>` : '<em></em>'}</div>`; }).join('');
    const lost = [...delta.values()].map((d) => `<div class="ch-cs is-lost"><span class="ch-cs-ico">${I[STAT_ICON[d.k]] || I.stats}</span><span>${esc(translateData(STATS[d.k].name))}</span><b>—</b><em class="${d.up ? 'up' : 'down'}">${d.up ? '▲' : '▼'} ${val(d.k, d.d)}</em></div>`).join('');
    const v = itemValue(it), sv = v > 0 ? Math.max(1, Math.round(v * ITEMS.salvage)) : 0, sure = this.confirm === it.u;
    const kitNote = B.slot === 'weapon' && WEAPONS[B.weapon] && B.weapon !== WEAPON_KINDS[this.stats().weapon] ? `<p class="ch-card-note">${esc(fill(T.kit, { name: translateData(WEAPONS[B.weapon].name) }))}</p>` : '';
    let acts = '';
    if (pinned && where === 'bag') acts = `<button class="btn" type="button" data-act="equip">${esc(T.equip)}</button>`
      + (this.shop ? `<button class="btn secondary" type="button" data-act="sell">${esc(fill(sure ? T.sure : T.sell, { v }))}</button>` : `<button class="btn secondary" type="button" data-act="salvage">${esc(fill(sure ? T.sure : T.salvage, { v: sv }))}</button>`);
    else if (pinned && where === 'worn' && this.pinned.slot !== 'weapon') acts = `<button class="btn secondary" type="button" data-act="unequip">${esc(T.unequip)}</button>`;
    return `<div class="ch-card r${it.r}" style="--rc:var(--r-${RARITY_VAR[it.r]})">
      <span class="ch-chip">${esc(translateData(R.name))}</span>
      <div class="ch-card-art">${atlasIcon(it.b, 'ch-card-ico')}</div>
      <div class="ch-card-body"><b class="ch-card-name">${esc(translateData(itemName(it)))}</b>
        <small>${esc(T.slot[B.slot === 'ring' ? 'ring1' : B.slot] || '')} · ${esc(T.lv)} ${it.l}</small>
        ${kitNote}<div class="ch-cs-list">${rows}${lost}</div>
        ${worn && where === 'bag' ? `<small class="ch-vs">${esc(T.vsWorn)}</small>` : ''}</div>
      <div class="ch-card-foot"><span class="ch-value">${atlasIcon('oro', 'ch-value-ico')}${esc(T.value)} <b>${fmtNum(v, lang)}</b></span><div class="ch-acts">${acts}</div></div></div>`;
  }
}
