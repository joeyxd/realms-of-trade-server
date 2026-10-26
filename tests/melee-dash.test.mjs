import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_DASH as D } from '../src/data/lawless.js';
import { DT, tuning } from '../src/data/tuning.js';
import { STATE, ACT } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { calaDuel } from './cala-duel.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const HOLD = { mx: 1, btn: BTN.DASH }, START = { ...HOLD, prs: BTN.DASH };
function setup(version = 1) {
  const S = calaDuel(); S.w.meleeVersion = version; S.w.rng = () => 1;
  S.ecs.needs[S.a] = S.ecs.needs[S.b] = 0;
  return S;
}
function step(S, extra = HOLD, e = S.b) {
  const { w, ecs } = S;
  w.applyCommand(e, { seq: ecs.lastSeq[e] + 1, pt: w.tick, mx: 0, mz: 0,
    ax: ecs.x[e] + 10, az: ecs.z[e], btn: 0, prs: 0, ...extra });
}
const run = (S, n, extra = HOLD) => { for (let i = 0; i < n; i++) step(S, extra); };
function frame(S, f) { step(S, START); run(S, f - 1); }
function blow(S) {
  const { ecs, w, a, b } = S;
  // Resolve after the victim's frame command; compensate interpolation to use its current position.
  ecs.x[a] = ecs.x[b] - 1.6; ecs.z[a] = ecs.z[b]; ecs.facing[a] = Math.PI / 2;
  ecs.atkStage[a] = 1; ecs.atkT[a] = 5 * DT; ecs.swingId[a]++;
  w.meleeHits(a, tuning.melee.stages[0], w.tick + tuning.combat.interpTicks, 1);
}

test('dash covers our distance by frame 19 and stands still through the twelve endlag frames', () => {
  const S = setup(), { ecs, b } = S;
  frame(S, D.move); near(ecs.dashCovered[b], tuning.dash.distance, 0.05);
  const x = ecs.x[b], z = ecs.z[b], covered = ecs.dashCovered[b];
  for (let f = 20; f <= 31; f++) {
    step(S); near(ecs.dashCovered[b], covered); near(ecs.x[b], x); near(ecs.z[b], z);
    assert.equal(ecs.vx[b], 0); assert.equal(ecs.vz[b], 0);
  }
});

test('dash i-frames are exactly frames 4-19, with vulnerable startup and endlag', () => {
  const S = setup(), { ecs, b } = S;
  for (let f = 1; f <= 31; f++) {
    step(S, f === 1 ? START : HOLD);
    if (f >= 4 && f <= 19) assert.ok(ecs.iframes[b] > 0, `frame ${f}`);
    else assert.equal(ecs.iframes[b], 0, `frame ${f}`);
  }
});

for (const f of [2, 25]) test(`a jab landing on vulnerable dash frame ${f} damages, freezes and interrupts immediately`, () => {
  const S = setup(), { ecs, b } = S; frame(S, f); const hp = ecs.hp[b]; blow(S);
  assert.ok(ecs.hp[b] < hp); assert.ok(ecs.hitlag[b] > 0); assert.equal(ecs.dashT[b], -1);
  assert.equal(ecs.state[b], STATE.MOVE); assert.equal(ecs.vx[b], 0); assert.equal(ecs.vz[b], 0);
  assert.ok(Math.hypot(ecs.lvx[b], ecs.lvz[b]) > 0, 'launch remains independent of dash velocity');
});

test('a jab on dash frame 10 emits a PvP dodge and leaves the dash running', () => {
  const S = setup(), { ecs, w, b } = S; frame(S, 10); const hp = ecs.hp[b]; blow(S);
  assert.equal(ecs.hp[b], hp); assert.ok(ecs.dashT[b] >= 0); assert.equal(ecs.hitlag[b], 0);
  assert.ok(w.events.some(e => e.type === 'dodge' && e.e === b && e.pvp === 1));
});

test('attack and guard presses cannot act during endlag frame 25', () => {
  for (const prs of [BTN.ATTACK, BTN.GUARD, BTN.ATTACK | BTN.GUARD]) {
    const S = setup(); frame(S, 24); step(S, { ...HOLD, btn: BTN.DASH | prs, prs });
    assert.equal(S.ecs.atkStage[S.b], 0); assert.ok(S.ecs.guardT[S.b] < 0);
    assert.equal(S.ecs.grabSt[S.b], 0); assert.equal(S.ecs.state[S.b], STATE.DASH);
  }
});

test('a grab connecting on endlag frame 25 ends the victim dash immediately', () => {
  const S = setup(), { w, ecs, a, b } = S; frame(S, 19);
  ecs.x[a] = ecs.x[b] - 0.95; ecs.z[a] = ecs.z[b]; ecs.facing[a] = Math.PI / 2;
  step(S, { btn: BTN.GUARD, prs: BTN.ATTACK }, a);
  // Advance history through stationary endlag so the grab's rewind sees the victim there.
  for (let i = 0; i < 6; i++) {
    step(S); step(S, { pt: w.tick + tuning.combat.interpTicks }, a);
    if (i < 5) w.stepWorld();
  }
  assert.ok(ecs.dashT[b] >= 0); w.stepWorld();
  assert.equal(ecs.grabSt[b], ACT.CAPTURE); assert.equal(ecs.grabWho[b], a);
  assert.equal(ecs.dashT[b], -1); assert.equal(ecs.state[b], STATE.MOVE);
  assert.equal(ecs.vx[b], 0); assert.equal(ecs.vz[b], 0);
});

test('skill i-frames survive dash startup, the window and endlag without being clobbered', () => {
  const S = setup(), { ecs, b } = S; ecs.iframes[b] = 1;
  for (let f = 1; f <= 31; f++) {
    step(S, f === 1 ? START : HOLD); near(ecs.iframes[b], 1 - f * DT);
  }
});

test('chip shots, launching skills and PvE projectiles all interrupt vulnerable dashes', () => {
  for (const skill of ['gun_l', 'gun_r', 'lunge']) {
    const S = setup(), { ecs, w, a, b } = S; frame(S, 25); const hp = ecs.hp[b];
    w.strike(b, 10, { by: a, kind: 'skill', skill, dx: 1, dz: 0, x: ecs.x[b] - 1, z: ecs.z[b] });
    assert.ok(ecs.hp[b] < hp, skill); assert.equal(ecs.dashT[b], -1, skill);
  }
  const S = setup(), { ecs, w, b } = S; frame(S, 25);
  hurtPlayer(w, b, 10, { x: ecs.x[b] - 1, z: ecs.z[b], kind: 'proj', seq: 0 });
  assert.equal(ecs.dashT[b], -1); assert.ok(ecs.hitlag[b] > 0);
});

test('MN_MELEE off preserves the pre-change 14-command dash, full i-frames and held-stick exit carry', () => {
  const S = setup(0), { ecs, b } = S; step(S, START);
  assert.equal(ecs.iframes[b], tuning.dash.duration);
  let commands = 1;
  while (ecs.dashT[b] >= 0 && commands < 100) { step(S); commands++; }
  assert.equal(commands, Math.ceil(tuning.dash.duration / DT));
  assert.equal(commands, 14, 'pre-change measurement on eb260b6');
  assert.equal(ecs.dashT[b], -1); assert.equal(ecs.state[b], STATE.MOVE);
  near(ecs.vx[b], ecs.speed[b] * tuning.dash.exitCarry); assert.equal(ecs.vz[b], 0);
});

test('GameClient prediction matches the authoritative dash window, endlag and ACK replay', () => {
  const S = setup(), { w, ecs, b } = S;
  const client = new GameClient({ onSnapshot() {}, onMessage() {}, sendInput(_seq, cmd) { w.applyCommand(b, cmd); } }, w.map, { emit() {} });
  client.onMessage({ t: MSG.WELCOME, you: b, melee: 1 });
  const e = client.youLocal; client.pred.setPlayerState(e, w.playerState(b)); client.awaitingFirst = false;
  const compare = () => {
    for (const k of ['x', 'z', 'dashT', 'dashCovered', 'iframes', 'vx', 'vz', 'state']) near(client.pred.ecs[k][e], ecs[k][b]);
  };
  let ack;
  for (let f = 1; f <= 34; f++) {
    client.tickInput({ ...HOLD, mz: 0, ax: ecs.x[b] + 10, az: ecs.z[b], prs: f === 1 ? BTN.DASH : 0 });
    compare();
    if (f === 10) ack = [client.seq, w.playerState(b)];
    if (f === 25) { client.reconcile(...ack); compare(); }
  }
});

test('dash owns exactly 31 commands, then exits standing on command 32 with the stick held', () => {
  const S = setup(), { ecs, b } = S;
  // T-1025-53: DONE WHEN (a)/D3 retire at command 32 entry; D4's end-of-31 is this boundary.
  for (let f = 1; f <= D.total; f++) {
    step(S, f === 1 ? START : { ...HOLD, prs: BTN.ATTACK | BTN.GUARD | BTN.Q });
    assert.ok(ecs.dashT[b] >= 0, `frame ${f}`); assert.equal(ecs.state[b], STATE.DASH);
    assert.equal(ecs.atkStage[b], 0); assert.ok(ecs.guardT[b] < 0);
  }
  const x = ecs.x[b], z = ecs.z[b]; step(S);
  assert.equal(ecs.dashT[b], -1); assert.equal(ecs.state[b], STATE.MOVE);
  assert.equal(ecs.vx[b], 0); assert.equal(ecs.vz[b], 0); near(ecs.x[b], x); near(ecs.z[b], z);
});

test('an attack on the first command after the dash starts jab 1', () => {
  const S = setup(); frame(S, 31); step(S, { ...HOLD, prs: BTN.ATTACK });
  assert.equal(S.ecs.dashT[S.b], -1); assert.equal(S.ecs.atkStage[S.b], 1);
});

test('a late buffered dash starts on command 32, while an old press expires normally', () => {
  for (const press of [20, 29]) {
    const S = setup(), { ecs, b } = S;
    ecs.dashMax[b] = ecs.dashCharges[b] = 2; step(S, START);
    const charges = ecs.dashCharges[b];
    for (let f = 2; f <= 31; f++) {
      step(S, { ...HOLD, prs: f === press ? BTN.DASH : 0 });
      assert.equal(ecs.dashCount[b], 1); assert.equal(ecs.dashCharges[b], charges);
    }
    step(S);
    assert.equal(ecs.dashCount[b], press === 29 ? 2 : 1);
    assert.equal(ecs.dashCharges[b], charges - (press === 29 ? 1 : 0));
    if (press === 29) { near(ecs.dashT[b], DT); assert.equal(ecs.iframes[b], 0); }
    else assert.equal(ecs.dashT[b], -1);
  }
});
