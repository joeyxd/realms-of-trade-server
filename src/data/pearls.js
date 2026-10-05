// Black pearls (M4.8). A pearl is {uid, kind}, separate from numbered gear.
export const PEARLS = {
  brasa: {
    name: 'Perla de Brasa', skill: 'comet', elem: 1, color: '#ff793b',
    passive: 'Tus golpes queman durante 3 s. Repetir un golpe renueva la quemadura.',
    curse: 'El agua te apaga: al vadear pierdes un 4 % de vida máxima por segundo.',
  },
  escarcha: {
    name: 'Perla de Escarcha', skill: 'iceanchor', elem: 2, color: '#83ddff',
    passive: 'Tus golpes ralentizan durante 3 s; 3 acumulaciones congelan 0,6 s (los jefes no se congelan).',
    curse: 'El fuego y la lava te hacen un 50 % más de daño.',
  },
  tormenta: {
    name: 'Perla de Tormenta', skill: 'mastbolt', elem: 3, color: '#ffe45c',
    passive: 'Tus golpes saltan a otro enemigo cercano y le hacen la mitad de daño.',
    curse: 'Imán de tormenta: las balas enemigas cercanas se curvan suavemente hacia donde estás al dispararse.',
  },
  tinta: {
    name: 'Perla de Tinta', skill: 'inkcloud', elem: 4, color: '#a77bff',
    passive: 'Tus golpes marcan a los enemigos de la isla durante 4 s: los golpes posteriores les hacen un 10 % más de daño. No se acumula.',
    curse: 'La luz te quema: de día las pociones curan al 70 %; de noche haces un 10 % más de daño.',
  },
};
export const PEARL_IDS = Object.keys(PEARLS);
export const PEARL = {
  bag: 8, calm: 3, returnAfter: 90, value: 600, transferR: 3.5, swapCd: 4,
  eliteChance: 0.025, bossChance: 0.12, chestChance: 0.08, tideBonus: 0.5,
  burnTime: 3, burnEvery: 0.5, burnMult: 0.12, waterEvery: 0.5, waterDps: 0.04,
  chillTime: 3, chillSlow: 0.7, chillHits: 3, freezeTime: 0.6,
  lightningRange: 5, lightningMult: 0.5,
  inkMarkTime: 4, inkMarkMult: 1.1, inkDayHeal: 0.7, inkNightMult: 1.1,
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
