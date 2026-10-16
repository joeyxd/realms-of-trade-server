import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceConfigUI } from '../src/ui/inferenceConfig.js';
import { formatInferenceUsd, parseInferenceUsd } from '../src/net/inferenceConfig.js';

const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const catalog = [{ id: 'local-1', label: 'Local', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['small-v1', 'large-v1'] }];
const blankHead = { revision: 0, config: null, savedAt: null };
const config = { v: 1, ceilingNanoUsd: 500000000, connections: [{ id: 'local-1', ceilingNanoUsd: 300000000 }],
  companions: [{ character: CHARACTER, connectionId: 'local-1', modelId: 'small-v1' }] };

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.type = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  querySelectorAll(selector) {
    if (selector !== '[data-focus-key]') return [];
    const all = []; const walk = root => { for (const child of root.children) { if (child.dataset?.focusKey) all.push(child); walk(child); } };
    walk(this); return all;
  }
  focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
}

class FakeClient {
  constructor() { this.state = { status: 'offline', head: null, catalog: [], characters: [], durable: false, message: '' }; this.listeners = new Set(); this.loads = 0; this.saves = []; }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(state) { this.state = { ...this.state, ...structuredClone(state) }; for (const fn of this.listeners) fn(this.snapshot()); }
  load() { this.loads++; this.publish({ status: 'loading', message: '' }); return true; }
  save(value) { this.saves.push(structuredClone(value)); this.publish({ status: 'saving', message: '' }); return true; }
}

function setup({ lang = 'es', onClose = () => {} } = {}) {
  const previous = globalThis.document;
  globalThis.document = { head: new MockElement('head'), activeElement: null, getElementById: () => null, createElement: tag => new MockElement(tag) };
  const parent = new MockElement('section'), client = new FakeClient(), ui = new InferenceConfigUI(parent, { client, lang, onClose });
  return { ui, client, restore: () => { globalThis.document = previous; } };
}
const findFocus = (ui, key) => ui.container.querySelectorAll('[data-focus-key]').find(item => item.dataset.focusKey === key);
const fire = (element, event) => element.listeners[event]?.forEach(fn => fn({ target: element, key: 'Escape', stopPropagation() {} }));
const ready = (client, { catalogRows = catalog, characters = [CHARACTER], head = blankHead, durable = true } = {}) =>
  client.publish({ status: 'ready', head, catalog: catalogRows, characters, durable, message: '' });

test('an owner without connections sees availability instead of an amount-only setup form', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); assert.equal(client.loads, 1); assert.equal(ui.accountCeiling.value, '');
    ready(client, { catalogRows: [] });
    assert.equal(ui.draft.ceilingUsd, ''); assert.equal(ui.saveButton.disabled, true);
    assert.equal(ui.availability.hidden, false); assert.equal(ui.accountLabel.hidden, true);
    assert.equal(ui.accountCeiling.disabled, true); assert.equal(ui.saveButton.hidden, true);
    assert.equal(ui.connectionList.hidden, true); assert.equal(ui.characterList.hidden, true);
    assert.equal(ui.backButton.disabled, false); assert.equal(ui.reloadButton.disabled, false);
    assert.match(ui.availabilityHelp.textContent, /añadir una URL ni crear un compañero/);
    assert.equal(ui.availabilityPreserved.hidden, true);
    assert.match(ui.connectionList.textContent, /No eligible connections|No hay conexiones admitidas/);
    assert.match(ui.preparedNote.textContent, /inference is not available|inferencia aún no está disponible/);
    assert.match(ui.status.textContent, /not been saved|no hay configuración guardada/);
    assert.equal(ui.save(), false); assert.equal(client.saves.length, 0);
    ui.setLanguage('en'); assert.match(ui.availabilityHelp.textContent, /return to the game without entering a spending limit/);
    assert.equal(ui.reload(), true); assert.equal(client.loads, 2);
  } finally { restore(); }
});

test('catalog withdrawal preserves saved selections and unsaved edits as read-only until availability returns', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client, { head: { revision: 1, config, savedAt: '2026-10-10T12:00:00.000Z' } });
    ui.accountCeiling.value = '0.6'; fire(ui.accountCeiling, 'input'); ui.accountCeiling.focus();
    const draft = structuredClone(ui.draft);
    ready(client, { catalogRows: [], head: { revision: 1, config, savedAt: '2026-10-10T12:00:00.000Z' } });
    assert.equal(ui.availability.hidden, false); assert.equal(ui.availabilityPreserved.hidden, false);
    assert.equal(ui.accountLabel.hidden, false); assert.equal(ui.accountCeiling.value, '0.6');
    assert.equal(ui.accountCeiling.disabled, true); assert.equal(ui.saveButton.disabled, true);
    assert.match(ui.characterList.textContent, /small-v1/);
    assert.ok(ui.container.querySelectorAll('[data-focus-key]').every(el => el.disabled));
    assert.equal(globalThis.document.activeElement, ui.backButton);
    ui.accountCeiling.value = '99'; fire(ui.accountCeiling, 'input');
    ui.removeConnection('local-1'); ui.setAssignment(CHARACTER, ''); ui.setModel(CHARACTER, 'large-v1');
    assert.deepEqual(ui.draft, draft); assert.equal(ui.save(), false); assert.equal(client.saves.length, 0);
    ready(client, { head: { revision: 1, config, savedAt: '2026-10-10T12:00:00.000Z' } });
    assert.equal(ui.availability.hidden, true); assert.equal(ui.accountCeiling.disabled, false);
    assert.equal(ui.accountCeiling.value, '0.6'); assert.deepEqual(ui.draft, draft);
  } finally { restore(); }
});

test('even an account-only saved config remains inspectable without a catalog', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client, { catalogRows: [], characters: [], head: { revision: 1,
      config: { v: 1, ceilingNanoUsd: 0, connections: [], companions: [] }, savedAt: '2026-10-10T12:00:00.000Z' } });
    assert.equal(ui.accountLabel.hidden, false); assert.equal(ui.accountCeiling.value, '0');
    assert.equal(ui.accountCeiling.disabled, true); assert.equal(ui.availabilityPreserved.hidden, false);
    assert.equal(ui.save(), false);
  } finally { restore(); }
});

test('explicit shared USD ceilings and admitted per-character model serialize once as a whole config', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client);
    ui.accountCeiling.value = '0.5'; fire(ui.accountCeiling, 'input');
    const connection = findFocus(ui, `connection:${CHARACTER}`); connection.value = 'local-1'; fire(connection, 'change');
    const model = findFocus(ui, `model:${CHARACTER}`); model.value = 'small-v1'; fire(model, 'change');
    const connectionBudget = findFocus(ui, 'connection-ceiling:local-1'); connectionBudget.value = '0.3'; fire(connectionBudget, 'input');
    assert.match(ui.connectionList.textContent, /Maximum eligible configuration ceiling|Máximo admitido de configuración/);
    assert.equal(ui.save(), true);
    assert.deepEqual(client.saves, [config]);
    assert.match(ui.preparedNote.textContent, /Saving does not connect or generate|Guardar no inicia una conexión/);
    assert.equal(ui.durableNote.textContent, 'Esta configuración se guarda de forma privada y durable.');
  } finally { restore(); }
});

test('no model is silently chosen and malformed or over-ceiling amounts cannot be submitted', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client);
    ui.accountCeiling.value = '2.5'; fire(ui.accountCeiling, 'input');
    const connection = findFocus(ui, `connection:${CHARACTER}`); connection.value = 'local-1'; fire(connection, 'change');
    const budget = findFocus(ui, 'connection-ceiling:local-1'); budget.value = '1.1'; fire(budget, 'input');
    assert.equal(ui.save(), false); assert.equal(client.saves.length, 0);
    assert.match(ui.status.textContent, /exceeds the eligible maximum|supera el máximo admitido/);
    budget.value = '0.3'; fire(budget, 'input');
    assert.equal(ui.save(), false); assert.equal(client.saves.length, 0);
    assert.match(ui.status.textContent, /Choose a model|Elige un modelo/);
  } finally { restore(); }
});

test('conflict preserves the draft and only explicit reload adopts server configuration', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client);
    ui.accountCeiling.value = '0.5'; fire(ui.accountCeiling, 'input');
    client.publish({ status: 'conflict', head: { revision: 1, config, savedAt: '2026-10-10T12:00:00.000Z' }, catalog, characters: [CHARACTER], durable: true, message: 'conflict' });
    assert.equal(ui.accountCeiling.value, '0.5'); assert.match(ui.status.textContent, /Another session|Otra sesión/);
    const loadsBeforeReopen = client.loads; ui.close(); ui.open();
    assert.equal(client.loads, loadsBeforeReopen, 'reopening a conflict must not silently reload/adopt the remote head');
    assert.equal(ui.accountCeiling.value, '0.5'); assert.match(ui.status.textContent, /Another session|Otra sesión/);
    ui.reloadButton.listeners.click[0]();
    ready(client, { head: { revision: 1, config, savedAt: '2026-10-10T12:00:00.000Z' } });
    assert.equal(ui.accountCeiling.value, '0.5'); assert.equal(ui.draft.companions[0].modelId, 'small-v1');
  } finally { restore(); }
});

test('uncertain save keeps the draft; logout destroys it and closes the subview', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client); ui.accountCeiling.value = '0.5'; fire(ui.accountCeiling, 'input');
    client.publish({ status: 'uncertain', head: blankHead, catalog, characters: [CHARACTER], durable: true, message: 'timeout' });
    assert.equal(ui.accountCeiling.value, '0.5'); assert.match(ui.status.textContent, /before saving again|antes de volver a guardar/);
    const loadsBeforeReopen = client.loads; ui.close(); ui.open();
    assert.equal(client.loads, loadsBeforeReopen, 'reopening an uncertain save must not issue a retry or read implicitly');
    assert.equal(ui.accountCeiling.value, '0.5'); assert.match(ui.status.textContent, /before saving again|antes de volver a guardar/);
    client.publish({ status: 'signed_out', head: null, catalog: [], characters: [], durable: false, message: '' });
    assert.equal(ui.isOpen, false); assert.equal(ui.draft, null); assert.equal(ui.accountCeiling.value, '');
  } finally { restore(); }
});

test('ES/EN labels, keyboard focus, Escape return, 44px touch targets and bounded one-scroll layout', () => {
  const closed = []; const { ui, client, restore } = setup({ onClose: () => closed.push(true) });
  try {
    ui.open(); ready(client); ui.accountCeiling.focus(); ui.setLanguage('en');
    assert.equal(ui.title.textContent, 'Inference Center'); assert.equal(ui.accountLabelText.textContent, 'Shared account ceiling (USD)');
    assert.equal(globalThis.document.activeElement.dataset.focusKey, 'account-ceiling');
    const css = globalThis.document.head.children[0].textContent;
    assert.match(css, /min-height:44px/); assert.match(css, /70cqh/); assert.match(css, /overflow:auto/);
    fire(ui.container, 'keydown'); assert.equal(ui.isOpen, false); assert.deepEqual(closed, [true]);
    ui.setLanguage('es'); assert.equal(ui.title.textContent, 'Centro de inferencia');
  } finally { restore(); }
});

test('loading and non-durable states never permit save', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); assert.equal(ui.saveButton.disabled, true);
    ready(client, { durable: false }); assert.equal(ui.saveButton.disabled, true);
    assert.match(ui.durableNote.textContent, /has not confirmed durable storage|aún no confirma almacenamiento durable/);
    assert.equal(ui.save(), false);
  } finally { restore(); }
});

test('USD helpers preserve nanodollar precision and reject blanks, exponents and negative values', () => {
  assert.equal(parseInferenceUsd(''), null);
  assert.equal(parseInferenceUsd('1e2'), null);
  assert.equal(parseInferenceUsd('-1'), null);
  assert.equal(parseInferenceUsd('0.000000001'), 1);
  assert.equal(parseInferenceUsd('1000'), 1000000000000);
  assert.equal(formatInferenceUsd(1000000000000), '1000');
  assert.equal(formatInferenceUsd(1200000003), '1.200000003');
  assert.equal(parseInferenceUsd(formatInferenceUsd(1200000003)), 1200000003);
});

test('serialization uses the same ASCII order as protocol validation for mixed reference ids', () => {
  const rows = [
    { id: 'A', label: 'Upper', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['m'] },
    { id: '_', label: 'Under', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['m'] },
    { id: 'a', label: 'Lower', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['m'] },
  ];
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client, { catalogRows: rows });
    ui.draft.ceilingUsd = '0.9';
    ui.draft.connections = [{ id: 'a', ceilingUsd: '0.1' }, { id: 'A', ceilingUsd: '0.1' }, { id: '_', ceilingUsd: '0.1' }];
    const result = ui.toConfig();
    assert.deepEqual(result.connections.map(row => row.id), ['A', '_', 'a']);
  } finally { restore(); }
});
