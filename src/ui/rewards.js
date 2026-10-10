// What you get (M4): turns the server's private loot / pickup / quest / mastery events (and the predicted
// potion and locked-skill ones) into the ground loot you see (render/loot.js), its labels, toasts, floating
// numbers over you and sounds. Gameplay never lives here.
import { RARITIES, BASES, QUEST_ITEMS, SLOT_NAMES } from '../data/items.js';
import { QUESTS } from '../data/quests.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, MASTERY } from '../data/weapons.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { LAWLESS } from '../data/lawless.js';
import { tuning } from '../data/tuning.js';
import { itemName } from '../sim/items.js';
import { sfx } from '../audio/sfx.js';
import { TATTOOS, skillId } from '../data/tattoos.js';
import { PEARLS } from '../data/pearls.js';
import { dataText, dataParam, rich, text as ltext, formatNumber } from '../core/i18n.js';

// Why a tattoo change was refused (skillDenied, M4.7).
const DENY = { combat: 'reward.denied.combat', lawless: 'reward.denied.lawless', weapon: 'reward.denied.weapon', gold: 'reward.denied.gold', far: 'reward.denied.far', rank: 'reward.denied.rank', unknown: 'reward.denied.unknown' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const rarityColor = (r) => (RARITIES[r] || RARITIES[0]).color;
// «Sable de cubierta del Tiburón» in its rarity's colour.
export const itemHtml = (item) => `<b class="rz" style="color:${rarityColor(item.r)}">${dataText(itemName(item))}</b>`;
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
    const from = d.pub && d.from ? ` <span class="pub">☠ ${d.from === this.myName ? ltext('reward.yours') : esc(d.from)}</span>` : '';
    if (d.kind === 'pearl') return [dataText(PEARLS[d.pearl.kind].name) + from, PEARLS[d.pearl.kind].color, 40, 'pearl'];
    if (d.kind === 'item') return [dataText(itemName(d.item)) + from, rarityColor(d.item.r), 16, 'item'];
    if (d.kind === 'gold') return [rich('reward.gold_label', { count: formatNumber(d.n) }), '#ffd24a', 9, 'gold'];
    if (d.kind === 'potion') return [dataText('Poción de ron-coco') + from, '#ff8a6a', 10, 'potion'];
    if (d.kind === 'quest') return [dataText((QUEST_ITEMS[d.q] || { name: d.q }).name), '#ff9aa8', 12, 'quest'];
    return [rich('reward.chest_label'), rarityColor(d.r ?? 2), 24, 'chest'];
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
    const [name, color] = v ? this.labelFor(v.d) : [rich('reward.chest_label'), rarityColor(2)];
    return `<span class="kbd">F</span> ${ltext('adventure.chest_prompt')} · <b style="color:${color}">${name}</b>`;
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
    if (ev.type === 'pearlReturn') { this.hud.toast(rich('reward.pearl_return'), 6000); return; }
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
        if (legend) { H.toast(`<b class="legend">${ltext('adventure.legendary')}</b> ${itemHtml(legend)}`, 5200); this.world.rig.punchIn(0.5); }
        else if (ev.drops.some((d) => d.kind === 'chest')) H.toast(rich('reward.chest_for_you'), 5200);
        break;
      }
      case 'unloot': for (const id of ev.ids) this.dropGone(id, ev.why === 'open' ? 'open' : 'expire'); break;
      case 'chest': sfx.chest(ev.r ?? 2); this.world.rig.addTrauma(0.35); this.world.rig.punchIn(0.4); break;
      case 'pickup': {
        if (ev.id) this.dropGone(ev.id, 'pick', this.ps);
        if (ev.kind === 'gold') { sfx.coins(ev.n); this.over(rich('reward.gold_label', { count: formatNumber(ev.n) }), 'gold', { life: 0.9 }); }
        else if (ev.kind === 'potion') { sfx.pickup(0); this.over(rich('reward.potion_float'), 'heal', { life: 0.9 }); }
        else if (ev.kind === 'pearl') { sfx.pickup(3); H.toast(`<b style="color:${PEARLS[ev.pearl.kind].color}">${dataText(PEARLS[ev.pearl.kind].name)}</b> ${rich('reward.pearl_pickup')}`, 6000); }
        else if (ev.kind === 'quest') { sfx.pickup(1); this.over(`${dataText((QUEST_ITEMS[ev.q] || {}).name || ev.q)} ${ev.have ?? ''}`, 'xp', { life: 1 }); }
        else if (ev.kind === 'item') {
          sfx.pickup(ev.item.r);
          H.toast(`${ev.back ? `${rich('reward.item_recovered')} ` : ev.reward ? `${ltext('reward.item_reward')} ` : '+ '}${itemHtml(ev.item)} <small>· ${dataText(SLOT_NAMES[BASES[ev.item.b].slot])} · ${ltext('adventure.slot_level', { level: formatNumber(ev.item.l) })}</small>`, 3600);
          if (!this.settings.bagTaught) { this.settings.bagTaught = true; H.toast(rich('reward.bag_hint'), 5200); }
        }
        break;
      }
      case 'full':
        H.toast(rich(ev.what === 'bag' ? 'reward.bag_full' : 'reward.potions_full'), 3200);
        sfx.denied();
        break;
      case 'gear': sfx.equip(); break;
      case 'spill': {
        // Carried loot is public after any death; the map marks where to recover it.
        this.spill = { x: ev.x, z: ev.z, until: performance.now() + LAWLESS.spill.life * 1000 };
        const what = [ev.n ? ltext(ev.n > 1 ? 'reward.spill_objects' : 'reward.spill_object', { count: formatNumber(ev.n) }) : '', ev.pot ? ltext(ev.pot > 1 ? 'reward.spill_potions' : 'reward.spill_potion', { count: formatNumber(ev.pot) }) : ''].filter(Boolean).join(ltext('reward.spill_and'));
        const xpLoss = ltext('reward.death_xp_loss', { percent: formatNumber(Math.round(tuning.combat.deathXpLoss * 100)) });
        H.toast(what ? `${rich('reward.spill_heading')} ${what}${ltext('reward.spill_ground', { minutes: formatNumber(Math.round(LAWLESS.spill.life / 60)) })} ${xpLoss}${rich('reward.spill_map_hint')}`
          : `${rich('reward.spill_empty_heading')} ${xpLoss}`, 8000);
        break;
      }
      case 'sold': if (ev.gold > 0) { sfx.coins(ev.gold); this.over(rich('reward.gold_label', { count: `+${formatNumber(ev.gold)}` }), 'gold', { life: 0.9 }); } break;
      case 'bought':
        if (ev.fail) { sfx.denied(); H.toast(rich(ev.fail === 'gold' ? 'reward.no_gold' : ev.fail === 'max' ? 'reward.potions_full' : ev.fail === 'tier' ? 'reward.tier_locked' : 'reward.bag_full'), 2600); }
        else { sfx.buy(); if (ev.what === 'potion') this.over(rich('reward.potion_float'), 'heal'); }
        break;
      // ---- Tattoos (M4.7) ----
      case 'commandDenied':
        sfx.denied(); H.toast(rich('reward.action_unavailable'), 5000); break;
      case 'pearlDenied': {
        const why = { combat: 'combat', stale: 'stale', bound: 'bound', confirm: 'confirm', full: 'full', far: 'far', notForSale: 'sale', unknown: 'unknown' };
        sfx.denied(); H.toast(rich(`reward.pearl_denied.${why[ev.why] || 'unknown'}`), 5000); break;
      }
      case 'pearlChanged': {
        if (ev.op === 'swallow') {
          const P = PEARLS[ev.pearl?.kind];
          sfx.mastery();
          H.toast(P ? rich('reward.swallowed', { name: dataParam(P.name), skill: dataParam(SKILLS[P.skill].name), passive: dataParam(P.passive), curse: dataParam(P.curse) }) : rich('reward.swallowed_generic'), 6200);
        }
        else if (ev.op === 'death') H.toast(rich('reward.pearl_death'), 6000);
        else if (ev.op === 'give' || ev.op === 'leave') { sfx.equip(); H.toast(rich(ev.op === 'give' ? 'reward.pearl_given' : 'reward.pearl_dropped'), 3600); }
        break;
      }
      case 'skillDenied': sfx.denied(); H.toast(rich(DENY[ev.why] || DENY.unknown), 3000); break;
      case 'learned': {
        const T = TATTOOS[ev.id];
        if (!T) break;
        sfx.mastery();
        this.over(rich('reward.tattoo_learn_float', { name: dataParam(T.name, 'upper') }), 'level', { life: 1.4, rise: 50 });
        H.toast(`${rich(ev.cost ? 'reward.tattoo_learn_paid' : 'reward.tattoo_learn_free', { name: dataParam(T.name), cost: formatNumber(ev.cost || 0) })}<br>${rich('reward.tattoo_slot_hint')}`, 5600);
        break;
      }
      case 'tattooRank': {
        const T = TATTOOS[ev.id];
        if (!T) break;
        sfx.levelUp();
        const F = T.forms.find((f, i) => i > 0 && f.rank === ev.rank);
        this.over(rich('reward.tattoo_rank_float', { name: dataParam(T.name, 'upper'), rank: ROMAN[ev.rank] }), 'level', { life: 1.4, rise: 50 });
        H.toast(`${rich('reward.tattoo_rank_toast', { name: dataParam(T.name), rank: ROMAN[ev.rank] })}${F ? `<br>${rich('reward.tattoo_form_new', { name: dataParam(F.name), hint: dataParam(F.hint) })}` : ''}`, 5600);
        H.pulse(skillId(this.ps.skQ) === ev.id ? 'q' : 'e');
        break;
      }
      case 'loadout': case 'form': sfx.equip(); break;
      case 'mastery': {
        const kind = WEAPON_KINDS[ev.kit], W = WEAPONS[kind];
        sfx.mastery();
        this.over(rich('reward.mastery_float', { level: formatNumber(ev.level) }), 'level', { life: 1.6, rise: 60 });
        let what = rich('reward.mastery_damage', { percent: formatNumber(Math.round(MASTERY.dmg * 100)), weapon: dataParam(W.short, 'lower') });
        if (ev.opens) { const id = W[SLOT_SKILL[ev.opens]]; what = rich('reward.mastery_open', { slot: ev.opens.toUpperCase(), skill: dataParam(SKILLS[id].name), hint: dataParam(SKILLS[id].hint, 'lower') }); }
        else if (ev.passive) { const p = MASTERY.passives[kind].find((q) => q.id === ev.passive); if (p) what = rich('reward.mastery_passive', { name: dataParam(p.name), hint: dataParam(p.hint) }); }
        H.toast(`${rich('reward.mastery_title', { weapon: dataParam(W.name), level: formatNumber(ev.level) })}<br>${what}`, 5600);
        break;
      }
      case 'quest': {
        const Q = QUESTS[ev.id];
        if (!Q) break;
        if (ev.st === 'start') { sfx.questStart(); H.toast(`${rich('reward.quest_new')} ${dataText(Q.name)}<br><small>${dataText(Q.text)}</small>`, 5200); }
        else if (ev.st === 'progress') this.over(`${dataText(Q.name)} ${formatNumber(ev.n)}/${formatNumber(ev.of)}`, 'xp', { life: 1.1, rise: 26 });
        else if (ev.st === 'ready') { sfx.questStart(); H.toast(rich('reward.quest_ready', { quest: dataParam(Q.name), npc: Q.turnin === 'vendor' ? 'Tía Perla' : 'Capitana Brea' }), 4600); }
        else if (ev.st === 'done') {
          sfx.questDone();
          const R = ev.reward || {}, bits = [];
          if (R.xp) bits.push(`${formatNumber(R.xp)} XP`);
          if (R.gold) bits.push(ltext('adventure.reward_gold', { amount: formatNumber(R.gold) }));
          if (R.potions) bits.push(ltext(R.potions > 1 ? 'adventure.reward_potions' : 'adventure.reward_potion', { amount: formatNumber(R.potions) }));
          if (R.item) bits.push(ltext('adventure.reward_item'));
          H.toast(`${rich('reward.quest_done')} ${dataText(Q.name)}${bits.length ? `<br><small>${bits.join(' · ')}</small>` : ''}`, 4600);
          this.over(rich('reward.quest_done_float'), 'perfect', { life: 1.4, rise: 50 });
        }
        break;
      }
      case 'tier': {
        const T = ENCOUNTERS.caldera.tiers;
        if (ev.why === 'open') { sfx.mastery(); H.toast(rich('reward.tier_unlocked', { tier: dataParam(T[ev.open - 1].name) }), 6200); }
        else { sfx.click(); H.toast(rich('reward.tier_selected', { tier: dataParam(T[ev.sel - 1].name) }), 2400); }
        break;
      }
      case 'locked': {
        const now = performance.now();
        if (now - this.lockT < 1200) break;
        this.lockT = now;
        if (ev.slot === 'g') { sfx.locked(); H.denySlot('g'); H.toast(rich('reward.g_needs_pearl'), 3400); break; }
        const kind = WEAPON_KINDS[this.ps.weapon] || 'sable', W = WEAPONS[kind], id = W[SLOT_SKILL[ev.slot]];
        sfx.locked();
        H.denySlot(ev.slot);
        H.toast(rich('reward.skill_locked', { skill: dataParam(SKILLS[id].name), level: formatNumber(MASTERY.unlock[ev.slot]), weapon: dataParam(W.short, 'lower') }), 3400);
        break;
      }
      case 'potion': {
        if (ev.denied) {
          sfx.denied();
          if (ev.denied === 'empty') H.toast(rich('reward.no_potions'), 2800);
          else if (ev.denied === 'full') this.over(rich('reward.health_full'), 'info', { life: 0.8 });
          H.denySlot('pot');
          break;
        }
        sfx.potion();
        this.over(`+${formatNumber(ev.heal)}`, 'heal', { life: 1.1 });
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
