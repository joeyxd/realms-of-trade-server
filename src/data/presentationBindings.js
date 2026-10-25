// Presentation bindings (ST01d): which native visual effect plays for a game moment (campfire, brazier, a hit), chosen in
// the Taller and published by a GM for every player. Pure data and validation shared by the browser and the server: no
// three, no DOM. Visual only: a binding never changes damage, range, timing or any rule of the simulation.

export const PRESENTATION_SCHEMA = 'marea.presentation-bindings';
export const PRESENTATION_VERSION = 1;
export const MAX_PRESENTATION_BYTES = 4096;

// The native effects a slot may use, by how they play: 'loop' runs for as long as its anchor exists, 'burst' plays once.
export const PRESENTATION_EFFECTS = Object.freeze({
  'niagara-985a431dc6c0d1ca': Object.freeze({ mode: 'loop', name: 'NS_Flame_Single' }),
  'niagara-97a82bae61b29237': Object.freeze({ mode: 'burst', name: 'NS_BasicHit' }),
});

// The game moments that accept a binding. An absent slot keeps the current procedural look.
export const PRESENTATION_SLOTS = Object.freeze({
  campfire: Object.freeze({ mode: 'loop' }),
  brazier: Object.freeze({ mode: 'loop' }), // braziers and the gate-post torches
  meleeHit: Object.freeze({ mode: 'burst' }), // your blade lands on an enemy (mhit)
  damageHit: Object.freeze({ mode: 'burst' }), // a confirmed shot or skill hit on an enemy (damage, not melee, not burn)
});

// Same keys and ranges as the Taller's native parameters (effectLibrary.js NATIVE_PARAMETERS; a test keeps them equal).
export const PRESENTATION_PARAMETERS = Object.freeze([
  Object.freeze({ key: 'seed', min: 0, max: 65533, step: 1, default: 6371, integer: true }),
  Object.freeze({ key: 'scale', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'height', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'duration', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'speed', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'brightness', min: 0.25, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'opacity', min: 0, max: 1, step: 0.01, default: 1 }),
  Object.freeze({ key: 'tint', type: 'color', default: '#ffffff' }),
]);
// Loop slots also choose how many flames stand around the anchor.
export const PRESENTATION_LOOP_PARAMETERS = Object.freeze([
  Object.freeze({ key: 'count', min: 1, max: 5, step: 1, default: 1, integer: true }),
]);

export function presentationParameters(slot) {
  const mode = PRESENTATION_SLOTS[slot]?.mode;
  if (!mode) return null;
  return mode === 'loop' ? [...PRESENTATION_PARAMETERS, ...PRESENTATION_LOOP_PARAMETERS] : [...PRESENTATION_PARAMETERS];
}

export function slotAcceptsEffect(slot, effectId) {
  return Object.hasOwn(PRESENTATION_SLOTS, slot) && Object.hasOwn(PRESENTATION_EFFECTS, effectId) &&
    PRESENTATION_SLOTS[slot].mode === PRESENTATION_EFFECTS[effectId].mode;
}

export function emptyPresentationBindings() {
  return { schema: PRESENTATION_SCHEMA, version: PRESENTATION_VERSION, bindings: {} };
}

export function defaultPresentationBinding(slot, effectId) {
  if (!slotAcceptsEffect(slot, effectId)) return null;
  return { effect: effectId, parameters: Object.fromEntries(presentationParameters(slot).map(p => [p.key, p.default])) };
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const COLOR = /^#[0-9a-f]{6}$/i;

function validParameters(raw, metadata) {
  if (!exactKeys(raw, metadata.map(p => p.key))) return null;
  const out = {};
  for (const p of metadata) {
    const value = raw[p.key];
    if (p.type === 'color') {
      if (typeof value !== 'string' || !COLOR.test(value)) return null;
      out[p.key] = value.toLowerCase();
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < p.min || value > p.max || (p.integer && !Number.isInteger(value))) return null;
      out[p.key] = value;
    }
  }
  return out;
}

// Returns { ok: true, value } with a normalized copy (slots in the PRESENTATION_SLOTS order), or { ok: false, why }.
export function validatePresentationBindings(raw) {
  if (!exactKeys(raw, ['schema', 'version', 'bindings'])) return { ok: false, why: 'shape' };
  if (raw.schema !== PRESENTATION_SCHEMA || raw.version !== PRESENTATION_VERSION) return { ok: false, why: 'identity' };
  if (!plain(raw.bindings)) return { ok: false, why: 'shape' };
  const value = emptyPresentationBindings();
  for (const slot of Object.keys(raw.bindings)) if (!Object.hasOwn(PRESENTATION_SLOTS, slot)) return { ok: false, why: 'slot' };
  for (const slot of Object.keys(PRESENTATION_SLOTS)) {
    if (!Object.hasOwn(raw.bindings, slot)) continue;
    const binding = raw.bindings[slot];
    if (!exactKeys(binding, ['effect', 'parameters'])) return { ok: false, why: 'shape' };
    if (typeof binding.effect !== 'string' || !Object.hasOwn(PRESENTATION_EFFECTS, binding.effect)) return { ok: false, why: 'effect' };
    if (!slotAcceptsEffect(slot, binding.effect)) return { ok: false, why: 'mode' };
    const parameters = validParameters(binding.parameters, presentationParameters(slot));
    if (!parameters) return { ok: false, why: 'parameters' };
    value.bindings[slot] = { effect: binding.effect, parameters };
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_PRESENTATION_BYTES) return { ok: false, why: 'size' };
  return { ok: true, value };
}
