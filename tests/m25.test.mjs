// M2.5 «La Prueba de Fuego» (PLAN-M2.5.md): new patterns, melee minions, bounces, dodges, the encounter
// and the Hellfire boss, on the pure sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { Hazards, emitPattern, patternCount, patternSpan, PTYPE } from '../src/sim/projectiles.js';
import { tuning, DT } from '../src/data/tuning.js';
import { BTN } from '../src/sim/systems/movement.js';
import { ENEMIES } from '../src/data/enemies.js';
import { damageEnemy } from '../src/sim/systems/enemies.js';
import { GAME } from '../src/data/meta.js';
import { timeToContact, reflectTier } from '../src/sim/systems/combat.js';
import { waitForTier } from './helpers.mjs';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

// A server world with one player in the arena (no map enemies), stepped one command per tick.
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

test('multi-arm spirals and staggered rings expand identically on server and client', () => {
  const pats = [
    { pat: 'spiral', arms: 4, n: 48, gap: 0.05, spread: 9, ptype: 'parry' },
    { pat: 'rings', n: 16, waves: 3, gap: 0.45, spread: 11.25, alt: 1, ptype: 'parry' },
    { pat: 'ring', n: 12, alt: 1, ptype: 'parry' },
  ];
  for (const p of pats) {
    const ev = { pid0: 100, tick: 50, src: 7, speed: 6, dmg: 8, x: A.x, y: 1.2, z: A.z, ang: 0.3, slope: 0, ...p };
    const a = new Hazards(), b = new Hazards();
    assert.equal(emitPattern(a, ev, map), patternCount(ev));
    emitPattern(b, JSON.parse(JSON.stringify(ev)), map); // the client gets it through the wire
    const n = patternCount(ev);
    assert.equal(a.count, n);
    const t = 50 + Math.round(patternSpan(ev) / DT) + 20;
    const types = new Set(), angles = new Set();
    for (let k = 0; k < n; k++) {
      const sa = a.slot.get(100 + k), sb = b.slot.get(100 + k);
      assert.ok(sa !== undefined && sb !== undefined);
      assert.equal(a.t0[sa], b.t0[sb]);
      assert.equal(a.px(sa, t), b.px(sb, t));
      assert.equal(a.pz(sa, t), b.pz(sb, t));
      types.add(a.type[sa]);
      angles.add(Math.round(Math.atan2(a.vx[sa], a.vz[sa]) * 1000));
    }
    if (p.alt) assert.deepEqual([...types].sort(), [PTYPE.PARRY, PTYPE.UNSTOP]);
    assert.ok(angles.size >= n * 0.6, `${p.pat}: shots go in many directions`);
  }
  // Timing: the 4-arm spiral fires 4 at a time, 12 steps 0.05 s apart; 3 rings 0.45 s apart.
  assert.equal(patternSpan({ pat: 'spiral', arms: 4, n: 48, gap: 0.05 }).toFixed(2), '0.55');
  assert.equal(patternSpan({ pat: 'rings', n: 16, waves: 3, gap: 0.45 }).toFixed(2), '0.90');
  assert.equal(patternCount({ pat: 'rings', n: 16, waves: 3 }), 48);
});

test('a drowned grunt chases, bites a player who stands still and misses one who dashes out', () => {
  for (const dodge of [false, true]) {
    const { w, e, step } = arena();
    const g = w.spawnEnemy('grunt', w.ecs.x[e] + 6, w.ecs.z[e], -Math.PI / 2);
    let wind = null, hurt = 0;
    for (let i = 0; i < 240 && !wind; i++) for (const ev of step()) if (ev.type === 'windup' && ev.id === g) wind = ev;
    assert.ok(wind, 'it closes in and winds up the bite');
    assert.equal(wind.atk, 'bite');
    assert.ok(Math.hypot(w.ecs.x[g] - w.ecs.x[e], w.ecs.z[g] - w.ecs.z[e]) < 1.8, 'from melee range');
    const bite = ENEMIES.grunt.attacks[0], ticks = Math.round(bite.windup / DT);
    for (let i = 0; i < ticks + 30; i++) {
      // Dash straight away from it 0.15 s before the bite lands.
      const o = dodge && i === ticks - 9 ? { prs: BTN.DASH, mx: -1, mz: 0 } : dodge && i > ticks - 9 ? { mx: -1, mz: 0 } : {};
      for (const ev of step(o)) if (ev.type === 'hurt' && ev.e === e && ev.kind !== 'contact') hurt += ev.dmg;
    }
    if (dodge) assert.equal(hurt, 0, 'dashed out of the circle');
    else assert.ok(hurt >= 1, 'bitten');
  }
});

test('light enemies fly further from the same hit; encounter spawns rise before they act', () => {
  const { w, e } = arena();
  const a = w.spawnEnemy('grunt', w.ecs.x[e] + 3, w.ecs.z[e]), b = w.spawnEnemy('archer', w.ecs.x[e] - 3, w.ecs.z[e]);
  for (const t of [a, b]) w.ecs.hp[t] = 999;
  const kb = (t) => { w.ecs.kbx[t] = w.ecs.kbz[t] = 0; return t; };
  {
    damageEnemy(w, kb(a), 5, { by: e, kind: 'melee', x: w.ecs.x[e], z: w.ecs.z[e] });
    damageEnemy(w, kb(b), 5, { by: e, kind: 'melee', x: w.ecs.x[e], z: w.ecs.z[e] });
    assert.ok(Math.abs(w.ecs.kbx[a]) > Math.abs(w.ecs.kbx[b]) * 1.5);
    w.events.length = 0;
    const r = w.spawnEnemy('imp', A.x, A.z, 0, { riseT: 0.8, aggro: 40, leash: 60 });
    assert.ok(w.events.some((ev) => ev.type === 'rise' && ev.id === r));
    const br = w.ecs.brain[r];
    assert.equal(br.state, 'wake');
    for (let i = 0; i < 30; i++) w.stepWorld();
    assert.equal(br.state, 'wake', 'still standing up');
    for (let i = 0; i < 30; i++) w.stepWorld();
    assert.notEqual(br.state, 'wake');
    assert.equal(br.target, e, 'the encounter aggro reaches across the arena');
  }
});

// A projectile flying at the player along -x, starting `dist` u in front of them.
function incoming(w, e, type = PTYPE.PARRY, dist = 6, speed = 10, dmg = 8) {
  const id = w.nextPid++;
  w.hazards.spawn(id, type, 0, w.ecs.x[e] + dist, w.ecs.y[e] + 1.1, w.ecs.z[e], -speed, 0, w.tick, dmg, map);
  return id;
}

test('an EXCELENTE reflect kills one enemy and bounces on to the next', () => {
  const { w, e, step } = arena();
  const a = w.spawnEnemy('grunt', w.ecs.x[e] + 7, w.ecs.z[e]), b = w.spawnEnemy('archer', w.ecs.x[e] + 9, w.ecs.z[e] + 4);
  for (const t of [a, b]) { w.ecs.brain[t].state = 'dormant'; w.ecs.brain[t].aggro = 0.01; } // stand still
  w.ecs.hp[b] = 500; w.ecs.maxHp[b] = 500; w.ecs.hp[a] = 10;
  const id = incoming(w, e, PTYPE.PARRY, 6, 8);
  const wait = waitForTier(w, e, id, 3, { timeToContact, reflectTier, tuning });
  for (let i = 0; i < wait; i++) step();
  let parry = null, bounce = null, hitB = 0;
  for (let i = 0; i < 180; i++) {
    for (const ev of step(i === 0 ? { prs: BTN.ATTACK } : {})) {
      if (ev.type === 'parry') parry = ev;
      if (ev.type === 'shot' && ev.from) bounce = ev;
      if (ev.type === 'damage' && ev.id === b && ev.kind === 'shot') hitB += ev.dmg;
    }
  }
  assert.ok(parry && parry.tier === 3, 'EXCELENTE');
  assert.ok(!w.ecs.alive[a] || w.ecs.dead[a], 'the grunt died to the reflect');
  assert.ok(bounce, 'the shot bounced');
  assert.equal(bounce.target, b);
  assert.ok(hitB > 0, 'and hit the second enemy');
});

test('dashing through a parryable bullet is an ESQUIVA (once, no damage); unstoppables stay FANTASMA', () => {
  const { w, e, step } = arena();
  const p = incoming(w, e, PTYPE.PARRY, 4, 10), u = incoming(w, e, PTYPE.UNSTOP, 4.6, 10);
  const got = [];
  let hurt = 0;
  for (let i = 0; i < 40; i++) {
    const evs = step(i === 8 ? { prs: BTN.DASH, mx: 1, mz: 0 } : {});
    for (const ev of evs) { if (ev.type === 'dodge' || ev.type === 'ghost') got.push(ev.type + ':' + ev.pid); if (ev.type === 'hurt') hurt += ev.dmg; }
  }
  assert.deepEqual(got.sort(), [`dodge:${p}`, `ghost:${u}`]);
  assert.equal(hurt, 0);
  assert.equal(w.ecs.riposte[e], tuning.parry.riposte.dodge + tuning.parry.riposte.ghost);
});

// ---- Encounter + boss ------------------------------------------------------------------------------
import { createEncounter, encounterDev } from '../src/sim/systems/encounter.js';
import { ENCOUNTERS } from '../src/data/encounters.js';

function trial() {
  const t = arena(A.x, A.z); // standing on the rune circle
  t.w.ecs.god[t.e] = 1;
  t.enc = createEncounter('caldera', map);
  t.w.encounters.push(t.enc);
  t.run = (sec, o) => { const evs = []; for (let i = 0; i < Math.round(sec / DT); i++) evs.push(...t.step(o)); return evs; };
  t.killAll = () => { for (const e of [...t.enc.alive]) if (t.w.ecs.alive[e]) t.w.killEnemy(e, t.e); };
  return t;
}

test('La Prueba de Fuego: entering starts the waves, clearing them brings Hellfire, killing him wins', () => {
  const { w, e, enc, run, killAll } = trial();
  const D = ENCOUNTERS.caldera, ecs = w.ecs;
  run(0.1);
  assert.equal(enc.st, 'intro');
  run(D.intro + 0.1);
  assert.equal(enc.st, 'wave');
  assert.equal(enc.alive.size, 7, 'wave 1: 5 grunts + 2 archers');
  for (const q of enc.alive) {
    assert.ok(Math.hypot(ecs.x[q] - enc.cx, ecs.z[q] - enc.cz) > 9, 'spawned on the rim, away from the player');
    assert.equal(ecs.brain[q].state, 'wake', 'rising');
  }
  for (let wave = 0; wave < D.waves.length; wave++) {
    assert.equal(enc.wave, wave);
    killAll();
    run(0.1);
    if (D.waves[wave].late) { assert.ok(enc.alive.size > 0, 'late reinforcements'); killAll(); run(0.1); }
    if (wave + 1 < D.waves.length) { assert.equal(enc.st, 'rest'); run(D.rest + 0.1); assert.equal(enc.st, 'wave'); }
  }
  assert.equal(enc.st, 'bossIntro');
  const boss = enc.bossE;
  assert.ok(boss && ecs.alive[boss]);
  run(D.boss.intro + 0.1);
  assert.equal(enc.st, 'boss');
  const xp0 = ecs.xp[e] + ecs.level[e] * 1e6;
  w.killEnemy(boss, e);
  const evs = run(0.1);
  assert.equal(enc.st, 'victory');
  assert.ok(evs.some((ev) => ev.type === 'enc' && ev.st === 'victory'));
  assert.ok(ecs.xp[e] + ecs.level[e] * 1e6 > xp0, 'boss XP');
  run(3.1);
  assert.equal(enc.st, 'idle');
  run(1);
  assert.equal(enc.st, 'idle', 'cooldown before it can start again');
});

test('a wipe resets the trial, and once the boss was reached the next try starts at the boss', () => {
  const { w, e, enc, run } = trial();
  const ecs = w.ecs;
  run(ENCOUNTERS.caldera.intro + 0.2);
  assert.equal(enc.st, 'wave');
  const spawned = [...enc.alive];
  ecs.x[e] = enc.cx + 40; ecs.z[e] = enc.cz; // ran away
  run(ENCOUNTERS.caldera.wipeGrace + 0.2);
  assert.equal(enc.st, 'idle');
  assert.ok(spawned.every((q) => !ecs.alive[q]), 'its enemies are gone');
  assert.equal(enc.reached, '');
  encounterDev(w, enc, 'boss');
  run(0.1);
  assert.ok(enc.bossE);
  run(ENCOUNTERS.caldera.wipeGrace + 0.2);
  assert.equal(enc.st, 'idle');
  assert.equal(enc.reached, 'boss');
  ecs.x[e] = enc.cx; ecs.z[e] = enc.cz;
  run(3.2); // reset cooldown, then step on the runes
  assert.equal(enc.st, 'bossIntro');
});

test('Hellfire: omnidirectional cycle, slam when hugged, ENRAGE at 55 % (invulnerable, bullets cleared, minions), shield vs reflects', () => {
  const { w, e, enc, run } = trial();
  const ecs = w.ecs, H = ENEMIES.hellfire;
  encounterDev(w, enc, 'boss');
  run(ENCOUNTERS.caldera.boss.intro + 0.1);
  const boss = enc.bossE, b = ecs.brain[boss];
  // Keep the player 8 u away: he cycles his phase-1 attacks.
  ecs.x[e] = ecs.x[boss] + 8; ecs.z[e] = ecs.z[boss];
  const seen = new Set();
  let maxLive = 0;
  for (let i = 0; i < 20 / DT; i++) {
    ecs.x[e] = ecs.x[boss] + 8; ecs.z[e] = ecs.z[boss];
    const evs = run(DT);
    for (const ev of evs) if (ev.type === 'pattern' && ev.src === boss) seen.add(ev.atk);
    maxLive = Math.max(maxLive, w.hazards.count);
  }
  for (const id of ['fan5', 'spiral2', 'rings2', 'orb']) assert.ok(seen.has(id), `phase 1 uses ${id}`);
  assert.ok(maxLive > 40, `bullet hell: ${maxLive} projectiles at once`);
  // Hug him: slam.
  let slam = false;
  for (let i = 0; i < 6 / DT && !slam; i++) {
    ecs.x[e] = ecs.x[boss] + 2.5; ecs.z[e] = ecs.z[boss];
    for (const ev of run(DT)) if (ev.type === 'windup' && ev.id === boss && ev.atk === 'slam') slam = true;
  }
  assert.ok(slam, 'slams when hugged');
  // Phase change.
  ecs.hp[boss] = Math.floor(ecs.maxHp[boss] * (H.phases[0].until - 0.01));
  const evs = run(DT * 2);
  assert.ok(evs.some((ev) => ev.type === 'phase' && ev.phase === 2));
  assert.ok(evs.some((ev) => ev.type === 'clear' && ev.hostile));
  assert.ok(b.inv > 0 && b.shieldOn);
  const hp0 = ecs.hp[boss];
  damageEnemy(w, boss, 100, { by: e, kind: 'melee', x: ecs.x[e], z: ecs.z[e] });
  assert.equal(ecs.hp[boss], hp0, 'invulnerable during ENRAGE');
  run(H.enrage + 0.1);
  let minions = 0;
  for (const q of enc.alive) if (ecs.brain[q]?.minion === boss) minions++;
  assert.equal(minions, H.phases[1].summon, 'summons grunts');
  w.rng = () => 0.99; // no crits for the comparisons
  const h1 = ecs.hp[boss];
  damageEnemy(w, boss, 100, { by: e, kind: 'melee', x: ecs.x[e], z: ecs.z[e] });
  const melee = h1 - ecs.hp[boss];
  const h2 = ecs.hp[boss];
  b.shotN = 0;
  damageEnemy(w, boss, 100, { by: e, kind: 'shot', x: ecs.x[e], z: ecs.z[e], pierce: true });
  const shot = h2 - ecs.hp[boss];
  assert.ok(shot > melee * 2.5, `reflects ignore the shield (${shot} vs ${melee})`);
  damageEnemy(w, boss, 100, { by: e, kind: 'shot', heavy: true, x: ecs.x[e], z: ecs.z[e], pierce: true });
  assert.ok(b.broken > 0 && ecs.stagger[boss] > 0, 'a reflected heavy orb breaks the shield and staggers him');
});

import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';

test('client prediction stays exact in the middle of Hellfire phase 2 (parries, dashes, bounces)', () => {
  const toClient = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, send: (_id, m) => toClient.push(JSON.parse(JSON.stringify(m))) });
  const snaps = [], msgs = [];
  const transport = {
    onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), start() {},
    sendInput: (_s, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [cmd] }),
    send: (m) => server.receive(1, m),
  };
  const shown = [];
  const client = new GameClient(transport, map, { emit: (type, ev) => { if (type === 'combat') shown.push(ev); } });
  client.start();
  const deliver = () => { while (toClient.length) { const m = toClient.shift(); if (m.t === MSG.SNAPSHOT) snaps.forEach((cb) => cb(m)); else msgs.forEach((cb) => cb(m)); } };
  server.connect(1); deliver();
  client.join('Test', 1); deliver();
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  const se = server.clients.get(1).entity, ecs = server.world.ecs, enc = server.world.encounters[0];
  ecs.x[se] = enc.cx + 3; ecs.z[se] = enc.cz; ecs.y[se] = map.groundAt(ecs.x[se], ecs.z[se]);
  const dev = (o) => client.send({ t: MSG.CMD, type: 'dev', ...o });
  dev({ op: 'god', on: true }); dev({ op: 'level', level: 6 }); dev({ op: 'enc', sub: 'boss' });
  for (let i = 0; i < 200; i++) { client.update(DT); client.tickInput({ mx: 0, mz: 0, ax: enc.cx, az: enc.cz, btn: 0, prs: 0 }); server.step(); deliver(); }
  dev({ op: 'enc', sub: 'phase2' });
  let maxErr = 0;
  for (let i = 0; i < 1500; i++) {
    client.update(DT);
    const prs = (i % 13 === 0 ? BTN.ATTACK : 0) | (i % 97 === 50 ? BTN.DASH : 0) | (i % 37 === 0 ? BTN.GUARD : 0);
    const mx = Math.sin(i * 0.05), mz = Math.cos(i * 0.05); // small circles near the centre
    client.tickInput({ mx, mz, ax: ecs.x[enc.bossE] || enc.cx, az: ecs.z[enc.bossE] || enc.cz, btn: (i % 70 < 25 ? BTN.GUARD : 0) | (i % 300 < 150 ? BTN.AIM : 0), prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  const ce = client.youLocal, pe = client.pred.ecs;
  for (const k of ['x', 'z', 'hp', 'riposte', 'chain', 'xp']) assert.equal(pe[k][ce], ecs[k][se], k);
  assert.ok(client.enc && ['boss', 'victory'].includes(client.enc[0][1]), `the HUD state arrives in snapshots (${client.enc && client.enc[0][1]})`);
  assert.ok(shown.some((ev) => ev.type === 'parry'), 'parried');
  assert.ok(shown.some((ev) => ev.type === 'phase'), 'saw the phase change');
  assert.ok(client.hazards.count <= server.world.hazards.count + 8, 'client pool in step with the server');
});

test('reflected shots stack with diminishing damage on the same enemy', () => {
  const { w, e } = arena();
  const t = w.spawnEnemy('sentinel', A.x, A.z);
  w.ecs.hp[t] = w.ecs.maxHp[t] = 5000;
  w.rng = () => 0.99;
  const hits = [];
  for (let i = 0; i < 6; i++) { const h = w.ecs.hp[t]; damageEnemy(w, t, 40, { by: e, kind: 'shot', x: A.x + 2, z: A.z, pierce: true }); hits.push(h - w.ecs.hp[t]); }
  assert.ok(hits[0] > hits[1] && hits[1] > hits[2], hits.join(','));
  assert.ok(hits[5] >= Math.floor(40 * tuning.parry.reflect.stack.floor));
  for (let i = 0; i < 40; i++) w.stepWorld();
  const h = w.ecs.hp[t];
  damageEnemy(w, t, 40, { by: e, kind: 'shot', x: A.x + 2, z: A.z, pierce: true });
  assert.equal(h - w.ecs.hp[t], hits[0], 'full damage again after the window');
});
