// M3 (PLAN-M3.md): curtains, beams, lava, the mortar crab, 5 waves and Hellfire in 3 phases, on the pure sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { Hazards, emitPattern, patternCount, patternSpan, lavaR } from '../src/sim/projectiles.js';
import { tuning, DT } from '../src/data/tuning.js';
import { BTN } from '../src/sim/systems/movement.js';
import { GAME } from '../src/data/meta.js';
import { damageEnemy } from '../src/sim/systems/enemies.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

// A server world with one player in the arena, stepped one command per tick.
function arena(x = A.x + 6, z = A.z + 6) {
  const w = new World(GAME.seed, { map, server: true });
  const e = w.spawnPlayer({ x, z, facing: Math.PI / 2 });
  w.events.length = 0;
  let seq = 0;
  const step = (o = {}) => {
    const cmd = { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], prs: 0, pt: w.tick, ...o };
    w.applyCommand(e, cmd);
    w.stepWorld();
    const evs = w.events.slice();
    w.events.length = 0;
    return evs;
  };
  return { w, e, step };
}
const hurts = (evs, kind) => evs.filter((ev) => ev.type === 'hurt' && (!kind || ev.kind === kind));

test('a curtain (rows) leaves holes, crosses the arena with its own life and expands the same on the client', () => {
  const ev = { pid0: 10, tick: 100, src: 3, pat: 'rows', ptype: 'parry', n: 30, waves: 4, gap: 0.9, sp: 1.15, holes: [4, 12, 20, 9], hw: 3, life: 8, speed: 5.5, dmg: 8, x: A.x, y: 5.8, z: A.z - 16, ang: 0, slope: 0 };
  const a = new Hazards(), b = new Hazards();
  emitPattern(a, ev, map);
  emitPattern(b, JSON.parse(JSON.stringify(ev)), map);
  assert.equal(patternCount(ev), 120, 'ids for every slot');
  assert.equal(a.count, 120 - 4 * 3, 'the holes are not spawned');
  assert.equal(b.count, a.count);
  assert.ok(Math.abs(patternSpan(ev) - 2.7) < 1e-9);
  // Row 0: slots 4, 5, 6 are missing, the rest is a straight line across ang, all with the long life.
  assert.equal(a.slot.get(10 + 4), undefined);
  assert.equal(a.slot.get(10 + 7) !== undefined, true);
  const s0 = a.slot.get(10), s29 = a.slot.get(10 + 29);
  assert.ok(Math.abs(a.x0[s29] - a.x0[s0] - 29 * 1.15) < 1e-9 && Math.abs(a.z0[s29] - a.z0[s0]) < 1e-9);
  for (const [id, s] of a.slot) {
    const t = b.slot.get(id);
    assert.equal(a.x0[s], b.x0[t]); assert.equal(a.t0[s], b.t0[t]); assert.equal(a.tEnd[s], b.tEnd[t]);
  }
  const mid = a.slot.get(10 + 15);
  assert.ok((a.tEnd[mid] - a.t0[mid]) * DT > tuning.projectiles.parryable.life + 1, 'lives longer than a normal orb');
});

test('a laser turns, hurts every `every` ticks, and a dash through it is a FANTASMA without damage', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  ecs.x[e] = A.x + 6; ecs.z[e] = A.z;
  // A laser from the arena centre pointing at +x (ang π/2), active right away, not turning.
  w.addBeam({ owner: 0, kind: 'laser', x0: A.x, z0: A.z, ang0: Math.PI / 2, omega: 0, off: 1, len: 20, w: 0.9, tAct: w.tick + 3, tEnd: w.tick + 120, dmg: 10, every: 12 });
  let evs = [];
  for (let i = 0; i < 60; i++) evs.push(...step());
  const h = hurts(evs, 'beam');
  // hurtIframes (0.35 s = 21 ticks) is longer than every (12): one hit per 21+ ticks.
  assert.ok(h.length >= 2 && h.length <= 3, `hit a few times while standing in it (${h.length})`);
  // Turning beam: a player 6 u away at 90° gets swept after ~1.8 s at 50 °/s.
  const t2 = arena();
  t2.w.ecs.x[t2.e] = A.x; t2.w.ecs.z[t2.e] = A.z + 6;
  t2.w.addBeam({ owner: 0, kind: 'laser', x0: A.x, z0: A.z, ang0: Math.PI / 2, omega: -50 * Math.PI / 180, off: 1, len: 20, w: 0.9, tAct: t2.w.tick + 1, tEnd: t2.w.tick + 240, dmg: 10, every: 12 });
  let first = -1;
  for (let i = 0; i < 200 && first < 0; i++) if (hurts(t2.step(), 'beam').length) first = i;
  assert.ok(first > 90 && first < 125, `swept by the turning laser after ~1.8 s (${first} ticks)`);
  // Dash through a fire lane: no damage, one FANTASMA.
  const t3 = arena();
  const p = t3.w.ecs;
  p.x[t3.e] = A.x - 3; p.z[t3.e] = A.z;
  t3.w.addBeam({ owner: 0, kind: 'lane', x0: A.x, z0: A.z - 20, ang0: 0, off: 0, len: 40, w: 3, tAct: t3.w.tick + 1, tEnd: t3.w.tick + 400, dmg: 10, every: 15 });
  for (let i = 0; i < 5; i++) t3.step();
  evs = [];
  evs.push(...t3.step({ mx: 1, mz: 0, prs: BTN.DASH, btn: BTN.DASH }));
  for (let i = 0; i < 14; i++) evs.push(...t3.step({ mx: 1, mz: 0 }));
  assert.ok(p.x[t3.e] > A.x + 1.5, `dashed across (${(p.x[t3.e] - A.x).toFixed(2)})`);
  assert.equal(hurts(evs, 'beam').length, 0, 'no damage');
  assert.equal(evs.filter((ev) => ev.type === 'ghost' && ev.beam).length, 1, 'one FANTASMA');
});

test('the lava ring shrinks to its minimum and burns only outside it, pushing you inward', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const L = w.setLava({ cx: A.x, cz: A.z, r0: 19, rMin: 11, rate: 0.12 * 20, t0: w.tick, R: 21, dmg: 6, every: 30 });
  assert.equal(lavaR(L, w.tick), 19);
  assert.equal(lavaR(L, w.tick + 10 / DT), 11, 'stops at rMin');
  ecs.x[e] = A.x + 8; ecs.z[e] = A.z;
  let evs = [];
  for (let i = 0; i < 60; i++) evs.push(...step());
  assert.equal(hurts(evs, 'lava').length, 0, 'safe inside');
  ecs.x[e] = A.x + 18; ecs.z[e] = A.z; // at 1 s the safe radius is 16.6
  evs = [];
  for (let i = 0; i < 61; i++) evs.push(...step());
  const h = hurts(evs, 'lava');
  assert.ok(h.length === 2 || h.length === 3, `burns every 0.5 s (${h.length})`);
  assert.ok(ecs.x[e] < A.x + 18, 'pushed toward the centre');
  assert.equal(ecs.hurtInv[e] > tuning.combat.hurtIframes - 0.05, false, 'lava gives no hurt iframes');
  w.setLava(null);
  assert.equal(w.hazards.lava, null);
});

test('keep circles (mortar shells, meteors) still land when their owner dies; normal ones are cancelled', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const foe = w.debugSpawn('archer', A.x + 12, A.z, 0);
  const px = ecs.x[e], pz = ecs.z[e];
  const keep = w.addAoe({ owner: foe, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12, keep: 1, fall: 'mortar', fx: ecs.x[foe], fz: ecs.z[foe], fy: 1 });
  const norm = w.addAoe({ owner: foe, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12 });
  w.killEnemy(foe, e);
  assert.equal(!!keep.cancel, false);
  assert.equal(!!norm.cancel, true);
  let evs = [];
  for (let i = 0; i < 40; i++) evs.push(...step());
  assert.equal(hurts(evs, 'aoe').length, 1, 'the shell in the air still lands');
  // clearHostile (end of a wave, phase change) removes everything, kept or not.
  const k2 = w.addAoe({ owner: 0, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12, keep: 1 });
  w.clearHostile();
  assert.equal(k2.cancel, true);
});

test('mortar crab: three shells around the target that land after the flight, even if the crab dies', () => {
  const { w, e, step } = arena(A.x + 4, A.z);
  const ecs = w.ecs;
  const c = w.debugSpawn('crab', A.x + 13, A.z, -Math.PI / 2);
  let evs = [], aoes = [];
  for (let i = 0; i < 400 && !aoes.length; i++) { evs = step(); aoes = evs.filter((ev) => ev.type === 'aoe'); }
  assert.equal(aoes.length, 3, 'three shells');
  for (const a of aoes) {
    assert.equal(a.keep, 1); assert.equal(a.fall, 'mortar');
    assert.ok(Math.abs((a.tAct - a.tick) * DT - 1.1) < 0.25, 'about 1.1 s of flight');
    assert.ok(Math.hypot(a.x - ecs.x[e], a.z - ecs.z[e]) < 5.5, 'around the target');
  }
  assert.ok(aoes.some((a) => Math.hypot(a.x - ecs.x[e], a.z - ecs.z[e]) < 0.8), 'one right on the target');
  w.killEnemy(c, e);
  let hit = 0;
  for (let i = 0; i < 90; i++) hit += hurts(step(), 'aoe').length;
  assert.equal(hit, 1, 'the shell on you lands after its thrower died');
});

test('mortar crab armour: × 0.2 from the front, full damage from behind, reflected shots ignore it', () => {
  const { w, e } = arena();
  const ecs = w.ecs;
  const c = w.debugSpawn('crab', A.x, A.z, 0); // facing +z
  const hit = (x, z, kind) => {
    ecs.hp[c] = ecs.maxHp[c];
    w.events.length = 0;
    const dmg = damageEnemy(w, c, 40, { by: e, kind, x, z });
    return { dmg, armor: w.events.find((ev) => ev.type === 'damage').armor };
  };
  const crit = tuning.stats.crit;
  tuning.stats.crit = 0;
  const front = hit(A.x, A.z + 2, 'melee'), back = hit(A.x, A.z - 2, 'melee'), side = hit(A.x + 2, A.z + 0.3, 'melee'), shot = hit(A.x, A.z + 2, 'shot');
  tuning.stats.crit = crit;
  assert.equal(front.armor, 1);
  assert.equal(back.armor, 0);
  assert.equal(side.armor, 0, 'the flank (90°) is outside the 120° plate');
  assert.equal(shot.armor, 0);
  assert.ok(front.dmg * 3 < back.dmg, `front ${front.dmg} vs back ${back.dmg}`);
  assert.ok(shot.dmg >= back.dmg * 0.9, 'reflects go through');
  // Slow to turn: after 0.3 s it has turned at most 2.4 · 0.3 rad toward a player behind it.
  ecs.x[e] = A.x; ecs.z[e] = A.z - 8;
  const f0 = ecs.facing[c];
  for (let i = 0; i < 18; i++) { w.applyCommand(e, { seq: 1000 + i, mx: 0, mz: 0, ax: 0, az: 0, prs: 0, pt: w.tick }); w.stepWorld(); }
  assert.ok(Math.abs(ecs.facing[c] - f0) <= 2.4 * 0.3 + 0.05, 'turns slowly');
});

import { createEncounter, encounterDev } from '../src/sim/systems/encounter.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';
import { lavaR as lavaAt } from '../src/sim/projectiles.js';

function trial() {
  const t = arena(A.x, A.z);
  t.w.ecs.god[t.e] = 1;
  t.enc = createEncounter('caldera', map);
  t.w.encounters.push(t.enc);
  t.run = (sec, o) => { const evs = []; for (let i = 0; i < Math.round(sec / DT); i++) evs.push(...t.step(o)); return evs; };
  return t;
}
// Hellfire up and fighting, in phase p (0-based), the player `d` u east of him every tick.
function bossFight(p) {
  const t = trial();
  const { w, enc, run } = t, ecs = w.ecs;
  encounterDev(w, enc, 'boss');
  run(ENCOUNTERS.caldera.boss.intro + 0.1);
  t.boss = enc.bossE; t.b = ecs.brain[t.boss];
  for (let k = 0; k < p; k++) { encounterDev(w, enc, k === 0 ? 'phase2' : 'phase3'); run(ENEMIES.hellfire.enrage + 0.2); }
  t.hold = (d, sec, fn) => {
    const evs = [];
    for (let i = 0; i < Math.round(sec / DT); i++) {
      ecs.x[t.e] = ecs.x[t.boss] + d; ecs.z[t.e] = ecs.z[t.boss];
      const ev = t.step();
      evs.push(...ev);
      if (fn && fn(ev)) break;
    }
    return evs;
  };
  return t;
}

test('Hellfire has 3 phases: thresholds at 70 % and 35 %, phase 3 lights the lava, his death puts it out', () => {
  const t = bossFight(0), { w, enc, boss, b } = t, ecs = w.ecs;
  assert.equal(b.phase, 0);
  ecs.hp[boss] = Math.floor(ecs.maxHp[boss] * 0.71);
  t.hold(9, 0.1);
  assert.equal(b.phase, 0, 'still phase 1 at 71 %');
  ecs.hp[boss] = Math.floor(ecs.maxHp[boss] * 0.69);
  let evs = t.hold(9, 0.1);
  assert.ok(evs.some((ev) => ev.type === 'phase' && ev.phase === 2) && b.shieldOn);
  t.hold(9, ENEMIES.hellfire.enrage + 0.2);
  ecs.hp[boss] = Math.floor(ecs.maxHp[boss] * 0.34);
  evs = t.hold(9, 0.2);
  const ph = evs.find((ev) => ev.type === 'phase' && ev.phase === 3);
  assert.ok(ph && ph.last === 1 && !b.shieldOn, 'phase 3, no shield');
  const lv = evs.find((ev) => ev.type === 'lava');
  assert.ok(lv && lv.r0 === 19 && lv.rMin === 11, 'the lava ring appears');
  assert.ok(w.hazards.lava);
  assert.ok(lavaAt(w.hazards.lava, w.tick + 70 / DT) === 11, 'and shrinks to 11 u in about a minute');
  // Phase 3 stun: a reflected heavy orb stuns him 3 s, damage × 2.
  t.hold(9, ENEMIES.hellfire.enrage + 0.2);
  damageEnemy(w, boss, 100, { by: t.e, kind: 'shot', heavy: true, x: ecs.x[t.e], z: ecs.z[t.e], pierce: true });
  assert.ok(Math.abs(ecs.stagger[boss] - 3) < 0.05 && b.broken > 0);
  w.killEnemy(boss, t.e);
  evs = t.hold(0, 0.1);
  assert.equal(enc.st, 'victory');
  assert.equal(w.hazards.lava, null);
  assert.ok(evs.some((ev) => ev.type === 'lava' && ev.off));
});

test('Hellfire phase 1 charge: a telegraphed rush along a line that moves him and hits once', () => {
  const t = bossFight(0), { w, boss, b } = t, ecs = w.ecs;
  b.cyc = ENEMIES.hellfire.phases[0].cycle.indexOf('charge'); b.gcd = 0; b.heavyT = 99; b.slamCd = 99;
  const x0 = ecs.x[boss], z0 = ecs.z[boss];
  // The player stands still 8 u away: he rushes through them.
  ecs.x[t.e] = x0 + 8; ecs.z[t.e] = z0;
  let beam = null;
  const evs = t.run(3);
  beam = evs.find((q) => q.type === 'beam' && q.kind === 'charge');
  assert.ok(beam, 'charge beam');
  assert.ok(beam.tele > 5 && (beam.tAct - beam.tick) * DT > 0.6, 'telegraphed along its length for 0.7 s');
  assert.ok(Math.hypot(ecs.x[boss] - x0, ecs.z[boss] - z0) > 5, 'he moved along it');
  assert.equal(evs.filter((ev) => ev.type === 'hurt' && ev.kind === 'beam').length, 1, 'one hit (the player was in his way)');
});

test('Hellfire phase 2 double laser and phase 3 lanes, meteors and curtain', () => {
  const t2 = bossFight(1), b2 = t2.b;
  b2.cyc = ENEMIES.hellfire.phases[1].cycle.indexOf('laser2'); b2.gcd = 0; b2.heavyT = 99; b2.slamCd = 99;
  let lasers = [];
  t2.hold(8, 2, (ev) => { lasers.push(...ev.filter((q) => q.type === 'beam' && q.kind === 'laser')); return lasers.length >= 2; });
  assert.equal(lasers.length, 2);
  assert.ok(Math.abs(Math.abs(lasers[0].ang0 - lasers[1].ang0) - Math.PI) < 1e-9, 'opposite');
  assert.ok(Math.abs(Math.abs(lasers[0].omega) - 50 * Math.PI / 180) < 1e-9 && lasers[0].omega === lasers[1].omega);
  // The next laser2 turns the other way.
  const s0 = Math.sign(lasers[0].omega);
  b2.cyc = ENEMIES.hellfire.phases[1].cycle.lastIndexOf('laser2');
  lasers = [];
  t2.hold(8, 10, (ev) => { lasers.push(...ev.filter((q) => q.type === 'beam' && q.kind === 'laser')); return lasers.length >= 2; });
  assert.equal(Math.sign(lasers[0].omega), -s0, 'alternates direction');

  const t3 = bossFight(2), b3 = t3.b, ecs = t3.w.ecs;
  const P3 = ENEMIES.hellfire.phases[2];
  const want = (id) => { b3.cyc = P3.cycle.indexOf(id); b3.gcd = 0; b3.heavyT = 99; b3.slamCd = 99; b3.state = 'chase'; };
  want('lanes');
  let lanes = [];
  t3.hold(8, 2, (ev) => { lanes.push(...ev.filter((q) => q.type === 'beam' && q.kind === 'lane')); return lanes.length >= 3; });
  assert.equal(lanes.length, 3, 'three fire lanes');
  assert.ok(lanes.every((l) => l.w === 3 && Math.abs(l.ang0 - lanes[0].ang0) < 1e-9 && Math.hypot(l.vx, l.vz) === 5), 'parallel, sliding at 5 u/s');
  t3.hold(8, 4);
  want('meteors');
  let met = [];
  t3.hold(8, 3, (ev) => { met.push(...ev.filter((q) => q.type === 'aoe' && q.fall === 'meteor')); return met.length >= 8; });
  assert.equal(met.length, 8);
  const L = t3.w.hazards.lava;
  assert.ok(met.filter((m) => Math.hypot(m.x - ecs.x[t3.e], m.z - ecs.z[t3.e]) < 0.5).length >= 2, 'one in three on the player');
  assert.ok(met.every((m) => Math.hypot(m.x - L.cx, m.z - L.cz) < 19.5), 'inside the arena');
  t3.hold(8, 3);
  want('curtain');
  let cur = null;
  t3.hold(8, 3, (ev) => { cur = ev.find((q) => q.type === 'pattern' && q.pat === 'rows'); return !!cur; });
  assert.ok(cur && cur.holes.length === 4 && cur.life === 8, 'a curtain with one hole per row');
  assert.ok(Math.hypot(cur.x - L.cx, cur.z - L.cz) > 14, 'from the far side of the arena');
});

import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';

test('client prediction stays exact in Hellfire phase 3 (lava, lanes, meteors, curtains)', () => {
  const toClient = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, send: (_id, m) => toClient.push(JSON.parse(JSON.stringify(m))) });
  const snaps = [], msgs = [];
  const transport = {
    onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), start() {},
    sendInput: (_s, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [cmd] }),
    send: (m) => server.receive(1, m),
  };
  const client = new GameClient(transport, map, { emit() {} });
  client.start();
  const deliver = () => { while (toClient.length) { const m = toClient.shift(); if (m.t === MSG.SNAPSHOT) snaps.forEach((cb) => cb(m)); else msgs.forEach((cb) => cb(m)); } };
  server.connect(1); deliver();
  client.join('Test', 1); deliver();
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  const se = server.clients.get(1).entity, ecs = server.world.ecs, enc = server.world.encounters[0];
  ecs.x[se] = enc.cx + 3; ecs.z[se] = enc.cz; ecs.y[se] = map.groundAt(ecs.x[se], ecs.z[se]);
  const dev = (o) => client.send({ t: MSG.CMD, type: 'dev', ...o });
  dev({ op: 'god', on: true }); dev({ op: 'level', level: 7 }); dev({ op: 'enc', sub: 'boss' });
  const idle = (n) => { for (let i = 0; i < n; i++) { client.update(DT); client.tickInput({ mx: 0, mz: 0, ax: enc.cx, az: enc.cz, btn: 0, prs: 0 }); server.step(); deliver(); } };
  idle(200);
  dev({ op: 'enc', sub: 'phase3' });
  idle(10);
  let maxErr = 0, lavaHurt = 0, beamSeen = 0;
  for (let i = 0; i < 1500; i++) {
    client.update(DT);
    const prs = (i % 13 === 0 ? BTN.PARRY : 0) | (i % 97 === 50 ? BTN.DASH : 0) | (i % 37 === 0 ? BTN.ATTACK : 0);
    // Wide circles: in and out of the lava ring.
    const mx = Math.sin(i * 0.02), mz = Math.cos(i * 0.02);
    client.tickInput({ mx, mz, ax: ecs.x[enc.bossE] || enc.cx, az: ecs.z[enc.bossE] || enc.cz, btn: 0, prs });
    server.step();
    for (const ev of server.world.events || []) { if (ev.type === 'hurt' && ev.kind === 'lava') lavaHurt++; }
    beamSeen = Math.max(beamSeen, client.pred.hazards.beams.length);
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  const ce = client.youLocal, pe = client.pred.ecs;
  for (const k of ['x', 'z', 'riposte', 'chain', 'xp']) assert.equal(pe[k][ce], ecs[k][se], k);
  assert.ok(client.pred.hazards.lava, 'the client has the lava ring');
  assert.ok(beamSeen > 0, 'and saw beams');
});
