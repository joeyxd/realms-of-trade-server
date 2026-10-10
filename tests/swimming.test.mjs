import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { C, STATE, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN, canStand, stepMover } from '../src/sim/systems/movement.js';
import { swimLoadOf } from '../src/sim/systems/swimming.js';
import { DT, tuning } from '../src/data/tuning.js';
import { encodeEntity, ENT, MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { LocalServer } from '../src/net/localServer.js';
import { map as island } from './helpers.mjs';

// A clear, continuous beach in the real World/command pipeline; no fixtures replace movement/combat.
const coast = { ...island, onDock: () => false, groundAt: x => Math.max(-3, Math.min(0.2, -x)),
  colliders: [], queryColliders: () => [], checkpointAt: () => null };
function fixture({ x = 3, server = true, pack } = {}) {
  const w = new World(island.seed, { map: coast, server });
  const e = w.spawnPlayer({ x, z: 0 });
  w.ecs.cpX[e] = -3; w.ecs.cpZ[e] = 0;
  if (pack) w.profiles = new Map([[e, { eco: { pack: { goods: pack } } }]]);
  let seq = 0;
  const step = (mx = 0, prs = 0, btn = 0) => w.applyCommand(e,
    { seq: ++seq, mx, mz: 0, ax: 20, az: 0, prs, btn, pt: ++w.tick });
  return { w, e, step };
}

test('beach entry swims at surface and returns to accessible shore; enemies and leap targets stay dry', () => {
  const { w, e, step } = fixture({ x: 0.4 });
  for (let i = 0; i < 100; i++) step(1);
  assert.equal(w.ecs.swim[e], 1);
  assert.equal(w.ecs.state[e], STATE.SWIM);
  assert.equal(w.ecs.y[e], tuning.world.waterLevel - tuning.swim.bodyDepth);
  assert.equal(canStand(w, w.ecs.x[e], 0), false, 'swimming is not a legal skill landing');
  for (let i = 0; i < 120; i++) step(-1);
  assert.equal(w.ecs.swim[e], 0);
  assert.ok(w.ecs.x[e] < 0.6);
  assert.equal(w.ecs.y[e], coast.groundAt(w.ecs.x[e], 0));
  const enemy = w.spawnEnemy('archer', 0.4, 0);
  for (let i = 0; i < 100; i++) stepMover(w, enemy, { mx: 1, mz: 0, prs: 0, btn: 0 }, DT);
  assert.ok(w.ecs.x[enemy] <= tuning.world.wadeMax);
  assert.equal(w.ecs.swim[enemy], 0);
});

test('authoritative pack mass slows swimming and drains reserve faster; idle does not regenerate', () => {
  const empty = fixture(), loaded = fixture({ pack: { piedra: 10 } });
  for (let i = 0; i < 120; i++) { empty.step(1); loaded.step(1); }
  assert.ok(loaded.w.ecs.x[loaded.e] < empty.w.ecs.x[empty.e]);
  assert.ok(loaded.w.ecs.swimStamina[loaded.e] < empty.w.ecs.swimStamina[empty.e]);
  assert.equal(loaded.w.ecs.swimLoad[loaded.e], swimLoadOf(loaded.w.profiles.get(loaded.e)));
  const prior = empty.w.ecs.swimStamina[empty.e];
  for (let i = 0; i < 60; i++) empty.step();
  assert.ok(Math.abs(empty.w.ecs.swimStamina[empty.e] - (prior - 0.5)) < 1e-9);
  empty.w.ecs.x[empty.e] = -3; empty.w.ecs.y[empty.e] = 0.2;
  for (let i = 0; i < 60; i++) empty.step();
  assert.equal(empty.w.ecs.swimStamina[empty.e], tuning.swim.stamina);
});

test('exhaustion has grace, then pierces armor/invulnerability gradually and uses the existing death once', () => {
  const { w, e, step } = fixture();
  w.ecs.swimStamina[e] = 0; w.ecs.def[e] = 10000; w.ecs.hurtInv[e] = 100;
  for (let i = 0; i < 300; i++) step();
  assert.equal(w.ecs.hp[e], w.ecs.maxHp[e]);
  for (let i = 0; i < 60; i++) step();
  assert.equal(w.ecs.hp[e], w.ecs.maxHp[e] * 0.9);
  assert.ok(w.events.some(ev => ev.type === 'hurt' && ev.kind === 'drowning'));
  for (let i = 0; i < 540; i++) step();
  assert.equal(w.ecs.dead[e], 1);
  assert.equal(w.events.filter(ev => ev.type === 'death').length, 1);
  for (let i = 0; i < 181; i++) step();
  assert.equal(w.ecs.dead[e], 0);
  assert.equal(w.ecs.swim[e], 0);
  assert.equal(w.ecs.swimDrown[e], 0);
  assert.equal(w.ecs.swimStamina[e], tuning.swim.stamina);
});

test('swimming blocks new dash/attacks/skills but retains hazards and Brasa; raft support is dry', () => {
  const { w, e, step } = fixture();
  const charges = w.ecs.dashCharges[e];
  for (let i = 0; i < 10; i++) step(1, BTN.DASH | BTN.Q | BTN.E | BTN.G | BTN.R | BTN.ATTACK | BTN.GUARD, BTN.ATTACK | BTN.GUARD);
  assert.equal(w.ecs.dashCharges[e], charges); assert.equal(w.ecs.castK[e], 0);
  assert.equal(w.ecs.atkStage[e], 0); assert.equal(w.ecs.guardT[e], -1);
  w.ecs.elem[e] = 1;
  for (let i = 0; i < 60; i++) step();
  assert.ok(w.ecs.hp[e] < w.ecs.maxHp[e]);
  const raft = { id: 'dry', x: 2, z: -1, y: 0.72, yaw: 0, rev: 1, parts: [['foundation', 0, 0, 0]] };
  w.raftDeck.update([raft]); w.ecs.x[e] = 3; w.ecs.y[e] = 0.72; w.ecs.z[e] = 0;
  const hp = w.ecs.hp[e];
  for (let i = 0; i < 60; i++) step();
  assert.equal(w.ecs.hp[e], hp, 'underlying seabed does not curse a supported deck');
  assert.equal(w.ecs.swim[e], 0);
});

test('reconciled reserve/load/drowning replay is bit-identical and remote state carries SWIM', () => {
  const a = fixture({ pack: { piedra: 10 } }), b = fixture({ server: false });
  for (let i = 0; i < 110; i++) a.step(1);
  b.w.setPlayerState(b.e, a.w.playerState(a.e));
  assert.equal(b.w.ecs.state[b.e], STATE.SWIM);
  for (let i = 0; i < 150; i++) {
    const cmd = { seq: i + 111, mx: i % 4 ? 1 : 0, mz: 0, ax: 20, az: 0, btn: 0, prs: 0, pt: i + 111 };
    a.w.tick = b.w.tick = cmd.pt;
    a.w.applyCommand(a.e, cmd); b.w.applyCommand(b.e, cmd);
  }
  assert.deepEqual(b.w.playerState(b.e), a.w.playerState(a.e));
  assert.equal(encodeEntity(a.w.ecs, a.e)[ENT.ST], STATE.SWIM);
  for (const k of ['swim', 'swimStamina', 'swimDrown', 'swimLoad']) assert.ok(PLAYER_FIELDS.includes(k));
  a.w.despawn(a.e);
  const reused = a.w.spawnPlayer({ x: -3, z: 0 });
  assert.equal(reused, a.e); assert.equal(a.w.ecs.swim[reused], 0);
  assert.equal(a.w.ecs.swimStamina[reused], tuning.swim.stamina); assert.equal(a.w.ecs.swimLoad[reused], 0);
});

test('online standby filler continues drowning when a connected client sends no input', () => {
  const sent = [], server = new LocalServer({ seed: island.seed, bots: 0, enemies: false, fill: true,
    send: (_id, message) => sent.push(message) });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Swimmer', skin: 0, weapon: 0, save: '' });
  const w = server.world, e = server.clients.get(1).entity;
  w.map = coast; w.raftDeck.update([]);
  w.ecs.x[e] = 3; w.ecs.z[e] = 0; w.ecs.y[e] = -tuning.swim.bodyDepth;
  w.ecs.swimStamina[e] = 0; w.ecs.swimDrown[e] = 5.99;
  const hp = w.ecs.hp[e];
  for (let i = 0; i < 30; i++) server.step();
  assert.ok(w.ecs.hp[e] < hp);
  assert.ok(sent.some(m => m.t === MSG.EVENT && m.ev?.kind === 'drowning'));
});
