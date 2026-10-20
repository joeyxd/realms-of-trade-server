import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createEndpointOpenAITransport, checkedEndpointUrl } from '../tools/agent/endpoint-openai-transport.mjs';

async function fake(t, handler) {
  const server = createServer(handler); await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const options = baseUrl => ({ endpoint: { baseUrl, apiKey: 'secret' }, modelId: 'm', maxCalls: 1, maxOutputTokens: 256, timeoutMs: 1000 });
const input = { messages: [{ role: 'user', content: 'Hola' }] };
const payload = (extra = {}) => ({ model: 'm', id: 'c1', choices: [{ index: 0, message: { role: 'assistant', content: 'Respuesta' }, finish_reason: 'stop' }], ...extra });
const send = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

test('endpoint transport pins prefix, authorization and payload; returns usage and HTTP status', async t => {
  let calls = 0;
  const base = await fake(t, async (req, res) => {
    calls++; assert.equal(req.url, '/gateway/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer secret');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { model: 'm', messages: input.messages, stream: false, temperature: 0, max_tokens: 256 });
    send(res, payload({ usage: { prompt_tokens: 5, completion_tokens: 2 } }));
  });
  for (const suffix of ['/gateway', '/gateway/v1/']) {
    const transport = createEndpointOpenAITransport(options(base + suffix));
    const result = await transport.generate(input);
    assert.equal(result.ok, true); assert.equal(result.text, 'Respuesta'); assert.equal(result.status, 200);
    assert.equal(result.dispatched, true); assert.equal(result.executionMayContinue, false);
    assert.equal(result.responseId, 'c1'); assert.equal(result.reportedModel, 'm'); assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 2 });
    assert.equal((await transport.generate(input)).why, 'call_limit');
  }
  assert.equal(calls, 2);
});

test('endpoint transport allows absent usage as null and omits auth without a key', async t => {
  const base = await fake(t, (req, res) => { assert.equal(req.headers.authorization, undefined); send(res, payload()); });
  const config = options(base); delete config.endpoint.apiKey;
  const result = await createEndpointOpenAITransport(config).generate(input);
  assert.equal(result.ok, true); assert.equal(result.usage, null); assert.equal(result.usageKnown, false);
});

test('endpoint transport accepts HTTPS configuration and rejects invalid schemes, queries and byte limits', () => {
  assert.equal(checkedEndpointUrl('https://example.invalid/api/v1/'), 'https://example.invalid/api/v1');
  assert.ok(createEndpointOpenAITransport(options('https://example.invalid/v1')));
  for (const value of ['ftp://example.invalid', 'https://example.invalid/?q=1']) assert.throws(() => createEndpointOpenAITransport(options(value)));
  for (const extra of [{ timeoutMs: 30001 }, { maxInputBytes: 65537 }, { maxResponseBytes: 262145 }]) assert.throws(() => createEndpointOpenAITransport({ ...options('https://example.invalid/v1'), ...extra }));
});

test('endpoint transport rejects caller destinations, oversized requests and pre-abort without dispatch', async () => {
  const transport = createEndpointOpenAITransport(options('http://127.0.0.1:1'));
  for (const request of [{ ...input, endpoint: {} }, { messages: [{ role: 'user', content: 'x'.repeat(17000) }] }, { get messages() { throw new Error('getter'); } }]) {
    const result = await transport.generate(request); assert.equal(result.why, 'invalid_request'); assert.equal(result.dispatched, false);
  }
  const controller = new AbortController(); controller.abort();
  assert.equal((await transport.generate({ ...input, signal: controller.signal })).why, 'aborted'); assert.equal(transport.state.calls, 0);
});

test('endpoint transport fails closed on status, JSON, content type and response byte cap', async t => {
  const handlers = [
    [(_req, res) => { res.writeHead(401); res.end('secret'); }, 'http_status'],
    [(_req, res) => { res.writeHead(302, { Location: 'https://example.invalid' }); res.end(); }, 'http_status'],
    [(_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); }, 'invalid_json'],
    [(_req, res) => res.end('text'), 'content_type'],
    [(_req, res) => send(res, payload({ choices: [{ index: 0, message: { role: 'assistant', content: 'x'.repeat(270000) }, finish_reason: 'stop' }] })), 'response_too_large'],
  ];
  for (const [handler, why] of handlers) {
    const base = await fake(t, handler), result = await createEndpointOpenAITransport(options(base)).generate(input);
    assert.equal(result.ok, false); assert.equal(result.why, why); assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('endpoint transport enforces total timeout, busy state and uncertainty latch', async t => {
  let calls = 0;
  const base = await fake(t, (_req, res) => { calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
  const transport = createEndpointOpenAITransport({ ...options(base), timeoutMs: 100, maxCalls: 2 });
  const first = transport.generate(input); assert.equal((await transport.generate(input)).why, 'busy');
  const result = await first; assert.equal(result.why, 'timeout'); assert.equal(result.status, 200); assert.equal(result.executionMayContinue, true);
  assert.equal((await transport.generate(input)).why, 'uncertain_blocked'); assert.equal(calls, 1);
});


test('different served model is reported without rejecting usage; invalid header keys fail before dispatch', async t => {
  const base = await fake(t, (_req, res) => send(res, payload({ model: 'other', usage: { prompt_tokens: 8, completion_tokens: 2 } })));
  const result = await createEndpointOpenAITransport(options(base)).generate(input);
  assert.equal(result.ok, true); assert.equal(result.modelMismatch, true); assert.equal(result.servedModel, 'other'); assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 2 });
  const config = options(base); config.endpoint.apiKey = '\u{1f30a}';
  assert.throws(() => createEndpointOpenAITransport(config));
});

test('dated snapshot and open provider metadata return servedModel with modelMismatch false and mind-compatible usage', async t => {
  const base = await fake(t, (_req, res) => send(res, payload({ model: 'm-2024-01-01',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hola', annotations: [], tool_calls: [], function_call: null }, finish_reason: 'eos', native_finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10, prompt_tokens_details: { cached_tokens: 1 }, provider_extra: true } })));
  const result = await createEndpointOpenAITransport(options(base)).generate(input);
  assert.equal(result.ok, true); assert.equal(result.servedModel, 'm-2024-01-01'); assert.equal(result.modelMismatch, false);
  assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 2 });
});

test('endpoint transport fails closed on a non-empty tool_calls or a non-null function_call', async t => {
  for (const extra of [{ tool_calls: [{ id: 't', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { function_call: { name: 'x', arguments: '{}' } }, { tool_calls: {} }]) {
    const base = await fake(t, (_req, res) => send(res, payload({ choices: [{ index: 0,
      message: { role: 'assistant', content: 'No aplicar', ...extra }, finish_reason: 'stop' }] })));
    const result = await createEndpointOpenAITransport(options(base)).generate(input);
    assert.equal(result.ok, false); assert.equal(result.why, 'invalid_response'); assert.equal(result.text, null);
  }
});

test('endpoint transport accepts absent model and nullable content, filters and incomplete finishes safely', async t => {
  for (const [finishReason, why, ok] of [['stop', 'ok', true], ['length', 'truncated', false], ['content_filter', 'content_filter', false], [null, 'incomplete', false]]) {
    const body = payload({ choices: [{ index: 0, message: { role: 'assistant', content: null, annotations: [] }, finish_reason: finishReason }] });
    delete body.model;
    const base = await fake(t, (_req, res) => send(res, body));
    const result = await createEndpointOpenAITransport(options(base)).generate(input);
    assert.equal(result.ok, ok); assert.equal(result.why, why); assert.equal(result.servedModel, null); assert.equal(result.modelMismatch, false);
  }
});

test('endpoint transport preserves output cap and rejects invalid content and finish reason with open records', async t => {
  for (const [body, why] of [
    [payload({ usage: { prompt_tokens: 1, completion_tokens: 257 } }), 'output_limit'],
    [payload({ choices: [{ index: 0, message: { role: 'assistant', content: [] }, finish_reason: 'stop' }] }), 'invalid_response'],
    [payload({ choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'tool_calls' }] }), 'invalid_response'],
  ]) {
    const base = await fake(t, (_req, res) => send(res, body));
    const result = await createEndpointOpenAITransport(options(base)).generate(input);
    assert.equal(result.ok, false); assert.equal(result.why, why);
  }
});
