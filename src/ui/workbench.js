// The shore workbench batches wood and offers fixed utility tools; the server remains authoritative.
import { CRAFT_RECIPES, HARVEST, WOOD_RECIPE } from '../data/resources.js';
import { GOODS } from '../data/goods.js';
import { goodVolume, holdUsed } from '../sim/economy/cargo.js';

const MAX_CRAFT = () => Number.isSafeInteger(HARVEST.craftMax) && HARVEST.craftMax > 0 ? HARVEST.craftMax : 10;
const fmt = (value) => Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString('es-MX');
const recipeFor = (id = WOOD_RECIPE.id) => CRAFT_RECIPES?.[id] || CRAFT_RECIPES?.[WOOD_RECIPE.id] || WOOD_RECIPE;
const recipeInputs = (recipe) => recipe.inputs || { [recipe.input]: recipe.count || 1 };
const recipeOutput = (recipe) => recipe.output;
const isToolRecipe = (recipe) => !!recipe.tool;
const STORAGE_REASONS = {
  es: { account_required: 'Inicia sesión para fabricar en este servidor.', storage: 'El servidor no pudo confirmar el guardado. Vuelve a conectar.' },
  en: { account_required: 'Sign in to craft on this server.', storage: 'The server could not confirm the save. Reconnect to continue.' },
};
const REASONS = {
  schema: 'La solicitud no es válida. Ajusta la cantidad e inténtalo otra vez.', n: 'Elige una cantidad válida para preparar.',
  materials: 'No llevas suficientes materiales para esa receta.', full: 'La mochila no tiene espacio para el resultado.',
  room: 'La mochila no tiene espacio para el resultado.', far: 'Acércate al banco para preparar materiales.',
  bench: 'El banco no está disponible en esta partida.', dead: 'No puedes preparar materiales mientras estás derrotado.',
  busy: 'Detente y termina tu acción antes de preparar materiales.', combat: 'Espera tres segundos en calma antes de preparar materiales.',
  cooldown: 'Espera un momento antes de preparar otra tanda.', calm: 'Espera tres segundos en calma antes de preparar materiales.',
  land: 'Desembarca y acércate al banco en tierra.', aboard: 'Desembarca para preparar materiales.', navigation: 'Vuelve a atracar antes de preparar materiales.',
  revision: 'La mochila cambió. Revisa los materiales e inténtalo otra vez.', revisionLimit: 'La revisión llegó a su límite; vuelve a entrar.',
  saveSize: 'La partida supera el límite de guardado.', duplicate: 'La solicitud ya corresponde a otra acción.',
  opIdReuse: 'La solicitud ya corresponde a otra acción.', receiptLimit: 'No se pudo registrar la solicitud; vuelve a entrar.',
  pack: 'La mochila no está disponible.', alreadyOwned: 'Ya llevas esa herramienta en el cinturón.'
};

function validPack(pack) {
  if (!pack || !Number.isFinite(pack.cap) || pack.cap < 0 || !pack.goods || typeof pack.goods !== 'object' || Array.isArray(pack.goods)) return false;
  return Object.entries(pack.goods).every(([good, count]) => Object.hasOwn(GOODS, good) && Number.isSafeInteger(count) && count > 0);
}

/** Calculate an all-or-nothing batch against the current profile without changing it. */
export function workbenchPreview(profile, n, recipeId = WOOD_RECIPE.id) {
  const recipe = recipeFor(recipeId), pack = profile?.eco?.pack, inputs = recipeInputs(recipe);
  const tool = isToolRecipe(recipe), craftMax = tool ? 1 : Math.min(MAX_CRAFT(), recipe.max || MAX_CRAFT());
  let packKnown = validPack(pack), usedBefore = 0;
  if (packKnown) { try { usedBefore = holdUsed(pack); packKnown = Number.isFinite(usedBefore) && usedBefore <= pack.cap; } catch { packKnown = false; } }
  const needs = Object.entries(inputs).map(([good, each]) => ({ good, count: each, owned: packKnown ? (pack.goods[good] || 0) : 0,
    name: GOODS[good]?.name || good }));
  const materialsFit = needs.every((item) => Number.isSafeInteger(item.owned) && item.owned >= item.count * (Number.isSafeInteger(n) && n > 0 ? n : 0));
  const ownedTool = tool ? (profile?.tools?.[recipe.tool] === 1) : false;
  const output = recipeOutput(recipe), outputCount = recipe.count || 1;
  const deltaPerBatch = (tool ? 0 : outputCount * goodVolume(output)) - needs.reduce((sum, item) => sum + item.count * goodVolume(item.good), 0);
  const maxBySpace = !packKnown || deltaPerBatch > 0 ? (packKnown ? Math.floor(Math.max(0, pack.cap - usedBefore) / deltaPerBatch) : 0) : craftMax;
  const maxCraftable = ownedTool ? 0 : Math.max(0, Math.min(craftMax, ...needs.map((item) => Math.floor(item.owned / item.count)), maxBySpace));
  const qtyValid = Number.isSafeInteger(n) && n >= 1 && n <= craftMax;
  const requested = qtyValid ? n : 0, outputAmount = requested * outputCount;
  const usedAfter = packKnown ? usedBefore + requested * deltaPerBatch : 0;
  const spaceAfter = packKnown ? pack.cap - usedAfter : 0;
  const spaceFits = tool || (packKnown && spaceAfter >= -1e-8);
  return { recipe: recipe.id, tool: recipe.tool || null, tier: recipe.tier || 0, inputs: needs,
    input: needs[0]?.good, output, inputName: needs[0]?.name || '', outputName: tool ? recipe.name : GOODS[output]?.name || output,
    n: requested, craftMax, packKnown, qtyValid, inputOwned: needs[0]?.owned || 0,
    inputNeeded: needs[0]?.count * requested || 0, outputAmount, usedBefore, usedAfter,
    packCapacity: packKnown ? pack.cap : 0, spaceBefore: packKnown ? Math.max(0, pack.cap - usedBefore) : 0,
    spaceAfter: Math.max(0, spaceAfter), maxCraftable, materialsFit: qtyValid && materialsFit,
    spaceFits, ownedTool, canCraft: packKnown && qtyValid && materialsFit && spaceFits && !ownedTool };
}

function call(getter, fallback = null) { try { return typeof getter === 'function' ? getter() : fallback; } catch { return fallback; } }

/** Match the private server receipt against the exact recipe and revision that was sent. */
export function craftAcknowledgementMatches(pending, ev) {
  if (!pending?.command || ev?.ok !== true || ev.rev !== pending.command.expectedRev + 1) return false;
  const recipe = recipeFor(pending.recipe);
  if (pending.tool) return ev.tool === pending.tool && ev.tier === pending.tier && ev.count === 1;
  return ev.good === recipe.output && ev.count === pending.count;
}

export class WorkbenchPanel {
  constructor({ parent, profile, player, bench, enabled, blocked, submit, onContext }) {
    Object.assign(this, { parent, profile, player, bench, enabled, blocked, submitCommand: submit, onContext });
    this.active = false; this.pending = null; this.qty = 1; this.recipe = WOOD_RECIPE.id; this.lastResult = ''; this._contextNotified = false;
    this.root = document.createElement('section'); this.root.className = 'workbench-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false'); this.root.setAttribute('aria-label', 'Banco de materiales');
    this.root.innerHTML = `<header class="wb-head"><div class="wb-mark" aria-hidden="true">✦</div><div class="wb-heading"><small>BANCO DEL PUERTO</small><h2>Banco de materiales</h2></div><button class="wb-close" type="button" aria-label="Cerrar banco">×</button></header>
      <div class="wb-body"><div class="wb-amounts" data-recipe-list role="group" aria-label="Receta"></div>
      <div class="wb-recipe" aria-label="Receta actual"><div class="wb-material"><span class="wb-wood-icon" aria-hidden="true">▰</span><span><small>NECESITAS</small><b data-input-name>Tronco</b><em data-input-count>1 necesario</em></span></div><div class="wb-arrow" aria-hidden="true">→</div><div class="wb-material wb-result"><span class="wb-plank-icon" aria-hidden="true">▰</span><span><small>FABRICAS</small><b data-output-name>Madera</b><em data-output-count>1 unidad</em></span></div></div>
      <section class="wb-section" aria-labelledby="wb-amount-title"><div class="wb-section-title"><h3 id="wb-amount-title">Cantidad</h3><small>Máximo <span data-craft-max>10</span> por tanda</small></div><div class="wb-amounts" role="group" aria-label="Cantidad rápida"><button type="button" data-qty="1">1</button><button type="button" data-qty="3">3</button><button type="button" data-qty="max">Máx.</button><label class="wb-qty-input"><span class="wb-sr-only">Cantidad a preparar</span><input data-qty-input type="number" inputmode="numeric" min="1" max="10" step="1" value="1" aria-label="Cantidad a preparar"></label></div></section>
      <section class="wb-section wb-stock" aria-label="Materiales y espacio en mochila"><div data-needs></div><div class="wb-stock-row"><span>Espacio usado</span><b data-pack-used>0 / 0</b></div><div class="wb-capacity"><div class="wb-capacity-track"><i data-pack-bar></i></div><small data-pack-after>Después de preparar: 0 / 0</small></div><div class="wb-stock-row"><span>Cinturón de herramientas</span><b data-tools>Hacha: no · Pico: no</b></div><small>Dos ranuras fijas de utilidad; no ocupan volumen de mochila.</small></section>
      <p class="wb-feedback" data-feedback aria-live="polite"></p><button class="wb-retry" type="button" hidden>Reintentar la misma preparación</button><p class="wb-next">Lleva la madera a tu balsa para construir o reparar.</p></div><footer class="wb-foot"><button class="wb-confirm" type="button">Preparar</button></footer>`;
    parent.appendChild(this.root); this.$ = (selector) => this.root.querySelector(selector);
    this.$('[data-recipe-list]').style.gridTemplateColumns = `repeat(${Object.keys(CRAFT_RECIPES).length}, minmax(0, 1fr))`;
    for (const recipe of Object.values(CRAFT_RECIPES)) { const button = document.createElement('button'); button.type = 'button'; button.dataset.recipe = recipe.id; button.textContent = recipe.name; this.$('[data-recipe-list]').appendChild(button); }
    this.bind(); this.renderKey = ''; this.update();
  }
  bind() {
    this.root.addEventListener('keydown', (event) => { if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); } else if (event.code === 'Enter') { event.stopPropagation(); if (event.target.matches('[data-qty-input]')) { event.preventDefault(); this.confirm(); } } });
    this.$('.wb-close').addEventListener('click', () => this.close()); this.$('.wb-confirm').addEventListener('click', () => this.confirm()); this.$('.wb-retry').addEventListener('click', () => this.retry());
    this.$('[data-qty-input]').addEventListener('input', (event) => { this.qty = event.currentTarget.value === '' ? 0 : Number(event.currentTarget.value); this.lastResult = ''; this.update(); });
    this.root.addEventListener('click', (event) => {
      const recipeButton = event.target.closest('[data-recipe]');
      if (recipeButton && !this.pending) { this.recipe = recipeButton.dataset.recipe; this.qty = 1; this.lastResult = ''; this.update(); return; }
      const button = event.target.closest('[data-qty]'); if (!button || button.disabled || this.pending) return;
      this.qty = button.dataset.qty === 'max' ? workbenchPreview(call(this.profile), 1, this.recipe).maxCraftable : Number(button.dataset.qty); this.lastResult = ''; this.update();
    });
  }
  context() {
    const profile = call(this.profile), player = call(this.player), bench = call(this.bench);
    if (!profile?.eco?.pack || !Number.isSafeInteger(profile.eco.tradeRev) || profile.eco.tradeRev < 0 || !player || player.dead || !bench || ![player.x, player.y, player.z, bench.x, bench.y, bench.z].every(Number.isFinite)) return null;
    if (Math.abs(player.y - bench.y) > 1.5 || Math.hypot(player.x - bench.x, player.z - bench.z) > HARVEST.benchRadius || call(this.enabled, false) !== true || call(this.blocked, false) === true) return null;
    return { profile, player, bench };
  }
  open() { if (!this.context()) return false; this.active = true; this.root.hidden = false; this.notifyContext(true); this.update(); this.$('.wb-close').focus({ preventScroll: true }); return true; }
  close() { if (!this.active && this.root.hidden) return; this.active = false; this.root.hidden = true; this.notifyContext(false); }
  notifyContext(active) { if (this._contextNotified === active) return; this._contextNotified = active; this.onContext?.(active); }
  reset() { this.pending = null; this.qty = 1; this.recipe = WOOD_RECIPE.id; this.lastResult = ''; this.close(); this.update(); }
  update() {
    const ctx = this.context(); if (this.active && !ctx) this.close(); const profile = ctx?.profile || call(this.profile);
    if (this.pending?.ackRev !== undefined && Number.isSafeInteger(profile?.eco?.tradeRev) && profile.eco.tradeRev >= this.pending.ackRev) { const done = this.pending; this.pending = null; this.lastResult = done.tool ? `${done.label} fabricado.` : `Preparaste ${done.label}.`; }
    if (!this.active) return;
    const preview = workbenchPreview(profile, this.qty, this.recipe), pending = this.pending;
    const retryReady = !!pending && performance.now() - pending.sentAt >= 5000;
    const renderKey = JSON.stringify([preview, !!ctx, pending?.command.opId, pending?.ackRev, retryReady, this.lastResult, this.recipe]); if (renderKey === this.renderKey) return; this.renderKey = renderKey;
    const input = this.$('[data-qty-input]'), toolRecipe = !!preview.tool;
    if (document.activeElement !== input && input.value !== String(this.qty)) input.value = String(this.qty);
    input.hidden = toolRecipe; input.max = String(preview.craftMax); this.$('[data-craft-max]').textContent = String(preview.craftMax);
    this.$('[data-input-name]').textContent = preview.inputs.map((i) => i.name).join(' + '); this.$('[data-output-name]').textContent = preview.outputName;
    this.$('[data-input-count]').textContent = preview.inputs.map((i) => `${fmt(i.count * preview.n)} ${i.name.toLowerCase()}`).join(' + ');
    this.$('[data-output-count]').textContent = toolRecipe ? '1 herramienta' : `${fmt(preview.outputAmount)} ${preview.outputAmount === 1 ? 'unidad' : 'unidades'}`;
    this.$('[data-needs]').innerHTML = preview.inputs.map((i) => `<div class="wb-stock-row"><span>${i.name} que llevas</span><b>${fmt(i.owned)}</b></div><div class="wb-stock-row"><span>Necesitas</span><b>${fmt(i.count * preview.n)}</b></div>`).join('');
    this.$('[data-pack-used]').textContent = `${fmt(preview.usedBefore)} / ${fmt(preview.packCapacity)}`; this.$('[data-pack-after]').textContent = `Después de fabricar: ${fmt(preview.usedAfter)} / ${fmt(preview.packCapacity)}`;
    this.$('[data-pack-bar]').style.width = `${preview.packCapacity > 0 ? Math.max(0, Math.min(100, preview.usedBefore / preview.packCapacity * 100)) : 0}%`;
    const tools = profile?.tools || {}; this.$('[data-tools]').textContent = `Hacha: ${tools.axe === 1 ? 'sí' : 'no'} · Pico: ${tools.pickaxe === 1 ? 'sí' : 'no'}`;
    for (const b of this.root.querySelectorAll('[data-recipe]')) { b.disabled = !!pending; b.classList.toggle('on', b.dataset.recipe === this.recipe); b.setAttribute('aria-pressed', b.dataset.recipe === this.recipe ? 'true' : 'false'); }
    for (const b of this.root.querySelectorAll('[data-qty]')) { const q = b.dataset.qty === 'max' ? preview.maxCraftable : Number(b.dataset.qty); b.disabled = !!pending || !ctx || (b.dataset.qty === 'max' ? q < 1 : q > preview.craftMax); b.classList.toggle('on', b.dataset.qty !== 'max' && q === this.qty); b.setAttribute('aria-pressed', b.dataset.qty !== 'max' && q === this.qty ? 'true' : 'false'); }
    input.disabled = !!pending || !ctx; this.$('.wb-confirm').disabled = !!pending || !ctx || !preview.canCraft; this.$('.wb-confirm').textContent = toolRecipe ? `Fabricar ${preview.outputName}` : `Preparar ${preview.outputName}`;
    this.$('.wb-retry').hidden = !retryReady; this.$('.wb-retry').disabled = !retryReady || !ctx;
    this.$('[data-feedback]').textContent = pending?.ackRev !== undefined ? 'Preparación recibida; esperando actualizar tu mochila…' : pending ? 'Esperando confirmación del banco…' : this.lastResult || this.previewMessage(preview, ctx);
    this.root.classList.toggle('is-pending', !!pending);
  }
  previewMessage(p, ctx) { if (!ctx) return 'Acércate al banco para preparar materiales.'; if (p.ownedTool) return 'Ya llevas esta herramienta en el cinturón.'; if (!p.packKnown) return 'La mochila no está disponible.'; if (!p.qtyValid) return `Elige una cantidad entre 1 y ${p.craftMax}.`; if (!p.materialsFit) return 'No llevas suficientes materiales para esa receta.'; if (!p.spaceFits) return 'La mochila no tiene espacio para el resultado.'; return 'Todo listo para fabricar.'; }
  qtyLabel(n) { return `${fmt(n)} ${n === 1 ? 'tabla' : 'tablas'}`; }
  confirm() {
    const ctx = this.context(), preview = workbenchPreview(ctx?.profile, this.qty, this.recipe);
    if (this.pending || !ctx || !preview.canCraft || typeof this.submitCommand !== 'function') return false;
    const recipe = recipeFor(this.recipe), command = Object.freeze({ t: 'cmd', type: 'resource', op: 'craft', opId: globalThis.crypto.randomUUID(), recipe: recipe.id, n: preview.n, expectedRev: ctx.profile.eco.tradeRev });
    this.pending = { command, sentAt: performance.now(), count: preview.outputAmount, recipe: recipe.id, tool: recipe.tool || null, tier: recipe.tier || 0, label: recipe.tool ? recipe.name || preview.outputName : this.qtyLabel(preview.outputAmount) };
    this.lastResult = ''; let accepted = false; try { accepted = this.submitCommand(command) === true; } catch {}
    if (!accepted) { this.pending = null; this.lastResult = 'No se pudo enviar la preparación. Acércate al banco e inténtalo otra vez.'; this.update(); return false; }
    this.update(); return true;
  }
  retry() { const p = this.pending; if (!p || performance.now() - p.sentAt < 5000 || !this.context() || typeof this.submitCommand !== 'function') return false; let accepted = false; try { accepted = this.submitCommand(p.command) === true; } catch {} if (accepted) p.sentAt = performance.now(); this.update(); return accepted; }
  onResult(ev) {
    const p = this.pending; if (!p || !ev || ev.type !== 'resource' || ev.opId !== p.command.opId || ev.op !== 'craft') return;
    if (ev.ok === false) {
      const locale = document.documentElement?.lang?.startsWith('en') ? 'en' : 'es';
      this.pending = null; this.lastResult = STORAGE_REASONS[locale][ev.why] || REASONS[ev.why] || 'El banco no pudo completar la receta. Revisa tu mochila e inténtalo otra vez.';
      this.update(); return;
    }
    if (!craftAcknowledgementMatches(p, ev)) return;
    p.ackRev = ev.rev; this.lastResult = ''; this.update();
  }
}
