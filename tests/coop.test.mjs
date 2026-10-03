// M3.6 P3: robust online play. Filler commands for silent clients, late commands the fillers covered,
// instance time with company, La Prueba de Fuego scaled for the crew.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, tuning } from '../src/data/tuning.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createEncounter, encounterDev, encounterState } from '../src/sim/systems/encounter.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';
import { GAME } from '../src/data/meta.js';
import { map, A } from './helpers.mjs';

// A LocalServer with no bots and no map enemies; clients join by id, cmd(id, o) queues one command.
function server(o = {}) {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(m); }, ...o });
  const seqs = new Map();
  const join = (id, name = 'P' + id) => {
    s.connect(id);
    s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0 });
    const e = s.clients.get(id).entity;
    s.world.ecs.x[e] = A.x + id * 2; s.world.ecs.z[e] = A.z + 4; s.world.ecs.y[e] = map.groundAt(A.x, A.z + 4);
    return e;
  };
  const cmd = (id, c = {}) => {
    const seq = (seqs.get(id) || 0) + 1;
    seqs.set(id, seq);
    s.receive(id, { t: MSG.INPUTS, cmds: [{ seq, mx: 0, mz: 0, ax: A.x + 9, az: A.z + 4, btn: 0, prs: 0, pt: s.world.tick, ...c }] });
    return seq;
  };
  return { s, w: s.world, ecs: s.world.ecs, join, cmd, sent };
}

test('online, a silent client gets filler commands: the world still hits it (solo leaves it alone)', () => {
  for (const fill of [true, false]) {
    const { s, w, ecs, join, cmd } = server({ fill });
    const e = join(1);
    for (let i = 0; i < 10; i++) { cmd(1); s.step(); }
    const ack = s.clients.get(1).ack, hp0 = ecs.hp[e];
    ecs.cdQ[e] = 1;
    w.addAoe({ owner: 0, x: ecs.x[e], z: ecs.z[e], r: 1.5, tAct: w.tick + 30, dmg: 12 });
    const x0 = ecs.x[e];
    for (let i = 0; i < 60; i++) s.step(); // nothing from the client for a second
    if (fill) {
      assert.ok(s.stats.fill >= 60 - tuning.combat.starveTicks - 1, `fillers ${s.stats.fill}`);
      assert.ok(ecs.hp[e] < hp0, 'the circle lands on a silent player');
      assert.ok(ecs.cdQ[e] < 1 - 0.25, 'its cooldowns run');
      assert.equal(ecs.x[e], x0, 'fillers do not move');
      assert.equal(s.clients.get(1).ack, ack, 'the ack does not move');
    } else {
      assert.equal(s.stats.fill, 0);
      assert.equal(ecs.hp[e], hp0, 'solo: a stalled player is not punished');
    }
  }
});

test('late commands the fillers stood in for are dropped (their presses carry); fresh ones after a stall play', () => {
  const { s, w, ecs, join, cmd } = server({ fill: true });
  const e = join(1);
  for (let i = 0; i < 10; i++) { cmd(1); s.step(); }
  // A lag spike: 40 ticks of commands made on time, delivered at once afterwards.
  const made = [];
  for (let i = 0; i < 40; i++) { made.push({ pt: w.tick, mx: 1, prs: i === 5 ? 1 : 0 }); s.step(); }
  const fillers = s.stats.fill;
  assert.ok(fillers > 20);
  const dashes0 = ecs.dashCount[e], x0 = ecs.x[e];
  for (const c of made) cmd(1, c);
  const last = cmd(1, { pt: w.tick, mx: 1 });
  for (let i = 0; i < 30; i++) s.step();
  assert.equal(s.clients.get(1).ack, last, 'everything acknowledged');
  const dropped = s.stats.late + s.stats.trimmed; // covered by fillers, or beyond the queue cap
  assert.ok(dropped >= fillers - 2 && dropped <= 40, `dropped ${dropped} of 40 (fillers ${fillers})`);
  assert.equal(ecs.dashCount[e], dashes0 + 1, 'the dash pressed in a dropped command still happens');
  const moved = ecs.x[e] - x0;
  // Only the kept commands walk (plus the dash); playing all 41 late would have gone ~4.4 u further.
  const bound = (41 - dropped + 2) * tuning.player.runSpeed * DT + tuning.dash.distance + 0.5;
  assert.ok(moved > 0.5 && moved < bound, `moved ${moved.toFixed(2)} (bound ${bound.toFixed(2)})`);
  // A stall (hidden tab): the client sends nothing, then carries on from now. Nothing is dropped.
  const late0 = s.stats.late;
  for (let i = 0; i < 60; i++) s.step();
  for (let i = 0; i < 10; i++) { cmd(1, { pt: w.tick, mx: -1 }); s.step(); }
  assert.equal(s.stats.late, late0, 'fresh commands after a stall are all played');
});

test('instance time with company: your hitstop stays yours; alone it stops the world; the boss falling always does', () => {
  const { s, w, join } = server();
  const a = join(1);
  w.feel(a, 3, 0.1, 0.4); w.flushAllFeel();
  s.flushEvents();
  assert.ok(s.freeze > 0.09, 'alone: the instance stops');
  s.freeze = 0; s.slowT = 0;
  const b = join(2);
  w.feel(a, 4, 0.1, 0.4); w.flushAllFeel();
  const evs = [];
  s.send = (id, m) => { if (id === 2 && m.t === MSG.EVENT && m.ev.type === 'time') evs.push(m.ev); };
  s.flushEvents();
  assert.equal(s.freeze, 0, 'with company the world keeps going');
  assert.equal(s.slowT, 0);
  assert.equal(evs.at(-1).inst, 0, 'the others are told it is not theirs');
  w.emit({ type: 'time', e: 0, seq: 0, hitstop: 0.15, scale: 0.3, dur: 1.2 });
  s.flushEvents();
  assert.ok(s.freeze > 0.14 && s.slowT > 1, 'a world event stops everyone');
  assert.equal(evs.at(-1).inst, 1);
  assert.ok(b);
});

test('La Prueba de Fuego scales with the crew: 2 pirates → waves ×1.6 HP, Hellfire and his minions ×1.75', () => {
  const w = new World(GAME.seed, { map, server: true });
  const p1 = w.spawnPlayer({ x: A.x, z: A.z, clientId: 1 }), p2 = w.spawnPlayer({ x: A.x + 1, z: A.z, clientId: 2 });
  const bot = w.spawnPlayer({ x: A.x - 1, z: A.z, bot: true });
  for (const p of [p1, p2, bot]) w.ecs.god[p] = 1;
  const enc = createEncounter('caldera', map);
  w.encounters.push(enc);
  const D = ENCOUNTERS.caldera, ecs = w.ecs;
  const run = (sec) => { for (let i = 0; i < Math.round(sec / DT); i++) w.stepWorld(); };
  run(D.intro + 0.2);
  assert.equal(enc.st, 'wave');
  assert.equal(enc.n, 2, 'bots are not crew');
  for (const q of enc.alive) {
    const def = ENEMIES[Object.keys(ENEMIES).find((k) => ENEMIES[k].name === ecs.names[q])];
    assert.equal(ecs.maxHp[q], Math.round(def.hp * (1 + D.coopHp)));
    assert.equal(ecs.hp[q], ecs.maxHp[q]);
  }
  assert.equal(encounterState(w, enc)[10], 2);
  encounterDev(w, enc, 'boss');
  run(0.1);
  assert.equal(ecs.maxHp[enc.bossE], Math.round(ENEMIES.hellfire.hp * (1 + D.coopBossHp)));
  // Minions spawned for the boss take his multiplier.
  const m = w.spawnEnemy('imp', A.x + 5, A.z, 0, { enc: enc.id, minion: enc.bossE });
  assert.equal(ecs.maxHp[m], Math.round(ENEMIES.imp.hp * (1 + D.coopBossHp)));
  // Alone: no scaling.
  const w1 = new World(GAME.seed, { map, server: true });
  const solo = w1.spawnPlayer({ x: A.x, z: A.z, clientId: 1 });
  w1.ecs.god[solo] = 1;
  const enc1 = createEncounter('caldera', map);
  w1.encounters.push(enc1);
  for (let i = 0; i < Math.round((D.intro + 0.2) / DT); i++) w1.stepWorld();
  for (const q of enc1.alive) assert.equal(w1.ecs.maxHp[q], ENEMIES[Object.keys(ENEMIES).find((k) => ENEMIES[k].name === w1.ecs.names[q])].hp);
});
