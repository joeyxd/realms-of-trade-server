import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createLocalOpenAIMind, createEndpointOpenAIMind } from '../tools/agent/local-openai-mind.mjs';
import { parseDecision } from '../tools/agent/mind-contract.mjs';

const MODEL = 'local-fixture-model:7b';
const USAGE = { prompt_tokens: 19, completion_tokens: 8, total_tokens: 27,
  prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 } };
const validDecision = JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } });

async function fakeProvider(t, produce) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    requests.push({ method: req.method, url: req.url, headers: req.headers, raw, body: JSON.parse(raw.toString('utf8')) });
    await produce({ req, res, request: requests.at(-1), index: requests.length - 1 });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  });
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

function response(res, { content = validDecision, usage = USAGE, finish = 'stop', model = MODEL } = {}) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'local-mind-fixture', model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage }));
}

function request(adapter, instructions = 'Choose wait.', context = { required: { personality: 'Serena' } }) {
  return { v: 1, instructions, responseSchema: { type: 'object', required: ['v', 'decision'] }, context, maxOutputTokens: 64 };
}

async function complete(adapter, body, { maxOutputTokens = 64, maxResponseBytes = 8192, signal } = {}) {
  return adapter.complete({ body, signal, maxOutputTokens, maxResponseBytes });
}

test('prepared request matches exact provider wire body and record hash; pins model, disabled thinking, and one dispatch', async (t) => {
  const provider = await fakeProvider(t, async ({ res }) => response(res));
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, thinkingMode: 'disabled',
    maxCalls: 2, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  assert.equal(prepared.inputTokens, Buffer.byteLength(prepared.body, 'utf8') + 1024);
  assert.equal(prepared.maxCostUnits, prepared.inputTokens + 64);

  const result = await complete(adapter, prepared.body);
  assert.equal(result.text, validDecision);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 8, costUnits: 27 });
  assert.equal(provider.requests.length, 1, 'one complete call must not retry');
  const wire = provider.requests[0];
  assert.equal(wire.method, 'POST');
  assert.equal(wire.url, '/v1/chat/completions');
  assert.equal(wire.headers.authorization, undefined);
  assert.equal(wire.raw.toString('utf8'), prepared.body);
  assert.deepEqual(wire.body, JSON.parse(prepared.body));
  assert.equal(wire.body.model, MODEL);
  assert.equal(wire.body.max_tokens, 64);
  assert.deepEqual(wire.body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(wire.body.temperature, 0);
  assert.equal(wire.body.stream, false);
  assert.equal(adapter.records.length, 1);
  assert.equal(adapter.records[0].bodySha256, createHash('sha256').update(prepared.body).digest('hex'));
  assert.equal(adapter.records[0].resourceUnit, 'local_compute_tokens');
  assert.equal(adapter.transportState.calls, 1);
});

test('server-default thinking omits template override and constructor policy stays fixed', async (t) => {
  const provider = await fakeProvider(t, async ({ res }) => response(res));
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, thinkingMode: 'server_default',
    maxCalls: 1, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  assert.equal(Object.hasOwn(JSON.parse(prepared.body), 'chat_template_kwargs'), false);
  assert.deepEqual(adapter.localResourcePolicy, { baseUrl: provider.baseUrl, modelId: MODEL, thinkingMode: 'server_default' });
  await complete(adapter, prepared.body);
  assert.deepEqual(provider.requests[0].body, JSON.parse(prepared.body));
  assert.equal(provider.requests.length, 1);
});

test('malformed JSON text reaches the schema parser as an invalid proposal without retry', async (t) => {
  const malformed = '{"v":1,"decision":';
  const provider = await fakeProvider(t, async ({ res }) => response(res, { content: malformed }));
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  const result = await complete(adapter, prepared.body);
  assert.equal(result.text, malformed);
  assert.equal(parseDecision(result.text, 8192), null);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 8, costUnits: 27 });
  assert.equal(provider.requests.length, 1);
  assert.equal(adapter.records.length, 1);
});

test('truncated provider output is discarded while known native usage is retained', async (t) => {
  const provider = await fakeProvider(t, async ({ res }) => response(res, { content: '{"v":1', finish: 'length' }));
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  const result = await complete(adapter, prepared.body);
  assert.equal(result.text, null);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 8, costUnits: 27 });
  assert.equal(adapter.records[0].why, 'truncated');
  assert.equal(provider.requests.length, 1);
});

test('response byte cap discards text but keeps native usage, with no follow-up request', async (t) => {
  const text = 'á'.repeat(20);
  const provider = await fakeProvider(t, async ({ res }) => response(res, { content: text }));
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  const result = await complete(adapter, prepared.body, { maxResponseBytes: 16 });
  assert.equal(result.text, null);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 8, costUnits: 27 });
  assert.equal(provider.requests.length, 1);
});

test('adapter rejects altered payload model, generation options, and output budget before dispatch', async (t) => {
  let hits = 0;
  const provider = await fakeProvider(t, async ({ res }) => { hits++; response(res); });
  const adapter = createLocalOpenAIMind({ baseUrl: provider.baseUrl, modelId: MODEL, thinkingMode: 'disabled',
    maxCalls: 2, maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  const altered = [
    JSON.stringify({ ...JSON.parse(prepared.body), model: 'other-model' }),
    JSON.stringify({ ...JSON.parse(prepared.body), temperature: 0.5 }),
    JSON.stringify({ ...JSON.parse(prepared.body), chat_template_kwargs: { enable_thinking: true } }),
  ];
  for (const body of altered) await assert.rejects(complete(adapter, body), { message: 'local_payload_mismatch' });
  await assert.rejects(complete(adapter, prepared.body, { maxOutputTokens: 32 }), { message: 'invalid_local_completion' });
  assert.equal(hits, 0);
  assert.equal(adapter.transportState.calls, 0);
});


test('endpoint mind sends the registry key and bound model and converts native usage to costUnits', async t => {
  const provider = await fakeProvider(t, async ({ res }) => response(res));
  const endpointId = '0123456789abcdef', apiKey = 'bound-endpoint-secret-xyz';
  const adapter = createEndpointOpenAIMind({ endpointId, endpoint: { baseUrl: provider.baseUrl, apiKey },
    modelId: MODEL, thinkingMode: 'disabled', maxOutputTokens: 64, timeoutMs: 1000 });
  const prepared = adapter.prepare(request(adapter));
  const result = await complete(adapter, prepared.body);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].headers.authorization, `Bearer ${apiKey}`);
  assert.equal(provider.requests[0].body.model, MODEL);
  assert.equal(provider.requests[0].raw.toString('utf8'), prepared.body);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 8, costUnits: 27 });
  assert.deepEqual(adapter.localResourcePolicy, { endpointId, modelId: MODEL, thinkingMode: 'disabled' });
  assert.equal(adapter.id, 'endpoint-openai-mind-v1');
  assert.ok(!JSON.stringify({ prepared, result, policy: adapter.localResourcePolicy, records: adapter.records }).includes(apiKey));
});

test('body-mode presence key adds the Spanish body-order hint; without the key the prompt has none', () => {
  const adapter = createLocalOpenAIMind({ baseUrl: 'http://127.0.0.1:1/v1', modelId: MODEL, thinkingMode: 'disabled',
    maxCalls: 2, maxOutputTokens: 64, timeoutMs: 1000 });
  const system = tools => JSON.parse(adapter.prepare(request(adapter, 'Choose wait.', { required: { tools } })).body).messages[0].content;
  const conversation = { source: { text: 'sígueme' } };
  const withKey = system({ conversation, presence: null }), without = system({ conversation });
  assert.match(withKey, /decision\.args\.body/);
  assert.match(withKey, /"follow", "wait" o "return"/);
  assert.doesNotMatch(without, /decision\.args\.body/);
});
