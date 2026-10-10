// Personal storage quest, crate kits, and backpack capacity at the Salty Shore bench.
import { CARRY, carryLimits, nextBackpack, readCarryField } from '../data/carry.js';
import { holdMass, holdUsed } from '../sim/economy/cargo.js';
import { readProgression } from '../sim/systems/progression.js';
import { newWorkshop, readWorkshop, workshopPlan } from '../sim/systems/workshop.js';

const COSTS = Object.freeze({ 1: Object.freeze({ lona: 3, madera: 2 }), 2: Object.freeze({ lona: 5, madera: 4 }) });
const COPY = {
  es: { title: 'Taller de Salty Shore', close: 'Cerrar taller', boards: 'Primera obra personal', boardsHelp: 'Entrega 10 maderas desde tu mochila. La primera bodega de la balsa queda cubierta por esta recompensa.',
    remaining: n => `Faltan ${n} maderas`, done: 'Obra completada', credit: 'Primera bodega: crédito disponible', used: 'Crédito de primera bodega usado', kits: 'Kits de caja', craft: 'Preparar kit · 2 maderas', wood: 'Maderas en mochila', deliverOne: 'Entregar 1', deliverMax: n => `Entregar ${n}`,
    pack: 'Mochila', volume: 'Espacio', mass: 'Carga / fuerza', upgrade: n => `Ampliar mochila · nivel ${n}`, maxPack: 'Mochila al máximo', cost: (w, c) => `Coste: ${w} madera · ${c} lona`, waiting: 'Esperando confirmación guardada…', retry: 'Reenviar la misma solicitud', ready: 'Elige una mejora o entrega materiales.',
    disabled: 'Acércate al banco de carpintería para usar el taller.', goods: 'No llevas los materiales necesarios.', limit: 'La mochila o el taller llegó a su límite.', conflict: 'El perfil cambió. Actualiza el taller.', busy: 'Espera la respuesta pendiente.', failed: 'No se pudo guardar la acción. Inténtalo de nuevo.',
    command: 'Solicitud no válida.', profile: 'El perfil no está disponible.', carry: 'Los datos de mochila no son válidos.', max: 'La mochila ya está en su nivel máximo.', lessonKnown: 'La primera obra ya se completó.', questComplete: 'La primera obra ya se completó.', overflow: 'Entrega como máximo las maderas que faltan.',
    unknown: 'No se pudo completar la acción.', recovered: 'Acción guardada anteriormente; mochila sincronizada.', recoveredWaiting: 'Acción guardada anteriormente; esperando sincronizar la mochila…' },
  en: { title: 'Salty Shore Workshop', close: 'Close workshop', boards: 'First personal project', boardsHelp: 'Deliver 10 wood from your pack. This reward covers your raft’s first storage hold.',
    remaining: n => `${n} wood remaining`, done: 'Project complete', credit: 'First hold: credit available', used: 'First hold credit used', kits: 'Crate kits', craft: 'Craft kit · 2 wood', wood: 'Wood in pack', deliverOne: 'Deliver 1', deliverMax: n => `Deliver ${n}`,
    pack: 'Backpack', volume: 'Space', mass: 'Load / strength', upgrade: n => `Upgrade backpack · level ${n}`, maxPack: 'Backpack at maximum', cost: (w, c) => `Cost: ${w} wood · ${c} canvas`, waiting: 'Waiting for the saved confirmation…', retry: 'Retry the same request', ready: 'Choose an upgrade or deliver materials.',
    disabled: 'Move closer to the carpentry bench to use this workshop.', goods: 'You do not carry the required materials.', limit: 'The backpack or workshop reached its limit.', conflict: 'Your profile changed. Refresh the workshop.', busy: 'Wait for the pending response.', failed: 'The action could not be saved. Try again.',
    command: 'Invalid request.', profile: 'Your profile is unavailable.', carry: 'Backpack data is invalid.', max: 'Your backpack is at its maximum level.', lessonKnown: 'The first project is already complete.', questComplete: 'The first project is already complete.', overflow: 'Deliver no more than the remaining wood.',
    unknown: 'The action could not be completed.', recovered: 'Previously saved action recovered; backpack synchronized.', recoveredWaiting: 'Previously saved action recovered; waiting for backpack sync…' },
};
const call = (fn, fallback = null) => { try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; } };
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const localeOf = getLocale => String(call(getLocale, document.documentElement?.lang || 'es')).toLowerCase().startsWith('en') ? 'en' : 'es';
const sameWorkshop = (a, b) => !!a && !!b && a.v === b.v && a.boards === b.boards
  && a.storageCredit === b.storageCredit && a.crateKits === b.crateKits;
const sameCarry = (a, b) => a === null && b === null || !!a && !!b
  && ['v', 'backpack', 'volume', 'strength', 'maxMass'].every(key => a[key] === b[key]);

export function workshopPanelView(profile) {
  try {
    if (!profile || typeof profile !== 'object' || !profile.eco?.pack?.goods) return { valid: false };
    const workshop = readWorkshop(profile.workshop);
    const progression = readProgression(profile.progression);
    if (profile.workshop === undefined && progression.knowledge.includes('raft_storage')) {
      workshop.boards = 10; workshop.storageCredit = false;
    }
    const carryField = readCarryField(profile);
    if (carryField.present && !carryField.value) return { valid: false, why: 'carry' };
    const carry = carryField.value || { v: CARRY.version, backpack: 0 };
    const limits = carryLimits(carry, profile.lvl);
    const pack = profile.eco.pack, goods = pack.goods;
    const wood = number(goods.madera), canvas = number(goods.lona);
    const remaining = Math.max(0, 10 - workshop.boards), nextCarry = nextBackpack(carry);
    const cost = nextCarry ? COSTS[nextCarry.backpack] : null;
    return { valid: true, workshop, wood, canvas, remaining, carry: { v: CARRY.version, backpack: carry.backpack,
      volume: limits.volume, strength: limits.strength, maxMass: limits.maxMass },
      packUsed: holdUsed(pack), packCap: pack.cap, packMass: holdMass(pack), maxMass: pack.maxMass ?? limits.maxMass,
      nextCost: cost, canContribute: remaining > 0 && wood > 0 && !progression.knowledge.includes('raft_storage'),
      canCraft: workshop.crateKits < 99 && wood >= 2, canUpgrade: !!cost && Object.entries(cost).every(([good, count]) => number(goods[good]) >= count) };
  } catch { return { valid: false, why: 'profile' }; }
}

export class WorkshopPanel {
  constructor({ parent, profile, context, enabled, submit, onContext, getLocale }) {
    Object.assign(this, { profile, context, enabled, submitCommand: submit, onContext, getLocale });
    this.active = false; this.pending = null; this.status = ''; this.opener = null; this._contextNotified = false;
    this.root = document.createElement('section'); this.root.className = 'workshop-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false');
    this.root.innerHTML = `<header class="workshop-head"><div aria-hidden="true" class="workshop-mark">✣</div><div><small>ARTISAN BENCH</small><h2 data-title></h2></div><button type="button" data-close></button></header>
      <div class="workshop-body"><section class="workshop-card"><div class="workshop-line"><b data-board-title></b><span data-board-count></span></div><p data-board-help></p><div class="workshop-track" role="progressbar" aria-label="First project progress"><i data-board-bar></i></div><p data-credit></p></section>
      <section class="workshop-card workshop-resources"><b data-wood></b><span data-wood-count></span><b data-kits></b><span data-kit-count></span></section>
      <section class="workshop-card"><div class="workshop-line"><b data-pack></b><span data-carry-tier></span></div><p data-volume></p><p data-mass></p><button type="button" data-upgrade></button><small data-upgrade-cost></small></section>
      <p class="workshop-status" data-status aria-live="polite"></p><button type="button" data-retry hidden></button>
      <div class="workshop-actions"><button type="button" data-one></button><button type="button" data-max></button><button type="button" data-craft></button></div></div>`;
    parent.appendChild(this.root); this.$ = selector => this.root.querySelector(selector); this.bind(); this.render();
  }
  contextNow() { return call(this.context, null); }
  profileNow() { return this.contextNow()?.profile || call(this.profile); }
  canUse() { return this.enabled?.() === true && !!this.contextNow(); }
  copy() { return COPY[localeOf(this.getLocale)]; }
  notifyContext(active) { if (this._contextNotified === active) return; this._contextNotified = active; this.onContext?.(active); }
  open() {
    if (!this.canUse()) return false;
    this.opener = document.activeElement; this.active = true; this.root.hidden = false; this.notifyContext(true);
    this.status = ''; this.render(); this.$('[data-close]').focus({ preventScroll: true }); return true;
  }
  close({ restoreFocus = true } = {}) {
    if (!this.active && this.root.hidden) return;
    this.active = false; this.root.hidden = true; this.notifyContext(false);
    const opener = this.opener;
    let visible = !!opener?.isConnected;
    if (visible && typeof opener.getClientRects === 'function') { try { visible = opener.getClientRects().length > 0; } catch { visible = false; } }
    if (restoreFocus && visible) opener.focus({ preventScroll: true });
    this.opener = null;
  }
  bind() {
    this.root.addEventListener('keydown', event => { if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); } });
    this.$('[data-close]').addEventListener('click', () => this.close());
    this.$('[data-one]').addEventListener('click', () => this.contribute(1));
    this.$('[data-max]').addEventListener('click', () => { const v = workshopPanelView(this.profileNow()); this.contribute(Math.min(v.remaining, v.wood, 10)); });
    this.$('[data-craft]').addEventListener('click', () => this.act('craftCrate'));
    this.$('[data-upgrade]').addEventListener('click', () => this.act('upgradePack'));
    this.$('[data-retry]').addEventListener('click', () => this.retry());
  }
  makeCommand(op, profile, amount) {
    const command = { t: 'cmd', type: 'artisan', op, opId: globalThis.crypto.randomUUID(), expectedRev: profile.eco.tradeRev };
    if (op === 'contribute') command.amount = amount;
    return Object.freeze(command);
  }
  send(command) { try { return this.submitCommand?.(command) === true; } catch { return false; } }
  act(op, amount) {
    const profile = this.profileNow(), view = workshopPanelView(profile);
    if (!this.active || !this.canUse() || this.pending || !view.valid || !Number.isSafeInteger(profile?.eco?.tradeRev)) return false;
    let expectedWorkshop, expectedCarry;
    try {
      if (op === 'contribute' || op === 'craftCrate') {
        const plan = workshopPlan(profile, { type: op === 'contribute' ? op : 'craftCrate', ...(op === 'contribute' ? { amount } : {}), expectedRev: profile.eco.tradeRev });
        expectedWorkshop = plan.workshop; expectedCarry = view.carry;
      } else if (op === 'upgradePack' && view.canUpgrade) {
        const next = nextBackpack({ v: CARRY.version, backpack: view.carry.backpack });
        const limits = carryLimits(next, profile.lvl);
        expectedWorkshop = view.workshop;
        expectedCarry = { v: CARRY.version, backpack: next.backpack, volume: limits.volume, strength: limits.strength, maxMass: limits.maxMass };
      } else return false;
    } catch { return false; }
    const command = this.makeCommand(op, profile, amount);
    this.pending = { command, sentAt: performance.now(), expectedWorkshop, expectedCarry, ackRev: null };
    this.status = this.copy().waiting;
    if (!this.send(command)) { this.pending = null; this.status = this.copy().failed; this.render(); return false; }
    this.render(); return true;
  }
  contribute(amount) { return this.act('contribute', amount); }
  retry() {
    const pending = this.pending;
    if (!pending || !this.canUse() || performance.now() - pending.sentAt < 5000) return false;
    const sent = this.send(pending.command); if (sent) pending.sentAt = performance.now(); this.render(); return sent;
  }
  confirmProfile() {
    const p = this.pending, profile = this.profileNow(), view = workshopPanelView(profile);
    if (!p || !Number.isSafeInteger(p.ackRev) || !view.valid || profile.eco.tradeRev < p.ackRev
        || !sameWorkshop(view.workshop, p.expectedWorkshop) || !sameCarry(view.carry, p.expectedCarry)) return false;
    this.pending = null; this.status = this.copy().ready; this.render(); return true;
  }
  onResult(ev) {
    const p = this.pending;
    if (!p || ev?.type !== 'artisan' || ev.op !== p.command.op || ev.opId !== p.command.opId) return false;
    if (ev.ok === false) { this.pending = null; this.status = this.copy()[ev.why] || this.copy().unknown; this.render(); return true; }
    if (ev.ok !== true || ev.rev !== p.command.expectedRev + 1 || !sameWorkshop(ev.workshop, p.expectedWorkshop)
        || !sameCarry(ev.carry, p.expectedCarry)) return false;
    p.ackRev = ev.rev;
    if (ev.historical || ev.replay) {
      const profile = this.profileNow(), view = workshopPanelView(profile);
      if (view.valid && Number.isSafeInteger(profile?.eco?.tradeRev) && profile.eco.tradeRev >= ev.rev) {
        this.pending = null;
        this.status = this.copy().recovered || this.copy().ready;
      } else { p.recovered = true; this.status = this.copy().recoveredWaiting || this.copy().waiting; }
    }
    this.render(); return true;
  }
  update() { this.confirmProfile(); this.render(); }
  render() {
    if (!this.root) return;
    const c = this.copy(), v = workshopPanelView(this.profileNow()), ctx = this.canUse();
    this.$('[data-title]').textContent = c.title;
    this.$('[data-close]').textContent = c.close;
    this.$('[data-board-title]').textContent = c.boards;
    this.$('[data-board-help]').textContent = c.boardsHelp;
    this.$('[data-board-count]').textContent = v.valid ? `${v.workshop.boards} / 10` : '—';
    this.$('[data-board-bar]').style.width = `${v.valid ? Math.round(v.workshop.boards * 10) : 0}%`;
    this.$('[data-credit]').textContent = !v.valid ? '' : v.workshop.storageCredit ? c.credit : v.workshop.boards >= 10 ? c.used : c.remaining(v.remaining);
    this.$('[data-wood]').textContent = c.wood; this.$('[data-wood-count]').textContent = v.valid ? `${v.wood}` : '—';
    this.$('[data-kits]').textContent = c.kits; this.$('[data-kit-count]').textContent = v.valid ? `${v.workshop.crateKits} / 99` : '—';
    this.$('[data-pack]').textContent = c.pack;
    this.$('[data-carry-tier]').textContent = v.valid ? `${v.carry.backpack} / ${CARRY.maxBackpack}` : '—';
    this.$('[data-volume]').textContent = v.valid ? `${c.volume}: ${v.packUsed} / ${v.packCap}` : c.profile;
    this.$('[data-mass]').textContent = v.valid ? `${c.mass}: ${v.packMass} / ${v.maxMass} · ${v.carry.strength}` : '';
    const nextLevel = v.valid ? v.carry.backpack + 1 : 0, cost = v.valid && v.nextCost;
    this.$('[data-upgrade]').textContent = cost ? c.upgrade(nextLevel) : c.maxPack;
    this.$('[data-upgrade-cost]').textContent = cost ? c.cost(cost.madera, cost.lona) : '';
    const one = this.$('[data-one]'), max = this.$('[data-max]'), craft = this.$('[data-craft]'), busy = !!this.pending;
    one.textContent = c.deliverOne; max.textContent = v.valid ? c.deliverMax(Math.min(v.remaining, v.wood, 10)) : c.deliverMax(0);
    craft.textContent = v.valid ? `${c.craft} · ${c.kits} ${v.workshop.crateKits}/99` : c.craft;
    one.disabled = busy || !ctx || !v.valid || !v.canContribute;
    max.disabled = busy || !ctx || !v.valid || !v.canContribute;
    craft.disabled = busy || !ctx || !v.valid || !v.canCraft;
    this.$('[data-upgrade]').disabled = busy || !ctx || !v.valid || !v.canUpgrade;
    this.$('[data-status]').textContent = busy ? this.pending.recovered ? c.recoveredWaiting || c.waiting : c.waiting
      : !ctx ? c.disabled : this.status || (v.valid ? c.ready : c.profile);
    const retry = this.$('[data-retry]'), retryReady = busy && performance.now() - this.pending.sentAt >= 5000;
    retry.hidden = !retryReady; retry.disabled = !retryReady || !ctx; retry.textContent = c.retry;
    this.root.classList.toggle('is-pending', busy);
  }
  reset() { this.pending = null; this.status = ''; this.close(); this.render(); }
}
