// IC05b/c: the presence room of tests/companion-presence-gather.test.mjs, with the lanes a body's craft and tool
// hits take in production as options: economic ops, the starter workshop (palm timing) and the torch loot rules.
// The world clock is stopped; only explicit steps move anything.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../../server/index.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../../src/net/companionCreation.js';
import { presenceAnchor, presenceWorkPoint, pointOnRouteReason, PRESENCE_RADIUS } from '../../server/companionPresencePolicy.mjs';

export const OWNER = '22222222-2222-4222-8222-222222222222';
export const PRESENCE = MSG.AGENT_COMPANION_PRESENCE;
export const PRESENCE_RESULT = MSG.AGENT_COMPANION_PRESENCE_RESULT;
const PAIR = MSG.AGENT_COMPANION_PAIR, PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT;
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const turn = () => new Promise(resolve => setImmediate(resolve));
let serial = 0;

export async function until(predicate, timeoutMs = 10000) {
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

const WORKSHOP = { loggingOperations: true, artisanOperations: true, workshopOperations: true };
const TORCH = { ...WORKSHOP, fireOperations: true, freshwaterOperations: true, canteenOperations: true, torchResinCoconutOperations: true };

export async function room(t, { economic = true, lanes = null, seed = 42, world = 'companion-presence-tools' } = {}) {
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
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, maxPlayers: 8,
    worldId: world, saveSecret: 'presence-tools-fixture', log() {}, store,
    economicOperations: economic, resourceOperations: economic,
    ...(lanes === 'workshop' ? WORKSHOP : lanes === 'torch' ? TORCH : {}),
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: true, companionPresenceAllowMemory: true,
    agentControl: { worldId: world, bindings: [] },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER }[token] ?? null),
  });
  const port = await app.listen(), clients = [];
  clearInterval(app.game.timer); app.game.timer = null;
  // Every command a body submits, in order, with the world tick and the logical resource tick of the submission.
  const submitted = [], residentCommand = app.game.residentCommand.bind(app.game);
  app.game.residentCommand = (id, msg) => {
    submitted.push({ id, msg: structuredClone(msg), tick: app.game.server.world.tick,
      resourceTick: app.game.worldState?.resourceTick?.() ?? null });
    return residentCommand(id, msg);
  };
  // Every authoritative outcome the presence service adopted (null is a success), with the task it closed.
  const outcomes = [], service = app.game.companionPresence, outcome = service.outcome.bind(service);
  service.outcome = (e, task, why) => { outcomes.push({ why, craft: task === e.craft, ack: task.ack ?? null }); return outcome(e, task, why); };
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
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Tools QA', skin: 0, weapon: 0, ...(token ? { token } : {}) });
      client.admission = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
    }
    return client;
  } };
}

export async function presence(client, op, expectedRevision, extra = {}) {
  const requestId = `presence-${++serial}`, after = client.messages.length;
  await client.send({ t: PRESENCE, requestId, op, ...(op === 'load' ? {} : { expectedRevision }), ...extra });
  return client.next(m => m.t === PRESENCE_RESULT && m.requestId === requestId, after);
}
export async function request(client, t, result, fields) {
  const requestId = `${t}-${++serial}`, after = client.messages.length;
  await client.send({ t, requestId, ...fields });
  return client.next(m => m.t === result && m.requestId === requestId, after);
}
// Created, resumed (so it can pair) and summoned at the anchor as the owner's body.
export async function summoned(r) {
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
export async function attachMind(r, owner) {
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

// The nearest ready node of one kind whose work point and straight route from the anchor lie inside the zone.
export function zoneNode(world, kind, exclude = []) {
  const anchor = presenceAnchor(world);
  const rows = [...world.resources.nodes.values()].filter(n => n.kind === kind && n.readyTick <= world.tick && !exclude.includes(n.id))
    .map(node => ({ node, distance: Math.hypot(node.x - anchor.x, node.z - anchor.z), point: presenceWorkPoint(world, node, anchor) }))
    .filter(row => row.distance <= PRESENCE_RADIUS && row.point &&
      pointOnRouteReason(world, anchor.x, anchor.z, row.point.x, row.point.z) === null)
    .sort((a, b) => a.distance - b.distance);
  assert.ok(rows.length, `the fixture map has a ${kind} node inside the 30 zone`);
  return rows[0];
}
export const pack = (world, entity, good) => world.profiles.get(entity).eco.pack.goods[good] ?? 0;
// Puts goods into the body's live pack between ticks, as an earlier gather would have.
export function seedPack(world, entity, goods) {
  const profile = world.profiles.get(entity);
  for (const [good, count] of Object.entries(goods)) profile.eco.pack.goods[good] = (profile.eco.pack.goods[good] ?? 0) + count;
  world.profileDirty.add(entity);
}

// One tick at a time; between ticks the body's submission (a microtask) and any economic preparation settle.
export async function run(r, done, max = 3000, between = null) {
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

export async function order(client, entry, op, extra) {
  const loaded = await presence(client, 'load');
  const ordered = await presence(client, op, loaded.presence.revision, extra);
  assert.equal(ordered.ok, true, JSON.stringify(ordered));
  assert.equal(ordered.presence.revision, loaded.presence.revision + 1);
  return ordered;
}
export function ownerSide(r) {
  const session = r.app.game.profiles.accounts.get(OWNER), sock = r.app.game.sockets.get(session.id);
  return { sock, entity: r.app.game.server.clients.get(session.id).entity };
}
// Starts an owner economic op right before the body's submission and holds its commit, so the body meets
// a busy lane; the returned release lets the owner op commit and the world tick again.
export function collide(r, ownerSock, ownerEntity, companion) {
  const game = r.app.game, w = game.server.world;
  let release = () => {};
  r.gate.hold = { match: request => request.account !== companion, promise: new Promise(resolve => { release = resolve; }) };
  game.receive(ownerSock, { t: MSG.CMD, type: 'resource', op: 'craft', opId: `owner-craft-${++serial}`, recipe: 'madera',
    expectedRev: w.profiles.get(ownerEntity).eco.tradeRev });
  assert.equal(game.economicAuthority.busy, true, 'another op is in flight');
  return () => { r.gate.hold = null; release(); };
}
