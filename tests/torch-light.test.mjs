// The hand torch in the crafting menu and the fire panel, and projectiles lighting their surroundings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TORCH_RECIPE, WorkbenchPanel, workbenchPreview } from '../src/ui/workbench.js';
import { CRAFT_TEXT, RECIPE_UI, UPCOMING_RECIPES } from '../src/ui/craftingCatalog.js';
import { newFirePanel } from '../src/ui/firePanel.js';
import { FIRE_SECONDS } from '../src/data/fire.js';
import { getLocale, setLocale } from '../src/core/locale.js';
import { uiLang } from '../src/ui/kit.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';

const profile = (goods) => ({ eco: { pack: { cap: 30, goods }, tradeRev: 4 }, tools: {} });
const fire = (seconds = 0, lit = false, torchRules = 2) => ({ enabled: true, rev: 6, torchRules, slots: seconds ? [{ key: 'hand', kind: 'handTorch', seconds, lit }] : [] });

test('crafting UI language follows the locale source even when document.lang is stale', () => {
  const originalLocale = getLocale(), originalDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: originalLocale === 'en' ? 'es' : 'en' } };
  try {
    setLocale('en'); assert.equal(uiLang(), 'en');
    setLocale('es'); assert.equal(uiLang(), 'es');
  } finally { setLocale(originalLocale); globalThis.document = originalDocument; }
});

test('the torch is a real hand recipe: two logs and resin from the pack, no output goods, one load', () => {
  assert.deepEqual(TORCH_RECIPE.inputs, { tronco: 2, resina: 1 });
  assert.equal(TORCH_RECIPE.hand, true);
  assert.equal(RECIPE_UI.antorcha.cat, 'tools');
  assert.equal(UPCOMING_RECIPES.tools.some(([id]) => id === 'antorcha'), false, 'no longer listed as undiscovered');
  const ready = workbenchPreview(profile({ tronco: 2, resina: 1 }), 1, 'antorcha');
  assert.equal(ready.fire, 'handTorch');
  assert.equal(ready.canCraft, true);
  assert.equal(ready.craftMax, 1);
  assert.equal(ready.usedAfter, ready.usedBefore - 6.25, 'fuel leaves the pack without adding output goods');
  const logsOnly = workbenchPreview(profile({ tronco: 6 }), 1, 'antorcha');
  assert.equal(logsOnly.materialsFit, false, 'resin is required alongside logs');
  assert.deepEqual(workbenchPreview(profile({ madera: 1 }), 1, 'antorcha', 1).inputs.map(i => i.good), ['madera']);
});

function torchPanel(goods, torch) {
  const sent = [];
  const panel = Object.create(WorkbenchPanel.prototype);
  Object.assign(panel, { qty: 1, recipe: 'antorcha', pending: null, lastResult: '', resultSource: null, resultTone: '' });
  panel.baseContext = () => ({ profile: profile(goods) });
  panel.context = () => null; // away from the bench: hand recipes only
  panel.torch = () => torch;
  panel.submitFire = (command) => { sent.push(command); return true; };
  panel.submitCommand = () => { throw new Error('the torch never goes through resource crafting'); };
  panel.update = () => {};
  return { panel, sent };
}

test('crafting the torch sends the fire panel intent and resolves on the matching fire event', () => {
  const { panel, sent } = torchPanel({ tronco: 2, resina: 1 }, fire());
  assert.equal(panel.confirm(), true);
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0], opId: 'id' }, { t: 'cmd', type: 'fire', op: 'load', opId: 'id', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 6, lit: true, rules: 2 });
  assert.equal(Object.isFrozen(sent[0]), true);
  assert.equal(panel.confirm(), false, 'one request at a time');
  assert.equal(panel.onFire({ type: 'fire', op: 'load', opId: 'other', ok: true }), false);
  assert.equal(panel.onFire({ type: 'fire', op: 'set', opId: sent[0].opId, ok: true }), false);
  assert.equal(panel.onFire({ type: 'fire', op: 'load', opId: sent[0].opId, ok: true }), true);
  assert.equal(panel.pending, null);
  assert.match(panel.lastResult, new RegExp(`${FIRE_SECONDS.handTorch / 60} min`));
});

test('a burning torch, missing resin or a world without fire block the torch with a clear reason', () => {
  const f = CRAFT_TEXT.es.feedback;
  const burning = torchPanel({ tronco: 2, resina: 1 }, fire(600, true));
  assert.equal(burning.panel.confirm(), false);
  const p = burning.panel.firePreview(workbenchPreview(profile({ tronco: 2, resina: 1 }), 1, 'antorcha'), burning.panel.torchState());
  assert.equal(p.fireBlock, 'burning');
  assert.equal(burning.panel.previewMessage(p, {}, TORCH_RECIPE), f.torchBurning.replace('{time}', '10:00'));

  const noResin = torchPanel({ tronco: 5 }, fire());
  assert.equal(noResin.panel.confirm(), false);
  const q = noResin.panel.firePreview(workbenchPreview(profile({ tronco: 5 }), 1, 'antorcha'));
  assert.equal(noResin.panel.previewMessage(q, {}, TORCH_RECIPE), f.torchFuel);

  const off = torchPanel({ tronco: 2, resina: 1 }, { enabled: false, rev: 0, slots: [] });
  assert.equal(off.panel.confirm(), false);
  assert.equal(off.sent.length + noResin.sent.length + burning.sent.length, 0);

  const denied = torchPanel({ tronco: 2, resina: 1 }, fire());
  denied.panel.confirm();
  denied.panel.onFire({ type: 'fire', op: 'load', opId: denied.sent[0].opId, ok: false, why: 'goods' });
  assert.equal(denied.panel.lastResult, f.torchFuel);
});

class Element {
  constructor() { this.listeners = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.children = new Map(); }
  setAttribute() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  appendChild(child) { return child; }
  focus() {}
  querySelector(selector) { return this.children.get(selector) || null; }
  set innerHTML(value) {
    for (const match of value.matchAll(/class="([^"]+)"/g))
      for (const name of match[1].split(/\s+/)) if (!this.children.has(`.${name}`)) this.children.set(`.${name}`, new Element());
  }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); }
}

test('the fire panel shows both log and resin cards and links to torch crafting when short', () => {
  const doc = { createElement: () => new Element(), addEventListener() {}, removeEventListener() {} };
  const parent = new Element(); parent.ownerDocument = doc;
  const client = { joined: true, youServer: 3, fire: fire(), profile: { eco: { pack: { goods: { tronco: 4 } } } }, send() {} };
  let crafted = 0;
  const panel = newFirePanel({ parent, client: () => client, openCraft: kind => { assert.equal(kind, 'handTorch'); crafted++; } });
  assert.equal(panel.open(), true);
  assert.equal(panel.$('.fire-card-name-tronco').textContent, 'Tronco');
  assert.equal(panel.$('.fire-card-count-tronco').textContent, '2 / 2');
  assert.equal(panel.$('.fire-card-count-resina').textContent, '0 / 1');
  assert.equal(panel.$('.fire-card-resina').className, 'fire-card fire-card-resina is-short');
  assert.equal(panel.$('.fire-hint').hidden, false);
  assert.match(panel.$('.fire-hint').textContent, /resina puede caer al talar palmeras/);
  assert.equal(panel.loadButton.disabled, true);
  assert.equal(panel.$('.fire-craft').hidden, false);
  panel.$('.fire-craft').click();
  assert.equal(crafted, 1);
  assert.equal(panel.active, false, 'the panel steps aside for the crafting menu');

  client.profile.eco.pack.goods.resina = 1; panel.open();
  assert.equal(panel.$('.fire-card-resina').className, 'fire-card fire-card-resina is-ok');
  assert.equal(panel.$('.fire-hint').hidden, true);
  assert.equal(panel.$('.fire-craft').hidden, true);
  assert.equal(panel.loadButton.disabled, false);
  client.fire = fire(900, true); panel.update();
  assert.equal(panel.$('.fire-need').hidden, true, 'a burning torch needs no fuel card');
  assert.equal(panel.$('.fire-slot').className, 'fire-slot is-lit');
});

let mod = null;
try {
  const THREE = await import('three');
  const { LocalLights } = await import('../src/render/lights.js');
  const { U } = await import('../src/render/toon.js');
  mod = { THREE, LocalLights, U };
} catch { mod = null; }
const opts = mod ? {} : { skip: 'three is not installed (npm install)' };

const shotView = (points) => {
  const glow = new Float32Array(points.length * 4), glowColor = new Uint32Array(points.length);
  points.forEach(([x, z, kind], i) => { glow.set([x, 1, z, kind], i * 4); glowColor[i] = 0xffc23d; });
  return { glow, glowColor, glowCount: points.length };
};

test('projectiles light their surroundings with free slots only, nearest first', opts, () => {
  const map = generateWorld(GAME.seed);
  const far = { x: map.landmarks.spawn.x, y: 0, z: map.landmarks.spawn.z };
  for (const max of [4, 8, 12]) {
    const lights = new mod.LocalLights(map);
    lights.max = max;
    lights.sources = []; // open sea at night: no static light nearby
    Object.assign(lights.knobs, { fire: 1 });
    lights.setShots(shotView([[far.x + 30, far.z, 0], [far.x + 2, far.z, 0], [far.x + 9, far.z, 3], [far.x + 5, far.z, 2], [far.x + 60, far.z, 0]]));
    lights.update(1 / 60, far);
    const count = mod.U.mnLightCount.value;
    assert.equal(count, Math.min(4, max), `tier ${max}: up to four moving lights, never beyond the budget`);
    const xs = mod.U.mnLightPos.value.slice(0, count).map((v) => Math.round(v.x - far.x));
    assert.deepEqual(xs, [2, 5, 9, 30].slice(0, count), 'nearest projectiles first; beyond 40 u never');
    lights.setShots(null); lights.update(1 / 60, far);
    assert.equal(mod.U.mnLightCount.value, 0);
  }
});

test('projectile lights never take the slots of the ranked static lights', opts, () => {
  const map = generateWorld(GAME.seed);
  const village = { x: map.landmarks.village.x, y: 0, z: map.landmarks.village.z };
  const lights = new mod.LocalLights(map);
  lights.max = 8;
  Object.assign(lights.knobs, { fire: 1, lava: 1, night: 1, eyes: 1 });
  lights.update(1 / 60, village);
  const before = mod.U.mnLightCount.value, statics = mod.U.mnLightPos.value.slice(0, before).map((v) => v.clone());
  lights.setShots(shotView([[village.x + 1, village.z, 0], [village.x + 2, village.z, 1], [village.x + 3, village.z, 2]]));
  lights.update(1 / 60, village);
  assert.ok(mod.U.mnLightCount.value <= 8);
  assert.equal(mod.U.mnLightCount.value, Math.min(8, before + 3));
  for (let i = 0; i < before; i++) {
    const a = mod.U.mnLightPos.value[i], b = statics[i];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.2 && a.w === b.w, 'static lights keep their slots');
  }
});
