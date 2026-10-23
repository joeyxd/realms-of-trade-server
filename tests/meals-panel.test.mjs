import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';

class Element {
  constructor() { this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.children = new Map(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  appendChild(child) { child.parentNode = this; return child; }
  focus() {}
  querySelector(s) { return this.children.get(s) || null; }
  querySelectorAll() { return []; }
  set innerHTML(html) {
    this.children.clear();
    for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(/\s+/)) {
      if (!this.children.has(`.${name}`)) this.children.set(`.${name}`, new Element());
    }
    for (const match of html.matchAll(/<article class="fresh-meal-card" data-meal-card="([^"]+)">([\s\S]*?)<\/article>/g)) {
      const card = new Element();
      for (const cls of ['fresh-meal-name', 'fresh-meal-cost', 'fresh-meal-effect', 'fresh-meal-duration', 'fresh-meal-hint']) card.children.set(`.${cls}`, new Element());
      const button = new Element(); button.dataset = { meal: match[1] }; card.children.set('button', button);
      this.children.set(`[data-meal-card="${match[1]}"]`, card);
    }
  }
  click() { for (const fn of this.listeners.click || []) fn({ target: this, preventDefault() {} }); }
}
class DocumentStub {
  createElement() { return new Element(); }
  addEventListener() {}
  removeEventListener() {}
}
function fixture({ locale = 'es', width = 1280, enabled = true, mealsEnabled = true, cookers = [], meal = null, goods = {} } = {}) {
  let time = 0;
  const doc = new DocumentStub(), parent = new Element(); parent.ownerDocument = doc; parent.clientWidth = width;
  const commands = [], toasts = [];
  const client = {
    joined: true, youServer: 2,
    freshwaterStatus: { enabled, mealsEnabled, cookers, meal, source: { id: 'spring-a', near: true } },
    profile: { eco: { tradeRev: 12, pack: { goods, vessels: [] } } },
    send(command) { commands.push(command); },
  };
  const panel = new FreshwaterPanel({ parent, client: () => client, locale: () => locale, toast: value => toasts.push(value), now: () => time });
  return { panel, client, commands, toasts, setTime: value => { time = value; } };
}
const card = (panel, kind) => panel.$(`[data-meal-card="${kind}"]`);

test('special meals are feature gated and prepare exact commands with eligible cooker identity', () => {
  const f = fixture({ goods: { pescado: 1, ron: 1, agua: 1, galleta: 1, harina: 1 }, cookers: [
    { ship: 'raft', part: 'cold', kind: 'grill', near: true, lit: false, broken: false },
    { ship: 'raft', part: 'hot', kind: 'campfire', near: true, lit: true, broken: false },
  ] });
  f.panel.open();
  assert.equal(f.panel.mealSection.hidden, false);
  for (const kind of ['roastFish', 'grog', 'heartyBiscuit']) assert.equal(card(f.panel, kind).querySelector('button').disabled, false);
  assert.equal(f.panel.meal('roastFish'), true);
  assert.deepEqual(f.commands[0], { t: 'cmd', type: 'freshwater', op: 'meal', opId: f.commands[0].opId, expectedRev: 12,
    source: 'roastFish', ship: 'raft', part: 'hot', n: 1 });
  assert.equal(f.panel.acknowledge({ type: 'freshwater', opId: f.commands[0].opId, ok: true }), true);
  assert.equal(f.toasts[0], 'Comida especial preparada y comida.');

  const disabled = fixture({ mealsEnabled: false, goods: { pescado: 1 } });
  assert.equal(disabled.panel.mealSection.hidden, true);
  assert.equal(disabled.panel.meal('roastFish'), false);
});

test('hot recipes explain heat and goods blocks; grog needs no cooker and meal replacement shows a timer', () => {
  for (const width of [1280, 390]) {
    const noHeat = fixture({ width, goods: { pescado: 1, ron: 1, agua: 1 } });
    noHeat.panel.open();
    assert.equal(card(noHeat.panel, 'roastFish').querySelector('button').disabled, true);
    assert.match(card(noHeat.panel, 'roastFish').querySelector('button').title, /fogata|campfire/);
    assert.match(card(noHeat.panel, 'roastFish').querySelector('.fresh-meal-hint').textContent, /fogata|parrilla|campfire|grill/);
    assert.equal(card(noHeat.panel, 'grog').querySelector('button').disabled, false);
    assert.equal(noHeat.panel.meal('grog'), true);
    assert.equal(noHeat.commands[0].ship, ''); assert.equal(noHeat.commands[0].part, '');

    noHeat.client.freshwaterStatus.meal = { v: 1, kind: 'grog', ticks: 54000 };
    noHeat.panel.update();
    assert.match(noHeat.panel.$('.fresh-meal-active').textContent, /15:00/);
    assert.match(noHeat.panel.$('.fresh-meal-active').textContent, /reemplazará|replace it/);

    const missing = fixture({ width, goods: { pescado: 1 } }); missing.panel.open();
    assert.equal(card(missing.panel, 'grog').querySelector('button').disabled, true);
    assert.match(card(missing.panel, 'grog').querySelector('button').title, /ingredientes|missing ingredients/);
    assert.match(card(missing.panel, 'grog').querySelector('.fresh-meal-hint').textContent, /ingredientes|missing ingredients/);
  }
});

test('English cards show explicit action, cost, effect and duration', () => {
  const f = fixture({ locale: 'en', goods: { pescado: 1 }, cookers: [{ ship: 's', part: 'g', kind: 'grill', near: true, lit: true, broken: false }] });
  f.panel.open();
  const fish = card(f.panel, 'roastFish');
  assert.equal(fish.querySelector('.fresh-meal-cost').textContent, '1 fish');
  assert.equal(fish.querySelector('.fresh-meal-effect').textContent, '+10% maximum health');
  assert.equal(fish.querySelector('.fresh-meal-duration').textContent, '15 min');
  assert.equal(fish.querySelector('button').textContent, 'Prepare and eat');
});

test('reinforced biscuit reports comfortable load as 10 units in both locales', () => {
  for (const [locale, name, effect] of [
    ['es', 'Galleta reforzada', '+10 unidades de carga cómoda; no cambia la masa máxima'],
    ['en', 'Reinforced biscuit', '+10 units of comfortable load; maximum mass is unchanged'],
  ]) {
    const f = fixture({ locale, goods: { galleta: 1, harina: 1 } }); f.panel.open();
    const biscuit = card(f.panel, 'heartyBiscuit');
    assert.equal(biscuit.querySelector('.fresh-meal-name').textContent, name);
    assert.equal(biscuit.querySelector('.fresh-meal-effect').textContent, effect);
  }
});

test('meal retry reuses the exact request and server ingredient errors stay meal specific', () => {
  const f = fixture({ goods: { ron: 1, agua: 1 } }); f.panel.open();
  assert.equal(f.panel.meal('grog'), true);
  const request = f.commands[0];
  f.setTime(1000); f.panel.update();
  assert.equal(f.commands[1], request);
  assert.equal(f.commands[1].opId, request.opId);
  assert.equal(f.panel.acknowledge({ type: 'freshwater', opId: request.opId, ok: false, why: 'goods' }), true);
  assert.equal(f.panel.$('.fresh-status').textContent, 'Faltan ingredientes para esta receta.');
  assert.equal(f.panel.pending, null);
});
