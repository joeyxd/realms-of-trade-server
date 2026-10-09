import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { hmacSaves } from '../server/saves.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GameHost } from '../server/host.mjs';
import { createNavalStructure, applyPartDamage } from '../src/sim/naval/structure.js';
import { encodeRaftCondition, sanitizeRaftCondition, restoreRaftCondition, refitRaftCondition } from '../src/sim/naval/condition.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { restoredRaftPose } from '../src/sim/naval/recovery.js';
import { nearestNavalLanding } from '../src/sim/naval/landing.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { raftCmd } from '../src/sim/systems/raftEditor.js';
import { raftGangplank } from '../src/sim/raftGeometry.js';

const copy = (v) => structuredClone(v);
const parts = [
  ['foundation', 0, 0, 0, 0],
  ['floor', 0, 0, 1, 0],
];

function join(server, id, save = '', profile = undefined) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, skin: 0, weapon: 0, save }, profile);
  const client = server.clients.get(id);
  assert.ok(client?.entity, 'the player joined');
  return { client, owner: client.entity, profile: server.world.profiles.get(client.entity) };
}

function makeServer(seed, saves = hmacSaves('raft-persistence'), options = {}) {
  const sent = [];
  const server = new LocalServer({ seed, bots: 0, enemies: false, saves,
    send: (_id, message) => sent.push(copy(message)), ...options });
  return { server, sent };
}

function activeRaft(server, owner) {
  const source = [...server.world.rafts.values()].find((r) => r.owner === owner);
  assert.ok(source, 'the docked raft is attached');
  return source;
}

function safeAwayPose(world, ship, condition, requireLanding = false) {
  const ecs = world.ecs, home = [...world.rafts.values()].find((r) => r.ship === ship);
  const homeX = ecs.x[home.entity], homeZ = ecs.z[home.entity];
  for (let x = -world.map.half + 12; x < world.map.half - 12; x += 8) {
    for (let z = -world.map.half + 12; z < world.map.half - 12; z += 8) {
      if (Math.hypot(x - homeX, z - homeZ) < 32) continue;
      ship.voyage = { v: 1, seed: world.seed >>> 0, pose: [x, z, 0.7] };
      const pose = restoredRaftPose(world, ship, condition);
      if (!pose) continue;
      const liveParts = condition.entries.filter((entry) => entry.hp > 0).map((entry) => entry.part);
      if (requireLanding && !nearestNavalLanding(world, pose, liveParts, 6)) continue;
      return ship.voyage.pose;
    }
  }
  assert.fail('the map has a collision-free away pose for recovery');
}

test('condition serialization retains stable piece identities, HP and a monotonic next ID across refits', () => {
  const original = createNavalStructure(parts.map((part, i) => ({ id: `p${i + 1}`, part })));
  const damaged = applyPartDamage(original, 'p1', 30).structure;
  const encoded = encodeRaftCondition(damaged, 3);
  assert.deepEqual(encoded, { v: 1, next: 3, entries: [
    ['p1', ...parts[0], 30], ['p2', ...parts[1], 40],
  ] });
  const restored = restoreRaftCondition(encoded, parts);
  assert.deepEqual(encodeRaftCondition(restored.structure, restored.nextId), encoded);

  const refit = refitRaftCondition({ condition: restored.structure, conditionNext: restored.nextId, entity: 999 },
    [parts[1], parts[0], ['floor', 1, 0, 1, 0]]);
  assert.deepEqual(refit.structure.entries.map((entry) => entry.id), ['p2', 'p1', 'p3']);
  assert.equal(refit.structure.entries[1].hp, 30, 'unchanged piece identity retains damage after reordering');

  const removed = refitRaftCondition({ condition: refit.structure, conditionNext: refit.nextId, entity: 999 }, [parts[1]]);
  const replaced = refitRaftCondition({ condition: removed.structure, conditionNext: removed.nextId, entity: 999 },
    [parts[1], ['floor', 1, 0, 1, 0]]);
  assert.equal(replaced.structure.entries[1].id, 'p4', 'a removed identity is never reused');
});

test('legacy condition restores healthy generated IDs; present malformed condition fails damaged pieces closed', () => {
  const legacy = restoreRaftCondition(null, parts);
  assert.deepEqual(legacy.structure.entries.map((entry) => [entry.id, entry.hp]), [['p1', 60], ['p2', 40]]);
  assert.equal(legacy.nextId, 3);

  const dirty = { v: 1, next: 2, entries: [
    ['p1', 'foundation', 0, 0, 0, 0, 7],
    ['bad id', 'floor', 0, 0, 1, 0, 40],
  ] };
  const safe = sanitizeRaftCondition(dirty, parts);
  const repaired = restoreRaftCondition(safe, parts);
  assert.equal(repaired.structure.entries[0].hp, 7);
  assert.equal(repaired.structure.entries[1].hp, 0, 'invalid or missing saved entries cannot heal by loading');
  assert.equal(new Set(repaired.structure.entries.map((entry) => entry.id)).size, 2);
  assert.ok(repaired.nextId > Math.max(...repaired.structure.entries.map((entry) => Number(entry.id.slice(1)) || 0)));
});

test('signed save restart restores away pose and condition without moving the player or activating a pilot body', () => {
  const saves = hmacSaves('stable-test-secret');
  const first = makeServer(731, saves);
  const { server, sent } = first;
  const { owner, profile } = join(server, 1);
  let finalBlob = '';
  server.onSave = (_id, p) => { finalBlob = saves.store(p); return true; };
  const source = activeRaft(server, owner);
  const target = source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  const view = publicRafts(server.world).find((record) => record.id === source.ship.id);
  const helm = pilotPoint(view, view.helm), ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z;
  let handle;
  const start = server.world.navalTrial.start.bind(server.world.navalTrial);
  server.world.navalTrial.start = (...args) => (handle = start(...args));
  assert.equal(server.playerCommand(server.clients.get(1), { type: 'navalPilot', op: 'mount', shipId: source.ship.id }), true);
  assert.ok(handle, 'the voyage has an authoritative trial handle');
  assert.equal(server.world.navalTrial.queueDamage(handle, target.id, 12), true);
  assert.equal(server.step(), true, 'piece damage commits at the authoritative tick');
  const epoch = server.world.navalPilot.snapshot(owner).epoch;
  for (let seq = 1; seq <= 12; seq++) {
    server.receive(1, { t: MSG.SHIP_INPUT, epoch, seq, throttle: 1, brake: 0, steer: 0, capture: false });
    assert.equal(server.step(), true);
  }
  for (let i = 0; i < 300; i++) assert.equal(server.step(), true);
  const autoMessages = sent.filter((message) => message.t === MSG.SAVE);
  assert.ok(autoMessages.length, 'periodic autosave runs before disconnect');
  const autoProfile = saves.load(autoMessages.at(-1).blob);
  const autoShip = autoProfile.eco.ships.find((ship) => ship.kind === 'raft');
  const committedPose = server.world.navalPilot.snapshot(owner).body.pose;
  const savedPose = [committedPose.x, committedPose.z, committedPose.yaw];
  const committedHp = server.world.navalPilot.snapshot(owner).body.structure.entries.find((entry) => entry.id === target.id).hp;
  assert.equal(committedHp, target.hp - 12);
  assert.deepEqual(autoShip.voyage.pose, savedPose, 'autosave already contains the committed away pose');
  assert.equal(autoShip.condition.entries.find((entry) => entry[0] === target.id)[6], committedHp,
    'autosave already contains committed per-piece HP');
  assert.ok(Math.hypot(savedPose[0] - source.home.x, savedPose[1] - source.home.z) > 0.01,
    'server-admitted inputs moved the boat away from its berth');
  const checkpoint = { x: server.world.ecs.cpX[owner], z: server.world.ecs.cpZ[owner] };
  server.disconnect(1);
  assert.ok(finalBlob, 'disconnect emits a final signed profile snapshot');

  const second = makeServer(731, hmacSaves('stable-test-secret'));
  const joined = join(second.server, 2, finalBlob);
  const restoredSource = activeRaft(second.server, joined.owner);
  const restoredPose = restoredSource.ship.voyage?.pose;
  assert.deepEqual(restoredPose, savedPose);
  assert.equal(restoredSource.condition.entries.find((entry) => entry.id === target.id).hp, committedHp);
  assert.equal(restoredSource.condition.entries.find((entry) => entry.id === target.id).id, target.id);
  assert.deepEqual([second.server.world.ecs.x[joined.owner], second.server.world.ecs.z[joined.owner]],
    [second.server.world.ecs.cpX[joined.owner], second.server.world.ecs.cpZ[joined.owner]],
  'the character returns to its checkpoint, independently of the recovered boat');
  assert.equal(second.server.world.navalPilot.snapshot(joined.owner).active, false,
    'saved recovery does not create an active pilot, helm, or crew');
  const recovery = second.server.world.navalPilot.voyageSnapshot(joined.owner);
  assert.equal(recovery.active, true);
  assert.equal(recovery.phase, 'shore');
  assert.equal(recovery.recovery, true);
  const restoredView = publicRafts(second.server.world).find((record) => record.id === restoredSource.ship.id);
  assert.ok(Math.hypot(restoredView.x - restoredPose[0], restoredView.z - restoredPose[1]) < 1e-6);
  assert.equal(sent.some((message) => message.t === MSG.PROFILE && message.p.cp === 'spawn'), true);
});

test('wrong-seed, unsafe and colliding voyage poses fall back to the dock while retaining condition and cargo', () => {
  const saves = hmacSaves('same-secret');
  const first = makeServer(991, saves);
  const { owner, profile } = join(first.server, 1);
  const source = activeRaft(first.server, owner);
  const encoded = encodeRaftCondition(source.condition, source.conditionNext);
  const validPose = safeAwayPose(first.server.world, source.ship, source.condition);
  source.ship.condition = encoded;
  source.ship.hold.goods.madera = 3;
  source.ship.voyage = { v: 1, seed: first.server.world.seed >>> 0, pose: validPose };
  const blob = saves.store(profile);

  const wrongSeed = makeServer(992, hmacSaves('same-secret'));
  const wrong = join(wrongSeed.server, 2, blob);
  const wrongSource = activeRaft(wrongSeed.server, wrong.owner);
  assert.equal(wrongSource.ship.voyage, null);
  assert.equal(wrongSource.ship.hold.goods.madera, 3);
  assert.equal(wrongSource.condition.entries[0].hp, source.condition.entries[0].hp);

  for (const pose of [[Infinity, 0, 0], [1e9, 1e9, 0], [NaN, 0, 0]]) {
    const unsafeProfile = copy(profile);
    const unsafeShip = unsafeProfile.eco.ships.find((ship) => ship.kind === 'raft');
    unsafeShip.condition = encoded;
    unsafeShip.voyage = { v: 1, seed: first.server.world.seed >>> 0, pose };
    const unsafe = makeServer(991, hmacSaves('same-secret'));
    const player = join(unsafe.server, 3, hmacSaves('same-secret').store(unsafeProfile));
    const away = activeRaft(unsafe.server, player.owner);
    assert.equal(away.ship.voyage, null, 'unsafe saved placement falls back to a docked vessel');
    assert.equal(away.condition.entries[0].hp, source.condition.entries[0].hp);
  }
});

test('profile sanitizer defaults legacy voyage/condition and ignores client attempts to set live HP or pose', () => {
  const p = newProfile();
  const ship = p.eco.ships.find((s) => s.kind === 'raft');
  delete ship.condition; delete ship.voyage;
  const legacy = sanitizeProfile(p);
  const safe = legacy.eco.ships.find((s) => s.kind === 'raft');
  assert.equal(safe.condition, null);
  assert.equal(safe.voyage, null);

  const { server } = makeServer(88);
  const { client, owner } = join(server, 1);
  const source = activeRaft(server, owner);
  const before = { condition: copy(source.condition), pose: [server.world.ecs.x[source.entity], server.world.ecs.z[source.entity]] };
  assert.equal(server.playerCommand(client, { type: 'navalPilot', op: 'recall', hp: 0, pose: [999, 999, 0] }), false);
  assert.deepEqual(source.condition, before.condition);
  assert.deepEqual([server.world.ecs.x[source.entity], server.world.ecs.z[source.entity]], before.pose);
});

function recoveredFixture(seed = 1551) {
  const saves = hmacSaves('recovery-fixture-secret'), first = makeServer(seed, saves);
  const { owner, profile } = join(first.server, 1), source = activeRaft(first.server, owner);
  const target = source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  source.condition = applyPartDamage(source.condition, target.id, 9).structure;
  source.ship.condition = encodeRaftCondition(source.condition, source.conditionNext);
  source.ship.hold.goods.madera = 8;
  source.ship.voyage = { v: 1, seed: first.server.world.seed >>> 0,
    pose: safeAwayPose(first.server.world, source.ship, source.condition, true) };
  const blob = saves.store(profile);
  const next = makeServer(seed, hmacSaves('recovery-fixture-secret'));
  const joined = join(next.server, 2, blob), raft = activeRaft(next.server, joined.owner);
  return { ...next, ...joined, raft, targetId: target.id, saves: hmacSaves('recovery-fixture-secret') };
}

test('recovered raft recall rejects remote requests, then recalls at the dock and clears voyage without healing or losing cargo', () => {
  const f = recoveredFixture(), { server, owner, raft } = f, ecs = server.world.ecs, ship = raft.ship;
  const original = { condition: copy(raft.condition), hold: copy(ship.hold), voyage: copy(ship.voyage) };
  assert.ok(server.world.navalPilot.voyageSnapshot(owner).landing, 'fixture restored near a legal landing');
  ecs.x[owner] = server.world.map.half - 8; ecs.z[owner] = server.world.map.half - 8;
  assert.equal(server.world.navalPilot.recall(owner), false, 'remote recall cannot teleport the recovered boat');
  assert.deepEqual(ship.voyage, original.voyage);

  const dock = server.world.map.dock;
  ecs.x[owner] = dock.base.x + dock.dir.x * Math.max(0, dock.len - 10);
  ecs.z[owner] = dock.base.z + dock.dir.z * Math.max(0, dock.len - 10);
  ecs.y[owner] = server.world.map.groundAt(ecs.x[owner], ecs.z[owner]);
  assert.equal(server.world.navalPilot.recall(owner), true);
  assert.equal(ship.voyage, null, 'successful dock recall retires the away recovery record');
  assert.deepEqual(raft.condition, original.condition, 'recall preserves every damaged part ID and HP');
  assert.deepEqual(ship.hold, original.hold, 'recall preserves cargo');
  assert.equal(server.world.navalPilot.snapshot(owner).active, false);
  assert.equal(server.world.navalPilot.voyageSnapshot(owner).active, false);
});

test('recovered shore reboard starts a fresh stationary helm authority and rejects the inactive epoch', () => {
  const f = recoveredFixture(1661), { server, owner, raft } = f, ecs = server.world.ecs;
  const pilot = server.world.navalPilot, shipId = raft.ship.id;
  const recovery = pilot.voyageSnapshot(owner), oldEpoch = pilot.snapshot(owner).epoch;
  assert.equal(recovery.phase, 'shore'); assert.equal(recovery.recovery, true);
  assert.ok(recovery.landing);
  ecs.x[owner] = recovery.landing.x; ecs.y[owner] = recovery.landing.y; ecs.z[owner] = recovery.landing.z;
  assert.equal(pilot.reboard(owner, shipId), true, 'the owner can reboard at the derived legal landing');
  const active = pilot.snapshot(owner);
  assert.equal(active.active, true);
  assert.ok(active.epoch > oldEpoch, 'reboard grants a fresh authority epoch');
  assert.deepEqual([active.body.state.vx, active.body.state.vz, active.body.state.omega], [0, 0, 0],
    'saved velocity and angular momentum do not return');
  assert.equal(pilot.input(owner, { epoch: oldEpoch, seq: 1, throttle: 1, brake: 0, steer: 0 }), false,
    'an inactive epoch cannot reacquire the helm');
  const pose = copy(active.body.pose);
  assert.equal(pilot.input(owner, { epoch: active.epoch, seq: 1, throttle: 0, brake: 0, steer: 0 }), true);
  const after = pilot.snapshot(owner);
  assert.deepEqual([after.body.state.vx, after.body.state.vz, after.body.state.omega], [0, 0, 0]);
  assert.deepEqual(after.body.pose, pose, 'neutral input queues no movement');
});

test('mounting a docked raft without movement and disconnecting stays docked without recovery', () => {
  const saves = hmacSaves('stationary-home-secret'), f = makeServer(1771, saves);
  const { server, sent } = f, { owner } = join(server, 1), source = activeRaft(server, owner);
  const view = publicRafts(server.world).find((record) => record.id === source.ship.id), helm = pilotPoint(view, view.helm);
  const ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z;
  assert.equal(server.playerCommand(server.clients.get(1), { type: 'navalPilot', op: 'mount', shipId: source.ship.id }), true);
  const initial = server.world.navalPilot.snapshot(owner);
  assert.equal(initial.active, true);
  assert.deepEqual([initial.body.state.vx, initial.body.state.vz, initial.body.state.omega], [0, 0, 0]);
  let finalBlob = '';
  server.onSave = (_id, profile) => { finalBlob = saves.store(profile); return true; };
  server.disconnect(1);
  assert.ok(finalBlob);
  const persisted = saves.load(finalBlob).eco.ships.find((ship) => ship.kind === 'raft');
  assert.equal(persisted.voyage, null, 'home pose is not turned into away recovery on disconnect');

  const restarted = makeServer(1771, hmacSaves('stationary-home-secret'));
  const joined = join(restarted.server, 2, finalBlob), attached = activeRaft(restarted.server, joined.owner);
  assert.equal(restarted.server.world.navalPilot.snapshot(joined.owner).active, false);
  assert.equal(restarted.server.world.navalPilot.voyageSnapshot(joined.owner).active, false);
  assert.ok(!sent.some((message) => message.t === MSG.SAVE) || finalBlob.length > 0);
  assert.equal(attached.ship.voyage, null);
});

test('a persisted zero-float wreck returns at its dock with zero HP and the same IDs, then can be repaired', () => {
  const saves = hmacSaves('wreck-save-secret'), first = makeServer(1881, saves);
  const { server, sent } = first, { owner, profile } = join(server, 1), source = activeRaft(server, owner);
  for (const entry of source.condition.entries.filter((part) => part.part[0] === 'foundation')) {
    source.condition = applyPartDamage(source.condition, entry.id, entry.hp).structure;
  }
  source.ship.condition = encodeRaftCondition(source.condition, source.conditionNext);
  source.ship.hold.goods.madera = 1;
  profile.eco.pack.goods.madera = 20;
  const wreckHealth = source.condition.entries.map((entry) => [entry.id, entry.hp]);
  let blob = '';
  server.onSave = (_id, p) => { blob = saves.store(p); return true; };
  server.disconnect(1);
  assert.ok(blob);

  const next = makeServer(1881, hmacSaves('wreck-save-secret'));
  const joined = join(next.server, 2, blob), wreck = activeRaft(next.server, joined.owner);
  assert.equal(wreck.ship.voyage, null);
  assert.deepEqual(wreck.condition.entries.map((entry) => [entry.id, entry.hp]), wreckHealth);
  assert.ok(wreck.condition.entries.filter((entry) => entry.part[0] === 'foundation').every((entry) => entry.hp === 0),
    'loading a destroyed flotation piece never heals it for free');
  assert.ok(publicRafts(next.server.world).some((record) => record.id === wreck.ship.id), 'the wreck remains at its reserved berth');

  const view = publicRafts(next.server.world).find((record) => record.id === wreck.ship.id);
  const plank = raftGangplank({ ...view, parts: wreck.ship.grid.parts }, next.server.world.map.dock);
  assert.ok(plank, 'the saved plan still exposes its repair approach');
  const ecs = next.server.world.ecs;
  ecs.x[joined.owner] = plank.x + 1.7; ecs.z[joined.owner] = plank.z;
  ecs.y[joined.owner] = next.server.world.map.groundAt(ecs.x[joined.owner], ecs.z[joined.owner]);
  ecs.vx[joined.owner] = ecs.vz[joined.owner] = ecs.kbx[joined.owner] = ecs.kbz[joined.owner] = 0;
  next.server.world.raftDeck.update(publicRafts(next.server.world));
  const target = wreck.condition.entries.find((entry) => entry.part[0] === 'foundation');
  const beforeMadera = (joined.profile.eco.pack.goods.madera || 0) + (wreck.ship.hold.goods.madera || 0);
  const index = wreck.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(target.part));
  const repaired = raftCmd(next.server.world, joined.owner, { type: 'raft', op: 'repair', id: wreck.ship.id,
    expectedRev: wreck.ship.rev, opId: 'recovery-wreck-repair', index, piece: [...target.part], partId: target.id, expectedHp: 0 });
  assert.equal(repaired.ok, true, repaired.why);
  const restored = wreck.condition.entries.find((entry) => entry.id === target.id);
  assert.equal(restored.hp, restored.maxHp);
  assert.equal(wreck.condition.entries.filter((entry) => entry.id === target.id).length, 1);
  assert.equal((joined.profile.eco.pack.goods.madera || 0) + (wreck.ship.hold.goods.madera || 0), beforeMadera - 4,
    'reconstruction is paid and preserves the original instance identity');
  assert.equal(sent.some((message) => message.t === MSG.SAVE), false,
    'disconnect uses the final snapshot and needs no earlier save event');
});

test('a blocked simulation tick cannot save queued but uncommitted raft damage', () => {
  const saves = hmacSaves('blocked-tick-secret'), f = makeServer(1991, saves, { beforeTick: () => false });
  const { server, sent } = f, { owner, client } = join(server, 1), source = activeRaft(server, owner);
  const view = publicRafts(server.world).find((record) => record.id === source.ship.id), helm = pilotPoint(view, view.helm);
  server.world.ecs.x[owner] = helm.x; server.world.ecs.y[owner] = helm.y; server.world.ecs.z[owner] = helm.z;
  let handle;
  const start = server.world.navalTrial.start.bind(server.world.navalTrial);
  server.world.navalTrial.start = (...args) => (handle = start(...args));
  assert.equal(server.playerCommand(client, { type: 'navalPilot', op: 'mount', shipId: source.ship.id }), true);
  const before = copy(source.ship.condition);
  const target = source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  assert.equal(server.world.navalTrial.queueDamage(handle, target.id, 20), true);
  assert.equal(server.step(), false, 'the boundary refuses the simulation tick');
  assert.deepEqual(source.ship.condition, before, 'the denied tick never commits damage into profile data');
  assert.equal(server.sendSave(1, client), true, 'the last committed profile remains serializable');
  const blob = sent.filter((message) => message.t === MSG.SAVE).at(-1)?.blob;
  assert.ok(blob);
  const savedShip = saves.load(blob).eco.ships.find((ship) => ship.kind === 'raft');
  assert.deepEqual(savedShip.condition, before, 'save contains only the last committed per-piece state');
});

class TestSocket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
}

async function hostJoin(host) {
  const ws = new TestSocket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Account boat',
    token: 'verified-account-token', playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })), false);
  await Promise.all([...host.joins]);
  const id = [...host.sockets.keys()][0];
  assert.ok(ws.messages.some((message) => message.t === MSG.WELCOME));
  return { ws, id };
}

test('GameHost account close and restart restores the memory-store raft snapshot', async () => {
  const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seed = 2111;
  const store = createMemoryStore(), saves = hmacSaves('account-host-save');
  const makeHost = () => new GameHost({ seed, bots: 0, log: () => {}, saves, store, initializeAccounts: true,
    resolvePlayer: async (_req, message) => message.token === 'verified-account-token' ? account : null });
  const first = makeHost();
  try {
    const { ws, id } = await hostJoin(first), owner = first.server.clients.get(id).entity;
    const source = activeRaft(first.server, owner), target = source.condition.entries.find((entry) => entry.part[0] === 'foundation');
    source.condition = applyPartDamage(source.condition, target.id, 14).structure;
    source.ship.condition = encodeRaftCondition(source.condition, source.conditionNext);
    source.ship.hold.goods.madera = 2;
    source.ship.voyage = { v: 1, seed: first.server.world.seed >>> 0,
      pose: safeAwayPose(first.server.world, source.ship, source.condition, true) };
    ws.close(); await first.profiles.flush();
    const row = await store.loadProfile(account);
    assert.equal(row.version, 2, 'final disconnect snapshot advances account CAS');
    assert.equal(row.data.eco.ships[0].condition.entries.find((entry) => entry[0] === target.id)[6], target.hp - 14);
    await first.close();

    const second = makeHost();
    try {
      const { id: nextId } = await hostJoin(second), nextOwner = second.server.clients.get(nextId).entity;
      const restored = activeRaft(second.server, nextOwner);
      assert.equal(restored.ship.voyage.seed, seed);
      assert.equal(restored.condition.entries.find((entry) => entry.id === target.id).hp, target.hp - 14);
      assert.equal(restored.ship.hold.goods.madera, 2);
      assert.equal(second.server.world.navalPilot.snapshot(nextOwner).active, false);
      assert.equal(second.server.world.navalPilot.voyageSnapshot(nextOwner).recovery, true);
    } finally { await second.close(); }
  } finally { await first.close(); }
});

test('account memory store reopens the same persisted boat and rejects a stale profile CAS', async () => {
  const store = createMemoryStore(), account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const first = new ProfileSessions(store, () => {});
  const profile = await first.open('session-1', account);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  const initial = restoreRaftCondition(null, ship.grid.parts);
  const firstFloat = initial.structure.entries.find((entry) => entry.part[0] === 'foundation');
  const damaged = applyPartDamage(initial.structure, firstFloat.id, 17).structure;
  ship.condition = encodeRaftCondition(damaged, initial.nextId);
  ship.voyage = { v: 1, seed: 77, pose: [14, -28, 0.4] };
  ship.hold.goods.madera = 5;
  first.save('session-1', profile);
  await first.flush();
  first.close('session-1');

  const second = new ProfileSessions(store, () => {});
  const reopened = await second.open('session-2', account);
  const persisted = reopened.eco.ships.find((s) => s.kind === 'raft');
  assert.deepEqual(persisted.condition, ship.condition);
  assert.deepEqual(persisted.voyage, ship.voyage);
  assert.equal(persisted.hold.goods.madera, 5);
  assert.deepEqual(await store.saveProfile(account, profile, 0), { ok: false, why: 'conflict' },
    'a stale account snapshot cannot replace the newer boat state');
  second.close('session-2');
});
