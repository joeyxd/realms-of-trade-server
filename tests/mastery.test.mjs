// M4 P1: weapon mastery opens the kit and brings passives; gear numbers are predicted exactly; potions; XP and
// crits from gear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning, DT } from '../src/data/tuning.js';
import { WEAPON, SKILLS, MASTERY } from '../src/data/weapons.js';
import { CONSUMABLES } from '../src/data/items.js';
import { World } from '../src/sim/world.js';
import { PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { refreshStats } from '../src/sim/systems/stats.js';
import { reflectTier, stormRadius, gainXp } from '../src/sim/systems/combat.js';
import { rainDur, rainR, setWeapon } from '../src/sim/systems/skills.js';
import { damageEnemy } from '../src/sim/systems/enemies.js';
import { sanitizeCmd } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { map, A, arena } from './helpers.mjs';

// Give player e of world w a profile (gear `eq`, masteries `mast` per kit) and refresh its numbers.
function wear(w, e, eq = {}, mast = [1, 1]) {
  if (!w.profiles) w.profiles = new Map();
  w.profiles.set(e, { eq, mast: mast.map((m) => [m, 0]) });
  refreshStats(w, e);
}
const types = (evs) => evs.map((ev) => ev.type);

test('mastery opens the kit: Q from 1, E at 2, R at 3 (locked presses say so); no profile = the whole kit', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  wear(w, e, {}, [1, 1]);
  let evs = step({ prs: BTN.E });
  assert.ok(evs.some((ev) => ev.type === 'locked' && ev.slot === 'e' && ev.e === e), 'E is locked at mastery 1');
  assert.equal(ecs.castK[e], 0);
  assert.equal(ecs.cdE[e], 0, 'no cooldown spent');
  evs = step({ prs: BTN.Q });
  assert.ok(evs.some((ev) => ev.type === 'cast' && ev.skill === 'lunge'), 'Q works from mastery 1');
  for (let i = 0; i < 40; i++) step();
  ecs.riposte[e] = tuning.parry.riposte.max;
  evs = step({ prs: BTN.R });
  assert.ok(evs.some((ev) => ev.type === 'locked' && ev.slot === 'r'), 'R is locked below mastery 3');
  assert.equal(ecs.riposte[e], tuning.parry.riposte.max, 'the meter is kept');
  wear(w, e, {}, [3, 1]);
  evs = step({ prs: BTN.E });
  assert.ok(evs.some((ev) => ev.type === 'cast' && ev.skill === 'wave'), 'E at mastery 2+');
  for (let i = 0; i < 40; i++) step();
  evs = step({ prs: BTN.R });
  assert.ok(types(evs).includes('riposte'), 'R at mastery 3');
  // The other kit has its own mastery: the pistols are still at 1.
  setWeapon(w, e, WEAPON.PISTOLAS);
  refreshStats(w, e);
  evs = step({ prs: BTN.E });
  assert.ok(evs.some((ev) => ev.type === 'locked' && ev.slot === 'e'), 'pistols at mastery 1: no Paso de humo');
  // Without a profile nothing is locked (tests, tools, bots).
  const b = arena();
  b.step();
  evs = b.step({ prs: BTN.E });
  assert.ok(evs.some((ev) => ev.type === 'cast' && ev.skill === 'wave'));
});

test('mastery passives: Filo templado widens the windows, Gatillo fácil, Ojo del huracán, Diluvio; damage per level', () => {
  const { w, e, step } = arena({ level: 4 });
  const ecs = w.ecs, atk0 = ecs.atk[e];
  wear(w, e, {}, [5, 1]);
  assert.equal(ecs.atk[e], Math.round(atk0 * (1 + 4 * MASTERY.dmg)));
  assert.ok(Math.abs(ecs.winBonus[e] - 0.015) < 1e-12);
  assert.equal(reflectTier(0.08), 2, 'BUENO without it');
  assert.equal(reflectTier(0.08, ecs.winBonus[e]), 3, 'EXCELENTE with it');
  assert.equal(stormRadius(ecs, e), tuning.parry.riposte.radius);
  wear(w, e, {}, [10, 10]);
  assert.equal(stormRadius(ecs, e), tuning.parry.riposte.radius + 2);
  setWeapon(w, e, WEAPON.PISTOLAS);
  refreshStats(w, e);
  assert.equal(ecs.winBonus[e], 0, 'the cutlass passive goes with the cutlass');
  assert.ok(Math.abs(rainDur(ecs, e) - 2.25) < 1e-12);
  assert.ok(Math.abs(rainR(ecs, e) - (SKILLS.rain.r + 0.8)) < 1e-12);
  wear(w, e, {}, [1, 5]);
  step({ prs: BTN.ATTACK, btn: BTN.ATTACK });
  assert.ok(Math.abs(ecs.shotCd[e] - (SKILLS.pistol.every * 0.85 - DT)) < 1e-9 || Math.abs(ecs.shotCd[e] - SKILLS.pistol.every * 0.85) < 1e-9, `shot cooldown ${ecs.shotCd[e]}`);
});

test('gear numbers are predicted exactly: a server world and a client world agree command by command', () => {
  const eq = {
    weapon: { u: 1, b: 'daga', r: 3, l: 8, a: [['cdr', 6], ['rip', 6], ['crit', 6]] },
    boots: { u: 2, b: 'viento', r: 2, l: 8, a: [['spd', 6], ['dash', 6]] },
    chest: { u: 3, b: 'chaleco', r: 1, l: 4, a: [['guard', 4]] },
    ring1: { u: 4, b: 'amuleto', r: 1, l: 3, a: [['xp', 2]] },
  };
  const worlds = [new World(GAME.seed, { map, server: true }), new World(GAME.seed, { map })];
  const ents = worlds.map((w) => {
    const e = w.spawnPlayer({ x: A.x, z: A.z + 4, level: 6 });
    wear(w, e, eq, [3, 1]);
    w.ecs.potions[e] = 3;
    w.ecs.hp[e] = 60;
    return e;
  });
  const states = [[], []];
  for (let i = 0; i < 360; i++) {
    const k = Math.floor(i / 50) % 4;
    const cmd = {
      seq: i + 1, mx: [1, 0, -1, 0][k], mz: [0, 1, 0, -1][k], ax: A.x + 9, az: A.z + 4, btn: BTN.AIM,
      prs: (i % 37 === 3 ? BTN.DASH : 0) | (i % 61 === 9 ? BTN.Q : 0) | (i % 73 === 20 ? BTN.E : 0) | (i % 90 === 45 ? BTN.POTION : 0) | (i % 9 === 0 ? BTN.ATTACK : 0),
      pt: i + 1, w: 0,
    };
    worlds.forEach((w, j) => { w.applyCommand(ents[j], { ...cmd }); w.tick++; states[j].push(w.playerState(ents[j])); });
  }
  // (The respawn checkpoint is the server's business: it is not predicted.)
  const skip = new Set([PLAYER_FIELDS.indexOf('cpX'), PLAYER_FIELDS.indexOf('cpZ')]);
  const bad = states[0].findIndex((st, i) => st.some((v, k) => !skip.has(k) && !Object.is(v, states[1][i][k])));
  assert.equal(bad, -1, bad < 0 ? '' : `tick ${bad}: ` + PLAYER_FIELDS.filter((_, k) => !skip.has(k) && !Object.is(states[0][bad][k], states[1][bad][k])).map((f) => `${f} ${states[0][bad][PLAYER_FIELDS.indexOf(f)]} vs ${states[1][bad][PLAYER_FIELDS.indexOf(f)]}`).join(', '));
  const ecs = worlds[0].ecs, e = ents[0];
  assert.ok(ecs.speed[e] > tuning.player.runSpeed, 'faster with the boots');
  assert.ok(ecs.potions[e] < 3, 'drank');
});

test('ron-coco potions: heal 40 %, count down, cool down, refuse when full / empty; the press survives the wire', () => {
  const { w, e, step } = arena({ level: 3 });
  const ecs = w.ecs, P = CONSUMABLES.potion;
  ecs.potions[e] = 2;
  ecs.hp[e] = 20;
  let evs = step({ prs: BTN.POTION });
  const drink = evs.find((ev) => ev.type === 'potion');
  assert.ok(drink && !drink.denied);
  assert.equal(ecs.hp[e], 20 + Math.round(ecs.maxHp[e] * P.heal));
  assert.equal(ecs.potions[e], 1);
  evs = step({ prs: BTN.POTION });
  assert.equal(evs.find((ev) => ev.type === 'potion').denied, 'cd');
  for (let i = 0; i < Math.ceil(P.cd / DT); i++) step();
  ecs.hp[e] = ecs.maxHp[e];
  evs = step({ prs: BTN.POTION });
  assert.equal(evs.find((ev) => ev.type === 'potion').denied, 'full', 'no waste at full HP');
  ecs.hp[e] = 10;
  step({ prs: BTN.POTION });
  assert.equal(ecs.potions[e], 0);
  for (let i = 0; i < Math.ceil(P.cd / DT); i++) step();
  evs = step({ prs: BTN.POTION });
  assert.equal(evs.find((ev) => ev.type === 'potion').denied, 'empty');
  // Gear: «Curación de pociones».
  wear(w, e, { ring1: { u: 1, b: 'amuleto', r: 0, l: 10, a: [] } });
  ecs.potions[e] = 1;
  for (let i = 0; i < Math.ceil(P.cd / DT); i++) step();
  ecs.hp[e] = 10; ecs.regenT[e] = 0;
  step({ prs: BTN.POTION });
  assert.equal(ecs.hp[e], 10 + Math.min(ecs.maxHp[e] - 10, Math.round(ecs.maxHp[e] * P.heal * ecs.potHeal[e])));
  assert.ok(ecs.potHeal[e] > 1);
  assert.equal(sanitizeCmd({ seq: 1, prs: BTN.POTION | BTN.DASH }).prs, BTN.POTION | BTN.DASH);
});

test('XP: the gear bonus multiplies it; the server hook (mastery) sees it even at the level cap', () => {
  const { w, e } = arena();
  const seen = [];
  w.onXp = (who, n) => seen.push([who, n]);
  w.ecs.xpMul[e] = 1.5;
  gainXp(w, e, 10);
  assert.equal(w.ecs.xp[e], 15);
  assert.deepEqual(seen, [[e, 15]]);
  w.ecs.level[e] = tuning.stats.maxLevel;
  gainXp(w, e, 10);
  assert.equal(w.ecs.xp[e], 15, 'no character XP past the cap');
  assert.equal(seen.length, 2, 'the mastery still gets it');
});

test('crits: the attacker\'s gear adds chance and damage', () => {
  const { w, e } = arena({ level: 5 });
  const ecs = w.ecs;
  const o = w.spawnEnemy('sentinel', A.x + 3, A.z + 4);
  ecs.def[o] = 0;
  ecs.critAdd[e] = 0.45; ecs.critDAdd[e] = 1;
  let crits = 0, big = 0;
  for (let i = 0; i < 400; i++) {
    ecs.hp[o] = 1e6; ecs.dead[o] = 0;
    w.events.length = 0;
    damageEnemy(w, o, 20, { by: e, kind: 'melee', x: ecs.x[e], z: ecs.z[e] });
    const d = w.events.find((ev) => ev.type === 'damage');
    if (d.crit) { crits++; if (d.dmg === Math.round(20 * (tuning.stats.critMult + 1))) big++; }
  }
  assert.ok(crits > 160 && crits < 240, `${crits} crits of 400 at 50 %`);
  assert.equal(big, crits, 'crit damage × (1.75 + 1)');
});
