// Presentation-only view of the on-foot cargo pack and utility belt.
import { GOODS } from '../data/goods.js';
import { holdMass, holdUsed } from '../sim/economy/cargo.js';
import { CARRY, carryLimits, readCarryField } from '../data/carry.js';

const LABELS = {
  en: {
    materials: 'Materials pack', volume: 'Volume', mass: 'Mass', strength: 'Strength', backpack: 'Backpack', belt: 'Utility belt',
    axe: 'Stone axe', pickaxe: 'Stone pickaxe', tier: 'Tier I',
  },
  es: {
    materials: 'Mochila de materiales', volume: 'Volumen', mass: 'Masa', belt: 'Cinturón de herramientas',
    axe: 'Hacha de piedra', pickaxe: 'Pico de piedra', tier: 'Nivel I',
    strength: 'Fuerza', backpack: 'Mochila',
  },
};

const GOOD_LABELS_EN = {
  pescado: 'Salted fish', fruta: 'Tropical fruit', harina: 'Flour', galleta: 'Ship biscuit', ron: 'Rum',
  agua: 'Fresh water', cana: 'Sugar cane', madera: 'Basic plank', tronco: 'Log', piedra: 'Stone', hierro: 'Iron',
  mineral_hierro: 'Iron ore', azufre: 'Sulfur', lona: 'Canvas', polvora: 'Gunpowder', balas: 'Cannonballs',
  tabaco: 'Tobacco', especias: 'Spices', seda: 'Silk', coral: 'Red coral', perlas: 'White pearls',
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;

function cargoIcon() {
  return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 11 16 5l12 6v15H4z"/><path d="m4 11 12 6 12-6M16 17v9M10 8l12 6"/></svg>';
}

function toolIcon(tool) {
  return tool === 'axe'
    ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m9 27 13-17M17 5c4-3 9-1 10 3-3-1-5 0-7 3l-5-3zM7 26l4 3"/></svg>'
    : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m8 27 13-17M18 5l8 2-4 7-5-3zM7 26l4 3"/></svg>';
}

/** Render the presentation projection without changing profile or cargo data. */
export function packInventoryHtml(profile, view = {}, language = 'es') {
  const lang = String(language).toLowerCase().startsWith('en') ? 'en' : 'es';
  const copy = LABELS[lang];
  const pack = view?.pack ?? profile?.eco?.pack ?? { cap: 0, goods: {} };
  const goods = pack?.goods && typeof pack.goods === 'object' ? pack.goods : {};
  const pendingGoods = view?.pendingGoods && typeof view.pendingGoods === 'object' ? view.pendingGoods : {};
  const rows = Object.entries(GOODS).flatMap(([id, good]) => {
    const count = number(goods[id]);
    if (!count) return [];
    const pending = number(pendingGoods[id]) > 0;
    const name = lang === 'en' ? (GOOD_LABELS_EN[id] || good.name) : id === 'madera' ? 'Tabla básica' : good.name;
    const dimensions = `${good.volume ?? good.w ?? 1} uV · ${good.mass ?? good.w ?? 1} uM`;
    return [`<li class="pack-good${pending ? ' is-pending' : ''}" title="${esc(dimensions)}"><span class="pack-good-icon">${cargoIcon()}</span><span class="pack-good-name">${esc(name)}<small>${esc(dimensions)}</small></span><b>${count}</b>${pending ? '<i class="pack-pending" aria-hidden="true"></i>' : ''}</li>`];
  }).join('');
  const used = holdUsed({ goods });
  const mass = holdMass({ goods });
  const cap = Number.isFinite(Number(pack?.cap)) ? Math.max(0, Number(pack.cap)) : 0;
  const carryField = readCarryField(profile), carry = carryField.present && carryField.value
    ? carryField.value : { v: CARRY.version, backpack: 0 };
  const limits = carryLimits(carry, profile?.lvl);
  const maxMass = Number.isFinite(pack?.maxMass) ? Math.max(0, pack.maxMass)
    : carryField.present && carryField.value ? limits?.maxMass : null;
  const strength = limits?.strength ?? 0;
  const backpackLabel = `${copy.backpack} ${carry.backpack + 1} / ${CARRY.maxBackpack + 1}`;
  const tools = ['axe', 'pickaxe'].filter((tool) => Number(profile?.tools?.[tool]) >= 1).map((tool) =>
    `<li class="belt-tool">${toolIcon(tool)}<span>${copy[tool]}<small>${copy.tier}</small></span></li>`).join('');
  return `<section class="pack-inventory" aria-label="${esc(copy.materials)}">
    <div class="pack-heading"><h4>${esc(copy.materials)}</h4><span>${esc(backpackLabel)}</span><span>${esc(copy.volume)} <b>${used} / ${cap} uV</b></span><span>${esc(copy.mass)} <b>${mass}${Number.isFinite(maxMass) ? ` / ${maxMass}` : ''} uM</b></span>${Number.isFinite(maxMass) ? `<span>${esc(copy.strength)} <b>${strength}</b></span>` : ''}</div>
    ${rows ? `<ul class="pack-goods">${rows}</ul>` : `<p class="pack-empty">${lang === 'en' ? 'No materials carried.' : 'No llevas materiales.'}</p>`}
    <div class="tool-belt"><h4>${esc(copy.belt)}</h4>${tools ? `<ul>${tools}</ul>` : `<p class="pack-empty">${lang === 'en' ? 'No tools yet.' : 'Aún no tienes herramientas.'}</p>`}</div>
  </section>`;
}
