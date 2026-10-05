import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { BTN, canStand, moveWithCollision, stepMover } from '../src/sim/systems/movement.js';
import { raftGangplank } from '../src/sim/raftGeometry.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { skillIndex } from '../src/data/tattoos.js';
import { C, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { RAFT, STARTER_RAFT } from '../src/data/raftparts.js';
import { tuning, DT } from '../src/data/tuning.js';
import { map } from './helpers.mjs';

const copy = (v) => JSON.parse(JSON.stringify(v));
const worldAt = (record) => {
  const w = new World(map.seed, { map });
  w.raftDeck.update([record]);
  return w;
};
const record = (parts, o = {}) => ({ id: 'test:raft', entity: 900, owner: 1, rev: 1,
  x: o.x ?? map.landmarks.arena.x - 1, y: o.y ?? 0.72, z: o.z ?? map.landmarks.arena.z - 1,
  yaw: o.yaw ?? 0, berth: 0, name: 'Fixture', parts, look: null });
const atPlayer = (w, x, z, y = w.map.groundAt(x, z)) => {
  const e = w.spawnPlayer({ x, z });
  w.ecs.x[e] = x; w.ecs.z[e] = z; w.ecs.y[e] = y;
  w.ecs.radius[e] = tuning.player.radius;
  return e;
};
function walk(w, e, x1, z1, step = 0.1) {
  for (let guard = 0; guard < 2000; guard++) {
    const dx = x1 - w.ecs.x[e], dz = z1 - w.ecs.z[e], d = Math.hypot(dx, dz);
    if (d <= 0.025) return;
    const n = Math.min(step, d);
    moveWithCollision(w, e, dx / d * n, dz / d * n);
    if (Math.hypot(x1 - w.ecs.x[e], z1 - w.ecs.z[e]) <= 0.025) return;
  }
  assert.fail('walk did not reach target');
}
const localPoint = (r, x, z) => ({
  x: r.x + Math.cos(r.yaw) * x + Math.sin(r.yaw) * z,
  z: r.z - Math.sin(r.yaw) * x + Math.cos(r.yaw) * z,
});
function deepWaterPoint() {
  for (let x = -map.half + 8; x < map.half - 8; x += 2) for (let z = -map.half + 8; z < map.half - 8; z += 2)
    if (tuning.world.waterLevel - map.groundAt(x, z) > tuning.world.wadeMax) return { x, z };
  assert.fail('fixture map contains a deep water tile');
}
function joinedServer(seed = 42) {
  const s = new LocalServer({ seed, bots: 0, enemies: false, send() {} });
  s.connect(1);
  s.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Deck test', skin: 0, weapon: 0, save: '' });
  return { server: s, e: s.clients.get(1).entity };
}

test('joined starter raft carries the player across its dock gangplank and back', () => {
  const { server, e } = joinedServer();
  const w = server.world, r = publicRafts(w)[0];
  assert.ok(r, 'join installs the authoritative raft deck');
  const plank = raftGangplank(r, w.map.dock);
  assert.ok(plank, 'starter berth has its explicit gangplank');
  const ux = Math.sin(plank.yaw), uz = Math.cos(plank.yaw);
  const dockEnd = { x: plank.x - ux * plank.length / 2, z: plank.z - uz * plank.length / 2 };
  const raftEnd = { x: plank.x + ux * plank.length / 2, z: plank.z + uz * plank.length / 2 };
  w.ecs.x[e] = dockEnd.x; w.ecs.z[e] = dockEnd.z; w.ecs.y[e] = w.map.dock.deckY;
  walk(w, e, raftEnd.x, raftEnd.z);
  assert.ok(Math.abs(w.ecs.y[e] - r.y) < 1e-6, 'the level-zero foundation is the standing height');
  walk(w, e, dockEnd.x, dockEnd.z);
  assert.ok(Math.abs(w.ecs.y[e] - w.map.dock.deckY) < 1e-6, 'the dock is reachable in reverse');
  assert.ok(canStand(w, raftEnd.x, raftEnd.z, tuning.player.radius, r.y));
});

test('raft support is standable while nearby unsupported deep water is not', () => {
  const waterBase = deepWaterPoint();
  const r = record(STARTER_RAFT, { x: waterBase.x - 1, z: waterBase.z - 1 });
  const w = worldAt(r);
  const f = r.parts.find((p) => p[0] === 'foundation');
  const onDeck = localPoint(r, (f[1] + 0.5) * RAFT.cell, (f[2] + 0.5) * RAFT.cell);
  assert.ok(canStand(w, onDeck.x, onDeck.z, tuning.player.radius, r.y));
  assert.equal(canStand(w, waterBase.x + 5, waterBase.z, tuning.player.radius, r.y), false);
});

test('wall, window, railing and closed door block body radius and a dash cannot tunnel through', () => {
  for (const kind of ['wall', 'window', 'railing', 'door']) {
    const parts = [
      ['foundation', 0, 0, 0], ['foundation', 1, 0, 0],
      ['foundation', 0, 1, 0], ['foundation', 1, 1, 0],
      [kind, 0, 0, 0, 1],
    ];
    const r = record(parts), w = worldAt(r), x0 = r.x + 0.5, z0 = r.z + 1;
    const e = atPlayer(w, x0, z0, r.y);
    const wallX = r.x + RAFT.cell;
    assert.equal(canStand(w, wallX - 0.05, z0, tuning.player.radius, r.y), false, `${kind} rejects a radius overlap`);
    for (let i = 0; i < 20; i++) stepMover(w, e, { mx: 1, mz: 0, ax: x0 + 5, az: z0, btn: 0, prs: i === 0 ? BTN.DASH : 0 }, DT);
    assert.ok(w.ecs.x[e] <= wallX - tuning.player.radius + 0.08, `${kind} stops dash before the edge`);
  }
});

test('a closed door edge blocks correctly after rotating the raft', () => {
  const yaw = Math.PI / 2;
  const parts = [['foundation', 0, 0, 0], ['foundation', 1, 0, 0],
    ['foundation', 0, 1, 0], ['foundation', 1, 1, 0], ['door', 0, 0, 0, 1]];
  const r = record(parts, { yaw }), w = worldAt(r), start = localPoint(r, 0.5, 1);
  const e = atPlayer(w, start.x, start.z, r.y);
  const edge = localPoint(r, 2, 1);
  assert.equal(canStand(w, edge.x, edge.z, tuning.player.radius, r.y), false);
  const dx = Math.cos(yaw), dz = -Math.sin(yaw);
  for (let i = 0; i < 40; i++) moveWithCollision(w, e, dx * 0.1, dz * 0.1);
  const localX = Math.cos(yaw) * (w.ecs.x[e] - r.x) - Math.sin(yaw) * (w.ecs.z[e] - r.z);
  assert.ok(localX <= 2 - tuning.player.radius + 0.08, 'rotated door keeps the same radius clearance');
});

test('a missing deck cell cannot be crossed by one large movement request', () => {
  const parts = [
    ['foundation', 0, 0, 0], ['foundation', 2, 0, 0],
    ['foundation', 0, 1, 0], ['foundation', 1, 1, 0], ['foundation', 2, 1, 0],
  ];
  const r = record(parts), w = worldAt(r), e = atPlayer(w, r.x + 0.5, r.z + 0.5, r.y);
  moveWithCollision(w, e, 5, 0);
  assert.ok(w.ecs.x[e] < r.x + 2 + tuning.player.radius, 'movement stops at the unsupported span');
});

test('upper floor selection follows reconciled Y and ignores lower-level edge blockers', () => {
  const parts = [
    ['foundation', 0, 0, 0], ['pillar', 0, 0, 0], ['floor', 0, 0, 1],
    ['wall', 0, 0, 0, 1],
  ];
  const r = record(parts), w = worldAt(r), x = r.x + 1.8, z = r.z + 1;
  assert.equal(canStand(w, x, z, tuning.player.radius, r.y), false, 'the lower-level wall blocks');
  const upper = r.y + RAFT.levelHeight;
  assert.equal(canStand(w, x, z, tuning.player.radius, upper), true, 'the same edge is below the upper floor');
  const e = atPlayer(w, r.x + 1, r.z + 1, upper);
  walk(w, e, r.x + 1.2, r.z + 1);
  assert.ok(Math.abs(w.ecs.y[e] - upper) < 1e-6, 'nearby overlapping floors do not cause a vertical teleport');
});

test('stairs ascend and descend in each cardinal orientation between actual deck levels', () => {
  for (let dir = 0; dir < 4; dir++) {
    const v = [[0, 1], [1, 0], [0, -1], [-1, 0]][dir];
    const parts = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) parts.push(['foundation', x, z, 0]);
    parts.push(['pillar', v[0], v[1], 0], ['floor', v[0], v[1], 1], ['stairs', 0, 0, 0, dir]);
    const valid = newRaft(parts).parts;
    assert.equal(valid.length, parts.length, `orientation ${dir} fixture is valid build geometry`);
    const r = record(valid), w = worldAt(r), e = atPlayer(w, r.x + 1, r.z + 1, r.y);
    const start = { x: r.x + 1 - v[0] * 2, z: r.z + 1 - v[1] * 2 };
    const end = { x: r.x + 1 + v[0] * 2, z: r.z + 1 + v[1] * 2 };
    w.ecs.x[e] = start.x; w.ecs.z[e] = start.z; w.ecs.y[e] = r.y;
    walk(w, e, end.x, end.z, 0.08);
    assert.ok(Math.abs(w.ecs.y[e] - (r.y + RAFT.levelHeight)) < 1e-6, `orientation ${dir} reaches the upper deck`);
    walk(w, e, start.x, start.z, 0.08);
    assert.ok(Math.abs(w.ecs.y[e] - r.y) < 1e-6, `orientation ${dir} returns to the lower deck`);
  }
});

test('owner logout moves a guest off the removed raft and leaves the other owner raft active', () => {
  const server = new LocalServer({ seed: 101, bots: 0, enemies: false, send() {} });
  const join = (id, name) => {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '' });
    return server.clients.get(id).entity;
  };
  const owner = join(1, 'Owner'), guest = join(2, 'Guest'), w = server.world, ecs = w.ecs;
  const rows = publicRafts(w), ownerRaft = rows.find((r) => r.owner === owner), other = rows.find((r) => r.owner === guest);
  assert.ok(ownerRaft && other);
  const f = ownerRaft.parts.find((p) => p[0] === 'foundation');
  const p = localPoint(ownerRaft, (f[1] + 0.5) * RAFT.cell, (f[2] + 0.5) * RAFT.cell);
  ecs.x[guest] = p.x; ecs.z[guest] = p.z; ecs.y[guest] = ownerRaft.y;
  ecs.vx[guest] = 3; ecs.vz[guest] = -2; ecs.kbx[guest] = 4; ecs.kbz[guest] = 1;
  ecs.dashT[guest] = 0.12; ecs.castK[guest] = 1; ecs.castT[guest] = 0.2; ecs.castLock[guest] = 0.3; ecs.chg[guest] = 0.4;

  server.disconnect(1);
  const dock = w.map.dock;
  assert.deepEqual([ecs.x[guest], ecs.z[guest]], [dock.base.x + dock.dir.x * Math.max(0, dock.len - 10),
    dock.base.z + dock.dir.z * Math.max(0, dock.len - 10)]);
  assert.equal(ecs.y[guest], w.map.groundAt(ecs.x[guest], ecs.z[guest]));
  assert.deepEqual([ecs.vx[guest], ecs.vz[guest], ecs.kbx[guest], ecs.kbz[guest]], [0, 0, 0, 0]);
  assert.deepEqual([ecs.dashT[guest], ecs.castK[guest], ecs.castT[guest], ecs.castLock[guest], ecs.chg[guest]], [-1, 0, 0, 0, 0]);
  assert.deepEqual(publicRafts(w).map((r) => r.id), [other.id]);
});

test('owner logout rescues an active Abordaje flight aimed at that raft before its stale landing', () => {
  const server = new LocalServer({ seed: 101, bots: 0, enemies: false, send() {} });
  const join = (id, name) => {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '' });
    return server.clients.get(id).entity;
  };
  const owner = join(1, 'Owner'), guest = join(2, 'Guest'), w = server.world, ecs = w.ecs;
  const rows = publicRafts(w), targetRaft = rows.find((r) => r.owner === owner), other = rows.find((r) => r.owner === guest);
  assert.ok(targetRaft && other);
  ecs.skQ[guest] = skillIndex('leap'); ecs.fmQ[guest] = 0; ecs.rkQ[guest] = 1;

  // Find a real dock launch and foundation landing where the jump crosses unsupported water.
  const targets = targetRaft.parts.filter((p) => p[0] === 'foundation').map((p) => localPoint(targetRaft,
    (p[1] + 0.5) * RAFT.cell, (p[2] + 0.5) * RAFT.cell));
  let launch = null;
  outer: for (let x = targetRaft.x - 12; x < targetRaft.x + 12; x += 0.2) {
    for (let z = targetRaft.z - 12; z < targetRaft.z + 12; z += 0.2) {
      if (!w.map.onDock(x, z)) continue;
      const y = w.map.groundAt(x, z);
      if (!canStand(w, x, z, tuning.player.radius, y)) continue;
      for (const target of targets) {
        const d = Math.hypot(target.x - x, target.z - z);
        const mid = { x: (target.x + x) / 2, z: (target.z + z) / 2 };
        if (d < 3 || d > 7 || w.map.onDock(mid.x, mid.z) || w.raftDeck.surface(mid.x, mid.z, y)) continue;
        launch = { x, y, z, target };
        break outer;
      }
    }
  }
  assert.ok(launch, 'fixture has a standable dock-to-raft leap over unsupported water');
  ecs.x[guest] = launch.x; ecs.y[guest] = launch.y; ecs.z[guest] = launch.z;

  let rescueAt = null;
  for (let i = 0; i < 80; i++) {
    w.applyCommand(guest, { seq: i + 1, mx: 0, mz: 0, ax: launch.target.x, az: launch.target.z,
      btn: 0, prs: i === 0 ? BTN.Q : 0, pt: w.tick, w: 0 });
    w.stepWorld();
    const landing = w.raftDeck.surface(ecs.lpX1[guest], ecs.lpZ1[guest], ecs.y[guest]);
    if (ecs.castK[guest] > 0 && landing?.id === targetRaft.id &&
        !w.raftDeck.surface(ecs.x[guest], ecs.z[guest], ecs.y[guest]) && !w.map.onDock(ecs.x[guest], ecs.z[guest])) {
      rescueAt = i;
      break;
    }
  }
  assert.notEqual(rescueAt, null, 'guest reaches unsupported water during a leap whose planned landing is the owner raft');
  assert.ok(ecs.castK[guest] > 0);
  server.disconnect(1);
  const dock = w.map.dock;
  const rescued = { x: dock.base.x + dock.dir.x * Math.max(0, dock.len - 10), z: dock.base.z + dock.dir.z * Math.max(0, dock.len - 10) };
  assert.deepEqual([ecs.x[guest], ecs.z[guest]], [rescued.x, rescued.z]);
  assert.equal(ecs.y[guest], w.map.groundAt(rescued.x, rescued.z));
  assert.deepEqual([ecs.vx[guest], ecs.vz[guest], ecs.kbx[guest], ecs.kbz[guest]], [0, 0, 0, 0]);
  assert.deepEqual([ecs.dashT[guest], ecs.castK[guest], ecs.castT[guest], ecs.castLock[guest], ecs.chg[guest]], [-1, 0, 0, 0, 0]);
  assert.deepEqual(publicRafts(w).map((r) => r.id), [other.id]);

  for (let i = 0; i < 60; i++) {
    w.applyCommand(guest, { seq: 81 + i, mx: 0, mz: 0, ax: launch.target.x, az: launch.target.z,
      btn: 0, prs: 0, pt: w.tick, w: 0 });
    w.stepWorld();
  }
  assert.deepEqual([ecs.x[guest], ecs.y[guest], ecs.z[guest]], [rescued.x, w.map.groundAt(rescued.x, rescued.z), rescued.z],
    'remaining commands cannot resume the invalidated leap toward the vanished raft');
  assert.equal(ecs.castK[guest], 0);
  assert.deepEqual(publicRafts(w).map((r) => r.id), [other.id]);
});

test('owner logout ignores a stale raft landing target while another skill is active', () => {
  const server = new LocalServer({ seed: 101, bots: 0, enemies: false, send() {} });
  const join = (id, name) => {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save: '' });
    return server.clients.get(id).entity;
  };
  const owner = join(1, 'Owner'), guest = join(2, 'Guest'), w = server.world, ecs = w.ecs;
  const targetRaft = publicRafts(w).find((r) => r.owner === owner);
  assert.ok(targetRaft);
  const dock = w.map.dock;
  const dockPoint = { x: dock.base.x + dock.dir.x * Math.max(0, dock.len - 10),
    z: dock.base.z + dock.dir.z * Math.max(0, dock.len - 10) };
  ecs.x[guest] = dockPoint.x; ecs.y[guest] = w.map.groundAt(dockPoint.x, dockPoint.z); ecs.z[guest] = dockPoint.z;
  ecs.skQ[guest] = skillIndex('lunge'); ecs.castK[guest] = 1; ecs.castT[guest] = 0.1;
  const f = targetRaft.parts.find((p) => p[0] === 'foundation');
  const stale = localPoint(targetRaft, (f[1] + 0.5) * RAFT.cell, (f[2] + 0.5) * RAFT.cell);
  ecs.lpX1[guest] = stale.x; ecs.lpZ1[guest] = stale.z;
  assert.notEqual(w.raftDeck.surface(ecs.x[guest], ecs.z[guest], ecs.y[guest])?.id, targetRaft.id);
  assert.equal(w.raftDeck.surface(stale.x, stale.z, ecs.y[guest])?.id, targetRaft.id,
    'stale landing resolves to the owner raft at the guest current Y');
  const before = [ecs.x[guest], ecs.y[guest], ecs.z[guest]];

  server.disconnect(1);
  assert.deepEqual([ecs.x[guest], ecs.y[guest], ecs.z[guest]], before,
    'a non-leap cast must not treat stale leap coordinates as an active raft landing');
  assert.equal(ecs.castK[guest], 1);
});

test('authoritative and predicted movement use the raft list before pending-command replay; stale lists cannot roll back', () => {
  const { server, e } = joinedServer(73), sw = server.world;
  const r = publicRafts(sw)[0];
  const f = r.parts.find((p) => p[0] === 'foundation');
  const p = localPoint(r, (f[1] + 0.45) * RAFT.cell, (f[2] + 0.5) * RAFT.cell);
  sw.ecs.x[e] = p.x; sw.ecs.z[e] = p.z; sw.ecs.y[e] = r.y;
  const cmd = { seq: 1, mx: 1, mz: 0, ax: p.x + 4, az: p.z, btn: 0, prs: 0, pt: 1, w: 0 };
  const state = sw.playerState(e);
  sw.applyCommand(e, cmd);

  const transport = { onSnapshot() {}, onMessage() {}, send() {}, sendInput() {}, start() {} };
  const c = new GameClient(transport, sw.map, { emit() {} }), ce = c.pred.spawnPlayer({ x: p.x, z: p.z });
  c.youServer = e; c.youLocal = ce; c.awaitingFirst = false; c.pending = [cmd];
  c.onSnapshot({ tick: 1, ack: 0, ents: [], you: state, rafts: [copy(r)] });
  assert.deepEqual([c.pred.ecs.x[ce], c.pred.ecs.y[ce], c.pred.ecs.z[ce]], [sw.ecs.x[e], sw.ecs.y[e], sw.ecs.z[e]]);
  assert.equal(c.pred.raftDeck.size, 1);

  const staleYou = copy(state);
  staleYou[PLAYER_FIELDS.indexOf('x')] += 20;
  c.onSnapshot({ tick: 0, ack: 77, ents: [], you: staleYou, rafts: [] });
  assert.equal(c.pred.raftDeck.size, 1, 'older snapshot cannot remove current collision/support geometry');
  assert.deepEqual([c.pred.ecs.x[ce], c.pred.ecs.y[ce], c.pred.ecs.z[ce]], [sw.ecs.x[e], sw.ecs.y[e], sw.ecs.z[e]],
    'a stale full player state cannot roll back predicted position');
  assert.equal(c.ackSeq, 0, 'a stale ack cannot discard pending movement');
  c.onSnapshot({ tick: 2, ack: 1, ents: [], rafts: [] });
  assert.equal(c.pred.raftDeck.size, 0, 'a newer full list removes logged-out raft geometry');
});

test('Abordaje leaps across unsupported water between upper raft floors at the same height on server and prediction', () => {
  const water = deepWaterPoint();
  const upperBlueprint = () => newRaft([
    ['foundation', 0, 0, 0], ['foundation', 1, 0, 0], ['foundation', 0, 1, 0], ['foundation', 1, 1, 0],
    ['pillar', 1, 0, 0], ['floor', 1, 0, 1],
  ]).parts;
  const rafts = [
    record(upperBlueprint(), { x: water.x - 1, z: water.z - 1 }),
    { ...record(upperBlueprint(), { x: water.x + 5, z: water.z - 1 }), id: 'test:raft2', entity: 901, owner: 2 },
  ];
  const server = new World(map.seed, { map, server: true }), predicted = new World(map.seed, { map });
  server.raftDeck.update(rafts); predicted.raftDeck.update(copy(rafts));
  const start = localPoint(rafts[0], 3, 1), goal = localPoint(rafts[1], 3, 1);
  const high = rafts[0].y + RAFT.levelHeight;
  for (const [w, e] of [[server, atPlayer(server, start.x, start.z, high)], [predicted, atPlayer(predicted, start.x, start.z, high)]]) {
    w.ecs.skQ[e] = skillIndex('leap'); // same real loadout columns used by tattoos2.test.mjs
    w.ecs.fmQ[e] = 0; w.ecs.rkQ[e] = 1;
  }
  assert.ok(canStand(server, start.x, start.z, tuning.player.radius, high));
  assert.ok(canStand(server, goal.x, goal.z, tuning.player.radius, high));
  assert.equal(canStand(server, water.x + 4, water.z, tuning.player.radius, high), false, 'the jump crosses unsupported water');

  const es = [...server.ecs.each(C.PLAYER)][0], ep = [...predicted.ecs.each(C.PLAYER)][0];
  let cast = null, minY = Infinity;
  for (let i = 0; i < 55; i++) {
    const seq = i + 1;
    const command = (w) => ({ seq, mx: 0, mz: 0, ax: goal.x, az: goal.z, btn: 0,
      prs: i === 0 ? BTN.Q : 0, pt: w.tick, w: 0 });
    server.applyCommand(es, command(server));
    predicted.applyCommand(ep, command(predicted));
    if (i === 0) cast = server.events.find((ev) => ev.type === 'cast' && ev.skill === 'leap');
    minY = Math.min(minY, server.ecs.y[es], predicted.ecs.y[ep]);
    server.stepWorld(); predicted.stepWorld();
  }
  assert.ok(cast && Math.hypot(cast.x1 - goal.x, cast.z1 - goal.z) < 1e-6, 'the real Abordaje skill selects the far upper deck');
  assert.ok(minY >= high - 1e-6, 'neither authority nor prediction falls below the selected upper deck while airborne');
  assert.ok(Math.hypot(server.ecs.x[es] - goal.x, server.ecs.z[es] - goal.z) < 0.1);
  assert.ok(Math.hypot(predicted.ecs.x[ep] - goal.x, predicted.ecs.z[ep] - goal.z) < 0.1);
  assert.ok(Math.abs(server.ecs.y[es] - high) < 1e-6 && Math.abs(predicted.ecs.y[ep] - high) < 1e-6);
  assert.deepEqual([predicted.ecs.x[ep], predicted.ecs.y[ep], predicted.ecs.z[ep]], [server.ecs.x[es], server.ecs.y[es], server.ecs.z[es]]);
});

test('Y-only reconciliation restores the upper deck and predicts the next command without horizontal error', () => {
  const parts = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) parts.push(['foundation', x, z, 0]);
  parts.push(['pillar', 0, 1, 0], ['floor', 0, 1, 1]);
  const r = record(newRaft(parts).parts), sw = worldAt(r), upper = r.y + RAFT.levelHeight;
  const p = localPoint(r, 1, 3), se = atPlayer(sw, p.x, p.z, upper);
  const state = sw.playerState(se);
  const transport = { onSnapshot() {}, onMessage() {}, send() {}, sendInput() {}, start() {} };
  const c = new GameClient(transport, sw.map, { emit() {} }), ce = c.pred.spawnPlayer({ x: p.x, z: p.z });
  c.youServer = se; c.youLocal = ce; c.awaitingFirst = false;
  c.pred.ecs.x[ce] = p.x; c.pred.ecs.z[ce] = p.z; c.pred.ecs.y[ce] = r.y;
  c.cur = { x: p.x, y: r.y, z: p.z, f: 0 }; c.prev = { ...c.cur };
  c.onSnapshot({ tick: 1, ack: 0, ents: [], you: state, rafts: [r] });
  assert.equal(c.cur.y, upper);
  assert.equal(c.prev.y, upper);
  assert.equal(c.err.x, 0); assert.equal(c.err.z, 0);
  assert.ok(Math.abs(c.err.y + RAFT.levelHeight) < 1e-6, 'vertical correction contributes to the smoothing error');
  assert.ok(Math.abs(c.stats.predErr - RAFT.levelHeight) < 1e-6);
  assert.ok(Math.abs(c.pred.ecs.y[ce] - upper) < 1e-6);

  const cmd = { seq: 1, mx: 0, mz: 1, ax: p.x, az: p.z + 5, btn: 0, prs: 0, pt: 1, w: 0 };
  sw.applyCommand(se, cmd);
  c.tickInput({ mx: 0, mz: 1, ax: p.x, az: p.z + 5, btn: 0, prs: 0, w: 0 });
  assert.deepEqual([c.pred.ecs.x[ce], c.pred.ecs.y[ce], c.pred.ecs.z[ce]], [sw.ecs.x[se], sw.ecs.y[se], sw.ecs.z[se]]);
});

test('removing raft support while standing over deep water cannot leave the player floating', () => {
  const water = deepWaterPoint();
  const r = record(STARTER_RAFT, { x: water.x - 1, z: water.z - 1 });
  const w = worldAt(r), e = atPlayer(w, water.x, water.z, r.y);
  const f = r.parts.find((p) => p[0] === 'foundation');
  const p = localPoint(r, (f[1] + 0.5) * RAFT.cell, (f[2] + 0.5) * RAFT.cell);
  assert.ok(tuning.world.waterLevel - w.map.groundAt(p.x, p.z) > tuning.world.wadeMax, 'raft fixture is over deep water');
  w.ecs.x[e] = p.x; w.ecs.z[e] = p.z; w.ecs.y[e] = r.y;
  w.raftDeck.update([]);
  assert.equal(canStand(w, p.x, p.z, tuning.player.radius, r.y), false);
  moveWithCollision(w, e, 0.15, 0);
  assert.equal(w.ecs.x[e], p.x, 'movement does not retain stale raft support');
  assert.equal(w.ecs.y[e], w.map.groundAt(p.x, p.z), 'stale deck height is discarded after support removal');
  assert.notEqual(w.ecs.y[e], r.y);
});
