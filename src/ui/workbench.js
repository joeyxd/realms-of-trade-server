// Crafting menu: recipes by category, materials, real base stats and the backpack. Hand recipes craft anywhere on
// land; the rest need the shore workbench. The server stays authoritative; this panel only previews and asks.
import { CRAFT_RECIPES, HARVEST, WOOD_RECIPE } from '../data/resources.js';
import { FIRE_SECONDS } from '../data/fire.js';
import { onLocaleChange, formatNumber, t, translateData } from '../core/i18n.js';
import { GOODS, GOOD_IDS } from '../data/goods.js';
import { goodMass, goodVolume, holdMass, holdUsed } from '../sim/economy/cargo.js';
import { comfortMass } from '../data/carry.js';
import { readAttrField } from '../data/attributes.js';
import { CRAFT_CATEGORIES, CRAFT_ICONS, CRAFT_REASONS, CRAFT_TEXT, HERO_ART, RECIPE_ROWS, RECIPE_UI, UPCOMING_RECIPES, craftLang, goodName, itemIcon } from './craftingCatalog.js';
import { kitAsset } from './kit.js';

const MAX_CRAFT = () => Number.isSafeInteger(HARVEST.craftMax) && HARVEST.craftMax > 0 ? HARVEST.craftMax : 10;
const LOCALE = { es: 'es-MX', en: 'en-US' };
const fmt = (value, lang = craftLang()) => formatNumber(Math.max(0, Number.isFinite(value) ? value : 0));
const fill = (text, params) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// The hand torch is a versioned fire load (the `fire` op), not a resource craft: current worlds use logs and resin,
// while historical worlds keep their one-plank rule. The server remains authoritative for both.
export const TORCH_RECIPE = Object.freeze({ id: 'antorcha', name: 'Antorcha', inputs: Object.freeze({ tronco: 2, resina: 1 }),
  fire: 'handTorch', hand: true, count: 1, max: 1 });
const LEGACY_TORCH_RECIPE = Object.freeze({ ...TORCH_RECIPE, inputs: Object.freeze({ madera: 1 }) });
const RECIPES = Object.freeze({ ...CRAFT_RECIPES, [TORCH_RECIPE.id]: TORCH_RECIPE });
const recipeFor = (id = WOOD_RECIPE.id, rules = 2) => id === TORCH_RECIPE.id && rules !== 2
  ? LEGACY_TORCH_RECIPE : RECIPES[id] || RECIPES[WOOD_RECIPE.id] || WOOD_RECIPE;
const recipeInputs = (recipe) => recipe.inputs || { [recipe.input]: recipe.count || 1 };
const recipeOutput = (recipe) => recipe.output;
const isToolRecipe = (recipe) => !!recipe.tool;
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const recipesIn = (cat) => Object.values(RECIPES).filter((r) => RECIPE_UI[r.id]?.cat === cat)
  .sort((a, b) => (RECIPE_UI[a.id].order || 0) - (RECIPE_UI[b.id].order || 0));
const recipeText = (id, lang) => RECIPE_UI[id]?.[lang] || RECIPE_UI[id]?.es || { name: recipeFor(id).name, desc: '', flavor: '', motto: '' };
// Absolute: a relative url() inside a custom property resolves against the stylesheet that uses it.
const artUrl = (file) => kitAsset(`crafting/${file}`);

function validPack(pack) {
  if (!pack || !Number.isFinite(pack.cap) || pack.cap < 0 || pack.maxMass !== undefined && (!Number.isFinite(pack.maxMass) || pack.maxMass < 0)
      || !pack.goods || typeof pack.goods !== 'object' || Array.isArray(pack.goods)) return false;
  return Object.entries(pack.goods).every(([good, count]) => Object.hasOwn(GOODS, good) && Number.isSafeInteger(count) && count > 0);
}

/** Calculate an all-or-nothing batch against the current profile without changing it. */
export function workbenchPreview(profile, n, recipeId = WOOD_RECIPE.id, torchRules = 2) {
  const recipe = recipeFor(recipeId, torchRules), pack = profile?.eco?.pack, inputs = recipeInputs(recipe);
  const tool = isToolRecipe(recipe), noGoods = tool || !!recipe.fire, craftMax = noGoods ? 1 : Math.min(MAX_CRAFT(), recipe.max || MAX_CRAFT());
  let packKnown = validPack(pack), usedBefore = 0, massBefore = 0;
  if (packKnown) { try { usedBefore = holdUsed(pack); massBefore = holdMass(pack); packKnown = Number.isFinite(usedBefore) && usedBefore <= pack.cap && Number.isFinite(massBefore)
      && (pack.maxMass === undefined || massBefore <= pack.maxMass); } catch { packKnown = false; } }
  const needs = Object.entries(inputs).map(([good, each]) => ({ good, count: each, owned: packKnown ? (pack.goods[good] || 0) : 0,
    name: GOODS[good]?.name || good }));
  const materialsFit = needs.every((item) => Number.isSafeInteger(item.owned) && item.owned >= item.count * (Number.isSafeInteger(n) && n > 0 ? n : 0));
  const ownedTool = tool ? (profile?.tools?.[recipe.tool] === 1) : false;
  const output = recipeOutput(recipe), outputCount = recipe.count || 1;
  const deltaPerBatch = (noGoods ? 0 : outputCount * goodVolume(output)) - needs.reduce((sum, item) => sum + item.count * goodVolume(item.good), 0);
  const massDeltaPerBatch = (noGoods ? 0 : outputCount * goodMass(output)) - needs.reduce((sum, item) => sum + item.count * goodMass(item.good), 0);
  const maxBySpace = !packKnown || deltaPerBatch > 0 ? (packKnown ? Math.floor(Math.max(0, pack.cap - usedBefore) / deltaPerBatch) : 0) : craftMax;
  const maxByMass = !packKnown || pack.maxMass === undefined || massDeltaPerBatch <= 0 ? craftMax
    : Math.floor(Math.max(0, pack.maxMass - massBefore) / massDeltaPerBatch);
  const maxCraftable = ownedTool ? 0 : Math.max(0, Math.min(craftMax, ...needs.map((item) => Math.floor(item.owned / item.count)), maxBySpace, maxByMass));
  const qtyValid = Number.isSafeInteger(n) && n >= 1 && n <= craftMax;
  const requested = qtyValid ? n : 0, outputAmount = requested * outputCount;
  const usedAfter = packKnown ? usedBefore + requested * deltaPerBatch : 0;
  const spaceAfter = packKnown ? pack.cap - usedAfter : 0;
  const massAfter = packKnown ? massBefore + requested * massDeltaPerBatch : 0;
  const spaceFits = tool || (packKnown && spaceAfter >= -1e-8);
  const massFits = tool || (packKnown && (pack.maxMass === undefined || massAfter <= pack.maxMass + 1e-8));
  const english = craftLang() === 'en';
  const plankName = recipe.id === WOOD_RECIPE.id ? (english ? 'Basic plank' : 'Tabla básica') : GOODS[output]?.name || output;
  return { recipe: recipe.id, tool: recipe.tool || null, tier: recipe.tier || 0, hand: !!recipe.hand, fire: recipe.fire || null, inputs: needs,
    input: needs[0]?.good, output, inputName: needs[0]?.name || '', outputName: noGoods ? (recipe.fire ? t('systems.resource.torch') : translateData(recipe.name)) : plankName,
    n: requested, craftMax, packKnown, qtyValid, inputOwned: needs[0]?.owned || 0,
    inputNeeded: needs[0]?.count * requested || 0, outputAmount, usedBefore, usedAfter, massBefore, massAfter,
    massLimit: packKnown && Number.isFinite(pack.maxMass) ? pack.maxMass : null, massDeltaPerBatch,
    packCapacity: packKnown ? pack.cap : 0, spaceBefore: packKnown ? Math.max(0, pack.cap - usedBefore) : 0,
    spaceAfter: Math.max(0, spaceAfter), maxCraftable, materialsFit: qtyValid && materialsFit,
    spaceFits, massFits, ownedTool, canCraft: packKnown && qtyValid && materialsFit && spaceFits && massFits && !ownedTool };
}

function call(getter, fallback = null) { try { return typeof getter === 'function' ? getter() : fallback; } catch { return fallback; } }

/** Match the private server receipt against the exact recipe and revision that was sent. */
export function craftAcknowledgementMatches(pending, ev) {
  if (!pending?.command || ev?.ok !== true || ev.rev !== pending.command.expectedRev + 1) return false;
  const recipe = recipeFor(pending.recipe, pending.rules);
  if (pending.tool) return ev.tool === pending.tool && ev.tier === pending.tier && ev.count === 1;
  return ev.good === recipe.output && ev.count === pending.count;
}

const TAB_HTML = CRAFT_CATEGORIES.map((cat) => `<button class="cr-tab" type="button" role="tab" data-cat="${cat}"><span class="cr-tab-ico">${CRAFT_ICONS[cat]}</span><span data-t="tabs.${cat}"></span></button>`).join('');

export class WorkbenchPanel {
  constructor({ parent, profile, player, bench, enabled, blocked, submit, onContext, torch, submitFire }) {
    Object.assign(this, { parent, profile, player, bench, enabled, blocked, submitCommand: submit, onContext, torch, submitFire });
    this.active = false; this.pending = null; this.qty = 1; this.recipe = 'hacha_piedra'; this.cat = 'tools';
    this.lastResult = ''; this.resultSource = null; this.resultTone = ''; this._contextNotified = false; this.lang = '';
    this.root = document.createElement('section'); this.root.className = 'workbench-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false'); this.root.setAttribute('aria-labelledby', 'wb-title'); this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="cr-shell">
      <div class="cr-main">
        <header class="wb-head"><span class="wb-mark" aria-hidden="true">${CRAFT_ICONS.palm}</span><div class="wb-heading"><h2 id="wb-title" data-t="title"></h2><small data-t="subtitle"></small></div><button class="cr-inv-toggle" type="button" data-inv-toggle aria-expanded="false"><span class="cr-inv-toggle-ico">${CRAFT_ICONS.backpack}</span><span data-t="inventory"></span><b data-pack-mini></b></button><button class="wb-close" type="button">×</button></header>
        <nav class="cr-tabs" role="tablist">${TAB_HTML}</nav>
        <div class="cr-body">
          <aside class="cr-recipes"><h3 data-t="recipes"></h3><div class="cr-list" data-recipe-list role="listbox"></div></aside>
          <article class="cr-detail">
            <div class="cr-empty" data-empty hidden><span class="cr-empty-ico">${CRAFT_ICONS.lock}</span><b data-t="emptyTab"></b><p data-t="emptyHint"></p></div>
            <div class="cr-art" data-art aria-hidden="true"></div>
            <div class="cr-info"><h2 data-output-name></h2><p class="cr-desc" data-desc></p><p class="cr-flavor" data-flavor></p></div>
            <section class="cr-req"><h3 data-t="required"></h3><div class="cr-cards" data-needs></div><span class="cr-sr" data-input-count></span></section>
            <div class="cr-arrow" aria-hidden="true">${CRAFT_ICONS.arrow}</div>
            <section class="cr-out"><h3 data-t="craftsInto"></h3><div class="cr-out-row"><div class="cr-out-card" data-output-icon></div><div class="cr-out-name"><b data-output-label></b><em data-output-count></em></div></div></section>
            <section class="cr-stats"><h3 data-t="stats"></h3><div data-stats></div></section>
            <div class="cr-left-foot">
              <div class="cr-qty" data-qty-row><span><b data-t="quantity"></b><small data-qty-max></small></span><div class="wb-amounts" role="group"><button type="button" data-qty="1">1</button><button type="button" data-qty="3">3</button><button type="button" data-qty="max" data-t="max"></button><label class="wb-qty-input"><input data-qty-input type="number" inputmode="numeric" min="1" max="10" step="1" value="1"></label></div></div>
              <span class="cr-where" data-where></span><p class="cr-motto" data-motto></p>
              <p class="wb-feedback" data-feedback aria-live="polite"></p><button class="wb-retry" type="button" hidden data-t="retry"></button>
            </div>
            <div class="cr-action"><button class="wb-confirm" type="button"><span class="cr-key" aria-hidden="true">E</span><span data-confirm-label></span></button></div>
          </article>
        </div>
      </div>
      <aside class="cr-inv">
        <header class="cr-inv-head"><span class="cr-inv-ico">${CRAFT_ICONS.backpack}</span><h3 data-t="inventory"></h3><b data-pack-used>0 / 0</b><button class="cr-inv-close" type="button" data-inv-toggle>×</button></header>
        <div class="cr-capacity"><i data-pack-bar></i></div>
        <div class="cr-weight" data-weight-row><span data-t="weight"></span><b data-pack-mass>0</b></div>
        <div class="cr-grid" data-inv></div>
        <div class="cr-belt"><small data-t="belt"></small><div class="cr-belt-slots" data-tools></div></div>
        <p class="cr-quote"><span data-t="quote"></span><i aria-hidden="true">${CRAFT_ICONS.palm}</i></p>
      </aside>
    </div>
    <div class="cr-hints" aria-hidden="true"><span><kbd>TAB</kbd><em data-t="close"></em></span><span><kbd>M</kbd><em data-t="map"></em></span></div>`;
    parent.appendChild(this.root); this.$ = (selector) => this.root.querySelector(selector);
    this.bind(); this.renderKey = ''; this.update();
    this.unsubscribeLocale = onLocaleChange(() => {
      const focusedRecipe = this.root.ownerDocument.activeElement?.closest?.('[data-recipe]')?.dataset.recipe;
      this.lang = ''; this.renderKey = ''; this.listKey = ''; this.update();
      if (focusedRecipe) this.root.querySelector(`[data-recipe="${focusedRecipe}"]`)?.focus({ preventScroll: true });
    });
  }
  bind() {
    // E crafts while the menu is open. Window capture runs before the game's hotkeys, whose E belongs to skills/sailing.
    addEventListener('keydown', (event) => {
      if (!this.active || event.code !== 'KeyE' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target; if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.confirm();
    }, true);
    this.root.addEventListener('keydown', (event) => { if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); } else if (event.code === 'Enter') { event.stopPropagation(); if (event.target.matches('[data-qty-input]')) { event.preventDefault(); this.confirm(); } } });
    this.$('.wb-close').addEventListener('click', () => this.close()); this.$('.wb-confirm').addEventListener('click', () => this.confirm()); this.$('.wb-retry').addEventListener('click', () => this.retry());
    this.$('[data-qty-input]').addEventListener('input', (event) => { this.qty = event.currentTarget.value === '' ? 0 : Number(event.currentTarget.value); this.clearResult(); this.update(); });
    this.root.addEventListener('click', (event) => {
      // Landscape phones: the backpack is a drawer over the recipe detail.
      if (event.target.closest('[data-inv-toggle]')) { this.setInventoryOpen(!this.invOpen); return; }
      const tab = event.target.closest('[data-cat]');
      if (tab) { this.selectCategory(tab.dataset.cat); return; }
      const recipeButton = event.target.closest('[data-recipe]');
      if (recipeButton && !this.pending) { this.recipe = recipeButton.dataset.recipe; this.qty = 1; this.clearResult(); this.update(); return; }
      const button = event.target.closest('[data-qty]'); if (!button || button.disabled || this.pending || !this.recipe) return;
      this.qty = button.dataset.qty === 'max' ? workbenchPreview(call(this.profile), 1, this.recipe).maxCraftable : Number(button.dataset.qty); this.clearResult(); this.update();
    });
  }
  setInventoryOpen(open) {
    this.invOpen = !!open; this.root.classList.toggle('inv-open', this.invOpen);
    this.$('.cr-inv-toggle').setAttribute('aria-expanded', this.invOpen ? 'true' : 'false');
  }
  selectCategory(cat) {
    if (!CRAFT_CATEGORIES.includes(cat) || this.pending) return;
    this.cat = cat; const first = recipesIn(cat)[0];
    if (RECIPE_UI[this.recipe]?.cat !== cat) { this.recipe = first ? first.id : null; this.qty = 1; this.clearResult(); }
    this.update();
  }
  /** Alive, on foot and free to use menus; enough for hand recipes. */
  baseContext() {
    const profile = call(this.profile), player = call(this.player);
    if (!profile?.eco?.pack || !Number.isSafeInteger(profile.eco.tradeRev) || profile.eco.tradeRev < 0 || !player || player.dead || ![player.x, player.y, player.z].every(Number.isFinite)) return null;
    if (call(this.enabled, false) !== true || call(this.blocked, false) === true) return null;
    return { profile, player };
  }
  /** Standing at the materials bench (bench recipes and the community works). */
  context() {
    const base = this.baseContext(), bench = call(this.bench);
    if (!base || !bench || ![bench.x, bench.y, bench.z].every(Number.isFinite)) return null;
    const { player } = base;
    if (Math.abs(player.y - bench.y) > 1.5 || Math.hypot(player.x - bench.x, player.z - bench.z) > HARVEST.benchRadius) return null;
    return { ...base, bench };
  }
  torchRules() { return call(this.torch)?.torchRules === 2 ? 2 : 1; }
  craftContext(recipeId = this.recipe) { return recipeFor(recipeId, this.torchRules()).hand ? this.baseContext() : this.context(); }
  /** The hand torch slot as the server last confirmed it (client.fire); null while the fire system is off. */
  torchState() {
    const fire = call(this.torch);
    if (fire?.enabled !== true || !Number.isSafeInteger(fire.rev) || fire.rev < 0) return null;
    const slot = Array.isArray(fire.slots) ? fire.slots.find((s) => s?.key === 'hand' && s.kind === TORCH_RECIPE.fire && Number.isSafeInteger(s.seconds) && s.seconds >= 0) : null;
    return { rev: fire.rev, seconds: slot?.seconds || 0, lit: slot?.lit === true };
  }
  /** A torch can be made only while the fire system is on and the hand slot has burnt out. */
  firePreview(p, torch = this.torchState()) {
    const block = !torch ? 'off' : torch.seconds > 0 ? 'burning' : '';
    return { ...p, fireBlock: block, torchSeconds: torch?.seconds || 0, canCraft: p.canCraft && !block };
  }
  open({ recipe } = {}) {
    if (!this.baseContext()) return false;
    if (recipe && RECIPES[recipe] && !this.pending) { this.recipe = recipe; this.cat = RECIPE_UI[recipe]?.cat || this.cat; this.qty = 1; }
    this.active = true; this.root.hidden = false; this.notifyContext(true); this.renderKey = ''; this.update();
    this.root.focus({ preventScroll: true }); return true;
  }
  close() { if (!this.active && this.root.hidden) return; this.active = false; this.root.hidden = true; this.setInventoryOpen(false); this.notifyContext(false); }
  toggle(options) { if (this.active) { this.close(); return true; } return this.open(options); }
  notifyContext(active) { if (this._contextNotified === active) return; this._contextNotified = active; this.onContext?.(active); }
  reset() { this.pending = null; this.qty = 1; this.recipe = 'hacha_piedra'; this.cat = 'tools'; this.clearResult(); this.resultTone = ''; this.close(); this.update(); }
  clearResult() { this.lastResult = ''; this.resultSource = null; }
  resultText() {
    const source = this.resultSource, lang = craftLang();
    if (!source) return '';
    if (source.kind === 'success') return this.successText(source.done, lang);
    if (source.kind === 'reason') return CRAFT_REASONS[lang][source.why] || CRAFT_TEXT[lang].feedback.unknown;
    if (source.kind === 'fire') {
      const f = CRAFT_TEXT[lang].feedback;
      return { goods: this.torchRules() === 2 ? f.torchFuel : f.legacyTorchFuel, account_required: f.torchAccount, disabled: f.torchOff }[source.why] || CRAFT_REASONS[lang][source.why] || f.unknown;
    }
    return CRAFT_TEXT[lang].feedback.sendFailed;
  }
  text() { return CRAFT_TEXT[craftLang()]; }
  applyStatic(lang) {
    const t = CRAFT_TEXT[lang];
    for (const node of this.root.querySelectorAll('[data-t]')) {
      const value = node.dataset.t.split('.').reduce((obj, key) => obj?.[key], t);
      if (typeof value === 'string') node.textContent = value;
    }
    this.root.setAttribute('aria-label', t.dialog); this.$('.wb-close').setAttribute('aria-label', t.closeLabel);
    this.$('[data-qty-input]').setAttribute('aria-label', t.qtyLabel); this.$('[data-pack-used]').title = t.volume;
    this.$('.cr-inv-close').setAttribute('aria-label', t.inventoryClose);
  }
  update() {
    const base = this.baseContext(); if (this.active && !base) this.close();
    const profile = base?.profile || call(this.profile);
    if (this.pending?.ackRev !== undefined && Number.isSafeInteger(profile?.eco?.tradeRev) && profile.eco.tradeRev >= this.pending.ackRev) {
      const done = this.pending; this.pending = null; this.resultSource = { kind: 'success', done }; this.lastResult = this.resultText(); this.resultTone = 'ok';
    }
    if (!this.active) return;
    const lang = craftLang(), t = CRAFT_TEXT[lang], bench = this.context(), torchRules = this.torchRules(), recipe = this.recipe ? recipeFor(this.recipe, torchRules) : null;
    this.lastResult = this.resultText();
    const ctx = recipe ? (recipe.hand ? base : bench) : null, pending = this.pending;
    const torch = this.torchState(), rawPreview = workbenchPreview(profile, this.qty, recipe ? recipe.id : undefined, torchRules);
    const preview = recipe?.fire ? this.firePreview(rawPreview, torch) : rawPreview;
    const retryReady = !!pending && performance.now() - pending.sentAt >= 5000;
    const pack = profile?.eco?.pack, tools = profile?.tools || {};
    const renderKey = JSON.stringify([lang, this.cat, this.recipe, preview, !!ctx, !!bench, pending?.command.opId, pending?.ackRev, retryReady,
      this.lastResult, this.resultTone, pack?.goods, pack?.cap, pack?.maxMass, profile?.attr, tools, torch]);
    if (renderKey === this.renderKey) return; this.renderKey = renderKey;
    if (lang !== this.lang) { this.lang = lang; this.root.lang = lang; this.applyStatic(lang); this.listKey = ''; }
    for (const tab of this.root.querySelectorAll('[data-cat]')) { const on = tab.dataset.cat === this.cat; tab.classList.toggle('on', on); tab.setAttribute('aria-selected', on ? 'true' : 'false'); tab.disabled = !!pending && !on; }
    this.renderList(lang, t, tools, pending, torch);
    this.renderDetail(lang, t, recipe, preview, ctx, bench, pending, retryReady);
    this.renderInventory(lang, t, pack, preview, tools, readAttrField(profile).value !== null, torch);
    this.root.classList.toggle('is-pending', !!pending);
  }
  renderList(lang, t, tools, pending, torch = null) {
    const list = this.$('[data-recipe-list]'), recipes = recipesIn(this.cat), key = `${lang}:${this.cat}`;
    if (this.listKey !== key) {
      this.listKey = key;
      const rows = recipes.map((r) => `<button type="button" class="cr-row" role="option" data-recipe="${r.id}">${itemIcon(r.id, 'cr-tile')}<span class="cr-name">${esc(recipeText(r.id, lang).name)}</span><span class="cr-owned" data-owned-tool="${r.tool || ''}" hidden>✓</span></button>`);
      // Named upcoming recipes first (painted, dimmed), then plain undiscovered rows up to the column height.
      for (const [id, es, en] of UPCOMING_RECIPES[this.cat] || [])
        rows.push(`<div class="cr-row is-locked is-named" aria-disabled="true" data-upcoming="${id}" title="${esc(t.locked)}">${itemIcon(id, 'cr-tile')}<span class="cr-name">${esc(lang === 'en' ? en : es)}<small>${esc(t.locked)}</small></span><span class="cr-lock">${CRAFT_ICONS.lock}</span></div>`);
      for (let i = rows.length; i < Math.max(RECIPE_ROWS, rows.length); i++)
        rows.push(`<div class="cr-row is-locked" aria-disabled="true"><span class="cr-tile">${CRAFT_ICONS.lock}</span><span class="cr-name">${esc(t.locked)}</span></div>`);
      list.innerHTML = rows.join('');
    }
    for (const b of list.querySelectorAll('[data-recipe]')) {
      const on = b.dataset.recipe === this.recipe; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.disabled = !!pending && !on;
      const owned = b.querySelector('[data-owned-tool]'), tool = owned?.dataset.ownedTool;
      if (owned) owned.hidden = !(tool && tools[tool] === 1) && !(b.dataset.recipe === TORCH_RECIPE.id && torch?.seconds > 0);
    }
  }
  renderDetail(lang, t, recipe, p, ctx, bench, pending, retryReady) {
    const detail = this.$('.cr-detail'), empty = !recipe;
    detail.classList.toggle('is-empty', empty); this.$('[data-empty]').hidden = !empty;
    const confirm = this.$('.wb-confirm');
    if (empty) { confirm.disabled = true; this.$('[data-confirm-label]').textContent = t.craft; this.$('[data-feedback]').textContent = ''; this.$('.wb-retry').hidden = true; return; }
    const copy = recipeText(recipe.id, lang), tool = !!recipe.tool, single = tool || !!recipe.fire;
    this.$('[data-output-name]').textContent = copy.name;
    this.$('[data-desc]').textContent = recipe.id === TORCH_RECIPE.id && this.torchRules() !== 2
      ? (lang === 'en' ? 'A basic plank fuels 20 minutes of light you can carry.' : 'Una tabla básica alimenta 20 minutos de luz que llevas contigo.') : copy.desc;
    this.$('[data-flavor]').textContent = copy.flavor; this.$('[data-motto]').textContent = copy.motto;
    const where = this.$('[data-where]');
    where.textContent = recipe.hand ? t.hand : bench ? t.benchNear : t.benchFar;
    where.className = `cr-where ${recipe.hand ? 'is-hand' : bench ? 'is-near' : 'is-far'}`;
    // Recipes without a painted hero show their painted kit icon instead.
    const art = this.$('[data-art]'), hero = HERO_ART.has(recipe.id); art.className = `cr-art ${tool ? 'is-tool' : 'is-good'}${hero ? '' : ' is-icon'}`;
    art.style.setProperty('--art', hero ? `url("${artUrl(`hero-${recipe.id}.webp`)}")` : 'none');
    art.style.setProperty('--art-m', hero ? `url("${artUrl(`hero-${recipe.id}-mobile.webp`)}")` : 'none');
    art.innerHTML = hero ? '' : itemIcon(recipe.id, 'cr-art-ico');
    const n = Math.max(1, p.n || 1);
    this.$('[data-needs]').innerHTML = p.inputs.map((i) => {
      const need = i.count * n, ok = i.owned >= need;
      return `<div class="cr-card ${ok ? 'is-ok' : 'is-short'}" title="${esc(goodName(i.good, lang))}: ${fmt(i.owned, lang)}">${itemIcon(i.good, 'cr-card-art')}<b>${esc(goodName(i.good, lang))}</b><em>${fmt(Math.min(i.owned, need), lang)} / ${fmt(need, lang)}</em></div>`;
    }).join('');
    this.$('[data-input-count]').textContent = p.inputs.map((i) => `${fmt(i.count * n, lang)} ${goodName(i.good, lang)}`).join(' + ');
    this.$('[data-output-icon]').innerHTML = itemIcon(recipe.id, 'cr-out-art');
    this.$('[data-output-label]').textContent = copy.name;
    this.$('[data-output-count]').textContent = recipe.fire ? `${fmt(FIRE_SECONDS[recipe.fire] / 60, lang)} min` : `x${fmt(tool ? 1 : (p.outputAmount || recipe.count || 1), lang)}`;
    let stats = RECIPE_UI[recipe.id]?.stats?.() || [];
    if (recipe.id === TORCH_RECIPE.id && this.torchRules() !== 2) stats = [stats[0],
      { icon: 'stack', es: 'Tabla por carga', en: 'Plank per load', value: 1, max: 4, text: '1' },
      { icon: 'logs', es: 'Troncos por tabla', en: 'Logs per plank', value: 2, max: 4, text: '2' }];
    this.$('[data-stats]').innerHTML = stats.map((s) => `<div class="cr-stat"><span class="cr-stat-ico">${CRAFT_ICONS[s.icon] || ''}</span><span class="cr-stat-name">${esc(s[lang] || s.es)}</span><span class="cr-bar"><i style="width:${Math.max(4, Math.min(100, s.value / s.max * 100)).toFixed(1)}%"></i></span><b>${esc(s.text)}</b></div>`).join('');
    // Quantity: batch recipes only; tools are a single craft.
    const qtyRow = this.$('[data-qty-row]'), input = this.$('[data-qty-input]');
    qtyRow.hidden = single; this.$('[data-motto]').hidden = !single;
    if (document.activeElement !== input && input.value !== String(this.qty)) input.value = String(this.qty);
    input.max = String(p.craftMax); this.$('[data-qty-max]').textContent = fill(t.perBatch, { n: p.craftMax });
    for (const b of this.root.querySelectorAll('[data-qty]')) { const q = b.dataset.qty === 'max' ? p.maxCraftable : Number(b.dataset.qty); b.disabled = !!pending || !ctx || (b.dataset.qty === 'max' ? q < 1 : q > p.craftMax); b.classList.toggle('on', b.dataset.qty !== 'max' && q === this.qty); b.setAttribute('aria-pressed', b.dataset.qty !== 'max' && q === this.qty ? 'true' : 'false'); }
    input.disabled = !!pending || !ctx;
    confirm.disabled = !!pending || !ctx || !p.canCraft;
    this.$('[data-confirm-label]').textContent = pending ? t.waiting : recipe.fire ? t.craftLight : tool ? t.craft : `${t.craft} ×${fmt(p.n || 0, lang)}`;
    this.$('.wb-retry').hidden = !retryReady; this.$('.wb-retry').disabled = !retryReady || !ctx;
    const feedback = this.$('[data-feedback]');
    const message = pending?.ackRev !== undefined ? t.feedback.received : pending ? t.feedback.pending : this.lastResult || this.previewMessage(p, ctx, recipe);
    feedback.textContent = message;
    feedback.className = `wb-feedback ${pending ? 'is-wait' : this.lastResult ? `is-${this.resultTone || 'warn'}` : p.canCraft && ctx ? 'is-ready' : 'is-warn'}`;
  }
  renderInventory(lang, t, pack, p, tools, adopted = false, torch = null) {
    const known = validPack(pack), used = known ? holdUsed(pack) : 0, cap = known ? pack.cap : 0;
    this.$('[data-pack-used]').textContent = `${fmt(used, lang)} / ${fmt(cap, lang)}`;
    this.$('[data-pack-mini]').textContent = `${fmt(used, lang)}/${fmt(cap, lang)}`;
    this.$('[data-pack-bar]').style.width = `${cap > 0 ? Math.max(0, Math.min(100, used / cap * 100)) : 0}%`;
    this.$('.cr-capacity').classList.toggle('is-tight', cap > 0 && used / cap > 0.8);
    const mass = known ? holdMass(pack) : 0, maxMass = known && Number.isFinite(pack.maxMass) ? pack.maxMass : null;
    // Weight reads against the comfortable load (INV02, Carga adopted); crafting still stops only at the ceiling, like the server.
    const comfort = maxMass === null ? null : comfortMass(maxMass, adopted);
    this.$('[data-pack-mass]').textContent = comfort === null ? fmt(mass, lang) : `${fmt(mass, lang)} / ${fmt(comfort, lang)}`;
    this.$('[data-weight-row]').classList.toggle('is-tight', comfort !== null && mass > comfort);
    const goods = known ? GOOD_IDS.filter((g) => pack.goods[g] > 0) : [], inputs = new Set(this.recipe ? p.inputs.map((i) => i.good) : []);
    const slots = Math.max(20, Math.ceil(goods.length / 4) * 4);
    let html = '';
    for (let i = 0; i < slots; i++) {
      const g = goods[i];
      html += g ? `<div class="cr-slot${inputs.has(g) ? ' is-used' : ''}" title="${esc(goodName(g, lang))} · ${fmt(pack.goods[g], lang)}">${itemIcon(g, 'cr-slot-art')}<b>${fmt(pack.goods[g], lang)}</b></div>` : '<div class="cr-slot is-empty"></div>';
    }
    this.$('[data-inv]').innerHTML = html;
    this.$('[data-tools]').innerHTML = [['axe', 'hacha_piedra'], ['pickaxe', 'pico_piedra']].map(([tool, id]) => {
      const owned = tools[tool] === 1, name = recipeText(id, lang).name;
      return `<div class="cr-slot cr-belt-slot ${owned ? 'is-owned' : 'is-missing'}" title="${esc(name)} · ${esc(owned ? t.beltOwned : t.beltMissing)}">${itemIcon(id, 'cr-slot-art')}</div>`;
    }).join('') + (torch ? `<div class="cr-slot cr-belt-slot ${torch.seconds > 0 ? 'is-owned' : 'is-missing'}${torch.seconds > 0 && torch.lit ? ' is-lit' : ''}" title="${esc(torch.seconds > 0
      ? fill(t.torchOn, { time: clock(torch.seconds) }) : `${recipeText(TORCH_RECIPE.id, lang).name} · ${t.beltMissing}`)}">${itemIcon(TORCH_RECIPE.id, 'cr-slot-art')}</div>` : '');
  }
  previewMessage(p, ctx, recipe = recipeFor(this.recipe, this.torchRules())) {
    const f = this.text().feedback;
    if (!ctx) return recipe.hand ? '' : f.far;
    if (recipe.fire) {
      if (p.fireBlock === 'off') return f.torchOff; if (p.fireBlock === 'burning') return fill(f.torchBurning, { time: clock(p.torchSeconds) });
      if (!p.packKnown) return f.pack; return p.materialsFit ? f.ready : this.torchRules() === 2 ? f.torchFuel : f.legacyTorchFuel;
    }
    if (p.ownedTool) return f.owned; if (!p.packKnown) return f.pack;
    if (!p.qtyValid) return fill(f.qty, { max: p.craftMax }); if (!p.materialsFit) return f.materials; if (!p.spaceFits) return f.space;
    if (!p.massFits) return f.mass; return f.ready;
  }
  qtyLabel(n) { return craftLang() === 'en' ? `${fmt(n, 'en')} ${n === 1 ? 'plank' : 'planks'}` : `${fmt(n, 'es')} ${n === 1 ? 'tabla' : 'tablas'}`; }
  successText(done, lang = craftLang()) {
    const f = CRAFT_TEXT[lang].feedback;
    if (done.fire) return fill(f.torchLit, { min: fmt(FIRE_SECONDS[TORCH_RECIPE.fire] / 60, lang) });
    if (done.tool) return fill(f.madeTool, { name: recipeText(done.recipe, lang).name });
    return fill(f.madeGood, { n: fmt(done.count, lang), name: goodName(recipeFor(done.recipe).output, lang).toLowerCase() });
  }
  confirm() {
    if (!this.recipe || !RECIPES[this.recipe]) return false;
    if (recipeFor(this.recipe, this.torchRules()).fire) return this.lightTorch();
    const ctx = this.craftContext(this.recipe), preview = workbenchPreview(ctx?.profile, this.qty, this.recipe);
    if (this.pending || !ctx || !preview.canCraft || typeof this.submitCommand !== 'function') return false;
    const recipe = recipeFor(this.recipe), command = Object.freeze({ t: 'cmd', type: 'resource', op: 'craft', opId: globalThis.crypto.randomUUID(), recipe: recipe.id, n: preview.n, expectedRev: ctx.profile.eco.tradeRev });
    this.pending = { command, sentAt: performance.now(), count: preview.outputAmount, recipe: recipe.id, tool: recipe.tool || null, tier: recipe.tier || 0, label: recipe.tool ? recipe.name || preview.outputName : this.qtyLabel(preview.outputAmount) };
    this.clearResult(); this.resultTone = ''; let accepted = false; try { accepted = this.submitCommand(command) === true; } catch {}
    if (!accepted) { this.pending = null; this.resultSource = { kind: 'sendFailed' }; this.lastResult = this.resultText(); this.resultTone = 'error'; this.update(); return false; }
    this.update(); return true;
  }
  /** Load and light the hand torch: the same immutable `fire` intent as the fire panel, answered by a `fire` event. */
  lightTorch() {
    const rules = this.torchRules(), ctx = this.baseContext(), torch = this.torchState(), preview = this.firePreview(workbenchPreview(ctx?.profile, 1, TORCH_RECIPE.id, rules), torch);
    if (this.pending || !ctx || !torch || !preview.canCraft || typeof this.submitFire !== 'function') return false;
    const command = Object.freeze({ t: 'cmd', type: 'fire', op: 'load', opId: globalThis.crypto.randomUUID(), ship: '', part: 'hand',
      kind: TORCH_RECIPE.fire, expectedRev: torch.rev, lit: true, ...(rules === 2 ? { rules: 2 } : {}) });
    this.pending = { command, sentAt: performance.now(), fire: true, count: 1, recipe: TORCH_RECIPE.id, rules, tool: null, tier: 0 };
    this.clearResult(); this.resultTone = ''; let accepted = false; try { accepted = this.submitFire(command) === true; } catch {}
    if (!accepted) { this.pending = null; this.resultSource = { kind: 'sendFailed' }; this.lastResult = this.resultText(); this.resultTone = 'error'; this.update(); return false; }
    this.update(); return true;
  }
  retry() {
    const p = this.pending, send = p?.fire ? this.submitFire : this.submitCommand;
    if (!p || performance.now() - p.sentAt < 5000 || !this.craftContext(p.recipe) || typeof send !== 'function') return false;
    let accepted = false; try { accepted = send(p.command) === true; } catch {} if (accepted) p.sentAt = performance.now(); this.update(); return accepted;
  }
  onFire(ev) {
    const p = this.pending; if (!p?.fire || !ev || ev.type !== 'fire' || ev.op !== 'load' || ev.opId !== p.command.opId) return false;
    this.pending = null;
    this.resultSource = ev.ok === true ? { kind: 'success', done: p } : { kind: 'fire', why: ev.why };
    this.resultTone = ev.ok === true ? 'ok' : 'error'; this.lastResult = this.resultText(); this.update(); return true;
  }
  onResult(ev) {
    const p = this.pending; if (!p || !ev || ev.type !== 'resource' || ev.opId !== p.command.opId || ev.op !== 'craft') return;
    if (ev.ok === false) { this.pending = null; this.resultSource = { kind: 'reason', why: ev.why }; this.lastResult = this.resultText(); this.resultTone = 'error'; this.update(); return; }
    if (!craftAcknowledgementMatches(p, ev)) return;
    p.ackRev = ev.rev; this.clearResult(); this.update();
  }
}
