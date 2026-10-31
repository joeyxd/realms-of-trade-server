// Controller and phone rumble (CMB hit feel, docs/research/melee/11-ultimate-feel.md). A gamepad with a vibration
// actuator plays the browser's dual-rumble (strong = the low motor, weak = the high one); a touch phone vibrates for
// the same time. The pause menu's Vibración switch (settings.haptics) turns both off. Never gameplay.
import { tuning } from '../data/tuning.js';

const FRAME = 1000 / 60;

// The rumble of a Melee hit for the pirate you play: who 'victim' or 'attacker', hl its hitlag frames.
export function hitRumble(hl, who, R = tuning.feel.rumble) {
  const p = R[who];
  return { ms: Math.round((p.base + p.perHl * Math.max(0, hl)) * FRAME), strong: p.strong, weak: p.weak };
}
// A named pattern of tuning.feel.rumble ('power', 'charge', 'explosion').
export function patternRumble(name, R = tuning.feel.rumble) {
  const p = R[name];
  return p ? { ms: Math.round(p.frames * FRAME), strong: p.strong, weak: p.weak } : null;
}

const pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []);
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function rumble(settings, p) {
  if (!p || !(p.ms > 0) || settings?.haptics === false) return;
  for (const g of pads()) {
    const a = g && g.connected ? g.vibrationActuator : null;
    if (a?.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: p.ms, strongMagnitude: p.strong, weakMagnitude: p.weak }).catch(() => {});
  }
  if (coarse() && navigator.vibrate) try { navigator.vibrate(p.ms); } catch { /* blocked */ }
}

// Cuts whatever plays (Ultimate's rbkind_erase_sp: a beat of stillness before the ultimate lands).
export function rumbleStop() {
  for (const g of pads()) g?.vibrationActuator?.reset?.()?.catch?.(() => {});
  if (coarse() && navigator.vibrate) try { navigator.vibrate(0); } catch { /* blocked */ }
}
