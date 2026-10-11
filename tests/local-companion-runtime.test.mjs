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

function fakeAdapterFactory({ hold = null, overhead = 1024, invalidSummary = false } = {}) {
  const calls = [];
  const factory = ({ baseUrl, modelId, thinkingMode }) => ({
    id: 'fake-local-openai', countMode: 'estimated_tokens',
    localResourcePolicy: { baseUrl, modelId, thinkingMode },
    countText: (text) => Buffer.byteLength(text, 'utf8'),
    prepare(request) {
      const body = JSON.stringify(request);
      return { body, inputTokens: Buffer.byteLength(body, 'utf8') + overhead,
        maxCostUnits: Buffer.byteLength(body, 'utf8') + overhead + request.maxOutputTokens };
    },
    async complete({ body }) {
      const packet = JSON.parse(body);
      calls.push(packet);
      if (hold) { hold.enter(); await hold.pending; }
      const sources = packet.context.required.tools.memoryCompaction?.sources;
      const text = JSON.stringify({ v: 1, decision: sources ? invalidSummary ? { type: 'reply', args: { text: 'Wrong mode' } } :
        { type: 'summarize_memory', args: { text: 'El dueño propone preparar una balsa llamada Faro de Jade; es un plan comunicado, no construcción confirmada.',
          tags: [], basis: sources.map(source => source.id) } } : { type: 'reply', args: { text: 'Te escucho, seguimos juntos.' } } });
      const inputTokens = Buffer.byteLength(body, 'utf8') + overhead;
      const outputTokens = 24;
      return { text, usage: { inputTokens, outputTokens, costUnits: inputTokens + outputTokens } };
    },
    get records() { return []; },
  });
  factory.calls = calls;
  return factory;
}

async function makeCompanion(t, adapterFactory, limits = { maxCalls: 6, maxTokens: 100000 }) {
  const parent = await mkdtemp(join(tmpdir(), 'local-companion-runtime-'));
  const directory = join(parent, 'companion');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const companion = await LocalCompanion.create({ directory, draft: { ...DEFAULT_COMPANION_DRAFT,
    name: 'Brisa local', modelId: 'qwen3.8-flash-next-coder-iq1_m', baseUrl: 'http://127.0.0.1:8080/v1' },
  limits, adapterFactory });
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
  assert.equal(chat.memory.ok, true, JSON.stringify(chat.memory));
  assert.equal((await companion.view()).continuity.journal.episodes, 1, 'confirmed exchange captured automatically');
  assert.equal((await companion.view()).transcript[0].sender, 'owner');
  assert.equal((await companion.view()).transcript[1].sender, 'companion');
  const remembered = await companion.remember();
  assert.equal(remembered.ok, true, JSON.stringify(remembered));
  assert.equal(remembered.memory.replay, true, 'manual capture of the same exchange is deduplicated');
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
  assert.equal(adapterFactory.calls[1].context.required.tools.continuity.latestEpisode.id,
    JSON.parse(memoryText.trim()).id, 'continuation point is pinned separately from ranked optional retrieval');
});

test('manual context refresh keeps identity and allowance, cancels late reply and never auto reenters', { timeout: 45000 }, async (t) => {
  let release, enter;
  const pending = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  const adapterFactory = fakeAdapterFactory({ hold: { pending, enter } });
  const { companion } = await makeCompanion(t, adapterFactory);
  const started = await companion.start();
  const chat = companion.chat('Prepararemos la balsa Faro de Jade.');
  await entered;
  const refreshed = await companion.refreshContext();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.sessionId, started.sessionId);
  assert.equal(refreshed.budgetReset, false);
  release();
  assert.equal((await chat).ok, false);
  await until(() => !companion.diagnostics.mind.inFlight, 'late inference reconciled');
  const view = await companion.view();
  assert.equal(view.status.connected, true);
  assert.equal(view.status.sessionId, started.sessionId);
  assert.equal(view.budget.totals.calls, 1);
  assert.equal(view.transcript.some(message => message.sender === 'companion'), false);
  assert.equal(view.continuity.journal.episodes, 0, 'cancelled turn does not auto capture a reply');
  await companion.stop();
  await companion.refreshContext();
  assert.equal((await companion.view()).status.state, 'stopped');
  assert.equal(companion.diagnostics.sessions, 1, 'refresh never creates another admission');
});

test('pressure summary is opt-in, idle, source-linked, bounded once per durable allowance across reopen', { timeout: 60000 }, async (t) => {
  const adapterFactory = fakeAdapterFactory({ overhead: 48000 });
  const { companion, directory } = await makeCompanion(t, adapterFactory, { maxCalls: 8, maxTokens: 800000 });
  const started = await companion.start();
  const firstChat = await companion.chat('Queremos preparar una balsa llamada Faro de Jade.');
  assert.equal(firstChat.ok, true, JSON.stringify(firstChat));
  const first = await companion.view();
  assert.equal(first.continuity.context.pressure, true);
  assert.equal(first.continuity.summaryScheduled, false, 'off by default even under pressure');
  assert.equal(companion.setContinuity({ autoCompact: true }).ok, true);
  const second = await companion.chat('Ese nombre es un plan; aún no hemos construido nada.');
  assert.equal(second.ok, true, JSON.stringify(second));
  const originals = (await readFile(join(directory, 'memory.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(originals.length, 2);
  assert.equal(adapterFactory.calls.length, 2, 'no summary inside urgent conversation');
  await until(() => companion.diagnostics.mind.records.some(record => record.mode === 'compaction'), 'idle summary', 15000);
  const summarized = await companion.view();
  assert.equal(summarized.continuity.lastSummary.ok, true, JSON.stringify(summarized.continuity.lastSummary));
  assert.equal(summarized.continuity.journal.summaries, 1);
  assert.equal(summarized.continuity.automaticSummaryRemaining, 0);
  assert.equal(summarized.status.sessionId, started.sessionId);
  const lines = (await readFile(join(directory, 'memory.jsonl'), 'utf8')).trim().split('\n');
  assert.deepEqual(lines.slice(0, 2), originals, 'summary appends without rewriting originals');
  assert.deepEqual(JSON.parse(lines[2]).payload.sources.map(source => source.id), originals.map(line => JSON.parse(line).id));
  assert.equal((await companion.chat('Continuaremos mañana.')).ok, true);
  assert.equal((await companion.view()).continuity.summaryScheduled, false, 'no summary loop');
  assert.equal(adapterFactory.calls.length, 4);
  const calls = summarized.budget.totals.calls;
  assert.equal(calls, 3);
  await companion.close();
  const reopened = await LocalCompanion.open({ directory, adapterFactory });
  t.after(() => reopened.close());
  const restored = await reopened.view();
  assert.equal(restored.continuity.autoCompact, false, 'paid automation opt-in is process-scoped');
  assert.equal(restored.continuity.automaticSummaryRemaining, 0, 'durable compaction reservation survives restart');
  assert.equal(restored.budget.totals.calls, 4);
  assert.equal(restored.status.state, 'stopped');
});

test('a rejected manual summary preserves sources and consumes its known allowance without retry', { timeout: 45000 }, async (t) => {
  const adapterFactory = fakeAdapterFactory({ invalidSummary: true });
  const { companion, directory } = await makeCompanion(t, adapterFactory);
  await companion.start();
  assert.equal((await companion.chat('Nuestra balsa será Faro de Jade.')).ok, true);
  const original = await readFile(join(directory, 'memory.jsonl'), 'utf8');
  const sourceId = JSON.parse(original.trim()).id;
  const result = await companion.compactMemory([sourceId]);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'invalid_decision');
  assert.equal(await readFile(join(directory, 'memory.jsonl'), 'utf8'), original);
  const view = await companion.view();
  assert.equal(view.budget.totals.calls, 2);
  assert.equal(view.budget.totals.unresolvedTokens, 0);
  assert.equal(view.continuity.automaticSummaryRemaining, 0);
  assert.equal(adapterFactory.calls.length, 2);
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
