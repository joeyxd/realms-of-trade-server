import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setLocale } from '../src/core/i18n.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { CharPanel } = await import('../src/ui/charpanel.js');

const markupText = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function panel() {
  const profile = {
    eq: {}, bag: [{ u: 701, b: 'daga', r: 1, l: 5, a: [] }], gold: 80, mast: [[3, 12], [1, 0]],
    flags: { tier: 1, tierSel: 2 }, stats: { kills: 4, wins: 1, gold: 20, items: 3 },
    quests: { tierra: [1, 0] },
    sk: { has: { tromba: [2, 12, 0] }, lo: [['lunge', 'wave'], ['blast', 'blink']], free: 0 },
    eco: { pack: { cap: 50, goods: { madera: 2 } } }, tools: { axe: 1 },
  };
  const stats = () => ({ level: 5, atk: 18, def: 6, maxHp: 148, speed: 5, cdr: 0, ripMul: 1,
    reflMul: 1, guardMax: 100, dashRec: 1, winBonus: 0, potHeal: 1, xpMul: 1, weapon: 0, gold: 80, potions: 2 });
  const ctx = { profile: () => profile, stats,
    seen: new Set(), cell: (...args) => CharPanel.prototype.cell.call(ctx, ...args),
    tattooDetail: (...args) => CharPanel.prototype.tattooDetail.call(ctx, ...args),
    tattooNumbers: (...args) => CharPanel.prototype.tattooNumbers.call(ctx, ...args) };
  return { profile, stats, ctx };
}

test('character panel stats, quests, tattoos, and equipment render in Spanish and English with source IDs intact', t => {
  const previous = globalThis.document?.documentElement?.lang || 'es';
  t.after(() => setLocale(previous));
  const { profile, stats, ctx } = panel();
  const es = {};
  setLocale('es');
  es.stats = CharPanel.prototype.statsHtml.call(ctx, profile);
  es.quests = CharPanel.prototype.questsHtml.call(ctx, profile);
  es.tattoos = CharPanel.prototype.tattooHtml.call(ctx, profile);
  es.gear = CharPanel.prototype.gearHtml.call({ ...ctx, backpack: () => ({ pack: profile.eco.pack, pendingGoods: {} }), locale: 'es' }, profile);
  const en = {};
  setLocale('en');
  en.stats = CharPanel.prototype.statsHtml.call(ctx, profile);
  en.quests = CharPanel.prototype.questsHtml.call(ctx, profile);
  en.tattoos = CharPanel.prototype.tattooHtml.call(ctx, profile);
  en.gear = CharPanel.prototype.gearHtml.call({ ...ctx, backpack: () => ({ pack: profile.eco.pack, pendingGoods: {} }), locale: 'en' }, profile);

  assert.match(markupText(es.stats), /Nivel/);
  assert.match(markupText(es.stats), /Ataque/);
  assert.match(markupText(en.stats), /Level/);
  assert.match(markupText(en.stats), /Attack/);
  assert.match(markupText(en.stats), /Mastery/);
  assert.match(markupText(es.quests), /Sigue los faroles de la playa/);
  assert.match(markupText(en.quests), /Follow the beach lanterns/);
  assert.match(markupText(es.tattoos), /Tatuajes/);
  assert.match(markupText(en.tattoos), /Tattoos/);
  assert.match(markupText(en.tattoos), /Rank II/);
  assert.match(markupText(es.gear), /Bolsa/);
  assert.match(markupText(en.gear), /Bag/);
  assert.match(en.gear, /aria-label="Boarding dagger"/);
  assert.match(markupText(en.gear), /Materials pack/);
  assert.match(en.tattoos, /data-tt="lunge"/);
  assert.match(en.quests, /data-l10n-source="Tierra firme"/);
  assert.match(en.gear, /data-bag="701"/);
  assert.equal(profile.quests.tierra[0], 1);
  assert.deepEqual(profile.sk.lo[0], ['lunge', 'wave']);
  assert.equal(profile.bag[0].u, 701);
  assert.equal(stats().weapon, 0);
});
