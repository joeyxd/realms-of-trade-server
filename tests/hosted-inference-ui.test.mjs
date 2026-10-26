import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HostedInferenceUI, COPY } from '../src/ui/hostedInference.js';

class Element {
  constructor(tag) { Object.assign(this, { tagName: tag, children: [], dataset: {}, listeners: {}, value: '', checked: false }); }
  set textContent(text) { this.text = String(text); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(el => el.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  querySelectorAll() { return this.children.flatMap(el => [el, ...el.querySelectorAll()]); }
  reportValidity() { return true; }
  focus() {}
}
const endpoint = { id: 'e1', label: '<img onerror=alert(1)>', baseUrl: 'https://api.example.com/v1', keyHint: 'abcd', defaultModel: 'small', models: ['large'],
  catalogUpdatedAt: '2026-10-22', catalogError: 'http_status', usage: { requests: 3, promptTokens: 12, completionTokens: 7 } };
const ready = { status: 'ready', available: true, reason: null, endpoints: [endpoint], companions: [
  { character: 'c1', name: 'Brisa', status: 'running', endpointId: 'e1', modelId: 'small', error: null },
  { character: 'c2', name: null, status: 'failed', endpointId: null, modelId: null, error: 'presence_body_required' },
], limits: { maxEndpoints: 8, maxRunning: 2 }, pendingOps: [], message: '' };
function setup() {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Element(tag) };
  let listener; const calls = [], client = { snapshot: () => structuredClone(ready), subscribe(fn) { listener = fn; fn(this.snapshot()); return () => {}; } };
  for (const op of ['load', 'save', 'remove', 'probe', 'test', 'start', 'stop']) client[op] = (...args) => { calls.push([op, ...args]); return true; };
  const ui = new HostedInferenceUI(new Element('section'), { client }); ui.open();
  return { ui, calls, publish: state => listener(structuredClone({ ...ready, ...state })), restore: () => { ui.destroy(); globalThis.document = prior; } };
}
const find = (root, key) => root.querySelectorAll().find(el => el.dataset.action === key);
const click = el => el.listeners.click?.({});

test('availability, connections, companions and test results render only plain text, in both languages', () => {
  const f = setup();
  try {
    for (const reason of ['disabled', 'not_allowed', 'misconfigured']) {
      f.publish({ available: false, reason, endpoints: [], companions: [] });
      assert.match(f.ui.body.textContent, /Conectar en mi PC/); assert.ok(f.ui.body.textContent.includes(COPY.es[reason]));
    }
    f.publish({ test: { text: '<script>bad()</script>', usage: { inputTokens: 4, outputTokens: 2 }, latencyMs: 90, servedModel: 'different', modelMismatch: true } });
    assert.match(f.ui.body.textContent, /api.example.com/); assert.match(f.ui.body.textContent, /•••• abcd/);
    assert.match(f.ui.body.textContent, /3 solicitudes/); assert.match(f.ui.body.textContent, /<script>bad/);
    assert.match(f.ui.body.textContent, /distinto del solicitado/); assert.match(f.ui.body.textContent, /invoca su cuerpo/);
    f.ui.setLanguage('en'); assert.match(f.ui.body.textContent, /Running/); assert.match(f.ui.body.textContent, /Companion 2/);
    assert.equal(f.ui.status.role, 'status'); assert.equal(f.ui.status['aria-live'], 'polite');
    assert.doesNotMatch(readFileSync(new URL('../src/ui/hostedInference.js', import.meta.url), 'utf8'), /innerHTML/);
  } finally { f.restore(); }
});

test('edit key stays empty, blank preserves, explicit clearing sends empty; save clears immediately', () => {
  const f = setup();
  try {
    f.ui.edit(endpoint); assert.equal(f.ui.keyInput.value, ''); assert.equal(f.ui.keyInput.type, 'password'); assert.equal(f.ui.keyInput.autocomplete, 'new-password');
    f.ui.save(); assert.equal(Object.hasOwn(f.calls.at(-1)[1], 'apiKey'), false);
    f.ui.edit(endpoint); const input = f.ui.keyInput; input.value = 'secret-key';
    const send = f.ui.client.save; f.ui.client.save = value => { assert.equal(input.value, '', 'clear before the synchronous send'); return send(value); }; f.ui.save();
    assert.equal(input.value, ''); assert.equal(f.calls.at(-1)[1].apiKey, 'secret-key');
    f.ui.edit(endpoint); f.ui.clearKey.checked = true; f.ui.save(); assert.equal(f.calls.at(-1)[1].apiKey, '');
    f.ui.edit(); assert.equal(f.ui.formEndpoint, null); f.ui.keyInput.value = 'discard'; click(find(f.ui.form, 'cancel')); assert.equal(f.ui.keyInput.value, '');
  } finally { f.restore(); }
});

test('the owner sets the calls per 2-hour window before starting; invalid values revert and running rows lock it', () => {
  const f = setup();
  try {
    const inputs = () => f.ui.body.querySelectorAll().filter(el => el.tagName === 'input' && el.type === 'number');
    assert.equal(inputs().length, 2); assert.equal(inputs()[1].value, '20'); assert.equal(inputs()[1].max, '60');
    assert.equal(inputs()[0].disabled, true); assert.equal(inputs()[1].disabled, false);
    const calls = inputs()[1]; calls.value = '61'; calls.listeners.change(); assert.equal(calls.value, '20');
    calls.value = '0'; calls.listeners.change(); assert.equal(calls.value, '20');
    calls.value = '35'; calls.listeners.change(); click(find(f.ui.body, 'start'));
    assert.deepEqual(f.calls.at(-1), ['start', 'c2', 'e1', 'small', 35]);
  } finally { f.restore(); }
});

test('delete requires two clicks; test, start and stop use the selected identifiers', () => {
  const f = setup();
  try {
    click(find(f.ui.body, 'remove')); assert.equal(f.calls.filter(row => row[0] === 'remove').length, 0);
    click(find(f.ui.body, 'confirm')); assert.deepEqual(f.calls.at(-1), ['remove', 'e1']);
    click(find(f.ui.body, 'probe')); assert.deepEqual(f.calls.at(-1), ['probe', 'e1']);
    const prompt = f.ui.body.querySelectorAll().find(el => el.tagName === 'textarea'); prompt.value = 'hello'; prompt.listeners.input();
    click(find(f.ui.body, 'test')); assert.deepEqual(f.calls.at(-1), ['test', 'e1', 'small', 'hello']);
    click(find(f.ui.body, 'start')); assert.deepEqual(f.calls.at(-1), ['start', 'c2', 'e1', 'small', 20]);
    click(find(f.ui.body, 'stop')); assert.deepEqual(f.calls.at(-1), ['stop', 'c1']);
    f.publish({ pendingOps: ['probe', 'start', 'stop', 'delete', 'test', 'save'] });
    for (const key of ['probe', 'start', 'stop', 'remove', 'test', 'edit', 'add']) assert.equal(find(f.ui.body, key).disabled, true);
    f.publish({ status: 'uncertain', message: 'uncertain' }); assert.match(f.ui.status.textContent, /Recarga/);
    let closed = 0; f.ui.onClose = () => closed++; f.ui.container.listeners.keydown({ key: 'Escape', stopPropagation() {} });
    assert.equal(f.ui.isOpen, false); assert.equal(closed, 1); f.ui.open(); click(f.ui.backButton); assert.equal(closed, 2);
  } finally { f.restore(); }
});

test('every wire why code has Spanish and English copy', () => {
  const brief = readFileSync(new URL('../docs/briefs/ic08-hosted-inference.md', import.meta.url), 'utf8');
  const codes = [...brief.match(/- `why`[\s\S]*?\n- Rates/)[0].matchAll(/`([a-z_]+)`/g)].map(match => match[1]).filter(code => code !== 'why');
  assert.ok(codes.length >= 26);
  for (const code of codes) for (const lang of ['es', 'en']) assert.equal(typeof COPY[lang][code], 'string', `${lang}:${code}`);
});

test('the game opens the hosted editor and wires its authenticated lifecycle', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /new HostedInferenceClient\(\{ transport, auth: accountAuth/);
  assert.match(source, /new HostedInferenceUI\(companionsPanel.panel, \{ client: hostedInference/);
  assert.match(source, /setInferenceEditor\(hostedInferenceEditor\)/);
  assert.match(source, /hostedInference\.setSession\(joiningCompanionAccount\)/);
  assert.match(source, /hostedInference\.disconnect\(\)/);
  assert.doesNotMatch(source, /new InferenceConfigUI/);
});


test('companion session usage, memory and blocked automation render in Spanish and English', () => {
  const f = setup(), now = Date.now();
  try {
    f.publish({ companions: [{ ...ready.companions[0],
      usage: { calls: 7, maxCalls: 8, inputTokens: 700, outputTokens: 140, summaries: 1, expiresAtMs: now + 61000 },
      memory: { episodes: 6, summaries: 1, bytes: 2049, maxBytes: 1048576 }, autoSummary: 'blocked' }] });
    assert.ok(f.ui.body.textContent.includes('Esta sesión: 7/8 llamadas · 700 tokens de entrada · 140 de salida · 1 resúmenes · se renueva en 2 min'));
    assert.ok(f.ui.body.textContent.includes('Memoria: 6 recuerdos · 1 resúmenes · 3 KB de 1024 KB'));
    assert.ok(f.ui.body.textContent.includes('El resumen automático se detuvo en esta sesión.'));
    f.ui.setLanguage('en');
    assert.ok(f.ui.body.textContent.includes('This session: 7/8 calls · 700 input tokens · 140 output · 1 summaries · renews in 2 min'));
    assert.ok(f.ui.body.textContent.includes('Memory: 6 memories · 1 summaries · 3 KB of 1024 KB'));
    assert.ok(f.ui.body.textContent.includes('Automatic summary stopped for this session.'));
    const notes = f.ui.body.querySelectorAll().filter(el => el.className === 'mn-hosted-note');
    assert.ok(notes.some(el => el.textContent.startsWith('This session:')));
    f.publish({ companions: [{ ...ready.companions[0], usage: { calls: 0, maxCalls: 8, inputTokens: 0,
      outputTokens: 0, summaries: 0, expiresAtMs: now - 1 }, autoSummary: 'ready' }] });
    assert.match(f.ui.body.textContent, /renews in 0 min/); assert.doesNotMatch(f.ui.body.textContent, /Memory:|Automatic summary stopped/);
    f.publish({ companions: [ready.companions[0]] }); assert.doesNotMatch(f.ui.body.textContent, /This session:|Memory:/);
  } finally { f.restore(); }
});
