// F/touch uses the same intent; only a private acknowledgement confirms gathered/crafted goods.
import { HARVEST, RESOURCE_KINDS } from '../data/resources.js';
import { DT } from '../data/tuning.js';
import { holdUsed } from '../sim/economy/cargo.js';

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
  constructor({ client, player, enabled, toast, sound }) {
    Object.assign(this, { client, player, enabled, toast, sound }); this.pending = null; this.openWorkbench = null; this.gatherUntil = 0;
  }
  reset() { this.pending = null; this.gatherUntil = 0; }
  interaction() {
    const c = this.client(), p = this.player();
    if (!this.enabled() || !c?.joined || !p || p.dead || c.naval.active || c.deck.active) return null;
    const bench = c.resources?.bench;
    const nearBench = !c.voyage?.active && bench && Math.abs(p.y - bench.y) <= 1.5
      && Math.hypot(p.x - bench.x, p.z - bench.z) <= HARVEST.benchRadius;
    if (this.pending) {
      if (this.pending.command.op === 'craft' && this.openWorkbench) {
        if (!nearBench) return null;
        return { html: '<span class="kbd">F</span> Banco de materiales · preparación pendiente', verb: 'Preparar',
          run: () => this.openWorkbench() };
      }
      const retry = performance.now() - this.pending.sentAt >= 5000;
      return { html: retry ? '<span class="kbd">F</span> Reintentar la solicitud' : 'Esperando confirmación…',
        verb: retry ? 'Reintentar' : 'Esperando', run: () => { if (retry) this.send(this.pending.command); } };
    }
    const rows = c.resources?.nodes || [];
    let node = null, distance = HARVEST.radius;
    for (const row of rows) {
      if (!RESOURCE_KINDS[row.kind] || Math.abs(p.y - row.y) > 1.5) continue;
      const d = Math.hypot(p.x - row.x, p.z - row.z);
      if (d <= distance) { node = row; distance = d; }
    }
    if (node) {
      const def = RESOURCE_KINDS[node.kind];
      const elapsed = Number.isFinite(c.resourceTick) ? Math.max(0, (c.serverTick?.() ?? c.resourceTick) - c.resourceTick) * DT : 0;
      if (!node.ready) return { html: `${node.kind === 'palm' ? 'Tocón · la palmera crece' : def.name + ' agotado · vuelve'} en ${Math.ceil(Math.max(0, node.wait - elapsed))} s`, verb: 'Agotado', icon: def.tool === 'pickaxe' ? 'mine' : node.kind === 'palm' ? 'axe' : 'chest', run() {} };
      const pack = c.profile?.eco?.pack;
      const space = pack ? ` · mochila ${holdUsed(pack)}/${pack.cap}` : '';
      const cutting = node.kind === 'palm', working = !!def.tool;
      const maxHits = def.hits || HARVEST.palmHits;
      const hit = Math.min(maxHits, (node.hits || 0) + 1);
      const remainingHits = Number.isSafeInteger(node.remaining) ? node.remaining : maxHits - (node.hits || 0);
      const expectedYield = def.yield || def.count || (cutting ? HARVEST.palmYield : 1);
      const toolOwned = !def.tool || c.profile?.tools?.[def.tool] === 1;
      const needsTool = def.tool && !toolOwned;
      const wait = Math.max(0, this.gatherUntil - performance.now());
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
    if (!command.opId) command = { ...command, opId: crypto.randomUUID() };
    if (this.pending && this.pending.command.opId !== command.opId) return false;
    this.pending = { command, sentAt: performance.now() };
    this.client().send(command);
    return true;
  }
  onResult(event) {
    if (!this.pending || this.pending.command.opId !== event.opId) return;
    const node = this.client().resources?.nodes?.find((row) => row.id === this.pending.command.node);
    this.pending = null;
    if (!event.ok) {
      this.toast(event.why === 'tool'
        ? `Necesitas ${event.tool === 'pickaxe' ? 'un pico' : 'un hacha'} para trabajar este recurso.`
        : event.why === 'full' && node?.kind === 'palm'
        ? `Necesitas espacio para ${HARVEST.palmYield} troncos. Deposita materiales en tu balsa.`
        : REASONS[event.why] || 'No se pudo completar la acción.');
      return;
    }
    if (event.op === 'gather') {
      const def = RESOURCE_KINDS[node?.kind];
      const ticks = event.remaining !== undefined ? (def?.actionTicks || HARVEST.chopTicks) : (def?.actionTicks || HARVEST.actionTicks);
      this.gatherUntil = performance.now() + ticks * DT * 1000;
    }
    if (event.op === 'gather' && event.count === 0) {
      const mining = node?.kind === 'rock' || node?.kind === 'iron_ore';
      this.toast(`<b>¡TAC!</b> · ${event.remaining === 1 ? `Un golpe más para ${mining ? 'romperla' : 'talarla'}.` : mining ? 'La roca empieza a ceder.' : 'La palmera empieza a ceder.'}`);
      return;
    }
    this.sound?.();
    const count = Number.isSafeInteger(event.count) && event.count > 0 ? event.count : 1;
    this.toast(event.op === 'craft' ? (event.tool
      ? `<b>${event.tool === 'axe' ? 'Hacha' : 'Pico'} de piedra fabricado</b> · equipado en tu cinturón de utilidad.`
      : `<b>+${count} madera preparada</b> · úsala en B / Construir.`)
      : `<b>+${count} ${event.good === 'piedra' ? count === 1 ? 'piedra' : 'piedras' : event.good === 'mineral_hierro' ? count === 1 ? 'mineral de hierro' : 'minerales de hierro' : count === 1 ? 'tronco' : 'troncos'}</b> · ${event.good === 'piedra'
        ? 'Material para fabricar herramientas.' : event.good === 'mineral_hierro' ? 'Mineral bruto; requiere fundición.' : 'Llévalo al banco del puerto para preparar madera.'}`);
  }
}
