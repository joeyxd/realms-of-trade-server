// The character panel (M4, PLAN-M4.md §2.7): Equipo (what you wear around your portrait, the bag, gold and
// potions; Tía Perla's stall in its place when you trade), Atributos (every number, each weapon's mastery and
// what it opens) and Misiones (the journal). It never pauses the world. Everything it does is a `cmd`; the
// server answers with a new profile and the panel redraws from it.
import { gsap } from 'gsap';
import { SLOTS, SLOT_NAMES, BASES, ITEMS, CONSUMABLES, CRATES, STATS } from '../data/items.js';
import { WEAPONS, WEAPON_KINDS, SKILLS, MASTERY } from '../data/weapons.js';
import { QUESTS, QUEST_IDS, QST, NPC_TALK, goalCount } from '../data/quests.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { tuning } from '../data/tuning.js';
import { itemScore, itemValue } from '../sim/items.js';
import { gearTotals, statsFor } from '../sim/systems/stats.js';
import { canAccept } from '../sim/systems/quests.js';
import { esc, itemIcon, slotIcon, itemCard, targetSlot, statText } from './itemui.js';
import { sfx } from '../audio/sfx.js';

const TABS = [['gear', 'Equipo', 'I'], ['stats', 'Atributos', 'C'], ['quests', 'Misiones', 'L']];
const DOLL = [['head', 'top'], ['weapon', 'left'], ['chest', 'left2'], ['ring1', 'right'], ['ring2', 'right2'], ['boots', 'bottom']];
const pct = (v, d = 0) => (v * 100).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d }) + ' %';

export class CharPanel {
  constructor(root, { send, profile, stats, portrait, onClose }) {
    Object.assign(this, { root, send, profile, stats, portrait, onClose });
    this.tab = 'gear';
    this.shop = false;
    this.pinned = null; // {where: 'bag' | 'worn', uid, slot}
    this.hover = null;
    this.confirm = 0;
    this.seen = new Set(); // uids already shown (the rest get «NUEVO»)
    this.isOpen = false;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('dblclick', (e) => { const c = e.target.closest('[data-bag]'); if (c) this.equip(+c.dataset.bag); });
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const c = e.target.closest('[data-bag], [data-slot]');
      const h = c ? (c.dataset.bag ? { where: 'bag', uid: +c.dataset.bag } : { where: 'worn', slot: c.dataset.slot }) : null;
      if (JSON.stringify(h) !== JSON.stringify(this.hover)) { this.hover = h; if (!this.pinned) this.renderDetail(); }
    });
  }

  open(tab = this.tab, { shop = false } = {}) {
    this.tab = tab; this.shop = shop; this.pinned = null; this.hover = null;
    this.render();
    this.root.hidden = false;
    if (!this.isOpen) gsap.fromTo(this.root.querySelector('.cp'), { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.8)' });
    this.isOpen = true;
    sfx.click();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.shop = false;
    this.root.hidden = true;
    const p = this.profile();
    if (p) for (const it of p.bag) this.seen.add(it.u);
    if (this.onClose) this.onClose();
  }
  toggle(tab) { if (this.isOpen && this.tab === tab && !this.shop) this.close(); else this.open(tab); }
  // Something unseen in the bag (the HUD's dot).
  hasNew() { const p = this.profile(); return !!p && p.bag.some((it) => !this.seen.has(it.u)); }
  refresh() { if (this.isOpen) this.render(); }

  // ---- Actions ---------------------------------------------------------------------------------------------
  equip(uid, slot) { this.send({ type: 'equip', uid, ...(slot ? { slot } : {}) }); this.pinned = null; sfx.click(); }
  onClick(e) {
    const t = e.target;
    if (t.closest('[data-close]')) { this.close(); sfx.click(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { this.tab = tab.dataset.tab; this.shop = this.shop && this.tab === 'gear'; this.pinned = null; this.render(); sfx.click(); return; }
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
    const tabs = TABS.map(([id, name, key]) => `<button class="tab" data-tab="${id}" aria-selected="${this.tab === id}">${name} <span class="kbd">${key}</span></button>`).join('');
    const html = `<div class="cp frame interactive" role="dialog" aria-label="Personaje">
      <div class="cp-head"><div class="tabs" role="tablist">${tabs}</div><button class="icon-btn cp-x" data-close aria-label="Cerrar">✕</button></div>
      <div class="cp-body">${!p ? '<p class="cp-empty">Aún no has subido a bordo.</p>' : this.tab === 'gear' ? this.gearHtml(p) : this.tab === 'stats' ? this.statsHtml(p) : this.questsHtml(p)}</div>
    </div>`;
    // Profiles come often (mastery XP in a fight): the DOM is only touched when what it shows changes, so a
    // click or the hover never lands on a cell that was rebuilt under the pointer.
    if (html === this.html && this.root.firstElementChild) { this.renderDetail(); this.mark(); return; }
    this.html = html; this.detail = null;
    this.root.innerHTML = html;
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
    if (box && matchMedia('(max-width: 760px)').matches) box.scrollIntoView({ block: 'end', behavior: 'smooth' });
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
    return `<button class="bag-cell r${it.r}" data-bag="${it.u}" style="--rc:var(--r-${['common', 'uncommon', 'rare', 'epic', 'legend'][it.r]})" aria-label="${esc(BASES[it.b].name)}">${itemIcon(it)}<i class="lv">${it.l}</i>${fresh ? '<b class="new">NUEVO</b>' : ''}</button>`;
  }

  gearHtml(p) {
    const st = this.stats();
    const doll = DOLL.map(([slot, pos]) => {
      const it = p.eq[slot];
      return `<button class="doll-slot ${pos}${it ? ' r' + it.r : ' empty'}" data-slot="${slot}" title="${SLOT_NAMES[slot]}" style="${it ? `--rc:var(--r-${['common', 'uncommon', 'rare', 'epic', 'legend'][it.r]})` : ''}">${it ? itemIcon(it) : slotIcon(slot)}<span>${SLOT_NAMES[slot]}</span></button>`;
    }).join('');
    const left = this.shop ? this.shopHtml(p) : `<div class="doll">${doll}<div class="cp-portrait"><canvas width="160" height="160"></canvas></div></div>
      <div class="cp-mini"><span>ATK <b>${st.atk}</b></span><span>DEF <b>${st.def}</b></span><span>VIDA <b>${st.maxHp}</b></span></div>`;
    const cells = p.bag.map((it) => this.cell(it)).join('') + Array.from({ length: Math.max(0, ITEMS.bag - p.bag.length) }, () => '<span class="bag-cell empty"></span>').join('');
    return `<div class="cp-gear">
      <div class="cp-left">${left}</div>
      <div class="cp-right">
        <div class="bag-head"><b>Bolsa</b> <small>${p.bag.length}/${ITEMS.bag}</small><span class="cp-gold">${st.gold} oro</span><span class="cp-pot">🧪 ${st.potions}/${CONSUMABLES.potion.max}</span></div>
        <div class="bag-grid">${cells}</div>
        <div class="cp-detail"></div>
      </div>
    </div>`;
  }

  shopHtml(p) {
    const st = this.stats(), P = CONSUMABLES.potion, T = ENCOUNTERS.caldera.tiers;
    const row = (what, name, price, note, ok, lock) => `<div class="shop-row${lock ? ' locked' : ''}"><div><b>${name}</b><small>${note}</small></div><button class="btn" data-buy="${what}" ${ok ? '' : 'disabled'}>${lock ? '🔒 ' : ''}${price} oro</button></div>`;
    // The crates: a random item of your level, and the Mareas' (better ones) once you have opened that Marea.
    const crates = CRATES.map((k) => {
      const C = CONSUMABLES[k], K = C.crate, lock = K.tier && p.flags.tier < K.tier;
      const note = lock ? `Vence la ${T[K.tier - 2].name} para abrirlo` : K.ilvl ? `Un objeto de nivel ${st.level + K.ilvl}${K.minRarity ? ', al menos Poco común' : ''}, mejor rareza` : 'Un objeto al azar de tu nivel';
      return row(k, C.name, C.price, note, !lock && p.gold >= C.price && p.bag.length < ITEMS.bag, lock);
    }).join('');
    return `<div class="shop"><h4>Puesto de ${esc(NPC_TALK.vendor.name)}</h4>
      ${row('potion', P.name, P.price, `Cura el ${Math.round(P.heal * 100)} % de tu vida · llevas ${st.potions}/${P.max}`, p.gold >= P.price && st.potions < P.max)}
      ${crates}
      <p class="shop-note">Toca algo de tu bolsa para <b>venderlo</b>: Tía Perla paga todo lo que vale (desguazar en el camino da solo un ${Math.round(ITEMS.salvage * 100)} %).</p></div>`;
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
    if (!sel) { box.innerHTML = `<p class="cp-hint">${this.shop ? 'Elige algo de tu bolsa para venderlo.' : 'Toca un objeto para verlo. Doble clic: equiparlo.'}</p>`; return; }
    if (sel.where === 'bag') {
      const it = p.bag.find((x) => x.u === sel.uid);
      if (!it) { box.innerHTML = ''; this.pinned = null; return; }
      const slot = targetSlot(it, p.eq, itemScore), worn = p.eq[slot];
      const v = itemValue(it), sv = v > 0 ? Math.max(1, Math.round(v * ITEMS.salvage)) : 0;
      const sure = this.confirm === it.u;
      const actions = this.pinned ? [
        { id: 'equip', label: 'Equipar' },
        this.shop ? { id: 'sell', label: sure ? `¿Seguro? +${v}` : `Vender +${v}`, cls: 'secondary' } : { id: 'salvage', label: sure ? `¿Seguro? +${sv}` : `Desguazar +${sv}`, cls: 'secondary' },
      ] : [];
      const B = BASES[it.b];
      const kitNote = B.slot === 'weapon' && WEAPONS[B.weapon] && B.weapon !== WEAPON_KINDS[this.stats().weapon] ? `Equiparla cambia tu kit a <b>${WEAPONS[B.weapon].name}</b>.` : '';
      box.innerHTML = itemCard(it, { where: 'bag', worn, actions, kitNote });
    } else {
      const it = p.eq[sel.slot];
      if (!it) { box.innerHTML = ''; return; }
      box.innerHTML = itemCard(it, { where: 'worn', actions: this.pinned && sel.slot !== 'weapon' ? [{ id: 'unequip', label: 'Quitar', cls: 'secondary' }] : [] });
    }
  }

  statsHtml(p) {
    const st = this.stats(), g = gearTotals(p), base = statsFor(st.level);
    const red = st.def / (st.def + tuning.stats.defK);
    const crit = tuning.stats.crit + Math.min(STATS.crit.cap - tuning.stats.crit, g.crit), critD = tuning.stats.critMult + g.critD;
    const rows = [
      ['Nivel', `${st.level}`, ''],
      ['Ataque', `${st.atk}`, `${base.atk} del nivel · +${g.atk} del equipo · maestría`],
      ['Defensa', `${st.def}`, `reduce el daño un ${pct(red)}`],
      ['Vida', `${st.maxHp}`, ''],
      ['Crítico', pct(crit, 1), `× ${critD.toLocaleString('es-ES', { maximumFractionDigits: 2 })} de daño`],
      ['Velocidad', `${(st.speed).toLocaleString('es-ES', { maximumFractionDigits: 2 })} u/s`, st.speed !== tuning.player.runSpeed ? statText('spd', st.speed / tuning.player.runSpeed - 1) : ''],
      ['Enfriamiento', st.cdr > 0 ? '−' + pct(st.cdr) : '—', 'de Q y E'],
      ['Carga de RIPOSTE', pct(st.ripMul - 1), ''],
      ['Daño de reflejos', pct(st.reflMul - 1), 'reflejos y balas devueltas'],
      ['Aguante de guardia', `${Math.round(st.guardMax)}`, ''],
      ['Recarga de dash', `${(tuning.dash.recharge * st.dashRec).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s`, ''],
      ['Ventana de reflejo', st.winBonus ? statText('win', st.winBonus).split(' ')[0] + ' ms' : '—', 'EXCELENTE y BUENO'],
      ['Pociones', `+${Math.round((st.potHeal - 1) * 100)} %`, `curan el ${Math.round(CONSUMABLES.potion.heal * st.potHeal * 100)} % de tu vida`],
      ['Experiencia', `+${Math.round((st.xpMul - 1) * 100)} %`, ''],
      ['Oro encontrado', `+${Math.round(g.gold * 100)} %`, ''],
      ['Vida al matar', `${Math.round(g.kill)}`, ''],
    ];
    const mast = WEAPON_KINDS.map((k, i) => {
      const W = WEAPONS[k], m = p.mast[i] || [1, 0], lvl = m[0], next = MASTERY.xp[Math.min(MASTERY.xp.length - 1, lvl - 1)];
      const steps = [['q', MASTERY.unlock.q], ['e', MASTERY.unlock.e], ['r', MASTERY.unlock.r]].map(([s, at]) => `<li class="${lvl >= at ? 'ok' : ''}"><b>M${at}</b> ${s.toUpperCase()} ${SKILLS[W[s]].name}</li>`);
      for (const ps of MASTERY.passives[k]) steps.push(`<li class="${lvl >= ps.at ? 'ok' : ''}"><b>M${ps.at}</b> ${ps.name}: ${ps.hint}</li>`);
      return `<div class="mast-card"><div class="mc-head"><b>${W.name}</b><span>Maestría ${lvl}${lvl >= MASTERY.max ? ' · máxima' : ''}</span></div>
        <div class="bar xp thin"><div class="fill" style="width:${lvl >= MASTERY.max ? 100 : Math.min(100, (m[1] / next) * 100).toFixed(1)}%"></div><div class="num">${lvl >= MASTERY.max ? '—' : `${Math.floor(m[1])} / ${next}`}</div></div>
        <ul>${steps.join('')}</ul><small>+${Math.round(MASTERY.dmg * 100)} % de daño por nivel de maestría</small></div>`;
    }).join('');
    const T = ENCOUNTERS.caldera.tiers;
    const tiers = T.map((t, i) => `<span class="${i < p.flags.tier ? 'ok' : ''}">${t.name}${i + 1 === p.flags.tierSel ? ' ✓' : ''}</span>`).join('');
    return `<div class="cp-stats"><div class="st-table">${rows.map(([a, b, c]) => `<div class="st-row"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('')}</div>
      <div class="st-side">${mast}<div class="mast-card"><div class="mc-head"><b>La Caldera</b></div><div class="tiers">${tiers}</div>
      <small>Bajas ${p.stats.kills} · Victorias ${p.stats.wins} · Oro ganado ${p.stats.gold} · Objetos ${p.stats.items}</small></div></div></div>`;
  }

  questsHtml(p) {
    const st = (id) => (p.quests[id] ? p.quests[id][0] : QST.NONE);
    const who = (npc) => (npc === 'vendor' ? 'Tía Perla' : 'la Capitana Brea');
    const reward = (R) => [R.xp && `${R.xp} XP`, R.gold && `${R.gold} oro`, R.potions && `${R.potions} ${R.potions > 1 ? 'pociones' : 'poción'}`, R.item && 'un objeto'].filter(Boolean).join(' · ');
    const card = (id, cls, note) => {
      const Q = QUESTS[id], n = goalCount(Q), q = p.quests[id] || [0, 0];
      return `<div class="q-card ${cls}"><b>${esc(Q.name)}</b><p>${esc(Q.text)}</p>${n > 1 && cls === 'active' ? `<div class="bar xp thin"><div class="fill" style="width:${(Math.min(n, q[1]) / n * 100).toFixed(0)}%"></div><div class="num">${Math.min(n, q[1])} / ${n}</div></div>` : ''}<small>${note || ''}${reward(Q.reward || {}) ? ` Recompensa: ${reward(Q.reward)}` : ''}</small></div>`;
    };
    const active = QUEST_IDS.filter((id) => st(id) === QST.ACTIVE).map((id) => card(id, 'active'));
    const ready = QUEST_IDS.filter((id) => st(id) === QST.READY).map((id) => card(id, 'ready', `¡Lista! Entrégasela a ${who(QUESTS[id].turnin)}.`));
    const offers = QUEST_IDS.filter((id) => canAccept(p, id)).map((id) => card(id, 'offer', `Habla con ${who(QUESTS[id].giver)} para aceptarla.`));
    const done = QUEST_IDS.filter((id) => st(id) === QST.DONE).map((id) => `<li>${esc(QUESTS[id].name)}</li>`);
    return `<div class="cp-quests">${[...ready, ...active].join('') || '<p class="cp-hint">No tienes misiones activas.</p>'}
      ${offers.length ? `<h4>Disponibles</h4>${offers.join('')}` : ''}
      ${done.length ? `<h4>Cumplidas</h4><ul class="q-done">${done.join('')}</ul>` : ''}</div>`;
  }
}
