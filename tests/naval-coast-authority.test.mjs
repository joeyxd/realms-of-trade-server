import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { NavalPilotServer } from '../src/net/navalPilotServer.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { RAFT } from '../src/data/raftparts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { publicRafts } from '../src/sim/systems/rafts.js';

const clone = (value) => structuredClone(value);

class QueueTransport {
  constructor(server, id, inbox) { this.server = server; this.id = id; this.inbox = inbox; this.snaps = []; this.events = []; this.receivedEvents = []; }
  onSnapshot(cb) { this.snaps.push(cb); }
  onMessage(cb) { this.events.push(cb); }
  send(m) { this.server.receive(this.id, clone(m)); }
  sendInput(_seq, m) { this.send(m); }
  start() {}
  deliver({ snapshots = true, events = true } = {}) {
    const pending = this.inbox.get(this.id) || [], keep = [];
    for (const m of pending) {
      if (m.t === MSG.SNAPSHOT && snapshots) { this.lastSnapshot = m; for (const cb of this.snaps) cb(m); }
      else if (m.t !== MSG.SNAPSHOT && events) {
        this.receivedEvents.push(m);
        for (const cb of this.events) cb(m);
      }
      else keep.push(m);
    }
    this.inbox.set(this.id, keep);
  }
  takeSnapshots() {
    const pending = this.inbox.get(this.id) || [], picked = pending.filter((m) => m.t === MSG.SNAPSHOT);
    this.inbox.set(this.id, pending.filter((m) => m.t !== MSG.SNAPSHOT)); return picked;
  }
  deliverOne(m) { this.lastSnapshot = m; for (const cb of this.snaps) cb(m); }
}

function fixture({ count = 2, beforeTick, serverFactory = (o) => new NavalPilotServer(o) } = {}) {
  const inbox = new Map(), server = serverFactory({ seed: GAME.seed, beforeTick, send: (id, m) => {
    if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(clone(m));
  } });
  const clients = new Map(), transports = new Map(), feedback = [];
  for (let id = 1; id <= count; id++) {
    inbox.set(id, []); server.connect(id);
    const transport = new QueueTransport(server, id, inbox);
    const client = new GameClient(transport, server.world.map, { emit: (event) => feedback.push({ id, event }) });
    client.start(); client.join(`Coast ${id}`, 0, 0); transport.deliver();
    clients.set(id, client); transports.set(id, transport);
  }
  server.broadcastSnapshot(); for (const t of transports.values()) t.deliver();
  return { server, clients, transports, feedback };
}

const ownerId = (client) => client.youServer;
const raftFor = (server, owner) => publicRafts(server.world).find((r) => r.owner === owner);

function placeOnDeck(server, entity, raft, foundationIndex = 0) {
  server.world.raftDeck.update(publicRafts(server.world));
  const foundations = raft.parts.filter((p) => p[0] === 'foundation'), p = foundations[foundationIndex];
  assert.ok(p, `foundation ${foundationIndex} exists`);
  const q = pilotPoint(raft, { x: (p[1] + 0.5) * RAFT.cell, y: 0, z: (p[2] + 0.5) * RAFT.cell, f: 0 });
  const surface = server.world.raftDeck.surface(q.x, q.z, q.y);
  assert.equal(surface?.id, raft.id); assert.equal(surface.kind, 'deck');
  const e = server.world.ecs;
  e.x[entity] = q.x; e.y[entity] = surface.y; e.z[entity] = q.z; e.facing[entity] = q.f;
  e.vx[entity] = e.vz[entity] = e.kbx[entity] = e.kbz[entity] = 0;
  return q;
}

function flush(h) {
  h.server.broadcastSnapshot(); for (const t of h.transports.values()) t.deliver();
}

function mountedFixture({ guest = false, beforeTick, beforeMount } = {}) {
  const h = fixture({ count: guest ? 2 : 1, beforeTick }), owner = h.clients.get(1), eid = ownerId(owner), raft = raftFor(h.server, eid);
  beforeMount?.(h.server, raft, eid);
  const currentRaft = raftFor(h.server, eid);
  placeOnDeck(h.server, eid, currentRaft);
  let guestClient, guestEid;
  if (guest) {
    guestClient = h.clients.get(2); guestEid = ownerId(guestClient);
    placeOnDeck(h.server, guestEid, currentRaft, 2);
    owner.inviteNaval(raft.id, guestEid); guestClient.boardNaval(raft.id);
  }
  owner.mountNaval(raft.id);
  flush(h);
  assert.equal(owner.naval.active, true);
  return { ...h, owner, ownerId: eid, guest: guestClient, guestId: guestEid, raftId: raft.id };
}

test('real coastal helm input damages the authoritative hull and client replay agrees without predicted feedback', () => {
  let originalPose;
  const h = mountedFixture({ guest: true, beforeMount(server, raft) {
    const ecs = server.world.ecs, source = server.world.rafts.get(raft.id);
    originalPose = [ecs.x[source.entity], ecs.y[source.entity], ecs.z[source.entity], ecs.facing[source.entity]];
    // Move only this generated test vessel into the adjacent sea before its transient body starts.
    ecs.x[source.entity] = 124; ecs.y[source.entity] = 0.72; ecs.z[source.entity] = 110; ecs.facing[source.entity] = -Math.PI / 2;
  } }), { server, owner, ownerId: e, raftId } = h;
  const world = server.world, source = world.rafts.get(raftId), ecs = world.ecs;
  const savedProfile = JSON.stringify(world.profiles.get(e)), savedGrid = JSON.stringify(source.ship.grid), savedPose = [ecs.x[source.entity], ecs.y[source.entity], ecs.z[source.entity], ecs.facing[source.entity]];
  // Terrain crosses level 0.15 near x=111 at z=110; the test hull starts east of shore, facing west.
  assert.equal(owner.naval.coast.seed, world.map.seed);
  let before = owner.naval.body.structure.entries.reduce((n, p) => n + p.hp, 0);
  for (let i = 0; i < 1500 && before === owner.naval.body.structure.entries.reduce((n, p) => n + p.hp, 0); i++) {
    owner.tickNaval({ throttle: 1, brake: 0, steer: 0 });
    assert.equal(server.step(), true);
    const snap = server.world.navalPilot.snapshot(e);
    const hp = snap.body.structure.entries.reduce((n, p) => n + p.hp, 0);
    if (hp < before) break;
  }
  server.broadcastSnapshot();
  for (const transport of h.transports.values()) transport.deliver();
  const impactMessages = [...h.transports.values()].flatMap((t) => t.receivedEvents)
    .filter((m) => m.t === MSG.EVENT && m.ev?.type === 'navalImpact');
  const after = server.world.navalPilot.snapshot(e);
  assert.ok(after.body.structure.entries.reduce((n, p) => n + p.hp, 0) < before,
    'a frontal commanded crossing of the real land/water boundary produces authoritative hull damage');
  assert.ok(impactMessages.length > 0, 'the post-commit impact reaches the owner and passenger clients');
  assert.ok(impactMessages.every((m) => m.ev.shipId === raftId && m.ev.damage > 0));
  assert.deepEqual(owner.naval.body, after.body, 'snapshot reconciles the client to the authoritative impacted pose and part HP');
  const publicRaft = owner.pred.rafts.find((r) => r.id === raftId);
  assert.ok(publicRaft.partHealth.some((p) => p.hp < p.maxHp), 'the public hull projection carries the same damage');
  assert.equal(impactMessages.length, new Set(impactMessages.map((m) => m.ev.to)).size,
    'each committed impact is sent once per recipient; prediction emits no second event');
  assert.equal(JSON.stringify(world.profiles.get(e)), savedProfile);
  assert.equal(JSON.stringify(source.ship.grid), savedGrid);
  assert.deepEqual([ecs.x[source.entity], ecs.y[source.entity], ecs.z[source.entity], ecs.facing[source.entity]], savedPose,
    'the moored source pose remains durable and untouched');
});

test('delayed snapshots replay remaining helm commands and cannot duplicate committed impact feedback', () => {
  const h = mountedFixture(), { server, owner, ownerId: e } = h, transport = h.transports.get(1);
  const committedEvents = [];
  transport.onMessage((m) => { if (m.t === MSG.EVENT && m.ev?.type === 'navalImpact') committedEvents.push(m.ev); });
  transport.takeSnapshots();
  const snapshots = [];
  for (let i = 0; i < 4; i++) {
    owner.tickNaval({ throttle: 0.8, brake: 0, steer: 0.1 }); server.step(); server.broadcastSnapshot();
    snapshots.push(...transport.takeSnapshots());
  }
  assert.ok(snapshots.length >= 4);
  const tickSamples = snapshots.slice(-4);
  const delayed = tickSamples[1], ack = delayed.naval.ack, pose = clone(delayed.naval.body.pose);
  transport.deliverOne(delayed);
  assert.equal(owner.naval.ack, ack);
  assert.ok(ack < 4, 'the selected snapshot predates the final admitted input');
  assert.deepEqual(owner.naval.pending.map((command) => command.seq), [3, 4].filter((seq) => seq > ack),
    'commands newer than the delayed ACK replay over the confirmed body');
  const eventCount = committedEvents.length;
  const replayedBody = owner.naval.body;
  transport.deliverOne(delayed);
  assert.equal(owner.naval.body, replayedBody, 'duplicate stale snapshots do not replay or emit twice');
  assert.equal(committedEvents.length, eventCount, 'prediction/replay and duplicate snapshots do not emit feedback');
  assert.ok(e > 0);
});

test('held server heartbeat leaves hull, pilot ACK, and contact feedback unchanged', () => {
  let admit = true;
  const h = mountedFixture({ beforeTick: () => admit });
  const { server, owner, ownerId: e } = h, before = server.world.navalPilot.snapshot(e);
  const profileBefore = JSON.stringify(server.world.profiles.get(e));
  owner.tickNaval({ throttle: 1, brake: 0, steer: 0 });
  const predicted = owner.naval.body;
  admit = false;
  assert.equal(server.step(), false);
  server.broadcastSnapshot(); h.transports.get(1).deliver();
  const after = server.world.navalPilot.snapshot(e);
  assert.equal(after.ack, before.ack); assert.deepEqual(after.body, before.body);
  assert.equal(JSON.stringify(server.world.profiles.get(e)), profileBefore);
  assert.equal(owner.naval.body, predicted, 'same-tick heartbeat does not rewind prediction');
  assert.equal([...h.transports.values()].some((t) => t.receivedEvents.some((m) => m.ev?.type === 'navalImpact')), false);
});

test('trial damage changes public part health and propulsion but preserves the source blueprint and profile', () => {
  let captured;
  const h = mountedFixture({ beforeMount(server) {
    const trial = server.world.navalTrial, start = trial.start.bind(trial);
    trial.start = (...args) => { captured = start(...args); return captured; };
  } }), { server, ownerId: e, raftId } = h, world = server.world;
  const source = world.rafts.get(raftId), durablePose = [world.ecs.x[source.entity], world.ecs.y[source.entity], world.ecs.z[source.entity], world.ecs.facing[source.entity]];
  const profile = JSON.stringify(world.profiles.get(e)), blueprint = JSON.stringify(source.ship.grid.parts);
  const trial = world.navalTrial, handle = captured;
  assert.ok(handle, 'pilot start yielded a server-private capability');
  const snap = trial.snapshot(handle), sail = snap.body.structure.entries.find((p) => p.part[0] === 'sail');
  if (sail) assert.equal(trial.queueDamage(handle, sail.id, 1e6), true);
  else assert.fail('starter blueprint includes a sail for the damaged-propulsion fixture');
  assert.equal(server.step(), true); server.broadcastSnapshot(); h.transports.get(1).deliver();
  const current = world.navalPilot.snapshot(e), raft = raftFor(server, e);
  assert.equal(current.body.structure.entries.find((p) => p.id === sail.id).hp, 0);
  assert.equal(current.body.operational.parts.some((p) => p[0] === 'sail'), false,
    'destroyed propulsion no longer participates in operational rig geometry');
  assert.equal(raft.partHealth.find((p) => p.id === sail.id).hp, 0);
  assert.equal(JSON.stringify(source.ship.grid.parts), blueprint);
  assert.equal(JSON.stringify(world.profiles.get(e)), profile);
  assert.deepEqual([world.ecs.x[source.entity], world.ecs.y[source.entity], world.ecs.z[source.entity], world.ecs.facing[source.entity]], durablePose);
});

test('destroying the foundation under one passenger rescues that passenger while the owner stays aboard', () => {
  let handle;
  const h = mountedFixture({ guest: true, beforeMount(server) {
    const trial = server.world.navalTrial, start = trial.start.bind(trial);
    trial.start = (...args) => { handle = start(...args); return handle; };
  } }), { server, owner, ownerId: e, guest, guestId, raftId } = h, world = server.world;
  assert.equal(guest.deck.active, true);
  const guestAt = { x: world.ecs.x[guestId], y: world.ecs.y[guestId], z: world.ecs.z[guestId] };
  const source = world.rafts.get(raftId), profile = JSON.stringify(world.profiles.get(e)), grid = JSON.stringify(source.ship.grid.parts);
  const body = world.navalTrial.snapshot(handle).body;
  const foundations = body.structure.entries.filter((p) => p.part[0] === 'foundation');
  const guestLocalX = (guestAt.x - body.pose.x) * Math.cos(body.pose.yaw) - (guestAt.z - body.pose.z) * Math.sin(body.pose.yaw);
  const guestLocalZ = (guestAt.x - body.pose.x) * Math.sin(body.pose.yaw) + (guestAt.z - body.pose.z) * Math.cos(body.pose.yaw);
  const supported = foundations.find((p) => Math.abs(guestLocalX - (p.part[1] + 0.5) * RAFT.cell) < RAFT.cell * 0.6 &&
    Math.abs(guestLocalZ - (p.part[2] + 0.5) * RAFT.cell) < RAFT.cell * 0.6);
  assert.ok(supported, 'passenger stands over one known live foundation');
  assert.equal(world.navalTrial.queueDamage(handle, supported.id, 1e6), true);
  assert.equal(server.step(), true); flush(h);
  assert.equal(guest.deck.active, false);
  const rescueX = world.map.dock.base.x + world.map.dock.dir.x * Math.max(0, world.map.dock.len - 10);
  const rescueZ = world.map.dock.base.z + world.map.dock.dir.z * Math.max(0, world.map.dock.len - 10);
  assert.ok(Math.hypot(world.ecs.x[guestId] - rescueX, world.ecs.z[guestId] - rescueZ) < 1e-9,
    'only the unsupported guest is moved to the deterministic dock rescue point');
  assert.ok(Math.hypot(world.ecs.x[guestId] - guestAt.x, world.ecs.z[guestId] - guestAt.z) > 0.5);
  assert.ok(world.navalPilot.has(e), 'owner remains in command on the still-floating raft');
  assert.equal(world.raftDeck.surface(world.ecs.x[e], world.ecs.z[e], world.ecs.y[e])?.id, raftId,
    'the owner remains supported by the active raft');
  assert.deepEqual(world.navalPilot.deckSnapshot(guestId).active, false);
  assert.equal(JSON.stringify(world.profiles.get(e)), profile);
  assert.equal(JSON.stringify(source.ship.grid.parts), grid);
});

test('loss of all live flotation releases the owner and closes only the transient trial', () => {
  let handle;
  const h = mountedFixture({ beforeMount(server) {
    const trial = server.world.navalTrial, start = trial.start.bind(trial);
    trial.start = (...args) => { handle = start(...args); return handle; };
  } }), { server, ownerId: e, raftId } = h, world = server.world;
  const source = world.rafts.get(raftId), profile = JSON.stringify(world.profiles.get(e));
  const blueprint = JSON.stringify(source.ship.grid.parts), pose = [world.ecs.x[source.entity], world.ecs.y[source.entity], world.ecs.z[source.entity], world.ecs.facing[source.entity]];
  const foundations = world.navalTrial.snapshot(handle).body.structure.entries.filter((p) => p.part[0] === 'foundation');
  assert.ok(foundations.length > 0);
  for (const part of foundations) assert.equal(world.navalTrial.queueDamage(handle, part.id, 1e6), true);
  assert.equal(server.step(), true); flush(h);
  assert.equal(world.navalPilot.has(e), false, 'disabled flotation closes the helm epoch');
  assert.equal(world.navalTrial.size, 0, 'the transient trial body is discarded');
  assert.ok(Math.hypot(world.ecs.x[e] - world.map.dock.base.x, world.ecs.z[e] - world.map.dock.base.z) < world.map.dock.len + 1,
    'the owner is returned to the dock by the bounded rescue policy');
  assert.equal(JSON.stringify(world.profiles.get(e)), profile);
  assert.equal(JSON.stringify(source.ship.grid.parts), blueprint);
  assert.deepEqual([world.ecs.x[source.entity], world.ecs.y[source.entity], world.ecs.z[source.entity], world.ecs.facing[source.entity]], pose,
    'durable source vessel pose is preserved through transient destruction');
});

test('forged private coast contract rejects both private streams atomically', () => {
  const h = mountedFixture(), { owner } = h, transport = h.transports.get(1), valid = transport.lastSnapshot;
  assert.equal(valid.naval.coast.seed, h.server.world.map.seed);
  const before = { naval: owner.naval, deck: owner.deck, rafts: owner.pred.rafts, tick: owner.lastSnapshotTick };
  const bad = clone(valid); bad.tick = before.tick + 1; bad.naval.coast.seed++;
  bad.deck.tick = bad.tick;
  transport.deliverOne(bad);
  assert.equal(owner.naval, before.naval); assert.equal(owner.deck, before.deck);
  assert.equal(owner.pred.rafts, before.rafts); assert.equal(owner.lastSnapshotTick, before.tick);
  assert.equal(owner.naval.coast, before.naval.coast, 'accepted local coast metadata stays unchanged');
});

test('disabled navigation LocalServer never advertises naval coast or private impact authority', () => {
  const h = fixture({ count: 1, serverFactory: (o) => new LocalServer({ ...o, navigation: false, bots: 0, enemies: false }) });
  h.server.broadcastSnapshot();
  const latest = h.transports.get(1).takeSnapshots().at(-1);
  assert.equal(h.server.world.navalTrial, null); assert.equal(h.server.world.navalPilot, null);
  assert.equal(Object.hasOwn(latest, 'naval'), false); assert.equal(Object.hasOwn(latest, 'deck'), false);
});
