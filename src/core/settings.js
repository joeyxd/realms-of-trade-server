// Persistent options (localStorage, always wrapped: storage can be unavailable).
import { GAME } from '../data/meta.js';

const KEY = GAME.saveKey + '.settings';
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const defaults = {
  master: 0.8, sfx: 0.9, music: 0.55, ambience: 0.8, muted: false,
  quality: 'auto', shake: 1, reducedMotion: reduced, uiScale: 1, highContrast: false,
  skin: 0, name: '', camRotate: false,
};

export const settings = { ...defaults };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch { /* storage unavailable: defaults */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function resetSave() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(GAME.saveKey)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  Object.assign(settings, defaults);
}
