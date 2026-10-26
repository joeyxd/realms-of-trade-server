// Headless tests for the pure simulation (run: npm test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';
import { tuning, DT } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';

const SEED = GAME.seed;
const map = generateWorld(SEED);

function hashArr(a) {
  let h = 2166136261;
  const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619);
  return h >>> 0;
}

test('worldgen is deterministic', () => {
  const b = generateWorld(SEED);
  assert.equal(hashArr(map.heights), hashArr(b.heights));
  assert.equal(map.props.length, b.props.length);
  assert.deepEqual(map.props.slice(0, 50), b.props.slice(0, 50));
});

test('landmarks sit in the right zones', () => {
  const L = map.landmarks;
  assert.equal(map.zoneAt(L.spawn.x, L.spawn.z), 'playa');
  assert.equal(map.zoneAt(L.village.x, L.village.z), 'aldea');
  assert.equal(map.zoneAt(L.arena.x, L.arena.z), 'caldera');
  assert.equal(map.zoneAt(L.ship.x, L.ship.z), 'mar');
  assert.ok(map.groundAt(L.spawn.x, L.spawn.z) > 0.2, 'spawn above water');
  assert.ok(Math.abs(map.groundAt(L.arena.x, L.arena.z) - 4.6) < 0.2, 'arena floor flat');
  const counts = {};
  for (const p of map.props) counts[p.kind] = (counts[p.kind] || 0) + 1;
  assert.ok(counts.palm > 60, `palms: ${counts.palm}`);
  assert.ok(counts.bush > 60, `bushes: ${counts.bush}`);
});

function freshPlayer(x, z) {
  const w = new World(SEED, { map });
  const e = w.spawnPlayer({ x, z });
  return { w, e };
}

// Find an open patch of flat ground with no colliders nearby.
function openSpot() {
  const L = map.landmarks;
  for (let r = 0; r < 30; r += 0.5) {
    const x = L.village.x + 8 + r, z = L.village.z + 8;
    if (map.queryColliders(x, z, 8).length === 0) return { x, z };
  }
  return { x: L.arena.x, z: L.arena.z };
}

test('run speed reaches 6.5 u/s with acceleration', () => {
  const { x, z } = { x: map.landmarks.arena.x - 8, z: map.landmarks.arena.z };
  const { w, e } = freshPlayer(x, z);
  const ecs = w.ecs;
  let seq = 0;
  for (let i = 0; i < 6; i++) w.applyCommand(e, { seq: ++seq, mx: 0, mz: 1, prs: 0 });
  assert.ok(Math.hypot(ecs.vx[e], ecs.vz[e]) > 6.4, 'reaches top speed within 0.1 s');
  const z0 = ecs.z[e];
  for (let i = 0; i < 60; i++) w.applyCommand(e, { seq: ++seq, mx: 0, mz: 1, prs: 0 });
  const dist = ecs.z[e] - z0;
  assert.ok(Math.abs(dist - 6.5) < 0.15, `1 s of running = ${dist.toFixed(3)} u`);
});

test('dash: 5.5 u in 0.22 s with i-frames, then charges and buffer', () => {
  const a = map.landmarks.arena;
  const { w, e } = freshPlayer(a.x - 6, a.z);
  const ecs = w.ecs;
  let seq = 0;
  const x0 = ecs.x[e], z0 = ecs.z[e];
  w.applyCommand(e, { seq: ++seq, mx: 1, mz: 0, prs: BTN.DASH });
  assert.ok(ecs.iframes[e] > 0, 'i-frames on dash start');
  let ticks = 1;
  while (ecs.dashT[e] >= 0 && ticks < 40) { w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, prs: 0 }); ticks++; }
  const d = Math.hypot(ecs.x[e] - x0, ecs.z[e] - z0);
  assert.ok(Math.abs(d - 5.5) < 0.12, `dash distance ${d.toFixed(3)}`);
  assert.ok(Math.abs(ticks * DT - tuning.dash.duration) <= DT * 1.01, `dash duration ${(ticks * DT).toFixed(3)} s`);
  assert.equal(ecs.dashCharges[e], 0, 'Lv1 has one charge');
  // Pressing again with no charges must not dash...
  w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, prs: BTN.DASH });
  assert.ok(ecs.dashT[e] < 0, 'no dash without charges');
  // ...and a press 100 ms before the charge is back is buffered (130 ms window).
  const waitTicks = Math.round((tuning.dash.recharge - 0.1) / DT) - ticks - 1;
  for (let i = 0; i < waitTicks; i++) w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, prs: 0 });
  w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, prs: BTN.DASH });
  let fired = false;
  for (let i = 0; i < 9; i++) { w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, prs: 0 }); if (ecs.dashT[e] >= 0) { fired = true; break; } }
  assert.ok(fired, 'buffered dash fires when the charge returns');
});

test('level 2 gets a second dash charge', () => {
  const w = new World(SEED, { map });
  const e = w.spawnPlayer({ level: 2 });
  assert.equal(w.ecs.dashMax[e], 2);
});

test('the sea blocks movement beyond wading depth', () => {
  const s = map.landmarks.spawn;
  const { w, e } = freshPlayer(s.x, s.z);
  const ecs = w.ecs;
  // Walk toward the open sea (screen-down = south-east = +x +z).
  for (let i = 0; i < 60 * 12; i++) w.applyCommand(e, { seq: i + 1, mx: 0.7071, mz: 0.7071, prs: i % 50 === 0 ? BTN.DASH : 0 });
  const depth = tuning.world.waterLevel - map.groundAt(ecs.x[e], ecs.z[e]);
  assert.ok(depth <= tuning.world.wadeMax + 1e-6, `stopped at depth ${depth.toFixed(2)}`);
});

test('colliders are never penetrated', () => {
  const palm = map.props.find((p) => p.kind === 'palm' && map.queryColliders(p.x, p.z, 3).length === 1);
  const { w, e } = freshPlayer(palm.x - 4, palm.z);
  const ecs = w.ecs;
  for (let i = 0; i < 120; i++) {
    w.applyCommand(e, { seq: i + 1, mx: 1, mz: 0, prs: i === 20 ? BTN.DASH : 0 });
    const d = Math.hypot(ecs.x[e] - palm.x, ecs.z[e] - palm.z);
    assert.ok(d >= palm.r + tuning.player.radius - 1e-6, `penetration ${d}`);
  }
});

test('the beach → village → path → arena route is walkable', () => {
  const L = map.landmarks;
  const route = [L.spawn, L.village, ...L.path, L.arena];
  const { w, e } = freshPlayer(L.spawn.x, L.spawn.z);
  const ecs = w.ecs;
  let seq = 0;
  for (const target of route) {
    let guard = 0;
    while (Math.hypot(target.x - ecs.x[e], target.z - ecs.z[e]) > 1.5 && guard++ < 60 * 40) {
      const dx = target.x - ecs.x[e], dz = target.z - ecs.z[e];
      const d = Math.hypot(dx, dz);
      // simple obstacle-sliding steering: try straight, else sidestep
      const before = [ecs.x[e], ecs.z[e]];
      w.applyCommand(e, { seq: ++seq, mx: dx / d, mz: dz / d, prs: 0 });
      if (Math.hypot(ecs.x[e] - before[0], ecs.z[e] - before[1]) < 0.02) {
        for (let k = 0; k < 20; k++) w.applyCommand(e, { seq: ++seq, mx: -dz / d, mz: dx / d, prs: 0 });
      }
    }
    assert.ok(Math.hypot(target.x - ecs.x[e], target.z - ecs.z[e]) <= 1.5, `stuck before (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) at (${ecs.x[e].toFixed(1)}, ${ecs.z[e].toFixed(1)})`);
  }
});

test('client prediction matches the authoritative server exactly', () => {
  const toClient = [];
  const server = new LocalServer({ seed: SEED, bots: 3, send: (_id, m) => toClient.push(JSON.parse(JSON.stringify(m))) });
  const snaps = [], msgs = [];
  const transport = {
    onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), start() {},
    sendInput: (_s, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [cmd] }),
    send: (m) => server.receive(1, m),
  };
  const bus = { emit() {} };
  const client = new GameClient(transport, map, bus);
  client.start();
  const deliver = () => {
    while (toClient.length) {
      const m = toClient.shift();
      if (m.t === MSG.SNAPSHOT) snaps.forEach((cb) => cb(m)); else msgs.forEach((cb) => cb(m));
    }
  };
  server.connect(1);
  deliver();
  client.join('Test', 2);
  deliver();
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.ok(client.joined, 'client joined');
  let maxErr = 0;
  for (let i = 0; i < 600; i++) {
    const t = i * DT;
    client.tickInput({ mx: Math.cos(t * 0.7), mz: Math.sin(t * 1.3), btn: 0, prs: i % 37 === 0 ? BTN.DASH : 0 });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  const se = server.clients.get(1).entity;
  const sx = server.world.ecs.x[se], sz = server.world.ecs.z[se];
  // drain remaining commands
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  const ce = client.youLocal;
  assert.equal(maxErr, 0, 'zero prediction error with a deterministic world');
  assert.equal(client.pred.ecs.x[ce], server.world.ecs.x[se]);
  assert.equal(client.pred.ecs.z[ce], server.world.ecs.z[se]);
  assert.ok(Number.isFinite(sx) && Number.isFinite(sz));
});
