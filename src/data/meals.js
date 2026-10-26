// SRV02 special meals. Timers use authoritative connected simulation ticks.
export const MEAL_TICKS = 54000;

export const MEALS = Object.freeze({
  roastFish: Object.freeze({ index: 1, cost: Object.freeze({ pescado: 1 }), heat: true,
    sat: 35, hyd: 0, hp: 1.1, regen: 1, comfort: 0 }),
  grog: Object.freeze({ index: 2, cost: Object.freeze({ ron: 1, agua: 1 }), heat: false,
    sat: 5, hyd: 55, hp: 1, regen: 1.25, comfort: 0 }),
  heartyBiscuit: Object.freeze({ index: 3, cost: Object.freeze({ galleta: 1, harina: 1 }), heat: true,
    sat: 25, hyd: 0, hp: 1, regen: 1, comfort: 10 }),
});

const KINDS = Object.freeze(Object.keys(MEALS));
const DEFAULT_EFFECTS = Object.freeze({ hp: 1, regen: 1, comfort: 0 });

export function mealIndex(kind) {
  return typeof kind === 'string' && Object.hasOwn(MEALS, kind) ? MEALS[kind].index : 0;
}

export function mealEffects(index, ticks) {
  if (!Number.isInteger(index) || !Number.isInteger(ticks) || ticks < 1 || ticks > MEAL_TICKS) return DEFAULT_EFFECTS;
  const meal = MEALS[KINDS[index - 1]];
  return meal?.index === index ? { hp: meal.hp, regen: meal.regen, comfort: meal.comfort } : DEFAULT_EFFECTS;
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

export function readMeal(raw) {
  try {
    if (!exactRecord(raw, ['v', 'kind', 'ticks']) || raw.v !== 1 ||
        typeof raw.kind !== 'string' || !Object.hasOwn(MEALS, raw.kind) ||
        !Number.isSafeInteger(raw.ticks) || raw.ticks < 1 || raw.ticks > MEAL_TICKS) return null;
    return { v: 1, kind: raw.kind, ticks: raw.ticks };
  } catch { return null; }
}

export function readMealField(profile) {
  try {
    if (!profile || typeof profile !== 'object') return { present: false, value: null };
    let owner = profile;
    while (owner && !Object.hasOwn(owner, 'meal')) owner = Object.getPrototypeOf(owner);
    if (!owner) return { present: false, value: null };
    if (owner !== profile) return { present: true, value: null };
    const d = Object.getOwnPropertyDescriptor(profile, 'meal');
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return { present: true, value: null };
    return { present: true, value: readMeal(d.value) };
  } catch { return { present: true, value: null }; }
}
