import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const WORLD = 'companion-pairing-test';
const PAIR = MSG.AGENT_COMPANION_PAIR ?? 'agent_companion_pair';
const PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT ?? 'agent_companion_pair_result';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let serial = 0;

async function until(predicate) {
  // Bounded network observations allow for concurrent world initialization on shared CPUs.
  const end = Date.now() + 15000;
  while (Date.now() < end) { const result = predicate(); if (result) return result; await pause(5); }
  throw new Error('condition timeout');
}

class Wire {
  constructor(url) {
    this.messages = [];
    this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', bytes => this.messages.push(JSON.parse(bytes.toString())));
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  async next(predicate, after = 0) {
    return until(() => this.messages.slice(after).find(predicate));
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

async function room(t, { store = createMemoryStore(), enabled = true, allowMemory = true } = {}) {
  // Memory creation/control stores are intentionally independent. Mirror SQL034's initial
  // SQL027 row here so this fixture exercises the same revision-1 starting state.
  const createCompanion = store.createCompanion;
  const loadCompanionCreation = store.loadCompanionCreation;
  store.loadCompanionCreation = async scope => {
    const record = await loadCompanionCreation(scope);
    if (!record) return record;
    const control = await store.loadCompanionControl({ ...scope, character: record.characterKey });
    return { ...record, control };
  };
  store.createCompanion = async input => {
    const result = await createCompanion(input);
    if (result?.ok && !result.replay) {
      await store.saveCompanionControl({ world: input.world, owner: input.owner,
        character: result.record.characterKey, expectedRevision: 0, stopped: true });
    }
    return result;
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, saveSecret: 'companion-pairing-fixture', log() {}, store,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: allowMemory, companionControlAllowMemory: allowMemory,
    companionPairing: enabled, companionPairingAllowMemory: allowMemory,
    agentControl: { worldId: WORLD, bindings: [] },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER }[token] ?? null),
  });
  const port = await app.listen(), clients = [];
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    clients.forEach(client => client.close());
    await app.close();
  };
  t.after(close);
  return { app, store, close, async connect(token, { hello = true, agent = false } = {}) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.open;
    if (hello) await join(client, token, agent);
    return client;
  } };
}

async function join(client, token, agent = true, content = undefined) {
  const after = client.messages.length;
  await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Pairing QA', skin: 0, weapon: 0,
    ...(token ? { token } : {}), ...(agent ? { agent: true } : {}), ...(content ? { content } : {}) });
  client.admission = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
  return client;
}

async function request(client, op, extra = {}) {
  const requestId = `pair-${++serial}`;
  const after = client.messages.length;
  await client.send({ t: PAIR, requestId, op, ...extra });
  return client.next(m => m.t === PAIR_RESULT && m.requestId === requestId, after);
}

async function ownerOf(app, client, pairLoad = true) {
  const createId = `create-${++serial}`;
  const after = client.messages.length;
  await client.send({ t: MSG.AGENT_COMPANION_CREATE, requestId: createId, op: 'create',
    creationId: `30000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  const created = await client.next(m => m.t === MSG.AGENT_COMPANION_CREATE_RESULT && m.requestId === createId, after);
  if (!created.ok) throw new Error(`created response ${JSON.stringify(created)}`);
  if (pairLoad) {
    const loaded = await request(client, 'load');
    assert.equal(loaded.ok, true);
  }
  return created.record.characterKey;
}

async function controlList(client, op = 'list', companion = null) {
  const requestId = `owner-${++serial}`, after = client.messages.length;
  const payload = companion ? { t: MSG.AGENT_OWNER, requestId, op, characterKey: companion.characterKey,
    epoch: companion.epoch, expectedRevision: companion.control.revision } : { t: MSG.AGENT_OWNER, requestId, op };
  await client.send(payload);
  return client.next(m => m.t === MSG.AGENT_OWNER_RESULT && m.requestId === requestId, after);
}

async function resumeOwner(client, characterKey) {
  const list = await controlList(client), row = list.companions.find(c => c.characterKey === characterKey);
  assert.ok(row, 'registered created companion appears in owner projection');
  const result = await controlList(client, 'resume', row);
  assert.equal(result.ok, true);
  return result.companions.find(c => c.characterKey === characterKey);
}

async function claim(client, code) { return request(client, 'claim', { code }); }

test('pairing status exposes a newly created stopped companion without admitting a controller', async t => {
  const { app, store, connect } = await room(t);
  const owner = await connect('owner'), character = await ownerOf(app, owner, false);
  const scope = { world: WORLD, owner: OWNER, character };
  const initialControl = await store.loadCompanionControl(scope);
  assert.deepEqual((await controlList(owner)).companions, []);

  const loaded = await request(owner, 'load');
  assert.equal(loaded.ok, true);
  assert.equal(loaded.code, null);
  const listed = await controlList(owner);
  assert.equal(listed.companions.length, 1);
  const row = listed.companions[0];
  assert.equal(row.characterKey, character);
  assert.equal(row.online, false);
  assert.equal(row.active, false);
  assert.equal(row.stopped, true);
  assert.equal(row.control.status, 'ready');
  assert.equal(row.control.stopped, true);
  assert.equal(row.control.revision, initialControl.revision);
  assert.deepEqual(row.capabilities, ['chat']);
  assert.deepEqual(await store.loadCompanionControl(scope), initialControl);
  assert.equal(app.game.companionPairing.codes.size, 0);

  assert.equal((await request(owner, 'load')).ok, true);
  assert.equal((await controlList(owner)).companions.length, 1);
  assert.deepEqual(await store.loadCompanionControl(scope), initialControl);
});

test('pairing is account scoped, requires durable resume, and consumes code and bootstrap token once', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), other = await connect('other'), guest = await connect(null);
  const character = await ownerOf(app, owner);
  assert.equal((await request(guest, 'load')).why, 'forbidden');
  assert.equal((await request(other, 'load')).code, null);
  assert.equal((await request(owner, 'issue')).why, 'stopped');

  const resumed = await resumeOwner(owner, character);
  assert.equal(resumed.control.stopped, false);
  const issued = await request(owner, 'issue');
  assert.equal(issued.ok, true); assert.match(issued.code, /^[0-9a-f]{64}$/);
  assert.equal(issued.expiresAtMs - Date.now() > 4 * 60 * 1000, true);

  const controller = await connect(null, { hello: false });
  const bootstrap = await claim(controller, issued.code);
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.bootstrap.scope.ownerId, OWNER);
  assert.equal(bootstrap.bootstrap.scope.characterId, character);
  assert.equal(bootstrap.bootstrap.scope.worldId, WORLD);
  assert.equal(bootstrap.bootstrap.record.characterKey, character);
  assert.equal(bootstrap.bootstrap.content.generation, 0);
  assert.equal(bootstrap.bootstrap.content.revisionId, null);
  assert.match(bootstrap.bootstrap.ownerPeer, /^[0-9a-f-]{36}$/);
  assert.equal(bootstrap.bootstrap.token.startsWith('mncp_'), true);
  assert.equal((await claim(controller, issued.code)).why, 'invalid_code');

  const paired = await join(controller, bootstrap.bootstrap.token);
  assert.equal(paired.admission.t, MSG.WELCOME);
  assert.deepEqual(paired.admission.control.grant.capabilities, ['chat']);
  const replay = await connect(bootstrap.bootstrap.token, { agent: true });
  assert.equal(replay.admission.t, MSG.ERROR);
  assert.equal(app.game.agentControl.byCharacter(character).state, 'active');
  paired.close();
  await until(() => app.game.agentControl.byCharacter(character)?.state === 'revoked');
  assert.equal(app.game.agentControl.byCharacter(character).task, null);
});

test('new code rotates pending code and active controller; owner disconnect invalidates pending code', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), character = await ownerOf(app, owner);
  await resumeOwner(owner, character);
  const first = await request(owner, 'issue');
  const second = await request(owner, 'issue');
  assert.notEqual(first.code, second.code);
  const controller = await connect(null, { hello: false });
  assert.equal((await claim(controller, first.code)).why, 'invalid_code');
  const bootstrap = await claim(controller, second.code);
  const paired = await join(controller, bootstrap.bootstrap.token);
  assert.equal(paired.admission.t, MSG.WELCOME);

  const third = await request(owner, 'issue');
  await until(() => paired.ws.readyState === WebSocket.CLOSED || paired.ws.readyState === WebSocket.CLOSING);
  assert.equal(paired.ws.readyState === WebSocket.CLOSED || paired.ws.readyState === WebSocket.CLOSING, true);
  assert.equal(app.game.agentControl.byCharacter(character).state, 'revoked');
  const ownerSock = app.game.companionPairing.owners.get(OWNER).ownerSock;
  assert.equal(app.game.companionPairing.principal(ownerSock)?.key, OWNER);
  assert.equal(ownerSock.ws.readyState, WebSocket.OPEN);
  const pendingController = await connect(null, { hello: false });
  owner.close();
  await until(() => !app.game.sockets.has(ownerSock.id));
  assert.equal(app.game.companionPairing.codes.has(third.code), false);
  assert.equal((await claim(pendingController, third.code)).why, 'invalid_code');
});

test('expired codes, unauthenticated local claims, disabled pairing, and restart fail closed', async t => {
  let now = Date.now();
  const firstRoom = await room(t), { app, connect } = firstRoom;
  app.game.companionPairing.now = () => now;
  const owner = await connect('owner'), character = await ownerOf(app, owner);
  await resumeOwner(owner, character);
  const issued = await request(owner, 'issue');
  const localRunner = await connect(null, { hello: false });
  assert.equal((await claim(localRunner, issued.code)).ok, true,
    'the one-use pairing code authorizes the local runner without an account token');
  const expiring = await request(owner, 'issue');
  now += 5 * 60 * 1000;
  assert.equal((await claim(localRunner, expiring.code)).why, 'invalid_code');

  const disabled = await room(t, { enabled: false });
  const disabledOwner = await disabled.connect('owner');
  assert.equal((await request(disabledOwner, 'load')).why, 'unavailable');

  // The next host gets the durable creation/control state, but no pairing RAM state.
  const store = firstRoom.store;
  await firstRoom.close();
  const restarted = await room(t, { store });
  const rejoined = await restarted.connect('owner');
  const pair = await restarted.connect(null, { hello: false });
  assert.equal((await claim(pair, issued.code)).why, 'invalid_code');
  const restored = await request(rejoined, 'load');
  assert.equal(restored.ok, true);
  assert.equal((await claim(pair, issued.code)).why, 'invalid_code');
  const loadedOwner = await controlList(rejoined);
  assert.equal(loadedOwner.companions[0].control.stopped, false);
  const fresh = await request(rejoined, 'issue');
  assert.equal(fresh.ok, true);
});

test('durable owner stop invalidates a pending code and active paired session immediately', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), character = await ownerOf(app, owner);
  await resumeOwner(owner, character);
  const pending = await request(owner, 'issue');
  let row = (await controlList(owner)).companions.find(c => c.characterKey === character);
  assert.equal((await controlList(owner, 'stop', row)).ok, true);
  const localRunner = await connect(null, { hello: false });
  assert.equal((await claim(localRunner, pending.code)).why, 'invalid_code');

  await resumeOwner(owner, character);
  const issued = await request(owner, 'issue');
  const bootstrap = await claim(localRunner, issued.code);
  const paired = await join(localRunner, bootstrap.bootstrap.token);
  assert.equal(paired.admission.t, MSG.WELCOME);

  row = (await controlList(owner)).companions.find(c => c.characterKey === character);
  const stopped = await controlList(owner, 'stop', row);
  assert.equal(stopped.ok, true);
  await until(() => app.game.agentControl.byCharacter(character)?.state === 'revoked');
  assert.equal(app.game.agentControl.byCharacter(character).task, null);
  await until(() => paired.ws.readyState === WebSocket.CLOSED || paired.ws.readyState === WebSocket.CLOSING);
  assert.equal(paired.ws.readyState === WebSocket.CLOSED || paired.ws.readyState === WebSocket.CLOSING, true);
});

test('owner disconnect during paired profile I/O prevents late admission and welcome', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), character = await ownerOf(app, owner);
  await resumeOwner(owner, character);
  const issued = await request(owner, 'issue');
  const controller = await connect(null, { hello: false });
  const bootstrap = await claim(controller, issued.code);
  const opened = new Promise(resolve => { controller.profileOpenStarted = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalOpen = app.game.profiles.open.bind(app.game.profiles);
  app.game.profiles.open = async (...args) => {
    if (args[1] === character) { controller.profileOpenStarted(); await gate; }
    return originalOpen(...args);
  };
  const after = controller.messages.length;
  await controller.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: bootstrap.bootstrap.token, agent: true,
    name: 'ignored', skin: 0, weapon: 0, content: bootstrap.bootstrap.content });
  await opened;
  const controllerSock = [...app.game.sockets.values()].find(sock => sock.companionPairCharacter === character);
  assert.ok(controllerSock);

  const ownerSock = app.game.companionPairing.owners.get(OWNER).ownerSock;
  owner.close();
  await until(() => !app.game.sockets.has(ownerSock.id));
  release();
  await until(() => !app.game.sockets.has(controllerSock.id));
  assert.equal(controller.messages.slice(after).some(message => message.t === MSG.WELCOME), false);
  assert.equal(app.game.agentControl.byCharacter(character).state, 'revoked');
  assert.equal(app.game.server.clients.get(controllerSock.id)?.entity, undefined,
    'a profile opened before owner disconnect never becomes a usable character');
});

test('missing durable prerequisites keep pairing unavailable without blocking creation', async t => {
  const { app, connect } = await room(t, { allowMemory: false, enabled: false });
  const owner = await connect('owner');
  assert.equal((await ownerOf(app, owner, false)).length, 36);
  assert.equal((await request(owner, 'load')).why, 'unavailable');
  assert.equal(app.game.healthy(), true);
});

test('issue reports a missing creation and content changes invalidate claims and admitted sessions', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner');
  assert.equal((await request(owner, 'load')).ok, true, 'load without creation is an empty successful lookup');
  assert.equal((await request(owner, 'issue')).why, 'not_created');

  const character = await ownerOf(app, owner);
  await resumeOwner(owner, character);
  const stale = await request(owner, 'issue');
  app.game.contentIdentity = { generation: 1, revisionId: null };
  const localRunner = await connect(null, { hello: false });
  assert.equal((await claim(localRunner, stale.code)).why, 'invalid_code',
    'a claim cannot cross a content generation even when the revision id is null');

  const current = await request(owner, 'issue');
  const bootstrap = await claim(localRunner, current.code);
  const paired = await join(localRunner, bootstrap.bootstrap.token, true, bootstrap.bootstrap.content);
  assert.equal(paired.admission.t, MSG.WELCOME);
  app.game.contentIdentity = { generation: 2, revisionId: 'revision-two' };
  app.game.companionPairing.sweep();
  await until(() => app.game.agentControl.byCharacter(character)?.state === 'revoked');
  await until(() => paired.ws.readyState === WebSocket.CLOSED || paired.ws.readyState === WebSocket.CLOSING);
});
