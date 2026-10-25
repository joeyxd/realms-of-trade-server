import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedInferenceClient } from '../src/client/hostedInference.js';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const state = { available: true, reason: null, endpoints: [], companions: [], limits: { maxEndpoints: 8, maxRunning: 2 } };
function setup(timeoutMs = 8000) {
  let receive, authChange, close, serial = 0;
  const sent = [], transport = { send: message => sent.push(message), onMessage: fn => { receive = fn; }, onClose: fn => { close = fn; } };
  const client = new HostedInferenceClient({ transport, timeoutMs, joined: () => true, makeRequestId: () => `r${++serial}`,
    auth: { subscribe(fn) { authChange = fn; fn({ signedIn: true, accountId }); return () => {}; } } });
  client.setSession(accountId);
  const reply = (message, extra = {}) => receive({ t: 'hosted_inference_result', requestId: message.requestId, op: message.op, ok: true, why: null, state, ...extra });
  return { client, sent, reply, receive: message => receive(message), signout: () => authChange({ signedIn: false }), close: () => close() };
}

test('every operation emits exactly the contract keys and values', () => {
  const f = setup(), endpoint = { id: null, label: 'Cloud', baseUrl: 'https://api.example.com/v1', apiKey: 'private-key', defaultModel: 'small', ignored: 1 };
  try {
    const ops = [
      ['load', () => f.client.load(), {}],
      ['save', () => f.client.save(endpoint), { endpoint: { id: null, label: 'Cloud', baseUrl: endpoint.baseUrl, apiKey: 'private-key', defaultModel: 'small' } }],
      ['delete', () => f.client.remove('e1'), { id: 'e1' }], ['probe', () => f.client.probe('e1'), { id: 'e1' }],
      ['test', () => f.client.test('e1', 'small', 'hello'), { id: 'e1', modelId: 'small', prompt: 'hello' }],
      ['start', () => f.client.start('c1', 'e1', 'small'), { character: 'c1', endpointId: 'e1', modelId: 'small' }],
      ['stop', () => f.client.stop('c1'), { character: 'c1' }],
    ];
    ops.forEach(([op, send, fields], index) => {
      assert.equal(send(), true); assert.deepEqual(f.sent.at(-1), { t: 'hosted_inference', requestId: `r${index + 1}`, op, ...fields });
      assert.equal(send(), false, 'only one pending request per operation');
      assert.ok(!JSON.stringify(f.client.state).includes('private-key')); assert.ok(!JSON.stringify(f.client.snapshot()).includes('private-key'));
      assert.deepEqual(Object.keys(f.client.pending.get(op)).sort(), ['requestId', 'timer']);
      f.reply(f.sent.at(-1));
    });
    f.client.save({ ...endpoint, apiKey: undefined }); assert.equal(Object.hasOwn(f.sent.at(-1).endpoint, 'apiKey'), false); f.reply(f.sent.at(-1));
    const { apiKey, ...withoutKey } = endpoint; f.client.save(withoutKey);
    assert.equal(Object.hasOwn(f.sent.at(-1).endpoint, 'apiKey'), false); f.reply(f.sent.at(-1));
    f.client.save({ ...withoutKey, apiKey: '' }); assert.equal(f.sent.at(-1).endpoint.apiKey, '');
  } finally { f.client.destroy(); }
});

test('only matching results are accepted; status pushes replace state and strip unexpected credentials', () => {
  const f = setup();
  try {
    f.client.load(); const before = f.client.snapshot();
    f.reply({ requestId: 'other', op: 'load' }); assert.deepEqual(f.client.snapshot(), before);
    f.reply(f.sent[0], { op: 'save' }); assert.deepEqual(f.client.snapshot(), before);
    f.reply(f.sent[0]); assert.equal(f.client.snapshot().available, true);
    const endpoint = { id: 'e1', models: [], usage: {}, apiKey: 'should-never-survive' };
    f.receive({ t: 'hosted_inference_result', requestId: null, op: 'status', ok: true, why: null, state: { ...state, endpoints: [endpoint] } });
    assert.equal(f.client.snapshot().endpoints.length, 1); assert.ok(!JSON.stringify(f.client.snapshot()).includes('should-never-survive'));
    f.receive({ t: 'hosted_inference_result', requestId: null, op: 'status', ok: true, why: null, state: { ...state, available: false, reason: 'disabled' } });
    assert.equal(f.client.snapshot().reason, 'disabled'); assert.deepEqual(f.client.snapshot().endpoints, []);
    f.close(); assert.equal(f.client.snapshot().status, 'offline');
    f.signout(); assert.equal(f.client.snapshot().status, 'signed_out');
  } finally { f.client.destroy(); }
});

test('timeouts are uncertain and late replies cannot confirm a result; offline resets pending operations', async () => {
  const f = setup(5);
  try {
    f.client.load(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.client.snapshot().status, 'uncertain'); assert.equal(f.client.snapshot().message, 'uncertain');
    f.reply(f.sent[0]); assert.equal(f.client.snapshot().status, 'uncertain');
    f.client.load(); f.close(); f.reply(f.sent.at(-1));
    assert.equal(f.client.snapshot().status, 'offline'); assert.deepEqual(f.client.snapshot().pendingOps, []);
    assert.equal(f.client.start('c', 'e', 'm'), false);
  } finally { f.client.destroy(); }
});


test('companion memory loop projects valid blocks and nulls invalid or older missing blocks', () => {
  const f = setup(), usage = { calls: 7, maxCalls: 8, inputTokens: 700, outputTokens: 140, summaries: 1, expiresAtMs: 1900000000000 },
    memory = { episodes: 6, summaries: 1, bytes: 2049, maxBytes: 1048576 },
    lastSummary = { ok: false, atMs: 1800000000000, reason: 'context_size', why: 'invalid_decision' };
  const push = row => { f.receive({ t: 'hosted_inference_result', requestId: null, op: 'status', ok: true,
    state: { ...state, companions: [{ character: 'c1', ...row }] } }); return f.client.snapshot().companions[0]; };
  try {
    const valid = { usage, memory, lastSummary, autoSummary: 'blocked' };
    const row = push({ ...valid, apiKey: 'private', usage: { ...usage, apiKey: 'private' } });
    for (const key of Object.keys(valid)) assert.deepEqual(row[key], valid[key]);
    assert.ok(!JSON.stringify(row).includes('private'));
    for (const key of ['usage', 'memory', 'lastSummary', 'autoSummary']) assert.equal(push({})[key], null);
    for (const [block, fields] of [['usage', Object.keys(usage)], ['memory', Object.keys(memory)], ['lastSummary', ['atMs']]]) {
      for (const key of fields) for (const value of [1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, ...(key === 'expiresAtMs' ? [] : [-1])]) {
        assert.equal(push({ ...valid, [block]: { ...valid[block], [key]: value } })[block], null, `${block}.${key}:${value}`);
      }
    }
    assert.equal(push({ ...valid, autoSummary: 'other' }).autoSummary, null);
    assert.equal(push({ ...valid, lastSummary: { ...lastSummary, ok: 'yes' } }).lastSummary, null);
    assert.equal(push({ ...valid, lastSummary: { ...lastSummary, why: null } }).lastSummary, null);
    assert.deepEqual(push({ ...valid, lastSummary: { ...lastSummary, ok: true } }).lastSummary,
      { ok: true, atMs: lastSummary.atMs, reason: 'context_size' });
  } finally { f.client.destroy(); }
});
