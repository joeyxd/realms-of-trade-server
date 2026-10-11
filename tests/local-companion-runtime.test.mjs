import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COMPANION_DRAFT } from '../src/net/companionTemplates.js';
import { LocalCompanion } from '../tools/agent/local-companion.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = check(); if (value) return value; await sleep(15); }
  throw new Error(`timeout: ${label}`);
}

function fakeAdapterFactory({ hold = null } = {}) {
  const calls = [];
  const factory = ({ baseUrl, modelId, thinkingMode }) => ({
    id: 'fake-local-openai', countMode: 'estimated_tokens',
    localResourcePolicy: { baseUrl, modelId, thinkingMode },
    countText: (text) => Buffer.byteLength(text, 'utf8'),
    prepare(request) {
      const body = JSON.stringify(request);
      return { body, inputTokens: Buffer.byteLength(body, 'utf8') + 1024,
        maxCostUnits: Buffer.byteLength(body, 'utf8') + 1024 + request.maxOutputTokens };
    },
    async complete({ body }) {
      const packet = JSON.parse(body);
      calls.push(packet);
      if (hold) { hold.enter(); await hold.pending; }
      const text = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Te escucho, seguimos juntos.' } } });
      const inputTokens = Buffer.byteLength(body, 'utf8') + 1024;
      const outputTokens = 24;
      return { text, usage: { inputTokens, outputTokens, costUnits: inputTokens + outputTokens } };
    },
    get records() { return []; },
  });
  factory.calls = calls;
  return factory;
}

async function makeCompanion(t, adapterFactory) {
  const parent = await mkdtemp(join(tmpdir(), 'local-companion-runtime-'));
  const directory = join(parent, 'companion');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const companion = await LocalCompanion.create({ directory, draft: { ...DEFAULT_COMPANION_DRAFT,
    name: 'Brisa local', modelId: 'qwen3.8-flash-next-coder-iq1_m', baseUrl: 'http://127.0.0.1:8080/v1' },
  limits: { maxCalls: 6, maxTokens: 100000 }, adapterFactory });
  t.after(() => companion.close().catch(() => {}));
  return { companion, directory };
}

test('local companion chats over its real local GameHost, remembers, reenters and reopens the durable non-monetary ledger', { timeout: 45000 }, async (t) => {
  const adapterFactory = fakeAdapterFactory();
  const { companion, directory } = await makeCompanion(t, adapterFactory);
  const first = await companion.start();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal((await companion.view()).status.connected, true);

  const chat = await companion.chat('Hola Brisa, ¿recuerdas lo que hablamos?');
  assert.equal(chat.ok, true, JSON.stringify(chat));
  assert.equal(chat.reply, 'Te escucho, seguimos juntos.');
  assert.equal((await companion.view()).transcript[0].sender, 'owner');
  assert.equal((await companion.view()).transcript[1].sender, 'companion');
  const remembered = await companion.remember();
  assert.equal(remembered.ok, true, JSON.stringify(remembered));
  const memoryText = await readFile(join(directory, 'memory.jsonl'), 'utf8');
  assert.match(memoryText, /Hola Brisa, ¿recuerdas lo que hablamos\?/);
  assert.match(memoryText, /Te escucho, seguimos juntos\./);
  assert.equal(adapterFactory.calls.length, 1, 'remember stores the delivered episode without another model call');

  const before = (await companion.view()).budget;
  assert.equal(before.unit, 'local_compute_tokens');
  assert.equal(before.costNanoUsd, null);
  assert.equal(before.totals.calls, 1);
  assert.ok(before.totals.confirmedTokens > 0);
  assert.equal(before.persistence.admissionWhy, null);
  const reentered = await companion.reenter();
  assert.equal(reentered.ok, true, JSON.stringify(reentered));
  assert.notEqual(reentered.sessionId, first.sessionId);
  assert.equal((await companion.view()).status.connected, true);
  assert.match(await readFile(join(directory, 'memory.jsonl'), 'utf8'), /Hola Brisa/);

  await companion.close();
  const reopened = await LocalCompanion.open({ directory, adapterFactory });
  t.after(() => reopened.close().catch(() => {}));
  const persisted = (await reopened.view()).budget;
  assert.equal(persisted.totals.calls, 1);
  assert.equal(persisted.totals.confirmedTokens, before.totals.confirmedTokens);
  assert.equal(persisted.persistence.policy.modelId, 'qwen3.8-flash-next-coder-iq1_m');
  assert.equal(persisted.persistence.costNanoUsd, null);
  assert.equal((await reopened.start()).ok, true);
  const secondChat = await reopened.chat('¿Sigues recordando nuestra conversación?');
  assert.equal(secondChat.ok, true, JSON.stringify(secondChat));
  assert.equal((await reopened.view()).budget.totals.calls, 2);
  assert.match(JSON.stringify(adapterFactory.calls[1]), /Hola Brisa, ¿recuerdas lo que hablamos\?/,
    'the reopened companion retrieves the persisted episode into its next model context');
});

test('stopping during a held local inference prevents late chat delivery', { timeout: 30000 }, async (t) => {
  let release;
  let markEntered;
  const pending = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const adapterFactory = fakeAdapterFactory({ hold: { pending, enter: markEntered } });
  const { companion } = await makeCompanion(t, adapterFactory);
  assert.equal((await companion.start()).ok, true);
  const chatPromise = companion.chat('Brisa, espera mientras reviso esto.');
  await entered;
  const stopped = await companion.stop();
  assert.equal(stopped.ok, true);
  release();
  const result = await chatPromise;
  assert.equal(result.ok, false);
  assert.equal((await companion.view()).transcript.some((message) => message.text === 'Te escucho, seguimos juntos.'), false);
  assert.equal((await companion.view()).budget.totals.calls, 1);
});
