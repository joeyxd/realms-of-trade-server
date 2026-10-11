import { FOODS } from '../data/survival.js';

const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;

const COPY = {
  es: {
    title: 'Agua dulce', close: 'Cerrar agua dulce', bucket: 'Cubeta', bucketAbsent: 'Sin cubeta',
    water: 'agua', sourceName: 'Manantial interior', collect: 'Recoger agua', gathering: 'Recogiendo agua',
    map: 'Busca el manantial señalado en el interior de Salty Shore.', noSource: 'No hay una fuente de agua dulce cercana.',
    sourceFar: 'Acércate al manantial para recoger agua.', craft: 'Fabricar cubeta · 2 maderas',
    craftHelp: 'En el constructor, arma un barril con 4 tablas para crear una reserva naval.',
    decant: 'Vaciar en provisiones', decantHelp: 'Vierte el agua de la cubeta en tus provisiones y libera el recipiente.',
    pack: 'Mochila', barrel: 'Barril', emptyLabel: 'Vacío', fullLabel: 'Lleno', broken: 'Roto', distant: 'Acércate al barril.',
    deposit: 'Guardar agua', withdraw: 'Retirar agua', waiting: 'Esperando confirmación…',
    delayed: 'La conexión tarda. El resultado de esta solicitud sigue pendiente; espera la actualización.',
    crafting: 'Cubeta fabricada.', filled: 'Agua recogida.', deposited: 'Agua guardada en el barril.',
    withdrawn: 'Agua retirada del barril.', decanted: 'Agua vertida en provisiones.',
    account_required: 'Inicia sesión para guardar recipientes y agua.', goods: 'Necesitas 2 maderas en la mochila.',
    room: 'No hay espacio suficiente en la mochila o el barril.', far: 'Acércate a la fuente o al barril.',
    source: 'Esa fuente de agua dulce ya no está disponible.', empty: 'No hay agua suficiente en el recipiente.',
    full: 'El recipiente no tiene espacio suficiente.', condition: 'Ese barril está roto.',
    revision: 'El inventario cambió. Espera a que se actualice.', revisionLimit: 'Vuelve a entrar para continuar.',
    owner: 'Ese barril no está disponible en tu balsa.', dead: 'No puedes recoger agua mientras estás derrotado.',
    busy: 'Espera a que termine tu acción actual.', interrupted: 'La recogida se interrumpió.',
    storage: 'No se pudo guardar el agua. Vuelve a conectar.', command: 'La solicitud de agua no se pudo validar.',
    duplicate: 'La solicitud ya se usó para otra acción.', generic: 'No se pudo completar la acción de agua.',
    canteen: 'Cantimplora', canteenCraft: 'Fabricar · 2 lona + 1 madera', canteenNeed: 'Necesitas 2 lonas y 1 madera.',
    canteenFill: 'Llenar del manantial', canteenChannel: 'Llenando en el manantial', canteenDrink: 'Beber 1 dosis',
    canteenBucket: 'Desde la cubeta', canteenProvisions: 'Desde provisiones', canteenBarrel: 'Desde el barril',
    hunger: 'Hambre', thirst: 'Sed', eat: 'Comer', fish: 'Pescado', biscuit: 'Galleta', fruit: 'Fruta', waterGood: 'Agua', rum: 'Ron',
    canteenCrafted: 'Cantimplora fabricada.', canteenFilled: 'Cantimplora rellenada.', drank: 'Has bebido una dosis.', ate: 'Has comido.',
  },
  en: {
    title: 'Fresh water', close: 'Close fresh water', bucket: 'Bucket', bucketAbsent: 'No bucket',
    water: 'water', sourceName: 'Inland spring', collect: 'Collect water', gathering: 'Collecting water',
    map: 'Find the marked spring inland on Salty Shore.', noSource: 'No fresh water source is nearby.',
    sourceFar: 'Move closer to the spring to collect water.', craft: 'Craft bucket · 2 wood',
    craftHelp: 'Build a barrel with 4 planks in the builder to make a naval reserve.',
    decant: 'Pour into provisions', decantHelp: 'Pour bucket water into provisions and free the container.',
    pack: 'Pack', barrel: 'Barrel', emptyLabel: 'Empty', fullLabel: 'Full', broken: 'Broken', distant: 'Move closer to the barrel.',
    deposit: 'Store water', withdraw: 'Withdraw water', waiting: 'Waiting for confirmation…',
    delayed: 'The connection is taking longer. This request is still pending; wait for the update.',
    crafting: 'Bucket crafted.', filled: 'Water collected.', deposited: 'Water stored in the barrel.',
    withdrawn: 'Water withdrawn from the barrel.', decanted: 'Water poured into provisions.',
    account_required: 'Sign in to save containers and water.', goods: 'You need 2 wood in your pack.',
    room: 'There is not enough room in the pack or barrel.', far: 'Move closer to the source or barrel.',
    source: 'That fresh water source is no longer available.', empty: 'There is not enough water in the container.',
    full: 'The container does not have enough room.', condition: 'That barrel is broken.',
    revision: 'The inventory changed. Wait for it to update.', revisionLimit: 'Rejoin to continue.',
    owner: 'That barrel is unavailable on your raft.', dead: 'You cannot collect water while defeated.',
    busy: 'Wait for your current action to finish.', interrupted: 'Collection was interrupted.',
    storage: 'Water could not be saved. Reconnect to continue.', command: 'The water request could not be validated.',
    duplicate: 'This request was already used for another action.', generic: 'The water action could not be completed.',
    canteen: 'Canteen', canteenCraft: 'Craft · 2 canvas + 1 wood', canteenNeed: 'You need 2 canvas and 1 wood.',
    canteenFill: 'Fill at spring', canteenChannel: 'Filling at spring', canteenDrink: 'Drink 1 dose',
    canteenBucket: 'From bucket', canteenProvisions: 'From provisions', canteenBarrel: 'From barrel',
    hunger: 'Hunger', thirst: 'Thirst', eat: 'Eat', fish: 'Fish', biscuit: 'Biscuit', fruit: 'Fruit', waterGood: 'Water', rum: 'Rum',
    canteenCrafted: 'Canteen crafted.', canteenFilled: 'Canteen refilled.', drank: 'You drank one dose.', ate: 'You ate.',
  },
};

const invoke = (fn, fallback) => { try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; } };
const opId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const finite = value => Number.isFinite(value) ? value : 0;

export class FreshwaterPanel {
  constructor({ parent, client = () => null, locale = () => 'es', toast = () => {}, onOpen = () => {}, onClose = () => {}, now = () => performance.now() } = {}) {
    Object.assign(this, { parent, client, localeSource: locale, toast, onOpen, onClose, now });
    this.active = false; this.pending = null; this.owner = null; this.session = null; this.statusKey = ''; this.statusReason = '';
    this.root = null; this.renderKey = '';
    const doc = parent?.ownerDocument || globalThis.document;
    if (!doc?.createElement || !parent?.appendChild) return;
    this.doc = doc;
    this.root = doc.createElement('section'); this.root.className = 'freshwater-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false');
    this.root.innerHTML = `<header class="fresh-head"><div><small class="fresh-kicker"></small><h2 class="fresh-title"></h2></div><button type="button" class="fresh-close"></button></header>
      <section class="fresh-pack"><div><b class="fresh-bucket"></b><span class="fresh-count"></span></div><button type="button" class="fresh-craft"></button></section>
      <section class="fresh-source"><div><b class="fresh-source-name"></b><p class="fresh-map"></p></div><button type="button" class="fresh-collect"></button></section>
      <div class="fresh-barrels"></div><section class="fresh-decant"><div><b class="fresh-decant-label"></b><p class="fresh-decant-help"></p></div><button type="button" class="fresh-decant-button"></button></section>
      <section class="fresh-canteen" hidden><div class="fresh-canteen-head"><div><b class="fresh-canteen-label"></b><span class="fresh-canteen-count"></span></div><button type="button" class="fresh-canteen-craft"></button></div>
        <div class="fresh-canteen-actions"><button type="button" class="fresh-canteen-spring"></button><button type="button" class="fresh-canteen-bucket"></button><button type="button" class="fresh-canteen-provisions"></button><button type="button" class="fresh-canteen-drink"></button></div>
        <div class="fresh-canteen-needs" aria-live="polite"></div><div class="fresh-foods" role="group"></div></section>
      <p class="fresh-note"></p><p class="fresh-status" aria-live="polite"></p>`;
    parent.appendChild(this.root); this.$ = selector => this.root.querySelector(selector);
    this.closeButton = this.$('.fresh-close'); this.craftButton = this.$('.fresh-craft');
    this.collectButton = this.$('.fresh-collect'); this.decantButton = this.$('.fresh-decant-button');
    this.canteenCraftButton = this.$('.fresh-canteen-craft'); this.canteenSpringButton = this.$('.fresh-canteen-spring');
    this.canteenBucketButton = this.$('.fresh-canteen-bucket'); this.canteenProvisionsButton = this.$('.fresh-canteen-provisions');
    this.canteenDrinkButton = this.$('.fresh-canteen-drink'); this.foodsBox = this.$('.fresh-foods');
    this.closeButton.addEventListener('click', () => this.close());
    this.craftButton.addEventListener('click', () => this.craftBucket());
    this.collectButton.addEventListener('click', () => this.fill());
    this.decantButton.addEventListener('click', () => this.decant());
    this.canteenCraftButton.addEventListener('click', () => this.craftCanteen());
    this.canteenSpringButton.addEventListener('click', () => this.fillCanteenAtSpring());
    this.canteenBucketButton.addEventListener('click', () => this.refillCanteen('bucket'));
    this.canteenProvisionsButton.addEventListener('click', () => this.refillCanteen('provisions'));
    this.canteenDrinkButton.addEventListener('click', () => this.drink());
    this.foodsBox.addEventListener('click', event => { const button = event.target?.closest?.('[data-food]'); if (button) this.eat(button.dataset.food); });
    this.keyListener = event => {
      if (this.active && (event.code === 'Escape' || event.key === 'Escape')) { event.preventDefault(); event.stopPropagation(); this.close(); }
    };
    this.render();
  }

  lang() { return String(invoke(this.localeSource, 'es')).toLowerCase().startsWith('en') ? 'en' : 'es'; }
  copy() { return COPY[this.lang()]; }
  profile() { return this.client?.()?.profile || null; }
  pack() { return this.profile()?.eco?.pack || null; }
  bucket() { return this.pack()?.vessels?.find(v => v?.kind === 'bucket') || null; }
  canteen() { return this.pack()?.vessels?.find(v => v?.kind === 'canteen') || null; }
  status() { return this.client?.()?.freshwaterStatus || null; }
  canteenEnabled() { return this.status()?.canteenEnabled === true; }
  busy() { const c = this.client?.(), s = this.status(); return s?.busy === true || s?.actionBusy === true || c?.actionBusy === true
    || finite(s?.gathering) > 0 || finite(s?.canteenGathering) > 0; }
  needs() {
    const fresh = this.status()?.needs, saved = this.profile()?.surv;
    const source = fresh && Number.isFinite(fresh.sat) && Number.isFinite(fresh.hyd) ? fresh : saved;
    return source ? { sat: Math.max(0, Math.min(100, finite(source.sat))), hyd: Math.max(0, Math.min(100, finite(source.hyd))) } : null;
  }
  barrels() { return Array.isArray(this.status()?.barrels) ? this.status().barrels.filter(row => row && typeof row.ship === 'string' && typeof row.part === 'string') : []; }
  currentSession() { const c = this.client?.(); return !!(c?.joined && c === this.owner && c.youServer === this.session); }
  open() {
    const c = this.client?.(); if (!this.root || !c?.joined || !c.youServer) return false;
    if (this.owner && (this.owner !== c || this.session !== c.youServer)) this.resetSession();
    this.owner = c; this.session = c.youServer; this.active = true; this.root.hidden = false;
    this.doc?.addEventListener?.('keydown', this.keyListener); invoke(this.onOpen, null);
    this.render(); this.closeButton.focus?.({ preventScroll: true }); return true;
  }
  close() {
    const wasActive = this.active; this.active = false; if (this.root) this.root.hidden = true;
    this.doc?.removeEventListener?.('keydown', this.keyListener); this.render(); if (wasActive) invoke(this.onClose, null);
  }
  toggle() { return this.active ? (this.close(), false) : this.open(); }
  resetSession() { this.pending = null; this.owner = null; this.session = null; this.close(); }
  update() {
    const c = this.client?.();
    if (!c?.joined || c !== this.owner || c.youServer !== this.session) {
      if (this.pending || this.active || this.owner) this.resetSession();
      if (c?.joined && c.youServer) { this.owner = c; this.session = c.youServer; }
    }
    if (this.pending) {
      const elapsed = this.now() - this.pending.sentAt;
      if (!this.pending.retried && elapsed >= RETRY_MS) {
        this.pending.retried = true;
        try { c.send(this.pending.command); } catch { /* Keep the same request uncertain until a final acknowledgement. */ }
      }
      if (!this.pending.expired && elapsed >= TIMEOUT_MS) { this.pending.expired = true; this.setStatus('delayed'); }
    }
    this.render();
  }
  makeCommand(op, { source = '', ship = '', part = '', n = 0 } = {}) {
    const rev = this.profile()?.eco?.tradeRev;
    if (!Number.isSafeInteger(rev) || rev < 0) return null;
    return Object.freeze({ t: 'cmd', type: 'freshwater', op, opId: opId(), expectedRev: rev, source, ship, part, n });
  }
  send(op, data = {}) {
    const c = this.client?.(); if (!this.active || !this.currentSession() || this.pending || this.busy() || !this.status()?.enabled || !c?.send) return false;
    const command = this.makeCommand(op, data); if (!command) return false;
    this.pending = { command, sentAt: this.now(), retried: false, expired: false };
    try { c.send(command); } catch { this.pending = null; this.setStatus('', 'generic'); this.render(); return false; }
    this.setStatus('waiting'); this.render(); return true;
  }
  craftBucket() {
    if (this.bucket() || finite(this.pack()?.goods?.madera) < 2) return false;
    return this.send('craftBucket');
  }
  fill() {
    const source = this.status()?.source, bucket = this.bucket();
    if (!source || typeof source.id !== 'string' || !source.id || !source.near || !bucket) return false;
    const n = Math.min(4 - finite(bucket.water), 4);
    return n > 0 && this.send('fill', { source: source.id, n });
  }
  decant() {
    const bucket = this.bucket(), n = finite(bucket?.water);
    return n > 0 && this.send('decant', { n });
  }
  craftCanteen() {
    const goods = this.pack()?.goods || {};
    if (!this.canteenEnabled() || this.canteen() || finite(goods.lona) < 2 || finite(goods.madera) < 1) return false;
    return this.send('craftCanteen');
  }
  fillCanteenAtSpring() {
    const canteen = this.canteen(), source = this.status()?.source;
    const n = Math.max(0, Math.min(3, Math.floor(finite(canteen ? 3 - canteen.water : 0))));
    if (!this.canteenEnabled() || !source?.near || n < 1) return false;
    return this.send('fillCanteen', { source: 'salty-spring', n });
  }
  refillCanteen(source, ship = '', part = '', available = Infinity) {
    const canteen = this.canteen(), goods = this.pack()?.goods || {};
    const supply = source === 'bucket' ? finite(this.bucket()?.water) : source === 'provisions' ? finite(goods.agua)
      : available === Infinity ? 0 : Math.max(0, finite(available));
    const n = Math.floor(Math.max(0, Math.min(3 - finite(canteen?.water), supply)));
    if (!this.canteenEnabled() || !canteen || n < 1) return false;
    return this.send('refillCanteen', { source, ship, part, n });
  }
  drink() {
    const canteen = this.canteen(), needs = this.needs();
    if (!this.canteenEnabled() || finite(canteen?.water) < 1 || !needs || needs.hyd >= 100) return false;
    return this.send('drink', { source: '', n: 1 });
  }
  eat(good) {
    const needs = this.needs(), food = FOODS[good];
    if (!['pescado', 'galleta', 'fruta', 'agua', 'ron'].includes(good) || !this.canteenEnabled()
      || finite(this.pack()?.goods?.[good]) < 1 || !needs || !food
      || ((food.sat <= 0 || needs.sat >= 100) && (food.hyd <= 0 || needs.hyd >= 100))) return false;
    return this.send('eat', { source: good, n: 1 });
  }
  transfer(op, ship, part, n) { return n > 0 && this.send(op, { ship, part, n }); }
  acknowledge(ev) {
    const pending = this.pending;
    if (!ev || ev.type !== 'freshwater' || !pending || ev.opId !== pending.command.opId) return false;
    if (ev.stage === 'gathering') {
      this.pending.gathering = Math.max(0, Math.min(1, finite(ev.progress)));
      this.render(); return true;
    }
    this.pending = null;
    const c = this.copy();
    if (ev.ok === true) {
      const key = ({ craftBucket: 'crafting', fill: 'filled', deposit: 'deposited', withdraw: 'withdrawn', decant: 'decanted',
        craftCanteen: 'canteenCrafted', fillCanteen: 'canteenFilled', refillCanteen: 'canteenFilled', drink: 'drank', eat: 'ate' })[pending.command.op] || '';
      this.setStatus(key); if (key) invoke(() => this.toast(c[key]), null);
    } else {
      const reason = ev.why || 'generic'; this.setStatus('', reason); invoke(() => this.toast(c[reason] || c.generic), null);
    }
    this.render(); return true;
  }
  setStatus(key, reason = '') {
    this.statusKey = key || ''; this.statusReason = reason || '';
    if (this.root) { const c = this.copy(); this.$('.fresh-status').textContent = this.statusReason ? c[this.statusReason] || c.generic : c[this.statusKey] || ''; }
  }
  renderBarrels() {
    if (!this.root) return;
    const c = this.copy(), rows = this.barrels(), bucket = this.bucket(), water = finite(bucket?.water), pending = !!this.pending;
    const box = this.$('.fresh-barrels');
    const signature = JSON.stringify(rows.map(r => [r.ship, r.part, r.water, r.capacity, !!r.near, !!r.broken, r.name]));
    if (signature !== this.renderKey) {
      this.renderKey = signature;
      box.innerHTML = rows.map((r, i) => `<article class="fresh-barrel" data-row="${i}"><div class="fresh-barrel-title"><b></b><span></span></div><p class="fresh-barrel-state"></p><div class="fresh-barrel-actions"><button type="button" class="fresh-deposit"></button><button type="button" class="fresh-withdraw"></button><button type="button" class="fresh-canteen-refill"></button></div></article>`).join('');
      this.barrelNodes = [...(box.querySelectorAll?.('.fresh-barrel') || [])];
      if (!this.barrelNodes.length && rows.length) this.barrelNodes = rows.map((_, i) => box.querySelector(`[data-row="${i}"]`)).filter(Boolean);
      this.barrelNodes.forEach((node, i) => {
        node.querySelector('.fresh-deposit')?.addEventListener('click', () => { const r = this.barrels()[i]; if (r) this.transfer('deposit', r.ship, r.part, Math.min(finite(this.bucket()?.water), Math.max(0, finite(r.capacity) - finite(r.water)))); });
        node.querySelector('.fresh-withdraw')?.addEventListener('click', () => { const r = this.barrels()[i]; if (r) this.transfer('withdraw', r.ship, r.part, Math.min(4 - finite(this.bucket()?.water), finite(r.water))); });
        node.querySelector('.fresh-canteen-refill')?.addEventListener('click', () => { const r = this.barrels()[i]; if (r) this.refillCanteen('barrel', r.ship, r.part, r.water); });
      });
    }
    this.barrelNodes?.forEach((node, i) => {
      const row = rows[i]; if (!row) return;
      node.querySelector('b').textContent = row.name || `${c.barrel} · ${row.ship}`;
      node.querySelector('span').textContent = `${Math.max(0, finite(row.water))}/${Math.max(0, finite(row.capacity))}`;
      const reason = row.broken ? c.broken : !row.near ? c.distant : row.water <= 0 ? c.emptyLabel : row.water >= row.capacity ? c.fullLabel : '';
      node.querySelector('.fresh-barrel-state').textContent = reason;
      const deposit = node.querySelector('.fresh-deposit'), withdraw = node.querySelector('.fresh-withdraw'), refill = node.querySelector('.fresh-canteen-refill');
      refill.hidden = !this.canteenEnabled();
      deposit.textContent = c.deposit; withdraw.textContent = c.withdraw;
      deposit.disabled = !!(pending || !this.status()?.enabled || !row.near || row.broken || water <= 0 || row.water >= row.capacity);
      withdraw.disabled = !!(pending || !this.status()?.enabled || !this.bucket() || !row.near || row.broken || row.water <= 0 || water >= 4);
      refill.textContent = c.canteenBarrel;
      refill.disabled = !!(pending || this.busy() || !this.canteenEnabled() || !this.canteen() || !row.near || row.broken
        || row.water <= 0 || finite(this.canteen()?.water) >= 3);
    });
  }
  render() {
    if (!this.root) return;
    const c = this.copy(), status = this.status(), bucket = this.bucket(), water = finite(bucket?.water), pending = this.pending;
    this.$('.fresh-kicker').textContent = c.water; this.$('.fresh-title').textContent = c.title;
    this.closeButton.textContent = '×'; this.closeButton.setAttribute('aria-label', c.close);
    this.$('.fresh-bucket').textContent = bucket ? `${c.bucket} · ${water}/4 ${c.water}` : c.bucketAbsent;
    this.$('.fresh-count').textContent = `${c.pack}: ${water} ${c.water}`;
    this.craftButton.textContent = c.craft; this.craftButton.disabled = !!(pending || !status?.enabled || bucket || finite(this.pack()?.goods?.madera) < 2);
    const source = status?.source;
    this.$('.fresh-source-name').textContent = source?.name || c.sourceName;
    this.$('.fresh-map').textContent = source ? `${c.map}${source.near ? '' : ` ${c.sourceFar}`}` : c.map;
    const gathering = pending?.command?.op === 'fill'
      ? Math.max(0, Math.min(1, finite(status?.gathering ?? pending.gathering))) : null;
    this.collectButton.textContent = gathering != null ? `${c.gathering} · ${Math.round(gathering * 100)}%` : c.collect;
    this.collectButton.disabled = !!(pending || !status?.enabled || !bucket || !source?.near || water >= 4);
    this.collectButton.title = source ? (!source.near ? c.sourceFar : water >= 4 ? c.full : '') : c.noSource;
    this.$('.fresh-decant-label').textContent = c.decant; this.$('.fresh-decant-help').textContent = c.decantHelp;
    this.decantButton.textContent = c.decant; this.decantButton.disabled = !!(pending || !status?.enabled || water <= 0);
    const canteenSection = this.$('.fresh-canteen'), canteen = this.canteen(), canteenWater = finite(canteen?.water), newOn = this.canteenEnabled();
    canteenSection.hidden = !newOn;
    if (newOn) {
      const goods = this.pack()?.goods || {}, needs = this.needs(), lock = !!(pending || this.busy() || !status?.enabled);
      this.$('.fresh-canteen-label').textContent = c.canteen;
      this.$('.fresh-canteen-count').textContent = `${canteenWater}/3 ${c.water}`;
      this.canteenCraftButton.textContent = c.canteenCraft;
      this.canteenCraftButton.hidden = !!canteen;
      this.canteenCraftButton.disabled = !!(lock || canteen || finite(goods.lona) < 2 || finite(goods.madera) < 1);
      this.canteenCraftButton.title = canteen ? '' : c.canteenNeed;
      const openRoom = !!canteen && canteenWater < 3;
      const fillPending = pending?.command?.op === 'fillCanteen';
      const rawFillProgress = pending?.gathering ?? status?.canteenGathering;
      const fillProgress = fillPending && Number.isFinite(rawFillProgress) ? Math.max(0, Math.min(1, rawFillProgress)) : null;
      this.canteenSpringButton.textContent = fillPending
        ? `${c.canteenChannel}${fillProgress == null ? '' : ` · ${Math.round(fillProgress * 100)}%`}` : c.canteenFill;
      this.canteenSpringButton.disabled = !!(lock || !openRoom || !source?.near);
      this.canteenSpringButton.title = !source?.near ? c.sourceFar : canteenWater >= 3 ? c.full : '';
      this.canteenBucketButton.textContent = c.canteenBucket;
      this.canteenBucketButton.disabled = !!(lock || !openRoom || finite(this.bucket()?.water) < 1);
      this.canteenProvisionsButton.textContent = c.canteenProvisions;
      this.canteenProvisionsButton.disabled = !!(lock || !openRoom || finite(goods.agua) < 1);
      this.canteenDrinkButton.textContent = c.canteenDrink;
      this.canteenDrinkButton.disabled = !!(lock || canteenWater < 1 || needs?.hyd >= 100);
      const needNode = this.$('.fresh-canteen-needs');
      needNode.textContent = needs ? `${c.hunger} ${Math.ceil(needs.sat)} · ${c.thirst} ${Math.ceil(needs.hyd)}` : '';
      const labels = { pescado: c.fish, galleta: c.biscuit, fruta: c.fruit, agua: c.waterGood, ron: c.rum };
      const availableFoods = Object.entries(labels).filter(([id]) => finite(goods[id]) > 0);
      const foodSignature = JSON.stringify([this.lang(), availableFoods.map(([id]) => [id, Math.floor(finite(goods[id]))])]);
      if (foodSignature !== this.foodSignature) {
        this.foodSignature = foodSignature;
        this.foodsBox.innerHTML = availableFoods.map(([id, label]) => `<button type="button" data-food="${id}">${label} ×${Math.floor(finite(goods[id]))}</button>`).join('');
      }
      this.foodsBox.setAttribute('aria-label', c.eat);
      for (const button of this.foodsBox.querySelectorAll('button')) {
        const food = FOODS[button.dataset.food];
        button.disabled = lock || !needs || !food || ((food.sat <= 0 || needs.sat >= 100) && (food.hyd <= 0 || needs.hyd >= 100));
      }
    }
    this.$('.fresh-note').textContent = c.craftHelp;
    this.renderBarrels();
    this.$('.fresh-status').textContent = this.statusReason ? c[this.statusReason] || c.generic : c[this.statusKey] || '';
    this.root.hidden = !this.active;
  }
}

export function newFreshwaterPanel(options) { return new FreshwaterPanel(options); }
