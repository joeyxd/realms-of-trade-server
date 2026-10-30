import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arena } from './helpers.mjs';
import { OPEN } from './cala-duel.mjs';
import { ACT, C, GRAB_FIELDS, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { DT } from '../src/data/tuning.js';
import { LAWLESS, MELEE_GRAB as G } from '../src/data/lawless.js';
import { hurtPlayer, killPlayer } from '../src/sim/systems/combat.js';
import { World } from '../src/sim/world.js';

const INPUT = { prs: BTN.ATTACK, mx: 1 }; // LMB pushing into the touching body (ours, 2026-10-30)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function setup(version = 1) {
  const { w, e: a } = arena({ x: OPEN.x, z: OPEN.z }), ecs = w.ecs;
  const b = w.spawnPlayer({ x: OPEN.x + 0.95, z: OPEN.z, facing: -Math.PI / 2 });
  w.meleeVersion = version; w.rng = Object.assign(() => 1, w.rng);
  ecs.needs[a] = ecs.needs[b] = 0;
  return { w, ecs, a, b };
}
const command = (S, e, o = {}) => ({ seq: S.ecs.lastSeq[e] + 1, pt: S.w.tick, mx: 0, mz: 0,
  ax: S.ecs.x[e === S.a ? S.b : S.a], az: S.ecs.z[e === S.a ? S.b : S.a], btn: 0, prs: 0, ...o });
function tick(S, a = {}, b = {}, reverse = false) {
  for (const e of reverse ? [S.b, S.a] : [S.a, S.b]) if (S.ecs.alive[e] && (S.ecs.mask[e] & C.PLAYER))
    S.w.applyCommand(e, command(S, e, e === S.a ? a : b));
  S.w.stepWorld();
}
const run = (S, n, a, b) => { for (let i = 0; i < n; i++) tick(S, a, b); };
function connect(S = setup(), shield = false) {
  tick(S, INPUT, shield ? { btn: BTN.GUARD, prs: BTN.GUARD } : {});
  run(S, 6, {}, shield ? { btn: BTN.GUARD } : {});
  assert.equal(S.ecs.grabSt[S.a], ACT.GRAB_WAIT); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE);
  return S;
}
const damage = (S, e, raw = 4, by = 0) => hurtPlayer(S.w, e, raw,
  { x: S.ecs.x[e] - 1, z: S.ecs.z[e], kind: 'proj', by, pierce: true, noInv: true, seq: 0 });

test('attack pushing into a touching body starts Catch; active only 7-8, whiff lasts 30 and locks movement/facing', () => {
  const S = setup(), { ecs, a, b } = S;
  tick(S, INPUT); assert.equal(ecs.grabT[a], 1); assert.equal(ecs.grabSt[a], ACT.GRAB);
  run(S, 5, { mx: -1, prs: BTN.DASH | BTN.Q, ax: ecs.x[a] - 10 });
  assert.equal(ecs.grabSt[b], 0); assert.equal(ecs.grabT[a], 6); near(ecs.facing[a], Math.PI / 2);
  tick(S); assert.equal(ecs.grabSt[b], ACT.CAPTURE);
  const W = setup(); W.ecs.iframes[W.b] = 99; tick(W, INPUT); run(W, 28, { mx: 1, prs: BTN.ATTACK });
  assert.equal(W.ecs.grabSt[W.a], ACT.GRAB); assert.equal(W.ecs.grabT[W.a], 29);
  tick(W); assert.equal(W.ecs.grabSt[W.a], 0); near(W.ecs.x[W.a], OPEN.x);
  for (const f of [8, 9]) {
    const E = setup(); E.ecs.iframes[E.b] = 10; tick(E, INPUT); run(E, f - 2);
    E.ecs.iframes[E.b] = 0; tick(E); assert.equal(E.ecs.grabSt[E.b] === ACT.CAPTURE, f === 8);
  }
});

test('grabs ignore shields but reject dash iframes, shield-break intangibility, airborne and tumble down', () => {
  connect(setup(), true);
  for (const [key, value] of [['iframes', 10], ['brk', 136], ['jmpAct', 1], ['grabImm', 60], ['grabDown', 1]]) {
    const S = setup(); S.ecs[key][S.b] = value;
    if (key === 'grabDown') S.ecs.stagger[S.b] = 1;
    tick(S, INPUT); run(S, 7); assert.equal(S.ecs.grabWho[S.a], 0, key);
  }
  const outside = setup(); outside.w.lawless = () => false; tick(outside, INPUT); run(outside, 7);
  assert.equal(outside.ecs.grabWho[outside.a], 0);
  // A down mark left by an earlier tumble does not shield a dizzy pirate: the dizzy is grabbable.
  const dizzy = setup(); dizzy.ecs.grabDown[dizzy.b] = 1; dizzy.ecs.dizzy[dizzy.b] = 200; dizzy.ecs.stagger[dizzy.b] = 200 * DT;
  tick(dizzy, INPUT); run(dizzy, 7); assert.equal(dizzy.ecs.grabWho[dizzy.a], dizzy.b);
});

test('grab wins over the same-frame jab in either command order; simultaneous grabs choose lower id', () => {
  for (const reverse of [false, true]) {
    const S = setup(), { ecs, a, b } = S;
    tick(S, INPUT); run(S, 5); ecs.atkStage[b] = 1; ecs.atkT[b] = 3 * DT; ecs.swingId[b]++;
    const hp = ecs.hp[a]; tick(S, {}, {}, reverse);
    assert.equal(ecs.grabSt[b], ACT.CAPTURE); assert.equal(ecs.atkStage[b], 0); assert.equal(ecs.hp[a], hp);
  }
  const S = setup(); tick(S, INPUT, { ...INPUT, mx: -1 }, true); run(S, 6);
  assert.equal(S.ecs.grabWho[S.a], S.b); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE);
  assert.equal(S.w.events.filter((e) => e.type === 'duel' && e.skill === 'grab' && e.out === 'grab').length, 1);
});

test('hold timer is floor(76 + 1.6 p); each pressed bit and newly entered stick sector mashes 6 frames', () => {
  const S = setup(); S.ecs.hp[S.b] = 81; connect(S);
  const n = Math.floor(76 + 1.6 * 19); assert.equal(S.ecs.grabHold[S.b], n);
  run(S, n - 1); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE);
  tick(S); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE_CUT);
  const M = connect(); tick(M, {}, { prs: BTN.ATTACK | BTN.GUARD, mx: 1 });
  assert.equal(M.ecs.grabHold[M.b], 76 - 1 - 18);
  tick(M, {}, { mx: 1 }); assert.equal(M.ecs.grabHold[M.b], 56);
});

test('pummel hits on frame 7 of 24 through normal PvP damage/hitlag and preserves the hold', () => {
  const S = connect(), { ecs, a, b, w } = S, hp = ecs.hp[b], timer = ecs.grabHold[b];
  tick(S, { prs: BTN.ATTACK }); run(S, 5); assert.equal(ecs.hp[b], hp);
  tick(S); assert.equal(ecs.grabT[a], 7); assert.equal(ecs.hp[b], hp - Math.round(3 * LAWLESS.pvpDmg));
  assert.equal(ecs.grabHold[b], timer - 6); // the hit command freezes the victim, as with a jab assert.ok(ecs.hitlag[a] > 0); assert.equal(ecs.stagger[b], 0);
  const ev = w.events.find((e) => e.type === 'duel' && e.skill === 'pummel'); assert.equal(ev.kb, 0); assert.equal(ev.hs, 0);
  while (ecs.hitlag[a] || ecs.hitlag[b]) tick(S);
  run(S, 16); assert.equal(ecs.grabSt[a], ACT.GRAB_PUMMEL); assert.equal(ecs.grabT[a], 23);
  tick(S); assert.equal(ecs.grabSt[a], ACT.GRAB_WAIT); assert.equal(ecs.grabSt[b], ACT.CAPTURE);
});

test('release locks both for 29 frames, slides apart and starts 60-frame victim immunity', () => {
  const S = connect(), { ecs, a, b } = S; ecs.grabHold[b] = 1; tick(S);
  assert.equal(ecs.grabImm[b], 60); assert.equal(ecs.grabSt[a], ACT.GRAB_CUT); assert.equal(ecs.grabSt[b], ACT.CAPTURE_CUT);
  const ax = ecs.x[a], bx = ecs.x[b]; run(S, 28, { mx: 1, prs: BTN.DASH | BTN.ATTACK }, { mx: -1, prs: BTN.Q });
  assert.equal(ecs.grabSt[a], ACT.GRAB_CUT); assert.equal(ecs.grabSt[b], ACT.CAPTURE_CUT);
  assert.ok(ecs.x[a] < ax && ecs.x[b] > bx); tick(S); assert.equal(ecs.grabSt[a], 0); assert.equal(ecs.grabSt[b], 0);
  run(S, 30); assert.equal(ecs.grabImm[b], 1); tick(S); assert.equal(ecs.grabImm[b], 0);
});

test('a hit on the grabber releases immediately; third party damage is halved, no mash during 20-frame flinch, frees at 6', () => {
  const H = connect(); damage(H, H.a); assert.equal(H.ecs.grabSt[H.b], ACT.CAPTURE_CUT); assert.equal(H.ecs.grabSt[H.a], 0);
  const S = connect(), { ecs, b } = S, hp = ecs.hp[b];
  assert.equal(damage(S, b, 4), 2); assert.equal(ecs.hp[b], hp - 2); assert.equal(ecs.grabFlinch[b], 20);
  const timer = ecs.grabHold[b]; tick(S, {}, { prs: BTN.ATTACK, mx: 1 }); assert.equal(ecs.grabHold[b], timer - 1);
  run(S, 19); assert.equal(ecs.grabFlinch[b], 0);
  tick(S, {}, { prs: BTN.ATTACK }); assert.equal(ecs.grabHold[b], timer - 27);
  damage(S, b, 8); assert.equal(ecs.grabSt[b], ACT.CAPTURE_CUT); assert.equal(ecs.grabSt[S.a], ACT.GRAB_CUT);
});

test('Sandbag is grabbed, held still, pummelled for 3 percent and released on timeout; other mobs are excluded', () => {
  const S = setup(), { w, ecs, a } = S; w.despawn(S.b); S.b = w.spawnEnemy('dummy', ecs.x[a] + 0.95, ecs.z[a]);
  connect(S); const hp = ecs.hp[S.b], x = ecs.x[S.b]; tick(S, { prs: BTN.ATTACK }); run(S, 6);
  assert.equal(ecs.hp[S.b], hp - 3); near(ecs.x[S.b], x); assert.equal(ecs.grabSt[S.b], ACT.CAPTURE);
  ecs.hitlag[a] = ecs.hitlag[S.b] = 0; ecs.grabHold[S.b] = 1; tick(S); assert.equal(ecs.grabSt[S.b], ACT.CAPTURE_CUT);
  tick(S); assert.ok(ecs.x[S.b] > x);
  const M = setup(); M.w.despawn(M.b); M.b = M.w.spawnEnemy('grunt', M.ecs.x[M.a] + 0.95, M.ecs.z[M.a]);
  tick(M, INPUT); run(M, 7); assert.equal(M.ecs.grabWho[M.a], 0);
});

test('death, despawn and a reused partner slot break the pair; all grab fields reset on death/create', () => {
  const S = connect(); killPlayer(S.w, S.a, 0); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE_CUT);
  for (const k of GRAB_FIELDS) assert.equal(S.ecs[k][S.a], 0, k);
  const D = connect(); D.w.despawn(D.b); assert.equal(D.ecs.grabSt[D.a], ACT.GRAB_CUT);
  const R = connect(); R.ecs.destroy(R.b); const n = R.w.spawnPlayer({ x: OPEN.x + 2, z: OPEN.z });
  assert.equal(n, R.b); tick(R); assert.equal(R.ecs.grabSt[R.a], ACT.GRAB_CUT); assert.equal(R.ecs.grabSt[n], 0);
});

test('blocked starts, pistols grab too, the shield and a neutral or away stick strike, flag off, predicted Catch and reconciled capture', () => {
  for (const key of ['guardLag', 'guardStun', 'hitlag', 'dizzy', 'brk', 'stagger']) {
    const S = setup(); S.ecs[key][S.a] = 10; tick(S, INPUT); assert.equal(S.ecs.grabSt[S.a], 0, key);
  }
  const P = setup(); P.ecs.weapon[P.a] = 1; tick(P, INPUT); assert.equal(P.ecs.grabSt[P.a], ACT.GRAB); assert.equal(P.ecs.shotN[P.a], 0);
  for (const c of [{ btn: BTN.GUARD, prs: BTN.ATTACK, mx: 1 }, { prs: BTN.ATTACK }, { prs: BTN.ATTACK, mx: -1 }, { prs: BTN.ATTACK, mz: 1 }]) {
    const N = setup(); tick(N, c); assert.equal(N.ecs.grabSt[N.a], 0, JSON.stringify(c));
  }
  const F = setup(); F.ecs.x[F.b] += 0.8; tick(F, INPUT); assert.equal(F.ecs.grabSt[F.a], 0, 'a body 0.95 u off is not touching'); assert.equal(F.ecs.atkStage[F.a], 1);
  const off = setup(0); tick(off, INPUT); assert.equal(off.ecs.grabSt[off.a], 0); assert.equal(off.ecs.atkStage[off.a], 1);
  const S = setup(), client = new World(S.w.seed, { map: S.w.map }), e = client.spawnPlayer({ x: OPEN.x, z: OPEN.z });
  client.spawnPlayer({ x: OPEN.x + 0.95, z: OPEN.z }); // the victim, as the client holds it
  client.meleeVersion = 1; client.setPlayerState(e, S.w.playerState(S.a));
  client.applyCommand(e, command(S, S.a, INPUT)); assert.equal(client.ecs.grabSt[e], ACT.GRAB);
  connect(S); client.setPlayerState(e, S.w.playerState(S.a)); assert.equal(client.ecs.grabSt[e], ACT.GRAB_WAIT);
  for (const k of GRAB_FIELDS) assert.ok(PLAYER_FIELDS.includes(k), k);
});

test('active grab frames survive a backlog; ground hitstun can be grabbed and rewind matches the blade', () => {
  const S = setup(); tick(S, INPUT); run(S, 5);
  for (let i = 0; i < 3; i++) S.w.applyCommand(S.a, command(S, S.a));
  S.w.stepWorld(); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE);
  const H = setup(); H.ecs.stagger[H.b] = 1; connect(H); assert.equal(H.ecs.stagger[H.b], 0);
  const R = setup(); tick(R, INPUT); run(R, 5); R.ecs.x[R.b] += 5; tick(R);
  assert.equal(R.ecs.grabSt[R.b], ACT.CAPTURE, 'grabs where the blade saw the victim');
});

test('release has no advantage in reverse command order; third-party PvP follows the normal blow path', () => {
  const S = connect(), { ecs, a, b, w } = S; ecs.grabHold[b] = 1; tick(S, {}, {}, true);
  assert.equal(ecs.grabT[a], 0); assert.equal(ecs.grabT[b], 0); assert.equal(ecs.grabImm[b], 60);
  run(S, 28); assert.equal(ecs.grabT[a], 28); assert.equal(ecs.grabT[b], 28);
  tick(S); assert.equal(ecs.grabSt[a], 0); assert.equal(ecs.grabSt[b], 0);
  const H = connect(), third = H.w.spawnPlayer({ x: OPEN.x + 3, z: OPEN.z });
  H.w.strike(H.b, 10, { by: third, kind: 'melee', stage: 1, x: OPEN.x + 3, z: OPEN.z, pierce: true });
  assert.equal(H.ecs.hp[H.b], 97); assert.equal(H.ecs.grabDmg[H.b], 3); assert.equal(H.ecs.stagger[H.b], 0);
  H.w.strike(H.b, 10, { by: third, kind: 'melee', stage: 1, x: OPEN.x + 3, z: OPEN.z, pierce: true });
  assert.equal(H.ecs.grabSt[H.b], ACT.CAPTURE_CUT);
  H.w.strike(H.b, 10, { by: third, kind: 'melee', stage: 1, x: OPEN.x + 3, z: OPEN.z, pierce: true });
  assert.ok(H.w.events.filter((ev) => ev.type === 'duel').at(-1).kb > 0, 'a later hit after release has normal knockback');
});

test('prediction reconciles Capture, keeps actions locked and completes a locally predicted Cut', () => {
  const S = connect(), client = new World(S.w.seed, { map: S.w.map }), e = client.spawnPlayer({ x: OPEN.x, z: OPEN.z });
  client.meleeVersion = 1; client.setPlayerState(e, S.w.playerState(S.b));
  const x = client.ecs.x[e], c = { mx: 1, mz: 0, ax: x + 10, az: OPEN.z, btn: BTN.GUARD, prs: BTN.DASH | BTN.ATTACK | BTN.Q };
  client.applyCommand(e, { ...c, seq: 1, prs: 0 }); near(client.ecs.x[e], x); assert.equal(client.ecs.grabSt[e], ACT.CAPTURE);
  client.ecs.grabHold[e] = 1; client.applyCommand(e, { ...c, seq: 2, prs: 0 }); assert.equal(client.ecs.grabSt[e], ACT.CAPTURE_CUT);
  for (let i = 0; i < 29; i++) client.applyCommand(e, { ...c, seq: i + 3 });
  assert.equal(client.ecs.grabSt[e], 0); assert.equal(client.ecs.atkStage[e], 0); assert.equal(client.ecs.dashT[e], -1);
});
