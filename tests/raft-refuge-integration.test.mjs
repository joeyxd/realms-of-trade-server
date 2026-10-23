import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { createNavalStructure } from '../src/sim/naval/structure.js';
import { encodeRaftCondition } from '../src/sim/naval/condition.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { doorPoint } from '../src/sim/naval/shelter.js';
import { DeckWalkEngine } from '../src/sim/naval/deckWalk.js';
import { NavalDeckPrediction } from '../src/client/navalDeckPrediction.js';

const copy = (v) => structuredClone(v);
let editSequence = 0;
function fixture(parts = []) {
  const p = newProfile(), ship = p.eco.ships.find((s) => s.kind === 'raft');
  ship.grid = newRaft([...ship.grid.parts, ...parts]);
  ship.condition = encodeRaftCondition(createNavalStructure(ship.grid.parts.map((part, i) => ({ id: `piece${i + 1}`, part }))), ship.grid.parts.length + 1);
  return p;
}
function setup(profile = fixture()) {
  const messages = new Map(), server = new LocalServer({ seed: 23, bots: 0, enemies: false,
    send(id, m) { const a = messages.get(id) || []; a.push(copy(m)); messages.set(id, a); } });
  const join = (id, save) => { server.connect(id); server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Refuge ${id}`, skin: 0, weapon: 0, save: '' }, save);
    return server.clients.get(id).entity; };
  const owner = join(1, profile), guest = join(2, newProfile());
  const source = [...server.world.rafts.values()].find((r) => r.owner === owner);
  assert.ok(source);
  return { server, messages, owner, guest, source, profile: server.world.profiles.get(owner), ship: source.ship };
}
function send(server, id, fields) { server.receive(server.clientOf(id), { t: MSG.CMD, type: 'raft', ...fields }); server.flushEvents(); }
function ack(messages, id, type, opId) { return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === type && m.ev.opId === opId)?.ev; }
function edit(ctx, op, piece, index) {
  const { server, messages, owner, ship } = ctx, id = server.clientOf(owner), opId = `refuge-${op}-${++editSequence}`;
  const ecs = server.world.ecs, raft = server.world.rafts.get(ship.id), yaw = ecs.facing[raft.entity];
  ecs.x[owner] = ecs.x[raft.entity] + Math.cos(yaw) + Math.sin(yaw);
  ecs.y[owner] = ecs.y[raft.entity];
  ecs.z[owner] = ecs.z[raft.entity] - Math.sin(yaw) + Math.cos(yaw);
  ecs.moveMag[owner] = ecs.vx[owner] = ecs.vz[owner] = 0; ecs.regenT[owner] = 100;
  send(server, owner, { op, id: ship.id, expectedRev: ship.rev, opId, ...(piece ? { piece } : {}), ...(index === undefined ? {} : { index }) });
  return ack(messages, id, 'raftEdit', opId);
}
function standAtDoor(ctx, entity) {
  const r = publicRafts(ctx.server.world).find((x) => x.id === ctx.ship.id), part = ctx.source.condition.entries.find((x) => x.part[0] === 'door').part;
  const p = doorPoint(r, part), n = { x: Math.sin(r.yaw), z: Math.cos(r.yaw) }, ecs = ctx.server.world.ecs;
  ecs.x[entity] = p.x - n.x * 1.1; ecs.y[entity] = p.y; ecs.z[entity] = p.z - n.z * 1.1;
  ecs.moveMag[entity] = ecs.vx[entity] = ecs.vz[entity] = 0;
  return p;
}
function toggle(ctx, entity, open, expectedOpen, opId) {
  const { server, messages, source, ship } = ctx, id = server.clientOf(entity), door = source.condition.entries.find((x) => x.part[0] === 'door');
  server.receive(id, { t: MSG.CMD, type: 'raftDoor', id: ship.id, partId: door.id, expectedRev: ship.rev, expectedOpen, open, opId });
  server.flushEvents(); return ack(messages, id, 'raftDoor', opId);
}

test('roof construction requires a live support, charges its resources, and support removal preserves the roof', () => {
  const p = fixture(), ctx = setup(p), { profile, ship, source } = ctx;
  profile.eco.pack.goods = { madera: 8, lona: 2 };
  const roof = ['roof', 0, 0, 0, 0], rejected = edit(ctx, 'place', roof);
  assert.equal(rejected?.ok, false); assert.equal(rejected?.why, 'support');
  assert.deepEqual(profile.eco.pack.goods, { madera: 8, lona: 2 });
  const wallAck = edit(ctx, 'place', ['wall', 0, 0, 0, 0]);
  assert.equal(wallAck?.ok, true);
  assert.deepEqual(profile.eco.pack.goods, { madera: 5, lona: 2 });
  const roofAck = edit(ctx, 'place', roof);
  assert.equal(roofAck?.ok, true);
  assert.deepEqual(profile.eco.pack.goods, { madera: 3, lona: 1 });
  assert.ok(source.condition.entries.some((e) => e.part[0] === 'roof' && e.hp > 0));
  const roofIndex = ship.grid.parts.findIndex((part) => part[0] === 'roof');
  const supportIndex = ship.grid.parts.findIndex((part) => part[0] === 'wall');
  const before = copy(ship);
  const refused = edit(ctx, 'remove', ship.grid.parts[supportIndex], supportIndex);
  assert.equal(refused?.ok, false); assert.equal(refused?.why, 'needed');
  assert.deepEqual(ship, before, 'support removal cannot orphan cover or debit/refund resources');
  assert.equal(ship.grid.parts[roofIndex][0], 'roof');
});

test('removing and rebuilding an open door allocates a new instance without inheriting open state', () => {
  const ctx = setup(fixture([['wall', 0, 0, 0, 0], ['door', 0, 1, 0, 0]]));
  const { server, owner, ship, source, profile } = ctx;
  const old = source.condition.entries.find((e) => e.part[0] === 'door');
  standAtDoor(ctx, owner);
  const opened = toggle(ctx, owner, true, false, 'rebuild-door-open');
  assert.equal(opened?.ok, true, JSON.stringify(opened));
  assert.deepEqual(ship.openDoors, [old.id]);
  const index = ship.grid.parts.findIndex((p) => p[0] === 'door');
  const removed = edit(ctx, 'remove', ship.grid.parts[index], index);
  assert.equal(removed?.ok, true);
  assert.deepEqual(publicRafts(server.world).find((r) => r.id === ship.id).openDoors, []);
  profile.eco.pack.goods ||= {}; profile.eco.pack.goods.madera = 10; profile.eco.pack.goods.hierro = 3;
  const placed = edit(ctx, 'place', ['door', 0, 1, 0, 0]);
  assert.equal(placed?.ok, true);
  const next = source.condition.entries.find((e) => e.part[0] === 'door');
  assert.notEqual(next.id, old.id);
  assert.deepEqual(ship.openDoors || [], []);
  assert.deepEqual(publicRafts(server.world).find((r) => r.id === ship.id).openDoors, []);
});

test('a destroyed wall or pillar cannot support a newly paid roof even while retained in the blueprint', () => {
  for (const support of ['wall', 'pillar']) {
    const ctx = setup(fixture([[support, 0, 0, 0, 0]]));
    ctx.profile.eco.pack.goods = { madera: 2, lona: 1 };
    ctx.source.condition = { ...ctx.source.condition, entries: ctx.source.condition.entries.map((entry) =>
      entry.part[0] === support ? { ...entry, hp: 0 } : entry) };
    const before = copy(ctx.profile.eco.pack.goods), rev = ctx.ship.rev;
    const denied = edit(ctx, 'place', ['roof', 0, 0, 0, 0]);
    assert.equal(denied.ok, false); assert.equal(denied.why, 'support');
    assert.equal(ctx.ship.rev, rev); assert.deepEqual(ctx.profile.eco.pack.goods, before);
    assert.equal(ctx.ship.grid.parts.some((part) => part[0] === 'roof'), false);
  }
});

test('opening a door keeps guest deck membership valid on the moved raft without bumping blueprint rev', () => {
  const ctx = setup(fixture([['wall', 0, 0, 0, 0], ['door', 0, 1, 0, 0]]));
  const { server, owner, guest, source, ship } = ctx;
  const ecs = server.world.ecs, raft = server.world.rafts.get(ship.id), yaw = ecs.facing[raft.entity];
  ecs.x[owner] = ecs.x[raft.entity] + Math.cos(yaw) + Math.sin(yaw); ecs.y[owner] = ecs.y[raft.entity];
  ecs.z[owner] = ecs.z[raft.entity] - Math.sin(yaw) + Math.cos(yaw);
  standAtDoor(ctx, guest);
  assert.equal(server.world.navalPilot.invite(owner, ship.id, guest), true);
  assert.equal(server.world.navalPilot.board(guest, ship.id), true);
  assert.equal(server.world.navalPilot.deckSnapshot(guest)?.active, true);
  const rev = ship.rev;
  server.world.ecs.x[source.entity] += 7;
  server.world.navalPilot.sync();
  assert.equal(server.world.navalPilot.deckSnapshot(guest)?.active, true);
  const result = toggle(ctx, guest, true, false, 'moving-deck-open');
  assert.equal(result?.ok, true, JSON.stringify(result));
  assert.equal(ship.rev, rev);
  assert.equal(server.world.navalPilot.deckSnapshot(guest)?.active, true);
  server.world.navalPilot.prepare(); server.world.navalPilot.sync();
  assert.equal(server.world.navalPilot.deckSnapshot(guest)?.active, true, 'same deck membership survives movement reconciliation');
});

test('shared deck walking and prediction cross open doors and respect closed doors in all four orientations', () => {
  const directions = [
    { door: ['door', 0, 0, 0, 0], foundations: [['foundation', 0, 0, 0, 0], ['foundation', 0, -1, 0, 0]], start: { x: 1, z: 1 }, axes: { mx: 0, mz: -1 } },
    { door: ['door', 0, 0, 0, 1], foundations: [['foundation', 0, 0, 0, 0], ['foundation', 1, 0, 0, 0]], start: { x: 1, z: 1 }, axes: { mx: 1, mz: 0 } },
    { door: ['door', 0, 0, 0, 2], foundations: [['foundation', 0, 0, 0, 0], ['foundation', 0, 1, 0, 0]], start: { x: 1, z: 1 }, axes: { mx: 0, mz: 1 } },
    { door: ['door', 0, 0, 0, 3], foundations: [['foundation', 0, 0, 0, 0], ['foundation', -1, 0, 0, 0]], start: { x: 1, z: 1 }, axes: { mx: -1, mz: 0 } },
  ];
  for (const { door, foundations, start, axes } of directions) {
    const parts = [...foundations, door], state = { ...start, y: 0, f: 0, vx: 0, vz: 0, mag: 0 };
    const params = { speed: 8, radius: 0.25 };
    const run = (openDoors) => { let s = state; const engine = new DeckWalkEngine();
      for (let i = 0; i < 120; i++) s = engine.step(s, axes, parts, { ...params, openDoors }); return s; };
    const closed = run([]), opened = run([door]);
    const axis = axes.mx ? 'x' : 'z', sign = axes.mx || axes.mz;
    assert.ok(Math.abs(closed[axis] - start[axis]) < 0.9,
      `direction ${door[4]} closed leaf stops traversal`);
    assert.ok(sign * (opened[axis] - start[axis]) > 1.5,
      `direction ${door[4]} open trajectory passes through the doorway`);

    const snapshot = (openDoors) => ({ active: true, epoch: 1, shipId: `door-${door[4]}`, mode: 'walk', ack: 0, tick: 1,
      state: copy(state), parts: copy(parts), params: { ...params, openDoors: copy(openDoors) } });
    const prediction = new NavalDeckPrediction();
    assert.equal(prediction.acceptSnapshot(snapshot([])), 'accepted');
    for (let i = 0; i < 120; i++) prediction.step(axes);
    const predictionClosed = prediction.state;
    const openPrediction = new NavalDeckPrediction();
    assert.equal(openPrediction.acceptSnapshot(snapshot([door])), 'accepted');
    for (let i = 0; i < 120; i++) openPrediction.step(axes);
    assert.ok(Math.abs(predictionClosed[axis] - start[axis]) < 0.9,
      `direction ${door[4]} client prediction stops at the closed leaf`);
    assert.ok(sign * (openPrediction.state[axis] - start[axis]) > 1.5,
      `direction ${door[4]} client prediction crosses the open leaf`);
  }
});
