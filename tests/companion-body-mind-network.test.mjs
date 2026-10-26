// IC03a (L03g-b): a paired mind attaches to the owner's live presence body instead of spawning one.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION, ENT } from '../src/net/protocol.js';
import { C } from '../src/sim/ecs.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { presenceAnchor, presencePointAllowed } from '../server/companionPresencePolicy.mjs';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const WORLD = 'companion-body-mind';
const PRESENCE = MSG.AGENT_COMPANION_PRESENCE;
const PRESENCE_RESULT = MSG.AGENT_COMPANION_PRESENCE_RESULT;
const PAIR = MSG.AGENT_COMPANION_PAIR;
const PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let serial = 0;

async function until(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await pause(5); }
  throw new Error('condition timeout');
}

class Wire {
  constructor(url) {
    this.messages = []; this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.closed = new Promise(resolve => this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    this.ws.on('message', bytes => this.messages.push(JSON.parse(bytes.toString())));
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  async next(predicate, after = 0) { return until(() => this.messages.slice(after).find(predicate)); }
  async close() {
    if (this.ws.readyState >= WebSocket.CLOSING) return;
    this.ws.close(); await this.closed;
  }
}

async function room(t, { store = createMemoryStore(), maxPlayers = 8, presence = true } = {}) {
  // Seed the control record exactly as durable creation seeds SQL027.
  const createCompanion = store.createCompanion.bind(store);
  const loadCompanionCreation = store.loadCompanionCreation.bind(store);
  store.loadCompanionCreation = async scope => {
    const record = await loadCompanionCreation(scope);
    if (!record) return record;
    const control = await store.loadCompanionControl({ ...scope, character: record.characterKey });
    return { ...record, control };
  };
  store.createCompanion = async input => {
    const result = await createCompanion(input);
    if (result?.ok && !result.replay) await store.saveCompanionControl({ world: input.world, owner: input.owner,
      character: result.record.characterKey, expectedRevision: 0, stopped: true });
    return result;
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers,
    worldId: WORLD, saveSecret: 'body-mind-fixture', log() {}, store,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: presence, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER }[token] ?? null),
  });
  const port = await app.listen(), clients = [];
  // Only explicit server.step() calls move anything in this suite.
  clearInterval(app.game.timer); app.game.timer = null;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    await app.close();
  };
  t.after(close);
  return { app, store, close, async connect(token, { hello = true } = {}) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.open;
    if (hello) {
      const after = client.messages.length;
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Body QA', skin: 0, weapon: 0, ...(token ? { token } : {}) });
      client.admission = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
    }
    return client;
  } };
}

async function presence(client, op, expectedRevision, extra = {}) {
  const requestId = `presence-${++serial}`, after = client.messages.length;
  await client.send({ t: PRESENCE, requestId, op, ...(op === 'load' ? {} : { expectedRevision }), ...extra });
  return client.next(m => m.t === PRESENCE_RESULT && m.requestId === requestId, after);
}
async function pairing(client, op, extra = {}) {
  const requestId = `pair-${++serial}`, after = client.messages.length;
  await client.send({ t: PAIR, requestId, op, ...extra });
  return client.next(m => m.t === PAIR_RESULT && m.requestId === requestId, after);
}
async function ownerControl(client, op = 'list', row = null) {
  const requestId = `owner-${++serial}`, after = client.messages.length;
  await client.send(row ? { t: MSG.AGENT_OWNER, requestId, op, characterKey: row.characterKey,
    epoch: row.epoch, expectedRevision: row.control.revision } : { t: MSG.AGENT_OWNER, requestId, op });
  return client.next(m => m.t === MSG.AGENT_OWNER_RESULT && m.requestId === requestId, after);
}
async function create(client) {
  const requestId = `create-${++serial}`, after = client.messages.length;
  await client.send({ t: MSG.AGENT_COMPANION_CREATE, requestId, op: 'create',
    creationId: `30000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  const result = await client.next(m => m.t === MSG.AGENT_COMPANION_CREATE_RESULT && m.requestId === requestId, after);
  assert.equal(result.ok, true);
  return result.record.characterKey;
}
// Created, loaded and allowed to connect (SQL027 resumed), but not yet in the world.
async function prepared(owner) {
  const characterKey = await create(owner);
  const loaded = await presence(owner, 'load');
  assert.equal(loaded.ok, true); assert.equal(loaded.enabled, true);
  const row = (await ownerControl(owner)).companions.find(item => item.characterKey === characterKey);
  assert.ok(row); assert.equal((await ownerControl(owner, 'resume', row)).ok, true);
  return { characterKey, revision: loaded.presence.revision };
}
async function summon(owner, revision) {
  const joined = await presence(owner, 'join', revision);
  assert.equal(joined.ok, true, JSON.stringify(joined));
  return joined;
}
async function claimed(r, owner) {
  const issued = await pairing(owner, 'issue');
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const runner = await r.connect(null, { hello: false });
  const claim = await pairing(runner, 'claim', { code: issued.code });
  assert.equal(claim.ok, true);
  runner.bootstrap = claim.bootstrap;
  return runner;
}
async function hello(client, token, content) {
  const after = client.messages.length;
  await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, token, agent: true, name: 'ignored', skin: 0, weapon: 0,
    ...(content ? { content } : {}) });
  return client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
}
async function attachMind(r, owner) {
  const runner = await claimed(r, owner);
  runner.welcome = await hello(runner, runner.bootstrap.token, runner.bootstrap.content);
  assert.equal(runner.welcome.t, MSG.WELCOME, JSON.stringify(runner.welcome));
  runner.epoch = runner.welcome.control.grant.controlRevision;
  return runner;
}
function bodyFor(app, characterKey) {
  const entry = [...app.game.companionPresence.entries.values()].find(row => row.record.characterKey === characterKey);
  assert.ok(entry?.body, 'the owner has a live presence body');
  return { entry, entity: entry.body.entity, id: entry.body.id };
}
const mindSocket = app => [...app.game.sockets.values()].find(sock => sock.companionMind);
function aiNames(app) {
  const ecs = app.game.server.world.ecs, names = [];
  for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e] && (ecs.mask[e] & C.PLAYER) && String(ecs.names[e]).includes('[IA]')) names.push(String(ecs.names[e]));
  return names;
}
function step(app, count = 1) { for (let i = 0; i < count; i++) app.game.server.step(); }
function walkableOffset(world) {
  const anchor = presenceAnchor(world);
  const offset = [[5, 0], [0, 5], [-5, 0], [0, -5], [4, 3], [-4, 3]].find(([dx, dz]) =>
    presencePointAllowed(world, anchor.x + dx, anchor.z + dz));
  assert.ok(offset, 'fixture has a walkable point inside the pilot zone');
  return { x: anchor.x + offset[0], z: anchor.z + offset[1] };
}

test('a paired HELLO binds the socket to the live body: no new entity or slot, and self is the body', async t => {
  // Two slots: the owner and the body already fill the room; the mind still attaches.
  const r = await room(t, { maxPlayers: 2 }), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey), humans = r.app.game.server.humans;
  assert.equal(humans, 2);
  assert.equal(aiNames(r.app).length, 1);

  const mind = await attachMind(r, owner);
  assert.equal(mind.welcome.you, body.entity, 'the welcome binds the controller to the body entity');
  assert.deepEqual(mind.welcome.control.grant.capabilities, ['chat', 'presence']);
  assert.equal(mind.welcome.perception.policy, 'server_radius_colliders');
  assert.ok(mind.messages.findIndex(m => m.t === MSG.SPAWN && m.e?.id === body.entity) < mind.messages.indexOf(mind.welcome),
    'the body spawn precedes the welcome, as for an ordinary admission');
  assert.equal(r.app.game.server.humans, humans, 'the world player count does not change');
  assert.equal(aiNames(r.app).length, 1, 'exactly one entity carries the companion [IA] name');
  const sock = mindSocket(r.app);
  assert.equal(r.app.game.server.clients.has(sock.id), false, 'the mind keeps no spectator lane of its own');
  assert.equal(r.app.game.profiles.clients.has(sock.id), false, 'no profile is opened for the mind');
  assert.equal(body.entry.mind.sock, sock);
  assert.equal(r.app.game.status().storage.companionPresence.minds, 1);

  step(r.app, 3);
  const snapshot = await mind.next(m => m.t === MSG.SNAPSHOT);
  assert.equal(snapshot.ents[0][ENT.ID], body.entity, 'the first snapshot is seen from the body');
  assert.ok(Array.isArray(snapshot.you));
  assert.equal(snapshot.perception.radius, 24);
  const listed = (await ownerControl(owner)).companions.find(row => row.characterKey === characterKey);
  assert.equal(listed.online, true, 'the owner list reports the connected mind');
  assert.deepEqual(listed.capabilities, ['chat', 'presence']);
});

test('the mind speaks as the body in local chat and a whisper to the body reaches the mind', async t => {
  const r = await room(t), owner = await r.connect('owner'), other = await r.connect('other');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey);
  const mind = await attachMind(r, owner);
  const peers = await owner.next(m => m.t === MSG.CHAT_STATE && m.peers.some(p => p.entity === body.entity));
  const bodyPeer = peers.peers.find(p => p.entity === body.entity);
  assert.match(bodyPeer.name, /\[IA\]$/);

  const heardAt = other.messages.length;
  await mind.send({ t: MSG.CHAT_SEND, id: 'mind-local-1', channel: 'local', text: 'Hola, capitán.', control: { epoch: mind.epoch } });
  const heard = await other.next(m => m.t === MSG.CHAT_MESSAGE && m.requestId === 'mind-local-1', heardAt);
  assert.deepEqual(heard.sender, { id: bodyPeer.id, entity: body.entity, name: bodyPeer.name },
    'a nearby player hears the body entity and its [IA] name');
  assert.equal(heard.text, 'Hola, capitán.');
  assert.equal((await mind.next(m => m.t === MSG.CHAT_RESULT && m.requestId === 'mind-local-1')).ok, true);

  await owner.send({ t: MSG.CHAT_SEND, id: 'owner-whisper-1', channel: 'whisper', text: 'Sígueme.', target: bodyPeer.id });
  const whisper = await mind.next(m => m.t === MSG.CHAT_MESSAGE && m.requestId === 'owner-whisper-1');
  assert.equal(whisper.channel, 'whisper');
  assert.equal(whisper.target.entity, body.entity);
  assert.equal(whisper.sender.id, peers.self);
  assert.equal(other.messages.some(m => m.requestId === 'owner-whisper-1'), false, 'the whisper stays private');

  const silentAt = owner.messages.length;
  await mind.send({ t: MSG.CHAT_SEND, id: 'mind-no-epoch', channel: 'local', text: 'sin época' });
  await pause(150);
  assert.equal(owner.messages.slice(silentAt).some(m => m.requestId === 'mind-no-epoch'), false,
    'mind chat keeps the paired control-epoch check');
});

test('inputs and agent tasks from the mind are refused; the body moves only through step()', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey), w = r.app.game.server.world, ecs = w.ecs;
  const mind = await attachMind(r, owner);
  const start = { x: ecs.x[body.entity], z: ecs.z[body.entity] };

  let after = mind.messages.length;
  await mind.send({ t: MSG.INPUTS, cmds: [{ seq: 1, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: w.tick, w: 0 }],
    control: { epoch: mind.epoch, taskRevision: 1 } });
  assert.equal((await mind.next(m => m.t === MSG.AGENT_STATE && m.ok === false, after)).why, 'forbidden');
  after = mind.messages.length;
  await mind.send({ t: MSG.AGENT_TASK, epoch: mind.epoch, expectedTaskRevision: 0, actionId: 'move-1', type: 'move',
    args: { mx: 1, mz: 0, durationMs: 1000 }, priority: 'goal' });
  assert.equal((await mind.next(m => m.t === MSG.AGENT_STATE && m.ok === false, after)).why, 'forbidden');
  await mind.send({ t: MSG.CMD, type: 'equip', uid: 1 });
  await pause(50);
  step(r.app, 30);
  assert.equal(ecs.x[body.entity], start.x); assert.equal(ecs.z[body.entity], start.z);
  assert.equal(r.app.game.agentControl.byCharacter(characterKey).task, null);

  // A server order is the only way to move it, and it moves only when the host steps.
  const ownerEntity = r.app.game.server.clients.get(body.entry.ownerSock.id).entity;
  const point = walkableOffset(w);
  ecs.x[ownerEntity] = point.x; ecs.z[ownerEntity] = point.z;
  const load = await presence(mind, 'load');
  assert.equal((await presence(mind, 'follow', load.presence.revision)).ok, true);
  await pause(50);
  assert.equal(ecs.x[body.entity], start.x); assert.equal(ecs.z[body.entity], start.z);
  step(r.app, 10);
  assert.ok(Math.hypot(ecs.x[body.entity] - start.x, ecs.z[body.entity] - start.z) > 0.05, 'step() walks the body');
});

test('the mind gives follow, wait and return with the shared revision CAS; join and retire stay with the owner', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey);
  const mind = await attachMind(r, owner);
  const load = await presence(mind, 'load');
  assert.equal(load.ok, true); assert.equal(load.presence.entity, body.entity); assert.equal(load.presence.characterKey, characterKey);
  const follow = await presence(mind, 'follow', load.presence.revision);
  assert.equal(follow.ok, true); assert.equal(follow.presence.order, 'follow');
  assert.equal(follow.presence.revision, load.presence.revision + 1);
  const stale = await presence(mind, 'wait', load.presence.revision);
  assert.equal(stale.why, 'conflict'); assert.equal(stale.presence.order, 'follow');
  const wait = await presence(mind, 'wait', follow.presence.revision);
  assert.equal(wait.ok, true); assert.equal(wait.presence.order, 'wait');
  const back = await presence(mind, 'return', wait.presence.revision);
  assert.equal(back.ok, true); assert.equal(back.presence.order, 'return');
  assert.equal((await presence(mind, 'join', back.presence.revision)).why, 'forbidden');
  assert.equal((await presence(mind, 'retire', back.presence.revision)).why, 'forbidden');
  assert.equal((await presence(mind, 'wait', back.presence.revision, { characterKey })).why, 'invalid_request');
  assert.ok(body.entry.body, 'the refused retire left the body in the world');
  assert.equal(body.entry.order, 'return');

  // Owner and mind share one order, one revision and the owner's rate limit.
  const seen = await presence(owner, 'load');
  assert.equal(seen.presence.revision, back.presence.revision); assert.equal(seen.presence.order, 'return');
  assert.deepEqual([...r.app.game.companionPresence.rates.keys()], [OWNER]);
  const ownerWait = await presence(owner, 'wait', seen.presence.revision);
  assert.equal(ownerWait.ok, true);
  assert.equal((await presence(mind, 'follow', back.presence.revision)).why, 'conflict');
});

test('closing the mind leaves the body, its order, health and position as they were; a new mind attaches to it', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  const joined = await summon(owner, revision);
  const follow = await presence(owner, 'follow', joined.presence.revision); assert.equal(follow.ok, true);
  const body = bodyFor(r.app, characterKey), w = r.app.game.server.world, ecs = w.ecs;
  const first = await attachMind(r, owner), firstSock = mindSocket(r.app);
  const before = { order: body.entry.order, revision: body.entry.revision, hp: ecs.hp[body.entity],
    x: ecs.x[body.entity], z: ecs.z[body.entity], profile: structuredClone(w.profiles.get(body.entity)) };
  const humans = r.app.game.server.humans;

  await first.close();
  await until(() => !r.app.game.sockets.has(firstSock.id));
  assert.equal(body.entry.mind, null);
  assert.equal(body.entry.body?.entity, body.entity, 'the body stays in the world');
  assert.deepEqual({ order: body.entry.order, revision: body.entry.revision, hp: ecs.hp[body.entity],
    x: ecs.x[body.entity], z: ecs.z[body.entity], profile: w.profiles.get(body.entity) }, before,
  'no heal, teleport, reset or profile change');
  assert.equal(r.app.game.server.humans, humans);
  assert.equal(r.app.game.status().storage.companionPresence.minds, 0);

  const second = await attachMind(r, owner);
  assert.equal(second.welcome.you, body.entity, 'the new mind attaches to the same body');
  assert.equal(r.app.game.server.humans, humans);
  assert.equal(aiNames(r.app).length, 1);
  assert.equal((await presence(second, 'load')).presence.order, 'follow');
});

test('owner retire closes the mind with 1008, drops a pending code, and refuses a HELLO with an old token', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  const joined = await summon(owner, revision);
  const mind = await attachMind(r, owner), mindSock = mindSocket(r.app);
  const retired = await presence(owner, 'retire', joined.presence.revision);
  assert.equal(retired.ok, true, JSON.stringify(retired));
  assert.deepEqual(await mind.closed, { code: 1008, reason: 'pairing revoked' });
  await until(() => !r.app.game.sockets.has(mindSock.id));
  assert.equal(r.app.game.server.humans, 1);

  // A code issued for a live body does not survive its retirement.
  const again = await summon(owner, retired.presence.revision);
  const pending = await pairing(owner, 'issue'); assert.equal(pending.ok, true);
  const retiredAgain = await presence(owner, 'retire', again.presence.revision); assert.equal(retiredAgain.ok, true);
  const late = await r.connect(null, { hello: false });
  assert.equal((await pairing(late, 'claim', { code: pending.code })).why, 'invalid_code');

  // Neither does a claimed, unused token.
  const third = await summon(owner, retiredAgain.presence.revision);
  const runner = await claimed(r, owner);
  assert.equal((await presence(owner, 'retire', third.presence.revision)).ok, true);
  const refused = await hello(runner, runner.bootstrap.token, runner.bootstrap.content);
  assert.equal(refused.t, MSG.ERROR); assert.equal(refused.code, 'auth');
  assert.equal(r.app.game.server.humans, 1);
  assert.equal(aiNames(r.app).length, 0, 'the refused HELLO spawned nothing');
  assert.equal(r.app.game.companionPairing.codes.size + r.app.game.companionPairing.tokens.size, 0);
  assert.equal(characterKey.length, 36);
});

test('owner disconnect closes the mind; the body walks back and auto-retires as before', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const { entry, entity } = bodyFor(r.app, characterKey), w = r.app.game.server.world, ecs = w.ecs;
  const mind = await attachMind(r, owner);
  const point = walkableOffset(w), anchor = presenceAnchor(w);
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  const distanceBefore = Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z);
  await owner.close();
  assert.equal((await mind.closed).code, 1008);
  await until(() => entry.order === 'return' && entry.mind === null);
  step(r.app, 8);
  assert.ok(Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z) < distanceBefore);
  for (let i = 0; i < 420 && entry.body; i++) { step(r.app); if (i % 20 === 0) await pause(0); }
  await until(() => entry.body === null && entry.head.active === false, 5000);
  assert.equal(r.app.game.server.humans, 0);
  assert.equal(r.app.game.companionPresence.minds.size, 0);
});

test('without a live body issue fails with presence_body_required and a token whose body retired spawns nothing', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  const noBody = await pairing(owner, 'issue');
  assert.equal(noBody.ok, false); assert.equal(noBody.why, 'presence_body_required'); assert.equal(noBody.code, null);
  assert.equal(r.app.game.companionPairing.codes.size, 0);

  const joined = await summon(owner, revision);
  const runner = await claimed(r, owner);
  assert.equal((await presence(owner, 'retire', joined.presence.revision)).ok, true);
  const refused = await hello(runner, runner.bootstrap.token, runner.bootstrap.content);
  assert.equal(refused.t, MSG.ERROR);
  assert.equal(r.app.game.server.humans, 1);
  assert.equal(aiNames(r.app).length, 0);
  assert.equal(r.app.game.profiles.accounts.has(characterKey), false, 'no companion profile was opened');
  assert.equal((await pairing(owner, 'issue')).why, 'presence_body_required');
});

test('a second controller for the same body is refused and the first keeps the body', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey);
  const first = await attachMind(r, owner), firstSock = mindSocket(r.app);
  const humans = r.app.game.server.humans;

  const replay = await r.connect(null, { hello: false });
  const replayed = await hello(replay, first.bootstrap.token, first.bootstrap.content);
  assert.equal(replayed.t, MSG.ERROR); assert.equal(replayed.code, 'auth');

  // Even a valid admission (forged here, past the one-code rule) cannot bind a body that has a mind.
  const pairingService = r.app.game.companionPairing, owned = pairingService.owners.get(OWNER);
  const admission = pairingService.admitted.get(firstSock.id), forgedToken = `mncp_${'f'.repeat(64)}`;
  pairingService.tokens.set(forgedToken, { ownerId: OWNER, characterId: characterKey, worldId: admission.worldId,
    ownerSession: owned.ownerSession, ownerSock: owned.ownerSock, record: structuredClone(owned.record),
    content: structuredClone(admission.content), expiresAtMs: admission.expiresAtMs });
  const second = await r.connect(null, { hello: false });
  const forged = await hello(second, forgedToken);
  assert.equal(forged.t, MSG.ERROR); assert.equal(forged.code, 'auth');

  assert.equal(r.app.game.server.humans, humans);
  assert.equal(aiNames(r.app).length, 1);
  assert.equal(body.entry.mind.sock, firstSock);
  assert.equal([...r.app.game.sockets.values()].filter(sock => sock.companionMind).length, 1);
  assert.equal((await presence(first, 'load')).ok, true, 'the first mind still drives its body');

  // The refused sockets keep no admission: closing them revokes nothing.
  await replay.close(); await second.close();
  await until(() => r.app.game.sockets.size === 2);
  assert.equal(body.entry.mind.sock, firstSock);
  assert.equal(first.ws.readyState, WebSocket.OPEN);
  assert.equal(r.app.game.status().storage.companionPresence.minds, 1);
  assert.equal((await presence(first, 'load')).ok, true);
});

test('a world fence and a server close revoke the pairing: the mind closes with 1008', async t => {
  const fenced = await room(t), owner = await fenced.connect('owner');
  const { revision } = await prepared(owner);
  await summon(owner, revision);
  const mind = await attachMind(fenced, owner);
  fenced.app.game.fenceWorld('fixture');
  assert.deepEqual(await mind.closed, { code: 1008, reason: 'pairing revoked' });
  const pairingService = fenced.app.game.companionPairing;
  assert.equal(pairingService.codes.size + pairingService.tokens.size + pairingService.admitted.size, 0);
  assert.equal(fenced.app.game.companionPresence.minds.size, 0);

  const closing = await room(t), host = await closing.connect('owner');
  const ready = await prepared(host);
  await summon(host, ready.revision);
  const runner = await attachMind(closing, host);
  const shutdown = closing.app.close();
  assert.deepEqual(await runner.closed, { code: 1008, reason: 'pairing revoked' });
  await shutdown;
  assert.equal(closing.app.game.companionPairing.codes.size + closing.app.game.companionPairing.tokens.size, 0);
  assert.equal(closing.app.game.companionPresence.minds.size, 0);
});

test('presence orders from a revoked or replaced mind are rejected by the control epoch', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const { entry } = bodyFor(r.app, characterKey);
  const first = await attachMind(r, owner), firstSock = mindSocket(r.app);
  const results = [], sendTo = r.app.game.sendTo.bind(r.app.game);
  r.app.game.sendTo = (id, message) => {
    if (message.t === PRESENCE_RESULT) results.push({ id, message });
    return sendTo(id, message);
  };
  const lateOrder = async (client, sock, requestId, op = 'follow') => {
    await client.send({ t: PRESENCE, requestId, op, expectedRevision: entry.revision });
    return (await until(() => results.find(row => row.id === sock.id && row.message.requestId === requestId))).message;
  };

  // The grant epoch is revoked while the socket is still open (an in-flight order).
  const before = { order: entry.order, revision: entry.revision };
  r.app.game.agentControl.revoke(OWNER, characterKey, 'stop');
  const revoked = await lateOrder(first, firstSock, 'late-after-revoke');
  assert.equal(revoked.ok, false); assert.equal(revoked.why, 'forbidden');
  assert.deepEqual({ order: entry.order, revision: entry.revision }, before);
  assert.equal(first.messages.some(m => m.requestId === 'late-after-revoke'), false,
    'a revoked mind receives no presence view');

  // A new code replaces the mind; the old socket stays open here to model a late message.
  firstSock.ws.close = () => {};
  const second = await attachMind(r, owner), secondSock = mindSocket(r.app);
  assert.notEqual(secondSock, firstSock);
  const replaced = await lateOrder(first, firstSock, 'late-after-replace', 'wait');
  assert.equal(replaced.ok, false); assert.equal(replaced.why, 'forbidden');
  assert.deepEqual({ order: entry.order, revision: entry.revision }, before);
  const current = await presence(second, 'follow', entry.revision);
  assert.equal(current.ok, true); assert.equal(current.presence.order, 'follow');
  firstSock.ws.terminate();
});

// Records every presence result the host sends, keyed by receiving socket id.
function captureResults(app) {
  const results = [], sendTo = app.game.sendTo.bind(app.game);
  app.game.sendTo = (id, message) => {
    if (message.t === PRESENCE_RESULT) results.push({ id, message });
    return sendTo(id, message);
  };
  return results;
}

test('a revoked mind socket that is still closing no longer counts as paired or as a mind', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const { entry } = bodyFor(r.app, characterKey), presenceService = r.app.game.companionPresence;
  const mind = await attachMind(r, owner), sock = mindSocket(r.app);
  const results = captureResults(r.app);
  assert.equal(presenceService.paired(OWNER, characterKey), true, 'the attached mind pairs the character');
  assert.equal(r.app.game.status().storage.companionPresence.minds, 1);

  // Hold the close handshake open: the socket stays in host.sockets after the revoke.
  const realClose = sock.ws.close.bind(sock.ws);
  sock.ws.close = () => {};
  presenceService.revokePairing(entry, 'fixture');
  assert.equal(r.app.game.sockets.get(sock.id), sock, 'the socket has not left yet');
  assert.equal(sock.ws.readyState, WebSocket.OPEN);
  assert.equal(sock.pairingRevoked, true);
  assert.equal(presenceService.paired(OWNER, characterKey), false, 'a revoked socket does not pair the character');
  assert.equal(r.app.game.status().storage.companionPresence.minds, 0);
  assert.equal(presenceService.mindCount(), 0);
  assert.equal(r.app.game.companionPairing.admitted.has(sock.id), false);

  // It keeps being refused until it is gone.
  const before = { order: entry.order, revision: entry.revision };
  await mind.send({ t: PRESENCE, requestId: 'revoked-closing', op: 'follow', expectedRevision: entry.revision });
  const refused = (await until(() => results.find(row => row.id === sock.id && row.message.requestId === 'revoked-closing'))).message;
  assert.equal(refused.ok, false); assert.equal(refused.why, 'forbidden');
  assert.deepEqual({ order: entry.order, revision: entry.revision }, before);

  sock.ws.close = realClose;
  sock.ws.terminate();
  await until(() => !r.app.game.sockets.has(sock.id));
  assert.equal(presenceService.paired(OWNER, characterKey), false);
});

test('a profile failure ends the pairing before the fence: the mind closes with 1008 and the old token is refused', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const body = bodyFor(r.app, characterKey), pairingService = r.app.game.companionPairing;
  const mind = await attachMind(r, owner), sock = mindSocket(r.app);
  const reasons = [], revokeOwner = pairingService.revokeOwner.bind(pairingService);
  pairingService.revokeOwner = (id, why) => { reasons.push(why); return revokeOwner(id, why); };

  assert.equal(r.app.game.companionPresence.profileFailure(body.id), true);
  assert.equal(reasons[0], 'profile', 'the presence revoke runs first, with the profile reason');
  assert.equal(sock.pairingRevoked, true);
  assert.deepEqual(await mind.closed, { code: 1008, reason: 'pairing revoked' });
  assert.equal(pairingService.codes.size + pairingService.tokens.size + pairingService.admitted.size, 0);
  assert.equal(r.app.game.companionPresence.minds.size, 0);
  assert.equal(body.entry.mind, null);

  // A late runner with the old token never gets a welcome: the fenced host refuses the upgrade (503),
  // answers the HELLO with an error, or hangs up.
  let outcome = null;
  try {
    const late = await r.connect(null, { hello: false });
    outcome = await Promise.race([hello(late, mind.bootstrap.token, mind.bootstrap.content), late.closed.then(() => null)]);
  } catch (error) { assert.match(String(error.message), /503/); }
  assert.ok(outcome === null || outcome.t === MSG.ERROR, JSON.stringify(outcome));
  assert.equal(mindSocket(r.app), undefined);
  assert.equal(aiNames(r.app).length, 1, 'the refused runner spawned nothing');
  assert.equal(r.app.game.unsavedProfiles.has(body.id), true, 'the failed profile stays recorded');
  r.app.game.unsavedProfiles.clear(); // The fixture failure is simulated: let the shutdown flush succeed.
});

test('a mind order that passed the dispatch check and is revoked before it executes is refused', async t => {
  const r = await room(t), owner = await r.connect('owner');
  const { characterKey, revision } = await prepared(owner);
  await summon(owner, revision);
  const { entry, entity } = bodyFor(r.app, characterKey), presenceService = r.app.game.companionPresence;
  const ecs = r.app.game.server.world.ecs;
  const mind = await attachMind(r, owner), sock = mindSocket(r.app);
  const results = captureResults(r.app);
  const load = await presence(mind, 'load'); assert.equal(load.ok, true);
  const before = { order: entry.order, revision: entry.revision, x: ecs.x[entity], z: ecs.z[entity] };

  // A mind order awaits nothing in the store: its only gap is the microtask between the dispatch check
  // and the execution recheck. rate() runs inside that gap, so the test revokes from there.
  let passedCheck = false, revokedInGap = false;
  const rate = presenceService.rate.bind(presenceService);
  presenceService.rate = owner => {
    passedCheck = presenceService.mindCurrent(sock);
    sock.ws.close = () => {}; // keep the socket open so the refusal can be observed
    presenceService.revokePairing(entry, 'fixture'); revokedInGap = true;
    presenceService.rate = rate;
    return rate(owner);
  };
  await mind.send({ t: PRESENCE, requestId: 'revoked-in-flight', op: 'follow', expectedRevision: before.revision });
  const refused = (await until(() => results.find(row => row.id === sock.id && row.message.requestId === 'revoked-in-flight'))).message;
  assert.equal(passedCheck, true, 'the order was current when the dispatch check passed');
  assert.equal(revokedInGap, true);
  assert.equal(refused.ok, false); assert.equal(refused.why, 'forbidden');
  assert.deepEqual({ order: entry.order, revision: entry.revision, x: ecs.x[entity], z: ecs.z[entity] }, before,
    'the body order, revision and position are unchanged');
  step(r.app, 5);
  assert.equal(entry.order, before.order);
  sock.ws.terminate();
});

test('flag off keeps L03f: a paired controller is its own chat-only entity and no mind attaches', async t => {
  const r = await room(t, { presence: false }), owner = await r.connect('owner');
  const characterKey = await create(owner);
  assert.equal((await pairing(owner, 'load')).ok, true);
  const row = (await ownerControl(owner)).companions.find(item => item.characterKey === characterKey);
  assert.deepEqual(row.capabilities, ['chat']);
  assert.equal((await ownerControl(owner, 'resume', row)).ok, true);
  assert.equal((await presence(owner, 'load')).why, 'unavailable');
  const runner = await claimed(r, owner);
  const welcome = await hello(runner, runner.bootstrap.token, runner.bootstrap.content);
  assert.equal(welcome.t, MSG.WELCOME);
  assert.deepEqual(welcome.control.grant.capabilities, ['chat']);
  assert.equal(r.app.game.server.humans, 2, 'the L03f controller is a separate player entity');
  assert.equal(aiNames(r.app).length, 1);
  assert.equal(r.app.game.server.clients.get(mindSocketless(r.app)).entity, welcome.you);
  assert.equal(r.app.game.companionPresence.minds.size, 0);
  assert.equal(Object.hasOwn(r.app.game.status().storage.companionPresence, 'minds'), false);
});

function mindSocketless(app) {
  return [...app.game.sockets.values()].find(sock => sock.pairedCompanion && !sock.companionMind).id;
}
