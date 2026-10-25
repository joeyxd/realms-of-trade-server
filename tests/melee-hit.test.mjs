import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knockback, hitlagFrames, hitstunFrames, launchSpeed, launchDecay, launchFrames, meleePercent, meleeStun, di } from '../src/sim/meleeHit.js';
import { LAWLESS, MELEE } from '../src/data/lawless.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { WEAPON } from '../src/data/weapons.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { BTN } from '../src/sim/systems/movement.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { OPEN, calaDuel, calaServer } from './cala-duel.mjs';
import { map, arena, incoming } from './helpers.mjs';
import { stepEnemy, defOf } from '../src/sim/systems/enemies.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const command = (w, e, extra = {}) => ({ seq: w.ecs.lastSeq[e] + 1, mx: 0, mz: 0,
  ax: w.ecs.x[e] + 10, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...extra });
function duel(version = 1) {
  const S = calaDuel();
  S.w.meleeVersion = version; S.w.rng = Object.assign(() => 1, S.w.rng);
  S.ecs.facing[S.a] = Math.PI / 2;
  return S;
}
function sabre(S) {
  const { ecs, w, a } = S;
  ecs.atkStage[a] = 1; ecs.atkT[a] = tuning.melee.stages[0].windup; ecs.swingId[a]++;
  w.events.length = 0;
  w.meleeHits(a, tuning.melee.stages[0], w.tick, 1);
  return w.events.find((ev) => ev.type === 'duel');
}
const blow = (S, skill, extra = {}, raw = 14) => S.w.strike(S.b, raw, { by: S.a, kind: 'skill', skill,
  x: S.ecs.x[S.a], z: S.ecs.z[S.a], ...extra });

test('Melee formula examples, frame counts and launch units', () => {
  near(knockback(14, 14, 87, 60, 70), 84.34, 0.01);
  near(knockback(94, 14, 87, 60, 70), 151.42, 0.01);
  assert.equal(hitlagFrames(14), 7); assert.equal(hitlagFrames(60), 20); assert.equal(hitlagFrames(0), 3);
  assert.equal(hitstunFrames(100), 40);
  near(launchSpeed(100, 0.12), 21.6); near(launchDecay(0.12), 0.3672);
  assert.equal(launchFrames(80), 48); assert.equal(launchFrames(0), 0);
  near(meleePercent(10, 24, 100), 10); near(meleePercent(10, 300, 100), 10 / 3);
  near(meleeStun(79, 31, 80, 0.5), 31 / 60); near(meleeStun(80, 32, 80, 0.5), 48 / 60 + 0.5);
});

test('DI rotates perpendicular sticks by +/-18 degrees, clamps and preserves magnitude', () => {
  for (const [sx, sz, angle] of [[0, 1, 18], [0, -1, -18], [1, 0, 0], [0, 5, 18]]) {
    const v = di(1, 0, sx, sz);
    near(Math.atan2(v.vz, v.vx), angle * Math.PI / 180); near(Math.hypot(v.vx, v.vz), 1);
  }
  for (const [vx, vz] of [[-3, 4], [7, -8], [-10, -1]]) {
    const v = di(vx, vz, 0.3, -0.7); near(Math.hypot(v.vx, v.vz), Math.hypot(vx, vz));
  }
  assert.deepEqual(di(0, 0, 1, 1), { vx: 0, vz: 0 });
});

test('sabre freezes both fighters and all command timers, then applies exit DI and linear launch', () => {
  const S = duel(), { w, ecs, a, b } = S, hp = ecs.hp[b];
  const ev = sabre(S), d = 100 * (hp - ecs.hp[b]) / ecs.maxHp[b], row = MELEE.melee1;
  const p = 100 * (ecs.maxHp[b] - ecs.hp[b]) / ecs.maxHp[b], kb = knockback(p, d, 87, row.bkb, row.kbg);
  assert.ok(ev); assert.equal(ev.skill, 'melee1'); near(ev.kb, Math.round(kb * 10) / 10);
  near(ev.p, Math.round(p * 10) / 10); assert.equal(ev.hl, hitlagFrames(d)); assert.equal(ev.hs, hitstunFrames(kb));
  assert.equal(ecs.hitlag[a], ev.hl); assert.equal(ecs.hitlag[b], ev.hl); near(ecs.stagger[b], ev.hs / 60);
  assert.equal(ecs.kbx[b], 0); assert.equal(ecs.kbz[b], 0);
  assert.ok(!w.events.some((ev) => ev.type === 'time'), 'PvP does not request feel hitstop');
  const pred = new World(GAME.seed, { map, server: false }), pe = pred.spawnPlayer({});
  pred.setPlayerState(pe, w.playerState(b));
  const fields = ['x', 'y', 'z', 'atkT', 'act', 'actT', 'castT', 'guardT', 'dashT', 'cdQ', 'shotCd',
    'stagger', 'hurtInv', 'regenT', 'lvx', 'lvz', 'guardRegT', 'comboT', 'chainT'];
  const states = [a, b].map((e) => fields.map((k) => ecs[k][e]));
  for (let i = ev.hl; i > 0; i--) {
    const cmd = command(w, b, { mz: i === 1 ? 1 : -1, prs: BTN.ATTACK | BTN.DASH, btn: BTN.GUARD });
    w.applyCommand(a, command(w, a, { mx: 1, prs: BTN.Q }));
    w.applyCommand(b, cmd); pred.applyCommand(pe, cmd);
    assert.deepEqual(fields.map((k) => ecs[k][a]), states[0]);
    for (const [j, k] of fields.entries()) if (i > 1 || !['lvx', 'lvz'].includes(k)) assert.equal(ecs[k][b], states[1][j], k);
    assert.deepEqual(pred.playerState(pe), w.playerState(b), 'prediction shares hitlag and exit DI');
    assert.equal(ecs.hitlag[b], i - 1);
  }
  const speed = launchSpeed(kb, LAWLESS.meleeUnit);
  near(ecs.lvx[b], speed * Math.cos(Math.PI / 10)); near(ecs.lvz[b], speed * Math.sin(Math.PI / 10));
  const x = ecs.x[b], z = ecs.z[b];
  let previous = speed;
  for (let i = 0; i < Math.ceil(speed / launchDecay(LAWLESS.meleeUnit)); i++) {
    const cmd = command(w, b);
    w.applyCommand(b, cmd); pred.applyCommand(pe, cmd);
    const now = Math.hypot(ecs.lvx[b], ecs.lvz[b]);
    near(now, Math.max(0, previous - launchDecay(LAWLESS.meleeUnit)));
    assert.deepEqual(pred.playerState(pe), w.playerState(b)); previous = now;
    if (i === 0) { near(ecs.x[b] - x, speed * Math.cos(Math.PI / 10) * DT); near(ecs.z[b] - z, speed * Math.sin(Math.PI / 10) * DT); }
  }
  assert.equal(ecs.lvx[b], 0); assert.equal(ecs.lvz[b], 0);
});

test('real pistol shots freeze only the right-gun victim; left gun stays chip', () => {
  for (const [btn, skill] of [[BTN.GUARD, 'gun_r'], [BTN.ATTACK, 'gun_l']]) {
    const S = calaServer(), { w, ecs } = S;
    w.meleeVersion = 1; w.rng = () => 1;
    const a = S.join(1, OPEN.x, OPEN.z, WEAPON.PISTOLAS), b = S.join(2, OPEN.x + 6, OPEN.z);
    for (let i = 0; i < 4; i++) S.both();
    let ev;
    for (let i = 0; i < 40 && !ev; i++) {
      S.both(i === 0 ? { btn, prs: btn } : {});
      ev = S.events(2, 'duel').find((e) => e.skill === skill);
    }
    assert.ok(ev, skill); assert.equal(ecs.hitlag[a], 0);
    if (skill === 'gun_r') { assert.equal(ecs.hitlag[b], ev.hl); assert.ok(ev.hl > 0); assert.ok(ecs.lvx[b] > 0); }
    else { assert.equal(ev.hl, 0); assert.equal(ecs.hitlag[b], 0); assert.equal(ecs.lvx[b], 0); assert.equal(ecs.lvz[b], 0); }
  }
});

test('flag off keeps the old sabre shove and telemetry', () => {
  const S = duel(0), ev = sabre(S);
  for (const e of [S.a, S.b]) {
    assert.equal(S.ecs.hitlag[e], 0); assert.equal(S.ecs.lvx[e], 0); assert.equal(S.ecs.lvz[e], 0);
  }
  assert.ok(S.ecs.kbx[S.b] > 0); assert.ok(!('kb' in ev));
  assert.ok(S.w.feelQ.has(S.a));
});

test('dodge and mercy keep their old rules with the flag on; block and perfect are Melee shield hits (P2)', () => {
  for (const outcome of ['block', 'perfect', 'dodge', 'mercy']) {
    const S = duel(), { ecs, a, b, w } = S;
    ecs.facing[b] = -Math.PI / 2;
    const shield = outcome === 'block' || outcome === 'perfect';
    if (shield) ecs.guardT[b] = outcome === 'block' ? 1 : 0;
    if (outcome === 'dodge') ecs.iframes[b] = 1;
    if (outcome === 'mercy') ecs.hurtInv[b] = 1;
    const hp = ecs.hp[b];
    blow(S, 'gun_r', { heavy: true });
    const ev = w.events.findLast((e) => e.type === 'duel');
    assert.equal(ev.out, outcome); assert.equal(ev.hs, 0); assert.equal(ecs.hp[b], hp); assert.equal(ecs.hitlag[a], 0);
    // A shot freezes only the shield it hits (tests/melee-shield.test.mjs holds the shield rules).
    assert.equal(ev.hl, ecs.hitlag[b]); assert.equal(ecs.hitlag[b] > 0, shield);
  }
});

test('damage uses actual HP removed, later hits overwrite hitlag and rain never launches', () => {
  const S = duel(), { ecs, b, a, w } = S;
  ecs.hp[b] = ecs.maxHp[b] / 2;
  const hp = ecs.hp[b]; blow(S, 'lunge');
  const d = 100 * (hp - ecs.hp[b]) / ecs.maxHp[b], p = 100 * (ecs.maxHp[b] - ecs.hp[b]) / ecs.maxHp[b];
  const ev = w.events.findLast((e) => e.type === 'duel');
  near(ev.kb, Math.round(knockback(p, d, 87, 35, 60) * 10) / 10);
  ecs.hitlag[a] = ecs.hitlag[b] = 20; blow(S, 'lunge');
  assert.ok(ecs.hitlag[b] < 20); assert.equal(ecs.hitlag[a], ecs.hitlag[b]);
  const R = duel(); blow(R, 'rain', { above: true });
  assert.equal(R.ecs.hitlag[R.b], 0); assert.equal(R.ecs.lvx[R.b], 0); assert.equal(R.ecs.kbx[R.b], 0);
});

test('projectile velocity wins over the origin and default skills freeze only the victim', () => {
  const S = duel(); blow(S, 'shot', { dx: 0, dz: -20 });
  near(S.ecs.lvx[S.b], 0); assert.ok(S.ecs.lvz[S.b] < 0); assert.equal(S.ecs.hitlag[S.a], 0);
  const F = duel(); blow(F, 'future-area');
  assert.ok(F.ecs.lvx[F.b] > 0); assert.equal(F.ecs.hitlag[F.a], 0);
});

function mobFight(kind = 'grunt', version = 1) {
  const { w, e: a } = arena(), ecs = w.ecs;
  w.meleeVersion = version; w.rng = Object.assign(() => 1, w.rng);
  const mob = w.spawnEnemy(kind, ecs.x[a] + 1.6, ecs.z[a], 0);
  w.events.length = 0;
  const hit = (raw = 1, extra = {}) => {
    const o = { by: a, kind: 'melee', stage: 1, x: ecs.x[a], z: ecs.z[a], ...extra };
    w.strike(mob, raw, o);
    return w.events.findLast((ev) => ev.type === 'damage');
  };
  return { w, ecs, a, mob, hit, brain: ecs.brain[mob] };
}

test('PvE sabre freezes both fighters and mob timers, then launches along facing with linear decay', () => {
  const S = mobFight(), { w, ecs, a, mob, brain } = S;
  sabre(S);
  const ev = w.events.findLast((ev) => ev.type === 'damage'), d = meleePercent(ev.dmg, ecs.maxHp[mob], LAWLESS.meleeStamina);
  assert.equal(ev.hl, hitlagFrames(d)); assert.equal(ecs.hitlag[a], ev.hl);
  near(ecs.stagger[mob], ev.hs / 60); assert.ok(ecs.lvx[mob] > 0); near(ecs.lvz[mob], 0);
  assert.equal(ecs.kbx[mob], 0); assert.ok(!w.feelQ.has(a));
  const x = ecs.x[mob], z = ecs.z[mob], t = brain.t, sinceHit = brain.sinceHit, gcd = brain.gcd;
  for (let i = ev.hl; i > 0; i--) {
    stepEnemy(w, mob, DT); w.applyCommand(a, command(w, a, { mx: 1 }));
    assert.equal(ecs.hitlag[mob], i - 1); near(ecs.x[mob], x); near(ecs.z[mob], z);
    assert.equal(brain.t, t); assert.equal(brain.sinceHit, sinceHit); assert.equal(brain.gcd, gcd);
    assert.equal(ecs.vx[mob], 0); assert.equal(ecs.vz[mob], 0); assert.equal(ecs.moveMag[mob], 0);
  }
  const speed = Math.hypot(ecs.lvx[mob], ecs.lvz[mob]);
  stepEnemy(w, mob, DT); near(ecs.x[mob] - x, speed * DT);
  near(Math.hypot(ecs.lvx[mob], ecs.lvz[mob]), speed - launchDecay(LAWLESS.meleeUnit));
});

test('a mob under 100 HP counts 100 for its percent; a tumble knocks it down along the launch', () => {
  const { ecs, mob, hit } = mobFight();
  let ev = hit(10);
  near(ev.p, 10); assert.equal(ev.hl, hitlagFrames(10)); assert.ok(!ev.kd); near(ecs.stagger[mob], ev.hs / 60);
  near(ev.la, Math.round(Math.atan2(ecs.lvz[mob], ecs.lvx[mob]) * 1000) / 1000);
  ecs.hp[mob] = ecs.maxHp[mob] = 400; ecs.hp[mob] = 120; ecs.hitlag[mob] = 0;
  ev = hit(30, { stage: 3, heavy: true });
  assert.ok(ev.kb >= LAWLESS.meleeTumble); assert.equal(ev.kd, 1);
  near(ecs.stagger[mob], meleeStun(ev.kb, ev.hs, LAWLESS.meleeTumble, LAWLESS.meleeDown), 1e-6);
});

test('wind-up armor absorbs a jab but a heavy blow at high percent launches and cancels', () => {
  for (const state of ['windup', 'fire']) {
    const { w, ecs, mob, hit, brain } = mobFight(); brain.state = state;
    let ev = hit(); assert.ok(ev.kb < LAWLESS.meleeArmorKb); assert.ok(ecs.hitlag[mob] > 0);
    assert.equal(ecs.lvx[mob], 0); assert.equal(ecs.stagger[mob], 0); assert.equal(brain.state, state);
    assert.ok(!w.events.some((ev) => ev.type === 'cancel'));
    ecs.hp[mob] = ecs.maxHp[mob] * 0.2;
    ev = hit(4, { stage: 3, heavy: true }); assert.ok(ev.kb >= LAWLESS.meleeArmorKb);
    assert.ok(ecs.lvx[mob] > 0); near(ecs.stagger[mob], ev.hs / 60);
    assert.equal(brain.state, 'chase'); assert.equal(brain.gcd, 0.8);
    assert.ok(w.events.some((ev) => ev.type === 'cancel' && ev.src === mob));
  }
});

test('a boss takes hitlag without launch or hitstun and keeps its shield break rules', () => {
  const { ecs, a, mob, hit, brain } = mobFight('hellfire');
  brain.state = 'chase'; brain.inv = 0;
  const ev = hit(14); assert.ok(ev.hl > 0); assert.equal(ecs.hitlag[mob], ev.hl); assert.equal(ecs.hitlag[a], ev.hl);
  assert.equal(ecs.lvx[mob], 0); assert.equal(ecs.lvz[mob], 0); assert.equal(ecs.stagger[mob], 0);
  hit(14, { kind: 'shot', heavy: true }); assert.ok(brain.broken > 0); assert.ok(ecs.stagger[mob] > 0);
});

test('the Sandbag flies, reports percent and hit metrics, then regenerates home at full HP', () => {
  const { w, ecs, mob, hit, brain } = mobFight('dummy');
  // Its percent climbs as a 100-HP pirate's (meleeHp), though it has 300 HP.
  const ev = hit(10); assert.equal(ev.p, 10);
  assert.equal(ev.hl, hitlagFrames(10));
  near(ev.kb, Math.round(knockback(10, 10, 87, 20, 50) * 10) / 10);
  assert.equal(ev.hs, hitstunFrames(knockback(10, 10, 87, 20, 50)));
  assert.ok(ecs.lvx[mob] > 0);
  for (let i = 0; i <= ev.hl; i++) stepEnemy(w, mob, DT);
  assert.ok(ecs.x[mob] > brain.homeX);
  ecs.facing[mob] = 2; ecs.kbx[mob] = 3; ecs.kbz[mob] = 4;
  brain.sinceHit = defOf(ecs, mob).regen;
  stepEnemy(w, mob, DT);
  assert.equal(ecs.hp[mob], ecs.maxHp[mob]); near(ecs.x[mob], brain.homeX); near(ecs.z[mob], brain.homeZ);
  near(ecs.facing[mob], brain.homeF);
  for (const k of ['lvx', 'lvz', 'kbx', 'kbz', 'hitlag']) assert.equal(ecs[k][mob], 0, k);
});

test('a mob projectile freezes only the pirate and prediction matches launch and exit DI', () => {
  const { w, ecs, a, mob } = mobFight(); incoming(w, a, 1, 0.4, 0, 14);
  const pred = new World(GAME.seed, { map, server: false }), pe = pred.spawnPlayer({});
  pred.meleeVersion = 1; pred.setPlayerState(pe, w.playerState(a));
  incoming(pred, pe, 1, 0.4, 0, 14); w.tick = pred.tick = 10;
  const cmd = command(w, a); w.applyCommand(a, cmd); pred.applyCommand(pe, cmd);
  const ev = w.events.findLast((ev) => ev.type === 'hurt'); assert.ok(ev && ev.hl > 0);
  assert.equal(ecs.hitlag[a], ev.hl); assert.equal(ecs.hitlag[mob], 0);
  assert.ok(ecs.lvx[a] < 0); near(ecs.lvz[a], 0); assert.equal(ecs.kbx[a], 0);
  near(ecs.stagger[a], ev.hs / 60); const speed = Math.hypot(ecs.lvx[a], ecs.lvz[a]);
  for (let i = 0; i < ev.hl; i++) {
    const c = command(w, a, { mz: 1 }); w.applyCommand(a, c); pred.applyCommand(pe, c);
    assert.deepEqual(pred.playerState(pe), w.playerState(a));
  }
  near(ecs.lvx[a], -speed * Math.cos(Math.PI / 10)); near(ecs.lvz[a], speed * Math.sin(Math.PI / 10));
});

test('a melee circle freezes its enemy owner, a keep shell does not, and prediction needs no enemy', () => {
  for (const keep of [0, 1]) {
    const { w, ecs, a, mob } = mobFight(); w.tick = 2;
    const pred = new World(GAME.seed, { map, server: false }), pe = pred.spawnPlayer({});
    pred.meleeVersion = 1; pred.setPlayerState(pe, w.playerState(a));
    const o = { owner: mob, x: ecs.x[a] - 0.6, z: ecs.z[a], r: 2, tAct: 2, dmg: 12, keep };
    const circle = w.addAoe(o); pred.addAoe(o);
    assert.notEqual(circle.id, mob, 'circle identity is not its owner');
    const cmd = command(w, a); w.applyCommand(a, cmd); pred.applyCommand(pe, cmd);
    const ev = w.events.findLast((ev) => ev.type === 'hurt'); assert.equal(ev.kind, 'aoe');
    assert.equal(ecs.hitlag[mob], keep ? 0 : ev.hl);
    assert.deepEqual(pred.playerState(pe), w.playerState(a));
  }
});

test('flag off keeps PvE sabre and mob projectile shoves without hitlag or launch', () => {
  const S = mobFight('grunt', 0), { w, ecs, a, mob } = S; sabre(S);
  assert.ok(ecs.kbx[mob] > 0); assert.ok(w.feelQ.has(a));
  assert.ok(!('kb' in w.events.findLast((ev) => ev.type === 'damage')));
  ecs.atkStage[a] = 0; incoming(w, a, 1, 0.4, 0, 14); w.tick = 10; w.applyCommand(a, command(w, a)); assert.ok(ecs.kbx[a] < 0);
  for (const e of [a, mob]) for (const k of ['hitlag', 'lvx', 'lvz']) assert.equal(ecs[k][e], 0, k);
});

test('WELCOME carries melee 1 and the client prediction takes the authoritative rule', () => {
  const sent = [], s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, melee: true, send: (_id, m) => sent.push(m) });
  s.connect(1); s.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Test' });
  const welcome = sent.find((m) => m.t === MSG.WELCOME); assert.equal(welcome.melee, 1);
  const client = new GameClient({ onSnapshot() {}, onMessage() {} }, map, { emit() {} });
  client.onMessage(welcome); assert.equal(client.pred.meleeVersion, 1);
  client.onMessage({ ...welcome, melee: undefined }); assert.equal(client.pred.meleeVersion, 0);
});

test('LocalServer accepts MN_MELEE only as an explicit boolean option', () => {
  for (const melee of [undefined, false, '1', true]) {
    const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, melee, send: () => {} });
    assert.equal(s.world.meleeVersion, melee === true ? 1 : 0);
  }
});

test('tattoo callbacks keep Melee hitstun exact while blocked blows meet the shield (no stagger, shieldstun)', () => {
  for (const blocked of [false, true]) {
    const S = duel(), { w, ecs, a, b } = S;
    if (blocked) { ecs.facing[b] = -Math.PI / 2; ecs.guardT[b] = 1; }
    w.skillStrike(a, b, 0.1, { skill: 'tromba', stun: 1.4, knock: 3, heavy: true }, ecs.x[a], ecs.z[a], 1, w.tick);
    const ev = w.events.findLast((e) => e.type === 'duel');
    assert.equal(ev.out, blocked ? 'block' : 'hit');
    near(ecs.stagger[b], blocked ? 0 : ev.hs / 60);
    if (blocked) assert.ok(ecs.guardStun[b] > 0);
    if (!blocked) { assert.equal(ecs.atkStage[b], 0); assert.equal(ecs.guardT[b], -1); assert.equal(ecs.castK[b], 0); }
  }
});

test('a lethal hit caps percent and damage at remaining HP and clears launch state', () => {
  const S = duel(), { w, ecs, b } = S;
  ecs.hp[b] = 1; ecs.lvx[b] = 5; ecs.hitlag[b] = 10;
  blow(S, 'lunge', {}, 10000);
  const ev = w.events.findLast((e) => e.type === 'duel');
  assert.equal(ev.p, 100); assert.equal(ecs.dead[b], 1); assert.equal(ecs.hitlag[b], 0); assert.equal(ecs.lvx[b], 0);
  const kb = knockback(100, 100 / ecs.maxHp[b], 87, 35, 60);
  near(ev.kb, Math.round(kb * 10) / 10);
});

test('a spin launches a pirate behind the attacker away from them, a front one along the facing', () => {
  for (const side of [1, -1]) {
    const S = duel(), { w, ecs, a, b } = S;
    ecs.x[b] = ecs.x[a] + side; ecs.z[b] = ecs.z[a];
    w.strike(b, 14, { by: a, kind: 'melee', stage: 3, heavy: true, x: ecs.x[a], z: ecs.z[a] });
    assert.ok(ecs.hitlag[b] > 0); assert.equal(Math.sign(ecs.lvx[b]), side); near(ecs.lvz[b], 0, 1e-9);
  }
});

test('PvE move rows preserve armor scaling, projectile direction and noKb without callback stuns', () => {
  for (const skill of ['gun_l', 'rain', 'melee1']) {
    const { w, ecs, a, mob, brain } = mobFight(); brain.state = 'windup';
    w.skillStrike(a, mob, 0.01, { skill, stun: 2, heavy: true }, ecs.x[a], ecs.z[a], 1, w.tick);
    assert.equal(brain.state, 'windup'); assert.equal(ecs.lvx[mob], 0); assert.equal(ecs.stagger[mob], 0);
    if (skill !== 'melee1') assert.equal(ecs.hitlag[mob], 0);
  }
  const { ecs, a, mob, hit } = mobFight('crab');
  ecs.facing[mob] = -Math.PI / 2;
  const ev = hit(10), d = 100 * ev.dmg / ecs.maxHp[mob];
  assert.equal(ev.armor, 1);
  near(ev.kb, Math.round(knockback(100 * (ecs.maxHp[mob] - ecs.hp[mob]) / ecs.maxHp[mob], d, 174, 20, 50) * 0.3 * 10) / 10);
  const P = mobFight(); P.hit(1, { kind: 'shot', dx: 0, dz: -20 });
  assert.equal(P.ecs.hitlag[P.a], 0); near(P.ecs.lvx[P.mob], 0); assert.ok(P.ecs.lvz[P.mob] < 0);
  const B = mobFight(); B.ecs.x[B.mob] = B.ecs.x[B.a] - 1;
  B.hit(1, { stage: 3 }); assert.ok(B.ecs.lvx[B.mob] < 0);
});
