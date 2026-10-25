import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, tuning } from '../src/data/tuning.js';
import { WEAPON, SKILLS } from '../src/data/weapons.js';
import { BTN } from '../src/sim/systems/movement.js';
import { A } from './helpers.mjs';
import { OPEN, calaServer, calaDuel } from './cala-duel.mjs';

const blows = (S) => S.events(2, 'duel').filter((ev) => ev.e === S.b && ev.by === S.a);
function pistols() {
  const S = calaServer();
  S.a = S.join(1, OPEN.x, OPEN.z, WEAPON.PISTOLAS); S.b = S.join(2, OPEN.x + 6, OPEN.z);
  for (let i = 0; i < 4; i++) S.both();
  return S;
}

test('duel telemetry: three combo stages label the matching hurt and contact window', () => {
  const S = calaDuel(), { ecs, a, b } = S;
  let last = 0;
  for (let i = 0; i < 65; i++) {
    S.both({ prs: i % 12 === 0 && i < 40 ? BTN.ATTACK : 0 });
    const evs = blows(S);
    if (evs.length > last) { assert.equal(evs.at(-1).hp, ecs.hp[b]); last = evs.length; }
  }
  const evs = blows(S), hurts = S.events(2, 'hurt').filter((ev) => ev.e === b && ev.by === a);
  assert.deepEqual(evs.map((ev) => ev.skill), ['melee1', 'melee2', 'melee3']);
  assert.equal(hurts.length, evs.length);
  evs.forEach((ev, i) => {
    const stage = tuning.melee.stages[i];
    assert.equal(ev.tele, stage.windup);
    assert.ok(ev.win >= ev.tele && ev.win <= ev.tele + stage.active + 2 * DT);
    assert.ok(['hit', 'crit'].includes(ev.out));
    assert.equal(ev.dmg, hurts[i].dmg); assert.equal(hurts[i].via, ev.skill);
  });
});

test('duel telemetry: block, perfect guard and dash keep their outcomes', () => {
  const B = calaDuel();
  for (let i = 0; i < 20; i++) B.both({}, { btn: BTN.GUARD, prs: i === 0 ? BTN.GUARD : 0 });
  for (let i = 0; i < 20; i++) B.both({ prs: i === 0 ? BTN.ATTACK : 0 }, { btn: BTN.GUARD });
  assert.equal(blows(B).length, 1); assert.equal(blows(B)[0].out, 'block'); assert.ok(blows(B)[0].dmg > 0);
  const P = calaDuel();
  P.both({ prs: BTN.ATTACK }, { btn: BTN.GUARD, prs: BTN.GUARD });
  for (let i = 0; i < 20; i++) P.both({}, { btn: BTN.GUARD });
  assert.equal(blows(P).length, 1); assert.equal(blows(P)[0].out, 'perfect'); assert.equal(blows(P)[0].dmg, 0);
  assert.ok(P.events(1, 'stun').some((ev) => ev.id === P.a));
  const D = calaDuel(), hp = D.ecs.hp[D.b];
  D.both({ prs: BTN.ATTACK }, { mx: 0, mz: 1, prs: BTN.DASH });
  for (let i = 0; i < 12; i++) D.both();
  for (const ev of blows(D)) { assert.equal(ev.out, 'dodge'); assert.equal(ev.dmg, 0); }
  assert.equal(D.ecs.hp[D.b], hp);
});

test('duel telemetry: each pistol labels its hand and measures flight age', () => {
  for (const [btn, skill, heavy, speed] of [[BTN.ATTACK, 'gun_l', 0, SKILLS.pistol.speed], [BTN.GUARD, 'gun_r', 1, SKILLS.pistolSecondary.speed]]) {
    const S = pistols();
    for (let i = 0; i < 35; i++) S.both({ btn, prs: i === 0 ? btn : 0 });
    const ev = blows(S)[0];
    assert.ok(ev); assert.equal(ev.skill, skill); assert.equal(ev.heavy, heavy); assert.equal(ev.tele, 0);
    assert.ok(Math.abs(ev.win - (6 - 0.5) / speed) <= 0.05, `${skill} flight ${ev.win}`);
  }
});

test('duel telemetry: bullets report mercy without a hurt event', () => {
  const S = pistols();
  for (let i = 0; i < 50; i++) { S.ecs.hurtInv[S.b] = 0.3; S.both({ btn: BTN.ATTACK, prs: i === 0 ? BTN.ATTACK : 0 }); }
  assert.ok(blows(S).length > 0);
  for (const ev of blows(S)) { assert.equal(ev.out, 'mercy'); assert.equal(ev.dmg, 0); }
  assert.equal(S.events(2, 'hurt').filter((ev) => ev.e === S.b).length, 0);
});

test('duel telemetry: lunge records its windup and elapsed cast time', () => {
  const S = calaDuel();
  S.put(S.b, OPEN.x + 3, OPEN.z);
  for (let i = 0; i < 10; i++) S.both();
  for (let i = 0; i < 30; i++) S.both({ prs: i === 0 ? BTN.Q : 0 });
  const ev = blows(S)[0];
  assert.ok(ev); assert.equal(ev.skill, 'lunge'); assert.equal(ev.heavy, 1); assert.equal(ev.tele, 0.08); assert.ok(ev.win >= ev.tele);
});

test('duel telemetry: storm is heavy with no windup', () => {
  const S = calaDuel();
  S.ecs.riposte[S.a] = tuning.parry.riposte.max;
  for (let i = 0; i < 10; i++) S.both({ prs: i === 0 ? BTN.R : 0 });
  assert.equal(blows(S).length, 1);
  const ev = blows(S)[0];
  assert.equal(ev.skill, 'storm'); assert.equal(ev.heavy, 1); assert.equal(ev.tele, 0); assert.equal(ev.win, 0);
});

test('duel telemetry: pirates outside the Cala emit no duel event', () => {
  const S = calaDuel(A);
  for (let i = 0; i < 40; i++) S.both({ prs: i % 12 === 0 ? BTN.ATTACK : 0 });
  assert.deepEqual(S.events(2, 'duel'), []);
});
