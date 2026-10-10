// Private cargo and market UI. Every mutation is an intent; server acknowledgements and profile revisions confirm it.
import { GOODS, GOOD_CATS } from '../data/goods.js';
import { RAFT_LOAD } from '../data/raftparts.js';
import { TOWNS } from '../data/towns.js';
import { EDITOR_RADIUS } from '../data/raftEditor.js';
import { raftStats } from '../sim/economy/raft.js';
import { productionRows } from '../sim/economy/raftProduction.js';
import { holdUsed, roomFor, goodMass, goodVolume } from '../sim/economy/cargo.js';
import { raftCapacity } from '../sim/economy/raftCapacity.js';
import { raftGangplank } from '../sim/raftGeometry.js';
import { t, onLocaleChange, formatNumber, translateData } from '../core/i18n.js';

const MAX_QTY = 500;
const MAX_READS = 12;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const opId = () => globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const num = (n) => formatNumber(Math.max(0, Number.isFinite(+n) ? +n : 0));
const CAT_MARK = { food: '✦', drink: '◉', material: '◆', arms: '⬟', luxury: '✧' };
const REASONS = {
  town: 'No hay un mercado aquí.', far: 'Acércate al mercado.', calm: 'Espera tres segundos en calma antes de comerciar.',
  good: 'Esa mercancía no se ofrece aquí.', n: 'Elige una cantidad válida.', law: 'La ley del pueblo prohíbe esa mercancía.',
  stock: 'El mercado no tiene esa cantidad.', gold: 'No tienes oro suficiente.', room: 'No cabe toda la mercancía.',
  have: 'No llevas esa cantidad.', owner: 'Esa bodega no es tuya.', raft: 'Tu balsa no está disponible en Aldea.',
  revision: 'El plano cambió; actualiza la bodega.', capacity: 'La bodega no puede recibir esa carga: el límite de porte reserva masa para el piloto.',
  busy: 'Detente antes de transferir.', dead: 'No puedes comerciar mientras estás fuera de combate.',
  price: 'El precio cambió; revisa la nueva cotización.', saveSize: 'La partida supera el límite de guardado.', command: 'Solicitud no válida.',
  duplicate: 'Ese identificador ya se usó con otra solicitud.', revisionLimit: 'La revisión llegó a su límite; vuelve a entrar.', market: 'El mercado no pudo completar la solicitud.',
};
const reason = (why) => REASONS[why] ? t(`systems.commerce.reason.${why}`) : t('systems.commerce.feedback.unknown');
const goodName = (id) => translateData(GOODS[id]?.name || id);
const clampQty = (n) => Math.max(1, Math.min(MAX_QTY, Math.floor(Number(n) || 1)));
const formatRecipe = (counts) => Object.entries(counts || {}).map(([g, n]) => `${num(n)} ${goodName(g)}`).join(' + ') || t('systems.commerce.noInputs');

export class CommercePanel {
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false; this.view = 'cargo'; this.town = ''; this.selected = ''; this.side = 'buy'; this.qty = 1;
    this.rows = []; this.market = null; this.quote = null; this.quoteErrorSignature = ''; this.cargoSnapshot = null;
    this.productionStatus = null;
    this.pending = null; this.reads = new Map(); this.readByKind = new Map(); this.lastResult = ''; this.lastResultKey = ''; this.lastResultParams = {};
    this.panelToken = 0; this.renderKey = '';

    this.launcher = document.createElement('button');
    this.launcher.type = 'button'; this.launcher.className = 'commerce-cargo-launcher';
    this.launcher.textContent = t('systems.commerce.launcher'); this.launcher.setAttribute('aria-label', t('systems.commerce.launcherLabel'));
    this.launcher.hidden = true; this.parent.appendChild(this.launcher);

    this.root = document.createElement('section'); this.root.className = 'commerce-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', t('systems.commerce.dialog'));
    this.root.innerHTML = `<header class="commerce-head"><div><small class="commerce-kicker">${t('systems.commerce.kicker')}</small><b class="commerce-title">${t('systems.commerce.tabs.hold')}</b></div><button class="commerce-close" type="button" aria-label="${t('systems.commerce.close')}">×</button></header>
      <nav class="commerce-tabs"><button type="button" data-view="cargo">${t('systems.commerce.tabs.hold')}</button><button type="button" data-view="market">${t('systems.commerce.tabs.market')}</button><button type="button" data-view="production" hidden>${t('systems.commerce.tabs.production')}</button></nav>
      <div class="commerce-body"></div>
      <div class="commerce-feedback" aria-live="polite"></div>
      <footer class="commerce-foot"><small class="commerce-footnote"></small><button type="button" class="commerce-confirm">${t('systems.commerce.confirm.transfer')}</button></footer>`;
    this.parent.appendChild(this.root);
    this.$ = (selector) => this.root.querySelector(selector);
    this.bind();
    this.unsubscribeLocale = onLocaleChange(() => { if (this.lastResultKey) this.lastResult = t(this.lastResultKey, this.lastResultParams); this.refreshLocale(); });
    this.render();
  }

  refreshLocale() {
    const focused = this.root.ownerDocument.activeElement;
    const selector = focused && this.root.contains(focused) ? focused.matches('[data-amount]') ? '[data-amount]' : focused.matches('[data-good]') ? `[data-good="${globalThis.CSS?.escape?.(focused.dataset.good) || focused.dataset.good}"]` : focused.matches('[data-cargo-side]') ? '[data-cargo-side]' : focused.matches('[data-market-side]') ? '[data-market-side]' : focused.matches('.commerce-confirm') ? '.commerce-confirm' : focused.matches('.commerce-close') ? '.commerce-close' : focused.matches('[data-view]') ? `[data-view="${focused.dataset.view}"]` : null : null;
    const selection = focused && selector && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    this.launcher.textContent = t('systems.commerce.launcher'); this.launcher.setAttribute('aria-label', t('systems.commerce.launcherLabel'));
    this.root.setAttribute('aria-label', t('systems.commerce.dialog'));
    this.$('.commerce-kicker').textContent = t('systems.commerce.kicker'); this.$('.commerce-close').setAttribute('aria-label', t('systems.commerce.close'));
    this.$('[data-view="cargo"]').textContent = t('systems.commerce.tabs.hold');
    this.$('[data-view="market"]').textContent = t('systems.commerce.tabs.market');
    this.$('[data-view="production"]').textContent = t('systems.commerce.tabs.production');
    this.render();
    if (selector) { const next = this.root.querySelector(selector); next?.focus({ preventScroll: true }); if (selection) next?.setSelectionRange?.(...selection); }
  }

  setResult(key, params = {}) { this.lastResultKey = key; this.lastResultParams = params; this.lastResult = t(key, params); }
  clearResult() { this.lastResult = ''; this.lastResultKey = ''; this.lastResultParams = {}; }

  bind() {
    this.launcher.addEventListener('click', () => this.toggleCargo());
    this.$('.commerce-close').addEventListener('click', () => this.close());
    this.$('.commerce-confirm').addEventListener('click', () => this.confirm());
    this.root.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.view === 'cargo') this.toggleCargo(true);
      else if (button.dataset.view === 'market' && this.town) this.openMarket(this.town);
      else if (button.dataset.view === 'production') this.openProduction();
    }));
    this.$('.commerce-body').addEventListener('click', (event) => this.onBodyClick(event));
    this.$('.commerce-body').addEventListener('change', (event) => this.onBodyChange(event));
    this.$('.commerce-body').addEventListener('input', (event) => this.onBodyInput(event));
  }

  context() {
    const profile = this.profile?.(), player = this.player?.();
    const record = (this.rafts?.() || []).find((r) => r.owner === this.youServer?.());
    const ship = record && profile?.eco?.ships?.find((s) => s.kind === 'raft' && s.id === record.id);
    if (!record || !ship || ship.at !== 'aldea' || !(ship.hp > 0) || !player || player.dead
      || ![player.x, player.y, player.z].every(Number.isFinite)) return null;
    const deck = this.raftDeck?.()?.surface(player.x, player.z, player.y);
    const plank = raftGangplank({ ...record, parts: ship.grid.parts }, this.map?.dock), dock = this.map?.dock;
    const dockDistance = dock ? Math.hypot(player.x - dock.base.x - dock.dir.x * Math.max(0, dock.len - 10),
      player.z - dock.base.z - dock.dir.z * Math.max(0, dock.len - 10)) : Infinity;
    const nearPlank = !!plank && dockDistance <= EDITOR_RADIUS && Math.hypot(player.x - plank.x, player.z - plank.z) <= 2.5;
    if (deck?.id !== record.id && !nearPlank) return null;
    return { profile, player, record, ship };
  }

  toggleCargo(force = false) {
    if (this.active && ['cargo', 'production'].includes(this.view) && !force) { this.close(); return; }
    if (this.enabled && !this.enabled()) return;
    const c = this.context(); if (!c) return;
    this.activate('cargo');
    this.cargoSnapshot = null; this.clearResult();
    this.request('cargo', { id: c.record.id }, { raftId: c.record.id, rev: c.ship.rev });
    this.render();
  }

  openProduction() {
    if (this.enabled && !this.enabled()) return;
    const c = this.context(); if (!c) return;
    this.activate('production');
    if (this.cargoSnapshot?.id !== c.record.id) this.fetchCargo();
    this.render();
  }

  onProductionResult(ev) {
    if (!ev || ev.type !== 'raftProduction' || typeof ev.id !== 'string'
      || !Number.isSafeInteger(ev.rev) || !Number.isSafeInteger(ev.raftRev)
      || !Number.isSafeInteger(ev.daySec) || !Array.isArray(ev.production)
      || !['', 'saveSize', 'revisionLimit', 'capacity'].includes(ev.productionBlocked)) return;
    const c = this.context();
    if (!c || ev.id !== c.record.id) return;
    this.rememberProductionStatus(ev.id, ev.daySec, ev.rev, ev.raftRev, ev.productionBlocked, ev.production);
    if (this.active && this.view === 'production') this.render();
  }

  rememberProductionStatus(id, daySec, rev, raftRev, blocked, rows) {
    const previous = this.productionStatus;
    if (previous?.id === id && (daySec < previous.daySec
      || daySec === previous.daySec && (raftRev < previous.raftRev || rev < previous.rev))) return;
    this.productionStatus = { id, daySec, rev, raftRev, blocked, rows };
  }

  openMarket(town) {
    if (this.enabled && !this.enabled()) return;
    if (!TOWNS[town]) { this.setResult('systems.commerce.market.unknownTown'); return; }
    this.town = town; this.activate('market'); this.clearResult(); this.quote = null; this.quoteErrorSignature = ''; this.rows = [];
    this.market = null; this.selected = ''; this.qty = 1;
    this.request('list', { town }, { town }); this.render();
  }

  activate(view) {
    const wasActive = this.active;
    this.panelToken++;
    this.active = true; this.view = view; this.root.hidden = false;
    this.onContext?.(true);
    if (!wasActive) this.renderKey = '';
  }

  close() {
    if (!this.active) return;
    this.active = false; this.panelToken++; this.root.hidden = true;
    this.onContext?.(false);
  }

  request(op, payload, meta = {}) {
    const id = opId();
    const message = { type: 'commerce', op, ...payload, opId: id };
    const read = { id, op, message, meta, panelToken: this.panelToken, sentAt: performance.now() };
    this.rememberRead(read); this.readByKind.set(op, id); this.send(message);
    this.renderKey = ''; this.render();
    return read;
  }

  rememberRead(read) {
    this.reads.set(read.id, read);
    while (this.reads.size > MAX_READS) {
      const oldest = this.reads.keys().next().value;
      this.reads.delete(oldest);
      for (const [kind, id] of this.readByKind) if (id === oldest) this.readByKind.delete(kind);
    }
  }

  requestQuote() {
    if (!this.active || this.view !== 'market' || !this.town || !this.selected) return;
    const signature = JSON.stringify([this.town, this.selected, this.qty, this.side]);
    if (this.quote?.signature === signature || this.quoteErrorSignature === signature) return;
    const currentId = this.readByKind.get('quote'), previous = this.reads.get(currentId);
    if (previous?.meta.signature === signature && previous.panelToken === this.panelToken) return;
    const id = opId(), message = { type: 'commerce', op: 'quote', town: this.town, g: this.selected, n: this.qty, side: this.side, opId: id };
    const read = { id, op: 'quote', message, meta: { signature, town: this.town, g: this.selected, n: this.qty, side: this.side }, panelToken: this.panelToken, sentAt: performance.now() };
    this.rememberRead(read); this.readByKind.set('quote', id); this.send(message);
  }

  onResult(ev) {
    if (!ev || ev.type !== 'commerce' || typeof ev.opId !== 'string') return;
    const read = this.reads.get(ev.opId);
    if (read) {
      if (ev.op !== read.op) return;
      this.reads.delete(ev.opId);
      if (this.readByKind.get(read.op) !== ev.opId) return;
      if (this.readByKind.get(read.op) === ev.opId) this.readByKind.delete(read.op);
      if (!read.meta || read.panelToken !== this.panelToken || !this.active) return;
      if (!ev.ok) {
        this.setResult(`systems.commerce.reason.${REASONS[ev.why] ? ev.why : 'unknown'}`);
        if (read.op === 'quote') this.quoteErrorSignature = read.meta.signature;
        this.render(); return;
      }
      if (read.op === 'list') {
        if (ev.town !== read.meta.town) return;
        if (!Array.isArray(ev.rows) || !ev.pack || !Number.isSafeInteger(ev.gold)) return;
        this.market = ev; this.rows = ev.rows;
        if (!this.rows.some((r) => r.g === this.selected)) this.selected = this.rows[0]?.g || '';
        this.clearResult();
        this.render(); this.requestQuote(); return;
      }
      if (read.op === 'cargo') {
        if (ev.id !== read.meta.raftId || !ev.hold || !ev.pack || !Number.isSafeInteger(ev.raftRev)
          || !Array.isArray(ev.production) || !Number.isSafeInteger(ev.daySec) || !Number.isSafeInteger(ev.rev)
          || !['', 'saveSize', 'revisionLimit', 'capacity'].includes(ev.productionBlocked)) return;
        this.cargoSnapshot = ev;
        this.rememberProductionStatus(ev.id, ev.daySec, ev.rev, ev.raftRev, ev.productionBlocked, ev.production);
        this.clearResult(); this.render(); return;
      }
      if (read.op === 'quote') {
        const now = JSON.stringify([this.town, this.selected, this.qty, this.side]);
        if (read.meta.signature !== now || ev.town !== read.meta.town || ev.g !== read.meta.g
          || ev.n !== read.meta.n || ev.side !== read.meta.side || !Number.isSafeInteger(ev.total)
          || !Number.isFinite(ev.avg) || ev.avg < 0 || typeof ev.law !== 'string') return;
        this.quote = { ...ev, signature: read.meta.signature }; this.quoteErrorSignature = ''; this.clearResult(); this.render(); return;
      }
      return;
    }

    const pending = this.pending;
    if (!pending || ev.opId !== pending.id || ev.op !== pending.op) return;
    if (ev.ok === false || ev.why) {
      this.pending = null; this.setResult(`systems.commerce.reason.${REASONS[ev.why] ? ev.why : 'unknown'}`);
      if (ev.why === 'price' && pending.op !== 'transfer' && this.active && this.view === 'market') {
        this.quote = null; this.quoteErrorSignature = ''; this.requestQuote();
      }
      this.render(); return;
    }
    if (!Number.isSafeInteger(ev.rev) || ev.rev < 0) return;
    if (pending.op === 'transfer' && !Number.isSafeInteger(ev.raftRev)) return;
    pending.ack = true; pending.resultRev = ev.rev;
    pending.raftRev = pending.op === 'transfer' ? ev.raftRev : null;
    this.setResult(pending.op === 'transfer' ? 'systems.commerce.status.transferAccepted' : 'systems.commerce.status.operationAccepted');
    this.render();
  }

  profileReady(pending, profile) {
    const eco = profile?.eco;
    if (!pending.ack || !eco || !Number.isSafeInteger(eco.tradeRev) || eco.tradeRev < pending.resultRev) return false;
    if (pending.op !== 'transfer') return true;
    const ship = eco.ships?.find((s) => s.kind === 'raft' && s.id === pending.raftId);
    return !!ship && Number.isSafeInteger(ship.rev) && ship.rev >= pending.raftRev;
  }

  update() {
    const near = !!this.context() && (!this.enabled || this.enabled());
    this.launcher.hidden = this.active || !near;
    const profile = this.profile?.();
    if (this.pending && this.profileReady(this.pending, profile)) {
      const pending = this.pending; this.pending = null; this.setResult(pending.op === 'transfer' ? 'systems.commerce.status.transferConfirmed' : 'systems.commerce.status.tradeConfirmed');
      if (this.active) {
        if (this.view === 'cargo') this.fetchCargo();
        else if (this.view === 'market') this.refreshMarket();
        else this.fetchCargo();
      }
    }
    if (this.active) {
      if (this.enabled && !this.enabled()) { this.close(); return; }
      if (['cargo', 'production'].includes(this.view) && !this.context()) { this.close(); return; }
      for (const [kind, id] of this.readByKind) {
        const read = this.reads.get(id);
        if (read && performance.now() - read.sentAt > 6000) read.timedOut = true;
      }
      if (this.pending && !this.pending.timedOut && performance.now() - this.pending.sentAt >= 5000) {
        this.pending.timedOut = true;
        this.renderKey = '';
      }
      this.requestQuote();
      const key = this.signature(); if (key !== this.renderKey) this.render();
    }
  }

  fetchCargo() {
    const c = this.context(); if (!c) return;
    this.cargoSnapshot = null;
    this.request('cargo', { id: c.record.id }, { raftId: c.record.id, rev: c.ship.rev });
  }

  refreshMarket() { if (this.town) { this.quote = null; this.quoteErrorSignature = ''; this.request('list', { town: this.town }, { town: this.town }); } }

  confirm() {
    if (!this.active || this.pending || this.view === 'production') return;
    if (this.view === 'cargo') this.confirmTransfer(); else this.confirmTrade();
  }

  confirmTransfer() {
    const c = this.context(), row = this.selectedCargoRow();
    if (!c || !row || c.record.rev !== c.ship.rev) { this.setResult('systems.commerce.status.sync'); this.render(); return; }
    const from = this.cargoSide === 'deposit' ? c.profile.eco.pack : c.ship.hold;
    const to = this.cargoSide === 'deposit' ? c.ship.hold : c.profile.eco.pack;
    const n = this.transferMax(this.selected, from, to);
    if (n < 1) { this.setResult('systems.commerce.status.noRoom'); this.render(); return; }
    const id = opId(), message = { type: 'commerce', op: 'transfer', id: c.record.id, expectedRev: c.record.rev,
      g: this.selected, n: this.transferQty === 'max' ? n : Math.min(n, clampQty(this.transferQty)), side: this.cargoSide, opId: id };
    this.beginMutation(id, 'transfer', message, { raftId: c.record.id, expectedRev: c.record.rev });
  }

  confirmTrade() {
    const q = this.quote, signature = JSON.stringify([this.town, this.selected, this.qty, this.side]);
    if (!q || q.signature !== signature || !Number.isSafeInteger(q.total) || !this.market) return;
    const id = opId(), message = { type: 'commerce', op: this.side, town: this.town, g: this.selected, n: this.qty, expectedTotal: q.total, opId: id };
    this.beginMutation(id, this.side, message, { town: this.town, g: this.selected, n: this.qty, side: this.side });
  }

  beginMutation(id, op, message, meta) {
    this.pending = { id, op, message, ...meta, sentAt: performance.now(), ack: false };
    this.setResult('systems.commerce.status.sending'); this.send(message); this.render();
  }

  retryPending() {
    if (!this.pending?.message || !this.pending.timedOut) return;
    this.pending.sentAt = performance.now(); this.pending.timedOut = false; this.send(this.pending.message); this.setResult('systems.commerce.status.resent'); this.render();
  }

  onBodyClick(event) {
    const target = event.target.closest('[data-good],[data-side],[data-qty],[data-read-retry]');
    if (!target) return;
    if (target.dataset.good) {
      const g = target.dataset.good;
      if (this.view === 'cargo') { this.selected = g; this.quote = null; }
      else { this.selected = g; this.quote = null; this.quoteErrorSignature = ''; this.qty = 1; this.requestQuote(); }
      this.clearResult(); this.render();
    } else if (target.dataset.side) {
      this.side = target.dataset.side; this.quote = null; this.quoteErrorSignature = ''; this.requestQuote(); this.render();
    } else if (target.dataset.qty) {
      const q = target.dataset.qty;
      if (this.view === 'cargo') this.transferQty = q === 'max' ? 'max' : clampQty(q);
      else { this.qty = q === 'max' ? this.marketMax() : clampQty(q); this.quote = null; this.requestQuote(); }
      this.render();
    } else if (target.dataset.readRetry) {
      const read = this.reads.get(target.dataset.readRetry); if (read) { read.sentAt = performance.now(); read.timedOut = false; this.send(read.message); this.render(); }
    }
  }

  onBodyChange(event) {
    const select = event.target.closest('[data-cargo-side]');
    if (select) { this.cargoSide = select.value; this.transferQty = 1; this.clearResult(); this.render(); }
    const side = event.target.closest('[data-market-side]');
    if (side) { this.side = side.value; this.quote = null; this.quoteErrorSignature = ''; this.requestQuote(); this.render(); }
  }

  onBodyInput(event) {
    const amount = event.target.closest('[data-amount]'); if (!amount) return;
    const max = this.view === 'cargo' ? this.currentTransferMax() : this.marketMax();
    const n = Math.max(1, Math.min(max || MAX_QTY, clampQty(amount.value)));
    amount.value = String(n);
    if (this.view === 'cargo') this.transferQty = n;
    else { this.qty = n; this.quote = null; this.quoteErrorSignature = ''; this.requestQuote(); }
    this.renderKey = '';
  }

  selectedCargoRow() { return this.cargoRows().find((r) => r.g === this.selected) || null; }

  cargoState() {
    const c = this.context(), p = c?.profile, hold = c?.ship?.hold, pack = p?.eco?.pack;
    const snapshot = this.cargoSnapshot || {};
    return {
      hold: hold || snapshot.hold || { cap: 0, goods: {} },
      pack: pack || snapshot.pack || { cap: 0, goods: {} },
      profile: p, ship: c?.ship, record: c?.record,
    };
  }

  confirmedCapacity(c) {
    if (!c) return null;
    if (c.record.rev !== c.ship.rev) return null;
    const tradeRev = c.profile?.eco?.tradeRev;
    const matches = (value) => value && value.id === c.record.id && value.raftRev === c.ship.rev
      && value.tradeRev === tradeRev && ['port', 'sailing', 'reboard'].includes(value.mode)
      && ['dryMass', 'holdMass', 'packMass', 'cargoMass', 'totalMass', 'buoyancy', 'structuralLimit', 'safeDisplacement', 'totalLimit',
        'crewMass', 'crewCount', 'guestMass', 'cargoMax', 'freeMass', 'overMass', 'load', 'holdVolume', 'holdFree', 'holdCap', 'packVolume', 'packFree', 'packCap']
        .every((key) => Number.isFinite(value[key]) && value[key] >= 0)
      && ['ready', 'heavy', 'overloaded'].includes(value.status);
    const streamed = this.capacity?.();
    if (matches(streamed)) return streamed;
    const privateCapacity = this.cargoSnapshot?.capacity;
    return matches(privateCapacity) ? privateCapacity : null;
  }

  cargoRows() {
    const { hold, pack } = this.cargoState();
    const ids = [...new Set([...Object.keys(hold.goods || {}), ...Object.keys(pack.goods || {})])];
    return ids.map((g) => ({ g, hold: hold.goods?.[g] || 0, pack: pack.goods?.[g] || 0 })).filter((r) => GOODS[r.g]);
  }

  transferMax(g, from, to) {
    let max = Math.max(0, Math.min(from?.goods?.[g] || 0, roomFor(to || { cap: 0, goods: {} }, g), MAX_QTY));
    if (this.cargoSide === 'deposit') {
      const c = this.context();
      if (c?.record?.parts && to) {
        const freeMass = raftCapacity(c.record.parts, to).freeMass;
        max = Math.min(max, Math.max(0, Math.floor((freeMass + 1e-8) / goodMass(g))));
      }
    }
    return max;
  }
  currentTransferMax() {
    const c = this.context(), g = this.selected; if (!c || !g) return 0;
    return this.cargoSide === 'deposit' ? this.transferMax(g, c.profile.eco.pack, c.ship.hold) : this.transferMax(g, c.ship.hold, c.profile.eco.pack);
  }

  marketMax() {
    const row = this.rows.find((r) => r.g === this.selected); if (!row) return 1;
    const p = this.profile?.()?.eco?.pack || { cap: 0, goods: {} };
    if (this.side === 'buy') return Math.max(0, Math.min(MAX_QTY, Math.floor(Math.max(0, +row.stock || 0)), roomFor(p, this.selected)));
    return Math.max(0, Math.min(MAX_QTY, p.goods?.[this.selected] || 0));
  }

  render() {
    if (!this.root || this.root.hidden && !this.active) return;
    const c = this.context(), cargo = this.cargoState(), pending = this.pending;
    this.root.classList.toggle('is-cargo', this.view === 'cargo');
    this.root.classList.toggle('is-market', this.view === 'market');
    this.root.classList.toggle('is-production', this.view === 'production');
    this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === this.view));
    this.$('[data-view="production"]').hidden = !c;
    this.$('.commerce-title').textContent = this.view === 'cargo' ? t('systems.commerce.title.cargo') : `${t('systems.commerce.tabs.market')} · ${translateData(TOWNS[this.town]?.name || this.town)}`;
    if (this.view === 'production') this.$('.commerce-title').textContent = t('systems.commerce.title.production');
    this.$('.commerce-body').innerHTML = this.view === 'cargo' ? this.cargoHtml(cargo)
      : this.view === 'market' ? this.marketHtml() : this.productionHtml();
    this.$('.commerce-feedback').textContent = this.statusText();
    this.$('.commerce-footnote').textContent = this.view === 'cargo'
      ? t('systems.commerce.footnote.cargo')
      : this.view === 'market' ? t('systems.commerce.footnote.market') : t('systems.commerce.footnote.production');
    const confirm = this.$('.commerce-confirm');
    confirm.textContent = this.view === 'cargo' ? t('systems.commerce.confirm.transfer') : this.side === 'buy' ? t('systems.commerce.confirm.buy') : t('systems.commerce.confirm.sell');
    confirm.hidden = this.view === 'production' || !!this.pending?.ack;
    this.$('.commerce-foot').hidden = this.view === 'production';
    confirm.disabled = this.view === 'production' || !!pending || (this.view === 'cargo' ? !c || !this.cargoSnapshot || this.cargoSnapshot.id !== c.record.id
      || this.cargoSnapshot.raftRev !== c.ship.rev || !this.selectedCargoRow() || !this.currentTransferMax() || c.record.rev !== c.ship.rev
      : !this.quote || this.quote.signature !== JSON.stringify([this.town, this.selected, this.qty, this.side]) || !Number.isSafeInteger(this.quote.total)
        || !this.profile?.()?.eco?.pack || this.side === 'buy' && (this.quote.total > (this.profile?.()?.gold || 0) || this.qty > roomFor(this.profile?.()?.eco?.pack || { cap: 0, goods: {} }, this.selected))
        || this.side === 'sell' && this.qty > (this.profile?.()?.eco?.pack?.goods?.[this.selected] || 0));
    this.renderRetry();
    this.renderKey = this.signature();
  }

  cargoHtml(cargo) {
    const { hold, pack, ship } = cargo, rows = this.cargoRows();
    const selected = this.selectedCargoRow();
    const stats = this.cargoSnapshot?.stats || (ship?.grid ? raftStats(ship.grid, ship.hold) : null);
    const capacity = this.confirmedCapacity(this.context());
    const options = rows.map((r) => `<button type="button" class="commerce-good${r.g === this.selected ? ' on' : ''}" data-good="${esc(r.g)}"><i class="good-mark cat-${esc(GOODS[r.g].cat)}">${CAT_MARK[GOODS[r.g].cat] || '•'}</i><span><b>${esc(goodName(r.g))}</b><small>${t('systems.commerce.cargo.goodStock', { hold: num(r.hold), pack: num(r.pack), mass: num(goodMass(r.g)), volume: num(goodVolume(r.g)) })}</small></span></button>`).join('');
    const from = this.cargoSide === 'deposit' ? pack : hold, to = this.cargoSide === 'deposit' ? hold : pack;
    const max = selected ? this.transferMax(selected.g, from, to) : 0;
    const amount = this.transferQty === 'max' ? max : Math.min(max, clampQty(this.transferQty || 1));
    const transferMass = selected ? amount * goodMass(selected.g) : 0;
    const transferVolume = selected ? amount * goodVolume(selected.g) : 0;
    const holdVolume = capacity?.holdVolume ?? holdUsed(hold), holdCap = capacity?.holdCap ?? hold.cap ?? 0;
    const packVolume = capacity?.packVolume ?? holdUsed(pack), packCap = capacity?.packCap ?? pack.cap ?? 0;
    const nextHold = this.cargoSide === 'deposit' ? holdVolume + transferVolume : Math.max(0, holdVolume - transferVolume);
    const nextPack = this.cargoSide === 'deposit' ? Math.max(0, packVolume - transferVolume) : packVolume + transferVolume;
    const capacityMode = capacity ? t(`systems.commerce.capacity.mode.${capacity.mode}`) : '';
    const capacityStatus = capacity ? t(`systems.commerce.capacity.status.${capacity.status}`) : '';
    const heavyPct = num(RAFT_LOAD.heavyFraction * 100);
    const capacityHtml = capacity ? `<section class="cargo-capacity is-${capacity.status}" aria-label="${t('systems.commerce.capacity.confirmed')}"><header><b>${t('systems.commerce.capacity.title', { status: capacityStatus })}</b><small>${capacityMode} · ${t('systems.commerce.capacity.massSpace')}</small></header><div class="cargo-meter"><label><span>${t('systems.commerce.capacity.totalLimit')}</span><b>${num(capacity.totalMass)} / ${num(capacity.totalLimit)} uM${capacity.overMass > 0 ? ` · ${t('systems.commerce.capacity.excess', { value: num(capacity.overMass) })}` : ` · ${t('systems.commerce.capacity.free', { value: num(capacity.freeMass) })}`}</b></label><progress aria-label="${t('systems.commerce.capacity.totalMassLabel')}" max="${Math.max(1, capacity.totalLimit)}" value="${Math.min(capacity.totalLimit, capacity.totalMass)}"></progress></div><div class="cargo-meter"><label><span>${t('systems.commerce.capacity.holdSpace')}</span><b>${num(capacity.holdVolume)} / ${num(capacity.holdCap)} uV · ${t('systems.commerce.capacity.free', { value: num(capacity.holdFree) })}</b></label><progress aria-label="${t('systems.commerce.capacity.holdSpaceLabel')}" max="${Math.max(1, capacity.holdCap)}" value="${Math.min(capacity.holdCap, capacity.holdVolume)}"></progress></div><small class="cargo-mass-breakdown">${t('systems.commerce.capacity.structure', { dry: num(capacity.dryMass), crew: num(capacity.crewMass), crewCount: num(capacity.crewCount), guests: num(capacity.guestMass) })}</small><small class="cargo-mass-breakdown">${t('systems.commerce.capacity.cargo', { cargo: num(capacity.cargoMass), hold: num(capacity.holdMass), packs: num(capacity.packMass) })}</small><small class="cargo-mass-breakdown">${t('systems.commerce.capacity.safeDisplacement', { safe: num(capacity.safeDisplacement), structural: num(capacity.structuralLimit), heavyPct })}</small>${capacity.status === 'overloaded' ? `<small class="cargo-capacity-warning">${t('systems.commerce.capacity.overloadedHint')}</small>` : ''}</section>`
      : `<section class="cargo-capacity is-waiting" aria-live="polite"><b>${t('systems.commerce.capacity.updating')}</b><small>${t('systems.commerce.capacity.waiting')}</small></section>`;
    const transferForecast = capacity && selected
      ? t('systems.commerce.cargo.forecast', { hold: num(nextHold), holdCap: num(holdCap), pack: num(nextPack), packCap: num(packCap), mass: num(capacity.cargoMass) })
      : '';
    return `${capacityHtml}
      <div class="cargo-stats">${stats ? `<span>${t('systems.commerce.cargo.bases', { count: num(stats.cells) })}</span><span>${t('systems.commerce.cargo.buoyancy', { count: num(stats.buoyancy) })}</span>` : `<span>${t('systems.commerce.cargo.statsUnavailable')}</span>`}</div>
      <div class="commerce-good-list">${options || `<p class="commerce-empty">${t('systems.commerce.cargo.empty')}</p>`}</div>
      <div class="cargo-transfer"><label>${t('systems.commerce.cargo.direction')}<select data-cargo-side><option value="deposit" ${this.cargoSide !== 'withdraw' ? 'selected' : ''}>${t('systems.commerce.cargo.packToHold')}</option><option value="withdraw" ${this.cargoSide === 'withdraw' ? 'selected' : ''}>${t('systems.commerce.cargo.holdToPack')}</option></select></label>
      <div class="commerce-qty">${[1,5,10].map((n) => `<button type="button" data-qty="${n}" class="${this.transferQty === n ? 'on' : ''}" ${max < n ? 'disabled' : ''}>${n}</button>`).join('')}<button type="button" data-qty="max" class="${this.transferQty === 'max' ? 'on' : ''}" ${max < 1 ? 'disabled' : ''}>${t('systems.commerce.max')}</button>
      <input type="number" min="1" max="${max}" value="${amount}" data-amount aria-label="${t('systems.commerce.cargo.transferQuantity')}" ${max < 1 ? 'disabled' : ''}></div>
      <p class="commerce-transfer-note">${selected ? t('systems.commerce.cargo.movePreview', { amount: num(amount), good: esc(goodName(selected.g)), mass: num(transferMass), volume: num(transferVolume), forecast: transferForecast }) : t('systems.commerce.cargo.selectGood')}</p></div>`;
  }

  marketHtml() {
    const pack = this.market?.pack?.goods || this.profile?.()?.eco?.pack?.goods || {};
    const packCap = this.market?.pack?.cap ?? this.profile?.()?.eco?.pack?.cap ?? 0;
    const used = this.market?.used ?? holdUsed(this.profile?.()?.eco?.pack || { cap: 0, goods: {} });
    const rows = this.rows.map((r) => {
      const good = GOODS[r.g]; if (!good) return '';
      const trend = r.trend > 0 ? t('systems.commerce.market.rising') : r.trend < 0 ? t('systems.commerce.market.falling') : t('systems.commerce.market.steady');
      return `<button type="button" data-good="${esc(r.g)}" class="market-row${r.g === this.selected ? ' on' : ''}"><i class="good-mark cat-${esc(good.cat)}">${CAT_MARK[good.cat] || '•'}</i><span class="market-name"><b>${esc(goodName(r.g))}</b><small>${esc(translateData(GOOD_CATS[good.cat] || good.cat))}${r.illegal ? ` · ${t('systems.commerce.market.smuggled')}` : ''}</small></span><span class="market-stock">${num(r.stock)}<small>${t('systems.commerce.market.stock')}</small></span><span class="market-prices"><b>${t('systems.commerce.market.buy')} ${num(r.buy)}</b><b>${t('systems.commerce.market.sell')} ${num(r.sell)}</b><small>${trend}</small></span></button>`;
    }).join('');
    const row = this.rows.find((r) => r.g === this.selected), q = this.quote;
    const max = this.marketMax(), gold = this.market?.gold ?? this.profile?.()?.gold ?? 0;
    return `<div class="market-wallet"><b>${t('systems.commerce.market.gold', { amount: num(gold) })}</b><span>${t('systems.commerce.market.backpackSpace', { used: num(used), cap: num(packCap) })}</span></div>
      <div class="market-list">${rows || `<p class="commerce-empty">${t('systems.commerce.market.empty')}</p>`}</div>
      <div class="market-order"><div class="market-selected"><span class="good-mark cat-${esc(GOODS[this.selected]?.cat || 'material')}">${CAT_MARK[GOODS[this.selected]?.cat] || '•'}</span><b>${esc(goodName(this.selected))}</b><small>${row?.illegal ? t('systems.commerce.market.illegalHere') : t('systems.commerce.market.dynamicPrice')}</small></div>
      <label>${t('systems.commerce.market.operation')}<select data-market-side><option value="buy" ${this.side === 'buy' ? 'selected' : ''}>${t('systems.commerce.market.buyAction')}</option><option value="sell" ${this.side === 'sell' ? 'selected' : ''}>${t('systems.commerce.market.sellAction')}</option></select></label>
      <div class="commerce-qty">${[1,5,10].map((n) => `<button type="button" data-qty="${n}" class="${this.qty === n ? 'on' : ''}" ${max < n ? 'disabled' : ''}>${n}</button>`).join('')}<button type="button" data-qty="max" class="${this.qty === max ? 'on' : ''}" ${max < 1 ? 'disabled' : ''}>${t('systems.commerce.max')}</button><input type="number" min="1" max="${max}" value="${this.qty}" data-amount aria-label="${t('systems.commerce.market.quantity')}" ${max < 1 ? 'disabled' : ''}></div>
      <div class="market-quote"><span>${t('systems.commerce.market.quotedTotal')}</span><b>${q?.signature === JSON.stringify([this.town, this.selected, this.qty, this.side]) ? t('systems.commerce.market.gold', { amount: num(q.total) }) : t('systems.commerce.market.requesting')}</b>${q?.avg ? `<small>${t('systems.commerce.market.average', { amount: num(q.avg) })}</small>` : ''}</div>
      <small class="market-hold">${t('systems.commerce.market.inBackpack', { amount: num(pack[this.selected] || 0), mass: num(goodMass(this.selected)), volume: num(goodVolume(this.selected)) })}</small></div>`;
  }

  productionData() {
    const c = this.context();
    if (!c?.ship?.grid || !c.ship.hold) return { rows: [], daySec: null, blocked: '' };
    const status = this.productionStatus?.id === c.record.id ? this.productionStatus : null;
    const snapshot = this.cargoSnapshot?.id === c.record.id ? this.cargoSnapshot : null;
    const source = status || (snapshot && {
      rev: snapshot.rev, raftRev: snapshot.raftRev, daySec: snapshot.daySec,
      blocked: snapshot.productionBlocked, rows: snapshot.production,
    });
    const blocked = source?.blocked || '';
    const profileIsCurrent = !source || Number.isSafeInteger(c.profile?.eco?.tradeRev)
      && c.profile.eco.tradeRev >= source.rev && Number.isSafeInteger(c.ship.rev) && c.ship.rev >= source.raftRev;
    return {
      rows: profileIsCurrent || !Array.isArray(source?.rows) ? productionRows(c.ship.grid, c.ship.hold, { blocked, poweredKeys: this.fireEnabled?.() ? new Set((c.record.litLanterns || []).map(part => JSON.stringify(part))) : null }) : source.rows,
      daySec: source?.daySec ?? null,
      blocked,
      hold: c.ship.hold,
      profileIsCurrent,
    };
  }

  productionHtml() {
    const { rows, hold, daySec, profileIsCurrent } = this.productionData();
    const secondsPerDay = Number.isSafeInteger(daySec) && daySec > 0 ? daySec : 960;
    if (!rows.length) return `<div class="production-empty"><b>${t('systems.commerce.production.emptyTitle')}</b><p>${t('systems.commerce.production.emptyHint')}</p><small>${t('systems.commerce.production.offline')}</small></div>`;
    const cards = rows.map((row) => {
      const progress = Math.max(0, Math.min(0.999999, Number(row.progress) || 0));
      const pct = Math.floor(progress * 100);
      const nextSeconds = row.remainingDays === null ? null : Math.ceil(row.remainingDays * secondsPerDay);
      const statusText = row.status === 'working' ? t('systems.commerce.production.working')
        : row.status === 'inputs' ? (profileIsCurrent ? t('systems.commerce.production.missingInputs', { goods: Object.entries(row.inputs || {}).filter(([g, n]) => n > (hold?.goods?.[g] || 0)).map(([g, n]) => `${num(n - (hold?.goods?.[g] || 0))} ${goodName(g)}`).join(', ') }) : t('systems.commerce.production.waitingInputs'))
        : row.status === 'fuel' ? t('systems.commerce.production.fuel')
        : row.status === 'room' ? t('systems.commerce.production.fullHold')
        : row.status === 'capacity' ? t('systems.commerce.production.capacity')
        : row.status === 'saveSize' ? t('systems.commerce.production.saveSize')
        : row.status === 'revisionLimit' ? t('systems.commerce.production.revisionLimit') : t('systems.commerce.production.stopped');
      return `<article class="production-card" data-production-key="${esc(row.key)}">
        <header><span class="production-part">${esc(translateData(row.name))}</span><b>${esc(statusText)}</b></header>
        <div class="production-recipe"><span>${t('systems.commerce.production.perBatch')}</span><b>${esc(formatRecipe(row.inputs))} <i>→</i> ${esc(formatRecipe(row.outputs))}</b></div>
        <div class="production-rate"><span>${t('systems.commerce.production.rate')}</span><b>${t('systems.commerce.production.rateValue', { rate: num(row.rate), seconds: num(Math.round(secondsPerDay / row.rate)) })}</b></div>
        <div class="production-progress"><div><span>${t('systems.commerce.production.progress')}</span><b>${pct}%</b></div><progress max="1" value="${progress}" aria-label="${t('systems.commerce.production.progressLabel')}"></progress></div>
        <small class="production-next">${nextSeconds === null ? t('systems.commerce.production.nextStopped') : t('systems.commerce.production.next', { seconds: num(nextSeconds) })}</small>
      </article>`;
    }).join('');
    return `<div class="production-intro"><b>${t('systems.commerce.production.title')}</b><span>${t('systems.commerce.production.online')}</span></div><div class="production-list">${cards}</div>`;
  }

  statusText() {
    if (this.pending) {
      if (this.pending.timedOut) return `${this.lastResult || t('systems.commerce.status.noResponse')} ${t('systems.commerce.status.canResend')}`;
      return this.lastResult || t('systems.commerce.status.waitingServer');
    }
    const readKind = this.view === 'cargo' || this.view === 'production' ? 'cargo' : this.market ? 'quote' : 'list';
    const read = this.reads.get(this.readByKind.get(readKind));
    if (read?.timedOut) return `${this.lastResult || t('systems.commerce.status.serverNoResponse')} ${t('systems.commerce.status.canRetryRead')}`;
    return this.lastResult || (this.view === 'cargo' ? t('systems.commerce.status.privateHold')
      : this.view === 'production' ? t('systems.commerce.status.connectedProduction')
        : t('systems.commerce.status.quoteBeforeConfirm'));
  }

  renderRetry() {
    const timedOut = !!this.pending?.timedOut;
    const readId = this.readByKind.get(this.view === 'cargo' || this.view === 'production' ? 'cargo' : this.market ? 'quote' : 'list');
    const read = this.reads.get(readId), readTimedOut = !!read?.timedOut;
    let button = this.root.querySelector('.commerce-retry');
    if (!button) { button = document.createElement('button'); button.className = 'commerce-retry'; button.type = 'button'; this.$('.commerce-feedback').after(button); }
    button.hidden = !timedOut && !readTimedOut;
    button.textContent = timedOut ? t('systems.commerce.retry.operation') : t('systems.commerce.retry.read');
    button.onclick = () => timedOut ? this.retryPending() : read && this.retryRead(read);
  }

  retryRead(read) { read.sentAt = performance.now(); read.timedOut = false; this.send(read.message); this.render(); }

  signature() {
    const c = this.context(), p = this.profile?.();
    const production = this.view === 'production' ? this.productionData() : null;
    const capacity = this.capacity?.();
    return JSON.stringify([this.active, this.view, this.town, this.selected, this.side, this.qty, this.transferQty, this.cargoSide,
      this.rows, this.quote, this.market?.gold, this.market?.pack, p?.gold, p?.eco?.tradeRev, p?.eco?.pack?.goods,
      c?.ship?.rev, c?.ship?.hold?.goods, c?.record?.rev, capacity && [capacity.id, capacity.raftRev, capacity.tradeRev, capacity.mode, capacity.freeMass, capacity.holdFree, capacity.packFree,
        capacity.crewMass, capacity.crewCount, capacity.guestMass, capacity.status],
      this.cargoSnapshot?.capacity && [this.cargoSnapshot.capacity.id, this.cargoSnapshot.capacity.raftRev, this.cargoSnapshot.capacity.tradeRev,
        this.cargoSnapshot.capacity.crewMass, this.cargoSnapshot.capacity.crewCount, this.cargoSnapshot.capacity.guestMass, this.cargoSnapshot.capacity.status],
      this.pending && [this.pending.id, this.pending.ack, this.pending.resultRev, this.pending.sentAt],
      production?.rows, production?.blocked, production?.daySec, production?.profileIsCurrent,
      this.lastResult, [...this.readByKind.entries()].map(([k,id]) => [k,this.reads.get(id)?.timedOut,this.reads.get(id)?.sentAt])]);
  }
}
