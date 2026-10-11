import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLocalProbe } from '../tools/agent/probe-local-openai.mjs';

const MODEL = 'probe-test:1';
const secretReasoning = 'PRIVATE_REASONING_MUST_NOT_BE_IN_REPORT';
const waitText = JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } });
const greetingText = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: '¡Hola! ¿Cómo estás?' } } });

function payload(content, { usage, ...overrides } = {}) {
  return { id: 'response-fixture', model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: secretReasoning }, finish_reason: 'stop' }],
    ...(usage === undefined ? { usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 } } : { usage }),
    ...overrides };
}

async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-local-probe-test-'));
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const reportPath = path.join(directory, 'probe-report.json');
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { server, directory, baseUrl, reportPath };
}

async function readRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function containsKey(value, target) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, target)) return true;
  return Object.values(value).some(child => containsKey(child, target));
}

test('runs wait, unsent greeting proposal, then one final abort with no fourth request', async (t) => {
  const requests = [];
  let thirdAbortResolve;
  const thirdAborted = new Promise(resolve => { thirdAbortResolve = resolve; });
  const f = await fixture(t, async (req, res) => {
    const body = await readRequest(req);
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body });
    if (requests.length === 1) return send(res, payload(waitText));
    if (requests.length === 2) return send(res, payload(greetingText));
    if (requests.length === 3) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders();
      res.once('close', () => { if (!res.writableEnded) thirdAbortResolve(); });
      return;
    }
    res.writeHead(500).end();
  });

  const report = await runLocalProbe({ baseUrl: f.baseUrl, modelId: MODEL, reportPath: f.reportPath });
  await Promise.race([thirdAborted, new Promise((_, reject) => setTimeout(() => reject(new Error('third request was not aborted')), 1000))]);
  assert.equal(report.pass, true);
  assert.equal(report.state, 'passed');
  assert.equal(report.calls, 3);
  assert.deepEqual(report.steps.map(step => step.name), ['decision', 'conversation', 'cancellation']);
  assert.deepEqual(report.steps.slice(0, 2).map(step => step.proposal), [
    { type: 'wait', args: {} }, { type: 'reply', args: { text: '¡Hola! ¿Cómo estás?' } },
  ]);
  assert.equal(report.steps[2].transport.why, 'aborted');
  assert.equal(report.steps[2].transport.executionMayContinue, true);
  assert.equal(report.steps[2].guard.why, 'uncertain_blocked');
  assert.equal(report.transportState.calls, 3);
  assert.equal(report.transportState.inFlight, false);
  assert.equal(report.transportState.uncertain, true);
  assert.equal(report.unknownCalls, 1);
  assert.equal(report.actionsExecuted, 0);
  assert.equal(report.chatsSent, 0);
  assert.equal(report.costNanoUsd, null);
  assert.ok(report.steps.every(step => step.transport.costNanoUsd === null));
  assert.equal(requests.length, 3, 'no retry or fourth request after cancellation');
  assert.ok(requests.every(request => request.method === 'POST' && request.path === '/v1/chat/completions' &&
    request.authorization === undefined));
  assert.ok(requests.every(request => request.body.model === MODEL && request.body.stream === false &&
    request.body.temperature === 0 && request.body.max_tokens === 512));
  assert.equal(JSON.stringify(report).includes(secretReasoning), false);
  assert.equal(containsKey(report, 'reasoning_content'), false);
  assert.deepEqual(JSON.parse(await readFile(f.reportPath, 'utf8')), report);
});

test('an existing report path rejects before any model request', async (t) => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.writeHead(500).end(); });
  const original = 'preserve existing report';
  await writeFile(f.reportPath, original, { flag: 'wx' });
  await assert.rejects(runLocalProbe({ baseUrl: f.baseUrl, modelId: MODEL, reportPath: f.reportPath }), error => error.code === 'EEXIST');
  assert.equal(requests, 0);
  assert.equal(await readFile(f.reportPath, 'utf8'), original);
});

test('a proposed body action fails closed without executing it or making later calls', async (t) => {
  let requests = 0;
  const action = JSON.stringify({ v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 100 } } });
  const f = await fixture(t, async (req, res) => { requests++; await readRequest(req); send(res, payload(action)); });
  const report = await runLocalProbe({ baseUrl: f.baseUrl, modelId: MODEL, reportPath: f.reportPath });
  assert.equal(report.pass, false);
  assert.equal(report.state, 'failed');
  assert.equal(report.calls, 1);
  assert.equal(report.steps.length, 1);
  assert.equal(report.steps[0].pass, false);
  assert.equal(Object.hasOwn(report.steps[0], 'proposal'), false);
  assert.equal(requests, 1);
  assert.equal(report.actionsExecuted, 0);
  assert.equal(report.chatsSent, 0);
  assert.equal(report.costNanoUsd, null);
});

test('a reply with control characters fails validation and skips cancellation', async (t) => {
  let requests = 0;
  const unsafeReply = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Hola\u0001' } } });
  const f = await fixture(t, async (req, res) => {
    await readRequest(req); requests++;
    send(res, payload(requests === 1 ? waitText : unsafeReply));
  });
  const report = await runLocalProbe({ baseUrl: f.baseUrl, modelId: MODEL, reportPath: f.reportPath });
  assert.equal(report.pass, false);
  assert.equal(report.calls, 2);
  assert.deepEqual(report.steps.map(step => step.name), ['decision', 'conversation']);
  assert.equal(report.steps[1].pass, false);
  assert.equal(Object.hasOwn(report.steps[1], 'proposal'), false);
  assert.equal(requests, 2);
  assert.equal(report.actionsExecuted, 0);
  assert.equal(report.chatsSent, 0);
  assert.equal(report.costNanoUsd, null);
});

test('unknown native usage blocks the first response and is never retried', async (t) => {
  let requests = 0;
  const f = await fixture(t, async (req, res) => {
    await readRequest(req); requests++;
    send(res, payload(waitText, { usage: null }));
  });
  const report = await runLocalProbe({ baseUrl: f.baseUrl, modelId: MODEL, reportPath: f.reportPath });
  assert.equal(report.pass, false);
  assert.equal(report.calls, 1);
  assert.equal(report.steps.length, 1);
  assert.equal(report.steps[0].transport.why, 'invalid_usage');
  assert.equal(report.steps[0].transport.usageKnown, false);
  assert.equal(report.transportState.uncertain, true);
  assert.equal(report.unknownCalls, 1);
  assert.equal(requests, 1);
  assert.equal(report.actionsExecuted, 0);
  assert.equal(report.chatsSent, 0);
  assert.equal(report.costNanoUsd, null);
});
