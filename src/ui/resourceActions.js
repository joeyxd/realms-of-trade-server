// F/touch uses the same intent; only a private acknowledgement confirms gathered/crafted goods.
import { HARVEST, RESOURCE_KINDS } from '../data/resources.js';
import { DT } from '../data/tuning.js';
import { holdUsed, load } from '../sim/economy/cargo.js';

const MAX_GATHERS = 8, RETRY_MS = 5000;
const COPY = {
  es: { collecting: 'Recogiendo', working: 'Trabajando', retry: 'Reintentar', retryAction: 'Reintentar la recogida',
    delayed: 'La conexión está tardando. Puedes reintentar la recogida.', full: 'La mochila está llena. Deposita materiales en tu balsa.' },
  en: { collecting: 'Collecting', working: 'Harvesting', retry: 'Retry', retryAction: 'Retry collection',
    delayed: 'The connection is taking longer. You can retry collection.', full: 'Your backpack is full. Store materials on your raft.' },
};

const REASONS = {
  room: 'La mochila está llena. Deposita materiales en tu balsa.', far: 'Acércate al recurso o al banco.',
  have: 'Necesitas un tronco recogido para preparar madera.', empty: 'Otro pirata ya recogió ese recurso.',
  depleted: 'Ese recurso volverá a estar disponible pronto.', cooldown: 'Espera un momento antes de recoger otra vez.',
  revision: 'El recurso o la mochila cambiaron; inténtalo otra vez.', dead: 'No puedes recoger mientras estás derrotado.',
  busy: 'Detente y termina tu acción antes de recoger.', calm: 'Espera tres segundos en calma.',
  navigation: 'Vuelve a atracar antes de preparar materiales.', aboard: 'Desembarca para recoger materiales.',
  ground: 'Debes estar en tierra junto al recurso.', saveSize: 'La partida supera el límite de guardado.',
  command: 'Solicitud no válida.', duplicate: 'La solicitud ya corresponde a otra acción.',
  revisionLimit: 'La revisión llegó a su límite; vuelve a entrar.',
  full: 'La mochila está llena. Deposita materiales en tu balsa.',
  materials: 'No llevas suficientes troncos para esa cantidad de madera.',
  tool: 'Necesitas la herramienta adecuada para trabajar este recurso.',
  alreadyOwned: 'Ya llevas esa herramienta en el cinturón.',
  combat: 'Espera tres segundos en calma antes de recoger o preparar materiales.',
  land: 'Desembarca y acércate al recurso en tierra.', schema: 'Solicitud no válida.',
  opIdReuse: 'La solicitud ya corresponde a otra acción.',
  receiptLimit: 'No se pudo registrar la solicitud; vuelve a entrar.',
  pack: 'La mochila no está disponible.', node: 'Ese recurso ya no está disponible.',
  bench: 'El banco no está disponible en esta partida.',
};

export class ResourceActions {
  constructor({ client, player, enabled, toast, sound, onGather, onChange, locale = () => 'es', now = () => performance.now() }) {
    Object.assign(this, { client, player, enabled, toast, sound, onGather, onChange, locale, now });
    this.craftPending = null; this.gathers = new Map(); this.predictedHits = new Set(); this.openWorkbench = null; this.gatherUntil = 0;
  }
  get pending() { return this.craftPending || this.gathers.values().next().value || null; }
  get copy() { return COPY[this.locale()] || COPY.es; }
  reset() { this.craftPending = null; this.gathers.clear(); this.predictedHits.clear(); this.gatherUntil = 0; this.onChange?.(); }
  update() {
    const c = this.client();
    if (c !== this.owner || c?.t?.closed) { if (this.pending) this.reset(); this.owner = c; return; }
    let changed = false;
    for (const [id, pending] of this.gathers) {
      const node = c.resources?.nodes?.find((n) => n.id === pending.command.node);
      if (pending.ack && node?.rev >= pending.ack.rev && (!pending.count || c.profile?.eco?.tradeRev >= pending.ack.profileRev)) {
        this.gathers.delete(id); changed = true;
      } else if (!pending.ack && !pending.expired && this.now() - pending.sentAt >= RETRY_MS) {
        // Uncertainty never turns a presentation preview into spendable inventory.
        pending.expired = true; changed = true;
        if (!pending.ack) this.toast(this.copy.delayed);
      }
    }
    if (changed) this.onChange?.();
  }
  backpack() {
    const source = this.client()?.profile?.eco?.pack;
    if (!source) return { pack: null, pendingGoods: {} };
    const pack = { cap: source.cap, goods: { ...source.goods } }, pendingGoods = {};
    for (const pending of this.gathers.values()) {
      if (pending.expired || !pending.count || pending.ack && this.client().profile.eco.tradeRev >= pending.ack.profileRev) continue;
      if (load(pack, pending.good, pending.count)) pendingGoods[pending.good] = (pendingGoods[pending.good] || 0) + pending.count;
    }
    return { pack, pendingGoods };
  }
  renderResources() {
    const snapshot = this.client()?.resources;
    if (!snapshot || !this.gathers.size) return snapshot;
    const hidden = new Set([...this.gathers.values()].filter((p) => !p.expired && !p.def.tool).map((p) => p.command.node));
    return hidden.size ? { ...snapshot, nodes: snapshot.nodes.map((n) => hidden.has(n.id) ? { ...n, collecting: true } : n) } : snapshot;
  }
  predictedHit(event) {
    const key = `${event.node}:${event.rev}`;
    if (!this.predictedHits.has(key)) return false;
    this.predictedHits.delete(key); return true;
  }
  interaction() {
    this.update();
    const c = this.client(), p = this.player();
    if (!this.enabled() || !c?.joined || !p || p.dead || c.naval.active || c.deck.active) return null;
    const bench = c.resources?.bench;
    const nearBench = !c.voyage?.active && bench && Math.abs(p.y - bench.y) <= 1.5
      && Math.hypot(p.x - bench.x, p.z - bench.z) <= HARVEST.benchRadius;
    if (this.craftPending) {
      if (this.openWorkbench) {
        if (!nearBench) return null;
        return { html: '<span class="kbd">F</span> Banco de materiales · preparación pendiente', verb: 'Preparar',
          run: () => this.openWorkbench() };
      }
      const retry = this.now() - this.craftPending.sentAt >= RETRY_MS;
      return { html: retry ? '<span class="kbd">F</span> Reintentar la solicitud' : 'Esperando confirmación…',
        verb: retry ? 'Reintentar' : 'Esperando', run: () => { if (retry) this.send(this.craftPending.command); } };
    }
    const retry = [...this.gathers.values()].find((pending) => pending.expired && !pending.ack && this.now() - pending.sentAt >= RETRY_MS);
    if (retry) return { html: `<span class="kbd">F</span> ${this.copy.retryAction}`, verb: this.copy.retry,
      run: () => this.send(retry.command) };
    const rows = c.resources?.nodes || [];
    let node = null, distance = HARVEST.radius;
    for (const row of rows) {
      if (!RESOURCE_KINDS[row.kind] || Math.abs(p.y - row.y) > 1.5) continue;
      const d = Math.hypot(p.x - row.x, p.z - row.z);
      if (d <= HARVEST.radius && ![...this.gathers.values()].some((pending) => pending.command.node === row.id)
          && (!node || row.ready && !node.ready || row.ready === node.ready && d <= distance)) { node = row; distance = d; }
    }
    if (node) {
      const def = RESOURCE_KINDS[node.kind];
      const elapsed = Number.isFinite(c.resourceTick) ? Math.max(0, (c.serverTick?.() ?? c.resourceTick) - c.resourceTick) * DT : 0;
      if (!node.ready) return { html: `${node.kind === 'palm' ? 'Tocón · la palmera crece' : def.name + ' agotado · vuelve'} en ${Math.ceil(Math.max(0, node.wait - elapsed))} s`, verb: 'Agotado', icon: def.tool === 'pickaxe' ? 'mine' : node.kind === 'palm' ? 'axe' : 'chest', run() {} };
      const pack = this.backpack().pack;
      const space = pack ? ` · mochila ${holdUsed(pack)}/${pack.cap}` : '';
      const cutting = node.kind === 'palm', working = !!def.tool;
      const maxHits = def.hits || HARVEST.palmHits;
      const hit = Math.min(maxHits, (node.hits || 0) + 1);
      const remainingHits = Number.isSafeInteger(node.remaining) ? node.remaining : maxHits - (node.hits || 0);
      const expectedYield = def.yield || def.count || (cutting ? HARVEST.palmYield : 1);
      const toolOwned = !def.tool || c.profile?.tools?.[def.tool] === 1;
      const needsTool = def.tool && !toolOwned;
      const wait = Math.max(0, this.gatherUntil - this.now());
      const icon = def.tool === 'pickaxe' ? 'mine' : cutting ? 'axe' : 'chest';
      if (needsTool) return { html: `${def.name} · necesitas ${def.tool === 'pickaxe' ? 'pico' : 'hacha'} (banco)`,
        verb: def.tool === 'pickaxe' ? 'Minar' : 'Cortar', icon,
        run: () => this.toast(`Necesitas ${def.tool === 'pickaxe' ? 'un pico' : 'un hacha'} para trabajar este recurso.`) };
      if (wait > 0) return { html: `${def.tool === 'pickaxe' ? 'Picando' : cutting ? 'Hachazo' : 'Recogiendo'} · ${(wait / 1000).toFixed(1)} s${working ? ` · ${Math.max(0, remainingHits)}/${maxHits}` : ''}`,
        verb: def.tool === 'pickaxe' ? 'Minar' : cutting ? 'Cortar' : 'Recoger', icon, run() {} };
      const quantityLabel = def.good === 'piedra' ? (expectedYield === 1 ? 'piedra' : 'piedras')
        : def.good === 'mineral_hierro' ? (expectedYield === 1 ? 'mineral de hierro' : 'minerales de hierro')
          : expectedYield === 1 ? 'tronco' : 'troncos';
      const compactProgress = working ? ` · ${hit}/${maxHits} · +${expectedYield} ${quantityLabel}` : '';
      return { html: `<span class="kbd">F</span> ${def.verb}${compactProgress}${space}`, verb: def.tool === 'pickaxe' ? 'Minar' : cutting ? 'Cortar' : 'Recoger', icon,
        run: () => this.send({ t: 'cmd', type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev }) };
    }
    if (this.gathers.size && this.now() < this.gatherUntil) return {
      html: this.copy.collecting, verb: this.copy.collecting, icon: 'chest', run() {},
    };
    if (nearBench) {
      const count = c.profile?.eco?.pack.goods.tronco || 0;
      if (this.openWorkbench) return { html: `<span class="kbd">F</span> Banco de materiales · ${count} ${count === 1 ? 'tronco' : 'troncos'}`,
        verb: 'Preparar', run: () => this.openWorkbench() };
      return { html: `<span class="kbd">F</span> Preparar madera · 1 tronco → 1 madera (${count} ${count === 1 ? 'tronco' : 'troncos'})`, verb: 'Preparar',
        run: () => this.send({ t: 'cmd', type: 'resource', op: 'craft', recipe: 'madera', expectedRev: c.profile?.eco?.tradeRev ?? 0 }) };
    }
    return null;
  }
  send(command) {
    if (!this.enabled()) return false;
    this.update();
    const c = this.client();
    if (!c?.joined || c.t?.closed) return false;
    if (!command.opId) command = { ...command, opId: crypto.randomUUID() };
    const existing = this.gathers.get(command.opId);
    if (existing) {
      if (!existing.expired || existing.ack || this.now() - existing.sentAt < RETRY_MS || JSON.stringify(existing.command) !== JSON.stringify(command)) return false;
      try { c.send(existing.command); } catch { return false; }
      // Retrying the same receipt does not repeat the sound, animation or preview.
      existing.sentAt = this.now(); return true;
    }
    if (command.op !== 'gather') {
      if (this.gathers.size || this.craftPending && this.craftPending.command.opId !== command.opId) return false;
      this.craftPending = { command, sentAt: this.now() };
      try { c.send(command); } catch { this.craftPending = null; return false; }
      return true;
    }
    if (this.craftPending || this.gathers.size >= MAX_GATHERS || this.now() < this.gatherUntil) return false;
    const node = c.resources?.nodes?.find((n) => n.id === command.node), def = RESOURCE_KINDS[node?.kind];
    if (!node?.ready || !def || node.rev !== command.expectedRev || [...this.gathers.values()].some((p) => p.command.node === node.id)) return false;
    if (def.tool && c.profile?.tools?.[def.tool] !== 1) return false;
    const pack = this.backpack().pack, yieldCount = def.yield || 1;
    if (!pack || !load({ cap: pack.cap, goods: { ...pack.goods } }, def.good, yieldCount)) { this.toast(this.copy.full); return false; }
    const count = !def.hits || (node.hits || 0) + 1 >= def.hits ? yieldCount : 0;
    const pending = { command: { ...command }, sentAt: this.now(), def, good: def.good, count };
    this.gathers.set(command.opId, pending);
    try { c.send(command); } catch { this.gathers.delete(command.opId); return false; }
    this.gatherUntil = pending.sentAt + (def.actionTicks || HARVEST.actionTicks) * DT * 1000;
    pending.until = this.gatherUntil;
    const key = `${node.id}:${node.rev + 1}`; this.predictedHits.add(key);
    while (this.predictedHits.size > 32) this.predictedHits.delete(this.predictedHits.values().next().value);
    this.onGather?.({ type: 'resourceHit', e: c.youServer, node: node.id, kind: node.kind, x: node.x, y: node.y, z: node.z,
      rev: node.rev + 1, remaining: def.hits ? Math.max(0, def.hits - (node.hits || 0) - 1) : 0, tool: def.tool });
    if (count) { this.sound?.(); this.toast(`<b>+${count} ${def.good === 'piedra' ? (this.locale() === 'en' ? 'stone' : 'piedra') : def.good === 'mineral_hierro' ? (this.locale() === 'en' ? 'iron ore' : 'mineral de hierro') : (this.locale() === 'en' ? 'log' : 'tronco')}</b>`); }
    this.onChange?.();
    return true;
  }
  onResult(event) {
    const gather = this.gathers.get(event.opId), pending = gather || this.craftPending;
    if (!pending || pending.command.opId !== event.opId || pending.command.op !== event.op) return;
    const node = this.client().resources?.nodes?.find((row) => row.id === pending.command.node);
    if (gather?.ack) return;
    if (gather) {
      if (!event.ok) {
        this.gathers.delete(event.opId); this.predictedHits.delete(`${pending.command.node}:${pending.command.expectedRev + 1}`);
        if (this.gatherUntil === pending.until) this.gatherUntil = 0;
      }
      else {
        gather.ack = event; gather.good = event.good; gather.count = event.count; gather.expired = false;
        // Old servers lack the revision barrier: drop the preview and await their canonical profile.
        if (!Number.isSafeInteger(event.profileRev)) gather.count = 0;
      }
      this.onChange?.(); this.update();
    } else this.craftPending = null;
    if (!event.ok) {
      this.toast(event.why === 'tool'
        ? `Necesitas ${event.tool === 'pickaxe' ? 'un pico' : 'un hacha'} para trabajar este recurso.`
        : event.why === 'full' && node?.kind === 'palm'
        ? `Necesitas espacio para ${HARVEST.palmYield} troncos. Deposita materiales en tu balsa.`
        : REASONS[event.why] || 'No se pudo completar la acción.');
      return;
    }
    if (event.op === 'gather' && event.count === 0) {
      const mining = node?.kind === 'rock' || node?.kind === 'iron_ore';
      this.toast(`<b>¡TAC!</b> · ${event.remaining === 1 ? `Un golpe más para ${mining ? 'romperla' : 'talarla'}.` : mining ? 'La roca empieza a ceder.' : 'La palmera empieza a ceder.'}`);
      return;
    }
    if (gather) return;
    this.sound?.();
    const count = Number.isSafeInteger(event.count) && event.count > 0 ? event.count : 1;
    this.toast(event.op === 'craft' ? (event.tool
      ? `<b>${event.tool === 'axe' ? 'Hacha' : 'Pico'} de piedra fabricado</b> · equipado en tu cinturón de utilidad.`
      : `<b>+${count} madera preparada</b> · úsala en B / Construir.`)
      : `<b>+${count} ${event.good === 'piedra' ? count === 1 ? 'piedra' : 'piedras' : event.good === 'mineral_hierro' ? count === 1 ? 'mineral de hierro' : 'minerales de hierro' : count === 1 ? 'tronco' : 'troncos'}</b> · ${event.good === 'piedra'
        ? 'Material para fabricar herramientas.' : event.good === 'mineral_hierro' ? 'Mineral bruto; requiere fundición.' : 'Llévalo al banco del puerto para preparar madera.'}`);
  }
}
