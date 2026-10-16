// Shared UI kit (the painted navy + orange-brush look of every panel): interface language, painted icon atlases and
// line icons. Presentation only; gameplay ids and rules stay in src/data and src/sim.

import { getLocale, onLocaleChange } from '../core/locale.js';

export const UI_LANGS = ['es', 'en'];
/** Resolve interface language from the player's locale source; document.lang can lag on mobile. */
export const uiLang = () => getLocale() === 'en' ? 'en' : 'es';
export { onLocaleChange };
/** Picks the text for the current language from an { es, en } pair (Spanish fallback). */
export const tr = (pair, lang = uiLang()) => (pair && typeof pair === 'object' ? pair[lang] ?? pair.es : pair) ?? '';
export const LOCALES = { es: 'es-MX', en: 'en-US' };
export const fmtNum = (value, lang = uiLang(), digits = 0) => (Number.isFinite(value) ? value : 0)
  .toLocaleString(LOCALES[lang] || LOCALES.es, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Absolute URL of a kit asset (a relative url() set inline would resolve against the page, not the stylesheet). */
export const kitAsset = (path) => { try { return new URL(`assets/ui/${path}`, document.baseURI).href; } catch { return `assets/ui/${path}`; } };

// Painted atlases in assets/ui/kit (cut by tools/crafting-ui/icons.py; keep the id order in sync with its ATLASES).
export const ICON_ATLASES = {
  // Food art comes first so existing goods resolve to the refreshed silhouettes.
  // Order matches tools/crafting-ui/cooking_icons.py. Meal IDs are presentation only.
  foods: { cols: 4, rows: 4, ids: ['pescado', 'fruta', 'harina', 'galleta', 'ron', 'agua', 'cana', 'especias',
    'coco', 'resina', 'meal_roastFish', 'meal_grog', 'meal_heartyBiscuit'] },
  items: { cols: 6, rows: 4, ids: ['hacha_piedra', 'pico_piedra', 'madera', 'tronco', 'piedra', 'mineral_hierro', 'hierro',
    'pescado', 'fruta', 'harina', 'galleta', 'ron', 'agua', 'cana', 'azufre', 'lona', 'polvora', 'balas', 'tabaco', 'especias',
    'seda', 'coral', 'perlas'] },
  gear: { cols: 5, rows: 4, ids: ['sable', 'daga', 'ancla', 'chispa', 'duelo', 'trabuco', 'panuelo', 'tricornio', 'sombrero',
    'chaleco', 'casaca', 'coraza', 'botas', 'altas', 'viento', 'anillo', 'diente', 'brujula', 'amuleto', 'moneda'] },
  misc: { cols: 4, rows: 4, ids: ['antorcha', 'lanza', 'arpon', 'cuerda', 'arco', 'flechas', 'fogata', 'potion', 'crate', 'crate2',
    'crate3', 'mochila', 'cinturon', 'oro', 'mapa', 'diario'] },
};
const CELL = new Map();
for (const [atlas, { cols, ids }] of Object.entries(ICON_ATLASES))
  ids.forEach((id, i) => { if (!CELL.has(id)) CELL.set(id, { atlas, x: i % cols, y: Math.floor(i / cols) }); });
const standaloneIcon = id => id === 'resina' || id === 'coco';
export const hasAtlasIcon = (id) => CELL.has(id) || standaloneIcon(id);
/** A painted icon as a sized span (class `cls`), or '' when the id has no painted art. */
export function atlasIcon(id, cls = '') {
  if (standaloneIcon(id)) return `<span class="kit-item-art kit-item-art-${id} ${cls}" aria-hidden="true"></span>`;
  const cell = CELL.get(id);
  return cell ? `<span class="kit-ico ${cls}" data-atlas="${cell.atlas}" style="--ix:${cell.x};--iy:${cell.y}" aria-hidden="true"></span>` : '';
}

const svg = (body, view = '0 0 24 24') => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
// Line icons in currentColor (tabs, headers, stats, hints) and the palm brand mark.
export const LINE_ICONS = {
  palm: svg('<path fill="currentColor" d="M11.2 22.5c.5-4.6.4-8.5-.6-12l1.6-.4c1.1 3.8 1.2 7.9.7 12.4z"/><path fill="currentColor" d="M11.7 9.8C9 6.4 5.2 5.6 1.6 7.6c3.2-.4 5.6.3 7.7 2.4-2.9-.4-5.5.7-7.4 3.4 2.6-1.3 5.4-1.6 8.4-.7zm.6 0c1.5-3.6 4.6-5.6 9.4-5.1-3 .7-5.1 2-6.4 3.9 3-.6 5.8.3 8 2.9-2.7-1-5.8-1.3-9.1-.3zm-.5-.4C10.6 6 8.4 3.3 4.8 1.6c2.9.3 5.4 1.7 7.4 4.3.3-2.2 1.4-3.9 3.5-5.1-1.2 1.7-1.8 4.3-1.8 7.7z"/><ellipse cx="11.9" cy="22.6" rx="5.6" ry="1.1" fill="currentColor" opacity=".55"/>'),
  tools: svg('<path fill="currentColor" d="M13.2 2.8 21.4 11l-2.3 2.3-2.5-2.5-1.3 1.3L5.9 21.5a2 2 0 0 1-2.8 0l-.6-.6a2 2 0 0 1 0-2.8l9.4-9.4 1.3-1.3-2.4-2.4z"/>'),
  weapons: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M4 4l10.5 10.5M20 4 9.5 14.5M4 4h3.4L18 14.6M20 4h-3.4L6 14.6M13 17l4-4 1.6 1.6-4 4zM11 17l-4-4-1.6 1.6 4 4zM18 18.2l2.4 2.4M6 18.2l-2.4 2.4"/>'),
  building: svg('<path fill="currentColor" d="M12 2.5 1.8 11.2l1.4 1.6L4.5 11.7V21h5.6v-5.4h3.8V21h5.6v-9.3l1.3 1.1 1.4-1.6L18.5 8.7V4h-2.6v2.5zM10 9.2h4v3.4h-4z"/>'),
  survival: svg('<path fill="currentColor" d="M12.3 2c.6 3.2 4.6 5.1 4.6 9.4 0 2.9-2.2 5.2-4.9 5.2s-4.9-2.3-4.9-5.2c0-2.1 1-3.5 2.2-4.6-.1 1.7.5 2.9 1.6 3.4C10.2 7.1 11.7 4.6 12.3 2zm-.1 9c1 1.1 2 2.2 2 3.4 0 1.2-.9 2.1-2.1 2.1S9.9 15.6 9.9 14.4c0-1.2 1.2-2.2 2.3-3.4zM3 19.6l1-1.7 8 3.4 8-3.4 1 1.7-6.6 2.8 6.6 0V24H3v-1.6l6.6 0z"/>'),
  food: svg('<path fill="currentColor" d="M2 12.2h20c0 4.8-3.8 8.6-8.6 8.6h-2.8C5.8 20.8 2 17 2 12.2zm7.3-6.6c-.8-1-.6-2.2.4-3 0 1 .9 1.4 1 2.4.1.8-.5 1.4-1.4.6zm3.6-1c-.5-.9-.2-1.8.6-2.4 0 .9.8 1.2.8 2 0 .6-.6 1-1.4.4zm2.7 1.6c-.6-.7-.4-1.6.3-2.1 0 .7.7.9.7 1.6 0 .5-.5.9-1 .5zM5.5 11c.3-2.2 2-3.4 4-3.1 1.1-1.6 3.8-1.8 5.1-.2 1.9-.6 3.7.8 3.9 3.3z"/>'),
  backpack: svg('<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M9 5V3.6C9 2.7 9.7 2 10.6 2h2.8c.9 0 1.6.7 1.6 1.6V5M5.5 21V10.5A5.5 5.5 0 0 1 11 5h2a5.5 5.5 0 0 1 5.5 5.5V21zM8.5 21v-4.5c0-.8.7-1.5 1.5-1.5h4c.8 0 1.5.7 1.5 1.5V21M8.5 10.5h7M12 9.4v2.4"/>'),
  lock: svg('<path fill="currentColor" d="M7 10V7.5a5 5 0 0 1 10 0V10h1.2c.7 0 1.3.6 1.3 1.3v8.9c0 .7-.6 1.3-1.3 1.3H5.8c-.7 0-1.3-.6-1.3-1.3v-8.9c0-.7.6-1.3 1.3-1.3zm2.3 0h5.4V7.5a2.7 2.7 0 0 0-5.4 0zm1.4 4.2v3.6h2.6v-3.6z"/>'),
  arrow: svg('<path fill="currentColor" d="M2 10.4h4v3.2H2zm5.5 0h3v3.2h-3zm4.6 0h2.4V4.5L23 12l-8.5 7.5v-5.9h-2.4z" opacity=".85"/>'),
  logs: svg('<path fill="currentColor" d="M3 8.5c0-1.4 1.1-2.5 2.5-2.5h12C19.4 6 21 7.6 21 9.5S19.4 13 17.5 13h-12A2.5 2.5 0 0 1 3 10.5zm14.5-.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM3 15.5C3 14.1 4.1 13 5.5 13h12c1.9 0 3.5 1.6 3.5 3.5S19.4 20 17.5 20h-12A2.5 2.5 0 0 1 3 17.5zm14.5-.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/>'),
  hit: svg('<path fill="currentColor" d="m12 1.5 2 6.2 6.1-2.5-3.4 5.6 5.8 3-6.4.9.8 6.5-4.9-4.4-4.9 4.4.8-6.5-6.4-.9 5.8-3-3.4-5.6L10 7.7z"/>'),
  clock: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2M9.5 2h5"/>'),
  stone: svg('<path fill="currentColor" d="M7.2 9.4 10 5.6l4.6-.3 2.6 3.4-1 3.8-5 1.2-3.8-1.5zM2.5 17.5l1.8-4.6 4.2-.9 3 2.3-.7 4.3-4.8 1.2zm10.4.7.6-4.2 4.6-1.3 3.6 2.6-.6 4.4-4.6 1.1z"/>'),
  ore: svg('<path fill="currentColor" d="M3 17.5 6.5 8l6-4 7 3.5 1.5 8.5-6 5H8z"/><path fill="#0d1b2b" d="m9 10 2.2-1 1 2-2.1 1zm4 4 2-1.1 1.2 1.8-2 1.2zm-5.2 2.2 1.6-.7.8 1.4-1.6.8z"/>'),
  box: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="m12 2.5 8.5 4.6v9.8L12 21.5l-8.5-4.6V7.1zM3.5 7.1 12 11.7l8.5-4.6M12 11.7v9.8"/>'),
  coin: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4.2a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6z"/>'),
  stack: svg('<path fill="currentColor" d="m12 2 10 5-10 5L2 7zm-7.6 8.4L12 14.2l7.6-3.8L22 11.6l-10 5-10-5zm0 4.6L12 18.8l7.6-3.8L22 16.2l-10 5-10-5z"/>'),
  person: svg('<path fill="currentColor" d="M12 2.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6zM8.4 10h7.2c1.1 0 2 .9 2 2v4.6h-2.4V22h-2.4v-5.4h-1.6V22H8.8v-5.4H6.4V12c0-1.1.9-2 2-2z"/>'),
  skills: svg('<path fill="currentColor" d="m12 1.8 1.6 4.2 4.4-1.4-1.9 4.1 4.2 2-4.4 1.2 1.1 4.5-4-2.5L12 18l-1-4.1-4 2.5 1.1-4.5-4.4-1.2 4.2-2-1.9-4.1 4.4 1.4zM9.3 19.2h5.4L14 22h-4z"/>'),
  journal: svg('<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M5 3.2h11.6c1.3 0 2.4 1 2.4 2.3v15.3H7.4A2.4 2.4 0 0 1 5 18.4zM5 18.4c0-1.3 1-2.3 2.4-2.3H19M8.8 7.4h6.4M8.8 10.6h4.6"/>'),
  pearl: svg('<circle cx="12" cy="12.5" r="7.5" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="9.6" cy="10" r="2.2" fill="currentColor" opacity=".55"/>'),
  stats: svg('<path fill="currentColor" d="M3 20.5h18v1.8H3zM4.5 12h3.4v7H4.5zm5.8-5h3.4v12h-3.4zm5.8 3h3.4v9h-3.4z"/>'),
  heart: svg('<path fill="currentColor" d="M12 21.2 3.6 12.9A5.2 5.2 0 0 1 11 5.5l1 1 1-1a5.2 5.2 0 0 1 7.4 7.4z"/>'),
  bolt: svg('<path fill="currentColor" d="M13.6 1.8 4.4 13.4h6.2l-1.4 8.8 9.4-11.8h-6.4z"/>'),
  weight: svg('<path fill="currentColor" d="M9.2 6.2a2.8 2.8 0 1 1 5.6 0c0 .5-.1.9-.3 1.3h3.1l3 13.7H3.4l3-13.7h3.1c-.2-.4-.3-.8-.3-1.3zm2.8-1.1a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"/>'),
  sword: svg('<path fill="currentColor" d="M20.6 2.2 21.8 3.4l-.6 3.4-9.4 9.4 1.6 1.6-1.4 1.4-1.8-.6-3.4 3.4-1.6-1.6 3.4-3.4-.6-1.8 1.4-1.4 1.6 1.6 9.4-9.4z"/>'),
  shield: svg('<path fill="currentColor" d="M12 2 20 5v6.4c0 5-3.4 9.1-8 10.6-4.6-1.5-8-5.6-8-10.6V5z"/>'),
  crit: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  speed: svg('<path fill="currentColor" d="M13.2 4.4a8.6 8.6 0 0 1 8.6 8.6c0 2.2-.8 4.2-2.2 5.8H6.8a8.5 8.5 0 0 1-1.3-2h3.2v-1.8H4.9a8.6 8.6 0 0 1-.2-1.6h4.6v-1.8H4.8c.1-.6.3-1.1.5-1.6h3.4V8.2H6.3a8.6 8.6 0 0 1 6.9-3.8zm4 4.6-4.9 4.1a1.6 1.6 0 1 0 1.9 1.9z"/>'),
  cooldown: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4.6 8.4A8.4 8.4 0 1 1 3.7 13M4.4 3.6v4.8h4.8M12 7.6V12l3 1.8"/>'),
  gold: svg('<circle cx="9" cy="14" r="6.4" fill="none" stroke="currentColor" stroke-width="1.9"/><path fill="none" stroke="currentColor" stroke-width="1.9" d="M11.4 4.3a6.4 6.4 0 1 1 7.9 8.9"/>'),
  plus: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/>'),
  pencil: svg('<path fill="currentColor" d="m15.6 3.6 4.8 4.8-11 11-5.6.8.8-5.6zm-1.4 3.2-8.4 8.4-.3 2.1 2.1-.3 8.4-8.4z"/>'),
  rotate: svg('<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M19.4 12a7.4 7.4 0 1 1-2.2-5.3M19.6 3.6v4.6H15"/>'),
  mouse: svg('<rect x="6.2" y="2.6" width="11.6" height="18.8" rx="5.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 6.4v3.4"/>'),
  close: svg('<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>'),
  coin2: svg('<circle cx="12" cy="12" r="8.6" fill="currentColor"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="#0d1b2b" stroke-width="1.5" opacity=".55"/>'),
  ring: svg('<circle cx="12" cy="14.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="m9.4 6.6 2.6-3.6 2.6 3.6-2.6 2.6z"/>'),
  boots: svg('<path fill="currentColor" d="M7 2.5h7.4v10.3l6.2 2.9v5.8H4.4v-4.2l2.6-1.8z"/>'),
  chest: svg('<path fill="currentColor" d="m8.6 2.6 3.4 1.9 3.4-1.9 5.4 4-2.4 3.3v11.5H5.6V9.9L3.2 6.6z"/>'),
  head: svg('<path fill="currentColor" d="M2.6 15.4c3-1.5 6-2.2 9.4-2.2s6.4.7 9.4 2.2c-1.6 1.8-5.2 3.2-9.4 3.2s-7.8-1.4-9.4-3.2zm4-1.6c0-4.8 2.4-8.6 5.4-8.6s5.4 3.8 5.4 8.6z"/>'),
};
