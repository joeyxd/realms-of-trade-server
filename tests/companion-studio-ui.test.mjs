import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCreatePayload, centerModelChoices, centerUnavailable, completionReport, defaultSource, modelSummaryLine, resolveSource, inferenceUsageTiles, renderInference, checkedLimits, fixedWhy, isLocalEndpoint, keyFromFragment, normalizeChatInput, validateWizardDraft } from '../tools/agent/companion-studio/main.js';

const draft = { v: 1, name: 'Brisa', role: 'harvester', personality: 'warm', traits: ['curious', 'kind', 'prudent'],
  skin: 0, modelId: 'local-model', baseUrl: 'http://127.0.0.1:8080/v1', thinkingMode: 'server_default' };
const limits = { maxCalls: 8, maxTokens: 200000 };

test('wizard accepts a bounded local companion draft and finite limits', () => {
  assert.equal(validateWizardDraft(draft, limits), true);
  assert.deepEqual(checkedLimits('8', '32768'), { maxCalls: 8, maxTokens: 32768 });
  assert.equal(checkedLimits('1', '1000000').maxCalls, 1);
});

test('wizard rejects remote model endpoints, too many traits, and non-finite or excessive limits', () => {
  assert.equal(isLocalEndpoint('https://models.example/v1'), false);
  assert.equal(isLocalEndpoint('http://127.0.0.1:1234/v1'), true);
  assert.equal(validateWizardDraft({ ...draft, baseUrl: 'https://models.example/v1' }, limits), false);
  assert.equal(validateWizardDraft({ ...draft, traits: ['a', 'b', 'c', 'd'] }, limits), false);
  assert.equal(checkedLimits('Infinity', '20'), null);
  assert.equal(checkedLimits('9', '200000'), null);
  assert.equal(checkedLimits('2', '32767'), null);
  assert.equal(checkedLimits('2', '1000001'), null);
});

test('chat normalizes NFC, counts Unicode code points, and rejects control characters', () => {
  assert.equal(normalizeChatInput('  e\u0301  '), 'é');
  assert.equal([...normalizeChatInput('🌊'.repeat(280))].length, 280);
  assert.equal(normalizeChatInput('🌊'.repeat(281)), null);
  assert.equal(normalizeChatInput('hola\ncapitana'), null);
  assert.equal(normalizeChatInput('   '), null);
});

test('unknown and unresolved outcomes ask the owner to inspect state before deciding', () => {
  assert.match(fixedWhy('local_resource_outcome_unresolved'), /sin resolverse/);
  assert.match(fixedWhy('chat_outcome_unresolved'), /conversación/);
  assert.match(fixedWhy('inference_timeout'), /sin resolverse/);
  assert.match(fixedWhy('inference_busy'), /otra solicitud/);
  assert.match(fixedWhy('start_cancelled'), /Actualiza/);
  assert.match(fixedWhy('unexpected_code'), /Actualiza el estado/);
  assert.doesNotMatch(fixedWhy('unexpected_code'), /vuelve a intentarlo/i);
});

test('access key is accepted only from the fragment and the page has the required actionable steps', async () => {
  assert.equal(keyFromFragment(`#key=${'A'.repeat(64)}`), 'a'.repeat(64));
  assert.equal(keyFromFragment(`#key=${'a'.repeat(63)}z`), null);
  const html = await readFile(new URL('../tools/agent/companion-studio/index.html', import.meta.url), 'utf8');
  for (const selector of ['id="name"', 'id="role"', 'id="looks"', 'id="personality"', 'id="traits"',
    'id="baseUrl"', 'id="modelId"', 'id="thinkingMode"', 'id="maxCalls"', 'id="maxTokens"', 'id="review"',
    'id="start"', 'id="stop"', 'id="chat-form"', 'id="remember"', 'id="file-content"', 'id="export-file"']) {
    assert.ok(html.includes(selector), `missing UI control ${selector}`);
  }
  assert.match(html, /id="maxCalls"[^>]*min="1" max="8"[^>]*value="8"/);
  assert.match(html, /id="maxTokens"[^>]*min="32768" max="1000000"[^>]*value="200000"/);
  assert.match(html, /id="chat-input" maxlength="280"/);
  assert.doesNotMatch(html, /Puedes cambiar sus rasgos después/);
});


test('inference section exposes local form, cached models, results and no inline or external scripts', async () => {
  const html = await readFile(new URL('../tools/agent/companion-studio/index.html', import.meta.url), 'utf8');
  for (const id of ['inference-center', 'inference-title', 'inference-active', 'inference-endpoints', 'inference-form', 'inference-label', 'inference-url', 'inference-key', 'inference-default', 'inference-clear-key', 'inference-new', 'inference-result']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /Centro de inferencia/); assert.match(html, /id="inference-key" type="password"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)|https?:\/\/[^" ]+\.(js|css)/);
});

test('inference usage tiles show request counts, tokens, average latency and last error', () => {
  const tiles = Object.fromEntries(inferenceUsageTiles({ requests: 2, failures: 1, promptTokens: 12, completionTokens: 6, latencyMsTotal: 30, lastError: 'http_status' }));
  assert.equal(tiles.Peticiones, '2'); assert.equal(tiles['Tokens entrada'], '12'); assert.equal(tiles['Tokens salida'], '6'); assert.equal(tiles['Latencia media'], '15 ms'); assert.equal(tiles['Último error'], 'http_status');
  assert.match(completionReport({ ok: true, text: 'Hola', usage: { inputTokens: 2, outputTokens: 1 }, latencyMs: 5, status: 200, servedModel: 'm-2024-01-01', modelMismatch: false }), /Hola\nTokens entrada: 2 · salida: 1\nLatencia: 5 ms · HTTP: 200/);
  assert.match(completionReport({ ok: false, why: 'timeout', usage: null, latencyMs: 30000, status: null }), /timeout/);
});

test('inference renderer builds cached model controls, masked hints, actions and active badge safely', () => {
  class Element {
    constructor(tag = '') { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll() { return []; }
  }
  const ids = Object.fromEntries(['inference-endpoints', 'inference-active', 'inference-form', 'inference-form-title', 'inference-label', 'inference-url', 'inference-default', 'inference-key', 'inference-clear-key'].map(id => [id, new Element()]));
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => ids[id], createElement: tag => new Element(tag) };
  try {
    const endpoint = { id: 'a', label: '<img src=x>', baseUrl: 'https://example.invalid/v1', keyHint: '1234', defaultModel: 'default', models: ['cached'], catalogUpdatedAt: '2026-10-19T00:00:00Z', catalogError: null, usage: {} };
    renderInference({ endpoints: [endpoint], active: { endpointId: 'a', modelId: 'cached' } });
    const all = [];
    function walk(element) { all.push(element); element.children.forEach(walk); }
    walk(ids['inference-endpoints']);
    assert.equal(ids['inference-active'].textContent, '<img src=x> · cached');
    assert.ok(all.some(el => el.textContent === 'Clave ••••1234'));
    const select = all.find(el => el.tag === 'select'); assert.deepEqual(select.children.map(el => el.value), ['cached', 'default']); assert.equal(select.value, 'cached');
    const buttons = all.filter(el => el.tag === 'button');
    assert.deepEqual(buttons.map(el => el.textContent), ['Editar', 'Probar modelos', 'Probar completado', 'Seleccionar', 'Borrar']);
    buttons[0].listeners.click(); assert.equal(ids['inference-key'].value, ''); assert.equal(ids['inference-key'].placeholder, 'Guardada: ••••1234');
    assert.equal(ids['inference-label'].value, '<img src=x>'); assert.ok(all.every(el => el.tag !== 'img'));
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('inference renderer keeps typed prompt and chosen model per endpoint across refreshes', () => {
  class Element {
    constructor(tag = '') { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll() { return []; }
  }
  const ids = Object.fromEntries(['inference-endpoints', 'inference-active', 'inference-form'].map(id => [id, new Element()]));
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  const controls = () => {
    const all = descendants(ids['inference-endpoints']);
    return { models: all.filter(el => el.tag === 'select'), prompts: all.filter(el => el.tag === 'textarea') };
  };
  try {
    const endpoint = { id: 'persist-a', label: 'Local', baseUrl: 'http://127.0.0.1:8080/v1', defaultModel: 'default', models: ['cached', 'default'],
      catalogCheckedAt: '2026-10-19T00:01:00.000Z', catalogUpdatedAt: '2026-10-19T00:00:00.000Z', usage: {} };
    const inference = { endpoints: [endpoint, { ...endpoint, id: 'persist-b' }], active: null };
    renderInference(inference);
    const first = controls();
    first.models[0].value = 'cached'; first.models[0].listeners.change();
    first.prompts[0].value = 'Mi prompt sin enviar'; first.prompts[0].listeners.input();
    first.prompts[1].value = ''; first.prompts[1].listeners.input();
    renderInference({ ...inference, endpoints: inference.endpoints.map(endpoint => ({ ...endpoint, catalogError: 'http_status' })) });
    const second = controls();
    assert.equal(second.models[0].value, 'cached'); assert.equal(second.models[1].value, 'default');
    assert.equal(second.prompts[0].value, 'Mi prompt sin enviar'); assert.equal(second.prompts[1].value, '');
    const texts = descendants(ids['inference-endpoints']).map(el => el.textContent);
    assert.ok(texts.some(text => text.includes('Última comprobación:'))); assert.ok(texts.some(text => text.startsWith('Modelos de:')));
    renderInference({ endpoints: [], active: null, error: 'invalid_store' });
    assert.ok(descendants(ids['inference-endpoints']).some(el => el.textContent.includes('solo lectura')));
    assert.match(completionReport({ ok: true, servedModel: 'm-2024-01-01' }), /Modelo servido: m-2024-01-01/);
    assert.match(completionReport({ ok: true, servedModel: 'other', modelMismatch: true }), /Difiere del solicitado/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

const centerEndpoint = { id: 'ep-1', label: 'Proveedor', baseUrl: 'https://example.invalid/v1', defaultModel: 'big', keyHint: '1234', models: ['small', 'big'] };
const centerChoice = { source: 'center', endpointId: 'ep-1', modelId: 'big' };

test('create payload is exactly draft, limits and inference for the center and draft, limits for local', () => {
  assert.deepEqual(buildCreatePayload(draft, limits, centerChoice), { draft, limits, inference: { endpointId: 'ep-1', modelId: 'big' } });
  assert.deepEqual(Object.keys(buildCreatePayload(draft, limits, centerChoice)), ['draft', 'limits', 'inference']);
  assert.deepEqual(buildCreatePayload(draft, limits, { source: 'local', endpointId: 'ep-1', modelId: 'big' }), { draft, limits });
  assert.deepEqual(Object.keys(buildCreatePayload(draft, limits, null)), ['draft', 'limits']);
});

test('model list for an endpoint includes defaultModel once even when it is also cached', () => {
  assert.deepEqual(centerModelChoices(centerEndpoint), ['small', 'big']);
  assert.deepEqual(centerModelChoices({ ...centerEndpoint, models: ['small'] }), ['small', 'big']);
  assert.deepEqual(centerModelChoices({ ...centerEndpoint, defaultModel: null, models: [] }), []);
});

test('no endpoints or invalid_store disables the center option and selects local', () => {
  for (const inference of [{ endpoints: [], active: null }, { endpoints: [centerEndpoint], active: { endpointId: 'ep-1', modelId: 'big' }, error: 'invalid_store' }, undefined]) {
    assert.equal(centerUnavailable(inference), true);
    const resolved = resolveSource(inference, { touched: true, source: 'center', endpointId: 'ep-1', modelId: 'big' });
    assert.equal(resolved.centerDisabled, true); assert.equal(resolved.source, 'local');
  }
  assert.equal(centerUnavailable({ endpoints: [centerEndpoint], active: null }), false);
});

test('default source is center only when inference.active is set, and owner choices survive re-renders', () => {
  const noActive = { endpoints: [centerEndpoint], active: null }, active = { endpoints: [centerEndpoint], active: { endpointId: 'ep-1', modelId: 'small' } };
  assert.equal(defaultSource(noActive), 'local'); assert.equal(defaultSource(active), 'center');
  assert.equal(defaultSource({ endpoints: [centerEndpoint], active: { endpointId: 'gone', modelId: 'x' } }), 'local');
  assert.deepEqual(resolveSource(active, { touched: false }), { source: 'center', endpointId: 'ep-1', modelId: 'small', centerDisabled: false });
  assert.equal(resolveSource(noActive, { touched: false }).modelId, 'big');
  assert.deepEqual(resolveSource(active, { touched: true, source: 'local', endpointId: 'ep-1', modelId: 'big' }), { source: 'local', endpointId: 'ep-1', modelId: 'big', centerDisabled: false });
});

test('the center choice without an endpoint or model fails validation and loopback rejections still hold', () => {
  assert.equal(validateWizardDraft(draft, limits, centerChoice), true);
  assert.equal(validateWizardDraft(draft, limits, { source: 'center', endpointId: 'ep-1', modelId: '' }), false);
  assert.equal(validateWizardDraft(draft, limits, { source: 'center', endpointId: '', modelId: 'big' }), false);
  assert.equal(validateWizardDraft(draft, limits, { source: 'local' }), true);
  assert.equal(validateWizardDraft({ ...draft, baseUrl: 'https://models.example/v1' }, limits, centerChoice), false);
  assert.equal(validateWizardDraft({ ...draft, baseUrl: 'http://localhost:8080/v1' }, limits), false);
  assert.equal(isLocalEndpoint('http://10.0.0.5:8080/v1'), false);
});

test('model step markup exposes the source controls and the companion model line prefers the binding', async () => {
  const html = await readFile(new URL('../tools/agent/companion-studio/index.html', import.meta.url), 'utf8');
  for (const id of ['source-center', 'source-local', 'centerEndpoint', 'centerModel', 'center-fields', 'local-fields', 'source-hint', 'model-summary']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, />Modelo<\/li>/); assert.match(html, /Centro de inferencia<\/label>/); assert.match(html, /Local \(127\.0\.0\.1\)/);
  const inference = { endpoints: [centerEndpoint], active: null };
  assert.equal(modelSummaryLine({ binding: { endpointId: 'ep-1', modelId: 'big' }, inference, draft }), 'Modelo: Proveedor · big');
  assert.equal(modelSummaryLine({ binding: { endpointId: 'gone', modelId: 'big' }, inference, draft }), 'Modelo: gone · big');
  assert.equal(modelSummaryLine({ binding: null, inference, draft }), 'Modelo: local-model');
  assert.equal(modelSummaryLine({ inference, draft }), 'Modelo: local-model');
});

test('center model ids follow the inference center rule, not the local model pattern', () => {
  const cf = '@cf/meta/llama-3-8b-instruct';
  const endpoint = { ...centerEndpoint, models: [cf, 'bad\u0007id', 'x'.repeat(129)], defaultModel: 'acme+v2#1' };
  assert.deepEqual(centerModelChoices(endpoint), [cf, 'acme+v2#1']);
  assert.deepEqual(centerModelChoices({ ...centerEndpoint, models: [], defaultModel: cf }), [cf]);
  assert.deepEqual(centerModelChoices({ ...centerEndpoint, models: ['x'.repeat(128)], defaultModel: null }), ['x'.repeat(128)]);
  assert.equal(validateWizardDraft(draft, limits, { source: 'center', endpointId: 'ep-1', modelId: cf }), true);
  assert.equal(validateWizardDraft(draft, limits, { source: 'center', endpointId: 'ep-1', modelId: 'x'.repeat(129) }), false);
});
