import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { presenceAnchor, presencePointAllowed, presenceSafety } from '../server/companionPresencePolicy.mjs';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const WORLD = 'companion-presence-wire';
const PRESENCE = MSG.AGENT_COMPANION_PRESENCE ?? 'agent_companion_presence';
const PRESENCE_RESULT = MSG.AGENT_COMPANION_PRESENCE_RESULT ?? 'agent_companion_presence_result';
const PAIR = MSG.AGENT_COMPANION_PAIR ?? 'agent_companion_pair';
const PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT ?? 'agent_companion_pair_result';
const CREATE = MSG.AGENT_COMPANION_CREATE ?? 'agent_companion_create';
const CREATE_RESULT = MSG.AGENT_COMPANION_CREATE_RESULT ?? 'agent_companion_create_result';
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
    this.ws.on('message', bytes => this.messages.push(JSON.parse(bytes.toString())));
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  async next(predicate, after = 0) { return until(() => this.messages.slice(after).find(predicate)); }
  async close() {
    if (this.ws.readyState >= WebSocket.CLOSING) return;
    const closed = new Promise(resolve => this.ws.once('close', resolve)); this.ws.close(); await closed;
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
    worldId: WORLD, saveSecret: 'presence-fixture', log() {}, store,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: presence, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER }[token] ?? null),
  });
  const port = await app.listen(), clients = [];
  // The suite drives only server.step(); this removes wall-clock-dependent movement.
  clearInterval(app.game.timer); app.game.timer = null;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    clients.forEach(client => client.close().catch(() => {}));
    await app.close();
  };
  t.after(close);
  return { app, store, close, async connect(token, { hello = true } = {}) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.open;
    if (hello) {
      const after = client.messages.length;
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Presence QA', skin: 0, weapon: 0,
        ...(token ? { token } : {}) });
      client.admission = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
    }
    return client;
  } };
}

async function request(client, op, expectedRevision) {
  const requestId = `presence-${++serial}`, after = client.messages.length;
  await client.send({ t: PRESENCE, requestId, op,
    ...(op === 'load' ? {} : { expectedRevision }) });
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
  await client.send({ t: CREATE, requestId, op: 'create',
    creationId: `30000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  const result = await client.next(m => m.t === CREATE_RESULT && m.requestId === requestId, after);
  assert.equal(result.ok, true);
  return result.record.characterKey;
}
async function joinedPresence(owner) {
  const characterKey = await create(owner);
  const loaded = await request(owner, 'load');
  assert.equal(loaded.ok, true);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.presence.characterKey, characterKey);
  return { characterKey, revision: loaded.presence.revision };
}
function bodyFor(app, characterKey) {
  const entry = [...app.game.companionPresence.entries.values()].find(row => row.record.characterKey === characterKey);
  assert.ok(entry, 'the host holds the owner-scoped presence entry');
  assert.ok(entry.body, 'the presence entry has a live body');
  return { entry, entity: entry.body.entity, client: app.game.server.clients.get(entry.body.id) };
}
function step(app, count = 1) { for (let i = 0; i < count; i++) app.game.server.step(); }

test('owner creates a stopped companion, loads, and joins as a normal safe-zone entity', async t => {
  const { app, store, connect } = await room(t);
  const owner = await connect('owner'), { characterKey, revision } = await joinedPresence(owner);
  assert.equal((await store.loadCompanionControl({ world: WORLD, owner: OWNER, character: characterKey })).stopped, true,
    'presence does not resume the local controller or invoke a model');
  const joined = await request(owner, 'join', revision);
  assert.equal(joined.ok, true); assert.equal(joined.presence.status, 'present');
  assert.equal(joined.presence.order, 'wait'); assert.ok(joined.presence.entity > 0);
  const body = bodyFor(app, characterKey);
  assert.equal(body.client.companionResident, true);
  assert.equal(body.client.serverProfile, true);
  assert.equal(app.game.server.humans, 2, 'the companion occupies an ordinary player slot');
  assert.equal(app.game.agentControl.byCharacter(characterKey)?.grant ?? null, null, 'the host body has no controller grant');
  assert.equal(app.game.companionPairing.admitted.size, 0);
  assert.equal((await ownerControl(owner)).companions.find(row => row.characterKey === characterKey).name, 'Brisa');
});

test('wait and follow are direct server orders; no identity or coordinate fields are accepted', async t => {
  const { app, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const wait = await request(owner, 'wait', joined.presence.revision);
  assert.equal(wait.ok, true); assert.equal(wait.presence.order, 'wait');
  const follow = await request(owner, 'follow', wait.presence.revision);
  assert.equal(follow.ok, true); assert.equal(follow.presence.order, 'follow');
  assert.equal(follow.presence.characterKey, characterKey);
  const stale = await request(owner, 'wait', wait.presence.revision);
  assert.equal(stale.why, 'conflict'); assert.equal(stale.presence.order, 'follow');

  for (const extra of [{ characterKey }, { x: 1 }, { coordinates: { x: 1, z: 2 } }]) {
    const requestId = `presence-${++serial}`, after = owner.messages.length;
    await owner.send({ t: PRESENCE, requestId, op: 'wait', expectedRevision: follow.presence.revision, ...extra });
    const result = await owner.next(m => m.t === PRESENCE_RESULT && m.requestId === requestId, after);
    assert.equal(result.why, 'invalid_request');
  }
  assert.equal(bodyFor(app, characterKey).entry.order, 'follow');
});

test('presence is private to the authenticated owner; guests and another account cannot direct it', async t => {
  const { app, connect } = await room(t);
  const owner = await connect('owner'), other = await connect('other'), guest = await connect(null);
  const { characterKey, revision } = await joinedPresence(owner);
  assert.equal((await request(guest, 'load')).why, 'forbidden');
  assert.equal((await request(other, 'load')).why, 'no_companion');
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  assert.equal((await request(other, 'join', joined.presence.revision)).why, 'no_companion');
  assert.equal(other.messages.some(m => m.presence?.characterKey === characterKey), false);
  assert.equal(bodyFor(app, characterKey).entry.body.entity, joined.presence.entity);
});

test('capacity and repeated joins cannot create a second body or consume another slot', async t => {
  const { app, connect } = await room(t, { maxPlayers: 2 }), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const first = await request(owner, 'join', revision); assert.equal(first.ok, true);
  const id = first.presence.entity, humans = app.game.server.humans;
  const second = await request(owner, 'join', first.presence.revision);
  assert.equal(second.why, 'conflict');
  assert.equal(second.presence.entity, id);
  assert.equal(app.game.server.humans, humans);
  assert.equal([...app.game.server.clients.values()].filter(client => client.companionResident).length, 1);
  assert.equal(bodyFor(app, characterKey).entry.body.entity, id);

  const fullRoom = await room(t, { maxPlayers: 1 });
  const fullOwner = await fullRoom.connect('owner'); const ready = await joinedPresence(fullOwner);
  const denied = await request(fullOwner, 'join', ready.revision);
  assert.equal(denied.why, 'full'); assert.equal(denied.presence.entity, null);
  assert.equal(fullRoom.app.game.server.humans, 1);
});

test('hurt and danger deny retirement without healing or despawning the entity', async t => {
  const { app, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const body = bodyFor(app, characterKey), ecs = app.game.server.world.ecs, entity = body.entity;
  const beforeHp = ecs.hp[entity]; ecs.hp[entity] = Math.max(1, beforeHp - 3);
  const hurt = await request(owner, 'retire', joined.presence.revision);
  assert.equal(hurt.why, 'hurt'); assert.equal(ecs.hp[entity], beforeHp - 3);
  assert.equal(app.game.server.clients.get(body.entry.body.id).entity, entity);

  ecs.hp[entity] = ecs.maxHp[entity]; ecs.atkStage[entity] = 1;
  const danger = await request(owner, 'retire', hurt.presence.revision);
  assert.equal(danger.why, 'danger'); assert.equal(ecs.hp[entity], ecs.maxHp[entity]);
  assert.equal(bodyFor(app, characterKey).entity, entity);
  ecs.atkStage[entity] = 0;
});

test('with presence on, a pairing code needs the live body and retirement leaves no code to fence the next admission', async t => {
  // L03g-b replaced the L03g-a exclusion: pairing now authorises a mind for the owner's live body.
  const { app, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const row = (await ownerControl(owner)).companions.find(item => item.characterKey === characterKey);
  assert.ok(row);
  assert.equal((await ownerControl(owner, 'resume', row)).ok, true);
  assert.equal((await pairing(owner, 'issue')).why, 'presence_body_required', 'a resting companion has no body for a mind');
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const issued = await pairing(owner, 'issue'); assert.equal(issued.ok, true, 'the live body accepts a pairing code');

  const retired = await request(owner, 'retire', joined.presence.revision);
  assert.equal(retired.ok, true); assert.equal(retired.presence.status, 'resting');
  assert.equal(app.game.server.humans, 1);
  assert.equal(app.game.companionPairing.codes.size, 0, 'retirement drops the pending code');
  assert.equal(app.game.companionPresence.fencedCharacter(characterKey), false);
  const again = await request(owner, 'join', retired.presence.revision);
  assert.equal(again.ok, true, 'no stale code fences the next host-body admission');
  assert.equal(app.game.server.humans, 2);
});

test('a claimed pairing token for the live body never yields a second admission or a duplicate entity', async t => {
  // L03g-b: the token belongs to the live body, so a concurrent host-body admission is a conflict.
  const { app, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const row = (await ownerControl(owner)).companions.find(item => item.characterKey === characterKey);
  assert.ok(row); assert.equal((await ownerControl(owner, 'resume', row)).ok, true);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const code = await pairing(owner, 'issue'); assert.equal(code.ok, true);
  const runner = await connect(null, { hello: false });
  const claim = await pairing(runner, 'claim', { code: code.code });
  assert.equal(claim.ok, true);
  assert.ok(claim.bootstrap.token.startsWith('mncp_'));

  const denied = await request(owner, 'join', joined.presence.revision);
  assert.equal(denied.why, 'conflict', 'the body is already present');
  assert.equal(denied.presence.entity, joined.presence.entity);
  assert.equal(app.game.server.humans, 2);
  assert.equal([...app.game.server.clients.values()].filter(client => client.entity).length, 2,
    'the unadmitted runner and denied presence operation created no extra gameplay entity');
  assert.equal([...app.game.server.clients.values()].filter(client => client.companionResident).length, 1);
  assert.equal(app.game.companionPresence.entries.get(OWNER).body.entity, joined.presence.entity);
  assert.equal(app.game.companionPairing.tokens.has(claim.bootstrap.token), true,
    'the denial did not consume or invalidate the independent pairing admission');
});

test('delayed join rechecks the owner anchor after profile I/O before creating the companion entity', async t => {
  const { app, store, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const entry = app.game.companionPresence.entries.get(OWNER), started = new Promise(resolve => { entry.profileOpenStarted = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const originalOpen = app.game.profiles.open.bind(app.game.profiles);
  app.game.profiles.open = async (...args) => {
    if (args[1] === characterKey) { entry.profileOpenStarted(); await gate; }
    return originalOpen(...args);
  };
  const requestId = `presence-${++serial}`, after = owner.messages.length;
  await owner.send({ t: PRESENCE, requestId, op: 'join', expectedRevision: revision });
  await started;
  const world = app.game.server.world, anchor = presenceAnchor(world), ownerEntity = app.game.server.clients.get(entry.ownerSock.id).entity;
  const offset = [[5, 0], [0, 5], [-5, 0], [0, -5], [4, 3], [-4, 3]].find(([dx, dz]) =>
    Math.hypot(dx, dz) > 3 && presencePointAllowed(world, anchor.x + dx, anchor.z + dz));
  assert.ok(offset, 'fixture has a valid point outside the immediate arrival anchor');
  world.ecs.x[ownerEntity] = anchor.x + offset[0]; world.ecs.z[ownerEntity] = anchor.z + offset[1];
  assert.equal(presenceSafety(world, ownerEntity, { anchor: true, fullHealth: true }), 'outside_anchor');
  release();
  const result = await owner.next(message => message.t === PRESENCE_RESULT && message.requestId === requestId, after);
  assert.equal(result.why, 'outside_anchor');
  assert.equal(result.presence.entity, null);
  assert.equal(app.game.server.humans, 1);
  assert.equal([...app.game.server.clients.values()].filter(client => client.companionResident).length, 0);
  assert.equal((await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey })).active, false,
    'the rejected delayed join never raises the durable active gate');
});

test('owner disconnect makes the body walk back before healthy auto-retirement', async t => {
  const { app, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const { entry, entity } = bodyFor(app, characterKey), world = app.game.server.world, ecs = world.ecs;
  const anchor = presenceAnchor(world);
  const offset = [[5, 0], [0, 5], [-5, 0], [0, -5], [4, 3], [-4, 3]].find(([dx, dz]) =>
    presencePointAllowed(world, anchor.x + dx, anchor.z + dz));
  assert.ok(offset, 'fixture has a walkable point inside the pilot zone');
  ecs.x[entity] = anchor.x + offset[0]; ecs.z[entity] = anchor.z + offset[1];
  const distanceBefore = Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z);
  await owner.close();
  await until(() => entry.order === 'return');
  step(app, 8);
  assert.ok(Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z) < distanceBefore,
    'departure uses ordinary physical movement toward the anchor');
  assert.ok(entry.body, 'the companion stays present while walking home');
  for (let i = 0; i < 420 && entry.body; i++) { step(app); if (i % 20 === 0) await pause(0); }
  await until(() => entry.body === null && entry.head.active === false, 5000);
  assert.equal(app.game.server.humans, 0);
  assert.equal(entry.head.active, false);
});

test('host restart with a wounded active body requires review and never respawns or heals it', async t => {
  const store = createMemoryStore();
  const first = await room(t, { store }), owner = await first.connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  const { entry, entity } = bodyFor(first.app, characterKey), ecs = first.app.game.server.world.ecs;
  ecs.hp[entity] = Math.max(1, ecs.maxHp[entity] - 7);
  assert.equal(first.app.game.saveProfile(entry.body.id, first.app.game.server.world.profiles.get(entity)), true);
  await first.app.game.profiles.flush();
  const savedProfile = await store.loadProfile(characterKey);
  assert.ok(ecs.hp[entity] < ecs.maxHp[entity], 'the live body is wounded at simulated host loss');
  await first.close();
  const crashedHead = await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey });
  assert.equal(crashedHead.active, true, 'closing an active host retains its durable active latch');

  const restarted = await room(t, { store }), rejoinedOwner = await restarted.connect('owner');
  const originalOpen = restarted.app.game.profiles.open.bind(restarted.app.game.profiles); let reopenedCompanion = 0;
  restarted.app.game.profiles.open = async (...args) => {
    if (args[1] === characterKey) reopenedCompanion++;
    return originalOpen(...args);
  };
  const recovery = await request(rejoinedOwner, 'load');
  assert.equal(recovery.ok, true); assert.equal(recovery.presence.status, 'recovery');
  assert.equal(recovery.presence.reason, 'recovery_required');
  const denied = await request(rejoinedOwner, 'join', recovery.presence.revision);
  assert.equal(denied.why, 'recovery_required'); assert.equal(denied.presence.entity, null);
  assert.equal(restarted.app.game.server.humans, 1, 'only the human owner was spawned');
  const after = await store.loadProfile(characterKey);
  assert.deepEqual(after.data, savedProfile.data, 'recovery does not rewrite the old profile');
  assert.equal(reopenedCompanion, 0, 'recovery never opens or attaches the prior companion profile');
  assert.equal((await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey })).active, true);

  await restarted.close();
  const presenceOff = await room(t, { store, presence: false }), ownerWithOffFlag = await presenceOff.connect('owner');
  const blockedPairing = await pairing(ownerWithOffFlag, 'issue');
  assert.equal(blockedPairing.why, 'busy', 'the durable active gate also fences pairing when the presence feature flag is off');
  assert.equal((await request(ownerWithOffFlag, 'load')).why, 'unavailable');
});

test('the safe-port body earns no passive kill or zone rewards and does not synchronize checkpoints', async t => {
  const { app, store, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const joined = await request(owner, 'join', revision); assert.equal(joined.ok, true);
  await app.game.profiles.flush();
  const w = app.game.server.world, ecs = w.ecs, { entry, entity } = bodyFor(app, characterKey);
  const before = structuredClone(w.profiles.get(entity)), saved = await store.loadProfile(characterKey);
  const ownerEntity = app.game.server.clients.get(app.game.profiles.accounts.get(OWNER).id).entity;
  const ownerXp = ecs.xp[ownerEntity], companionXp = ecs.xp[entity];
  const a = presenceAnchor(w), enemy = w.spawnEnemy('archer', a.x + 6, a.z);
  w.killEnemy(enemy, ownerEntity);
  assert.ok(ecs.xp[ownerEntity] > ownerXp, 'the ordinary nearby player still earns the kill');
  assert.equal(ecs.xp[entity], companionXp);
  assert.equal([...w.drops.values()].some(drop => drop.to === entity), false);
  ecs.cpX[entity] = w.map.checkpoints.aldea.x; ecs.cpZ[entity] = w.map.checkpoints.aldea.z;
  for (let i = 0; i < 120; i++) step(app);
  await app.game.profiles.flush();
  assert.deepEqual(w.profiles.get(entity), before);
  assert.deepEqual(await store.loadProfile(characterKey), saved, 'periodic profile sweeps do not write the resident');
  const head = await request(owner, 'load');
  const retired = await request(owner, 'retire', head.presence.revision);
  assert.equal(retired.ok, true);
  assert.deepEqual((await store.loadProfile(characterKey)).data, before, 'detachment keeps the original checkpoint and needs');
  assert.equal(w.residentPlayers.has(entity), false, 'retired entity slots do not retain the resident marker');
  assert.equal(entry.body, null);
});

test('ambiguous admission timeout never publishes a late body or permits pairing around the gate', async t => {
  const { app, store, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  const presence = app.game.companionPresence; presence.timeoutMs = 20;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const original = store.saveCompanionPresence.bind(store);
  store.saveCompanionPresence = async input => {
    const committed = await original(input);
    if (input.active) { entered(); await waiting; }
    return committed;
  };
  const resultPromise = request(owner, 'join', revision);
  await started;
  const result = await resultPromise;
  assert.equal(result.why, 'unavailable');
  assert.equal(app.game.server.humans, 1);
  assert.equal((await pairing(owner, 'issue')).why, 'presence_body_required'); // L03g-b: no live body, no code.
  release();
  await until(() => presence.busy.size === 0);
  const current = await request(owner, 'load');
  assert.equal(current.presence.status, 'recovery'); assert.equal(current.presence.entity, null);
  assert.equal((await request(owner, 'join', current.presence.revision)).why, 'recovery_required');
  assert.equal(app.game.server.humans, 1);
  assert.equal((await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey })).active, true);
});

test('a failed final resident profile write preserves its exact evidence and fences the host', async t => {
  const { app, store, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner);
  assert.equal((await request(owner, 'join', revision)).ok, true);
  await app.game.profiles.flush();
  const { entry, entity } = bodyFor(app, characterKey), id = entry.body.id;
  const snapshot = structuredClone(app.game.server.world.profiles.get(entity));
  // Force a changed final snapshot at detachment, after the explicit pre-retirement flush.
  const disconnect = app.game.server.disconnect.bind(app.game.server);
  app.game.server.disconnect = clientId => {
    if (clientId === id) {
      const profile = app.game.server.world.profiles.get(entity);
      profile.stats.items++; entry.body && app.game.companionPresence.trackDetach(entry);
      const save = store.saveProfile.bind(store);
      store.saveProfile = async (...args) => { if (args[0] === characterKey) throw new Error('fixture final write'); return save(...args); };
    }
    return disconnect(clientId);
  };
  const current = await request(owner, 'load');
  // The fence closes the owner's socket, so drive the same authenticated service operation directly.
  const task = app.game.companionPresence.retire(entry, () => true);
  assert.equal(await task, 'unavailable');
  assert.equal(app.game.closing, true);
  assert.equal(app.game.unsavedProfiles.get(id).key, characterKey);
  assert.equal(app.game.unsavedProfiles.get(id).data.stats.items, snapshot.stats.items + 1);
  assert.equal((await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey })).active, true);
  assert.equal(current.presence.status, 'present');
  await assert.rejects(app.game.close());
  // The expected fenced shutdown is already asserted; avoid treating it as a teardown failure.
  app.game.closePromise = Promise.resolve();
});

test('an unpublished attachment failure leaves no entity, slot, or profile while retaining the admission gate', async t => {
  const { app, store, connect } = await room(t), owner = await connect('owner');
  const { characterKey, revision } = await joinedPresence(owner), w = app.game.server.world;
  const originalSet = w.profiles.set.bind(w.profiles);
  w.profiles.set = (entity, profile) => {
    if (profile.pirateId === `account:${characterKey}`) throw new Error('fixture attachment failure');
    return originalSet(entity, profile);
  };
  const result = await request(owner, 'join', revision);
  w.profiles.set = originalSet;
  assert.equal(result.why, 'unavailable'); assert.equal(result.presence.entity, null);
  assert.equal(app.game.server.humans, 1);
  assert.equal([...app.game.server.clients.values()].some(c => c.companionResident), false);
  assert.equal(w.residentPlayers.size, 0);
  assert.equal(app.game.profiles.accounts.has(characterKey), false);
  assert.equal((await store.loadCompanionPresence({ world: WORLD, owner: OWNER, character: characterKey })).active, true);
  assert.equal((await pairing(owner, 'issue')).why, 'presence_body_required'); // L03g-b: no live body, no code.
  assert.equal(app.game.healthy(), true, 'ordinary human gameplay remains available after the unpublished cleanup');
});
