import test from 'node:test';
import assert from 'node:assert/strict';
import { lookWeapon, CharacterView } from '../src/render/characters.js';
import { buildLook } from '../src/render/charlooks.js';
import { swingHasSlash } from '../src/ui/feedback.js';
import { QuickBar, sanitizeSlots, quickOptions } from '../src/ui/quickBar.js';
import { TouchControls, ICONS } from '../src/ui/touch.js';
import { registerHooks } from 'node:module';
// These view methods do not animate; the browser supplies GSAP through its import map.
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'gsap' ? { url: 'data:text/javascript,export const gsap = {};', shortCircuit: true } : next(specifier, context);
} });
const { Hud, skillIcon } = await import('../src/ui/hud.js');
const { CharPanel } = await import('../src/ui/charpanel.js');
const { CharacterScreen } = await import('../src/ui/characterScreen.js');
hooks.deregister();
import runtime from '../src/i18n/runtime.js';
import { DATA_ES_EN } from '../src/i18n/data.js';

test('lookWeapon and mesh swapping keep bare geometry and armed capability through a round trip', () => {
  assert.equal(lookWeapon('sable'), true);
  assert.equal(lookWeapon('pistolas'), 'pistols');
  assert.equal(lookWeapon('punos'), false);
  const v = { armed: true, skin: 0, weaponKind: 'sable', mesh: {} };
  for (const kind of ['punos', 'pistolas', 'sable', 'punos']) {
    CharacterView.prototype.setWeapon.call(v, kind);
    assert.equal(v.mesh.geometry, buildLook(0, lookWeapon(kind)).geo);
    assert.equal(v.armed, true);
  }
});
test('fists never request a slash; the armed kits keep theirs', () => {
  assert.equal(swingHasSlash('punos'), false);
  for (const kind of ['sable', 'pistolas']) assert.equal(swingHasSlash(kind), true);
});
test('all fists copy has nonempty Spanish and English entries', () => {
  for (const key of ['touch.quick.fists', 'hud.fistTip', 'hud.noArt', 'runtime.kitFists', 'adventure.fistsNoArts']) {
    assert.equal(runtime[key].length, 2, key);
    for (const text of runtime[key]) assert.ok(typeof text === 'string' && text.trim(), key);
  }
  assert.equal(DATA_ES_EN['Puños'], 'Fists');
});
function surface() {
  const events = {}, children = {}, classes = new Set();
  return { events, classes, dataset: {}, style: {},
    classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k),
      toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } },
    addEventListener: (k, fn) => { events[k] = fn; }, setPointerCapture() {}, releasePointerCapture() {}, setAttribute() {},
    querySelector: k => children[k] ||= surface(),
  };
}
test('fists quick entry survives storage, taps holster, and dims and blocks outside enabled play', () => {
  const entry = { k: 'fists' }, b = surface();
  let playing = true, calls = 0;
  const bar = Object.assign(Object.create(QuickBar.prototype), {
    slots: [entry], buttons: [b], root: surface(), row: surface(), toggle: surface(), state: {},
    enabled: () => playing, holster: () => { calls++; }, closePicker() {}, renderPicker() {},
  });
  assert.ok(quickOptions().some(e => e.k === 'fists'));
  assert.deepEqual(sanitizeSlots([entry, ...Array(7).fill(null)])[0], entry);
  bar.bind(b, 0);
  const tap = () => { for (const name of ['pointerdown', 'pointerup']) b.events[name]({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0 }); };
  bar.update({}); assert.equal(b.classes.has('empty'), false);
  tap(); assert.equal(calls, 1);
  playing = false; bar.update({}); assert.equal(b.classes.has('empty'), true);
  tap(); assert.equal(calls, 1);
  playing = true; b.events.pointerdown({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0 });
  playing = false; bar.update({}); tap(); assert.equal(calls, 1);
});
test('touch fists has a fist, guard and empty disabled arts, then restores the armed faces', () => {
  const btns = Object.fromEntries(['atk', 'parry', 'q', 'e', 'r'].map(k => [k, surface()]));
  const touch = Object.assign(Object.create(TouchControls.prototype), { btns, lbls: {}, locked: {}, atkBtn: btns.atk, parryBtn: btns.parry });
  touch.setWeapon('punos'); touch.setSlots('none', 'none');
  assert.equal(btns.atk.querySelector('.ico').innerHTML, ICONS.fist);
  assert.equal(btns.parry.querySelector('.ico').innerHTML, ICONS.shield);
  for (const k of ['q', 'e', 'r']) {
    assert.equal(btns[k].querySelector('.ico').innerHTML, ''); assert.equal(btns[k].disabled, true);
  }
  touch.setWeapon('sable'); touch.setSlots('lunge', 'wave');
  assert.equal(btns.q.disabled, false); assert.ok(btns.q.querySelector('.ico').innerHTML);
});
test('HUD and character panels render empty fists arts without a sabre fallback', () => {
  const hud = Object.assign(Object.create(Hud.prototype), { last: {}, qSlot: surface(), eSlot: surface() });
  hud.setSlots({ id: 'none' }, { id: 'none' });
  assert.equal(hud.qSlot.querySelector('.ico').innerHTML, '');
  assert.equal(hud.qSlot.style.opacity, '0.35');
  hud.setSlots({ id: 'lunge' }, { id: 'wave' }); assert.equal(hud.qSlot.style.opacity, '');
  assert.equal(skillIcon('none'), ''); assert.equal(skillIcon('fists'), ICONS.fist);
  const panel = { stats: () => ({ weapon: 2 }) };
  assert.match(CharPanel.prototype.tattooHtml.call(panel, {}), /cp-hint/);
  assert.match(CharacterScreen.prototype.skillTattooBlock.call(panel, {}, { kind: 'active', skill: 'lunge' }), /cp-hint/);
  assert.equal(CharacterScreen.prototype.skillTattooBlock.call(panel, {}, { kind: 'passive' }), ''); // only an active node shows the note
});
