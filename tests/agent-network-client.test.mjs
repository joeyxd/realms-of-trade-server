import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

test('secure network client derives HTTPS Origin from the validated WSS endpoint', () => {
  let transportArgs;
  const transport = { ws: { readyState: 0 }, outbox: [], closed: false,
    onMessage() {}, onSnapshot() {}, onClose() {}, close() { this.closed = true; this.ws.readyState = 3; } };
  const client = new AgentNetworkClient({ url: 'wss://world.example:9443/ws', grant: fixtureGrant(),
    transportFactory: (...args) => { transportArgs = args; return transport; } });
  assert.deepEqual(transportArgs, ['wss://world.example:9443/ws', { origin: 'https://world.example:9443' }]);
  client.close();
  assert.equal(transport.closed, true);
});

// IC03b: a scriptable transport. Messages pushed through `deliver` reach the client like server frames.
function stubTransport() {
  const transport = { ws: { readyState: 1 }, outbox: [], closed: false, sent: [], opened: Promise.resolve(true),
    callbacks: { message: [], snapshot: [], close: [] },
    onMessage(cb) { this.callbacks.message.push(cb); }, onSnapshot(cb) { this.callbacks.snapshot.push(cb); },
    onClose(cb) { this.callbacks.close.push(cb); }, start() {}, sendInput() {}, flush() {},
    send(message) { this.sent.push(structuredClone(message)); },
    deliver(message) { for (const cb of this.callbacks.message) cb(message); },
    close() {
      if (this.closed) return;
      this.closed = true; this.ws.readyState = 3;
      for (const cb of this.callbacks.close) cb({ code: 1008, reason: 'pairing revoked' });
    } };
  return transport;
}
const SCOPE = { ownerId: 'owner-1', characterId: 'companion-1', worldId: 'lab-world', sessionId: 'local-session' };
const grant = (capabilities) => ({ v: 1, scope: SCOPE, controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities });
function presenceReceipt(requestId, overrides = {}) {
  return { t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId, ok: true, why: null, enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'wait', revision: 7, entity: 12, reason: null },
    ...overrides };
}
async function welcomed(t, { requested = ['chat', 'presence'], granted = ['chat', 'presence'], authorization = { token: 'paired-token' },
  presenceTimeoutMs = 10000 } = {}) {
  const transport = stubTransport(), feedback = [];
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: grant(requested), presenceTimeoutMs,
    ...(authorization ? { authorization } : {}), onFeedback: (event) => feedback.push(event), transportFactory: () => transport });
  t.after(() => client.close());
  const before = await client.presence('load');
  const connecting = client.connect({ autoTick: false, timeoutMs: 5000 }).catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.sent[0].t, MSG.HELLO);
  const control = authorization ? { control: { grant: { ...grant(granted), scope: { ...SCOPE, sessionId: 'server-session' } },
    state: 'active', taskRevision: 0, task: null } } : {};
  transport.deliver({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: 12, seed: 42, tick: 1, ...control });
  return { client, transport, feedback, before, connecting };
}

test('IC03b presence requests: exact wire keys, receipt matching and the adopted grant', async (t) => {
  const { client, transport, feedback, before } = await welcomed(t);
  assert.deepEqual(before, { ok: false, why: 'not_connected' }, 'nothing is sent before WELCOME');
  assert.deepEqual(client.grant.capabilities, ['chat', 'presence']);
  assert.equal(client.presenceState, null, 'no body state until a receipt arrives');
  for (const [op, options] of [['join', {}], ['retire', { expectedRevision: 1 }], ['follow', {}], ['follow', { expectedRevision: -1 }],
    ['wait', { expectedRevision: 1.5 }], ['load', { expectedRevision: 1 }], ['return', { expectedRevision: 1, target: 3 }]])
    assert.deepEqual(await client.presence(op, options), { ok: false, why: 'invalid_request' }, `${op} ${JSON.stringify(options)}`);
  assert.equal(transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);

  const load = client.presence('load');
  const request = transport.sent.at(-1);
  assert.deepEqual(Object.keys(request).sort(), ['op', 'requestId', 't']);
  assert.equal(request.t, MSG.AGENT_COMPANION_PRESENCE); assert.match(request.requestId, /^[A-Za-z0-9:_-]{1,100}$/);
  transport.deliver(presenceReceipt('someone-else'));
  transport.deliver(presenceReceipt(request.requestId));
  assert.deepEqual(await load, { ok: true, why: null, enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'wait', revision: 7, entity: 12, reason: null } });
  assert.deepEqual(client.presenceState, { status: 'present', order: 'wait', revision: 7, reason: null });

  const follow = client.presence('follow', { expectedRevision: 7 });
  const order = transport.sent.at(-1);
  assert.deepEqual(Object.keys(order).sort(), ['expectedRevision', 'op', 'requestId', 't']);
  assert.equal(order.expectedRevision, 7); assert.equal(order.control, undefined, 'no control key: the server wants exact keys');
  transport.deliver(presenceReceipt(order.requestId, { ok: false, why: 'conflict',
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'return', revision: 9, entity: 12, reason: null } }));
  assert.deepEqual(await follow, { ok: false, why: 'conflict', enabled: true,
    presence: { characterKey: SCOPE.characterId, name: 'Brisa', status: 'present', order: 'return', revision: 9, entity: 12, reason: null } });
  assert.equal(client.presenceState.revision, 9, 'a conflict receipt carries the current revision');

  const forged = client.presence('wait', { expectedRevision: 9 });
  transport.deliver(presenceReceipt(transport.sent.at(-1).requestId, { presence: { characterKey: 'another-companion', name: 'X',
    status: 'present', order: 'wait', revision: 99, entity: 3, reason: null } }));
  assert.deepEqual(await forged, { ok: false, why: 'invalid_receipt' });
  assert.equal(client.presenceState.revision, 9, 'an invalid receipt is never adopted');
  const reported = feedback.filter((event) => event.type === 'presence').map((event) => [event.data.op, event.data.ok, event.data.why]);
  assert.deepEqual(reported, [['load', true, null], ['follow', false, 'conflict'], ['wait', false, 'invalid_receipt']]);
});

test('IC03b presence requests time out, close with the socket, and need the adopted grant', async (t) => {
  const slow = await welcomed(t, { presenceTimeoutMs: 20 });
  assert.deepEqual(await slow.client.presence('load'), { ok: false, why: 'timeout' });
  const late = slow.transport.sent.at(-1).requestId;
  slow.transport.deliver(presenceReceipt(late));
  assert.equal(slow.client.presenceState, null, 'a receipt after the timeout is ignored');

  const closing = await welcomed(t);
  const pending = closing.client.presence('return', { expectedRevision: 4 });
  closing.transport.close();
  assert.deepEqual(await pending, { ok: false, why: 'closed' });
  assert.deepEqual(await closing.client.presence('load'), { ok: false, why: 'closed' });
  assert.ok(closing.feedback.some((event) => event.type === 'stopped'), 'the close is reported as before');

  const chatOnly = await welcomed(t, { granted: ['chat'] });
  assert.deepEqual(chatOnly.client.grant.capabilities, ['chat'], 'WELCOME adopts the intersection');
  assert.deepEqual(await chatOnly.client.presence('load'), { ok: false, why: 'forbidden' });
  assert.equal(chatOnly.transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);

  const guest = await welcomed(t, { authorization: null });
  assert.deepEqual(guest.client.grant.capabilities, ['chat'], 'a guest connection never holds presence');
  assert.deepEqual(await guest.client.presence('load'), { ok: false, why: 'forbidden' });
  assert.equal(guest.transport.sent.some((m) => m.t === MSG.AGENT_COMPANION_PRESENCE), false);
});
