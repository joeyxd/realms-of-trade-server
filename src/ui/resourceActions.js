// F/touch uses the same intent; only a private acknowledgement confirms gathered/crafted goods.
import { HARVEST, RESOURCE_KINDS } from '../data/resources.js';
import { DT } from '../data/tuning.js';
import { holdUsed, load } from '../sim/economy/cargo.js';
import { loggingStatus } from '../sim/systems/progression.js';
import { validateLoggingChallenge } from '../sim/systems/loggingTiming.js';
import { LoggingTimingPanel } from './loggingTiming.js';
import { t, text, rich, dataParam, translateData, getLocale } from '../core/i18n.js';

const MAX_GATHERS = 8, RETRY_MS = 5000;
const TIMING_COPY = {
  es: { aim_busy: 'No se pudo iniciar el ritmo. Espera un momento e int\u00e9ntalo de nuevo.',
    aim_revision: 'La palmera cambi\u00f3. Ac\u00e9rcate e inicia otro ritmo.', aim_tool: 'Necesitas un hacha para talar.',
    aim_cooldown: 'Espera a que termine tu acci\u00f3n antes de iniciar otro ritmo.' },
  en: { aim_busy: 'Could not start the timing challenge. Wait a moment and try again.',
    aim_revision: 'The palm changed. Move closer and start a new challenge.', aim_tool: 'You need an axe to log.',
    aim_cooldown: 'Wait for your action to finish before starting another challenge.' },
};
const COPY = {
  es: { collecting: 'Recogiendo', retry: 'Reintentar', retryAction: 'Reintentar la recogida' },
  en: { collecting: 'Collecting', retry: 'Retry', retryAction: 'Retry collection' },
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
  aimRequired: 'Solicita un nuevo ritmo de tala antes de golpear.', timing: 'No se pudo validar el ritmo de tala. Inténtalo otra vez.',
};

export class ResourceActions {
  constructor({ client, player, enabled, toast, sound, onGather, onChange, locale = getLocale, now = () => performance.now() }) {
    Object.assign(this, { client, player, enabled, toast, sound, onGather, onChange, locale, now });
    this.craftPending = null; this.gathers = new Map(); this.predictedHits = new Set(); this.openWorkbench = null; this.gatherUntil = 0; this.latestGather = null;
    this.aim = null; this.aimRequest = null; this.timingPanel = null;
  }
  get pending() { return this.craftPending || this.gathers.values().next().value || null; }
  get copy() { const locale = this.locale() === 'en' ? 'en' : 'es'; return { ...COPY[locale], ...TIMING_COPY[locale] }; }
  reset() {
    this.craftPending = null; this.gathers.clear(); this.predictedHits.clear(); this.gatherUntil = 0; this.latestGather = null;
    this.aim = null; this.aimRequest = null; this.timingPanel?.close(); this.onChange?.();
  }
  update() {
    const c = this.client();
    if (c !== this.owner || c?.t?.closed) { if (this.pending || this.aim || this.aimRequest) this.reset(); this.owner = c; return; }
    if (this.aim && this.now() - this.aim.receivedAt > 90 * DT * 1000) {
      this.aim = null; this.timingPanel?.close();
      this.toast(text('systems.resource.timingExpired'));
    }
    let changed = false;
    for (const [id, pending] of this.gathers) {
      const node = c.resources?.nodes?.find((n) => n.id === pending.command.node);
      if (pending.ack && node?.rev >= pending.ack.rev && (!pending.count || c.profile?.eco?.tradeRev >= pending.ack.profileRev)) {
        this.gathers.delete(id); changed = true;
      } else if (!pending.ack && !pending.expired && this.now() - pending.sentAt >= RETRY_MS) {
        // Uncertainty never turns a presentation preview into spendable inventory.
        pending.expired = true; changed = true;
        if (!pending.ack) this.toast(text('systems.resource.delayed'));
      }
    }
    if (changed) this.onChange?.();
  }
  backpack() {
    const source = this.client()?.profile?.eco?.pack;
    if (!source) return { pack: null, pendingGoods: {} };
    const pack = { ...source, goods: { ...source.goods } }, pendingGoods = {};
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
        return { html: `<span class="kbd">F</span> ${t('systems.resource.pendingCraft')}`, verb: t('systems.resource.prepare'),
          run: () => this.openWorkbench() };
      }
      const retry = this.now() - this.craftPending.sentAt >= RETRY_MS;
      return { html: retry ? `<span class="kbd">F</span> ${t('systems.resource.retryRequest')}` : t('systems.resource.waiting'),
        verb: t(retry ? 'systems.resource.retry' : 'systems.resource.waitingShort'), run: () => { if (retry) this.send(this.craftPending.command); } };
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
      if (!node.ready) return { html: t(node.kind === 'palm' ? 'systems.resource.palmRegrows' : 'systems.resource.regrows',
        { resource: translateData(def.name), seconds: Math.ceil(Math.max(0, node.wait - elapsed)) }), verb: t('systems.resource.depletedShort'), icon: def.tool === 'pickaxe' ? 'mine' : node.kind === 'palm' ? 'axe' : 'chest', run() {} };
      const pack = this.backpack().pack;
      const space = pack ? t('systems.resource.backpackSpace', { used: holdUsed(pack), capacity: pack.cap }) : '';
      const cutting = node.kind === 'palm', working = !!def.tool;
      const timingEnabled = cutting && (c.resources?.timing === true || node.timing === true);
      const maxHits = def.hits || HARVEST.palmHits;
      const hit = Math.min(maxHits, (node.hits || 0) + 1);
      const remainingHits = Number.isSafeInteger(node.remaining) ? node.remaining : maxHits - (node.hits || 0);
      const expectedYield = def.yield || def.count || (cutting ? HARVEST.palmYield : 1);
      const toolOwned = !def.tool || c.profile?.tools?.[def.tool] === 1;
      const needsTool = def.tool && !toolOwned;
      const wait = Math.max(0, this.gatherUntil - this.now());
      const icon = def.tool === 'pickaxe' ? 'mine' : cutting ? 'axe' : 'chest';
      const verb = t(def.tool === 'pickaxe' ? 'systems.resource.mine' : cutting ? 'systems.resource.chop' : 'systems.resource.gather');
      if (needsTool) return { html: t('systems.resource.needTool', { resource: translateData(def.name),
        tool: t(def.tool === 'pickaxe' ? 'systems.resource.pickaxe' : 'systems.resource.axe') }),
        verb, icon, run: () => this.toast(text(def.tool === 'pickaxe' ? 'systems.resource.needPickaxeToast' : 'systems.resource.needAxeToast')) };
      if (timingEnabled) {
        if (this.aim?.node === node.id && this.aim.rev === node.rev)
          return { html: `<span class="kbd">F</span> ${t('systems.resource.strikeRhythm')}`, verb: t('systems.resource.log'), icon,
            run: () => this.submitTiming() };
        if (this.aimRequest?.node === node.id && this.aimRequest.rev === node.rev)
          return { html: this.now() - this.aimRequest.sentAt >= RETRY_MS
            ? `<span class="kbd">F</span> ${t('systems.resource.retryRhythm')}` : t('systems.resource.preparingRhythm'),
          verb: t('systems.resource.log'), icon, run: () => { if (this.now() - this.aimRequest.sentAt >= RETRY_MS) this.requestTiming(node); } };
        return { html: `<span class="kbd">F</span> ${t('systems.resource.startRhythm')}`, verb: t('systems.resource.log'), icon,
          run: () => this.requestTiming(node) };
      }
      if (wait > 0) return { html: t('systems.resource.working', { action: t(def.tool === 'pickaxe' ? 'systems.resource.mining' : cutting ? 'systems.resource.chopping' : 'systems.resource.gathering'),
        seconds: (wait / 1000).toFixed(1), progress: working ? ` · ${Math.max(0, remainingHits)}/${maxHits}` : '' }), verb, icon, run() {} };
      const quantityKey = def.good === 'piedra' ? 'systems.resource.quantity.stone'
        : def.good === 'mineral_hierro' ? 'systems.resource.quantity.ore' : 'systems.resource.quantity.logs';
      const compactProgress = working ? ` · ${hit}/${maxHits} · +${t(quantityKey, { count: expectedYield })}` : '';
      return { html: `<span class="kbd">F</span> ${translateData(def.verb)}${compactProgress}${space}`, verb, icon,
        run: () => this.send({ t: 'cmd', type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev,
          ...(node.kind === 'palm' && c.resources?.lootRules === 1 ? { lootRules: 1 } : {}) }) };
    }
    if (this.gathers.size && this.now() < this.gatherUntil) return {
      html: this.copy.collecting, verb: this.copy.collecting, icon: 'chest', run() {},
    };
    if (nearBench) {
      const count = c.profile?.eco?.pack.goods.tronco || 0;
      if (this.openWorkbench) return { html: `<span class="kbd">F</span> ${t('systems.resource.benchCount', { count })}`,
        verb: t('systems.resource.prepare'), run: () => this.openWorkbench() };
      return { html: `<span class="kbd">F</span> ${t('systems.resource.prepareWoodCount', { count })}`, verb: t('systems.resource.prepare'),
        run: () => this.send({ t: 'cmd', type: 'resource', op: 'craft', recipe: 'madera', expectedRev: c.profile?.eco?.tradeRev ?? 0 }) };
    }
    return null;
  }
  requestTiming(node) {
    const c = this.client();
    if (!this.enabled() || !c?.joined || c.t?.closed || this.aim) return false;
    if (this.aimRequest) {
      if (this.aimRequest.node !== node.id || this.aimRequest.rev !== node.rev
          || this.now() - this.aimRequest.sentAt < RETRY_MS) return false;
      try { c.send(this.aimRequest.command); } catch { return false; }
      this.aimRequest.sentAt = this.now();
      return true;
    }
    const command = { t: 'cmd', type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev };
    try { c.send(command); } catch { return false; }
    this.aimRequest = { node: node.id, rev: node.rev, command, sentAt: this.now() };
    return true;
  }
  onAim(event) {
    const c = this.client();
    if (!event || event.type !== 'loggingAim') return false;
    if (event.ok !== true) {
      if (this.aimRequest && event.node === this.aimRequest.node && event.rev === this.aimRequest.rev) {
        this.aimRequest = null;
        this.toast(this.copy[`aim_${event.why}`] || this.copy.aim_busy);
        this.onChange?.();
        return true;
      }
      return false;
    }
    if (typeof event.challengeId !== 'string'
        || !/^[A-Za-z0-9_-]{1,64}$/.test(event.challengeId) || typeof event.node !== 'string'
        || !Number.isSafeInteger(event.rev) || !this.aimRequest) return false;
    let challenge;
    try { challenge = validateLoggingChallenge(event.challenge); } catch { return false; }
    const row = c?.resources?.nodes?.find(n => n.id === event.node);
    if (!row || row.kind !== 'palm' || row.rev !== event.rev || challenge.node !== row.id || challenge.rev !== row.rev
        || this.aimRequest.node !== row.id || this.aimRequest.rev !== row.rev) return false;
    this.aimRequest = null;
    this.aim = { node: row.id, rev: row.rev, challengeId: event.challengeId, challenge, receivedAt: this.now() };
    this.timingPanel ||= new LoggingTimingPanel({ onHit: () => this.submitTiming(), locale: this.locale, now: this.now });
    this.timingPanel.onHit = () => this.submitTiming();
    this.timingPanel.locale = this.locale;
    const logicalTick = c.resources?.logicalTick, resourceTick = c.resourceTick;
    const serverTick = c.serverTick?.() ?? resourceTick;
    const elapsedTicks = [logicalTick, resourceTick, serverTick].every(Number.isFinite)
      ? Math.max(0, logicalTick + serverTick - resourceTick - challenge.startTick) : 0;
    this.timingPanel.show(challenge, elapsedTicks);
    this.onChange?.();
    return true;
  }
  submitTiming() {
    const aimed = this.aim, c = this.client();
    if (!aimed || !c?.joined || c.t?.closed) return false;
    const sent = this.send({ t: 'cmd', type: 'resource', op: 'gather', node: aimed.node,
      expectedRev: aimed.rev, challenge: aimed.challengeId,
      ...(c.resources?.lootRules === 1 ? { lootRules: 1 } : {}) });
    if (sent) { this.aim = null; this.timingPanel?.close(); this.onChange?.(); }
    return sent;
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
    const timedPalm = node.kind === 'palm' && (c.resources?.timing === true || node.timing === true);
    const pack = this.backpack().pack, yieldCount = timedPalm ? 6 : (def.yield || 1);
    if (!pack || !load({ ...pack, goods: { ...pack.goods } }, def.good, yieldCount)) { this.toast(text('systems.resource.full')); return false; }
    const count = timedPalm ? 0 : (!def.hits || (node.hits || 0) + 1 >= def.hits ? yieldCount : 0);
    const pending = { command: { ...command }, sentAt: this.now(), def, good: def.good, count, timing: timedPalm };
    this.gathers.set(command.opId, pending);
    try { c.send(command); } catch { this.gathers.delete(command.opId); return false; }
    this.latestGather = pending;
    const actionTicks = node.kind === 'palm' ? loggingStatus(c.profile?.progression).actionTicks : (def.actionTicks || HARVEST.actionTicks);
    this.gatherUntil = pending.sentAt + actionTicks * DT * 1000;
    pending.until = this.gatherUntil;
    const key = `${node.id}:${node.rev + 1}`; this.predictedHits.add(key);
    while (this.predictedHits.size > 32) this.predictedHits.delete(this.predictedHits.values().next().value);
    this.onGather?.({ type: 'resourceHit', e: c.youServer, node: node.id, kind: node.kind, x: node.x, y: node.y, z: node.z,
      rev: node.rev + 1, remaining: def.hits ? Math.max(0, def.hits - (node.hits || 0) - 1) : 0, tool: def.tool });
    if (count) { this.sound?.(); this.toast(rich(def.good === 'piedra' ? 'systems.resource.gain.stone' : def.good === 'mineral_hierro' ? 'systems.resource.gain.ore' : 'systems.resource.gain.logs', { count })); }
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
        if (pending.timing) { this.aim = null; this.timingPanel?.close(); }
        if (this.gatherUntil === pending.until) this.gatherUntil = 0;
      }
      else {
        gather.ack = event; gather.good = event.good; gather.count = event.count; gather.expired = false;
        // Old servers lack the revision barrier: drop the preview and await their canonical profile.
        if (!Number.isSafeInteger(event.profileRev)) gather.count = 0;
        // Only a fresh receipt for the still-current action may refine its local timer.
        if (gather === this.latestGather && this.gatherUntil === gather.until
            && !event.historical && !event.replay && Number.isSafeInteger(event.actionTicks) && event.actionTicks > 0) {
          gather.until = gather.sentAt + event.actionTicks * DT * 1000;
          this.gatherUntil = gather.until;
        }
      }
      this.onChange?.(); this.update();
    } else this.craftPending = null;
    if (!event.ok) {
      this.toast(event.why === 'tool'
        ? text(event.tool === 'pickaxe' ? 'systems.resource.needPickaxeToast' : 'systems.resource.needAxeToast')
        : event.why === 'full' && node?.kind === 'palm'
        ? text('systems.resource.full')
        : text(REASONS[event.why] || ['account_required', 'storage'].includes(event.why) ? `systems.resource.reason.${event.why}` : 'systems.resource.unknown'));
      return;
    }
    if (event.op === 'gather' && event.count === 0) {
      const mining = node?.kind === 'rock' || node?.kind === 'iron_ore';
      this.toast(rich(mining ? (event.remaining === 1 ? 'systems.resource.toast.hitLastRock' : 'systems.resource.toast.rockCracking')
        : (event.remaining === 1 ? 'systems.resource.toast.hitLastPalm' : 'systems.resource.toast.palmBending')));
      return;
    }
    if (gather) {
      if (gather.timing) this.toast(`${rich('systems.resource.gain.logs', { count: event.count })} · ${text(event.timing?.quality ? 'systems.resource.perfectHit' : 'systems.resource.loggingComplete')}`);
      if (!event.replay && !event.historical && event.loot && typeof event.loot === 'object') {
        const bonus = Object.entries(event.loot).filter(([good, count]) => ['resina', 'coco'].includes(good) && Number.isSafeInteger(count) && count > 0);
        if (bonus.length) this.toast(bonus.map(([good, count]) => {
          return rich(good === 'resina' ? 'systems.resource.gain.resin' : 'systems.resource.gain.coconut', { count });
        }).join(' · '));
      }
      return;
    }
    this.sound?.();
    const count = Number.isSafeInteger(event.count) && event.count > 0 ? event.count : 1;
    this.toast(event.op === 'craft' ? (event.tool
      ? rich('systems.resource.toast.craftedTool', { tool: dataParam(event.tool === 'axe' ? 'Hacha de piedra' : 'Pico de piedra') })
      : rich('systems.resource.toast.woodMade', { count }))
      : `${rich(event.good === 'piedra' ? 'systems.resource.gain.stone' : event.good === 'mineral_hierro' ? 'systems.resource.gain.ore' : 'systems.resource.gain.logs', { count })} · ${text(event.good === 'piedra'
        ? 'systems.resource.toast.stoneHint' : event.good === 'mineral_hierro' ? 'systems.resource.toast.oreHint' : 'systems.resource.toast.logHint')}`);
  }
}
