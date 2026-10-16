// Client-only preference. It never enters a profile, command or saved world.
export const LOCALE_KEY = 'mn.locale';
export const LOCALES = ['es', 'en'];
export function chooseLocale(stored, languages = []) {
  if (LOCALES.includes(stored)) return stored;
  for (const language of languages) {
    const code = String(language).toLowerCase().split(/[-_]/)[0];
    if (LOCALES.includes(code)) return code;
  }
  return 'es';
}
function initialLocale() {
  let stored;
  try { stored = globalThis.localStorage?.getItem(LOCALE_KEY); } catch { /* Optional storage. */ }
  // Node also exposes navigator; server-side imports keep the source language.
  const browserNavigator = globalThis.window ? globalThis.navigator : undefined;
  // Preserve an early bootstrap choice even when browser storage is blocked.
  return chooseLocale(globalThis.window?.__mnLanguage ?? stored, browserNavigator?.languages || [browserNavigator?.language]);
}
let locale = initialLocale();
const listeners = new Set();
export const getLocale = () => locale;
export function setLocale(value) {
  if (!LOCALES.includes(value)) return false;
  try { globalThis.localStorage?.setItem(LOCALE_KEY, value); } catch { /* Keep the in-memory choice. */ }
  if (value === locale) return true;
  locale = value;
  for (const listener of [...listeners]) listener(value);
  return true;
}
export function onLocaleChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
