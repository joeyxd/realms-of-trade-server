import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ResourceActions } from '../src/ui/resourceActions.js';
import { LoggingTimingPanel } from '../src/ui/loggingTiming.js';
import { WorkbenchPanel, workbenchPreview } from '../src/ui/workbench.js';
import { createLanguagePicker, getLocale, initI18n, setLocale } from '../src/core/i18n.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { pearlHtml } = await import('../src/ui/pearlpanel.js');

const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = html => decode(html.replace(/<[^>]*>/g, ''));
const english = value => assert.doesNotMatch(value, /[áéíóúñ¿¡]/i);

// Small DOM surface for the production language picker, locale subscriptions and
// data-l10n bindings. Existing nodes survive each switch; no panel is reopened.
class Element {
  constructor(doc) {
    this.ownerDocument = doc; doc.nodes.push(this); this.dataset = {}; this.attrs = {}; this.children = [];
    this.selectors = new Map(); this.listeners = {}; this.hidden = false; this.style = { setProperty() {} };
    this.classList = { toggle() {}, add() {}, remove() {} }; this._text = ''; this._html = '';
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  set textContent(value) { this.children.forEach(child => child.remove()); this.children = []; this._text = String(value); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set innerHTML(value) {
    this.children.forEach(child => child.remove()); this.children = []; this._html = value; this._text = plain(value);
    for (const match of value.matchAll(/<span\s+([^>]*data-l10n-(?:key|html|source)="[^>]+)>([\s\S]*?)<\/span>/g)) {
      const child = new Element(this.ownerDocument);
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], decode(attr[2]));
      child._text = plain(match[2]); this.appendChild(child);
    }
  }
  get innerHTML() { return this._html; }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element(this.ownerDocument));
    return this.selectors.get(selector);
  }
  querySelectorAll() { return []; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  focus() {}
  click() { for (const listener of this.listeners.click || []) listener({ target: this }); }
  remove() { this.removed = true; this.children.forEach(child => child.remove()); }
}
const previous = { document: globalThis.document, observer: globalThis.MutationObserver,
  addEventListener: globalThis.addEventListener, locale: getLocale() };
const doc = { nodes: [], documentElement: { lang: 'es' }, activeElement: null,
  createElement() { return new Element(this); }, addEventListener() {}, querySelectorAll(selector) {
    return this.nodes.filter(node => !node.removed && (selector === '[data-locale]' ? node.dataset.locale
      : node.dataset.l10nKey || node.dataset.l10nHtml || node.hasAttribute('data-l10n-source') || node.hasAttribute('data-l10n-aria-label')));
  } };
doc.body = doc.createElement();
globalThis.document = doc; globalThis.MutationObserver = class { observe() {} }; globalThis.addEventListener = () => {};
initI18n();
after(() => { setLocale(previous.locale); globalThis.document = previous.document;
  globalThis.MutationObserver = previous.observer; globalThis.addEventListener = previous.addEventListener; });
const picker = createLanguagePicker();
const switchTo = locale => picker.children.find(button => button.dataset.locale === locale).click();
const mount = html => { const node = doc.createElement(); node.innerHTML = html; doc.body.appendChild(node); return node; };

function fixture(kind = 'palm') {
  let now = 1000;
  const sent = [], toasts = [], node = { id: 'resource-1', kind, rev: 1, ready: true, hits: 0, x: 0, y: 2, z: 0 };
  const client = { joined: true, t: {}, naval: {}, deck: {}, profile: { tools: { axe: 1, pickaxe: 1 },
    eco: { tradeRev: 2, pack: { cap: 100, goods: { tronco: 2 } } } }, resources: { nodes: [node] }, send: command => sent.push(command) };
  const actions = new ResourceActions({ client: () => client, player: () => ({ x: 0, y: 2, z: 0 }), enabled: () => true,
    now: () => now, toast: html => toasts.push(html) });
  actions.update();
  return { actions, client, node, sent, toasts, advance(ms) { now += ms; } };
}

test('tool requirements, resource names, chopping, mining, cooldown and regrowth use ES and EN', () => {
  for (const locale of ['es', 'en']) {
    switchTo(locale);
    for (const [kind, name, tool, verb] of locale === 'en'
      ? [['palm', 'Palm tree', 'axe', 'Chop'], ['rock', 'Large rock', 'pickaxe', 'Mine'], ['iron_ore', 'Iron vein', 'pickaxe', 'Mine']]
      : [['palm', 'Palmera', 'hacha', 'Cortar'], ['rock', 'Roca grande', 'pico', 'Minar'], ['iron_ore', 'Veta de hierro', 'pico', 'Minar']]) {
      const f = fixture(kind); f.client.profile.tools = {};
      const action = f.actions.interaction();
      assert.equal(plain(action.html), locale === 'en' ? `${name} · tool required: ${tool} (bench)` : `${name} · necesitas ${tool} (banco)`);
      assert.equal(action.verb, verb); action.run();
      assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? `You need ${tool === 'axe' ? 'an axe' : 'a pickaxe'} to work this resource.` : `Necesitas un ${tool} para trabajar este recurso.`);
      f.client.profile.tools = { axe: 1, pickaxe: 1 };
      const ready = plain(f.actions.interaction().html);
      assert.match(ready, locale === 'en' ? /Chop palm tree|Mine rock|Mine ore/ : /Cortar palmera|Picar roca|Extraer mineral/);
      f.actions.gatherUntil = 1400;
      assert.match(f.actions.interaction().html, locale === 'en' ? /Chopping|Mining/ : /Hachazo|Picando/);
      f.node.ready = false; f.node.wait = 8;
      assert.match(f.actions.interaction().html, locale === 'en' ? /regrows in 8 s|depleted · returns in 8 s/ : /crece en 8 s|agotado · vuelve en 8 s/);
      if (locale === 'en') [action.html, action.verb, ...f.toasts.map(plain), ready, f.actions.interaction().html].forEach(english);
    }
  }
});

test('logging rhythm start, preparation, retry, strike and denials use the current locale', () => {
  for (const locale of ['es', 'en']) {
    switchTo(locale); const f = fixture(); f.client.resources.timing = true;
    const expected = locale === 'en' ? ['Start logging rhythm', 'Preparing the rhythm…', 'Retry rhythm', 'Strike to the rhythm']
      : ['Iniciar ritmo de tala', 'Preparando el ritmo…', 'Reintentar ritmo', 'Golpear al ritmo'];
    const check = index => { const action = f.actions.interaction(); assert.equal(plain(action.html).replace(/^F /, ''), expected[index]);
      assert.equal(action.verb, locale === 'en' ? 'Log' : 'Talar'); if (locale === 'en') english(plain(action.html)); };
    check(0); f.actions.interaction().run(); const command = structuredClone(f.sent[0]); check(1);
    f.advance(5001); check(2); f.actions.interaction().run(); assert.deepEqual(f.sent[1], command);
    f.actions.aimRequest = null; f.actions.aim = { node: f.node.id, rev: f.node.rev, receivedAt: 6001 }; check(3);
    for (const [why, es, en] of [['aimRequired', 'Solicita un nuevo ritmo de tala antes de golpear.', 'Request a new logging rhythm before striking.'],
      ['timing', 'No se pudo validar el ritmo de tala. Inténtalo otra vez.', 'Could not validate the logging rhythm. Try again.']]) {
      f.actions.craftPending = { command: { opId: why, op: 'craft' }, sentAt: 6001 };
      f.actions.onResult({ opId: why, op: 'craft', ok: false, why });
      assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? en : es); if (locale === 'en') english(plain(f.toasts.at(-1)));
    }
  }
});

test('material bench counts, prepare-wood prompts, pending requests and retries localize', () => {
  for (const locale of ['es', 'en']) {
    switchTo(locale); const f = fixture(); f.client.resources.nodes = []; f.client.resources.bench = { x: 0, y: 2, z: 0 };
    for (const count of [0, 1, 2]) {
      f.client.profile.eco.pack.goods.tronco = count; f.actions.openWorkbench = () => {};
      assert.equal(plain(f.actions.interaction().html), locale === 'en' ? `F Materials bench · ${count} ${count === 1 ? 'log' : 'logs'}` : `F Banco de materiales · ${count} ${count === 1 ? 'tronco' : 'troncos'}`);
      f.actions.openWorkbench = null;
      assert.equal(plain(f.actions.interaction().html), locale === 'en' ? `F Prepare wood · 1 log → 1 wood (${count} ${count === 1 ? 'log' : 'logs'})` : `F Preparar madera · 1 tronco → 1 madera (${count} ${count === 1 ? 'tronco' : 'troncos'})`);
    }
    f.actions.craftPending = { sentAt: 1000, command: { opId: 'craft', op: 'craft' } }; f.actions.openWorkbench = () => {};
    assert.equal(plain(f.actions.interaction().html), locale === 'en' ? 'F Materials bench · preparation pending' : 'F Banco de materiales · preparación pendiente');
    f.actions.openWorkbench = null;
    assert.equal(f.actions.interaction().html, locale === 'en' ? 'Waiting for confirmation…' : 'Esperando confirmación…');
    f.advance(5001);
    assert.equal(plain(f.actions.interaction().html), locale === 'en' ? 'F Retry the request' : 'F Reintentar la solicitud');
    if (locale === 'en') english(plain(f.actions.interaction().html));
  }
});

test('the per-frame resource prompt updates the same HUD element across language switches', () => {
  switchTo('es'); const f = fixture(); f.client.resources.timing = true;
  f.actions.interaction().run(); const pending = f.actions.aimRequest, command = structuredClone(f.sent[0]);
  const slot = mount(f.actions.interaction().html);
  for (const locale of ['en', 'es', 'en']) {
    switchTo(locale);
    // main.js calls interaction() and writes its HTML to the existing HUD each frame.
    slot.innerHTML = f.actions.interaction().html;
    assert.equal(slot.textContent, locale === 'en' ? 'Preparing the rhythm…' : 'Preparando el ritmo…');
    assert.equal(f.actions.aimRequest, pending); assert.deepEqual(f.sent, [command]);
    if (locale === 'en') english(slot.textContent);
  }
});

test('rhythm refusal, expiry and acknowledged logging loot notices use both locales', () => {
  for (const locale of ['es', 'en']) {
    switchTo(locale); const f = fixture(); f.client.resources.timing = true;
    for (const [why, es, en] of [
      ['busy', 'No se pudo iniciar el ritmo. Espera un momento e inténtalo de nuevo.', 'Could not start the timing challenge. Wait a moment and try again.'],
      ['revision', 'La palmera cambió. Acércate e inicia otro ritmo.', 'The palm changed. Move closer and start a new challenge.'],
      ['tool', 'Necesitas un hacha para talar.', 'You need an axe to log.'],
      ['cooldown', 'Espera a que termine tu acción antes de iniciar otro ritmo.', 'Wait for your action to finish before starting another challenge.'],
    ]) {
      f.actions.interaction().run();
      assert.equal(f.actions.onAim({ type: 'loggingAim', node: f.node.id, rev: f.node.rev, ok: false, why }), true);
      assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? en : es);
      if (locale === 'en') english(plain(f.toasts.at(-1)));
    }
    f.actions.aim = { node: f.node.id, rev: 1, receivedAt: 1000 }; f.advance(1600); f.actions.update();
    assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? 'The timing window expired. Start a new attempt.' : 'Terminó la ventana. Inicia otro intento.');
    for (const quality of [0, 1]) {
      f.actions.gathers.set('loot', { command: { op: 'gather', opId: 'loot', node: f.node.id, expectedRev: 1 }, timing: true, sentAt: 2600 });
      f.actions.onResult({ op: 'gather', opId: 'loot', ok: true, rev: 2, profileRev: 3, count: 3, good: 'tronco', timing: { quality }, loot: { resina: 1, coco: 2 } });
      assert.equal(plain(f.toasts.at(-2)), locale === 'en' ? `+3 logs · ${quality ? 'perfect hit' : 'logging complete'}` : `+3 troncos · ${quality ? 'golpe perfecto' : 'tala completada'}`);
      assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? '+1 resin · +2 coconuts' : '+1 resina · +2 cocos');
      if (locale === 'en') f.toasts.slice(-2).map(plain).forEach(english);
    }
  }
});

test('crafted tools, wood and gained material notices translate and preserve singular/plural counts', () => {
  for (const locale of ['es', 'en']) {
    switchTo(locale); const f = fixture();
    const cases = [
      [{ op: 'craft', tool: 'axe' }, 'Hacha de piedra fabricado · equipado en tu cinturón de utilidad.', 'Stone axe crafted · equipped on your utility belt.'],
      [{ op: 'craft', tool: 'pickaxe' }, 'Pico de piedra fabricado · equipado en tu cinturón de utilidad.', 'Stone pickaxe crafted · equipped on your utility belt.'],
      [{ op: 'craft', count: 3 }, '+3 madera preparada · úsala en B / Construir.', '+3 prepared wood · use it with B / Build.'],
      [{ op: 'gather', good: 'piedra', count: 1 }, '+1 piedra · Material para fabricar herramientas.', '+1 stone · Material for crafting tools.'],
      [{ op: 'gather', good: 'piedra', count: 2 }, '+2 piedras · Material para fabricar herramientas.', '+2 stone · Material for crafting tools.'],
      [{ op: 'gather', good: 'mineral_hierro', count: 1 }, '+1 mineral de hierro · Mineral bruto; requiere fundición.', '+1 iron ore · Raw ore; requires smelting.'],
      [{ op: 'gather', good: 'mineral_hierro', count: 2 }, '+2 minerales de hierro · Mineral bruto; requiere fundición.', '+2 iron ore · Raw ore; requires smelting.'],
      [{ op: 'gather', good: 'tronco', count: 2 }, '+2 troncos · Llévalo al banco del puerto para preparar madera.', '+2 logs · Take it to the harbor bench to prepare wood.'],
    ];
    for (const [event, es, en] of cases) {
      f.actions.craftPending = { command: { opId: 'notice', op: event.op }, sentAt: 1000 };
      f.actions.onResult({ ...event, opId: 'notice', ok: true });
      assert.equal(plain(f.toasts.at(-1)), locale === 'en' ? en : es); if (locale === 'en') english(plain(f.toasts.at(-1)));
    }
  }
});

test('language buttons update mounted notices, open timing/workbench panels and pearl fallback without reopening or sending', () => {
  switchTo('es'); const f = fixture(); f.client.profile.tools = {}; f.actions.interaction().run();
  const requirement = mount(f.toasts.at(-1));
  f.actions.craftPending = { command: { op: 'craft', opId: 'tool' }, sentAt: 1000 };
  f.actions.onResult({ op: 'craft', opId: 'tool', ok: true, tool: 'axe' }); const tool = mount(f.toasts.at(-1));
  f.actions.craftPending = { command: { op: 'craft', opId: 'wood' }, sentAt: 1000 };
  f.actions.onResult({ op: 'craft', opId: 'wood', ok: true, count: 2 }); const wood = mount(f.toasts.at(-1));
  const pearl = mount(pearlHtml({ pearls: { bag: [{ uid: 'unknown-uid', kind: 'unknown-kind' }] } }));
  const timing = new LoggingTimingPanel({ doc, now: () => 1000 }); timing.ensure();
  assert.equal(timing.root.querySelector('.logging-timing__track').getAttribute('aria-label'), 'Ventana de golpe');
  timing.show({ startTick: 0, targetTick: 45, endTick: 90, width: 5 });
  const profile = { tools: {}, eco: { tradeRev: 2, pack: { cap: 100, goods: { tronco: 4, resina: 1 } } } };
  const bench = new WorkbenchPanel({ parent: doc.body, profile: () => profile, player: () => ({ x: 0, y: 2, z: 0 }),
    enabled: () => true, bench: () => ({ x: 0, y: 2, z: 0 }), submit: command => f.sent.push(command) });
  assert.equal(bench.open({ recipe: 'antorcha' }), true);
  const pending = { command: Object.freeze({ op: 'craft', opId: 'pending' }), recipe: 'antorcha', sentAt: performance.now() };
  bench.pending = pending; bench.update(); const challenge = timing.challenge;
  for (const locale of ['en', 'es', 'en']) {
    switchTo(locale);
    assert.match(requirement.textContent, locale === 'en' ? /You need an axe/ : /Necesitas un hacha/);
    assert.match(tool.textContent, locale === 'en' ? /Stone axe crafted/ : /Hacha de piedra fabricado/);
    assert.match(wood.textContent, locale === 'en' ? /prepared wood/ : /madera preparada/);
    assert.match(pearl.textContent, locale === 'en' ? /Black pearl/ : /Perla negra/);
    assert.equal(timing.root.querySelector('[data-title]').textContent, locale === 'en' ? 'Logging rhythm' : 'Ritmo de tala');
    assert.equal(timing.root.querySelector('.logging-timing__track').getAttribute('aria-label'), locale === 'en' ? 'Strike timing window' : 'Ventana de golpe');
    assert.equal(timing.root.querySelector('[data-hit]').getAttribute('aria-label'), locale === 'en' ? 'Strike now' : 'Golpear ahora');
    assert.equal(bench.$('[data-output-name]').textContent, locale === 'en' ? 'Torch' : 'Antorcha');
    assert.equal(workbenchPreview(profile, 1, 'antorcha').outputName, locale === 'en' ? 'Torch' : 'Antorcha');
    assert.equal(bench.pending, pending); assert.equal(timing.challenge, challenge); assert.equal(timing.root.hidden, false);
    assert.equal(f.sent.length, 0);
    if (locale === 'en') [requirement, tool, wood, pearl, timing.root.querySelector('[data-title]')].forEach(node => english(node.textContent));
  }
  bench.unsubscribeLocale(); timing.destroy();
});
