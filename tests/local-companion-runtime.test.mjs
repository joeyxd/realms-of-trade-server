import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createInferenceCenter } from '../tools/agent/inference-center.mjs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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


async function boundCompanion(t, { baseUrl = 'https://example.invalid/v1', withResolver = true, endpointAdapterFactory } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'mn-bound-companion-')), directory = join(parent, 'companion');
  const center = await createInferenceCenter({ inferenceHome: join(parent, 'inference') });
  const apiKey = 'ic02-known-private-key-7d8c9b', modelId = 'bound/provider-model:2';
  const { id: endpointId } = await center.save({ id: null, label: 'Bound test', baseUrl, apiKey, defaultModel: modelId });
  const inference = { endpointId, modelId }; let resolutions = 0;
  const resolveInference = (id, model) => { resolutions++; return center.resolve(id, model); };
  const companion = await LocalCompanion.create({ directory, draft: { ...DEFAULT_COMPANION_DRAFT,
    baseUrl: 'http://127.0.0.1:8080/v1', modelId: 'original-loopback-model', thinkingMode: 'disabled' },
    limits: { maxCalls: 6, maxTokens: 100000 }, inference,
    ...(withResolver ? { resolveInference } : {}), ...(endpointAdapterFactory ? { endpointAdapterFactory } : {}) });
  t.after(async () => { await companion.close(); await rm(parent, { recursive: true, force: true }); });
  return { companion, directory, center, inference, apiKey, resolveInference, resolutions: () => resolutions };
}

test('bound companion writes runtime binding and reopens without resolving or changing the manifest draft', async t => {
  const { companion, directory, inference, resolveInference, resolutions } = await boundCompanion(t);
  const runtime = JSON.parse(await readFile(join(directory, 'local-runtime.json')));
  assert.equal(runtime.schema, 'mn.local-companion-runtime.v1'); assert.deepEqual(runtime.inference, inference);
  const manifest = JSON.parse(await readFile(join(directory, 'companion-manifest.json')));
  assert.equal(manifest.draft.modelId, 'original-loopback-model'); assert.equal(manifest.inference, undefined);
  assert.deepEqual((await companion.view()).binding, inference);
  assert.deepEqual(companion.diagnostics.budget.persistence.policy, { ...inference, thinkingMode: 'disabled' });
  const reopened = await LocalCompanion.open({ directory, resolveInference });
  try { assert.deepEqual((await reopened.view()).binding, inference); assert.equal(resolutions(), 0); }
  finally { await reopened.close(); }
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'local-runtime.json'))), runtime);
});

test('bound start refuses a deleted endpoint before connecting a runner or starting a world', async t => {
  const { companion, directory, center, inference, resolveInference, resolutions } = await boundCompanion(t);
  await companion.close(); await center.delete(inference.endpointId);
  const reopened = await LocalCompanion.open({ directory, resolveInference });
  try {
    assert.equal(resolutions(), 0, 'open does not resolve even when the endpoint is missing');
    assert.deepEqual(await reopened.start(), { ok: false, why: 'endpoint_unknown' });
    assert.equal(reopened.diagnostics.sessions, 0); assert.equal(reopened.diagnostics.runnerSessionId, null);
    const view = await reopened.view(); assert.equal(view.status.connected, false); assert.equal(view.status.worldUrl, null);
    assert.equal(resolutions(), 1);
  } finally { await reopened.close(); }
});

test('bound start without a resolver fails with inference_unavailable and never falls back', async t => {
  const { companion } = await boundCompanion(t, { withResolver: false });
  assert.deepEqual(await companion.start(), { ok: false, why: 'inference_unavailable' });
  assert.equal(companion.diagnostics.sessions, 0); assert.equal(companion.diagnostics.runnerSessionId, null);
  assert.equal((await companion.view()).status.worldUrl, null);
});


test('bound create, start and chat keep the key out of every companion file and reuse one resolution', async t => {
  let requests = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const packet = JSON.parse(Buffer.concat(chunks)); requests++;
    assert.equal(req.headers.authorization, 'Bearer ic02-known-private-key-7d8c9b');
    assert.equal(packet.model, 'bound/provider-model:2');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: packet.model, choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Aquí sigo.' } } }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const { companion, directory, inference, apiKey, resolutions } = await boundCompanion(t,
    { baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  assert.equal((await companion.start()).ok, true);
  assert.equal((await companion.chat('Hola, Brisa.')).ok, true);
  assert.equal((await companion.chat('Seguimos juntos.')).ok, true);
  assert.equal(resolutions(), 1); assert.equal(requests, 2);
  assert.equal(companion.diagnostics.budget.totals.confirmedCostUnits, 220);
  assert.ok(!JSON.stringify({ view: await companion.view(), diagnostics: companion.diagnostics }).includes(apiKey));
  await companion.stop();
  assert.deepEqual((await companion.view()).binding, inference);
  assert.equal((await companion.start()).ok, true); assert.equal(resolutions(), 2);
  assert.equal(requests, 2, 'starting never polls the provider');
  async function scan(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = join(root, entry.name);
      if (entry.isDirectory()) await scan(file);
      else assert.ok(!(await readFile(file)).includes(Buffer.from(apiKey)), `key leaked into ${entry.name}`);
    }
  }
  await scan(directory);
});

test('local runtime binding validates exact fields, endpoint ids and registry model rules on create and open', async t => {
  const { companion, directory, inference } = await boundCompanion(t);
  for (const binding of [null, { ...inference, extra: true }, { ...inference, endpointId: 'A'.repeat(16) },
    { ...inference, modelId: 'bad' + String.fromCharCode(10) }, { ...inference, modelId: 'x'.repeat(201) }, { ...inference, modelId: ' ' }]) {
    const child = join(directory, 'invalid-child');
    await assert.rejects(LocalCompanion.create({ directory: child, draft: companion.draft,
      limits: { maxCalls: 6, maxTokens: 100000 }, inference: binding }), /invalid_inference_binding/);
    await assert.rejects(readFile(join(child, 'local-runtime.json')), { code: 'ENOENT' });
    const file = join(directory, 'local-runtime.json'), runtime = JSON.parse(await readFile(file));
    await writeFile(file, JSON.stringify({ ...runtime, inference: binding }));
    await assert.rejects(LocalCompanion.open({ directory }), /invalid_inference_binding/);
    await writeFile(file, JSON.stringify(runtime));
  }
});
