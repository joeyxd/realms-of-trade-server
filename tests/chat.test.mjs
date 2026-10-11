import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createGameServer } from '../server/index.mjs';
import { WsTransport } from '../src/net/wsTransport.js';
import { GameClient } from '../src/client/gameClient.js';
import { map } from './helpers.mjs';

const servers = [];
let nextPeer = 1;

function local(options = {}) {
  const messages = new Map();
  const server = new LocalServer({
    seed: 817,
    bots: 0,
    enemies: false,
    dev: false,
    send: (id, message) => {
      if (!messages.has(id)) messages.set(id, []);
      messages.get(id).push(structuredClone(message));
    },
    ...options,
  });
  const connect = (name = `Sailor ${nextPeer++}`) => {
    const id = nextPeer++;
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '' });
    const state = messages.get(id)?.find((m) => m.t === MSG.CHAT_STATE);
    return { id, entity: server.clients.get(id)?.entity || 0, state };
  };
  const send = (peer, fields) => server.receive(peer.id, { t: MSG.CHAT_SEND, ...fields });
  const of = (peer, type) => (messages.get(peer.id) || []).filter((m) => m.t === type);
  return { server, messages, connect, send, of };
}

function put(server, peer, x, y = 0, z = 0) {
  const ecs = server.world.ecs;
  ecs.x[peer.entity] = x;
  ecs.y[peer.entity] = y;
  ecs.z[peer.entity] = z;
}

function latest(peerHarness, peer, type = MSG.CHAT_RESULT) {
  return peerHarness.of(peer, type).at(-1);
}

test('chat state gives joined peers opaque whisper tokens and excludes spectators', () => {
  const h = local();
  const a = h.connect('A');
  const b = h.connect('B');
  const spectator = { id: nextPeer++ };
  h.server.connect(spectator.id);

  assert.ok(a.state && b.state, 'each admitted player receives chat state');
  assert.notEqual(a.state.self, a.entity, 'self chat identity is not the ECS entity');
  assert.notEqual(b.state.self, b.entity, 'whisper identity is not the ECS entity');
  assert.equal(b.state.peers.some((p) => p.name === 'A' && p.entity === a.entity), true);
  assert.equal(b.state.peers.some((p) => p.name === 'B' && p.id === b.state.self), true, 'peer list includes the current session');
  assert.notEqual(b.state.peers.find((p) => p.name === 'A')?.id, a.entity);
  assert.equal(a.state.peers.some((p) => p.name === 'Spectator'), false);
  assert.equal(a.state.config.localRadius, 24);
});

test('world chat trusts server identity, preserves text literally, and delivers only to joined peers', () => {
  const h = local();
  const a = h.connect('Author');
  const b = h.connect('Reader');
  const spectator = { id: nextPeer++ };
  h.server.connect(spectator.id);
  const before = h.server.world.events.length;
  const text = '<img src=x onerror="alert(1)"> hello';

  h.send(a, { id: 'world-1', channel: 'world', text, sender: { id: 'forged', name: 'Impostor' }, name: 'Impostor' });

  const result = latest(h, a);
  const deliveredA = latest(h, a, MSG.CHAT_MESSAGE);
  const deliveredB = latest(h, b, MSG.CHAT_MESSAGE);
  assert.equal(result.ok, true);
  assert.equal(deliveredA.id, deliveredB.id, 'one message is echoed to sender and peers');
  assert.equal(deliveredA.text, text, 'chat transports plain text without executing or stripping markup');
  assert.equal(deliveredA.sender.name, 'Author');
  assert.equal(deliveredA.sender.entity, a.entity);
  assert.notEqual(deliveredA.sender.id, 'forged');
  assert.equal(h.of(spectator, MSG.CHAT_MESSAGE).length, 0);
  assert.equal(h.server.world.events.length, before, 'chat does not publish through simulation events');
});

test('local chat uses current server x/y/z distance and includes the sender', () => {
  const h = local({ chat: { localRadius: 24 } });
  const a = h.connect('A');
  const near = h.connect('Near');
  const vertical = h.connect('Vertical');
  const far = h.connect('Far');
  put(h.server, a, 0, 0, 0);
  put(h.server, near, 23, 0, 0);
  put(h.server, vertical, 0, 24, 0);
  put(h.server, far, 24.01, 0, 0);

  h.send(a, { id: 'local-1', channel: 'local', text: 'Here' });
  assert.equal(h.of(a, MSG.CHAT_MESSAGE).length, 1);
  assert.equal(h.of(near, MSG.CHAT_MESSAGE).length, 1);
  assert.equal(h.of(vertical, MSG.CHAT_MESSAGE).length, 1, 'the inclusive 3D radius includes the boundary');
  assert.equal(h.of(far, MSG.CHAT_MESSAGE).length, 0);

  put(h.server, near, 80, 0, 0);
  put(h.server, far, 2, 0, 0);
  h.send(a, { id: 'local-2', channel: 'local', text: 'Moved' });
  assert.equal(h.of(near, MSG.CHAT_MESSAGE).length, 1, 'a departed peer stops receiving local chat');
  assert.equal(h.of(far, MSG.CHAT_MESSAGE).length, 1, 'a moved-in peer receives local chat');
});

test('whisper is private to the opaque recipient token and rejects stale tokens', () => {
  const h = local();
  const a = h.connect('A');
  const b = h.connect('B');
  const c = h.connect('C');
  const bToken = b.state.self;
  assert.ok(bToken && bToken !== String(b.entity));

  h.send(a, { id: 'whisper-1', channel: 'whisper', target: bToken, text: 'Private' });
  assert.equal(h.of(a, MSG.CHAT_MESSAGE).length, 1);
  assert.equal(h.of(b, MSG.CHAT_MESSAGE).length, 1);
  assert.equal(h.of(c, MSG.CHAT_MESSAGE).length, 0);

  h.server.disconnect(b.id);
  const replacement = h.connect('Replacement');
  h.send(a, { id: 'whisper-2', channel: 'whisper', target: bToken, text: 'Still private?' });
  assert.equal(latest(h, a).ok, false);
  assert.equal(latest(h, a).code, 'recipient');
  assert.equal(h.of(replacement, MSG.CHAT_MESSAGE).length, 0, 'a recycled entity cannot inherit an old peer token');
});

test('chat request receipts are idempotent per peer and conflicting reuse is rejected', () => {
  const h = local();
  const a = h.connect('A');
  const b = h.connect('B');
  const command = { id: 'retry-1', channel: 'world', text: 'Once' };

  h.send(a, command);
  const first = latest(h, a);
  h.send(a, command);
  const duplicate = latest(h, a);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.messageId, first.messageId);
  assert.equal(h.of(a, MSG.CHAT_MESSAGE).length, 1);
  assert.equal(h.of(b, MSG.CHAT_MESSAGE).length, 1);

  h.send(a, { ...command, text: 'Changed payload' });
  assert.equal(latest(h, a).ok, false);
  assert.equal(latest(h, a).code, 'conflict');
  assert.equal(h.of(b, MSG.CHAT_MESSAGE).length, 1);
});

test('chat validates channel, target and bounded text before delivery', () => {
  const h = local({ chat: { maxLength: 12 } });
  const a = h.connect('A');
  const b = h.connect('B');
  const cases = [
    { id: 'bad-empty', channel: 'world', text: '   ', code: 'invalid' },
    { id: 'bad-long', channel: 'world', text: 'x'.repeat(13), code: 'invalid' },
    { id: 'bad-channel', channel: 'guild', text: 'hello', code: 'channel' },
    { id: 'bad-target-type', channel: 'whisper', target: 123, text: 'hello', code: 'invalid' },
    { id: 'bad-target', channel: 'whisper', target: 'stale-peer-token', text: 'hello', code: 'recipient' },
    { id: 'unexpected-target', channel: 'world', target: 'peer-token', text: 'hello', code: 'invalid' },
  ];
  for (const { code, ...command } of cases) {
    h.send(a, command);
    assert.equal(latest(h, a).ok, false, command.id);
    assert.equal(latest(h, a).code, code, command.id);
  }
  assert.equal(h.of(a, MSG.CHAT_MESSAGE).length, 0);
  assert.equal(h.of(b, MSG.CHAT_MESSAGE).length, 0);
});

test('chat history is bounded per session and state refresh after a newcomer preserves whisper privacy', () => {
  const h = local({ chat: { historyLimit: 2 } });
  const a = h.connect('A');
  const b = h.connect('B');
  const bToken = b.state.self;
  h.send(a, { id: 'history-world-1', channel: 'world', text: 'Public one' });
  h.send(a, { id: 'history-whisper', channel: 'whisper', target: bToken, text: 'Private' });
  h.send(a, { id: 'history-world-2', channel: 'world', text: 'Public two' });
  const c = h.connect('Late joiner');
  const aState = h.of(a, MSG.CHAT_STATE).at(-1);
  const bState = h.of(b, MSG.CHAT_STATE).at(-1);

  assert.equal(aState.history.length, 2);
  assert.deepEqual(aState.history.map((message) => message.text), ['Private', 'Public two']);
  assert.equal(bState.history.length, 2);
  assert.ok(bState.history.some((message) => message.channel === 'whisper'));
  assert.equal(c.state.history.length, 0, 'newcomers do not receive prior session history');
  assert.equal(h.of(c, MSG.CHAT_MESSAGE).length, 0);
});

test('disabled chat returns a result and leaves simulation events untouched', () => {
  const h = local({ chat: { enabled: false } });
  const a = h.connect('A');
  const before = h.server.world.events.length;
  h.send(a, { id: 'disabled-1', channel: 'world', text: 'No delivery' });
  assert.equal(latest(h, a).ok, false);
  assert.equal(latest(h, a).code, 'disabled');
  assert.equal(h.of(a, MSG.CHAT_MESSAGE).length, 0);
  assert.equal(h.server.world.events.length, before);
});

test('chat rejects prejoin requests and applies a per-peer token bucket using injected time', () => {
  let now = 0;
  const h = local({ now: () => now, chat: { burst: 2, refillPerSecond: 1 } });
  const pending = { id: nextPeer++ };
  h.server.connect(pending.id);
  h.server.receive(pending.id, { t: MSG.CHAT_SEND, id: 'prejoin', channel: 'world', text: 'No' });
  assert.equal(h.messages.get(pending.id).find((m) => m.t === MSG.CHAT_RESULT)?.code, 'session');

  const a = h.connect('A');
  const b = h.connect('B');
  for (const id of ['burst-1', 'burst-2']) h.send(a, { id, channel: 'world', text: 'Hi' });
  h.send(a, { id: 'burst-3', channel: 'world', text: 'Too soon' });
  assert.equal(latest(h, a).code, 'rate');
  now = 1000;
  h.send(a, { id: 'after-refill', channel: 'world', text: 'Again' });
  assert.equal(latest(h, a).ok, true);
  assert.equal(h.of(b, MSG.CHAT_MESSAGE).length, 3);
});

test('real WebSocket chat works through WsTransport and GameClient without leaking messages or receipts', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 3, dev: false, log: () => {} });
  const port = await game.listen();
  servers.push(game);
  const clients = [];
  t.after(() => { for (const c of clients) c.transport.close(); });
  const openClient = async (name) => {
    const transport = new WsTransport(`ws://127.0.0.1:${port}/ws`);
    const client = new GameClient(transport, map, { emit() {} });
    const received = [];
    transport.onMessage((message) => received.push(message));
    clients.push({ transport, client, received });
    await transport.opened;
    client.start();
    client.join(name, 0);
    await waitFor(received, (m) => m.t === MSG.WELCOME);
    return clients.at(-1);
  };

  const a = await openClient('Online A');
  const b = await openClient('Online B');
  const c = await openClient('Online C');
  await waitFor(a.received, (m) => m.t === MSG.CHAT_STATE);
  const bState = await waitFor(b.received, (m) => m.t === MSG.CHAT_STATE);
  const cState = await waitFor(c.received, (m) => m.t === MSG.CHAT_STATE);

  a.client.send({ t: MSG.CHAT_SEND, id: 'ws-world', channel: 'world', text: 'All hands' });
  const aWorld = await waitFor(a.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-world');
  const bWorld = await waitFor(b.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-world');
  const cWorld = await waitFor(c.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-world');
  assert.equal(aWorld.id, bWorld.id);
  assert.equal(bWorld.id, cWorld.id);

  a.client.send({ t: MSG.CHAT_SEND, id: 'ws-whisper', channel: 'whisper', target: bState.self, text: 'Only B' });
  await waitFor(a.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-whisper');
  await waitFor(b.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-whisper');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(c.received.some((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-whisper'), false);

  a.client.send({ t: MSG.CHAT_SEND, id: 'ws-retry', channel: 'world', text: 'Once only' });
  const delivered = await waitFor(a.received, (m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-retry');
  const receiptCount = a.received.filter((m) => m.t === MSG.CHAT_RESULT && m.requestId === 'ws-retry').length;
  a.client.send({ t: MSG.CHAT_SEND, id: 'ws-retry', channel: 'world', text: 'Once only' });
  const duplicate = await waitFor(a.received, (m) => m.t === MSG.CHAT_RESULT && m.requestId === 'ws-retry' && m.duplicate === true, 500);
  assert.equal(duplicate.messageId, delivered.id);
  assert.equal(a.received.filter((m) => m.t === MSG.CHAT_MESSAGE && m.requestId === 'ws-retry').length, 1);
  assert.equal(a.received.filter((m) => m.t === MSG.CHAT_RESULT && m.requestId === 'ws-retry').length, receiptCount + 1);
  assert.ok(bState.self && cState.self);
});

function waitFor(messages, predicate, timeout = 3000) {
  const found = messages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const message = messages.find(predicate);
      if (message) { clearInterval(timer); resolve(message); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error('Timed out waiting for chat protocol message')); }
    }, 10);
  });
}

after(async () => { for (const server of servers) await server.close(); });
