import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createLocalOpenAITransport } from '../tools/agent/local-openai-transport.mjs';

const MODEL = 'qwen3.8-flash-next-coder-iq1_m';
const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10,
  prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } };
const answer = (overrides = {}) => ({ id: 'resp-local-1', model: MODEL,
  choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: structuredClone(usage), ...overrides });

async function fakeServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function respond(res, { status = 200, type = 'application/json', body = answer(), raw } = {}) {
  res.writeHead(status, { 'content-type': type });
  res.end(raw ?? JSON.stringify(body));
}

function transport(baseUrl, extra = {}) {
  return createLocalOpenAITransport({ baseUrl, modelId: MODEL, maxCalls: 2,
    maxOutputTokens: 40, timeoutMs: 1_000, ...extra });
}

test('pins request payload, sends no auth or caller options, and returns native usage', async (t) => {
  let seen;
  const { server, baseUrl } = await fakeServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    seen = { method: req.method, url: req.url, headers: req.headers,
      body: JSON.parse(Buffer.concat(parts).toString('utf8')) };
    await respond(res);
  });
  t.after(() => server.close());
  const result = await transport(`${baseUrl}/`).generate({ messages: [
    { role: 'system', content: 'Be brief' }, { role: 'user', content: 'hello' },
  ] });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/v1/chat/completions');
  assert.equal(seen.headers.authorization, undefined);
  assert.deepEqual(seen.body, { model: MODEL,
    messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'hello' }],
    stream: false, temperature: 0, max_tokens: 40 });
  assert.deepEqual(result, { ok: true, why: 'ok', dispatched: true, usageKnown: true,
    usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 2, reasoningTokens: 1 },
    text: 'hello', responseId: 'resp-local-1', reportedModel: MODEL, finishReason: 'stop',
    latencyMs: result.latencyMs, costNanoUsd: null, executionMayContinue: false });
  assert.equal(result.costNanoUsd, null);
});

test('rejects unsafe options and getter, symbol, extra-key, and oversized requests without dispatch', async (t) => {
  let hits = 0;
  const { server, baseUrl } = await fakeServer((_req, res) => { hits++; res.end('{}'); });
  t.after(() => server.close());
  for (const invalid of [
    { baseUrl: baseUrl.replace('127.0.0.1', 'localhost') },
    { baseUrl: `${baseUrl}?x=1` }, { modelId: 'bad model' }, { maxCalls: 0 },
    { maxOutputTokens: 513 }, { timeoutMs: 99 }, { maxInputBytes: 65_537 },
    { maxInputBytes: null }, { maxResponseBytes: null },
    { thinkingMode: 'auto' }, { thinkingMode: null },
  ]) assert.throws(() => createLocalOpenAITransport({ baseUrl, modelId: MODEL, maxCalls: 1,
    maxOutputTokens: 1, timeoutMs: 100, ...invalid }), TypeError);

  const client = transport(baseUrl, { maxInputBytes: 80 });
  let getterCalls = 0;
  const getterMessage = { role: 'user', get content() { getterCalls++; return 'x'; } };
  const withSymbol = { role: 'user', content: 'x', [Symbol('extra')]: true };
  const badRequests = [
    { messages: [getterMessage] }, { messages: [withSymbol] },
    { messages: [{ role: 'developer', content: 'x' }] },
    { messages: [{ role: 'user', content: 'x', extra: true }] },
    { messages: [{ role: 'user', content: 'x'.repeat(200) }] },
    { messages: [{ role: 'user', content: 'x' }], extra: true },
  ];
  for (const input of badRequests) {
    const result = await client.generate(input);
    assert.equal(result.why, 'invalid_request');
    assert.equal(result.dispatched, false);
  }
  assert.equal(getterCalls, 0);
  assert.equal(client.state.calls, 0);
  assert.equal(hits, 0);
});

test('disabled thinking is pinned in the payload; the server-default mode omits it', async (t) => {
  const payloads = [];
  const { server, baseUrl } = await fakeServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    payloads.push(JSON.parse(Buffer.concat(parts).toString('utf8')));
    await respond(res);
  });
  t.after(() => server.close());
  const messages = [{ role: 'user', content: 'short answer' }];
  const disabled = await transport(baseUrl, { thinkingMode: 'disabled' }).generate({ messages });
  const serverDefault = await transport(baseUrl).generate({ messages });
  assert.equal(disabled.ok, true);
  assert.equal(serverDefault.ok, true);
  assert.deepEqual(payloads[0], { model: MODEL, messages, stream: false, temperature: 0,
    max_tokens: 40, chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(payloads[1], { model: MODEL, messages, stream: false, temperature: 0,
    max_tokens: 40 });
});

test('generate rejects caller thinking or template overrides without dispatch', async (t) => {
  let hits = 0;
  const { server, baseUrl } = await fakeServer((_req, res) => { hits++; res.end('{}'); });
  t.after(() => server.close());
  const client = transport(baseUrl, { thinkingMode: 'disabled' });
  for (const input of [
    { messages: [{ role: 'user', content: 'hi' }], thinkingMode: 'server_default' },
    { messages: [{ role: 'user', content: 'hi' }], chat_template_kwargs: { enable_thinking: true } },
    { messages: [{ role: 'user', content: 'hi' }], temperature: 1 },
    { messages: [{ role: 'user', content: 'hi' }], max_tokens: 512 },
    { messages: [{ role: 'user', content: 'hi' }], model: 'other-model' },
  ]) {
    const result = await client.generate(input);
    assert.equal(result.why, 'invalid_request');
    assert.equal(result.dispatched, false);
  }
  assert.equal(client.state.calls, 0);
  assert.equal(hits, 0);
});

test('rejects a provider output overrun while retaining its native counters', async (t) => {
  const { server, baseUrl } = await fakeServer((_req, res) => respond(res));
  t.after(() => server.close());
  const client = transport(baseUrl, { maxOutputTokens: 2 });
  const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.why, 'output_limit');
  assert.equal(result.ok, false);
  assert.equal(result.text, null);
  assert.equal(result.usage.outputTokens, 3);
  assert.equal(result.usageKnown, true);
});

test('pre-abort does not dispatch or consume the instance call limit', async (t) => {
  let hits = 0;
  const { server, baseUrl } = await fakeServer((_req, res) => { hits++; res.end('{}'); });
  t.after(() => server.close());
  const client = transport(baseUrl, { maxCalls: 1 });
  const controller = new AbortController();
  controller.abort();
  const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal });
  assert.equal(result.why, 'aborted');
  assert.equal(result.dispatched, false);
  assert.equal(client.state.calls, 0);
  assert.equal(hits, 0);
});

test('a settled native response consumes one call and then enforces the call cap', async (t) => {
  let hits = 0;
  const { server, baseUrl } = await fakeServer((_req, res) => { hits++; respond(res); });
  t.after(() => server.close());
  const client = transport(baseUrl, { maxCalls: 1 });
  const first = await client.generate({ messages: [{ role: 'user', content: 'once' }] });
  const second = await client.generate({ messages: [{ role: 'user', content: 'again' }] });
  assert.equal(first.ok, true);
  assert.equal(second.why, 'call_limit');
  assert.equal(second.dispatched, false);
  assert.equal(hits, 1);
});

test('returns truncated output with known usage, and does not expose reasoning fields', async (t) => {
  const payload = answer();
  payload.choices[0].finish_reason = 'length';
  payload.choices[0].logprobs = null;
  payload.choices[0].message.reasoning_content = 'private reasoning';
  const { server, baseUrl } = await fakeServer((_req, res) => respond(res, { body: payload }));
  t.after(() => server.close());
  const result = await transport(baseUrl).generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'truncated');
  assert.equal(result.finishReason, 'length');
  assert.equal(result.text, 'hello');
  assert.equal(result.usageKnown, true);
  assert.equal('reasoning_content' in result, false);
  assert.equal(JSON.stringify(result).includes('private reasoning'), false);
  assert.equal(result.executionMayContinue, false);
});

test('accepts only consistent bounded native usage and latches unknown usage', async (t) => {
  const badUsages = [undefined,
    { prompt_tokens: -1, completion_tokens: 3, total_tokens: 2 },
    { prompt_tokens: 7, completion_tokens: 3, total_tokens: 11 },
    { prompt_tokens: 1_000_000_001, completion_tokens: 0, total_tokens: 1_000_000_001 },
    { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10,
      prompt_tokens_details: { cached_tokens: 8 } },
    { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10,
      completion_tokens_details: { reasoning_tokens: 4 } },
  ];
  for (const badUsage of badUsages) {
    const { server, baseUrl } = await fakeServer((_req, res) => {
      const payload = answer({ usage: badUsage });
      respond(res, { body: payload });
    });
    t.after(() => server.close());
    const client = transport(baseUrl);
    const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.why, 'invalid_usage');
    assert.equal(result.usageKnown, false);
    assert.equal(result.text, null);
    assert.equal(result.executionMayContinue, true);
    assert.equal((await client.generate({ messages: [{ role: 'user', content: 'again' }] })).why,
      'uncertain_blocked');
  }
});

test('a reasoning-only truncated reply has known usage but no applicable text', async (t) => {
  const body = answer();
  body.choices[0].finish_reason = 'length';
  body.choices[0].message.content = null;
  body.choices[0].message.reasoning_content = 'discarded unfinished reasoning';
  const { server, baseUrl } = await fakeServer((_req, res) => respond(res, { body }));
  t.after(() => server.close());
  const result = await transport(baseUrl).generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.why, 'truncated');
  assert.equal(result.finishReason, 'length');
  assert.equal(result.usageKnown, true);
  assert.equal(result.text, null);
  assert.equal(JSON.stringify(result).includes('discarded unfinished reasoning'), false);
});

test('rejects model, choice, role, tools, and unrecognized finish reason without applying text', async (t) => {
  const cases = [
    ['model_mismatch', (p) => { p.model = 'other-model'; }],
    ['invalid_response', (p) => { p.choices.push(structuredClone(p.choices[0])); }],
    ['invalid_response', (p) => { p.choices[0].message.role = 'user'; }],
    ['invalid_response', (p) => { p.choices[0].message.tool_calls = []; }],
    ['invalid_response', (p) => { p.choices[0].finish_reason = 'content_filter'; }],
  ];
  for (const [why, mutate] of cases) {
    const { server, baseUrl } = await fakeServer((_req, res) => {
      const payload = answer(); mutate(payload); respond(res, { body: payload });
    });
    t.after(() => server.close());
    const client = transport(baseUrl);
    const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.why, why);
    assert.equal(result.text, null);
    assert.equal(result.usageKnown, why !== 'model_mismatch');
    if (why === 'model_mismatch') {
      assert.equal(result.executionMayContinue, false);
      assert.equal(result.usage, null);
      assert.equal((await client.generate({ messages: [{ role: 'user', content: 'again' }] })).why,
        'uncertain_blocked');
    }
  }
});

test('HTTP status, redirect, content type, invalid JSON, and response cap fail closed', async (t) => {
  const scenarios = [
    [{ status: 503, body: answer() }, 'http_status'],
    [{ status: 302, type: 'application/json', body: answer() }, 'http_status'],
    [{ type: 'text/plain', body: answer() }, 'content_type'],
    [{ raw: '{bad json' }, 'invalid_json'],
    [{ raw: 'x'.repeat(1_100) }, 'response_too_large'],
  ];
  for (const [scenario, expected] of scenarios) {
    const { server, baseUrl } = await fakeServer((_req, res) => {
      if (scenario.status === 302) res.writeHead(302, { location: '/elsewhere', 'content-type': 'application/json' }).end('{}');
      else respond(res, scenario);
    });
    t.after(() => server.close());
    const client = transport(baseUrl, { maxResponseBytes: 1_024 });
    const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.why, expected);
    assert.equal(result.text, null);
    assert.equal(result.executionMayContinue, true);
    assert.equal((await client.generate({ messages: [{ role: 'user', content: 'again' }] })).why,
      'uncertain_blocked');
  }
});

test('one in-flight request, max call limit, cancellation latch, and late response discard', async (t) => {
  let receivedResolve;
  let releaseResolve;
  const received = new Promise((resolve) => { receivedResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const { server, baseUrl } = await fakeServer(async (req, res) => {
    for await (const _chunk of req) { /* Drain request before holding the response. */ }
    receivedResolve();
    await release;
    if (!res.destroyed) respond(res);
  });
  t.after(() => { releaseResolve(); server.close(); });
  const client = transport(baseUrl, { maxCalls: 1, timeoutMs: 2_000 });
  const controller = new AbortController();
  const pending = client.generate({ messages: [{ role: 'user', content: 'wait' }], signal: controller.signal });
  await received;
  assert.equal((await client.generate({ messages: [{ role: 'user', content: 'busy' }] })).why, 'busy');
  controller.abort();
  const canceled = await pending;
  assert.equal(canceled.why, 'aborted');
  assert.equal(canceled.executionMayContinue, true);
  assert.equal((await client.generate({ messages: [{ role: 'user', content: 'late' }] })).why,
    'uncertain_blocked');
  releaseResolve();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(client.state.calls, 1);
  assert.equal(client.state.uncertain, true);
});

test('total timeout includes a response body that stalls after dispatch', async (t) => {
  const { server, baseUrl } = await fakeServer(async (req, res) => {
    for await (const _chunk of req) { /* Drain request before stalling the body. */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"id":"late"');
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = transport(baseUrl, { timeoutMs: 120 });
  const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.why, 'timeout');
  assert.equal(result.executionMayContinue, true);
  assert.equal(client.state.uncertain, true);
});

test('a socket close without a response latches unknown execution', async (t) => {
  const { server, baseUrl } = await fakeServer(async (req, res) => {
    for await (const _chunk of req) { /* Drain before simulating a dropped response. */ }
    res.destroy();
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = transport(baseUrl);
  const result = await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.why, 'transport_error');
  assert.equal(result.usageKnown, false);
  assert.equal(result.executionMayContinue, true);
  assert.equal(client.state.uncertain, true);
  assert.equal((await client.generate({ messages: [{ role: 'user', content: 'retry?' }] })).why,
    'uncertain_blocked');
});
