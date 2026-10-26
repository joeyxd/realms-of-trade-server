import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { LAWLESS, MELEE, MELEE_SMASH } from '../src/data/lawless.js';
import { MELEE_STAGES, MELEE_SMASH_STAGE, swingDescriptor, swingBlow, swingFrame, swingKey } from '../src/data/meleeFrames.js';
import { ACT, PLAYER_FIELDS, ECS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { knockback, meleePercent } from '../src/sim/meleeHit.js';
import { GameClient } from '../src/client/gameClient.js';
import { encodeEntity, ENT } from '../src/net/protocol.js';
import { arena, map } from './helpers.mjs';
import { calaDuel } from './cala-duel.mjs';

const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const press = { prs: BTN.ATTACK, btn: BTN.ATTACK };
function lab(version = 1) {
  const { w, e } = arena(), ecs = w.ecs;
  w.meleeVersion = version; w.rng = Object.assign(() => 1, w.rng);
  const hits = []; let tick = 0;
  w.meleeHits = (id, st) => hits.push({ tick, stage: ecs.atkStage[id], frame: swingFrame(ecs.atkT[id]), st });
  const step = (extra = {}) => {
    tick++;
    const cmd = { seq: ecs.lastSeq[e] + 1, mx: 0, mz: 0, ax: ecs.x[e] + 10, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...extra };
    w.applyCommand(e, cmd); return cmd;
  };
  return { w, ecs, e, step, hits };
}
function heavy(S, smash = true) {
  S.step(press);
  for (let f = 2; f <= 43; f++) S.step([12, 30].includes(f) ? press : {});
  assert.equal(S.ecs.atkStage[S.e], 2);
  S.step(smash ? { btn: BTN.ATTACK } : {}); // jab 2 frame 25 is the heavy's frame 1
  assert.equal(S.ecs.atkStage[S.e], 3);
  assert.equal(S.ecs.atkSmash[S.e], +smash);
  S.hits.length = 0;
}
function charge(S, n) {
  heavy(S);
  for (let f = 2; f <= 4; f++) S.step({ btn: BTN.ATTACK });
  const { ecs, e } = S, pose = ecs.actT[e];
  for (let i = 1; i <= n; i++) {
    S.step({ btn: BTN.ATTACK });
    assert.equal(ecs.chgN[e], Math.min(i, MELEE_SMASH.cap));
    if (i < MELEE_SMASH.cap) { near(ecs.actT[e], pose); assert.equal(swingFrame(ecs.atkT[e]), 4); }
    else assert.equal(swingFrame(ecs.atkT[e]), 5);
  }
}

test('Melee drops an unactionable sabre press; flag off buffers the same press, pistols keep their buffer', () => {
  for (const version of [0, 1]) {
    const S = lab(version), { ecs, e } = S;
    ecs.stagger[e] = 3 * DT;
    S.step(press); assert.equal(ecs.atkStage[e], 0);
    S.step(); S.step(); S.step();
    assert.equal(ecs.atkStage[e], version ? 0 : 1);
    const G = lab(version); G.ecs.guardLag[G.e] = 3;
    G.step(press);
    for (let i = 0; i < 5; i++) G.step();
    assert.equal(G.ecs.atkStage[G.e], version ? 0 : 1);
  }
  const S = lab(), { ecs, e } = S;
  ecs.weapon[e] = 1; ecs.shotCd[e] = 5 * DT;
  S.step(press); assert.ok(ecs.atkBuf[e] > 0);
  for (let i = 0; i < 8; i++) S.step();
  assert.equal(ecs.shotN[e], 1);
});

for (const [at, link] of [[10, 20], [12, 20], [19, 20], [20, 21], [22, 23], [25, 26]]) {
  test(`jab 1 press on ${at} links on ${link}, never on the press command`, () => {
    const S = lab(), { ecs, e } = S;
    S.step(press);
    for (let f = 2; f < link; f++) { S.step(f === at ? press : {}); assert.equal(ecs.atkStage[e], 1); }
    S.step(); assert.equal(ecs.atkStage[e], 2); assert.equal(swingFrame(ecs.atkT[e]), 1);
    assert.equal(ecs.atkBuf[e], 0);
  });
}

test('early presses reject the whole blow, late presses drop, and neither leaves a rest buffer', () => {
  for (const at of [5, 26, 27]) {
    const S = lab(), { ecs, e } = S;
    S.step(press);
    for (let f = 2; f <= 27; f++) {
      S.step(f === at || (at === 5 && f === 12) ? press : {});
      if (f === 5 && at === 5) assert.equal(ecs.atkRej[e], 1);
      if (f < 27) assert.equal(ecs.atkStage[e], 1);
    }
    assert.equal(ecs.atkStage[e], 0); S.step(); assert.equal(ecs.atkStage[e], 0);
    assert.deepEqual(S.w.events.filter((ev) => ev.type === 'swing').map((ev) => ev.stage), [1]);
  }
});

test('an early press in a running blow buffers another stage only with MN_MELEE off', () => {
  for (const version of [0, 1]) {
    const S = lab(version); S.step(press); let linked = false;
    for (let f = 2; f <= 35; f++) {
      S.step(f === 5 ? press : {});
      linked ||= S.ecs.atkStage[S.e] === 2;
    }
    assert.equal(linked, !version);
  }
});

test('jab 2 opens on 6, closes on 24 and links the heavy only on 25', () => {
  for (const at of [5, 6, 24, 25]) {
    const S = lab(), { ecs, e } = S; S.step(press);
    for (let f = 2; f <= 20; f++) S.step(f === 12 ? press : {});
    for (let f = 2; f <= 25; f++) S.step(f === at ? press : {});
    assert.equal(ecs.atkStage[e], at === 6 || at === 24 ? 3 : 2);
  }
});

test('released heavy is the 7-10 / 35 tilt; held link is a 10-13 / 49 smash, release on 3 is uncharged', () => {
  for (const smash of [false, true]) {
    const S = lab(), { ecs, e } = S; heavy(S, smash);
    S.step({ btn: smash ? BTN.ATTACK : 0 }); S.step(); // release on frame 3
    // Once released in the charge window, pressing again cannot re-arm charging.
    for (let f = 4; f <= (smash ? 49 : 35); f++) S.step({ btn: BTN.ATTACK });
    assert.deepEqual(S.hits.map((h) => h.frame), smash ? [10, 11, 12, 13] : [7, 8, 9, 10]);
    assert.ok(S.hits.every((h) => h.st.total === (smash ? 49 : 35)));
    near(S.hits[0].st.mult, MELEE_STAGES[2].mult);
    assert.equal(ecs.atkStage[e], 0); assert.equal(ecs.chgN[e], 0);
  }
});

for (const [n, mul] of [[30, 1.2], [60, 1.4]]) {
  test(`${n} charge commands release correctly and multiply own damage by ${mul}`, () => {
    const S = lab(), { ecs, e } = S; charge(S, n);
    if (n < 60) S.step();
    assert.equal(swingFrame(ecs.atkT[e]), 5); assert.equal(ecs.chgN[e], n);
    while (!S.hits.length) S.step(n === 60 ? { btn: BTN.ATTACK } : {});
    assert.equal(S.hits[0].tick, 43 + 10 + n - (n === 60 ? 1 : 0));
    near(S.hits[0].st.mult, MELEE_STAGES[2].mult * mul);
    near(S.hits[0].st.windup, (9 + n) * DT);
    assert.equal(ecs.act[e], ACT.SMASH); assert.equal(ecs.chgN[e], n);
  });
}

test('the frozen charge locks all body actions and skills and has no armor', () => {
  const S = lab(), { ecs, e, w } = S; w.jumpMode = 'game'; charge(S, 5);
  const x = ecs.x[e], z = ecs.z[e], pose = ecs.actT[e];
  ecs.riposte[e] = tuning.parry.riposte.max;
  for (let i = 0; i < 10; i++) {
    S.step({ mx: 1, btn: BTN.ATTACK | BTN.GUARD | BTN.DASH | BTN.Q, prs: BTN.GUARD | BTN.DASH | BTN.JUMP | BTN.Q | BTN.R });
    near(ecs.x[e], x); near(ecs.z[e], z); near(ecs.actT[e], pose);
    assert.equal(ecs.guardT[e], -1); assert.equal(ecs.rollT[e], 0); assert.equal(ecs.dashT[e], -1);
    assert.equal(ecs.jmpAct[e], 0); assert.equal(ecs.castK[e], 0); assert.equal(ecs.rBuf[e], 0);
    assert.equal(ecs.atkStage[e], 3);
  }
  const hp = ecs.hp[e];
  hurtPlayer(w, e, 14, { kind: 'aoe', x: x + 1, z, seq: ecs.lastSeq[e], owner: 0, melee: true });
  assert.ok(ecs.hp[e] < hp); assert.equal(ecs.atkStage[e], 0); assert.ok(ecs.hitlag[e] > 0);
});

test('tilt and smash hits use their captured knockback rows against a pirate and a mob', () => {
  for (const mob of [false, true]) for (const smash of [false, true]) {
    const S = calaDuel(), { w, ecs, a, b } = S;
    w.meleeVersion = 1; w.rng = Object.assign(() => 1, w.rng);
    const victim = mob ? w.spawnEnemy('dummy', ecs.x[a] + 1.6, ecs.z[a]) : b;
    if (mob) ecs.x[b] += 20;
    ecs.atkStage[a] = 3; ecs.atkSmash[a] = +smash; ecs.chgN[a] = 30; ecs.swingId[a]++;
    ecs.atkT[a] = (smash ? 10 : 7) * DT; ecs.facing[a] = Math.PI / 2;
    w.events.length = 0;
    const strike = w.strike.bind(w);
    w.strike = (target, raw, o) => { ecs.atkSmash[a] = ecs.chgN[a] = 0; return strike(target, raw, o); };
    w.meleeHits(a, swingDescriptor(1, ecs, a), w.tick, 1);
    const ev = w.events.findLast((v) => v.type === (mob ? 'damage' : 'duel') && (mob ? v.id === victim : v.e === victim));
    assert.ok(ev, JSON.stringify(w.events));
    const d = meleePercent(ev.dmg, mob ? 100 : ecs.maxHp[victim], LAWLESS.meleeStamina);
    const p = meleePercent(ecs.maxHp[victim] - ecs.hp[victim], mob ? 100 : ecs.maxHp[victim], LAWLESS.meleeStamina);
    const row = MELEE[swingKey(3, +smash)]; assert.equal(row.bkb, smash ? 60 : 30);
    near(ev.kb, Math.round(knockback(p, d, 87, row.bkb, 70) * 10) / 10);
    if (!mob) { assert.equal(ev.skill, smash ? 'melee3s' : 'melee3'); near(ev.tele, Math.round((smash ? 39 : 6) * DT * 1000) / 1000); }
  }
});

for (const frame of [10, 11]) test(`charged smash frame ${frame} wins the clank with its own damage; jab cancels`, () => {
  const S = calaDuel(), { w, ecs, a, b } = S; w.meleeVersion = 1; w.rng = Object.assign(() => 1, w.rng);
  ecs.facing[a] = Math.PI / 2; ecs.facing[b] = -Math.PI / 2;
  ecs.atkStage[a] = 1; ecs.atkT[a] = 4 * DT; ecs.swingId[a]++;
  ecs.atkStage[b] = 3; ecs.atkSmash[b] = 1; ecs.chgN[b] = 60; ecs.atkT[b] = frame * DT; ecs.swingId[b]++;
  ecs.atk[a] = ecs.atk[b] = 20;
  const st = swingDescriptor(1, ecs, b), jab = swingDescriptor(1, ecs, a);
  assert.ok(Math.floor(20 * st.mult * LAWLESS.pvpDmg) - Math.floor(20 * jab.mult * LAWLESS.pvpDmg) >= 9);
  assert.ok(Math.floor(20 * MELEE_STAGES[2].mult * LAWLESS.pvpDmg) - Math.floor(20 * jab.mult * LAWLESS.pvpDmg) < 9, 'uncharged damage would cancel both');
  assert.equal(w.clank(a, b, jab), true); assert.equal(ecs.atkStage[a], 0); assert.equal(ecs.atkStage[b], 3);
  const clank = w.events.findLast((ev) => ev.type === 'clank'); assert.ok(clank.ra > 0); assert.equal(clank.rb, 0);
});

test('mob clank reads the charged smash damage and its frame 11 hitbox', () => {
  const S = lab(), { w, ecs, e } = S;
  const mob = w.spawnEnemy('grunt', ecs.x[e] + 1, ecs.z[e]);
  ecs.atkStage[e] = 3; ecs.atkSmash[e] = 1; ecs.chgN[e] = 60; ecs.atkT[e] = 11 * DT;
  ecs.atk[e] = 10; ecs.facing[e] = Math.PI / 2;
  const circle = { owner: mob, dmg: 10 };
  assert.ok(Math.floor(10 * MELEE_STAGES[2].mult) - 10 < 9, 'uncharged would cancel both');
  w.clankMob(e, circle);
  assert.equal(circle.cancel, true); assert.equal(ecs.atkStage[e], 3);
  const ev = w.events.findLast((v) => v.type === 'clank'); assert.equal(ev.ra, 0); assert.ok(ev.rb > 0);
});

test('GameClient predicts the same links, charge count, frozen pose and hit command as World, including reconciliation', () => {
  const S = lab(), { w, ecs, e } = S, sent = [], feedback = [];
  const client = new GameClient({ onSnapshot() {}, onMessage() {}, sendInput(_seq, cmd) { sent.push(cmd); } }, map,
    { emit(type, ev) { if (type === 'combat' && ev.type === 'mhit') feedback.push(ev); } });
  client.pred.meleeVersion = 1; client.youLocal = client.pred.spawnPlayer({}); client.youServer = e; client.awaitingFirst = false;
  client.pred.setPlayerState(client.youLocal, w.playerState(e));
  client.entities.set(999, { id: 999, ready: true, enemy: true, r: { x: ecs.x[e] + 1, z: ecs.z[e] } });
  let hitFrame = 0;
  for (let f = 1; f <= 88; f++) {
    const input = { mx: 0, mz: 0, ax: ecs.x[e] + 10, az: ecs.z[e], prs: [1, 12, 30].includes(f) ? BTN.ATTACK : 0,
      btn: [1, 12, 30].includes(f) || (f >= 44 && f <= 77) ? BTN.ATTACK : 0 };
    client.tickInput(input); w.applyCommand(e, sent.at(-1));
    for (const k of ['atkStage', 'chgN', 'atkSmash', 'atkT', 'actT']) near(client.pred.ecs[k][client.youLocal], ecs[k][e]);
    if (ecs.atkStage[e] === 3 && swingFrame(ecs.atkT[e]) === 10) hitFrame = f;
    if (f === 60) client.reconcile(sent.at(-1).seq, w.playerState(e));
  }
  assert.equal(hitFrame, 83); // heavy starts on 44, thirty paid charge frames
  assert.equal(feedback.findLast((ev) => ev.stage === 3).seq, hitFrame);
  assert.equal(client.pred.ecs.chgN[client.youLocal], 30);
});

test('ACT 34 and the appended fields survive snapshots, reset and entity reuse without protocol edits', () => {
  const { w, e } = lab(); w.ecs.act[e] = ACT.SMASH;
  assert.equal(ACT.SMASH, 34); assert.equal(encodeEntity(w.ecs, e)[ENT.ACT], 34);
  assert.deepEqual(PLAYER_FIELDS.slice(-5), ['atkRej', 'atkLink', 'atkSmash', 'chgN', 'chgStop']);
  const ecs = new ECS(4), id = ecs.create(1);
  for (const k of PLAYER_FIELDS.slice(-5)) ecs[k][id] = 10;
  ecs.destroy(id); const next = ecs.create(1); assert.equal(next, id);
  for (const k of PLAYER_FIELDS.slice(-5)) assert.equal(ecs[k][id], 0);
  assert.equal(swingBlow(0, 3, 1, 60), tuning.melee.stages[2]);
  assert.equal(MELEE_SMASH_STAGE.total, 49);
});
