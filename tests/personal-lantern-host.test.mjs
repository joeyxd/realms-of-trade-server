import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { killPlayer } from '../src/sim/systems/combat.js';
import { ENT, MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORLD = 'personal-lantern-host-test';
const copy = (value) => structuredClone(value);

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

function connect(host, name) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name })), false);
  return { id, ws };
}

function profile(account) {
  const value = newProfile();
  value.pirateId = `account:${account}`;
  return value;
}

function makeHost(store) {
  return new GameHost({ seed: 82, bots: 0, log: () => {}, store, saves: hmacSaves('personal-lantern-host-test'),
    resolvePlayer: async (_request, message) => message.name === 'Alpha' ? ALPHA : message.name === 'Beta' ? BETA : null,
    initializeAccounts: true, worldId: WORLD });
}

async function openHost(t, store) {
  const host = makeHost(store);
  t.after(async () => { if (!host.closePromise) await host.close().catch(() => {}); });
  await host.prepare();
  const alpha = connect(host, 'Alpha'), beta = connect(host, 'Beta');
  await Promise.all([...host.joins]);
  await host.profiles.flush();
  return { host, alpha, beta,
    alphaEntity: host.server.clients.get(alpha.id).entity,
    betaEntity: host.server.clients.get(beta.id).entity };
}

function personalCommand(lit, opId) { return { t: 'cmd', type: 'personalLantern', lit, opId }; }
function events(socket, type, opId) {
  return socket.messages.flatMap((message) => message.ev ? [message.ev] : [])
    .filter((event) => event.type === type && (!opId || event.opId === opId));
}
function snapshot(socket) { return [...socket.messages].reverse().find((message) => message.t === MSG.SNAPSHOT); }

test('personal lantern host gates lifecycle and access before receipts, then broadcasts only the changed flag', async (t) => {
  const store = { ...createMemoryStore(), durable: true };
  await store.initializeProfile(ALPHA, profile(ALPHA)); await store.initializeProfile(BETA, profile(BETA));
  const { host, alpha, beta, alphaEntity, betaEntity } = await openHost(t, store);
  const server = host.server, world = server.world, alphaConn = server.clients.get(alpha.id);
  const beforeProfile = copy(world.profiles.get(alphaEntity)), saveAt = alphaConn.saveAt;
  const dirty = [...world.profileDirty], receipts = world.personalLanternReceipts;
  const calls = [];
  server.commandAccess = (...args) => { calls.push(args); return false; };
  alphaConn.paused = true;
  assert.equal(server.playerCommand(alphaConn, personalCommand(true, 'paused')), false);
  alphaConn.paused = false;
  server.tickBlocked = true;
  assert.equal(server.playerCommand(alphaConn, personalCommand(true, 'tick-blocked')), false);
  server.tickBlocked = false;
  assert.equal(server.playerCommand(alphaConn, personalCommand(true, 'denied')), false);
  assert.deepEqual(calls.map(([, entity, plan]) => [entity, plan]), [[alphaEntity, { world: true, target: null }]]);
  assert.equal(world.ecs.lantern[alphaEntity], 0);
  assert.equal(world.personalLanternReceipts, receipts, 'preflight denial allocates no receipt map');
  assert.deepEqual([...world.profileDirty], dirty);
  assert.equal(alphaConn.saveAt, saveAt);
  assert.deepEqual(world.profiles.get(alphaEntity), beforeProfile);
  assert.deepEqual(events(alpha.ws, 'personalLantern'), []);

  server.commandAccess = () => true;
  assert.equal(server.playerCommand(alphaConn, personalCommand(true, 'switch-on')), true);
  server.flushEvents();
  const ack = events(alpha.ws, 'personalLantern', 'switch-on').at(-1);
  assert.deepEqual({ to: ack?.to, ok: ack?.ok, lit: ack?.lit, changed: ack?.changed },
    { to: alphaEntity, ok: true, lit: true, changed: true });
  assert.deepEqual(events(beta.ws, 'personalLantern', 'switch-on'), [], 'only the initiating connection receives the ACK');
  assert.equal(snapshot(alpha.ws)?.ents.find((tuple) => tuple[ENT.ID] === alphaEntity)?.[ENT.LANTERN], 1);
  assert.equal(snapshot(beta.ws)?.ents.find((tuple) => tuple[ENT.ID] === alphaEntity)?.[ENT.LANTERN], 1,
    'the changed light is public snapshot state');

  assert.equal(server.playerCommand(alphaConn, personalCommand(true, 'switch-on')), true);
  server.flushEvents();
  const replay = events(alpha.ws, 'personalLantern', 'switch-on').at(-1);
  assert.equal(replay.replay, true); assert.equal(replay.changed, false);
  assert.equal(server.playerCommand(alphaConn, personalCommand(false, 'switch-on')), false,
    'reusing an opId for a different payload is rejected');
  server.flushEvents();
  assert.equal(events(alpha.ws, 'personalLantern', 'switch-on').at(-1).why, 'duplicate');
  assert.equal(world.ecs.lantern[alphaEntity], 1);
  assert.deepEqual(world.profiles.get(alphaEntity), beforeProfile, 'switches never mutate profile/economy');
  assert.deepEqual([...world.profileDirty], dirty);
  assert.equal(alphaConn.saveAt, saveAt);
  assert.equal(alpha.ws.messages.filter((message) => message.t === MSG.SAVE).length, 0);
  assert.equal(betaEntity > 0, true);
});

test('personal lantern turns off on death and reconnects default-off without a profile field', async (t) => {
  const store = { ...createMemoryStore(), durable: true };
  await store.initializeProfile(ALPHA, profile(ALPHA)); await store.initializeProfile(BETA, profile(BETA));
  const { host, alpha, alphaEntity } = await openHost(t, store), server = host.server, world = server.world;
  server.commandAccess = () => true;
  const conn = server.clients.get(alpha.id);
  assert.equal(server.playerCommand(conn, personalCommand(true, 'death-test')), true);
  assert.equal(world.ecs.lantern[alphaEntity], 1);
  assert.equal(killPlayer(world, alphaEntity, 1), true);
  assert.equal(world.ecs.lantern[alphaEntity], 0);

  world.ecs.dead[alphaEntity] = 0; world.ecs.hp[alphaEntity] = world.ecs.maxHp[alphaEntity];
  assert.equal(server.playerCommand(conn, personalCommand(true, 'before-detach')), true);
  assert.equal(world.personalLanternReceipts.has(alphaEntity), true);
  alpha.ws.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.personalLanternReceipts.has(alphaEntity), false, 'detach releases session replay receipts');
  const next = connect(host, 'Alpha');
  await Promise.all([...host.joins]);
  const nextEntity = server.clients.get(next.id).entity;
  assert.ok(nextEntity > 0);
  assert.equal(world.ecs.lantern[nextEntity], 0);
  const reopened = world.profiles.get(nextEntity);
  assert.equal(reopened.pirateId, `account:${ALPHA}`);
  assert.equal(Object.hasOwn(reopened, 'personalLantern'), false);
  assert.equal(Object.hasOwn(reopened, 'lantern'), false);
  assert.ok(reopened.eco.ships.every((ship) => !Object.hasOwn(ship, 'personalLantern') && !Object.hasOwn(ship, 'lantern')));
});
