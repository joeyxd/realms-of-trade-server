import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkedLimits, fixedWhy, isLocalEndpoint, keyFromFragment, normalizeChatInput, validateWizardDraft } from '../tools/agent/companion-studio/main.js';

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
