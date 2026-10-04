// What you get (M4): turns the server's private loot / pickup / quest / mastery events (and the predicted
// potion and locked-skill ones) into the ground loot you see (render/loot.js), its labels, toasts, floating
// numbers over you and sounds. Gameplay never lives here.
import { RARITIES, BASES, QUEST_ITEMS, SLOT_NAMES } from '../data/items.js';
import { QUESTS } from '../data/quests.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, MASTERY } from '../data/weapons.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { LAWLESS } from '../data/lawless.js';
import { itemName } from '../sim/items.js';
import { sfx } from '../audio/sfx.js';
import { TATTOOS, skillId } from '../data/tattoos.js';
import { PEARLS } from '../data/pearls.js';

// Why a tattoo change was refused (skillDenied, M4.7).
const DENY = {
  combat: 'Fuera de combate para cambiar (3 s sin recibir daño).', lawless: 'En la Cala sin ley no se cambia de tatuaje.',
  weapon: 'Ese arte es de otra arma.', gold: 'Te falta oro.', far: 'Acércate a Doña Sepia.', rank: 'Esa forma pide más rango.',
  unknown: 'No puedes hacer eso.',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const rarityColor = (r) => (RARITIES[r] || RARITIES[0]).color;
// «Sable de cubierta del Tiburón» in its rarity's colour.
export const itemHtml = (item) => `<b class="rz" style="color:${rarityColor(item.r)}">${esc(itemName(item))}</b>`;
const SLOT_SKILL = { q: 'q', e: 'e', r: 'r' };

export class Rewards {
  constructor({ world, hud, worldUI, ps, map, settings }) {
    Object.assign(this, { world, hud, worldUI, ps, map, settings });
    this.lockT = 0;
    this.label = new Map(); // drop id → true while its label exists
  }

  vol(x, z) { const d = Math.hypot(x - this.ps.x, z - this.ps.z); return Math.max(0.15, Math.min(1, 1 - (d - 4) / 30)); }
  over(html, cls, o) { return this.worldUI.float(this.ps.x, this.ps.y + 2.15, this.ps.z, html, cls, { rise: 34, spread: 6, life: 1.2, ...o }); }

  labelFor(d) {
    // Public loot (the Cala Calavera, M4.5): whose it was, if a pirate dropped it.
    const from = d.pub && d.from ? ` <span class="pub">☠ ${d.from === this.myName ? 'tuyo' : esc(d.from)}</span>` : '';
    if (d.kind === 'pearl') return [esc(PEARLS[d.pearl.kind].name) + from, PEARLS[d.pearl.kind].color, 40, 'pearl'];
    if (d.kind === 'item') return [esc(itemName(d.item)) + from, rarityColor(d.item.r), 16, 'item'];
    if (d.kind === 'gold') return [`${d.n} oro`, '#ffd24a', 9, 'gold'];
    if (d.kind === 'potion') return ['Poción de ron-coco' + from, '#ff8a6a', 10, 'potion'];
    if (d.kind === 'quest') return [esc((QUEST_ITEMS[d.q] || { name: d.q }).name), '#ff9aa8', 12, 'quest'];
    return ['Cofre de HELLFIRE', rarityColor(d.r ?? 2), 24, 'chest'];
  }

  addDrop(d, fx, fz) {
    this.world.loot.add(d, fx, fz);
    const [html, color, range, cls] = this.labelFor(d);
    this.worldUI.addLabel('L' + d.id, html, { color, range, cls });
    this.label.set(d.id, true);
  }
  dropGone(id, how, to) {
    this.world.loot.remove(id, how, to);
    if (this.label.delete(id)) this.worldUI.removeLabel('L' + id);
  }

  // Anchors for the loot labels (main.js passes its anchor() helper). The drop the F prompt is about shows its
  // name in the prompt instead (promptDrop).
  anchors(anchor) {
    for (const [id, v] of this.world.loot.drops) {
      if (v.gone || !this.label.has(id) || id === this.promptDrop) continue;
      const p = v.root.position;
      anchor('L' + id, p.x, p.y + (v.L.chest ? 1.3 : 0.75), p.z, Math.hypot(p.x - this.ps.x, p.z - this.ps.z));
    }
  }

  // The nearest chest of yours within reach (for the F prompt), or null.
  chestNear(r = 2.6) {
    let best = null, bd = r;
    for (const [id, v] of this.world.loot.drops) {
      if (v.gone || v.d.kind !== 'chest') continue;
      const d = Math.hypot(v.x - this.ps.x, v.z - this.ps.z);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  // The F prompt for chest `id`: what it is, in its rarity's colour (its own label hides meanwhile).
  chestPrompt(id) {
    const v = this.world.loot.drops.get(id);
    const [name, color] = v ? this.labelFor(v.d) : ['Cofre de HELLFIRE', rarityColor(2)];
    return `<span class="kbd">F</span> Abrir · <b style="color:${color}">${name}</b>`;
  }

  // What the canopy must not hide (toon.js mnOcc2): your nearest chest (or spilled loot) within r.
  focusPoint(r = 10) {
    let best = null, bd = r;
    for (const v of this.world.loot.drops.values()) {
      // Your chest, or what you spilled in the Cala Calavera (M4.5).
      if (v.gone || (v.d.kind !== 'chest' && !(v.d.pub && v.d.from && v.d.from === this.myName))) continue;
      const d = Math.hypot(v.x - this.ps.x, v.z - this.ps.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best ? best.root.position : null;
  }

  // Where your spilled loot lies (the map's 💀), while it may still be there.
  spillAt() { return this.spill && performance.now() < this.spill.until ? this.spill : null; }

  // Public loot (the Cala Calavera, M4.5): everyone sees it fall and sees who takes it.
  handlePublic(ev) {
    if (ev.type === 'loot') {
      let top = -1;
      for (const d of ev.drops) { this.addDrop(d, ev.fx, ev.fz); if (d.kind === 'item' && d.item.r > top) top = d.item.r; }
      if (Math.hypot(ev.fx - this.ps.x, ev.fz - this.ps.z) < 30) sfx.lootDrop(Math.max(0, top), this.vol(ev.fx, ev.fz));
    } else if (ev.type === 'unloot') {
      const by = ev.by && this.entityPos ? this.entityPos(ev.by) : null;
      for (const id of ev.ids) if (!ev.by || ev.by !== this.meId) this.dropGone(id, ev.why === 'pick' ? 'pick' : 'expire', by);
    }
  }

  handle(ev) {
    if (ev.type === 'pearlReturn') { this.hud.toast('<b>Una perla negra volvió al mar.</b> Busca su pilar de luz en la playa.', 6000); return; }
    if (ev.pub && !ev.to && (ev.type === 'loot' || ev.type === 'unloot')) { this.handlePublic(ev); return; }
    if (!ev.me) return;
    const H = this.hud;
    switch (ev.type) {
      case 'loot': {
        // Joining with public loot already on the ground: just draw it.
        if (ev.late) { for (const d of ev.drops) this.addDrop(d, d.x, d.z); break; }
        let top = -1, legend = null;
        for (const d of ev.drops) {
          this.addDrop(d, ev.fx, ev.fz);
          const r = d.kind === 'item' ? d.item.r : d.kind === 'chest' ? (d.r ?? 2) : 0;
          if (r > top) top = r;
          if (d.kind === 'item' && d.item.r >= 4) legend = d.item;
        }
        sfx.lootDrop(Math.max(0, top), this.vol(ev.fx, ev.fz));
        if (legend) { H.toast(`<b class="legend">¡LEGENDARIO!</b> ${itemHtml(legend)}`, 5200); this.world.rig.punchIn(0.5); }
        else if (ev.drops.some((d) => d.kind === 'chest')) H.toast('<b>¡Un cofre para ti!</b> Ábrelo con <span class="kbd">F</span> en el centro de La Caldera.', 5200);
        break;
      }
      case 'unloot': for (const id of ev.ids) this.dropGone(id, ev.why === 'open' ? 'open' : 'expire'); break;
      case 'chest': sfx.chest(ev.r ?? 2); this.world.rig.addTrauma(0.35); this.world.rig.punchIn(0.4); break;
      case 'pickup': {
        if (ev.id) this.dropGone(ev.id, 'pick', this.ps);
        if (ev.kind === 'gold') { sfx.coins(ev.n); this.over(`+${ev.n} oro`, 'gold', { life: 0.9 }); }
        else if (ev.kind === 'potion') { sfx.pickup(0); this.over('+1 poción', 'heal', { life: 0.9 }); }
        else if (ev.kind === 'pearl') { sfx.pickup(3); H.toast(`<b style="color:${PEARLS[ev.pearl.kind].color}">${PEARLS[ev.pearl.kind].name}</b> en tu bolsa. Abre <b>Perlas (P)</b> para tragarla o entregarla.`, 6000); }
        else if (ev.kind === 'quest') { sfx.pickup(1); this.over(`${esc((QUEST_ITEMS[ev.q] || {}).name || ev.q)} ${ev.have ?? ''}`, 'xp', { life: 1 }); }
        else if (ev.kind === 'item') {
          sfx.pickup(ev.item.r);
          H.toast(`${ev.back ? '<b>¡Recuperado!</b> ' : ev.reward ? 'Recompensa: ' : '+ '}${itemHtml(ev.item)} <small>· ${SLOT_NAMES[BASES[ev.item.b].slot]} · Nv ${ev.item.l}</small>`, 3600);
          if (!this.settings.bagTaught) { this.settings.bagTaught = true; H.toast('<b>Bolsa:</b> pulsa <span class="kbd">I</span> para equiparte lo que encuentras.', 5200); }
        }
        break;
      }
      case 'full':
        H.toast(ev.what === 'bag' ? '<b>Bolsa llena.</b> Vende o desguaza algo para recoger más.' : '<b>Ya llevas 5 pociones.</b>', 3200);
        sfx.denied();
        break;
      case 'gear': sfx.equip(); break;
      case 'spill': {
        // You fell in the Cala Calavera: what you carried is on the ground for anyone (the map marks it).
        this.spill = { x: ev.x, z: ev.z, until: performance.now() + LAWLESS.spill.life * 1000 };
        const what = [ev.n ? `${ev.n} ${ev.n > 1 ? 'objetos' : 'objeto'}` : '', ev.pot ? `${ev.pot} ${ev.pot > 1 ? 'pociones' : 'poción'}` : ''].filter(Boolean).join(' y ');
        H.toast(what ? `<b class="pk">☠ Lo perdiste todo en la Cala.</b> ${what} quedan en el suelo ${Math.round(LAWLESS.spill.life / 60)} minutos para quien llegue primero: ¡vuelve a por ello! <small>(💀 en el mapa · el oro no se pierde)</small>` : '<b class="pk">☠ Caíste en la Cala.</b> No llevabas nada que perder.', 8000);
        break;
      }
      case 'sold': if (ev.gold > 0) { sfx.coins(ev.gold); this.over(`+${ev.gold} oro`, 'gold', { life: 0.9 }); } break;
      case 'bought':
        if (ev.fail) { sfx.denied(); H.toast(ev.fail === 'gold' ? '<b>No te alcanza el oro.</b>' : ev.fail === 'max' ? '<b>Ya llevas 5 pociones.</b>' : ev.fail === 'tier' ? '<b>Aún no:</b> ese cofre se abre venciendo su Marea en La Caldera.' : '<b>Bolsa llena.</b>', 2600); }
        else { sfx.buy(); if (ev.what === 'potion') this.over('+1 poción', 'heal'); }
        break;
      // ---- Tattoos (M4.7) ----
      case 'pearlDenied': {
        const why = { combat: 'Sal del combate antes de cambiar o entregar una perla.', stale: 'Esa perla ya circula en otra parte. Se retiró de la partida antigua.', confirm: 'Confirma qué perla quieres soltar antes de reemplazarla.', full: 'La bolsa de perlas está llena (8).', far: 'Acércate al pirata para entregarle la perla.', vendor: 'Acércate al puesto de Tía Perla para vender.', unknown: 'Ya no llevas esa perla.' };
        sfx.denied(); H.toast(`<b>${why[ev.why] || why.unknown}</b>`, 5000); break;
      }
      case 'pearlChanged': {
        if (ev.op === 'swallow') {
          const P = PEARLS[ev.pearl?.kind];
          sfx.mastery();
          H.toast(P ? `<b>${esc(P.name)} tragada.</b> G: ${esc(SKILLS[P.skill].name)}. ${esc(P.passive)} <small>${esc(P.curse)}</small>` : '<b>Perla tragada.</b> Tu poder está en G.', 6200);
        }
        else if (ev.op === 'death') H.toast('<b>Tus perlas cayeron al suelo.</b> Vuelve por ellas: cualquiera puede tomarlas.', 6000);
        else if (ev.op === 'sell') { sfx.coins(ev.gold); this.over(`+${ev.gold} oro`, 'gold'); }
        else { sfx.equip(); H.toast(ev.op === 'give' ? '<b>Perla entregada.</b>' : '<b>Perla en el suelo.</b> Cualquiera puede recogerla.', 3600); }
        break;
      }
      case 'skillDenied': sfx.denied(); H.toast(`<b>${DENY[ev.why] || DENY.unknown}</b>`, 3000); break;
      case 'learned': {
        const T = TATTOOS[ev.id];
        if (!T) break;
        sfx.mastery();
        this.over(`¡${T.name.toUpperCase()}!`, 'level', { life: 1.4, rise: 50 });
        H.toast(`Doña Sepia te tatúa <b>${T.name}</b>${ev.cost ? ` por ${ev.cost} oro` : ' (el primero no se cobra)'}.<br>Ponlo en <b>Q</b> o <b>E</b> en la pestaña Tatuajes (<span class="kbd">T</span>).`, 5600);
        break;
      }
      case 'tattooRank': {
        const T = TATTOOS[ev.id];
        if (!T) break;
        sfx.levelUp();
        const F = T.forms.find((f, i) => i > 0 && f.rank === ev.rank);
        this.over(`${T.name.toUpperCase()} ${ROMAN[ev.rank]}`, 'level', { life: 1.4, rise: 50 });
        H.toast(`<b>${T.name}</b> sube a rango ${ROMAN[ev.rank]}${F ? `<br>Forma nueva: <b>${F.name}</b> · ${F.hint}` : ''}`, 5600);
        H.pulse(skillId(this.ps.skQ) === ev.id ? 'q' : 'e');
        break;
      }
      case 'loadout': case 'form': sfx.equip(); break;
      case 'mastery': {
        const kind = WEAPON_KINDS[ev.kit], W = WEAPONS[kind];
        sfx.mastery();
        this.over(`¡MAESTRÍA ${ev.level}!`, 'level', { life: 1.6, rise: 60 });
        let what = `+${Math.round(MASTERY.dmg * 100)} % de daño con ${W.short.toLowerCase()}`;
        if (ev.opens) { const id = W[SLOT_SKILL[ev.opens]]; what = `<b>${ev.opens.toUpperCase()} ${SKILLS[id].name}</b> desbloqueada: ${SKILLS[id].hint.toLowerCase()}`; }
        else if (ev.passive) { const p = MASTERY.passives[kind].find((q) => q.id === ev.passive); if (p) what = `Pasiva <b>${p.name}</b>: ${p.hint}`; }
        H.toast(`<b>${W.name} · Maestría ${ev.level}</b><br>${what}`, 5600);
        break;
      }
      case 'quest': {
        const Q = QUESTS[ev.id];
        if (!Q) break;
        if (ev.st === 'start') { sfx.questStart(); H.toast(`<b>Nueva misión:</b> ${esc(Q.name)}<br><small>${esc(Q.text)}</small>`, 5200); }
        else if (ev.st === 'progress') this.over(`${esc(Q.name)} ${ev.n}/${ev.of}`, 'xp', { life: 1.1, rise: 26 });
        else if (ev.st === 'ready') { sfx.questStart(); H.toast(`<b>${esc(Q.name)}:</b> ¡listo! Vuelve con ${Q.turnin === 'vendor' ? 'Tía Perla' : 'la Capitana Brea'}.`, 4600); }
        else if (ev.st === 'done') {
          sfx.questDone();
          const R = ev.reward || {}, bits = [];
          if (R.xp) bits.push(`${R.xp} XP`);
          if (R.gold) bits.push(`${R.gold} oro`);
          if (R.potions) bits.push(`${R.potions} ${R.potions > 1 ? 'pociones' : 'poción'}`);
          if (R.item) bits.push('un objeto');
          H.toast(`<b>¡Misión cumplida!</b> ${esc(Q.name)}${bits.length ? `<br><small>${bits.join(' · ')}</small>` : ''}`, 4600);
          this.over('¡MISIÓN CUMPLIDA!', 'perfect', { life: 1.4, rise: 50 });
        }
        break;
      }
      case 'tier': {
        const T = ENCOUNTERS.caldera.tiers;
        if (ev.why === 'open') { sfx.mastery(); H.toast(`<b>${T[ev.open - 1].name} desbloqueada.</b> Elígela en las runas de La Caldera con <span class="kbd">F</span>: enemigos más duros, mejor botín.`, 6200); }
        else { sfx.click(); H.toast(`<b>${T[ev.sel - 1].name}</b> para tu próxima Prueba de Fuego.`, 2400); }
        break;
      }
      case 'locked': {
        const now = performance.now();
        if (now - this.lockT < 1200) break;
        this.lockT = now;
        if (ev.slot === 'g') { sfx.locked(); H.denySlot('g'); H.toast('<b>G necesita una perla tragada.</b> Abre Perlas (P).', 3400); break; }
        const kind = WEAPON_KINDS[this.ps.weapon] || 'sable', W = WEAPONS[kind], id = W[SLOT_SKILL[ev.slot]];
        sfx.locked();
        H.denySlot(ev.slot);
        H.toast(`<b>${SKILLS[id].name}</b> se desbloquea con <b>Maestría ${MASTERY.unlock[ev.slot]}</b> de ${W.short.toLowerCase()}. Gana experiencia con esta arma.`, 3400);
        break;
      }
      case 'potion': {
        if (ev.denied) {
          sfx.denied();
          if (ev.denied === 'empty') H.toast('<b>Sin pociones.</b> Tía Perla las vende en la aldea.', 2800);
          else if (ev.denied === 'full') this.over('Vida completa', 'info', { life: 0.8 });
          H.denySlot('pot');
          break;
        }
        sfx.potion();
        this.over(`+${ev.heal}`, 'heal', { life: 1.1 });
        const y = this.map.groundAt(this.ps.x, this.ps.z);
        this.world.effects.sparks(this.ps.x, y + 1, this.ps.z, 18, { color: [0.6, 1, 0.6], color1: [0.1, 0.8, 0.3], up: 3, spread: 1.6, gravity: -1, life: 0.7 });
        this.world.combatFx.ring(this.ps.x, y + 0.1, this.ps.z, 1.4, 0x6dff8a, 0.4, 0.2, 0.7);
        H.pulse('pot');
        break;
      }
      default: break;
    }
  }
}
