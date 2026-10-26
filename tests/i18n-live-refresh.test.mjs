import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
import { getLocale, setLocale, initI18n, setText, setAttributeText, t } from '../src/core/i18n.js';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';
import { WorkshopPanel } from '../src/ui/workshop.js';
import { FirePanel } from '../src/ui/firePanel.js';
import { SwimStatus } from '../src/client/swimStatus.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){},from(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { Hud } = await import('../src/ui/hud.js');
const { CharPanel } = await import('../src/ui/charpanel.js');

// A stable DOM surface: locale changes exercise the production subscriptions and
// catalog bindings, without a game loop, reopening panels, or calling render again.
class Element {
  constructor(doc) {
    this.ownerDocument = doc; doc.nodes.push(this);
    this.writes = 0;
    this.dataset = new Proxy({}, { set: (target, key, value) => { this.writes++; target[key] = value; return true; } });
    this.attrs = {}; this.selectors = new Map(); this.listeners = {};
    this.style = {}; this.textContent = ''; this.innerHTML = ''; this.hidden = false;
    this.classList = { contains: name => this.classes?.has(name) || false, add() {}, remove() {}, toggle() {} };
  }
  setAttribute(name, value) {
    this.writes++;
    this.attrs[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  get textContent() { return this.text; }
  set textContent(value) { this.writes++; this.text = value; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element(this.ownerDocument));
    return this.selectors.get(selector);
  }
  querySelectorAll(selector) {
    if (selector === '.bar.need') return ['food', 'water'].map(name => {
      const bar = this.querySelector(`.need.${name}`); bar.classes = new Set([name]); return bar;
    });
    return [];
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener() {}
  appendChild(child) { child.parentNode = this; return child; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  prepend(node) { this.appendChild(node); }
  before() {}
  contains() { return false; }
  focus() {}
  remove() { this.removed = true; }
  click() { for (const listener of this.listeners.click || []) listener({ target: this }); }
}
function documentStub() {
  const doc = { nodes: [], documentElement: { lang: 'es' }, createElement: () => new Element(doc),
    addEventListener() {}, removeEventListener() {}, querySelectorAll(selector) {
      return selector === '[data-locale]' ? [] : this.nodes.filter(node => !node.removed &&
        (node.dataset.l10nKey || Object.keys(node.attrs).some(key => key.startsWith('data-l10n-'))));
    } };
  doc.body = doc.createElement('body'); return doc;
}
const originalDocument = globalThis.document, originalObserver = globalThis.MutationObserver;
const originalLocale = getLocale(), doc = documentStub();
globalThis.document = doc;
globalThis.MutationObserver = class { observe() {} };
initI18n();
after(() => { setLocale(originalLocale); globalThis.document = originalDocument; globalThis.MutationObserver = originalObserver; });
const element = () => doc.createElement('div');
const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function profile() {
  return { lvl: 3, eq: {}, bag: [], gold: 0, tools: { axe: 1 },
    progression: { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] },
    eco: { tradeRev: 4, pack: { cap: 50, goods: { madera: 3, fruta: 2 }, vessels: [] } } };
}

test('HUD riposte, needs text and accessible labels refresh ES to EN and back with unchanged stats', () => {
  setLocale('es');
  const hud = new Hud(element(), {});
  const stats = { hp: 100, maxHp: 100, riposte: 47, xp: 0, xpNext: 100, level: 1, combo: 0, dead: false };
  hud.setStats(stats); hud.setNeeds({ needs: 1, sat: 62, hyd: 81, needPen: .25 });
  const check = (riposte, food, water, hunger, thirst, needs) => {
    assert.equal(hud.rpNum.textContent, riposte);
    assert.equal(hud.needBars[0].num.textContent, food); assert.equal(hud.needBars[1].num.textContent, water);
    assert.equal(hud.needBars[0].bar.getAttribute('title'), hunger); assert.equal(hud.needBars[1].bar.getAttribute('title'), thirst);
    assert.equal(hud.needsEl.getAttribute('aria-label'), needs);
  };
  check('RIPOSTE 47 %', 'COMIDA 62', 'AGUA 81', 'Hambre 62', 'Sed 81', 'Necesidades · 25%');
  setLocale('en'); check('RIPOSTE 47 %', 'FOOD 62', 'WATER 81', 'Hunger 62', 'Thirst 81', 'Needs · 25%');
  setLocale('es'); check('RIPOSTE 47 %', 'COMIDA 62', 'AGUA 81', 'Hambre 62', 'Sed 81', 'Necesidades · 25%');
  hud.setStats({ ...stats, riposte: 100 }); assert.equal(hud.rpNum.textContent, t('hud.ready'));
  setLocale('en'); assert.equal(hud.rpNum.textContent, t('hud.ready'));
  hud.setStats(stats); assert.equal(hud.rpNum.textContent, 'RIPOSTE 47 %');
  setLocale('es'); assert.equal(hud.rpNum.textContent, 'RIPOSTE 47 %');
});

test('unchanged rounded needs values do not rewrite text or localization attributes', () => {
  setLocale('es');
  const hud = new Hud(element(), {}), needs = { needs: 1, sat: 62, hyd: 81, needPen: .25 };
  const nodes = [hud.needsEl, ...hud.needBars.flatMap(item => [item.num, item.bar])];
  const writes = () => nodes.map(node => node.writes);
  hud.setNeeds(needs);
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    const before = writes();
    hud.setNeeds(needs);
    hud.setNeeds({ ...needs, sat: 62.1, hyd: 81.1, needPen: .251 });
    assert.deepEqual(writes(), before);
    assert.equal(hud.needBars[0].num.textContent, locale === 'en' ? 'FOOD 62' : 'COMIDA 62');
    assert.equal(hud.needsEl.getAttribute('aria-label'), locale === 'en' ? 'Needs · 25%' : 'Necesidades · 25%');
  }
  hud.setNeeds({ ...needs, sat: 63, hyd: 82, needPen: .26 });
  assert.equal(hud.needBars[0].num.textContent, 'COMIDA 63');
  assert.equal(hud.needBars[1].num.textContent, 'AGUA 82');
  assert.equal(hud.needsEl.getAttribute('aria-label'), 'Necesidades · 26%');
});

test('open freshwater panel refreshes controls, food, meals and status without retrying pending intent', () => {
  setLocale('es');
  const sent = [], client = { joined: true, youServer: 7, profile: profile(), send: command => sent.push(command),
    freshwaterStatus: { enabled: true, canteenEnabled: true, mealsEnabled: true, needs: { sat: 50, hyd: 60 }, barrels: [] } };
  const panel = new FreshwaterPanel({ parent: element(), client: () => client, locale: getLocale });
  assert.equal(panel.open(), true);
  const pending = { command: Object.freeze({ op: 'craftBucket', opId: 'fresh-pending' }), sentAt: 0 };
  panel.pending = pending; panel.setStatus('waiting'); panel.render();
  const before = structuredClone(client.profile), guide = panel.guide.querySelector('details'); guide.open = true;
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    assert.equal(panel.$('.fresh-title').textContent, locale === 'en' ? 'Fresh water' : 'Agua dulce');
    assert.equal(panel.$('.fresh-status').textContent, panel.copy().waiting);
    assert.equal(panel.closeButton.getAttribute('aria-label'), panel.copy().close);
    assert.match(plain(panel.foodsBox.innerHTML), locale === 'en' ? /Fruit/ : /Fruta/);
    assert.equal(panel.$('.fresh-meals-title').textContent, panel.copy().meals);
    assert.equal(panel.active, true); assert.equal(panel.root.hidden, false);
    assert.equal(panel.pending, pending); assert.equal(guide.open, true);
  }
  assert.equal(sent.length, 0); assert.deepEqual(client.profile, before);
  panel.dispose();
});

test('open workshop refreshes a pending request and a completed denial without resending', () => {
  setLocale('es');
  const p = profile(), sent = [], panel = new WorkshopPanel({ parent: element(), profile: () => p,
    context: () => ({ profile: p }), enabled: () => true, getLocale,
    submit: command => { sent.push(command); return true; } });
  assert.equal(panel.open(), true);
  assert.equal(panel.contribute(1), true);
  const pending = panel.pending, command = pending.command, before = structuredClone(p);
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    assert.equal(panel.$('[data-title]').textContent, locale === 'en' ? 'Salty Shore Workshop' : 'Taller de Salty Shore');
    assert.equal(panel.$('[data-status]').textContent, panel.copy().waiting);
    assert.equal(panel.$('[data-progress]').getAttribute('aria-label'), panel.copy().progress);
    assert.equal(panel.pending, pending); assert.equal(panel.pending.command, command);
    assert.equal(panel.active, true); assert.equal(panel.root.hidden, false);
  }
  panel.onResult({ type: 'artisan', op: command.op, opId: command.opId, ok: false, why: 'goods' });
  for (const locale of ['en', 'es']) {
    setLocale(locale); assert.equal(panel.$('[data-status]').textContent, panel.copy().goods);
  }
  assert.equal(sent.length, 1); assert.deepEqual(p, before); panel.dispose();
});

test('open fire panel already refreshes its labels and pending status through its locale subscription', () => {
  setLocale('es');
  const sent = [], client = { joined: true, youServer: 7, profile: profile(), fire: { enabled: true, slots: [] }, send: command => sent.push(command) };
  const panel = new FirePanel({ parent: element(), client: () => client, locale: getLocale });
  assert.equal(panel.open(), true);
  panel.pending = { command: Object.freeze({ opId: 'fire-pending' }) }; panel.setStatus('waiting'); panel.render();
  const pending = panel.pending;
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    assert.equal(panel.$('.fire-title').textContent, locale === 'en' ? 'Hand torch' : 'Antorcha de mano');
    assert.equal(panel.$('.fire-status').textContent, panel.copy().waiting);
    assert.equal(panel.closeButton.getAttribute('aria-label'), panel.copy().close);
    assert.equal(panel.active, true); assert.equal(panel.pending, pending);
  }
  assert.equal(sent.length, 0); panel.dispose();
});

test('visible swimming status refreshes all copy and meter accessibility without another state update', () => {
  setLocale('es');
  const status = new SwimStatus(element());
  const state = { swim: 1, swimStamina: 4, swimLoad: .5, elem: 1 }, before = structuredClone(state);
  status.update(state);
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    for (const [selector, key] of [['title', 'swim.title'], ['warning', 'swim.low'], ['brasa', 'swim.brasa'], ['load', 'swim.load'], ['advice', 'swim.advice']]) {
      assert.equal(status.root.querySelector(`[data-${selector}]`).textContent, t(key));
    }
    assert.equal(status.root.querySelector('[data-title]').textContent, locale === 'en' ? 'Swim stamina' : 'Resistencia al nadar');
    assert.equal(status.root.querySelector('[data-meter]').getAttribute('aria-valuetext'), t('swim.ariaValue', { seconds: 4 }));
    assert.equal(status.root.hidden, false);
  }
  assert.deepEqual(state, before); status.dispose();
  const title = status.root.querySelector('[data-title]').textContent;
  setLocale('en'); assert.equal(status.root.querySelector('[data-title]').textContent, title, 'disposed status unsubscribes');
});

for (const tab of ['gear', 'logging']) test(`open ${tab === 'gear' ? 'pack inventory' : 'logging skill'} refreshes via its existing character-panel owner`, () => {
  setLocale('es');
  const p = profile(), before = structuredClone(p), sent = [], root = element();
  const panel = new CharPanel(root, { profile: () => p, locale: getLocale, send: command => sent.push(command),
    stats: () => ({ atk: 10, def: 5, maxHp: 100, gold: 0, potions: 0 }) });
  panel.renderDetail = () => {}; panel.mark = () => {};
  panel.open(tab);
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    assert.match(plain(root.innerHTML), tab === 'gear'
      ? locale === 'en' ? /Materials pack.*Basic plank/ : /Mochila de materiales.*Tabla básica/
      : locale === 'en' ? /Logging.*Practice.*Work pace/ : /Tala.*Práctica.*Ritmo de trabajo/);
    assert.equal(panel.isOpen, true); assert.equal(panel.tab, tab); assert.equal(root.hidden, false);
  }
  assert.equal(sent.length, 0); assert.deepEqual(p, before);
  panel.unsubscribeLocale(); panel.close();
});

test('main water button uses live text and aria bindings', async () => {
  setLocale('es');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('  const freshwaterTouchButton ='), source.indexOf('  const pause ='));
  const cluster = element();
  const button = vm.runInNewContext(`${block}\nfreshwaterTouchButton`, { document: doc, isTouch: true,
    touch: { root: { querySelector: () => cluster } }, setText, setAttributeText });
  for (const locale of ['es', 'en', 'es']) {
    setLocale(locale);
    assert.equal(button.textContent, locale === 'en' ? 'Water' : 'Agua');
    assert.equal(button.getAttribute('aria-label'), locale === 'en' ? 'Fresh water' : 'Agua dulce');
  }
});

test('main artisan trigger binds only when its key changes and refreshes live in both modes', async () => {
  setLocale('es');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf("      safe('community',"), source.indexOf("      safe('render',"));
  assert.match(block, /artisanTrigger/);
  const artisanTrigger = element(), client = { resources: { timing: false } };
  const context = vm.createContext({ artisanTrigger, client, setText, safe: (_, update) => update(),
    community: { update() {}, active: false }, communityTrigger: element(), artisan: { update() {} },
    st: { online: true, mode: 'playing' }, workbench: { context: () => ({}) } });
  const update = () => vm.runInContext(block, context);
  for (const timing of [false, true, false]) {
    client.resources.timing = timing; update();
    assert.equal(artisanTrigger.dataset.l10nKey, timing ? 'systems.workshop.trigger' : 'systems.artisan.trigger');
    for (const locale of ['es', 'en', 'es']) {
      setLocale(locale);
      assert.equal(artisanTrigger.textContent, timing
        ? locale === 'en' ? 'Workshop and backpack' : 'Taller y mochila'
        : locale === 'en' ? 'Visit artisan' : 'Visitar artesano');
      const before = artisanTrigger.writes;
      update(); update();
      assert.equal(artisanTrigger.writes, before);
    }
  }
});

test('inline boot errors and canvas accessibility switch using the buttons before modules load', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const bootDoc = documentStub(), nodes = Object.fromEntries(['game', 'fade', 'bootstrap-locale'].map(id => [id, bootDoc.createElement('div')]));
  const buttons = ['es', 'en'].map(locale => { const button = bootDoc.createElement('button'); button.dataset.locale = locale; return button; });
  const scripts = [], description = {};
  bootDoc.getElementById = id => nodes[id]; bootDoc.querySelector = () => description;
  bootDoc.querySelectorAll = () => buttons; bootDoc.dispatchEvent = () => {};
  bootDoc.head = { appendChild(node) { if (node.rel === 'preload') node.onload(); } };
  bootDoc.body.appendChild = node => scripts.push(node);
  const window = {};
  vm.runInNewContext(script, { window, document: bootDoc, navigator: { languages: ['es'] },
    localStorage: { getItem() {}, setItem() {} }, setTimeout, clearTimeout, CustomEvent: class {} });
  await new Promise(resolve => setImmediate(resolve));
  scripts[0].onerror();
  assert.match(nodes.fade.textContent, /^No se pudo cargar/);
  buttons[1].click(); assert.match(nodes.fade.textContent, /^Could not load/);
  assert.equal(nodes.game.getAttribute('aria-label'), 'Game view');
  buttons[0].click(); assert.match(nodes.fade.textContent, /^No se pudo cargar/);
  assert.equal(nodes.game.getAttribute('aria-label'), 'Vista del juego');
  window.__mnFail('start'); buttons[1].click(); assert.match(nodes.fade.textContent, /^The game could not start/);
  buttons[0].click(); assert.match(nodes.fade.textContent, /^Algo falló al iniciar/);
});
