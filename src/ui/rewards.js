// What you get (M4): turns the server's private loot / pickup / quest / mastery events (and the predicted
// potion and locked-skill ones) into the ground loot you see (render/loot.js), its labels, toasts, floating
// numbers over you and sounds. Gameplay never lives here.
import { RARITIES, BASES, QUEST_ITEMS, SLOT_NAMES } from '../data/items.js';
import { QUESTS } from '../data/quests.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, MASTERY } from '../data/weapons.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { itemName } from '../sim/items.js';
import { sfx } from '../audio/sfx.js';

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
    if (d.kind === 'item') return [esc(itemName(d.item)), rarityColor(d.item.r), 16, 'item'];
    if (d.kind === 'gold') return [`${d.n} oro`, '#ffd24a', 9, 'gold'];
    if (d.kind === 'potion') return ['Poción de ron-coco', '#ff8a6a', 10, 'potion'];
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

  // Anchors for the loot labels (main.js passes its anchor() helper).
  anchors(anchor) {
    for (const [id, v] of this.world.loot.drops) {
      if (v.gone || !this.label.has(id)) continue;
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

  handle(ev) {
    if (!ev.me) return;
    const H = this.hud;
    switch (ev.type) {
      case 'loot': {
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
        else if (ev.kind === 'quest') { sfx.pickup(1); this.over(`${esc((QUEST_ITEMS[ev.q] || {}).name || ev.q)} ${ev.have ?? ''}`, 'xp', { life: 1 }); }
        else if (ev.kind === 'item') {
          sfx.pickup(ev.item.r);
          H.toast(`${ev.reward ? 'Recompensa: ' : '+ '}${itemHtml(ev.item)} <small>· ${SLOT_NAMES[BASES[ev.item.b].slot]} · Nv ${ev.item.l}</small>`, 3600);
          if (!this.settings.bagTaught) { this.settings.bagTaught = true; H.toast('<b>Bolsa:</b> pulsa <span class="kbd">I</span> para equiparte lo que encuentras.', 5200); }
        }
        break;
      }
      case 'full':
        H.toast(ev.what === 'bag' ? '<b>Bolsa llena.</b> Vende o desguaza algo para recoger más.' : '<b>Ya llevas 5 pociones.</b>', 3200);
        sfx.denied();
        break;
      case 'gear': sfx.equip(); break;
      case 'sold': if (ev.gold > 0) { sfx.coins(ev.gold); this.over(`+${ev.gold} oro`, 'gold', { life: 0.9 }); } break;
      case 'bought':
        if (ev.fail) { sfx.denied(); H.toast(ev.fail === 'gold' ? '<b>No te alcanza el oro.</b>' : ev.fail === 'max' ? '<b>Ya llevas 5 pociones.</b>' : '<b>Bolsa llena.</b>', 2600); }
        else { sfx.buy(); if (ev.what === 'potion') this.over('+1 poción', 'heal'); }
        break;
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
