// Release-image guards: only Node and src/; never import three.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENTATION_EFFECTS, PRESENTATION_PARAMETERS, PRESENTATION_SLOTS, MAX_PRESENTATION_BYTES,
  defaultPresentationBinding, emptyPresentationBindings, presentationParameters, slotAcceptsEffect, validatePresentationBindings,
} from '../src/data/presentationBindings.js';
import { effectParameters } from '../src/editor/effectLibrary.js';
import { NIAGARA_NATIVE } from '../src/editor/niagaraNative.js';

const FLAME = 'niagara-985a431dc6c0d1ca', HIT = 'niagara-97a82bae61b29237';
const full = () => ({ ...emptyPresentationBindings(), bindings: {
  campfire: defaultPresentationBinding('campfire', FLAME), brazier: defaultPresentationBinding('brazier', FLAME),
  meleeHit: defaultPresentationBinding('meleeHit', HIT), damageHit: defaultPresentationBinding('damageHit', HIT),
  trombaImpact: defaultPresentationBinding('trombaImpact', HIT),
} });

test('every bindable effect is a registered native effect with the Taller parameter ranges', () => {
  for (const id of Object.keys(PRESENTATION_EFFECTS)) {
    assert.ok(NIAGARA_NATIVE[id], id);
    assert.deepEqual(effectParameters(id).map(p => ({ ...p })), PRESENTATION_PARAMETERS.map(p => ({ ...p })));
  }
  assert.equal(NIAGARA_NATIVE[FLAME].recipe, 'flame-single-v1');
  assert.equal(NIAGARA_NATIVE[HIT].recipe, 'basichit-v1');
});

test('empty and full documents validate; absent slots stay absent', () => {
  assert.deepEqual(validatePresentationBindings(emptyPresentationBindings()), { ok: true, value: emptyPresentationBindings() });
  const result = validatePresentationBindings(full());
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value.bindings), Object.keys(PRESENTATION_SLOTS));
  assert.equal(result.value.bindings.campfire.parameters.count, 1);
  assert.equal('count' in result.value.bindings.meleeHit.parameters, false);
  const one = { ...emptyPresentationBindings(), bindings: { meleeHit: defaultPresentationBinding('meleeHit', HIT) } };
  assert.deepEqual(Object.keys(validatePresentationBindings(one).value.bindings), ['meleeHit']);
});

test('slot and effect must agree on loop or burst', () => {
  assert.equal(slotAcceptsEffect('campfire', FLAME), true);
  assert.equal(slotAcceptsEffect('campfire', HIT), false);
  assert.equal(slotAcceptsEffect('meleeHit', FLAME), false);
  assert.equal(slotAcceptsEffect('trombaImpact', HIT), true);
  assert.equal(slotAcceptsEffect('trombaImpact', FLAME), false);
  assert.equal(defaultPresentationBinding('meleeHit', FLAME), null);
  const doc = full(); doc.bindings.meleeHit = { effect: FLAME, parameters: defaultPresentationBinding('campfire', FLAME).parameters };
  assert.equal(validatePresentationBindings(doc).why, 'mode');
});

test('closed schema: unknown slots, effects, keys and out-of-range values are refused', () => {
  const cases = [
    [null, 'shape'], [[], 'shape'], [{ ...full(), extra: 1 }, 'shape'],
    [{ ...full(), version: 2 }, 'identity'], [{ ...full(), schema: 'x' }, 'identity'],
    [{ ...full(), bindings: { ...full().bindings, torch: full().bindings.campfire } }, 'slot'],
  ];
  for (const [doc, why] of cases) assert.equal(validatePresentationBindings(doc).why, why);
  const mutate = (fn) => { const doc = full(); fn(doc.bindings); return validatePresentationBindings(doc).why; };
  assert.equal(mutate(b => { b.campfire.effect = 'niagara-0000000000000000'; }), 'effect');
  assert.equal(mutate(b => { b.campfire.extra = true; }), 'shape');
  assert.equal(mutate(b => { b.campfire.parameters.scale = 3.01; }), 'parameters');
  assert.equal(mutate(b => { b.campfire.parameters.count = 6; }), 'parameters');
  assert.equal(mutate(b => { b.campfire.parameters.count = 1.5; }), 'parameters');
  assert.equal(mutate(b => { b.meleeHit.parameters.count = 1; }), 'parameters');
  assert.equal(mutate(b => { delete b.meleeHit.parameters.tint; }), 'parameters');
  assert.equal(mutate(b => { b.meleeHit.parameters.tint = 'red'; }), 'parameters');
  assert.equal(mutate(b => { b.meleeHit.parameters.opacity = Number.NaN; }), 'parameters');
  assert.equal(mutate(b => { b.meleeHit.parameters.seed = '1'; }), 'parameters');
  assert.equal(mutate(b => { b.meleeHit.parameters.__proto__ = {}; }), 'parameters');
});

test('colors normalize to lower case and the full document stays under the byte cap', () => {
  const doc = full(); doc.bindings.campfire.parameters.tint = '#FFAA00';
  const result = validatePresentationBindings(doc);
  assert.equal(result.value.bindings.campfire.parameters.tint, '#ffaa00');
  assert.ok(new TextEncoder().encode(JSON.stringify(result.value)).byteLength < MAX_PRESENTATION_BYTES);
  assert.equal(presentationParameters('nope'), null);
});
