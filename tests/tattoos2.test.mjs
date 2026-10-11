// M4.7 P3: the three tattoos in play. Tromba (a water column on the aim point; A whirlpool, B twins), Abordaje (a leap
// that slams; A «Parpadeo» blink + an empowered next attack, B a bigger stunning slam) and Timón (a charged boomerang
// that hits out and back and refunds its cooldown when caught; A hangs at the apex, B heavier). Server hits, shared
// bullet clearing and the client's prediction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning, DT } from '../src/data/tuning.js';
import { SKILLS, formed } from '../src/data/weapons.js';
import { TATTOO, skillIndex } from '../src/data/tattoos.js';
import { ACT } from '../src/sim/ecs.js';
import { PTYPE } from '../src/sim/projectiles.js';
import { BTN, canStand } from '../src/sim/systems/movement.js';
import { setWeapon } from '../src/sim/systems/skills.js';
import { WEAPON } from '../src/data/weapons.js';
import { MSG } from '../src/net/protocol.js';
import { map, arena, incoming, clientAndServer } from './helpers.mjs';

const ticks = (s) => Math.max(1, Math.round(s / DT));
const dmgTo = (evs, id) => evs.filter((ev) => ev.type === 'damage' && ev.id === id);
const of = (evs, type) => evs.filter((ev) => ev.type === type);

// The arena with tattoo `id` in Q (form, rank). run(n, c) steps n commands; each event gets `pt`, the command's tick.
// pin(ent, x, z): an enemy kept in place (re-placed before every command) so it waits to be hit.
function tattoo(id, form = 0, rank = 1, o = {}) {
  const A = arena(o), { w, e } = A, ecs = w.ecs;
  ecs.skQ[e] = skillIndex(id); ecs.fmQ[e] = form; ecs.rkQ[e] = rank;
  const pins = [];
  const step = (c = {}) => {
    for (const [p, x, z] of pins) { ecs.x[p] = x; ecs.z[p] = z; ecs.kbx[p] = ecs.kbz[p] = 0; }
    const pt = w.tick, evs = A.step(c);
    for (const ev of evs) ev.pt = pt;
    return evs;
  };
  const run = (n, c = {}) => { const evs = []; for (let i = 0; i < n; i++) evs.push(...step(typeof c === 'function' ? c(i) : c)); return evs; };
  const pin = (kind, x, z) => { const p = w.debugSpawn(kind, x, z, 0); pins.push([p, x, z]); return p; };
  run(4);
  return { w, e, ecs, step, run, pin };
}
// What a blow of ATK × mult does (× critMult on a crit) to a target with `def` DEF.
const blow = (atk, mult, crit, def = 0) => Math.max(1, Math.round(atk * mult * (crit ? tuning.stats.critMult : 1) * (1 - def / (def + tuning.stats.defK))));
const rankMul = (rank) => 1 + TATTOO.dmg * (rank - 1);

test('Tromba: the column lands `delay` s after the windup on the aim point, hits within r for ATK × mult × rank, stuns, erases bullets', () => {
  const T = SKILLS.tromba;
  const { w, e, ecs, run, pin } = tattoo('tromba', 0, 3);
  const ax = ecs.x[e] + 6, az = ecs.z[e];
  const inR = w.debugSpawn('dummy', ax + 1, az + 0.8, 0);
  const out = w.debugSpawn('dummy', ax, az + T.r + 1.2, 0);
  const grunt = pin('sentinel', ax - 0.8, az - 0.6); // tough enough to live through the blow
  const bullets = [];
  for (let k = 0; k < 12; k++) bullets.push(incoming(w, e, PTYPE.PARRY, 6.3 + (k % 4) * 0.3, 0.4, 8, (k % 3) - 1));
  const r0 = ecs.riposte[e];
  const evs = run(90, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax, az }));
  const cast = of(evs, 'tromba')[0];
  assert.ok(cast, 'the tromba event');
  assert.equal(cast.tick - cast.pt, ticks(T.delay), 'lands delay s after the windup');
  assert.equal(cast.pt - evs.find((ev) => ev.type === 'cast').pt, Math.floor(T.windup / DT), 'at the end of the windup');
  assert.ok(Math.abs(cast.x - ax) < 1e-9 && cast.r === T.r && cast.n === 0 && cast.form === 0);
  const hit = of(evs, 'trombaHit')[0];
  assert.equal(hit.pt, cast.tick, 'the impact tick');
  const h = dmgTo(evs, inR);
  assert.equal(h.length, 1, 'one hit');
  assert.equal(h[0].dmg, blow(ecs.atk[e], T.mult * rankMul(3), h[0].crit), 'ATK × mult × rank III');
  assert.equal(dmgTo(evs, out).length, 0, 'outside the column');
  assert.ok(evs.some((ev) => ev.type === 'stun' && ev.id === grunt), 'stuns');
  for (const b of bullets) assert.ok(evs.some((ev) => ev.type === 'destroy' && ev.pid === b && ev.skill === 'tromba'), `bullet ${b} erased`);
  assert.equal(ecs.riposte[e] - r0, T.riposteMax, 'RIPOSTE capped');
  assert.equal(ecs.trT0[e], 0, 'over');
  assert.ok(Math.abs(ecs.cdQ[e] - (T.cd - 90 * DT)) < 0.02, 'the cooldown runs from the press');
  // Aimed too far: at the range limit.
  ecs.cdQ[e] = 0;
  const far = of(run(30, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: ecs.x[e] + 40, az: ecs.z[e] })), 'tromba')[0];
  assert.ok(Math.abs(Math.hypot(far.x - ecs.x[e], far.z - ecs.z[e]) - T.range) < 1e-6);
});

test('Tromba A «Ojo de tormenta»: a whirlpool lingers, hits every `every` s, pulls enemies to its centre and erases what drifts in', () => {
  const S = formed('tromba', 1);
  const { w, e, ecs, run, pin } = tattoo('tromba', 1, 2);
  const ax = ecs.x[e] + 6, az = ecs.z[e];
  const d = w.debugSpawn('dummy', ax + 0.5, az, 0);
  const evs = run(Math.floor(S.windup / DT) + ticks(S.delay) + 2, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax, az }));
  const hit = of(evs, 'trombaHit')[0];
  assert.ok(hit && hit.form === 1 && hit.r === S.r);
  // A grunt at the rim gets dragged in (the pin lets go here) and a bullet drifts into the swirl.
  const g = w.debugSpawn('grunt', ax, az + S.r - 0.2, 0);
  const g0 = Math.hypot(ecs.x[g] - ax, ecs.z[g] - az);
  ecs.stagger[g] = 5; // stands still but for the pull
  const b = incoming(w, e, PTYPE.PARRY, 6 + S.r + 1.5, 3, 8, 0);
  const rest = run(Math.round(S.linger / DT) + 10, { ax, az });
  const all = [...evs, ...rest];
  const ticksN = dmgTo(all, d).length;
  assert.equal(ticksN, 1 + Math.floor(ticks(S.linger) / ticks(S.every)), `the impact + the pulses (${ticksN})`);
  const pulse = dmgTo(all, d).slice(1);
  assert.ok(pulse.every((p) => p.dmg === blow(ecs.atk[e], S.mult * S.tick * rankMul(2), p.crit)), 'pulses: × tick');
  assert.ok(Math.hypot(ecs.x[g] - ax, ecs.z[g] - az) < g0 - 1, 'pulled in');
  assert.ok(rest.some((ev) => ev.type === 'destroy' && ev.pid === b && ev.skill === 'tromba'), 'erased in the swirl');
  assert.equal(of(rest, 'trombaEnd').length, 1);
  assert.equal(ecs.trT0[e], 0);
  void pin;
});

test('Tromba B «Gemelas»: a second column `gap` s later where you aim when the first one lands', () => {
  const S = formed('tromba', 2);
  const { w, e, ecs, run } = tattoo('tromba', 2);
  const ax = ecs.x[e] + 6, az = ecs.z[e];
  const first = w.debugSpawn('dummy', ax, az, 0), second = w.debugSpawn('dummy', ax, az + 5, 0);
  const impact = Math.floor(S.windup / DT) + ticks(S.delay);
  // The aim moves to the second dummy before the first impact.
  const evs = run(90, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax, az: i > impact - 6 ? az + 5 : az }));
  const cols = of(evs, 'tromba');
  assert.equal(cols.length, 2);
  assert.equal(cols[1].n, 1);
  assert.equal(cols[1].tick - cols[0].tick, ticks(S.gap));
  assert.ok(Math.abs(cols[1].z - (az + 5)) < 1e-9, 'aimed at the moment of the first impact');
  assert.equal(of(evs, 'trombaHit').length, 2);
  assert.equal(dmgTo(evs, first).length, 1);
  assert.equal(dmgTo(evs, second).length, 1);
  assert.equal(dmgTo(evs, first)[0].dmg, blow(ecs.atk[e], S.mult, dmgTo(evs, first)[0].crit));
});

test('Abordaje: a leap to the aim (min…range) with i-frames in the air and no dash, a slam that hits and knocks back', () => {
  const L = SKILLS.leap;
  const { w, e, ecs, step, run } = tattoo('leap', 0, 1);
  const x0 = ecs.x[e], z0 = ecs.z[e];
  const d = w.debugSpawn('dummy', x0 + 5 + 1, z0, 0);
  const evs = step({ prs: BTN.Q, ax: x0 + 5, az: z0 });
  const cast = of(evs, 'cast')[0];
  assert.equal(cast.skill, 'leap');
  assert.ok(Math.abs(cast.x1 - (x0 + 5)) < 1e-9 && cast.air === L.air && cast.h === L.h && cast.form === 0);
  assert.equal(ecs.act[e], ACT.LEAP);
  incoming(w, e, PTYPE.PARRY, 1.5, 8);
  const air = run(ticks(L.windup + L.air) - 2, (i) => ({ prs: i === 5 ? BTN.DASH : 0, ax: x0 + 5, az: z0 }));
  assert.ok(!air.some((ev) => ev.type === 'hurt' && ev.id === e), 'i-frames in the air');
  assert.ok(ecs.dashT[e] < 0, 'no dash mid-leap');
  const land = run(30, { ax: x0 + 5, az: z0 });
  const slam = of(land, 'slam')[0];
  assert.ok(slam && Math.abs(slam.x - (x0 + 5)) < 1e-6 && slam.r === L.r);
  assert.ok(Math.abs(ecs.x[e] - (x0 + 5)) < 0.3, 'landed');
  const h = dmgTo(land, d);
  assert.equal(h.length, 1);
  assert.equal(h[0].dmg, blow(ecs.atk[e], L.mult, h[0].crit));
  // Range clamp: aimed 20 u away it leaps 7; aimed at your feet it still leaps `min` ahead.
  ecs.cdQ[e] = 0;
  const xa = ecs.x[e];
  const far = of(step({ prs: BTN.Q, ax: xa + 20, az: ecs.z[e] }), 'cast')[0];
  assert.ok(Math.abs(far.x1 - (xa + L.range)) < 1e-9);
  run(60);
  ecs.cdQ[e] = 0;
  const near = of(step({ prs: BTN.Q, ax: ecs.x[e] + 0.2, az: ecs.z[e] }), 'cast')[0];
  assert.ok(Math.abs(Math.hypot(near.x1 - near.x0, near.z1 - near.z0) - L.min) < 1e-9);
});

test('Abordaje lands on the last standable point of the line: never in deep water', () => {
  const L = SKILLS.leap, r = tuning.player.radius;
  // A shore: a standable point with deep water 6 u ahead (and standable ground on the way).
  let found = null;
  for (let x = -map.half + 6; x < map.half - 6 && !found; x += 1.5) {
    for (let z = -map.half + 6; z < map.half - 6 && !found; z += 1.5) {
      if (!canStand({ map }, x, z, r) || map.groundAt(x, z) < 0) continue;
      for (let k = 0; k < 8 && !found; k++) {
        const dx = Math.sin((k * Math.PI) / 4), dz = Math.cos((k * Math.PI) / 4);
        if (canStand({ map }, x + dx * 2, z + dz * 2, r) && !canStand({ map }, x + dx * 6, z + dz * 6, r) && !canStand({ map }, x + dx * 5, z + dz * 5, r)
          && map.queryColliders(x + dx * 3, z + dz * 3, 4).length === 0) found = { x, z, dx, dz };
      }
    }
  }
  assert.ok(found, 'a shore to test on');
  const { e, ecs, step, run } = tattoo('leap', 0, 1, { x: found.x, z: found.z });
  const ax = found.x + found.dx * 6, az = found.z + found.dz * 6;
  const cast = of(step({ prs: BTN.Q, ax, az }), 'cast')[0];
  const d = Math.hypot(cast.x1 - found.x, cast.z1 - found.z);
  assert.ok(d >= 2 - 0.31 && d < 5, `landed short of the water (${d.toFixed(2)} u)`);
  assert.ok(canStand({ map }, cast.x1, cast.z1, r));
  run(ticks(L.windup + L.air + L.recover) + 2, { ax, az });
  assert.ok(canStand({ map }, ecs.x[e], ecs.z[e], r), 'standing');
});

test('Abordaje B «Ancla de abordaje»: higher, wider and it stuns', () => {
  const S = formed('leap', 2);
  const { w, e, ecs, run, pin } = tattoo('leap', 2, 4);
  const x0 = ecs.x[e], z0 = ecs.z[e];
  const g = pin('sentinel', x0 + 5, z0 + S.r - 0.3); // inside the wider ring only
  const evs = run(70, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: x0 + 5, az: z0 }));
  const cast = of(evs, 'cast')[0];
  assert.ok(cast.h === S.h && cast.air === S.air && cast.form === 2);
  assert.ok(evs.some((ev) => ev.type === 'stun' && ev.id === g), 'stuns');
  const h = dmgTo(evs, g)[0];
  assert.equal(h.dmg, blow(ecs.atk[e], S.mult * rankMul(4), h.crit, ecs.def[g]));
  assert.ok(Math.abs(ecs.cdQ[e] - (S.cd - 70 * DT)) < 0.02, 'its own cooldown');
});

test('Abordaje A «Parpadeo»: a blink at the aim, and the next basic attack is a crit × empMult (the cutlass and the pistols)', () => {
  const S = formed('leap', 1);
  const { w, e, ecs, step, run } = tattoo('leap', 1, 1);
  const x0 = ecs.x[e], z0 = ecs.z[e];
  const evs = run(4, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: x0 + 5, az: z0 }));
  const bl = of(evs, 'blink')[0];
  assert.ok(bl, 'the blink');
  assert.ok(Math.abs(ecs.x[e] - (x0 + 5)) < 0.05, `blinked ${ecs.x[e] - x0}`);
  assert.ok(ecs.iframes[e] > 0.2 && ecs.empT[e] > S.emp - 0.1);
  // The next swing on a dummy: a crit × empMult; the one after it is a normal swing.
  const d = w.debugSpawn('dummy', ecs.x[e] + 1.2, ecs.z[e], 0);
  const sw = run(40, (i) => ({ prs: i === 0 || i === 20 ? BTN.ATTACK : 0, ax: ecs.x[e] + 3, az: ecs.z[e] }));
  const h = dmgTo(sw, d);
  assert.ok(h.length >= 2, `${h.length} hits`);
  assert.equal(h[0].crit, 1, 'a crit');
  assert.equal(h[0].dmg, blow(ecs.atk[e], tuning.melee.stages[0].mult * S.empMult, true));
  assert.equal(ecs.empT[e], 0, 'spent');
  assert.ok(h.slice(1).every((x) => x.dmg < h[0].dmg), 'only the first');
  // It runs out if you wait.
  ecs.cdQ[e] = 0;
  run(5, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: ecs.x[e] - 3, az: ecs.z[e] }));
  assert.ok(ecs.empT[e] > 0);
  run(ticks(S.emp) + 2, { ax: ecs.x[e] - 3, az: ecs.z[e] });
  assert.equal(ecs.empT[e], 0, 'expired');
  // The pistols: the next shot crits.
  setWeapon(w, e, WEAPON.PISTOLAS);
  ecs.skQ[e] = skillIndex('leap'); ecs.fmQ[e] = 1; ecs.rkQ[e] = 1; ecs.cdQ[e] = 0;
  run(5, (i) => ({ prs: i === 0 ? BTN.Q : 0, ax: ecs.x[e] + 3, az: ecs.z[e] }));
  const d2 = w.debugSpawn('dummy', ecs.x[e] + 3, ecs.z[e], 0);
  const shots = run(50, (i) => ({ btn: i < 30 ? BTN.ATTACK : 0, ax: ecs.x[e] + 3, az: ecs.z[e] }));
  const sh = dmgTo(shots, d2);
  assert.ok(sh.length >= 2);
  assert.equal(sh[0].crit, 1);
  assert.equal(sh[0].dmg, blow(ecs.atk[e], SKILLS.pistol.mult * S.empMult, true));
  void step;
});

test('Timón: a tap throws fast and short, a full charge slow and long; the cooldown starts at the throw', () => {
  const W = SKILLS.wheel;
  const { e, ecs, step, run } = tattoo('wheel', 0, 1);
  const tap = of(step({ prs: BTN.Q }), 'wheel')[0];
  assert.ok(tap && tap.k === 0, 'a tap throws at once');
  assert.ok(Math.abs(tap.v0 - W.fast.speed) < 1e-9 && Math.abs(tap.R - W.fast.range) < 1e-9 && Math.abs(tap.r - W.fast.r) < 1e-9);
  assert.ok(ecs.cdQ[e] > W.cd - 0.05);
  run(ticks(W.life) + 2);
  ecs.cdQ[e] = 0;
  // Held: charging (ACT.CHARGE, slowed, no cooldown) until let go after `charge` s.
  const c = step({ prs: BTN.Q, btn: BTN.Q });
  assert.equal(of(c, 'wheel').length, 0);
  assert.equal(ecs.chg[e], 1);
  assert.equal(ecs.act[e], ACT.CHARGE);
  assert.equal(ecs.moveMul[e], W.move);
  assert.equal(ecs.cdQ[e], 0, 'no cooldown while charging');
  run(ticks(W.charge) + 1, { btn: BTN.Q });
  const full = of(step({}), 'wheel')[0];
  assert.ok(full && full.k === 1, `k ${full && full.k}`);
  assert.ok(Math.abs(full.v0 - W.slow.speed) < 1e-9 && Math.abs(full.R - W.slow.range) < 1e-9 && Math.abs(full.r - W.slow.r) < 1e-9);
  assert.equal(ecs.chg[e], 0);
  assert.ok(ecs.cdQ[e] > W.cd - 0.05);
});

test('Timón: hits each enemy once out and once back, erases the bullets it crosses (RIPOSTE capped), refunds when caught', () => {
  const W = SKILLS.wheel;
  const { w, e, ecs, step, run, pin } = tattoo('wheel', 0, 2);
  const d = pin('dummy', ecs.x[e] + 4, ecs.z[e]);
  const bullets = [];
  for (let k = 0; k < 10; k++) bullets.push(incoming(w, e, PTYPE.PARRY, 2 + k * 0.5, 0.3, 8, 0));
  const r0 = ecs.riposte[e];
  const evs = [...step({ prs: BTN.Q }), ...run(ticks(W.life))];
  const h = dmgTo(evs, d);
  assert.equal(h.length, 2, 'out and back');
  assert.equal(h[0].dmg, blow(ecs.atk[e], W.fast.mult * rankMul(2), h[0].crit));
  assert.equal(of(evs, 'wheelBack').length, 1);
  const caught = of(evs, 'wheelCatch')[0];
  assert.ok(caught, 'caught');
  assert.ok(bullets.filter((b) => evs.some((ev) => ev.type === 'destroy' && ev.pid === b && ev.skill === 'wheel')).length >= W.riposteMax);
  assert.equal(ecs.riposte[e] - r0, W.riposteMax, 'RIPOSTE capped');
  // The refund: the cooldown left when it came back × (1 − refund).
  const left = W.cd - (caught.pt - evs.find((ev) => ev.type === 'wheel').pt) * DT, end = w.tick - 1;
  assert.ok(Math.abs(ecs.cdQ[e] + (end - caught.pt) * DT - left * (1 - W.refund)) < 1e-6, `cd ${ecs.cdQ[e]}`);
  assert.equal(ecs.whPh[e], 0);
});

test('Timón: a dash cancels the charge (no cooldown), maxHold throws by itself, death drops the wheel, a wall turns it early', () => {
  const W = SKILLS.wheel;
  const { e, ecs, step, run } = tattoo('wheel');
  step({ prs: BTN.Q, btn: BTN.Q });
  run(10, { btn: BTN.Q });
  step({ prs: BTN.DASH, btn: BTN.Q });
  assert.equal(ecs.castK[e], 0, 'cancelled');
  assert.equal(ecs.cdQ[e], 0, 'no cooldown');
  run(40);
  const evs = [...step({ prs: BTN.Q, btn: BTN.Q }), ...run(ticks(W.maxHold) + 2, { btn: BTN.Q })];
  const th = of(evs, 'wheel')[0];
  assert.ok(th && th.k === 1, 'thrown at maxHold');
  ecs.hp[e] = 1; ecs.dead[e] = 1; ecs.deadT[e] = 5;
  assert.ok(of(run(2), 'wheelDrop').length === 1, 'dropped');
  assert.equal(ecs.whPh[e], 0);
  // A rock pillar 4 u ahead: the wheel turns at its face.
  const pil = map.props.find((p) => p.kind === 'pillar');
  const A = map.landmarks.arena, l = Math.hypot(A.x - pil.x, A.z - pil.z), ux = (A.x - pil.x) / l, uz = (A.z - pil.z) / l;
  const t = tattoo('wheel', 0, 1, { x: pil.x + ux * (pil.r + 4), z: pil.z + uz * (pil.r + 4) });
  const wh = of(t.step({ prs: BTN.Q, ax: pil.x, az: pil.z }), 'wheel')[0];
  assert.ok(wh.R < 4.6 && wh.R > 2, `clipped to ${wh.R.toFixed(2)}`);
});

test('Timón A «Remolino» hangs at the apex hitting what is there; B «Timón de guerra» is wider, heavier, knocks back, no refund', () => {
  const A = formed('wheel', 1), B = formed('wheel', 2), W = SKILLS.wheel;
  const a = tattoo('wheel', 1);
  const apex = a.pin('dummy', a.ecs.x[a.e] + 0.6 + W.fast.range, a.ecs.z[a.e]);
  const evs = [...a.step({ prs: BTN.Q }), ...a.run(ticks(W.life))];
  const hang = dmgTo(evs, apex);
  assert.ok(hang.length >= 1 + Math.floor(ticks(A.hang) / ticks(A.hangEvery)), `${hang.length} hits at the apex`);
  assert.ok(hang.some((h) => h.dmg === blow(a.ecs.atk[a.e], W.fast.mult * A.hangMult, h.crit)), 'the hang pulses');
  assert.equal(of(evs, 'wheel')[0].hang, A.hang);
  const b = tattoo('wheel', 2);
  const th = of(b.step({ prs: BTN.Q }), 'wheel')[0];
  assert.ok(Math.abs(th.r - (W.fast.r + B.rAdd)) < 1e-9 && Math.abs(th.v0 - W.fast.speed * B.speedMul) < 1e-9);
  const back = b.run(ticks(W.life));
  assert.ok(of(back, 'wheelCatch').length === 1);
  assert.ok(b.ecs.cdQ[b.e] > W.cd - ticks(W.life) * DT - 0.05, 'no refund');
});

test('prediction: the client predicts a Tromba, an Abordaje, a Parpadeo and a charged Timón with its return exactly as the server', () => {
  const { server, client, deliver, shown, sp, se, ecs } = clientAndServer();
  const send = (m) => { server.receive(1, { t: MSG.CMD, ...m }); deliver(); };
  ecs.regenT[se] = 99;
  send({ type: 'dev', op: 'tattoos', rank: 4 });
  send({ type: 'dev', op: 'loadout', slot: 'q', id: 'tromba' });
  send({ type: 'dev', op: 'loadout', slot: 'e', id: 'leap' });
  const pe = client.pred.ecs, me = client.youLocal;
  let maxErr = 0;
  const play = (n, f) => {
    for (let i = 0; i < n; i++) {
      const c = f(i) || {};
      client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: 0, prs: 0, ...c });
      server.step();
      deliver();
      maxErr = Math.max(maxErr, client.stats.predErr);
    }
  };
  play(30, () => ({}));
  play(120, (i) => (i === 0 ? { prs: BTN.Q } : null)); // Tromba on the archer
  play(90, (i) => (i === 0 ? { prs: BTN.E, ax: ecs.x[se] + 4, az: ecs.z[se] } : null)); // Abordaje
  send({ type: 'dev', op: 'tattoo', id: 'leap', rank: 4, form: 1 });
  play(Math.ceil(SKILLS.leap.cd / DT), () => ({})); // the Abordaje's cooldown
  play(60, (i) => (i === 0 ? { prs: BTN.E, ax: ecs.x[se] - 3, az: ecs.z[se] } : i === 10 ? { prs: BTN.ATTACK } : null)); // Parpadeo + swing
  send({ type: 'dev', op: 'loadout', slot: 'q', id: 'wheel' });
  play(30, () => ({}));
  play(400, (i) => (i < 60 ? { prs: i === 0 ? BTN.Q : 0, btn: BTN.Q } : { mx: i > 120 && i < 160 ? 1 : 0 })); // charged Timón, walk while it returns
  play(10, () => ({}));
  assert.equal(maxErr, 0, 'zero prediction error');
  for (const k of ['x', 'z', 'hp', 'riposte', 'cdQ', 'cdE', 'trT0', 'whPh', 'empT']) assert.equal(pe[k][me], ecs[k][se], k);
  const seen = [...new Set(shown.filter((ev) => ev.predicted).map((ev) => ev.type))].join(' ');
  for (const t of ['tromba', 'trombaHit', 'slam', 'blink', 'wheel', 'wheelBack']) assert.ok(shown.some((ev) => ev.type === t && ev.predicted), `${t} shown from prediction (${seen})`);
  assert.ok(shown.some((ev) => ev.type === 'wheelCatch' || ev.type === 'wheelDrop'), 'the wheel ended');
  assert.ok(shown.some((ev) => ev.type === 'damage' && ev.by === client.youServer), 'the archer was hit');
});
