// Persistent options (localStorage, always wrapped: storage can be unavailable).
import { GAME } from '../data/meta.js';

const KEY = GAME.saveKey + '.settings';
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const defaults = {
  master: 0.8, sfx: 0.9, music: 0.55, ambience: 0.8, muted: false,
  quality: 'auto', shake: 1, reducedMotion: reduced, uiScale: 1, highContrast: false, landscape: true, touchSize: 1, haptics: true,
  skin: 0, name: '', camRotate: false, timeOfDay: 'cycle', weapon: 'sable',
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

// Saved games (M4): the blob the server last sent, one per server ('solo' for the Web Worker). Never parsed
// here: the server reads (and online, verifies) it.
const saveKey = (slot) => `${GAME.saveKey}.save.${slot}`;
export function loadSave(slot) {
  try { return localStorage.getItem(saveKey(slot)) || ''; } catch { return ''; }
}
export function storeSave(slot, blob) {
  try { localStorage.setItem(saveKey(slot), blob); return true; } catch { return false; }
}
// A save the server refused stays aside (another build, another server secret), in case it is needed.
export function setSaveAside(slot) {
  try {
    const b = localStorage.getItem(saveKey(slot));
    if (b) localStorage.setItem(saveKey(slot) + '.old', b);
  } catch { /* ignore */ }
}
