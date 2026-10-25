import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAWLESS, MELEE_GUARD as G, MELEE_ROLL as R } from '../src/data/lawless.js';
import { DT, tuning } from '../src/data/tuning.js';
import { WEAPON } from '../src/data/weapons.js';
import { ACT, intangible, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { GameClient } from '../src/client/gameClient.js';
import { Input } from '../src/core/input.js';
import { encodeEntity, ENT, MSG } from '../src/net/protocol.js';
import { calaDuel } from './cala-duel.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const HOLD = { btn: BTN.DASH }, RAISE = { btn: BTN.DASH, prs: BTN.DASH };
function setup(version = 1, pistol = false) {
  const S = calaDuel(); S.w.meleeVersion = version; S.w.rng = () => 1;
  S.ecs.needs[S.a] = S.ecs.needs[S.b] = 0;
  S.ecs.facing[S.b] = Math.PI / 2;
  if (pistol) S.ecs.weapon[S.b] = WEAPON.PISTOLAS;
  return S;
}
function step(S, extra = {}) {
  const { w, ecs, b } = S;
  const cmd = { seq: ecs.lastSeq[b] + 1, pt: w.tick, mx: 0, mz: 0, ax: ecs.x[b] + 10, az: ecs.z[b], btn: 0, prs: 0, ...extra };
  w.applyCommand(b, cmd); return cmd;
}
const run = (S, n, extra) => { for (let i = 0; i < n; i++) step(S, extra); };
function roll(S, back = false) {
  step(S, RAISE); step(S, { ...HOLD, mx: back ? -1 : 1 });
}
function blow(S) {
  const { ecs, w, a, b } = S;
  ecs.x[a] = ecs.x[b] - 1.6; ecs.z[a] = ecs.z[b]; ecs.facing[a] = Math.PI / 2;
  ecs.atkStage[a] = 1; ecs.atkT[a] = 5 * DT; ecs.swingId[a]++;
  w.meleeHits(a, tuning.melee.stages[0], w.tick + tuning.combat.interpTicks, 1);
}

test('moving dash presses retain the dash, neutral held raises the shield and release keeps P2 lag', () => {
  const D = setup(); step(D, { ...RAISE, mx: 1 });
  assert.ok(D.ecs.dashT[D.b] >= 0); assert.ok(D.ecs.guardT[D.b] < 0);
  const S = setup(), { ecs, b } = S, st = ecs.guardSt[b];
  step(S, HOLD); assert.ok(ecs.guardT[b] >= 0); assert.ok(ecs.dashT[b] < 0);
  run(S, 7, HOLD); near(ecs.guardSt[b], st - 8 * G.drain);
  step(S); assert.ok(ecs.guardT[b] < 0); assert.equal(ecs.guardLag[b], G.dropLag - 1);
  const moving = setup(); step(moving, { ...HOLD, mx: 1 }); assert.ok(moving.ecs.guardT[moving.b] < 0);
  step(moving, HOLD); assert.ok(moving.ecs.guardT[moving.b] >= 0, 'hold raises once the stick stops');
});

test('MN_MELEE off ignores held DASH and keeps neutral dash presses and pistol fire', () => {
  const S = setup(0, true); step(S, HOLD); assert.ok(S.ecs.guardT[S.b] < 0);
  step(S, { ...HOLD, prs: BTN.ATTACK }); assert.equal(S.ecs.shotN[S.b], 1);
  step(S, RAISE); assert.ok(S.ecs.dashT[S.b] >= 0);
  const A = setup(0), B = setup(0);
  for (const c of [{ mx: 1 }, {}, { prs: BTN.ATTACK }, {}, { prs: BTN.DASH }]) {
    step(A, c); step(B, { ...c, btn: (c.btn || 0) | BTN.DASH });
    assert.deepEqual(A.w.playerState(A.b), B.w.playerState(B.b), 'held bit has no legacy sim effect');
  }
});

test('pistol body shield blocks a sabre and both triggers, while GUARD alone still fires right', () => {
  const S = setup(1, true), { ecs, w, a, b } = S;
  step(S, RAISE); run(S, 5, HOLD); const hp = ecs.hp[b], st = ecs.guardSt[b];
  ecs.atkStage[a] = 1; ecs.atkT[a] = 5 * DT; ecs.swingId[a]++;
  w.meleeHits(a, tuning.melee.stages[0], w.tick, 1);
  assert.equal(ecs.hp[b], hp); assert.ok(ecs.guardSt[b] < st);
  assert.equal(w.events.findLast(e => e.type === 'duel').out, 'block');
  const P = setup(1, true); step(P, RAISE);
  run(P, 9, { btn: BTN.DASH | BTN.ATTACK | BTN.GUARD }); assert.equal(P.ecs.shotN[P.b], 0);
  assert.equal(P.ecs.shotCd[P.b], 0); assert.equal(P.ecs.shotAltCd[P.b], 0);
  const Q = setup(1, true); step(Q, { btn: BTN.GUARD, prs: BTN.GUARD });
  assert.ok(Q.ecs.shotAltCd[Q.b] > 0); assert.ok(Q.ecs.guardT[Q.b] < 0);
});

test('shield plus attack grabs with pistols, without firing, and preserves the blocked-start gates', () => {
  for (const pistol of [false, true]) {
    const S = setup(1, pistol); step(S, RAISE); step(S, { ...HOLD, prs: BTN.ATTACK });
    assert.equal(S.ecs.grabSt[S.b], ACT.GRAB); assert.equal(S.ecs.shotN[S.b], 0);
  }
  for (const key of ['guardStun', 'guardLag', 'stagger', 'dizzy', 'brk']) {
    const S = setup(1, true); step(S, RAISE); S.ecs[key][S.b] = 10;
    step(S, { ...HOLD, prs: BTN.ATTACK }); assert.equal(S.ecs.grabSt[S.b], 0, key);
  }
});

test('forward/back flick rolls last 35 frames with exact 4-19 / 4-23 intangible windows', () => {
  for (const back of [false, true]) {
    const S = setup(), { ecs, b } = S, facing = ecs.facing[b], x = ecs.x[b]; roll(S, back);
    for (let f = 1; f <= 35; f++) {
      assert.equal(ecs.rollT[b], f); assert.equal(ecs.act[b], back ? ACT.ROLL_B : ACT.ROLL_F);
      assert.equal(encodeEntity(ecs, b)[ENT.ACT], back ? 33 : 32);
      assert.equal(intangible(ecs, b), f >= 4 && f <= (back ? 23 : 19), `back ${back}, frame ${f}`);
      assert.ok(ecs.guardT[b] < 0); assert.equal(ecs.atkStage[b], 0); near(ecs.facing[b], facing);
      if (f < 35) step(S, { ...HOLD, mx: back ? -1 : 1, prs: BTN.ATTACK | BTN.DASH | BTN.JUMP | BTN.Q });
    }
    near(ecs.x[b] - x, (back ? -1 : 1) * R.distance * LAWLESS.meleeUnit);
    step(S, { ...HOLD, mx: back ? -1 : 1 });
    assert.equal(ecs.rollT[b], 0); assert.ok(ecs.guardT[b] >= 0); assert.equal(ecs.guardLag[b], 0);
    assert.equal(ecs.dashCount[b], 0, 'no buffered dash leaks out');
    const free = setup(); roll(free, back); run(free, 35);
    assert.equal(free.ecs.rollT[free.b], 0); assert.ok(free.ecs.guardT[free.b] < 0); assert.equal(free.ecs.guardLag[free.b], 0);
  }
});

test('blows miss at each intangible boundary and land on vulnerable roll frames', () => {
  for (const back of [false, true]) for (const f of [1, 3, 4, back ? 23 : 19, back ? 24 : 20, 35]) {
    const S = setup(); roll(S, back); run(S, f - 1, { ...HOLD, mx: back ? -1 : 1 });
    const hp = S.ecs.hp[S.b]; blow(S);
    assert.equal(S.ecs.hp[S.b] === hp, f >= 4 && f <= (back ? 23 : 19), `back ${back}, frame ${f}`);
  }
});

test('flick needs a crossing edge and works from the sabre GUARD alias', () => {
  const S = setup(); step(S, { mx: 1, btn: BTN.GUARD, prs: BTN.GUARD });
  step(S, { mx: 1, btn: BTN.GUARD }); assert.equal(S.ecs.rollT[S.b], 0);
  step(S, { btn: BTN.GUARD }); step(S, { mx: 1, btn: BTN.GUARD });
  assert.equal(S.ecs.rollT[S.b], 1);
  run(S, 34, { mx: 1, btn: BTN.GUARD }); step(S, { mx: 1, btn: BTN.GUARD });
  assert.ok(S.ecs.guardT[S.b] >= 0); assert.equal(S.ecs.rollT[S.b], 0);
});

test('jump IASA leaves shield on the press tick, airborne by the next tick without drop lag', () => {
  for (const pistol of [false, true]) {
    const S = setup(1, pistol); S.w.jumpMode = 'game'; step(S, RAISE);
    step(S, { btn: BTN.DASH | BTN.JUMP, prs: BTN.JUMP });
    assert.ok(S.ecs.jmpAct[S.b] > 0); assert.ok(S.ecs.guardT[S.b] < 0); assert.equal(S.ecs.guardLag[S.b], 0);
    step(S, { btn: BTN.JUMP }); assert.ok(S.ecs.y[S.b] > S.w.map.groundAt(S.ecs.x[S.b], S.ecs.z[S.b]));
  }
  const off = setup(); step(off, RAISE); step(off, { ...HOLD, prs: BTN.JUMP });
  assert.equal(off.ecs.jmpAct[off.b], 0); assert.ok(off.ecs.guardT[off.b] >= 0);
});

test('GameClient prediction agrees with World through roll end and ACK replay', () => {
  for (const back of [false, true]) {
    const S = setup(), { w, ecs, b } = S;
    const client = new GameClient({ onSnapshot() {}, onMessage() {}, sendInput(_seq, cmd) { w.applyCommand(b, cmd); } }, w.map, { emit() {} });
    client.onMessage({ t: MSG.WELCOME, you: b, melee: 1 });
    const e = client.youLocal; client.pred.setPlayerState(e, w.playerState(b)); client.awaitingFirst = false;
    let ack;
    for (let i = 0; i < 37; i++) {
      client.tickInput({ mx: i > 0 ? (back ? -1 : 1) : 0, mz: 0, ax: ecs.x[b] + 10, az: ecs.z[b], btn: BTN.DASH, prs: i === 0 ? BTN.DASH : 0 });
      near(client.pred.ecs.x[e], ecs.x[b], 0.01); near(client.pred.ecs.z[e], ecs.z[b], 0.01);
      for (const k of ['rollT', 'rollBack', 'rollX', 'rollZ', 'shieldStick', 'act']) {
        assert.ok(PLAYER_FIELDS.includes(k)); assert.equal(client.pred.ecs[k][e], ecs[k][b], k);
      }
      if (i === 8) ack = [client.seq, w.playerState(b)];
      if (i === 12) {
        client.reconcile(...ack);
        near(client.pred.ecs.x[e], ecs.x[b], 0.01); near(client.pred.ecs.z[e], ecs.z[b], 0.01);
        assert.equal(client.pred.ecs.rollT[e], ecs.rollT[b]);
      }
    }
    assert.equal(ecs.rollT[b], 0); assert.ok(ecs.guardT[b] >= 0);
  }
});

test('keyboard, pad and touch send a held DASH bit and release it', () => {
  const oldListen = globalThis.addEventListener, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), handlers = {};
  globalThis.addEventListener = (name, fn) => { handlers[name] = fn; };
  let pad;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pad ? [pad] : [] } });
  try {
    const input = new Input({ addEventListener() {} }); input.enabled = true;
    for (const jump of [false, true]) {
      input.setJump(jump); const code = jump ? 'ShiftLeft' : 'Space';
      handlers.keydown({ code, preventDefault() {} }); assert.ok(input.held & BTN.DASH); assert.ok(input.pressed & BTN.DASH);
      handlers.keyup({ code }); assert.equal(input.held & BTN.DASH, 0);
      pad = { connected: true, axes: [], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === (jump ? 1 : 0) })) };
      input.pollPad(); assert.ok(input.held & BTN.DASH);
      pad.buttons.forEach(b => b.pressed = false); input.pollPad(); assert.equal(input.held & BTN.DASH, 0);
    }
    input.pressDash(); assert.ok(input.held & BTN.DASH); input.releaseDash(); assert.equal(input.held & BTN.DASH, 0);
    input.pressDash(); handlers.blur(); assert.equal(input.held & BTN.DASH, 0);
  } finally {
    globalThis.addEventListener = oldListen;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  }
});
