// M4 P5: the Mareas. Harder La Caldera (enemy HP and damage), better loot (item level, rarity), more XP and
// gold; beating one opens the next; picked at the runes; in co-op the lowest pick rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';
import { LOOT } from '../src/data/loot.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { encounterDev, encounterState } from '../src/sim/systems/encounter.js';
import { GAME } from '../src/data/meta.js';
import { map, A } from './helpers.mjs';

const T = ENCOUNTERS.caldera.tiers;

function server() {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const w = s.world, ecs = w.ecs, enc = w.encounters[0];
  const join = (id, x, z) => {
    s.connect(id); s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon: 0 });
    const e = s.clients.get(id).entity;
    ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z); ecs.god[e] = 1;
    return e;
  };
  const events = (id, type) => (sent.get(id) || []).filter((m) => m.t === MSG.EVENT && m.ev.type === type).map((m) => m.ev);
  const run = (n) => { for (let i = 0; i < n; i++) s.step(); };
  const toWave = () => { for (let i = 0; i < 600 && enc.st !== 'wave'; i++) s.step(); };
  return { s, w, ecs, enc, join, events, run, toWave };
}
const hpOf = (w, kind) => [...w.encounters[0].alive].filter((q) => w.ecs.names[q] === ENEMIES[kind].name).map((q) => w.ecs.maxHp[q]);

test('Marea II: tougher enemies that hit harder, more XP; the snapshot and the events say which Marea', () => {
  const { s, w, ecs, enc, join, toWave } = server();
  const e = join(1, A.x, A.z);
  const p = w.profiles.get(e);
  p.flags.tier = 3; p.flags.tierSel = 2;
  toWave();
  assert.equal(enc.tier, 2);
  for (const hp of hpOf(w, 'grunt')) assert.equal(hp, Math.round(ENEMIES.grunt.hp * T[1].hp));
  const g = [...enc.alive][0];
  assert.equal(w.dmgMul(g), T[1].dmg);
  const a = w.addAoe({ owner: g, x: A.x, z: A.z, r: 1, tAct: w.tick + 30, dmg: 10 });
  assert.equal(a.dmg, Math.round(10 * T[1].dmg));
  assert.equal(encounterState(w, enc)[11], 2);
  const xp0 = ecs.xp[e];
  const grunt = [...enc.alive].find((q) => ecs.names[q] === ENEMIES.grunt.name);
  w.killEnemy(grunt, e);
  assert.equal(ecs.xp[e] - xp0, Math.round(ENEMIES.grunt.xp * T[1].xp) * ecs.xpMul[e]);
  assert.ok(s);
});

test('co-op: the lowest Marea of the crew that starts it; without picks it is Marea I', () => {
  const a = server();
  const p1 = a.join(1, A.x + 1, A.z), p2 = a.join(2, A.x - 1, A.z);
  a.w.profiles.get(p1).flags = { tut: 0, tier: 3, tierSel: 3 };
  a.w.profiles.get(p2).flags = { tut: 0, tier: 1, tierSel: 1 };
  a.toWave();
  assert.equal(a.enc.tier, 1);
  for (const hp of hpOf(a.w, 'grunt')) assert.equal(hp, Math.round(ENEMIES.grunt.hp * (1 + ENCOUNTERS.caldera.coopHp)), 'only the co-op scaling');
});

test('the loot follows the Marea: item level + its bonus, rarer items', () => {
  const { w, ecs, enc, join, events, toWave, run } = server();
  const e = join(1, A.x, A.z);
  const p = w.profiles.get(e);
  p.flags.tier = 3; p.flags.tierSel = 3;
  toWave();
  const old = LOOT.grunt;
  LOOT.grunt = { gold: [0, 1, 1], item: 1, potion: 0 };
  try {
    let n = 0, rare = 0;
    for (let i = 0; i < 300; i++) {
      const g = w.spawnEnemy('grunt', A.x + 3, A.z, 0, { enc: enc.id });
      w.killEnemy(g, e);
    }
    run(1);
    for (const ev of events(1, 'loot')) for (const d of ev.drops) if (d.kind === 'item') { n++; assert.equal(d.item.l, ENEMIES.grunt.level + T[2].ilvl); if (d.item.r >= 2) rare++; }
    assert.ok(n >= 290);
    // Marea I: 12 + 4.2 + 0.8 of 100 are Rare or better (17 %); Marea III (b = 1): ~34 %.
    assert.ok(rare / n > 0.26, `${(rare / n * 100).toFixed(1)} % rare or better`);
  } finally { LOOT.grunt = old; }
  assert.ok(ecs);
});

test('beating a Marea opens the next (said privately); you pick yours at the runes, never above what is open', () => {
  const { s, w, ecs, enc, join, events, run } = server();
  const e = join(1, A.x + 1, A.z);
  const p = w.profiles.get(e);
  encounterDev(w, enc, 'boss');
  for (let i = 0; i < 400 && enc.st !== 'boss'; i++) run(1);
  assert.equal(enc.tier, 1);
  encounterDev(w, enc, 'win');
  run(3);
  assert.equal(p.flags.tier, 2);
  assert.equal(events(1, 'tier').at(-1).open, 2);
  // Pick it: only at the runes, only what is open.
  ecs.x[e] = A.x + 30;
  s.receive(1, { t: MSG.CMD, type: 'tier', tier: 2 });
  assert.equal(p.flags.tierSel, 1, 'too far from the runes');
  ecs.x[e] = A.x + 1;
  s.receive(1, { t: MSG.CMD, type: 'tier', tier: 3 });
  assert.equal(p.flags.tierSel, 2, 'Marea III is not open yet');
  s.receive(1, { t: MSG.CMD, type: 'tier', tier: 1 });
  assert.equal(p.flags.tierSel, 1);
});
