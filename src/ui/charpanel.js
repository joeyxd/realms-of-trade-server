// The character panel (M4, PLAN-M4.md §2.7): Equipo (what you wear around your portrait, the bag, gold and
// potions; Tía Perla's stall in its place when you trade), Atributos (every number, each weapon's mastery and
// what it opens), Misiones (the journal) and Tatuajes (M4.7: the Q / E of the weapon you carry and your repertoire —
// the weapon's arts, the tattoos you know with their rank, tinta and forms, the ones Doña Sepia can still teach you).
// It never pauses the world. Everything it does is a `cmd`; the server answers with a new profile and the panel
// redraws from it.
import { gsap } from 'gsap';
import { SLOTS, SLOT_NAMES, BASES, ITEMS, CONSUMABLES, CRATES, STATS } from '../data/items.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, MASTERY, formed } from '../data/weapons.js';
import { ARTS, TATTOOS, TATTOO_IDS, TATTOO, DEFAULT_LOADOUT, castKind, formRank, tattooXpToNext } from '../data/tattoos.js';
import { skillIcon, ROMAN } from './hud.js';
import { QUESTS, QUEST_IDS, QST, NPC_TALK, goalCount } from '../data/quests.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { tuning } from '../data/tuning.js';
import { itemScore, itemValue } from '../sim/items.js';
import { gearTotals, statsFor } from '../sim/systems/stats.js';
import { canAccept } from '../sim/systems/quests.js';
import { esc, itemIcon, slotIcon, itemCard, targetSlot, statText } from './itemui.js';
import { sfx } from '../audio/sfx.js';
import { stage } from './stage.js';
import { pearlHtml } from './pearlpanel.js';
import { packInventoryHtml } from './packInventory.js';
import { loggingSkillHtml } from './loggingSkill.js';
import { dataText, dataParam, text as ltext, rich, translateData, t, formatNumber, onLocaleChange } from '../core/i18n.js';

const TABS = [['gear', 'adventure.tab.gear', 'I'], ['stats', 'adventure.tab.stats', 'C'], ['quests', 'adventure.tab.quests', 'L'], ['tattoo', 'adventure.tab.tattoos', 'T'], ['pearl', 'adventure.tab.pearls', 'P'], ['logging', 'systems.logging.tab', '']];
const DOLL = [['head', 'top'], ['weapon', 'left'], ['chest', 'left2'], ['ring1', 'right'], ['ring2', 'right2'], ['boots', 'bottom']];
const pct = (v, d = 0) => formatNumber(v * 100, { maximumFractionDigits: d, minimumFractionDigits: d }) + ' %';

export class CharPanel {
  constructor(root, { send, profile, stats, portrait, onClose, nearby, backpack, locale = 'es' }) {
    Object.assign(this, { root, send, profile, stats, portrait, onClose, nearby, backpack, locale });
    this.tab = 'gear';
    this.shop = false;
    this.pinned = null; // {where: 'bag' | 'worn', uid, slot}
    this.hover = null;
    this.confirm = 0;
    this.seen = new Set(); // uids already shown (the rest get «NUEVO»)
    this.isOpen = false;
    this.unsubscribeLocale = onLocaleChange(() => this.refresh());
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('dblclick', (e) => { const c = e.target.closest('[data-bag]'); if (c) this.equip(+c.dataset.bag); });
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const c = e.target.closest('[data-bag], [data-slot]');
      const h = c ? (c.dataset.bag ? { where: 'bag', uid: +c.dataset.bag } : { where: 'worn', slot: c.dataset.slot }) : null;
      if (JSON.stringify(h) !== JSON.stringify(this.hover)) { this.hover = h; if (!this.pinned) this.renderDetail(); }
    });
  }

  open(tab = this.tab, { shop = false, learn = false } = {}) {
    this.tab = tab; this.shop = shop; this.pinned = null; this.hover = null; this.learn = learn;
    this.render();
    this.root.hidden = false;
    if (!this.isOpen) gsap.fromTo(this.root.querySelector('.cp'), { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.8)' });
    this.isOpen = true;
    sfx.click();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.shop = false; this.learn = false;
    this.root.hidden = true;
    const p = this.profile();
    if (p) for (const it of p.bag) this.seen.add(it.u);
    if (this.onClose) this.onClose();
  }
  toggle(tab) { if (this.isOpen && this.tab === tab && !this.shop) this.close(); else this.open(tab); }
  // Something unseen in the bag (the HUD's dot).
  hasNew() { const p = this.profile(); return !!p && p.bag.some((it) => !this.seen.has(it.u)); }
  refresh() {
    if (!this.isOpen) return;
    const active = this.root.contains(document.activeElement) ? document.activeElement : null;
    const identity = active && ['tab', 'bag', 'slot', 'buy', 'act', 'pearlOp'].find((key) => active.hasAttribute(`data-${key}`));
    const value = active && 'value' in active ? active.value : null;
    const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    this.render();
    if (!active) return;
    const replacement = identity ? [...this.root.querySelectorAll(`[data-${identity}]`)].find((node) => node.dataset[identity] === active.dataset[identity])
      : this.root.querySelector(active.matches('[data-close]') ? '[data-close]' : '.cp');
    if (!replacement) return;
    if (value !== null && 'value' in replacement) replacement.value = value;
    replacement.focus({ preventScroll: true });
    if (start !== null && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(start, end);
  }

  // ---- Actions ---------------------------------------------------------------------------------------------
  equip(uid, slot) { this.send({ type: 'equip', uid, ...(slot ? { slot } : {}) }); this.pinned = null; sfx.click(); }
  onClick(e) {
    const t = e.target;
    if (t.closest('[data-close]')) { this.close(); sfx.click(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { this.tab = tab.dataset.tab; this.shop = this.shop && this.tab === 'gear'; this.learn = this.learn && this.tab === 'tattoo'; this.pinned = null; this.render(); sfx.click(); return; }
    if (this.tab === 'tattoo' && this.tattooClick(t)) return;
    const pearl = t.closest('[data-pearl-op]');
    if (pearl) { this.pearlClick(pearl); return; }
    const buy = t.closest('[data-buy]');
    if (buy) { this.send({ type: 'buy', what: buy.dataset.buy }); return; }
    const act = t.closest('[data-act]');
    if (act) { this.action(act.dataset.act); return; }
    const bag = t.closest('[data-bag]');
    if (bag) { this.pinned = { where: 'bag', uid: +bag.dataset.bag }; this.confirm = 0; this.renderDetail(); this.mark(); this.reveal(); sfx.click(); return; }
    const slot = t.closest('[data-slot]');
    if (slot) { const p = this.profile(); if (p && p.eq[slot.dataset.slot]) { this.pinned = { where: 'worn', slot: slot.dataset.slot }; this.confirm = 0; this.renderDetail(); this.mark(); this.reveal(); sfx.click(); } return; }
  }
  action(id) {
    const p = this.profile(), sel = this.pinned;
    if (!p || !sel) return;
    if (id === 'equip') this.equip(sel.uid);
    else if (id === 'unequip') { this.send({ type: 'unequip', slot: sel.slot }); this.pinned = null; sfx.click(); }
    else if (id === 'salvage' || id === 'sell') {
      const it = p.bag.find((x) => x.u === sel.uid);
      // Breaking something rare asks once more.
      if (it && it.r >= 2 && this.confirm !== sel.uid) { this.confirm = sel.uid; this.renderDetail(); sfx.click(); return; }
      this.send({ type: id, uid: sel.uid });
      this.pinned = null; this.confirm = 0;
    }
  }

  // ---- Rendering -----------------------------------------------------------------------------------------
  render() {
    const p = this.profile();
    const locale = typeof this.locale === 'function' ? this.locale() : this.locale;
    const tabs = TABS.map(([id, label, key]) => `<button class="tab" data-tab="${id}" aria-selected="${this.tab === id}">${t(label)}${key ? ` <span class="kbd">${key}</span>` : ''}</button>`).join('');
    const html = `<div class="cp frame interactive" role="dialog" aria-label="${t('adventure.aria.character')}">
      <div class="cp-head"><div class="tabs" role="tablist">${tabs}</div><button class="icon-btn cp-x" data-close aria-label="${t('adventure.aria.close')}">✕</button></div>
      <div class="cp-body">${!p ? `<p class="cp-empty">${dataText('Aún no has subido a bordo.')}</p>` : this.tab === 'gear' ? this.gearHtml(p) : this.tab === 'stats' ? this.statsHtml(p) : this.tab === 'tattoo' ? this.tattooHtml(p) : this.tab === 'pearl' ? pearlHtml(p, null, this.nearby?.() || []) : this.tab === 'logging' ? loggingSkillHtml(p.progression, locale) : this.questsHtml(p)}</div>
    </div>`;
    // Profiles come often (mastery XP in a fight): the DOM is only touched when what it shows changes, so a
    // click or the hover never lands on a cell that was rebuilt under the pointer.
    if (html === this.html && this.root.firstElementChild) { this.renderDetail(); this.mark(); return; }
    const scroll = this.renderedTab === this.tab ? this.root.querySelector('.cp-body')?.scrollTop || 0 : 0;
    this.html = html; this.detail = null; this.renderedTab = this.tab;
    this.root.innerHTML = html;
    this.root.querySelector('.cp-body').scrollTop = scroll;
    if (p && this.tab === 'gear') {
      const c = this.root.querySelector('.cp-portrait canvas');
      if (c && this.portrait) this.portrait(c);
      this.renderDetail();
      this.mark();
    }
  }

  // On a phone the card is under the bag: bring it into view.
  reveal() {
    const box = this.root.querySelector('.cp-detail');
    if (box && stage.w <= 760) box.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  mark() {
    this.root.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    const s = this.pinned;
    if (!s) return;
    const el = s.where === 'bag' ? this.root.querySelector(`[data-bag="${s.uid}"]`) : this.root.querySelector(`[data-slot="${s.slot}"]`);
    if (el) el.classList.add('sel');
  }

  cell(it) {
    const fresh = !this.seen.has(it.u);
    return `<button class="bag-cell r${it.r}" data-bag="${it.u}" style="--rc:var(--r-${['common', 'uncommon', 'rare', 'epic', 'legend'][it.r]})" aria-label="${esc(translateData(BASES[it.b].name))}">${itemIcon(it)}<i class="lv">${it.l}</i>${fresh ? `<b class="new">${dataText('NUEVO')}</b>` : ''}</button>`;
  }

  gearHtml(p) {
    const st = this.stats();
    const doll = DOLL.map(([slot, pos]) => {
      const it = p.eq[slot];
      return `<button class="doll-slot ${pos}${it ? ' r' + it.r : ' empty'}" data-slot="${slot}" title="${translateData(SLOT_NAMES[slot])}" style="${it ? `--rc:var(--r-${['common', 'uncommon', 'rare', 'epic', 'legend'][it.r]})` : ''}">${it ? itemIcon(it) : slotIcon(slot)}<span>${dataText(SLOT_NAMES[slot])}</span></button>`;
    }).join('');
    const left = this.shop ? this.shopHtml(p) : `<div class="doll">${doll}<div class="cp-portrait"><canvas width="160" height="160"></canvas></div></div>
      <div class="cp-mini"><span>ATK <b>${st.atk}</b></span><span>DEF <b>${st.def}</b></span><span>${dataText('Vida')} <b>${st.maxHp}</b></span></div>`;
    const cells = p.bag.map((it) => this.cell(it)).join('') + Array.from({ length: Math.max(0, ITEMS.bag - p.bag.length) }, () => '<span class="bag-cell empty"></span>').join('');
    const backpack = this.backpack?.() || { pack: p.eco?.pack, pendingGoods: {} };
    return `<div class="cp-gear">
      <div class="cp-left">${left}</div>
      <div class="cp-right">
        <div class="bag-head"><b>${dataText('Bolsa')}</b> <small>${p.bag.length}/${ITEMS.bag}</small><span class="cp-gold">${st.gold} ${dataText('oro')}</span><span class="cp-pot">🧪 ${st.potions}/${CONSUMABLES.potion.max}</span></div>
        <div class="bag-grid">${cells}</div>
        ${packInventoryHtml(p, backpack, typeof this.locale === 'function' ? this.locale() : this.locale)}
        <div class="cp-detail"></div>
      </div>
    </div>`;
  }

  shopHtml(p) {
    const st = this.stats(), P = CONSUMABLES.potion;
    const row = (what, name, price, note, ok, lock) => `<div class="shop-row${lock ? ' locked' : ''}"><div><b>${dataText(name)}</b><small>${note}</small></div><button class="btn" data-buy="${what}" ${ok ? '' : 'disabled'}>${lock ? '🔒 ' : ''}${formatNumber(price)} ${dataText('oro')}</button></div>`;
    // The crates: a random item of your level, and the Mareas' (better ones) once you have opened that Marea.
    const crates = CRATES.map((k) => {
      const C = CONSUMABLES[k], K = C.crate, lock = K.tier && p.flags.tier < K.tier;
      const note = lock ? ltext(`adventure.shop_locked_tier_${K.tier}`) : K.ilvl ? rich('adventure.shop_crate_level', { level: formatNumber(st.level + K.ilvl), rarity: K.minRarity ? t('adventure.shop_crate_level_rarity') : '' }) : ltext('adventure.shop_crate_any');
      return row(k, C.name, C.price, note, !lock && p.gold >= C.price && p.bag.length < ITEMS.bag, lock);
    }).join('');
    return `<div class="shop"><h4>${rich('adventure.shop_title', { name: NPC_TALK.vendor.name })}</h4>
      ${row('potion', P.name, P.price, rich('adventure.shop_heal', { percent: Math.round(P.heal * 100), current: st.potions, max: P.max }), p.gold >= P.price && st.potions < P.max)}
      ${crates}
      <p class="shop-note">${ltext('adventure.shop_hint')} <b>${dataText('venderlo')}</b>: ${rich('adventure.shop_salvage', { percent: Math.round(ITEMS.salvage * 100) })}</p></div>`;
  }

  // The card of the pinned item (or the one under the mouse), with what you can do with it.
  renderDetail() {
    const box = this.root.querySelector('.cp-detail'), p = this.profile();
    if (!box || !p) return;
    const out = { innerHTML: '' };
    this.detailHtml(out, p);
    if (out.innerHTML !== this.detail) { this.detail = out.innerHTML; box.innerHTML = out.innerHTML; }
  }
  detailHtml(box, p) {
    const sel = this.pinned || this.hover;
    if (!sel) { box.innerHTML = `<p class="cp-hint">${ltext(this.shop ? 'adventure.bag_hint_sell' : 'adventure.bag_hint_select')}</p>`; return; }
    if (sel.where === 'bag') {
      const it = p.bag.find((x) => x.u === sel.uid);
      if (!it) { box.innerHTML = ''; this.pinned = null; return; }
      const slot = targetSlot(it, p.eq, itemScore), worn = p.eq[slot];
      const v = itemValue(it), sv = v > 0 ? Math.max(1, Math.round(v * ITEMS.salvage)) : 0;
      const sure = this.confirm === it.u;
      const actions = this.pinned ? [
        { id: 'equip', label: ltext('adventure.equip') },
        this.shop ? { id: 'sell', label: sure ? rich('adventure.confirm', { value: formatNumber(v) }) : rich('adventure.sell', { value: formatNumber(v) }), cls: 'secondary' } : { id: 'salvage', label: sure ? rich('adventure.confirm', { value: formatNumber(sv) }) : rich('adventure.salvage', { value: formatNumber(sv) }), cls: 'secondary' },
      ] : [];
      const B = BASES[it.b];
      const kitNote = B.slot === 'weapon' && WEAPONS[B.weapon] && B.weapon !== WEAPON_KINDS[this.stats().weapon] ? rich('adventure.item_kit_note', { weapon: dataParam(WEAPONS[B.weapon].name) }) : '';
      box.innerHTML = itemCard(it, { where: 'bag', worn, actions, kitNote });
    } else {
      const it = p.eq[sel.slot];
      if (!it) { box.innerHTML = ''; return; }
      box.innerHTML = itemCard(it, { where: 'worn', actions: this.pinned && sel.slot !== 'weapon' ? [{ id: 'unequip', label: ltext('adventure.unequip'), cls: 'secondary' }] : [] });
    }
  }

  statsHtml(p) {
    const st = this.stats(), g = gearTotals(p), base = statsFor(st.level);
    const red = st.def / (st.def + tuning.stats.defK);
    const crit = tuning.stats.crit + Math.min(STATS.crit.cap - tuning.stats.crit, g.crit), critD = tuning.stats.critMult + g.critD;
    const rows = [
      ['adventure.stat_level', `${st.level}`, '', true],
      ['adventure.stat_attack', `${formatNumber(st.atk)}`, rich('adventure.stats_attack_note', { base: formatNumber(base.atk), gear: formatNumber(g.atk) }), true],
      ['adventure.stat_defense', `${formatNumber(st.def)}`, rich('adventure.stats_defense_note', { percent: pct(red).replace(/\s*%$/, '') }), true],
      ['adventure.stat_health', `${st.maxHp}`, '', true],
      ['adventure.stat_critical', pct(crit, 1), rich('adventure.stats_critical_note', { multiplier: formatNumber(critD, { maximumFractionDigits: 2 }) }), true],
      ['adventure.stat_speed', `${formatNumber(st.speed, { maximumFractionDigits: 2 })} u/s`, st.speed !== tuning.player.runSpeed ? statText('spd', st.speed / tuning.player.runSpeed - 1) : '', true],
      ['adventure.stat_cooldown', st.cdr > 0 ? '−' + pct(st.cdr) : '—', ltext('adventure.stats_qe'), true],
      ['Carga de RIPOSTE', pct(st.ripMul - 1), ''],
      ['Daño de reflejos', pct(st.reflMul - 1), dataText('reflejos y balas devueltas')],
      ['adventure.stat_guard', `${Math.round(st.guardMax)}`, '', true],
      ['adventure.stat_dash', `${formatNumber(tuning.dash.recharge * st.dashRec, { maximumFractionDigits: 2 })} s`, '', true],
      ['adventure.stat_parry', st.winBonus ? statText('win', st.winBonus).split(' ')[0] + ' ms' : '—', dataText('EXCELENTE y BUENO'), true],
      ['adventure.stat_potions', `+${Math.round((st.potHeal - 1) * 100)} %`, rich('adventure.stats_potion_note', { percent: Math.round(CONSUMABLES.potion.heal * st.potHeal * 100) }), true],
      ['adventure.stat_xp', `+${Math.round((st.xpMul - 1) * 100)} %`, '', true],
      ['adventure.stat_gold', `+${Math.round(g.gold * 100)} %`, '', true],
      ['Vida al matar', `${Math.round(g.kill)}`, ''],
    ];
    const mast = WEAPON_KINDS.map((k, i) => {
      const W = WEAPONS[k], m = p.mast[i] || [1, 0], lvl = m[0], next = MASTERY.xp[Math.min(MASTERY.xp.length - 1, lvl - 1)];
      const steps = [['q', MASTERY.unlock.q], ['e', MASTERY.unlock.e], ['r', MASTERY.unlock.r]].map(([s, at]) => `<li class="${lvl >= at ? 'ok' : ''}"><b>M${at}</b> ${s.toUpperCase()} ${dataText(SKILLS[W[s]].name)}</li>`);
      for (const ps of MASTERY.passives[k]) steps.push(`<li class="${lvl >= ps.at ? 'ok' : ''}"><b>M${ps.at}</b> ${dataText(ps.name)}: ${dataText(ps.hint)}</li>`);
      return `<div class="mast-card"><div class="mc-head"><b>${dataText(W.name)}</b><span>${ltext('adventure.mastery_title', { level: lvl })}${lvl >= MASTERY.max ? ` · ${ltext('adventure.mastery_max')}` : ''}</span></div>
        <div class="bar xp thin"><div class="fill" style="width:${lvl >= MASTERY.max ? 100 : Math.min(100, (m[1] / next) * 100).toFixed(1)}%"></div><div class="num">${lvl >= MASTERY.max ? '—' : `${Math.floor(m[1])} / ${next}`}</div></div>
        <ul>${steps.join('')}</ul><small>${ltext('adventure.mastery_damage', { percent: Math.round(MASTERY.dmg * 100) })}</small></div>`;
    }).join('');
    const T = ENCOUNTERS.caldera.tiers;
    const tiers = T.map((t, i) => `<span class="${i < p.flags.tier ? 'ok' : ''}">${dataText(t.name)}${i + 1 === p.flags.tierSel ? ' ✓' : ''}</span>`).join('');
    return `<div class="cp-stats"><div class="st-table">${rows.map(([a, b, c, key]) => `<div class="st-row"><span>${key ? ltext(a) : dataText(a)}</span><b>${b}</b><small>${c}</small></div>`).join('')}</div>
      <div class="st-side">${mast}<div class="mast-card"><div class="mc-head"><b>${ltext('adventure.caldera')}</b></div><div class="tiers">${tiers}</div>
      <small>${ltext('adventure.stats_caldera', { kills: formatNumber(p.stats.kills), wins: formatNumber(p.stats.wins), gold: formatNumber(p.stats.gold), items: formatNumber(p.stats.items) })}</small></div></div></div>`;
  }

  questsHtml(p) {
    const st = (id) => (p.quests[id] ? p.quests[id][0] : QST.NONE);
    const reward = (R) => [R.xp && ltext('adventure.reward_xp', { amount: formatNumber(R.xp) }), R.gold && ltext('adventure.reward_gold', { amount: formatNumber(R.gold) }), R.potions && ltext(R.potions > 1 ? 'adventure.reward_potions' : 'adventure.reward_potion', { amount: formatNumber(R.potions) }), R.item && ltext('adventure.reward_item')].filter(Boolean).join(' · ');
    const card = (id, cls, note) => {
      const Q = QUESTS[id], n = goalCount(Q), q = p.quests[id] || [0, 0];
      return `<div class="q-card ${cls}"><b>${dataText(Q.name)}</b><p>${dataText(Q.text)}</p>${n > 1 && cls === 'active' ? `<div class="bar xp thin"><div class="fill" style="width:${(Math.min(n, q[1]) / n * 100).toFixed(0)}%"></div><div class="num">${formatNumber(Math.min(n, q[1]))} / ${formatNumber(n)}</div></div>` : ''}<small>${note || ''}${reward(Q.reward || {}) ? ` ${ltext('adventure.quest_reward')} ${reward(Q.reward)}` : ''}</small></div>`;
    };
    const active = QUEST_IDS.filter((id) => st(id) === QST.ACTIVE).map((id) => card(id, 'active'));
    const ready = QUEST_IDS.filter((id) => st(id) === QST.READY).map((id) => card(id, 'ready', ltext(QUESTS[id].turnin === 'vendor' ? 'adventure.ready_npc.vendor' : 'adventure.ready_npc.captain')));
    const offers = QUEST_IDS.filter((id) => canAccept(p, id)).map((id) => card(id, 'offer', ltext(QUESTS[id].giver === 'vendor' ? 'adventure.offer_npc.vendor' : 'adventure.offer_npc.captain')));
    const done = QUEST_IDS.filter((id) => st(id) === QST.DONE).map((id) => `<li>${dataText(QUESTS[id].name)}</li>`);
    return `<div class="cp-quests">${[...ready, ...active].join('') || `<p class="cp-hint">${ltext('adventure.quest_none')}</p>`}
      ${offers.length ? `<h4>${ltext('adventure.quest_available')}</h4>${offers.join('')}` : ''}
      ${done.length ? `<h4>${ltext('adventure.quest_done')}</h4><ul class="q-done">${done.join('')}</ul>` : ''}</div>`;
  }

  // ---- Tatuajes (M4.7) ---------------------------------------------------------------------------------------
  // The Q / E of the weapon you carry on top; the repertoire below (this weapon's arts, the tattoos you know, the ones
  // still to learn); the card you pick shows its numbers, its forms and what you can do with it.
  tattooHtml(p) {
    const w = this.stats().weapon | 0, kind = WEAPON_KINDS[w], W = WEAPONS[kind];
    const sk = p.sk || { has: {}, lo: [], free: 1 }, lo = sk.lo[w] || DEFAULT_LOADOUT[kind];
    const mlvl = (p.mast[w] || [1])[0], sel = this.ttSel || lo[0];
    const has = (id) => sk.has[id];
    const nameOf = (id) => (TATTOOS[id] || SKILLS[id]).name;
    const tinta = (id) => {
      const ink = has(id); if (!ink) return '';
      const top = ink[0] >= TATTOO.maxRank, next = tattooXpToNext(ink[0]);
      return `<div class="bar xp thin tinta"><div class="fill" style="width:${top ? 100 : Math.min(100, (ink[1] / next) * 100).toFixed(1)}%"></div><div class="num">${top ? ltext('adventure.inkFull') : ltext('adventure.inkProgress', {amount:formatNumber(Math.floor(ink[1])),next:formatNumber(next)})}</div></div>`;
    };
    const formOf = (id) => (has(id) ? has(id)[2] | 0 : 0);
    const rankLabel = (rank) => ltext('adventure.tattoo_range', { rank: ROMAN[rank] });
    const slotCard = (slot, i) => {
      const id = lo[i], T = TATTOOS[id], f = formOf(id), F = T ? T.forms[f] : null;
      const detail = T
        ? `${F ? `${dataText(F.name)} · ` : ''}${rankLabel(has(id) ? has(id)[0] : 1)}`
        : ltext('adventure.tattoo_art', { weapon: dataParam(W.short, 'lower') });
      return `<button class="tt-slot${id === sel ? ' sel' : ''}${T ? ' tattoo' : ''}" data-tt="${id}"><span class="kbd">${slot.toUpperCase()}</span><span class="tt-ico">${skillIcon(id)}</span>
        <span class="tt-name"><b>${dataText(nameOf(id))}</b><small>${detail}</small></span>${T ? tinta(id) : ''}</button>`;
    };
    const card = (id, kindCls, note, locked) => `<button class="tt-card ${kindCls}${locked ? ' locked' : ''}${id === sel ? ' sel' : ''}${lo.includes(id) ? ' worn' : ''}" data-tt="${id}">
      <span class="tt-ico">${skillIcon(id)}</span><span class="tt-name"><b>${dataText(nameOf(id))}</b><small>${note}</small></span>
      ${has(id) ? `<i class="rk">${ROMAN[has(id)[0]]}</i>` : ''}${lo.includes(id) ? `<i class="in">${lo[0] === id ? 'Q' : 'E'}</i>` : ''}</button>`;
    const arts = Object.keys(ARTS).filter((id) => ARTS[id].weapon === kind).map((id) => {
      const need = ARTS[id].mastery, locked = mlvl < need;
      const note = locked ? ltext('adventure.tattoo_locked_mastery', { level: formatNumber(need) }) : ltext('adventure.tattoo_art', { weapon: dataParam(W.short, 'lower') });
      return card(id, 'art', note, locked);
    }).join('');
    const known = TATTOO_IDS.filter((id) => has(id)).map((id) => card(id, 'tattoo', `${dataText(TATTOOS[id].forms[formOf(id)].name)} · ${rankLabel(has(id)[0])}`)).join('');
    const price = sk.free ? t('adventure.tattoo_learn_free') : `${formatNumber(TATTOO.price)} ${t('adventure.gold')}`;
    const unknown = TATTOO_IDS.filter((id) => !has(id)).map((id) => card(id, 'tattoo unlearned', this.learn ? ltext('adventure.tattoo_action_learn', { price }) : ltext('adventure.tattoo_learn_hint'), !this.learn)).join('');
    return `<div class="cp-tattoo">
      <div class="tt-top"><div class="tt-weapon"><b>${dataText(W.name)}</b><small>${ltext('adventure.tattoo_weapon_slots')}${this.learn ? ` · ${ltext('adventure.tattoo_ink_lady')}` : ''}</small></div>
        <div class="tt-slots">${slotCard('q', 0)}${slotCard('e', 1)}</div></div>
      <div class="tt-body">
        <div class="tt-list"><h4>${ltext('adventure.tattoo_list_art', { weapon: dataParam(W.short, 'lower') })}</h4><div class="tt-grid">${arts}</div>
          <h4>${ltext('adventure.tattoo_list_tattoos')}</h4><div class="tt-grid">${known}${unknown}</div></div>
        <div class="tt-detail">${this.tattooDetail(p, sel, { lo, has, mlvl, kind, price })}</div>
      </div>
      <p class="tt-note">${ltext('adventure.tattoo_note')}</p>
    </div>`;
  }

  // The cast description is made from numeric, display-only values. Catalog templates carry its language.
  tattooNumbers(id, form) {
    const S = formed(id, form), n = (v) => formatNumber(+v, { maximumFractionDigits: 2 });
    if (id === 'tromba') return ltext('adventure.tattoo_num_tromba', {
      range: n(S.range), radius: n(S.r), attack: n(S.mult), stun: n(S.lift),
      linger: S.linger ? t('adventure.tattoo_num_linger', { duration: n(S.linger) }) : '',
      twin: S.twin ? t('adventure.tattoo_num_twin') : '', cooldown: n(S.cd),
    });
    if (id === 'leap') return S.blink
      ? ltext('adventure.tattoo_num_leap_blink', { range: n(S.range), attack: n(S.empMult), cooldown: n(S.cd) })
      : ltext('adventure.tattoo_num_leap', { min: n(S.min), range: n(S.range), radius: n(S.r), attack: n(S.mult),
        stun: S.stun ? t('adventure.tattoo_num_stun', { duration: n(S.stun) }) : '', cooldown: n(S.cd) });
    if (id === 'wheel') return ltext('adventure.tattoo_num_wheel', {
      fastRange: n(S.fast.range), slowRange: n(S.slow.range),
      fastAttack: n(S.fast.mult * (S.multMul || 1)), slowAttack: n(S.slow.mult * (S.multMul || 1)),
      hang: S.hang ? t('adventure.tattoo_num_hang', { duration: n(S.hang) }) : '',
      refund: S.refund ? t('adventure.tattoo_num_refund', { percent: formatNumber(Math.round(S.refund * 100)) }) : t('adventure.tattoo_num_no_refund'),
      cooldown: n(S.cd),
    });
    if (id === 'lunge') return ltext('adventure.tattoo_num_lunge', { distance: n(S.dist), attack: n(S.mult), cooldown: n(S.cd) });
    if (id === 'wave') return ltext('adventure.tattoo_num_wave', { distance: n(S.speed * S.life), attack: n(S.mult), cooldown: n(S.cd) });
    if (id === 'blast') return ltext('adventure.tattoo_num_blast', { count: formatNumber(S.n), attack: n(S.mult), cooldown: n(S.cd) });
    if (id === 'blink') return ltext('adventure.tattoo_num_blink', { distance: n(S.dist), cooldown: n(S.cd) });
    return SKILLS[id].cd ? `${n(SKILLS[id].cd)} s` : '';
  }

  tattooDetail(p, id, { lo, has, mlvl, kind, price }) {
    if (!id) return `<p class="cp-hint">${ltext('adventure.tattoo_select')}</p>`;
    const T = TATTOOS[id], owned = has(id), form = owned ? owned[2] | 0 : 0, rank = owned ? owned[0] : 0;
    const how = ltext(`adventure.tattoo_how_${castKind(id)}`);
    const art = ARTS[id], artLocked = art && mlvl < art.mastery;
    let forms = '', actions = '';
    if (T) {
      forms = `<div class="tt-forms">${T.forms.map((F, i) => {
        const need = formRank(id, i), lockedF = !owned || rank < need;
        const formLabel = i === 0 ? 'adventure.tattoo_form_base' : i === 1 ? 'adventure.tattoo_form_a' : 'adventure.tattoo_form_b';
        return `<button class="tt-form${i === form ? ' on' : ''}${lockedF ? ' locked' : ''}" data-form="${i}" ${lockedF || !owned ? 'disabled' : ''}><b>${ltext(formLabel)} · ${dataText(F.name)}</b><small>${lockedF && owned ? ltext('adventure.tattoo_form_rank', { rank: ROMAN[need] }) : dataText(F.hint)}</small></button>`;
      }).join('')}</div>`;
    }
    if (T && !owned) {
      actions = this.learn ? `<button class="btn" data-learn="${id}" ${!p.sk.free && p.gold < TATTOO.price ? 'disabled' : ''}>${ltext('adventure.tattoo_action_learn', { price })}</button>` : `<p class="cp-hint">${ltext('adventure.tattoo_lady_hint')}</p>`;
    } else if (artLocked) actions = `<p class="cp-hint">${ltext('adventure.tattoo_art_unlock', { level: formatNumber(art.mastery) })}</p>`;
    else actions = ['q', 'e'].map((slot, i) => `<button class="btn${lo[i] === id ? ' secondary' : ''}" data-put="${slot}" ${lo[i] === id ? 'disabled' : ''}>${lo[i] === id ? ltext('adventure.tattoo_on_slot', { slot: slot.toUpperCase() }) : ltext('adventure.tattoo_put_slot', { slot: slot.toUpperCase() })}</button>`).join('');
    const name = T ? dataText(T.name) : dataText(SKILLS[id].name);
    const title = T ? owned ? ltext('adventure.tattoo_name', { rank: ROMAN[rank] }) : ltext('adventure.tattoo_unequipped') : ltext('adventure.tattoo_arts', { weapon: translateData(WEAPONS[kind].short) });
    return `<div class="tt-card-big"><div class="tt-head"><span class="tt-ico">${skillIcon(id)}</span><div><b>${name}</b><small>${title}</small></div></div>
      <p class="tt-hint">${dataText(T ? T.forms[form].hint : SKILLS[id].hint)}</p>
      <p class="tt-num">${this.tattooNumbers(id, form)}</p><p class="tt-how">${how}</p>
      ${forms}<div class="tt-actions">${actions}</div></div>`;
  }

  tattooClick(t) {
    const put = t.closest('[data-put]'), learn = t.closest('[data-learn]'), form = t.closest('[data-form]'), pick = t.closest('[data-tt]');
    if (put && this.ttSel) { this.send({ type: 'loadout', slot: put.dataset.put, id: this.ttSel }); sfx.click(); return true; }
    if (learn) { this.send({ type: 'learn', id: learn.dataset.learn }); sfx.click(); return true; }
    if (form && this.ttSel && !form.disabled) { this.send({ type: 'form', id: this.ttSel, form: +form.dataset.form }); sfx.click(); return true; }
    if (pick) { this.ttSel = pick.dataset.tt; this.render(); sfx.click(); return true; }
    return false;
  }

  // A refused change (skillDenied): the card shakes.
  pearlClick(button) {
    const op = button.dataset.pearlOp, uid = button.dataset.pearlUid, p = this.profile();
    if (button.disabled || !['swallow', 'leave', 'give'].includes(op) || (op === 'swallow' && p?.pearls?.swallowed)) return;
    const target = op === 'give' ? +this.root.querySelector(`[data-pearl-target="${uid}"]`)?.value : undefined;
    this.send({ type: 'pearl', op, uid, ...(target ? { target } : {}) });
    sfx.click();
  }

  denyTattoo() {
    if (!this.isOpen || this.tab !== 'tattoo') return;
    const el = this.root.querySelector('.tt-card-big');
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }
}
