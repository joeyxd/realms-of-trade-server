import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arena } from './helpers.mjs';
import { OPEN } from './cala-duel.mjs';
import { ACT, C } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { LAWLESS } from '../src/data/lawless.js';
import { knockback, launchSpeed, launchDecay, di } from '../src/sim/meleeHit.js';
import { hurtPlayer, killPlayer } from '../src/sim/systems/combat.js';
import { World } from '../src/sim/world.js';
import { swimmingAt } from '../src/sim/systems/swimming.js';

// P3a setup/tick/connect fixture, with a persistent stick and selectable command order.
const INPUT = { btn: BTN.GUARD, prs: BTN.ATTACK };
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
function connect(S = setup(), stick = {}) {
  tick(S, { ...INPUT, ...stick }); run(S, 6, stick);
  assert.equal(S.ecs.grabSt[S.a], ACT.GRAB_WAIT); assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE);
  return S;
}
const event = (S) => S.w.events.findLast((e) => e.type === 'duel' && ['fthrow', 'bthrow'].includes(e.skill));
const hit = (S, e, raw = 4) => hurtPlayer(S.w, e, raw, { x: S.ecs.x[e] - 1, z: S.ecs.z[e], kind: 'proj', pierce: true, noInv: true });

for (const back of [false, true]) test(`${back ? 'back' : 'forward'} throw: exact release, recovery, facing, weight-100 KB and immunity`, () => {
  const S = connect(), { ecs, a, b } = S, facing = ecs.facing[a], hp = ecs.hp[b];
  const release = back ? 16 : 14, total = back ? 44 : 31;
  tick(S, { mx: back ? -1 : 1 }); assert.equal(ecs.grabT[a], 1);
  assert.equal(ecs.grabSt[a], back ? ACT.GRAB_THROW_B : ACT.GRAB_THROW_F);
  assert.equal(ecs.act[b], ACT.THROWN);
  run(S, release - 2); assert.equal(ecs.hp[b], hp); near(ecs.facing[a], facing);
  assert.equal(ecs.grabWho[a], b); near(ecs.x[b] - ecs.x[a], ecs.radius[a] + ecs.radius[b]);
  tick(S); assert.equal(ecs.grabT[a], release); assert.equal(ecs.hp[b], hp - 2);
  near(ecs.facing[a], facing + (back ? Math.PI : 0));
  const kb = knockback(2, 2, 100, 70, back ? 60 : 45), ev = event(S);
  near(ev.kb, Math.round(kb * 10) / 10); assert.equal(ev.hs, Math.floor(0.4 * kb));
  assert.equal(ev.hl, 0); assert.equal(ecs.hitlag[a], 0); assert.equal(ecs.hitlag[b], 0);
  near(ecs.lvx[b], launchSpeed(kb, LAWLESS.meleeUnit) * (back ? -1 : 1)); near(ecs.lvz[b], 0);
  assert.equal(ecs.grabDown[b], kb >= 80 ? 1 : 0); assert.equal(ev.kd || 0, kb >= 80 ? 1 : 0);
  assert.equal(ecs.grabWho[a], 0); assert.equal(ecs.grabWho[b], 0); assert.equal(ecs.grabImm[b], 60);
  run(S, total - release - 1); assert.equal(ecs.grabT[a], total - 1);
  tick(S); assert.equal(ecs.grabSt[a], 0); assert.equal(ecs.act[a], ACT.IDLE);
});

test('diagonal stick is the launch direction; percent reaches tumble at KB 80', () => {
  const S = setup(); S.ecs.hp[S.b] = 60; connect(S); tick(S, { mx: 0.6, mz: 0.8 }); run(S, 13);
  const { ecs, b } = S, kb = knockback(42, 2, 100, 70, 45), speed = launchSpeed(kb, LAWLESS.meleeUnit);
  near(ecs.lvx[b], 0.6 * speed); near(ecs.lvz[b], 0.8 * speed);
  assert.ok(kb >= 80); assert.equal(event(S).kd, 1); near(event(S).la, Math.round(Math.atan2(0.8, 0.6) * 1000) / 1000);
});

test('DI uses the release command, not the earlier stick; preserves speed in both command orders', () => {
  for (const reverse of [false, true]) {
    const S = connect(); tick(S, { mx: 1 }); run(S, 12, {}, { mz: -1 });
    tick(S, {}, { mz: 1 }, reverse);
    const speed = launchSpeed(knockback(2, 2, 100, 70, 45), LAWLESS.meleeUnit), v = di(speed, 0, 0, 1);
    near(S.ecs.lvx[S.b], v.vx); near(S.ecs.lvz[S.b], v.vz); near(Math.hypot(v.vx, v.vz), speed);
    near(event(S).la, Math.round(Math.PI / 10 * 1000) / 1000);
  }
});

test('held stick starts on first CatchWait frame; subthreshold stays held; pummel wins and cannot throw', () => {
  const S = connect(setup(), { mx: 1 }); tick(S, { mx: 1 }); assert.equal(S.ecs.grabT[S.a], 1);
  const N = connect(); run(N, 8, { mx: 0.3, mz: 0.3 }); assert.equal(N.ecs.grabSt[N.a], ACT.GRAB_WAIT);
  tick(N, { mx: 1, prs: BTN.ATTACK }); assert.equal(N.ecs.grabSt[N.a], ACT.GRAB_PUMMEL);
  run(N, 4, { mx: 1 }); assert.equal(N.ecs.grabSt[N.a], ACT.GRAB_PUMMEL);
});

test('committed hold never times out or mashes; external damage halves without 6-percent break', () => {
  const S = connect(), { ecs, a, b } = S; tick(S, { mx: 1 }); ecs.grabHold[b] = 1;
  run(S, 6, {}, { prs: BTN.ATTACK | BTN.GUARD, mx: 1 }); assert.equal(ecs.grabHold[b], 1);
  near(hit(S, b, 16), 8); assert.equal(ecs.grabSt[b], ACT.THROWN); assert.equal(ecs.grabWho[a], b);
  assert.equal(ecs.grabFlinch[b], 20); run(S, 7); assert.ok(event(S));
});

test('third-party PvP hit retains a committed victim at 6 percent, flinches, then throw ignores mercy', () => {
  const S = connect(), { w, ecs, a, b } = S;
  const third = w.spawnPlayer({ x: OPEN.x + 3, z: OPEN.z }); tick(S, { mx: 1 });
  w.strike(b, 20, { by: third, kind: 'melee', stage: 1, x: OPEN.x + 3, z: OPEN.z, pierce: true });
  assert.equal(ecs.grabDmg[b], 6); assert.equal(ecs.grabSt[b], ACT.THROWN); assert.equal(ecs.stagger[b], 0);
  assert.equal(ecs.grabFlinch[b], 20); assert.ok(ecs.hitlag[b] > 0);
  run(S, 13); assert.equal(event(S).out, 'hit'); assert.equal(event(S).hl, 0); assert.equal(ecs.grabWho[a], 0);
});

test('hitting the grabber before release cancels to CaptureCut; death and despawn release either side', () => {
  const S = connect(); tick(S, { mx: -1 }); run(S, 7); hit(S, S.a);
  assert.equal(S.ecs.grabSt[S.b], ACT.CAPTURE_CUT); assert.equal(S.ecs.grabSt[S.a], 0);
  run(S, 20); assert.equal(event(S), undefined);
  for (const victim of [false, true]) for (const death of [false, true]) {
    const D = connect(); tick(D, { mx: 1 }); const e = victim ? D.b : D.a, other = victim ? D.a : D.b;
    if (death) killPlayer(D.w, e, 0); else D.w.despawn(e);
    assert.equal(D.ecs.grabWho[other], 0); assert.equal(D.ecs.grabSt[other], victim ? ACT.GRAB_CUT : ACT.CAPTURE_CUT);
  }
});

test('Sandbag throws use the existing row launch, tumble view fields, and regen home reset', () => {
  const S = setup(), { ecs, w, a } = S; w.despawn(S.b); S.b = w.spawnEnemy('dummy', ecs.x[a] + 0.95, ecs.z[a]);
  const b = S.b, home = { x: ecs.x[b], z: ecs.z[b] }; ecs.hp[b] -= 50; ecs.brain[b].sinceHit = 0;
  connect(S); tick(S, { mx: -1 }); run(S, 15);
  const ev = w.events.findLast((e) => e.type === 'damage'), kb = knockback(54, 4, 100, 70, 60);
  near(ev.kb, Math.round(kb * 10) / 10); assert.equal(ev.kd, 1); assert.equal(ev.hl, 0); assert.ok(ecs.lvx[b] < 0);
  assert.equal(ecs.grabWho[b], 0); run(S, 600);
  near(ecs.x[b], home.x); near(ecs.z[b], home.z); assert.equal(ecs.hp[b], ecs.maxHp[b]); near(ecs.lvx[b], 0);
});

test('MN_MELEE off never starts grab or throw; predicted throw reconciles the server state', () => {
  const off = setup(0); tick(off, { ...INPUT, mx: 1 }); run(off, 50, { mx: 1 });
  assert.equal(off.ecs.grabSt[off.a], 0); assert.equal(event(off), undefined);
  const S = connect(), client = new World(S.w.seed, { map: S.w.map }), e = client.spawnPlayer({ x: OPEN.x, z: OPEN.z });
  client.meleeVersion = 1; client.setPlayerState(e, S.w.playerState(S.a));
  client.applyCommand(e, command(S, S.a, { mx: -1 })); tick(S, { mx: -1 });
  assert.equal(client.ecs.grabSt[e], S.ecs.grabSt[S.a]);
  for (let i = 0; i < 43; i++) client.applyCommand(e, { ...command(S, S.a), seq: i + 2 });
  run(S, 43); assert.equal(client.ecs.grabSt[e], 0); near(client.ecs.facing[e], S.ecs.facing[S.a]);
  client.setPlayerState(e, S.w.playerState(S.a));
  assert.equal(client.ecs.grabSt[e], 0); near(client.ecs.facing[e], S.ecs.facing[S.a]);
});

test('Cala has no water within throw range; launch covers the P1a discrete distance', () => {
  const S = connect(), { ecs, a, b, w } = S;
  tick(S, { mx: 1 }); run(S, 13);
  const speed = Math.hypot(ecs.lvx[b], ecs.lvz[b]), decay = launchDecay(LAWLESS.meleeUnit), n = Math.ceil(speed / decay);
  const distance = (n * speed - decay * n * (n - 1) / 2) / 60, x = ecs.x[b], z = ecs.z[b];
  run(S, n); near(ecs.x[b] - x, distance); near(ecs.z[b], z);
  // Search the full Cala disk plus the maximum survivable back-throw distance (99 percent + 2 damage).
  const maxSpeed = launchSpeed(knockback(101, 2, 100, 70, 60), LAWLESS.meleeUnit);
  const steps = Math.ceil(maxSpeed / decay), maxDistance = (steps * maxSpeed - decay * steps * (steps - 1) / 2) / 60;
  const K = w.map.cala; let nearest = Infinity;
  for (let x = K.x - K.r - 20; x <= K.x + K.r + 20; x += 0.25)
    for (let z = K.z - K.r - 20; z <= K.z + K.r + 20; z += 0.25)
      if (swimmingAt(w, x, z)) nearest = Math.min(nearest, Math.hypot(x - K.x, z - K.z) - K.r);
  assert.ok(nearest > maxDistance + ecs.radius[a] + ecs.radius[b], `${nearest} water gap vs ${maxDistance} throw`);
  console.log('Cala water gap', nearest, 'max throw distance', maxDistance, 'tested distance', distance, 'point', x, z);
});
