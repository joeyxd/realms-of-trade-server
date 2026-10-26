// Explicit UI bindings allow a language change without recreating forms or issuing gameplay actions.
import entry from '../i18n/entry.js';
import systems from '../i18n/systems.js';
import uiLive from '../i18n/ui-live.js';
import systemsLive from '../i18n/systems-live.js';
import adventure from '../i18n/adventure.js';
import runtime from '../i18n/runtime.js';
import data from '../i18n/data.js';
import { getLocale, setLocale, onLocaleChange } from './locale.js';
export { getLocale, setLocale, onLocaleChange } from './locale.js';
export const catalogs = { ...entry, ...systems, ...adventure, ...runtime, ...uiLive, ...systemsLive };
export const dataCatalog = data;
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const missing = new Set();
// Explicit data parameters stay translatable inside a toast already on screen. Human names remain strings.
export const dataParam = (source, letterCase = '') => ({ l10nSource: source, letterCase });
function resolveValue(value) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'l10nSource')) return value;
  const result = translateData(value.l10nSource);
  return value.letterCase === 'upper' ? result.toUpperCase() : value.letterCase === 'lower' ? result.toLowerCase() : result;
}
export function t(key, params = {}) {
  const pair = catalogs[key];
  if (!pair) {
    if (!missing.has(key)) { missing.add(key); console.warn('[i18n] Missing key:', key); }
    return key;
  }
  let value = pair[getLocale() === 'en' ? 1 : 0] ?? pair[0];
  if (typeof value === 'object') value = value[Number(params.count) === 1 ? 'one' : 'other'];
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(resolveValue(params[name]) ?? `{${name}}`));
}
export const attr = (key, params) => escape(t(key, params));
export const text = (key, params = {}) => `<span data-l10n-key="${escape(key)}" data-l10n-params="${escape(JSON.stringify(params))}">${escape(t(key, params))}</span>`;
// Only application-owned catalog markup is accepted. Parameters are always escaped.
function richValue(key, params = {}) {
  const escaped = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, escape(resolveValue(v))]));
  return t(key, escaped);
}
export const rich = (key, params = {}) => `<span data-l10n-html="${escape(key)}" data-l10n-params="${escape(JSON.stringify(params))}">${richValue(key, params)}</span>`;
export function setText(element, key, params = {}) {
  element.dataset.l10nKey = key;
  element.dataset.l10nParams = JSON.stringify(params);
  const value = t(key, params);
  if (element.textContent !== value) element.textContent = value;
  return element;
}
export function setAttributeText(element, name, key, params = {}) {
  element.setAttribute(`data-l10n-${name}`, key);
  element.dataset.l10nParams = JSON.stringify(params);
  element.setAttribute(name, t(key, params));
}
export function messageKey(value) {
  return Object.keys(catalogs).find(key => catalogs[key].some(phrase => typeof phrase === 'string' && phrase === value));
}
export function translateData(source) {
  if (source == null) return '';
  return getLocale() === 'en' ? data[source] ?? source : String(source);
}
export const dataText = (source) => `<span data-l10n-source="${escape(source)}">${escape(translateData(source))}</span>`;
export function setDataText(element, source) {
  element.dataset.l10nSource = source;
  const value = translateData(source);
  if (element.textContent !== value) element.textContent = value;
}
export const formatNumber = (value, options = {}) => new Intl.NumberFormat(getLocale() === 'en' ? 'en-US' : 'es-ES', options).format(value);
function paramsFor(element) { try { return JSON.parse(element.dataset.l10nParams || '{}'); } catch { return {}; } }
const selector = '[data-l10n-key],[data-l10n-html],[data-l10n-source],[data-l10n-title],[data-l10n-aria-label],[data-l10n-placeholder],[data-l10n-content]';
export function localize(root = globalThis.document) {
  if (!root) return;
  const nodes = [...(root.matches?.(selector) ? [root] : []), ...(root.querySelectorAll?.(selector) || [])];
  for (const element of nodes) {
    const params = paramsFor(element);
    const value = element.dataset.l10nKey ? t(element.dataset.l10nKey, params)
      : element.hasAttribute('data-l10n-source') ? translateData(element.dataset.l10nSource) : null;
    if (value !== null && element.textContent !== value) element.textContent = value;
    if (element.dataset.l10nHtml) { const html = richValue(element.dataset.l10nHtml, params); if (element.innerHTML !== html) element.innerHTML = html; }
    for (const name of ['title', 'aria-label', 'placeholder', 'content']) {
      const key = element.getAttribute(`data-l10n-${name}`);
      if (key && element.getAttribute(name) !== t(key, params)) element.setAttribute(name, t(key, params));
    }
  }
}
export function createLanguagePicker() {
  const group = document.createElement('div');
  group.className = 'language-picker interactive';
  group.setAttribute('role', 'group'); group.dataset.l10nAriaLabel = 'language.label';
  group.setAttribute('data-l10n-aria-label', 'language.label');
  for (const code of ['es', 'en']) {
    const button = document.createElement('button'); button.type = 'button'; button.lang = code;
    button.textContent = code === 'es' ? 'Español' : 'English'; button.dataset.locale = code;
    button.setAttribute('aria-pressed', String(getLocale() === code));
    button.addEventListener('click', () => setLocale(code)); group.append(button);
  }
  localize(group);
  return group;
}
let observer;
export function initI18n() {
  if (!globalThis.document || observer) return;
  const refresh = () => {
    document.documentElement.lang = getLocale(); localize(document);
    globalThis.__mnLocale?.(getLocale());
    for (const button of document.querySelectorAll('[data-locale]')) button.setAttribute('aria-pressed', String(button.dataset.locale === getLocale()));
  };
  onLocaleChange(refresh); refresh();
  document.addEventListener('mn:locale', event => setLocale(event.detail));
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') localize(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1) localize(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-l10n-key', 'data-l10n-html', 'data-l10n-params', 'data-l10n-source', 'data-l10n-title', 'data-l10n-aria-label', 'data-l10n-placeholder', 'data-l10n-content'] });
  // The bootstrap picker remains usable if dependency loading fails before this module starts.
  document.addEventListener('click', event => { const button = event.target.closest?.('#bootstrap-locale [data-locale]'); if (button) setLocale(button.dataset.locale); });
}
