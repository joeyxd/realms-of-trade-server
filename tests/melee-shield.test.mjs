import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitlagFrames, meleePercent } from '../src/sim/meleeHit.js';
import { LAWLESS, MELEE_GUARD as MG } from '../src/data/lawless.js';
import { DT, tuning } from '../src/data/tuning.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PTYPE, SHOT } from '../src/sim/projectiles.js';
import { calaDuel } from './cala-duel.mjs';
import { arena, incoming } from './helpers.mjs';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const RAISE = { btn: BTN.GUARD, prs: BTN.GUARD }, HOLD = { btn: BTN.GUARD };
const cmd = (w, e, extra = {}) => ({ seq: w.ecs.lastSeq[e] + 1, mx: 0, mz: 0, ax: w.ecs.x[e] + 10, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...extra });
const step = (S, e, extra) => S.w.applyCommand(e, cmd(S.w, e, extra));
const run = (S, e, n, extra) => { for (let i = 0; i < n; i++) step(S, e, extra); };
const thaw = (S, e) => { while (S.ecs.hitlag[e] > 0) step(S, e); }; // the commands hitlag swallows

function duel(version = 1) {
  const S = calaDuel(), { w, ecs, a, b } = S;
  w.meleeVersion = version; w.rng = Object.assign(() => 1, w.rng);
  ecs.facing[a] = Math.PI / 2; ecs.facing[b] = -Math.PI / 2;
  ecs.needs[a] = ecs.needs[b] = 0; // no hunger or thirst scaling on the regen
  return S;
}
// a's jab 1 (or stage n) on whoever stands in reach, with its hitbox out. Returns the Melee damage it does to b.
function jab(S, n = 1) {
  const { ecs, w, a, b } = S, st = tuning.melee.stages[n - 1];
  ecs.atkStage[a] = n; ecs.atkT[a] = 5 * DT; ecs.swingId[a]++;
  w.events.length = 0;
  w.meleeHits(a, st, w.tick, 1);
  return meleePercent(ecs.atk[a] * st.mult * LAWLESS.pvpDmg, ecs.maxHp[b], LAWLESS.meleeStamina);
}
const swing = (S, e, n = 1) => { S.ecs.atkStage[e] = n; S.ecs.atkT[e] = 5 * DT; S.ecs.swingId[e]++; };
const ssOf = (d) => Math.floor((d * MG.stunMul + MG.stunAdd) * 200 / 201);
const evs = (S, type) => S.w.events.filter((ev) => ev.type === type);

test('the shield drains per frame held and regains per frame once it is down', () => {
  const S = duel(), { ecs, b } = S, base = ecs.guardSt[b];
  step(S, b, RAISE); assert.ok(ecs.guardT[b] >= 0); near(ecs.guardSt[b], base - MG.drain);
  run(S, b, 3, HOLD); near(ecs.guardSt[b], base - 4 * MG.drain);
  run(S, b, 4); // released at once, but the shield cannot drop before its 8th frame
  assert.ok(ecs.guardT[b] >= 0); near(ecs.guardSt[b], base - 8 * MG.drain);
  step(S, b); assert.ok(ecs.guardT[b] < 0); near(ecs.guardSt[b], base - 8 * MG.drain);
  step(S, b); near(ecs.guardSt[b], base - 8 * MG.drain + MG.regen);
  run(S, b, 10); near(ecs.guardSt[b], base - 8 * MG.drain + 11 * MG.regen, 1e-9);
});

test('a released shield holds 8 frames, then the 15-frame drop lag blocks an attack but not a dash', () => {
  const S = duel(), { ecs, b } = S;
  step(S, b, RAISE); run(S, b, 6);
  assert.ok(ecs.guardT[b] >= 0, 'still up on frame 7 though released');
  step(S, b); assert.ok(ecs.guardT[b] >= 0, 'frame 8');
  step(S, b, { btn: BTN.ATTACK, prs: BTN.ATTACK }); // the 9th command drops it; the attack press is ignored
  assert.ok(ecs.guardT[b] < 0); assert.equal(ecs.atkStage[b], 0); assert.equal(ecs.atkBuf[b], 0);
  assert.equal(ecs.guardLag[b], MG.dropLag - 1);
  // 14 more commands of lag with the attack pressed each time
  for (let i = 0; i < MG.dropLag - 1; i++) {
    step(S, b, { btn: BTN.ATTACK, prs: BTN.ATTACK });
    assert.equal(ecs.atkStage[b], 0, 'lag frame ' + i); assert.equal(ecs.moveMul[b], i === MG.dropLag - 2 ? 1 : 0);
  }
  step(S, b, { btn: BTN.ATTACK, prs: BTN.ATTACK }); assert.equal(ecs.atkStage[b], 1, 'the swing starts after the lag');
  const D = duel(); step(D, D.b, RAISE); run(D, D.b, 8); assert.ok(D.ecs.guardT[D.b] < 0);
  step(D, D.b, { mx: 1, prs: BTN.DASH, btn: BTN.DASH });
  assert.ok(D.ecs.dashT[D.b] >= 0, 'a dash works inside the lag'); assert.equal(D.ecs.guardLag[D.b], 0);
});

test('a jab on a shield older than 4 frames: no HP loss, 0.7 d shield damage, shieldstun, hitlag and slides', () => {
  const S = duel(), { w, ecs, a, b } = S;
  step(S, b, RAISE); run(S, b, 5, HOLD); // age 6
  const hp = ecs.hp[b], st = ecs.guardSt[b], d = jab(S);
  const ev = evs(S, 'duel')[0], g = evs(S, 'guard')[0], hl = hitlagFrames(d), ss = ssOf(d);
  assert.equal(ecs.hp[b], hp); assert.equal(ev.out, 'block'); assert.equal(g.st, 'block'); assert.ok(!g.ps);
  near(ecs.guardSt[b], st - MG.dmgMul * d, 1e-9); near(g.sd, Math.round(MG.dmgMul * d * 10) / 10, 1e-9);
  assert.equal(ecs.hitlag[b], hl); assert.equal(ecs.hitlag[a], hl); assert.equal(ev.hl, hl);
  assert.equal(ecs.guardStun[b], ss); assert.equal(g.ss, ss); assert.equal(ev.ss, ss);
  const unit = LAWLESS.meleeUnit * 60, fl = Math.floor(d);
  const vDef = Math.min(MG.pushDefMax, (fl * MG.pushDef[0] + MG.pushDef[1]) * MG.pushDefMul) * unit, vAtk = (fl * MG.pushAtk[0] + MG.pushAtk[1]) * unit;
  near(ecs.lvx[b], vDef); near(ecs.lvz[b], 0); near(ecs.lvx[a], -vAtk); assert.ok(ecs.lvx[b] > 0 && ecs.lvx[a] < 0, 'apart');
  console.log(`# Marth jab 1 on a fresh ${ecs.maxHp[b]}-HP pirate's shield: d ${d.toFixed(2)}, shield damage ${(MG.dmgMul * d).toFixed(3)}, ` +
    `shieldstun ${ss}, hitlag ${hl}, defender push ${vDef.toFixed(3)} u/s, attacker push ${vAtk.toFixed(3)} u/s`);
  // shieldstun: the released shield stays up, dash and jump are held, then it drops
  thaw(S, b);
  for (let i = 0; i < ss; i++) {
    step(S, b, { prs: BTN.DASH | BTN.JUMP });
    assert.ok(ecs.guardT[b] >= 0, 'stun frame ' + i); assert.ok(ecs.dashT[b] < 0); assert.equal(ecs.moveMul[b], 0);
  }
  step(S, b); assert.ok(ecs.guardT[b] < 0, 'it drops once the stun is over');
  assert.equal(w.ecs.hp[b], hp);
});

test('a powershield on frame 1-4 takes no shield damage and leaves a 1-frame drop lag', () => {
  const S = duel(), { ecs, a, b } = S;
  step(S, b, RAISE); step(S, b, HOLD); // age 2
  const st = ecs.guardSt[b], d = jab(S), g = evs(S, 'guard')[0];
  assert.equal(g.st, 'perfect'); assert.equal(g.ps, 1); assert.equal(g.sd, 0);
  near(ecs.guardSt[b], st); assert.equal(ecs.hitlag[b], hitlagFrames(d)); assert.equal(ecs.hitlag[a], hitlagFrames(d));
  assert.equal(ecs.guardStun[b], ssOf(d)); assert.equal(evs(S, 'duel')[0].out, 'perfect'); assert.equal(ecs.catchN[b], 0);
  const vDef = Math.min(MG.pushDefMax, (Math.floor(d) * MG.pushDef[0] + MG.pushDef[1]) * MG.pushDefPower) * LAWLESS.meleeUnit * 60;
  near(ecs.lvx[b], vDef);
  thaw(S, b); run(S, b, ssOf(d) + 1); // through the stun and the 8th frame, released
  step(S, b, { btn: BTN.ATTACK, prs: BTN.ATTACK });
  assert.ok(ecs.guardT[b] < 0); assert.equal(ecs.guardLag[b], 0);
  step(S, b, { btn: BTN.ATTACK, prs: BTN.ATTACK }); assert.equal(ecs.atkStage[b], 1, 'attack possible 1 frame after the drop');
  const L = duel(); step(L, L.b, RAISE); run(L, L.b, 4, HOLD); // age 5: too late
  jab(L); assert.equal(evs(L, 'guard')[0].st, 'block');
});

const SEQ = MG.breakFly + MG.breakDown + MG.breakStand; // 136 frames of flight, fall and stand-up before the dizzy
// b's shield breaks under a's jab (b hurt 40, 0.6 shield left); b's hitlag is thawed. Returns b's HP and the dizzy frames.
function breakShield(S) {
  const { ecs, b } = S;
  ecs.hp[b] = ecs.maxHp[b] - 40; ecs.guardSt[b] = 2;
  step(S, b, RAISE); run(S, b, 4, HOLD); // age 5, 0.6 left
  const hp = ecs.hp[b], p = meleePercent(ecs.maxHp[b] - hp, ecs.maxHp[b], LAWLESS.meleeStamina);
  jab(S); thaw(S, b);
  return { hp, dz: Math.floor(400 - p) + 90 };
}

test('a break resets the shield to 30, flies, falls and stands up for 136 frames, then a mashable dizzy; a launching hit ends it', () => {
  const S = duel(), { w, ecs, a, b } = S;
  ecs.hp[b] = ecs.maxHp[b] - 40; ecs.guardSt[b] = 2;
  step(S, b, RAISE); run(S, b, 4, HOLD); // age 5, 0.6 left
  const hp = ecs.hp[b], p = meleePercent(ecs.maxHp[b] - hp, ecs.maxHp[b], LAWLESS.meleeStamina), dz = Math.floor(400 - p) + 90;
  jab(S);
  const g = evs(S, 'guard')[0];
  assert.equal(g.st, 'break'); assert.equal(g.dz, dz); assert.equal(ecs.hp[b], hp);
  assert.equal(ecs.guardSt[b], MG.breakReset); assert.ok(ecs.guardT[b] < 0); assert.equal(ecs.dizzy[b], dz); assert.equal(ecs.brk[b], SEQ);
  near(ecs.stagger[b], (SEQ + dz) * DT); assert.ok(ecs.hitlag[b] > 0);
  assert.deepEqual([g.hl, g.fly, g.down, g.stand], [ecs.hitlag[b], 60, 26, 50]); near(g.h, MG.breakHeight * LAWLESS.meleeUnit, 1e-9);
  thaw(S, b);
  for (let i = 1; i <= SEQ; i++) { // the sequence runs down on its own: mashing and the stick do nothing yet
    step(S, b, { prs: BTN.ATTACK | BTN.DASH, mx: 1 });
    assert.equal(ecs.dizzy[b], dz); assert.equal(ecs.brk[b], SEQ - i); near(ecs.stagger[b], (SEQ - i + dz) * DT);
  }
  step(S, b, { mx: 1 }); assert.equal(ecs.dizzy[b], dz - 1, 'the dizzy starts on frame 137; the stick held since the sequence is not new');
  step(S, b, { prs: BTN.ATTACK }); assert.equal(ecs.dizzy[b], dz - 1 - 1 - 3);
  step(S, b, { prs: BTN.ATTACK | BTN.DASH }); assert.equal(ecs.dizzy[b], dz - 5 - 1 - 6);
  step(S, b, { mx: 1 }); assert.equal(ecs.dizzy[b], dz - 12 - 1 - 3, 'a new stick direction counts');
  step(S, b, { mx: 1 }); assert.equal(ecs.dizzy[b], dz - 16 - 1, 'a held stick does not');
  assert.ok(ecs.stagger[b] > 0); step(S, b, { btn: BTN.GUARD, prs: BTN.GUARD | BTN.ATTACK });
  assert.ok(ecs.guardT[b] < 0 && ecs.atkStage[b] === 0, 'a dizzy pirate cannot act');
  ecs.hitlag[a] = 0;
  w.strike(b, 14, { by: a, kind: 'skill', skill: 'lunge', x: ecs.x[a], z: ecs.z[a] });
  assert.equal(ecs.dizzy[b], 0); assert.ok(ecs.stagger[b] > 0 && ecs.stagger[b] < dz * DT / 2);
});

test('the break sequence is intangible for its first 117 frames: nothing lands, nothing is credited; a hit in the last 19 ends it', () => {
  const S = duel(), { w, ecs, a, b } = S, { hp, dz } = breakShield(S);
  const m = w.spawnEnemy('grunt', ecs.x[b] + 3.5, ecs.z[b]); // out of a's reach
  const pid = incoming(w, b, PTYPE.PARRY, 0.4, 0, 14); w.tick += 10; // a mob bullet resting on b
  const seen = new Set(['hurt', 'phit', 'dodge', 'graze', 'ghost', 'mercy', 'duel', 'guard']), xp = ecs.xp[b], xpA = ecs.xp[a];
  for (let f = 1; f <= 117; f++) {
    jab(S); // b's state here is brk = 137 - f: 136 down to 20
    assert.equal(ecs.brk[b], 137 - f); assert.equal(ecs.hp[b], hp, 'jab, frame ' + f); assert.deepEqual(w.events.filter((ev) => seen.has(ev.type)), []);
    if (f > 116) break; // b's own command sees the count one lower: its hazards are checked up to frame 116
    const c = w.addAoe({ owner: m, x: ecs.x[b], z: ecs.z[b], r: 1, tAct: w.tick, dmg: 9, sx: ecs.x[m], sz: ecs.z[m] });
    w.events.length = 0;
    step(S, b, { prs: BTN.ATTACK | BTN.DASH, mx: f % 2 ? 1 : -1, mz: f % 3 ? 1 : 0 });
    assert.deepEqual(c.hits.map((h) => h.e), [b], 'the circle burst on b'); assert.ok(!c.cancel);
    assert.equal(ecs.hp[b], hp, 'circle, bullet, frame ' + f); assert.deepEqual(w.events.filter((ev) => seen.has(ev.type)), []);
    assert.equal(ecs.dizzy[b], dz);
  }
  assert.ok(w.hazards.hasMark(w.hazards.slot.get(pid), b, 'p'), 'the bullet passed through');
  assert.equal(ecs.xp[b], xp); assert.equal(ecs.xp[a], xpA);
  // frames 118 to 136: hittable, and a launching hit ends the sequence and the dizzy
  step(S, b); assert.equal(ecs.brk[b], 19);
  jab(S);
  assert.ok(ecs.hp[b] < hp); assert.equal(ecs.brk[b], 0); assert.equal(ecs.dizzy[b], 0);
  const T = duel(), { hp: hpT } = breakShield(T); run(T, T.b, SEQ - 1); assert.equal(T.ecs.brk[T.b], 1);
  jab(T); assert.ok(T.ecs.hp[T.b] < hpT); assert.equal(T.ecs.brk[T.b], 0); assert.equal(T.ecs.dizzy[T.b], 0);
});

test('clank with equal blows cancels both: no damage, hitlag, rebound and a clank event', () => {
  const S = duel(), { ecs, a, b } = S;
  ecs.atk[a] = ecs.atk[b] = 20; swing(S, b);
  const hpA = ecs.hp[a], hpB = ecs.hp[b], d = jab(S);
  assert.ok(d >= 1);
  const rb = Math.ceil(MG.rebound[0] * (Math.floor(d) + MG.rebound[1]));
  for (const e of [a, b]) {
    assert.equal(ecs.atkStage[e], 0); assert.equal(ecs.hitlag[e], hitlagFrames(d)); near(ecs.stagger[e], rb * DT);
  }
  assert.equal(ecs.hp[a], hpA); assert.equal(ecs.hp[b], hpB);
  const c = evs(S, 'clank'); assert.equal(c.length, 1);
  assert.equal(c[0].a, a); assert.equal(c[0].b, b); assert.equal(c[0].ra, rb); assert.equal(c[0].rb, rb);
  near(c[0].x, (ecs.x[a] + ecs.x[b]) / 2);
  assert.deepEqual(evs(S, 'duel').map((ev) => ev.out), ['clank', 'clank']);
  assert.equal(evs(S, 'hurt').length, 0);
  S.w.meleeHits(a, tuning.melee.stages[0], S.w.tick, 1); // the same swing again
  assert.equal(ecs.hp[b], hpB, 'the spent swing does not connect later');
});

test('clank where one blow is 9 or more stronger: the weak one is cancelled, the strong one lands', () => {
  const S = duel(), { ecs, a, b } = S;
  ecs.atk[a] = 60; ecs.atk[b] = 12; swing(S, b);
  const dB = Math.floor(meleePercent(12 * tuning.melee.stages[0].mult * LAWLESS.pvpDmg, ecs.maxHp[a], LAWLESS.meleeStamina));
  const hpB = ecs.hp[b], dA = Math.floor(jab(S));
  assert.ok(dA - MG.clank >= dB, 'premise');
  assert.equal(ecs.atkStage[b], 0); assert.ok(ecs.stagger[b] > 0); assert.equal(ecs.atkStage[a], 1);
  const c = evs(S, 'clank')[0]; assert.equal(c.ra, 0); assert.ok(c.rb > 0);
  assert.deepEqual(evs(S, 'duel').map((ev) => ev.out).filter((o) => o === 'clank'), ['clank']);
  assert.ok(ecs.hp[b] < hpB, 'the survivor connects');
  assert.ok(ecs.hitlag[a] > 0);
});

test('a clank rebound pushes both away: still through the hitlag, then a slide that input does not steer', () => {
  const S = duel(), { w, ecs, a, b } = S;
  ecs.atk[a] = ecs.atk[b] = 20; swing(S, b);
  const d = jab(S), hl = hitlagFrames(d), v = MG.reboundPush * LAWLESS.meleeUnit * 60;
  assert.equal(ecs.hitlag[a], hl); near(ecs.lvx[b], v); near(ecs.lvx[a], -v); near(ecs.lvz[a], 0); near(ecs.lvz[b], 0);
  const xa = ecs.x[a], xb = ecs.x[b], za = ecs.z[a], zb = ecs.z[b];
  for (let i = 0; i < hl - 1; i++) { step(S, a, { mx: 1 }); step(S, b, { mx: -1 }); } // pressing into each other
  assert.equal(ecs.x[a], xa); assert.equal(ecs.x[b], xb); assert.equal(ecs.hitlag[a], 1);
  step(S, a, { mx: 1 }); step(S, b, { mx: -1 }); assert.equal(ecs.hitlag[a], 0); // the last hitlag frame
  run(S, a, 8, { mx: 1 }); run(S, b, 8, { mx: -1 });
  assert.ok(xa - ecs.x[a] > 0.1 && ecs.x[b] - xb > 0.1, 'apart: ' + (xa - ecs.x[a]).toFixed(3) + ', ' + (ecs.x[b] - xb).toFixed(3));
  near(ecs.z[a], za, 1e-9); near(ecs.z[b], zb, 1e-9); void w;
});

// A grunt 0.9 u in front of a, a (ready to jab: stage 1 active) alone in the Cala, and the grunt's bite bursting on it now.
function biteDuel(version = 1, kind = 'grunt', dmg = 9, atk = 60) {
  const S = duel(version), { w, ecs, a, b } = S;
  ecs.dead[b] = 1; ecs.atk[a] = atk; swing(S, a); // b lies out of it (its lagged position would still be struck)
  const m = w.spawnEnemy(kind, ecs.x[a] + 0.9, ecs.z[a]);
  const c = w.addAoe({ owner: m, x: ecs.x[a] + 0.85, z: ecs.z[a], r: 1.05, tAct: w.tick, dmg, sx: ecs.x[m], sz: ecs.z[m] });
  w.events.length = 0;
  const dP = Math.floor(meleePercent(atk * tuning.melee.stages[0].mult, ecs.maxHp[m], LAWLESS.meleeStamina)), dM = Math.floor(meleePercent(c.dmg, ecs.maxHp[a], LAWLESS.meleeStamina));
  return { ...S, m, c, dP, dM, hp: ecs.hp[a] };
}
const reb = (d) => Math.ceil(MG.rebound[0] * (d + MG.rebound[1]));

test('mob clank: a weak bite is cancelled by the pirate jab, which carries on', () => {
  const S = biteDuel(1, 'grunt', 9, 60), { w, ecs, a, m, c, dP, dM, hp } = S;
  assert.ok(dM - MG.clank < dP && !(dP - MG.clank < dM), 'premise');
  step(S, a);
  assert.ok(c.cancel); assert.equal(ecs.hp[a], hp); assert.equal(evs(S, 'hurt').length, 0);
  assert.ok(ecs.hitlag[m] >= hitlagFrames(dM), 'the grunt freezes (longer once the jab lands on it)'); assert.ok(ecs.stagger[m] >= reb(dM) * DT - 1e-9);
  assert.ok(ecs.lvx[m] > 0 && ecs.lvx[a] === 0, 'the grunt slides away from the pirate');
  assert.equal(ecs.atkStage[a], 1);
  const k = evs(S, 'clank'); assert.equal(k.length, 1);
  assert.deepEqual([k[0].a, k[0].b, k[0].ra, k[0].rb], [a, m, 0, reb(dM)]);
  assert.ok(w.ecs.hp[m] < w.ecs.maxHp[m], 'the pirate blow still reaches the grunt');
});

test('mob clank: equal blows cancel both, nobody is hurt', () => {
  const S = biteDuel(1, 'grunt', 9, 9), { ecs, a, m, c, dP, dM, hp } = S;
  assert.ok(dM - MG.clank < dP && dP - MG.clank < dM, 'premise');
  step(S, a);
  assert.ok(c.cancel); assert.equal(ecs.hp[a], hp); assert.equal(ecs.atkStage[a], 0);
  assert.equal(ecs.hitlag[a], hitlagFrames(dP)); assert.equal(ecs.hitlag[m], hitlagFrames(dM));
  assert.ok(ecs.stagger[a] >= reb(dP) * DT - 1e-9 && ecs.stagger[m] >= reb(dM) * DT - 1e-9);
  assert.ok(ecs.lvx[a] < 0 && ecs.lvx[m] > 0, 'apart');
  const k = evs(S, 'clank')[0]; assert.deepEqual([k.ra, k.rb], [reb(dP), reb(dM)]);
  assert.equal(S.w.ecs.hp[m], S.w.ecs.maxHp[m], 'the spent jab does not reach the grunt either');
});

test('mob clank: a bite 9 or more stronger cancels the pirate jab and still lands', () => {
  const S = biteDuel(1, 'grunt', 30, 3), { ecs, a, m, c, dP, dM, hp } = S;
  assert.ok(dP - MG.clank < dM && !(dM - MG.clank < dP), 'premise');
  step(S, a);
  assert.ok(!c.cancel); assert.equal(ecs.atkStage[a], 0); assert.ok(ecs.hp[a] < hp, 'the bite connects');
  const k = evs(S, 'clank')[0]; assert.deepEqual([k.ra > 0, k.rb], [true, 0]);
  assert.equal(evs(S, 'hurt').length, 1); assert.equal(S.w.ecs.hp[m], S.w.ecs.maxHp[m]);
});

test('mob clank: a boss circle never clanks, and with the flag off nobody does', () => {
  const S = biteDuel(1, 'hellfire', 9, 60), { w, ecs, a, c, hp } = S;
  step(S, a);
  assert.equal(evs(S, 'clank').length, 0); assert.ok(!c.cancel); assert.ok(ecs.hp[a] < hp);
  const O = biteDuel(0, 'grunt', 9, 60);
  step(O, O.a);
  assert.equal(O.w.events.filter((ev) => ev.type === 'clank').length, 0); assert.ok(!O.c.cancel); assert.ok(O.ecs.hp[O.a] < O.hp); void w;
});

test('a mob bullet powershielded within 2 frames is caught, circles the pirate and LMB in the shield throws it', () => {
  const { w, e: a } = arena(), ecs = w.ecs;
  w.meleeVersion = 1; ecs.needs[a] = 0;
  incoming(w, a, PTYPE.PARRY, 0.4, 0, 14); w.tick = 10;
  const hp = ecs.hp[a], st = ecs.guardSt[a];
  w.applyCommand(a, cmd(w, a, RAISE));
  assert.equal(ecs.hp[a], hp); assert.ok(!w.events.some((ev) => ev.type === 'hurt'));
  const g = w.events.find((ev) => ev.type === 'guard' && ev.st === 'perfect'); assert.equal(g.ps, 1); assert.equal(g.n, 1);
  assert.ok(!w.events.some((ev) => ev.type === 'parry'), 'caught, not reflected');
  near(ecs.guardSt[a], st - MG.drain);
  assert.equal(ecs.catchN[a], 1); assert.equal(ecs.catchDmg[a], 14);
  const S = w.shots, owned = () => { let n = 0; for (let s = 0; s < S.cap; s++) if (S.id[s] && S.owner[s] === a) n++; return n; };
  assert.equal(owned(), 0);
  assert.ok(ecs.hitlag[a] > 0 && ecs.guardStun[a] === 0, 'a projectile gives hitlag to the defender and no shieldstun');
  while (ecs.hitlag[a] > 0) w.applyCommand(a, cmd(w, a, HOLD));
  assert.ok(ecs.guardT[a] >= 0, 'the shield is still up');
  w.events.length = 0; w.applyCommand(a, cmd(w, a, { ...HOLD, prs: BTN.ATTACK }));
  assert.equal(ecs.catchN[a], 0); assert.equal(owned(), 1); assert.ok(ecs.guardT[a] < 0, 'the throw drops the shield');
  assert.equal(w.events.find((ev) => ev.type === 'release').n, 1);
  // past catchMax the powershield reflects it as the pirate's own shot at half damage
  const F = arena(); F.w.meleeVersion = 1; F.w.ecs.needs[F.e] = 0; F.w.ecs.catchN[F.e] = tuning.guard.catchMax;
  incoming(F.w, F.e, PTYPE.PARRY, 0.4, 0, 14); F.w.tick = 10;
  F.w.applyCommand(F.e, cmd(F.w, F.e, RAISE));
  assert.ok(F.w.events.some((ev) => ev.type === 'parry'));
  const FS = F.w.shots; let found = 0;
  for (let s = 0; s < FS.cap; s++) if (FS.id[s] && FS.owner[s] === F.e) { found++; assert.equal(FS.dmg[s], 7); }
  assert.equal(found, 1); assert.equal(F.w.ecs.catchN[F.e], tuning.guard.catchMax);
  // a later bullet (age 6) is a plain block: shield damage, shieldstun, no reflect
  const B = arena(); B.w.meleeVersion = 1; B.w.ecs.needs[B.e] = 0;
  B.step(RAISE); for (let i = 0; i < 5; i++) B.step(HOLD);
  incoming(B.w, B.e, PTYPE.PARRY, 0.4, 0, 14); B.w.tick += 10;
  const stB = B.w.ecs.guardSt[B.e], out = B.step(HOLD), blk = out.find((ev) => ev.type === 'guard');
  assert.equal(blk.st, 'block'); assert.ok(!out.some((ev) => ev.type === 'parry' || ev.type === 'hurt'));
  near(B.w.ecs.guardSt[B.e], stB - MG.drain - MG.dmgMul * meleePercent(14, B.w.ecs.maxHp[B.e], LAWLESS.meleeStamina), 1e-9);
  assert.ok(B.w.ecs.guardStun[B.e] > 0 && B.w.ecs.hitlag[B.e] > 0); assert.equal(B.w.ecs.hp[B.e], B.w.ecs.maxHp[B.e]);
});

test('a powershielded pirate shot is caught; past catchMax it flies back, owned by the defender, at half damage', () => {
  for (const full of [false, true]) {
    const S = duel(), { w, ecs, a, b } = S;
    if (full) ecs.catchN[b] = tuning.guard.catchMax;
    step(S, b, RAISE); // age 1
    const hp = ecs.hp[b];
    w.spawnShot(a, { key: -9, pid: 0, type: PTYPE.PARRY, x: ecs.x[b] - 0.5, y: ecs.y[b] + 1.1, z: ecs.z[b], dx: 1, dz: 0, speed: 12, dmg: 20,
      life: 2, r: 0.25, heavy: false, seq: 1, bounce: 0, homing: 0, cone: 0, kind: SHOT.BULLET, pt: w.tick });
    w.events.length = 0;
    w.stepShots(DT);
    assert.equal(ecs.hp[b], hp); assert.equal(evs(S, 'guard')[0].ps, 1);
    let back = 0; const sh = w.shots;
    for (let s = 0; s < sh.cap; s++) if (sh.id[s]) { back++; assert.equal(sh.owner[s], b); assert.equal(sh.dmg[s], 10); assert.ok(sh.vx[s] < 0); }
    assert.equal(back, full ? 1 : 0); assert.equal(ecs.catchN[b], full ? tuning.guard.catchMax : 1);
  }
});

test('flag off: a block still lets blockMult through and nothing of the shield rules applies', () => {
  const S = duel(0), { w, ecs, a, b } = S;
  const st = ecs.guardSt[b];
  step(S, b, RAISE); step(S, b, RAISE); assert.ok(ecs.guardT[b] >= 0); near(ecs.guardSt[b], st, 1e-9);
  run(S, b, 20); assert.ok(ecs.guardT[b] < 0 && ecs.guardLag[b] === 0, 'dropped on release, no lag');
  ecs.guardT[b] = 1; ecs.guardP[b] = 0; ecs.guardSt[b] = 60; ecs.hp[b] = ecs.maxHp[b];
  w.events.length = 0; ecs.facing[b] = -Math.PI / 2;
  w.strike(b, 14, { by: a, kind: 'skill', skill: 'gun_r', heavy: true, x: ecs.x[a], z: ecs.z[a] });
  const g = evs(S, 'guard')[0];
  assert.equal(g.st, 'block'); assert.ok(!('ss' in g)); assert.equal(ecs.hitlag[b], 0); assert.equal(ecs.guardStun[b], 0);
  assert.ok(ecs.hp[b] < ecs.maxHp[b], 'blockMult of the blow gets through'); assert.ok(ecs.guardSt[b] < 60);
  assert.equal(ecs.lvx[b], 0);
});
