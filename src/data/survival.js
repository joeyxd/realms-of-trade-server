// SRV01: profile-backed satiety and hydration. Gameplay changes remain in the M5 world authority.
export const SURVIVAL = Object.freeze({
  version: 1,
  max: 100,
  drain: Object.freeze({ sat: 100 / 3600, hyd: 100 / 2400 }),
  active: 1.5,
  respawn: 50,
  free: 70,
  low: 30,
  lowPenalty: 0.1,
  maxPenalty: 0.2,
  foodHeal: 0.05,
});

export const FOODS = Object.freeze({
  pescado: Object.freeze({ sat: 35, hyd: 0 }),
  galleta: Object.freeze({ sat: 25, hyd: 0 }),
  fruta: Object.freeze({ sat: 15, hyd: 10 }),
  agua: Object.freeze({ sat: 0, hyd: 40 }),
  ron: Object.freeze({ sat: 5, hyd: 15 }),
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
export function meterPenalty(m) {
  if (!(m < SURVIVAL.free)) return 0;
  if (m >= SURVIVAL.low) return SURVIVAL.lowPenalty * clamp01((SURVIVAL.free - m) / (SURVIVAL.free - SURVIVAL.low));
  return SURVIVAL.lowPenalty + (SURVIVAL.maxPenalty - SURVIVAL.lowPenalty) * clamp01((SURVIVAL.low - m) / SURVIVAL.low);
}
export const needPenalty = (sat, hyd) => Math.floor(Math.max(meterPenalty(sat), meterPenalty(hyd)) * 100 + 1e-9) / 100;
export function staminaRegenMul(sat, hyd) {
  const m = Math.min(sat, hyd);
  return m >= SURVIVAL.low ? 1 : clamp01(m / SURVIVAL.low);
}

const exactRecord = (raw, keys) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(raw);
  return own.length === keys.length && keys.every((key) => {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    return d?.enumerable && Object.hasOwn(d, 'value');
  });
};
const isMeter = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= SURVIVAL.max &&
  Number(v.toFixed(2)) === v;
export const meterValue = (v) => Math.floor(Math.max(0, Math.min(SURVIVAL.max, v)) * 100 + 1e-9) / 100;

// Optional profile field: absent means full meters. Present but malformed is rejected by the profile sanitizer.
export function readSurv(raw) {
  try {
    if (!exactRecord(raw, ['v', 'sat', 'hyd']) || raw.v !== SURVIVAL.version || !isMeter(raw.sat) || !isMeter(raw.hyd)) return null;
    return { v: SURVIVAL.version, sat: raw.sat, hyd: raw.hyd };
  } catch { return null; }
}

export function readSurvField(profile) {
  try {
    if (!profile || typeof profile !== 'object') return { present: false, value: null };
    let owner = profile;
    while (owner && !Object.hasOwn(owner, 'surv')) owner = Object.getPrototypeOf(owner);
    if (!owner) return { present: false, value: null };
    if (owner !== profile) return { present: true, value: null };
    const d = Object.getOwnPropertyDescriptor(profile, 'surv');
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return { present: true, value: null };
    return { present: true, value: readSurv(d.value) };
  } catch { return { present: true, value: null }; }
}
