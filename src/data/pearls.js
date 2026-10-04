// Black pearls (M4.8). The first playable slice is Brasa; the other elements stay in PLAN-M4.8.md
// until their skills and curses are implemented. A pearl is {uid, kind}, separate from numbered gear.
export const PEARLS = {
  brasa: {
    name: 'Perla de Brasa', skill: 'comet', elem: 1, color: '#ff793b',
    passive: 'Tus golpes queman durante 3 s. Repetir un golpe renueva la quemadura.',
    curse: 'El agua te apaga: al vadear pierdes un 4 % de vida máxima por segundo.',
  },
};
export const PEARL_IDS = Object.keys(PEARLS);
export const PEARL = {
  bag: 8, calm: 3, returnAfter: 90, value: 600, transferR: 3.5, swapCd: 4,
  eliteChance: 0.025, bossChance: 0.12, chestChance: 0.08, tideBonus: 0.5,
  burnTime: 3, burnEvery: 0.5, burnMult: 0.12, waterEvery: 0.5, waterDps: 0.04,
};
export const newPearls = () => ({ swallowed: null, bag: [] });
export function sanitizePearl(raw) {
  if (!raw || !Object.hasOwn(PEARLS, raw.kind) || typeof raw.uid !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,100}$/.test(raw.uid)) return null;
  return { uid: raw.uid, kind: raw.kind };
}
export function sanitizePearls(raw) {
  const out = newPearls(), used = new Set();
  const keep = (v) => {
    const p = sanitizePearl(v);
    if (!p || used.has(p.uid)) return null;
    used.add(p.uid); return p;
  };
  out.swallowed = keep(raw?.swallowed);
  out.bag = (Array.isArray(raw?.bag) ? raw.bag : []).slice(0, PEARL.bag).map(keep).filter(Boolean);
  return out;
}
