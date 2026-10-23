// IC05a: the presence body's first world verb. "gather <node>" walks the body to a wood or stone node inside
// the port zone and gathers once through the lane a player's gather takes on the same host.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { RESOURCE_KINDS } from '../src/data/resources.js';
import { TICK_RATE } from '../src/data/tuning.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { presenceAnchor, presenceWorkPoint, pointOnRouteReason, PRESENCE_RADIUS } from '../server/companionPresencePolicy.mjs';

const OWNER = '22222222-2222-4222-8222-222222222222';
const WORLD = 'companion-presence-gather';
const PRESENCE = MSG.AGENT_COMPANION_PRESENCE;
const PRESENCE_RESULT = MSG.AGENT_COMPANION_PRESENCE_RESULT;
const PAIR = MSG.AGENT_COMPANION_PAIR;
const PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const turn = () => new Promise(resolve => setImmediate(resolve));
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

// The room of tests/companion-body-mind-network.test.mjs, with economic resource operations on by default
// (production runs MN_ECONOMIC_OPERATIONS and MN_RESOURCE_OPERATIONS). Only explicit steps move anything.
async function room(t, { economic = true } = {}) {
  const store = createMemoryStore();
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
  // Every durable economic commit, and an optional gate that holds one in flight.
  const commits = [], commit = store.commitEconomicOperation.bind(store);
  const gate = { hold: null };
  store.commitEconomicOperation = async raw => {
    commits.push(structuredClone(raw.request));
    if (gate.hold && gate.hold.match(raw.request)) await gate.hold.promise;
    return commit(raw);
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, saveSecret: 'presence-gather-fixture', log() {}, store,
    economicOperations: economic, resourceOperations: economic,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: true, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER }[token] ?? null),
  });
  const port = await app.listen(), clients = [];
  clearInterval(app.game.timer); app.game.timer = null;
  // Every command a body submits, in order, with the world tick it was submitted at.
  const submitted = [], residentCommand = app.game.residentCommand.bind(app.game);
  app.game.residentCommand = (id, msg) => { submitted.push({ id, msg: structuredClone(msg), tick: app.game.server.world.tick }); return residentCommand(id, msg); };
  // Every authoritative outcome the presence service adopted (null is a successful gather).
  const outcomes = [], service = app.game.companionPresence, outcome = service.outcome.bind(service);
  service.outcome = (e, g, why) => { outcomes.push(why); return outcome(e, g, why); };
  let closed = false;
  t.after(async () => {
    if (closed) return; closed = true;
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    await app.close();
  });
  return { app, store, commits, gate, submitted, outcomes, async connect(token, { hello = true } = {}) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.open;
    if (hello) {
      const after = client.messages.length;
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Gather QA', skin: 0, weapon: 0, ...(token ? { token } : {}) });
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
async function request(client, t, result, fields) {
  const requestId = `${t}-${++serial}`, after = client.messages.length;
  await client.send({ t, requestId, ...fields });
  return client.next(m => m.t === result && m.requestId === requestId, after);
}
// Created, resumed (so it can pair) and summoned at the anchor as the owner's body.
async function summoned(r) {
  const owner = await r.connect('owner');
  const created = await request(owner, MSG.AGENT_COMPANION_CREATE, MSG.AGENT_COMPANION_CREATE_RESULT, { op: 'create',
    creationId: `30000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  assert.equal(created.ok, true);
  const characterKey = created.record.characterKey, loaded = await presence(owner, 'load');
  assert.equal(loaded.ok, true);
  const listed = await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'list' });
  const row = listed.companions.find(item => item.characterKey === characterKey);
  assert.equal((await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'resume', characterKey,
    epoch: row.epoch, expectedRevision: row.control.revision })).ok, true);
  const joined = await presence(owner, 'join', loaded.presence.revision);
  assert.equal(joined.ok, true, JSON.stringify(joined));
  const entry = [...r.app.game.companionPresence.entries.values()].find(item => item.record.characterKey === characterKey);
  assert.ok(entry?.body);
  return { owner, characterKey, entry, entity: entry.body.entity };
}
async function attachMind(r, owner) {
  const issued = await request(owner, PAIR, PAIR_RESULT, { op: 'issue' });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const runner = await r.connect(null, { hello: false });
  const claim = await request(runner, PAIR, PAIR_RESULT, { op: 'claim', code: issued.code });
  assert.equal(claim.ok, true);
  const after = runner.messages.length;
  await runner.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: claim.bootstrap.token, agent: true, name: 'ignored', skin: 0, weapon: 0,
    content: claim.bootstrap.content });
  runner.welcome = await runner.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
  assert.equal(runner.welcome.t, MSG.WELCOME, JSON.stringify(runner.welcome));
  return runner;
}

// Found by script on the fixture map (seed 42): the nearest ready wood or stone node beyond the old 12-unit
// zone whose work point and straight route from the anchor lie inside the 30-unit zone.
function zoneNode(world) {
  const anchor = presenceAnchor(world);
  const rows = [...world.resources.nodes.values()].filter(n => ['wood', 'stone'].includes(n.kind) && n.readyTick <= world.tick)
    .map(node => ({ node, distance: Math.hypot(node.x - anchor.x, node.z - anchor.z), point: presenceWorkPoint(world, node, anchor) }))
    .filter(row => row.distance > 12 && row.distance <= PRESENCE_RADIUS && row.point &&
      pointOnRouteReason(world, anchor.x, anchor.z, row.point.x, row.point.z) === null)
    .sort((a, b) => a.distance - b.distance);
  assert.ok(rows.length, 'the fixture map has a wood or stone node inside the 30 zone');
  return rows[0];
}
const pack = (world, entity, good) => world.profiles.get(entity).eco.pack.goods[good] ?? 0;

// One tick at a time; between ticks the body's submission (a microtask) and any economic preparation settle.
async function run(r, done, max = 1500, between = null) {
  const game = r.app.game;
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    game.server.step();
    if (between) between();
    await turn();
    if (done()) return i + 1;
    await game.economicAuthority?.settle();
  }
  assert.fail('the presence body did not reach the expected state');
}

async function gatherOrder(client, entry, node) {
  const loaded = await presence(client, 'load');
  const ordered = await presence(client, 'gather', loaded.presence.revision, { node });
  assert.equal(ordered.ok, true, JSON.stringify(ordered));
  assert.equal(ordered.presence.order, 'gather');
  assert.equal(ordered.presence.revision, loaded.presence.revision + 1);
  assert.equal(entry.order, 'gather');
  return ordered;
}

test('(a) owner gather: the body walks, gathers once through the economic lane and the yield lands in its own pack', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, characterKey, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, ecs = w.ecs, { node, distance } = zoneNode(w);
  assert.ok(distance > 12 && distance <= 30, `node ${node.id} at ${distance.toFixed(2)} from the anchor`);
  const good = RESOURCE_KINDS[node.kind].good, before = pack(w, entity, good), rev = node.rev;
  const durable = () => game.worldState.resources.nodes.find(row => row.id === node.id);
  assert.equal(durable().rev, rev);
  const commitsBefore = r.commits.length;
  await gatherOrder(owner, entry, node.id);
  const ticks = await run(r, () => entry.order === 'wait');
  assert.ok(ticks > 60, 'the body walked there');
  assert.equal(entry.reason, 'gathered');
  assert.ok(Math.hypot(ecs.x[entity] - node.x, ecs.z[entity] - node.z) <= 2, 'stopped within 2 of the node');
  assert.equal(r.submitted.length, 1, 'exactly one gather submitted');
  assert.deepEqual(r.outcomes, [null], 'one authoritative success');
  assert.deepEqual(Object.keys(r.submitted[0].msg).sort(), ['expectedRev', 'node', 'op', 'opId', 't', 'type']);
  assert.equal(r.submitted[0].msg.expectedRev, rev);
  assert.equal(pack(w, entity, good), before + 1, 'the yield lands once in the body pack');
  assert.equal(node.rev, rev + 1); assert.ok(node.readyTick > w.tick);
  // The durable path: one CAS commit for the companion account carried the node and the pack together.
  const own = r.commits.slice(commitsBefore).filter(request => request.account === characterKey);
  assert.equal(own.length, 1);
  assert.equal(own[0].command.op, 'gather'); assert.equal(own[0].command.node, node.id);
  assert.equal(own[0].profile.eco.pack.goods[good], before + 1);
  assert.equal(durable().rev, rev + 1); assert.ok(durable().readyAt > 0);
  assert.equal((await r.store.loadProfile(characterKey)).data.eco.pack.goods[good], before + 1);
  const head = await presence(owner, 'load');
  assert.deepEqual([head.presence.order, head.presence.reason], ['wait', 'gathered']);
  for (let i = 0; i < 30; i++) game.server.step();
  assert.equal(entry.reason, 'gathered', 'an outcome reason stays until the next order');
});

test('(b) the attached mind may order gather and it ends the same way', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w), good = RESOURCE_KINDS[node.kind].good, before = pack(w, entity, good);
  const mind = await attachMind(r, owner);
  await gatherOrder(mind, entry, node.id);
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  assert.equal(pack(w, entity, good), before + 1);
  assert.equal(r.submitted.length, 1);
});

test('(c) refusals: no_node, no_tool, outside_zone, invalid_request and conflict change nothing', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, entry } = await summoned(r);
  const w = r.app.game.server.world, anchor = presenceAnchor(w), nodes = [...w.resources.nodes.values()];
  const loaded = await presence(owner, 'load'), revision = loaded.presence.revision;
  const refuse = async (why, op, expected, extra) => {
    const result = await presence(owner, op, expected, extra);
    assert.deepEqual([result.ok, result.why], [false, why], JSON.stringify(extra));
    assert.deepEqual([result.presence.order, result.presence.revision], ['wait', revision]);
  };
  await refuse('no_node', 'gather', revision, { node: 'no-such-node' });
  await refuse('no_node', 'gather', revision, { node: 'coast:1' });
  // IC05b/c: a palm is a tool node now; without an axe the body refuses it before walking (was unsupported_node).
  const palm = nodes.find(n => n.kind === 'palm');
  assert.ok(palm);
  await refuse('no_tool', 'gather', revision, { node: palm.id });
  // A node with no standing point inside the zone, and one whose straight route leaves the footprint.
  const far = nodes.find(n => ['wood', 'stone'].includes(n.kind) && Math.hypot(n.x - anchor.x, n.z - anchor.z) > PRESENCE_RADIUS + 2);
  assert.ok(far && !presenceWorkPoint(w, far, anchor));
  await refuse('outside_zone', 'gather', revision, { node: far.id });
  const crossing = nodes.find(n => ['wood', 'stone'].includes(n.kind) && presenceWorkPoint(w, n, anchor) &&
    pointOnRouteReason(w, anchor.x, anchor.z, presenceWorkPoint(w, n, anchor).x, presenceWorkPoint(w, n, anchor).z) === 'outside_zone');
  assert.ok(crossing, 'the fixture has a node whose straight route leaves the zone');
  await refuse('outside_zone', 'gather', revision, { node: crossing.id });
  const { node } = zoneNode(w);
  await refuse('invalid_request', 'gather', revision, {});
  await refuse('invalid_request', 'gather', revision, { node: node.id, extra: 1 });
  await refuse('invalid_request', 'gather', revision, { node: 'bad id' });
  await refuse('invalid_request', 'gather', revision, { node: 'x'.repeat(65) });
  await refuse('invalid_request', 'gather', revision, { node: 7 });
  await refuse('invalid_request', 'follow', revision, { node: node.id });
  await refuse('conflict', 'gather', revision + 1, { node: node.id });
  assert.equal(entry.order, 'wait');
  assert.equal(r.submitted.length, 0, 'no refusal reaches the economic lane');
});

test('(d) a second gather on the now depleted node refuses depleted', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, entry } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w);
  await gatherOrder(owner, entry, node.id);
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  const loaded = await presence(owner, 'load');
  const again = await presence(owner, 'gather', loaded.presence.revision, { node: node.id });
  assert.deepEqual([again.ok, again.why], [false, 'depleted']);
  assert.deepEqual([again.presence.order, again.presence.revision], ['wait', loaded.presence.revision]);
  assert.equal(r.submitted.length, 1);
});

// Starts an owner economic op right before the body's submission and holds its commit, so the body meets
// a busy lane; release() lets the owner op commit and the world tick again.
function collide(r, ownerSock, ownerEntity, companion) {
  const game = r.app.game, w = game.server.world;
  let release = () => {};
  r.gate.hold = { match: request => request.account !== companion, promise: new Promise(resolve => { release = resolve; }) };
  game.receive(ownerSock, { t: MSG.CMD, type: 'resource', op: 'craft', opId: `owner-craft-${++serial}`, recipe: 'madera',
    expectedRev: w.profiles.get(ownerEntity).eco.tradeRev });
  assert.equal(game.economicAuthority.busy, true, 'another op is in flight');
  return () => { r.gate.hold = null; release(); };
}
function ownerSide(r) {
  const session = r.app.game.profiles.accounts.get(OWNER), sock = r.app.game.sockets.get(session.id);
  return { sock, entity: r.app.game.server.clients.get(session.id).entity };
}

test('(e) a busy economic lane is retried at least 1 s later, then gathers', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, characterKey, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w), good = RESOURCE_KINDS[node.kind].good, before = pack(w, entity, good);
  const { sock, entity: ownerEntity } = ownerSide(r);
  await gatherOrder(owner, entry, node.id);
  let release = null;
  await run(r, () => release !== null, 1500, () => { if (entry.gather.opId && !release) release = collide(r, sock, ownerEntity, characterKey); });
  await turn();
  assert.equal(r.submitted.length, 1);
  assert.equal(entry.order, 'gather', 'busy is retried, not final');
  assert.equal(entry.gather.tries, 1);
  release();
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  assert.equal(r.submitted.length, 2);
  assert.deepEqual(r.outcomes, ['busy', null], 'the lane answered busy, then the retry gathered');
  assert.ok(r.submitted[1].tick - r.submitted[0].tick >= TICK_RATE, 'the retry waits at least 1 s of ticks');
  assert.notEqual(r.submitted[1].msg.opId, r.submitted[0].msg.opId);
  assert.equal(pack(w, entity, good), before + 1, 'still exactly one yield');
});

test('(e) four busy lanes in a row end the order as wait with reason busy', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, characterKey, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w), good = RESOURCE_KINDS[node.kind].good, before = pack(w, entity, good);
  const { sock, entity: ownerEntity } = ownerSide(r), rev = node.rev;
  const ordered = await gatherOrder(owner, entry, node.id);
  let release = null;
  await run(r, () => entry.order === 'wait', 3000, () => {
    if (!entry.gather.opId || release) return;
    release = collide(r, sock, ownerEntity, characterKey);
    void turn().then(() => { const done = release; release = null; done(); });
  });
  assert.equal(entry.reason, 'busy');
  assert.equal(r.submitted.length, 4, 'one attempt and three retries');
  assert.deepEqual(r.outcomes, ['busy', 'busy', 'busy', 'busy']);
  for (let i = 1; i < 4; i++) assert.ok(r.submitted[i].tick - r.submitted[i - 1].tick >= TICK_RATE);
  assert.equal(pack(w, entity, good), before, 'nothing was gathered');
  assert.equal(node.rev, rev, 'the node is untouched');
  assert.equal(entry.revision, ordered.presence.revision + 1, 'one server-driven order change');
});

test('(f) danger during the walk stops the body like follow, then the gather resumes', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, ecs = w.ecs, anchor = presenceAnchor(w), { node } = zoneNode(w);
  await gatherOrder(owner, entry, node.id);
  await run(r, () => Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z) > 3);
  // Inside the 24 danger radius of both bodies, beyond the archer's aggro, on the far side of the anchor.
  const dx = (anchor.x - ecs.x[entity]), dz = (anchor.z - ecs.z[entity]), d = Math.hypot(dx, dz);
  const enemy = w.spawnEnemy('archer', anchor.x + dx / d * 18, anchor.z + dz / d * 18);
  const at = { x: ecs.x[entity], z: ecs.z[entity] };
  for (let i = 0; i < 20; i++) { game.server.step(); await turn(); }
  assert.deepEqual([entry.order, entry.reason], ['gather', 'danger']);
  assert.deepEqual({ x: ecs.x[entity], z: ecs.z[entity] }, at, 'the body holds still');
  assert.equal(ecs.moveMag[entity], 0);
  assert.equal(ecs.hp[entity], ecs.maxHp[entity]);
  assert.equal(r.submitted.length, 0);
  const head = await presence(owner, 'load');
  assert.deepEqual([head.presence.order, head.presence.reason], ['gather', 'danger']);
  w.killEnemy(enemy, ownerSide(r).entity);
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  assert.equal(r.submitted.length, 1);
});

test('(g) with economic resource operations off the direct resourceCmd path gathers too', { timeout: 60000 }, async t => {
  const r = await room(t, { economic: false }), { owner, entry, entity } = await summoned(r);
  const game = r.app.game, w = game.server.world, { node } = zoneNode(w), good = RESOURCE_KINDS[node.kind].good;
  assert.equal(game.resourceOperations, false); assert.equal(game.economicAuthority, null);
  const before = pack(w, entity, good), rev = node.rev;
  await gatherOrder(owner, entry, node.id);
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  assert.equal(r.submitted.length, 1);
  assert.equal(pack(w, entity, good), before + 1);
  assert.equal(node.rev, rev + 1); assert.ok(node.readyTick > w.tick);
  assert.equal(r.commits.length, 0, 'no economic commit exists on this host');
});

test('(h) D6: nothing of the body gather reaches the attached mind and its next presence op answers', { timeout: 60000 }, async t => {
  const r = await room(t), { owner, entry, entity } = await summoned(r);
  const w = r.app.game.server.world, { node } = zoneNode(w), good = RESOURCE_KINDS[node.kind].good, before = pack(w, entity, good);
  const mind = await attachMind(r, owner);
  const after = mind.messages.length;
  await gatherOrder(mind, entry, node.id);
  await run(r, () => entry.order === 'wait');
  assert.equal(entry.reason, 'gathered');
  assert.equal(pack(w, entity, good), before + 1);
  await pause(50);
  const seen = mind.messages.slice(after);
  assert.equal(seen.some(m => m.t === MSG.PROFILE || m.t === MSG.SAVE), false, 'no profile or save reaches the mind');
  assert.equal(seen.some(m => m.t === MSG.EVENT && ['resource', 'resourceHit', 'commandDenied'].includes(m.ev?.type)), false);
  assert.equal(mind.ws.readyState, WebSocket.OPEN);
  const head = await presence(mind, 'load');
  assert.equal(head.ok, true);
  assert.deepEqual([head.presence.order, head.presence.reason], ['wait', 'gathered']);
  const waited = await presence(mind, 'wait', head.presence.revision);
  assert.equal(waited.ok, true, JSON.stringify(waited));
  assert.equal(waited.presence.reason, null);
});
