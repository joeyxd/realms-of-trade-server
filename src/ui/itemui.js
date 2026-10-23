// Items in the UI (M4): icons by slot, stat lines, the comparison with what you wear, the tooltip card.
import { RARITIES, BASES, STATS, STAT_KEYS, SLOT_NAMES, slotFits } from '../data/items.js';
import { WEAPONS } from '../data/weapons.js';
import { itemStats, itemName, itemValue, emptyStats } from '../sim/items.js';
import { dataText, translateData, text as ltext, rich, formatNumber } from '../core/i18n.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const rarityOf = (item) => RARITIES[item.r] || RARITIES[0];
const num = (v, d = 1) => formatNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d });

// Small inline icons (filled with the rarity's colour as an accent).
const ICON = {
  sable: (c) => `<svg viewBox="0 0 32 32"><path d="M25 3h4v4L15 21l-3-2-2-3z" fill="#e3ebf5" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M8 17l7 7-2 2-2-1-3 3-3-3 3-3-1-2z" fill="${c}" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>`,
  pistolas: (c) => `<svg viewBox="0 0 32 32"><path d="M3 10h21l3 2v3H13l-1 2h-2l-1 8H4l2-9-3-3z" fill="#8a8f9c" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M5 25l2-8" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  head: (c) => `<svg viewBox="0 0 32 32"><path d="M3 21c4-2 8-3 13-3s9 1 13 3c-2 2-7 4-13 4S5 23 3 21z" fill="#3a2a56" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M9 19c0-6 3-11 7-11s7 5 7 11" fill="#3a2a56" stroke="#1a1033" stroke-width="2"/><path d="M8.5 18.5h15" stroke="${c}" stroke-width="2.5"/></svg>`,
  chest: (c) => `<svg viewBox="0 0 32 32"><path d="M10 4l6 3 6-3 6 5-3 4v15H7V13L4 9z" fill="#5c3a7a" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M16 7v21" stroke="${c}" stroke-width="2.5"/></svg>`,
  boots: (c) => `<svg viewBox="0 0 32 32"><path d="M9 3h9v15l9 4v6H6V16z" fill="#7a4a2a" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h11" stroke="${c}" stroke-width="2.5"/></svg>`,
  ring: (c) => `<svg viewBox="0 0 32 32"><circle cx="16" cy="19" r="8" fill="none" stroke="#ffcf4a" stroke-width="3.5"/><circle cx="16" cy="19" r="8" fill="none" stroke="#1a1033" stroke-width="1.2"/><path d="M12 9l4-5 4 5-4 4z" fill="${c}" stroke="#1a1033" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
};
export function itemIcon(item) {
  const B = BASES[item.b];
  const k = B.slot === 'weapon' ? B.weapon : B.slot;
  return (ICON[k] || ICON.ring)(rarityOf(item).color);
}
// The empty slot's silhouette.
export function slotIcon(slot) {
  const k = slot === 'weapon' ? 'sable' : slot.startsWith('ring') ? 'ring' : slot;
  return (ICON[k] || ICON.ring)('#3a2a56').replace('<svg', '<svg class="ghost"');
}

// One stat as text ("+12 ATK", "+2,5 % Crítico", "−20 ms Ventana de reflejo").
export function statText(k, v) {
  const S = STATS[k], sign = v >= 0 ? '+' : '−', a = Math.abs(v);
  if (S.ms) return `${sign}${Math.round(a * 1000)} ms ${translateData(S.name)}`;
  if (S.pct) return `${sign}${num(a * 100, a * 100 >= 10 ? 0 : 1)} % ${translateData(S.name)}`;
  return `${sign}${Math.round(a)} ${translateData(S.name)}`;
}
function statHtml(k, v) {
  const S = STATS[k], sign = v >= 0 ? '+' : '−', a = Math.abs(v);
  const amount = S.ms ? `${Math.round(a * 1000)} ms` : S.pct ? `${num(a * 100, a * 100 >= 10 ? 0 : 1)} %` : `${Math.round(a)}`;
  return `${sign}${amount} ${dataText(S.name)}`;
}
// Is more of k better? (Time between shots is the one that is not.)
const better = (k, d) => (k === 'fire' ? d < 0 : d > 0);

export function statLines(item) {
  const s = itemStats(item), out = [];
  for (const k of STAT_KEYS) if (Math.abs(s[k]) > 1e-9) out.push({ k, v: s[k], text: statText(k, s[k]), bad: !better(k, s[k]) });
  return out;
}

// What changes if `item` replaces `worn` (null = an empty slot): [{k, d, text, up}].
export function compareLines(item, worn) {
  const a = itemStats(item), b = worn ? itemStats(worn) : emptyStats(), out = [];
  for (const k of STAT_KEYS) {
    const d = a[k] - b[k];
    if (Math.abs(d) < 1e-9) continue;
    out.push({ k, d, text: statText(k, d), up: better(k, d) });
  }
  return out;
}

// The slot an item from the bag would go to (rings: the empty one, else the weaker by score).
export function targetSlot(item, eq, score) {
  const B = BASES[item.b];
  if (B.slot !== 'ring') return B.slot;
  if (!eq.ring1) return 'ring1';
  if (!eq.ring2) return 'ring2';
  return score(eq.ring1) <= score(eq.ring2) ? 'ring1' : 'ring2';
}

// The tooltip card. o: {worn (to compare with), where: 'bag' | 'worn' | 'shop', actions: [{id, label, cls}], kitNote}
export function itemCard(item, o = {}) {
  const R = rarityOf(item), B = BASES[item.b];
  const kind = B.slot === 'weapon' ? WEAPONS[B.weapon].name : SLOT_NAMES[B.slot];
  const lines = statLines(item).map((l) => `<li class="${l.bad ? 'bad' : ''}">${statHtml(l.k, l.v)}</li>`).join('');
  let cmp = '';
  if (o.where === 'bag' || o.where === 'shop') {
    const c = compareLines(item, o.worn || null);
    cmp = `<div class="ic-cmp"><h5>${ltext(o.worn ? 'adventure.item_compare' : 'adventure.item_empty_slot')}</h5>${c.length ? `<ul>${c.map((l) => `<li class="${l.up ? 'up' : 'down'}">${l.up ? '▲' : '▼'} ${statHtml(l.k, l.d)}</li>`).join('')}</ul>` : `<p class="same">${ltext('adventure.item_same')}</p>`}</div>`;
  }
  const value = itemValue(item);
  const kit = o.kitNote ? `<p class="ic-kit">${o.kitNote}</p>` : '';
  const acts = (o.actions || []).map((a) => `<button class="btn ${a.cls || ''}" data-act="${a.id}">${a.label}</button>`).join('');
  return `<div class="item-card${cmp ? ' two' : ''}" style="--rc:${R.color}">
    <div class="ic-head"><span class="ic-icon">${itemIcon(item)}</span><div><b class="ic-name">${dataText(itemName(item))}</b><small>${dataText(R.name)} · ${dataText(kind)} · ${ltext('adventure.slot_level', { level: formatNumber(item.l) })}</small></div></div>
    <ul class="ic-stats">${lines || `<li>${ltext('adventure.item_no_stats')}</li>`}</ul>${cmp}${kit}
    <p class="ic-value">${value > 0 ? rich('adventure.item_worth', { value: formatNumber(value) }) : ltext('adventure.item_practice_worthless')}</p>
    ${acts ? `<div class="ic-acts">${acts}</div>` : ''}
  </div>`;
}

export { slotFits, itemName, itemValue };
