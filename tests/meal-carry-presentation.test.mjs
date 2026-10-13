import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { packComfort } from '../src/sim/economy/carry.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { CharacterScreen } = await import('../src/ui/characterScreen.js');

test('both character load meters reflect active biscuit, replacement and expiry without changing capacity', () => {
  const profile = { lvl: 1, attr: { v: 1, carga: 0, re: 1 }, carry: { v: 1, backpack: 2 },
    eco: { pack: { cap: 42, maxMass: 50, goods: { hierro: 7, madera: 1 } } }, tools: {} };
  const screen = Object.create(CharacterScreen.prototype);
  const text = { carry: 'Carga', goods: 'Mochila', volume: 'Volumen', weight: 'Peso',
    backpackTier: 'Mochila {n} de {max}', belt: 'Herramientas', beltTools: {} };
  for (const [meal, expected] of [
    [undefined, 40], [{ v: 1, kind: 'heartyBiscuit', ticks: 54000 }, 50],
    [{ v: 1, kind: 'grog', ticks: 5000 }, 40], [{ v: 1, kind: 'heartyBiscuit', ticks: 0 }, 40],
  ]) {
    if (meal) profile.meal = meal; else delete profile.meal;
    const before = structuredClone(profile);
    assert.equal(packComfort(profile), expected);
    const vital = screen.carryVital(profile, text, 'es');
    const inventory = screen.goodsHtml(profile, text, 'es');
    for (const html of [vital, inventory]) {
      assert.match(html, new RegExp(`45 / ${expected}`));
      assert.equal(html.includes('is-over'), expected < 45);
    }
    assert.deepEqual(profile, before);
  }
});
