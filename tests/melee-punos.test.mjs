// T-1030-12: Puños, the unarmed kit on Terry's jab 1-2-3 (src/data/meleeFrames.js FIST_STAGES, MELEE fist rows).
// A link is a TRUE COMBO when the victim is not free (no hitlag, no stagger) on any tick before the next hit lands:
// gap = next hit tick - the tick the victim is free again <= 0. Each link logs one line (the frame table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../src/data/meta.js';
import { LAWLESS, MELEE } from '../src/data/lawless.js';
import { WEAPON, WEAPON_KINDS, WEAPONS } from '../src/data/weapons.js';
import { FIST_STAGES, swingFrame, swingDescriptor, swingKey, swingStages } from '../src/data/meleeFrames.js';
import { World } from '../src/sim/world.js';
import { PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { setWeapon, stepEquip, skillOf } from '../src/sim/systems/skills.js';
import { kitOf, unequipItem, holsterWeapon, sanitizeProfile, attachProfile, newProfile } from '../src/sim/systems/inventory.js';
import { knockback, hitstunFrames, hitlagFrames, meleePercent } from '../src/sim/meleeHit.js';
import { MSG } from '../src/net/protocol.js';
import { calaDuel } from './cala-duel.mjs';
import { arena, map } from './helpers.mjs';

const PRESS = { prs: BTN.ATTACK, btn: BTN.ATTACK };

// Mashed presses: one press per blow as soon as its `open` allows; returns the hits and the per-link frame table.
// tick(c) steps the world one tick with the attacker's command c and returns the hit of that tick (or null).
function mash(label, S, ticks = 90) {
  const { ecs, a, b } = S, log = [], pressed = new Set();
  for (let t = 1; t <= ticks; t++) {
    const st = ecs.atkStage[a], f = swingFrame(ecs.atkT[a]);
    let c = {};
    if (t === 1) c = PRESS;
    else if (st > 0 && !pressed.has(st) && f + 1 >= swingDescriptor(1, ecs, a).open) { c = PRESS; pressed.add(st); }
    const d = Math.hypot(ecs.x[a] - ecs.x[b], ecs.z[a] - ecs.z[b]), hit = S.tick(c);
    log.push({ t, hit, d, hlB: ecs.hitlag[b], stB: ecs.stagger[b] * 60 });
  }
  const hits = log.filter((r) => r.hit);
  const table = hits.map((h, i) => {
    const next = hits[i + 1];
    // The first tick the victim can act again, looked for only before the next hit lands. None: it was still locked
    // when the hit came (free tick = the hit tick or later), so gap = - the lock frames it still had.
    const free = next ? log.find((r) => r.t > h.t && r.t < next.t && r.hlB === 0 && r.stB <= 0) : null;
    const left = next ? log[next.t - 2] : null;
    const row = { label, hit: i + 1, tick: h.t, skill: h.hit.skill ?? '-', dist: +(h.d - ecs.hurtR[b]).toFixed(2), kb: h.hit.kb, hs: h.hit.hs, hl: h.hit.hl,
      free: next ? (free ? free.t : 'locked') : '-', next: next?.t, gap: !next ? null : free ? next.t - free.t : -Math.ceil(left.hlB + Math.max(0, left.stB)) };
    console.log(`${label} | hit ${row.hit} tick ${row.tick} ${row.skill} dist ${row.dist} u kb ${row.kb} hs ${row.hs} hl ${row.hl} | victim free at tick ${row.free} | next hit ${row.next ?? '-'} | gap ${row.gap ?? '-'}`);
    return row;
  });
  return { hits, table };
}

// A Cala duel: A unarmed (the sable holstered), B idle; `pct` percent of B's HP already lost.
function pvp(pct) {
  const S = calaDuel(), { w, ecs, a, b } = S;
  w.meleeVersion = 1; w.rng = Object.assign(() => 1, w.rng);
  assert.ok(holsterWeapon(w, a));
  ecs.hp[b] = ecs.maxHp[b] * (1 - pct / 100);
  let seen = S.events(2, 'duel').length;
  S.tick = (c) => {
    const before = ecs.hp[b];
    S.both(c, {});
    const evs = S.events(2, 'duel'), fresh = evs.slice(seen); seen = evs.length;
    const ev = fresh.find((e) => e.out === 'hit' || e.out === 'crit');
    return ev && ecs.hp[b] < before ? ev : null;
  };
  return S;
}

// The Sandbag, 1.6 u in front of an unarmed pirate (PvE path); `pct` percent of its meleeHp lost (it has 300 HP, meleeHp 100).
function sandbag(pct) {
  const { w, e: a, step } = arena(), ecs = w.ecs;
  w.meleeVersion = 1; w.rng = Object.assign(() => 1, w.rng);
  setWeapon(w, a, WEAPON.PUNOS);
  const b = w.spawnEnemy('dummy', ecs.x[a] + 1.6, ecs.z[a], 0);
  ecs.hp[b] = ecs.maxHp[b] - pct;
  w.events.length = 0;
  const S = { w, ecs, a, b };
  S.tick = (c) => { const ev = step(c).find((e) => e.type === 'damage' && e.id === b); return ev || null; };
  for (let i = 0; i < 4; i++) step();
  return S;
}

test('a holstered weapon leaves the pirate with Puños, the saved profile keeps its item, racks never hand fists out', () => {
  assert.equal(kitOf(null), 'punos');
  assert.deepEqual(WEAPON_KINDS, ['sable', 'pistolas', 'punos']);
  assert.equal(WEAPON.PUNOS, 2);
  assert.deepEqual([WEAPONS.punos.basic, WEAPONS.punos.q, WEAPONS.punos.e, WEAPONS.punos.r], ['fists', 'none', 'none', 'none']);
  const S = calaDuel(), { w, ecs, a } = S, p = S.profile(1);
  assert.equal(ecs.weapon[a], WEAPON.SABLE);
  const sable = p.eq.weapon;
  assert.equal(unequipItem(w, a, 'weapon'), false, 'the weapon item never leaves its slot (SQL009 death delta)');
  assert.ok(holsterWeapon(w, a));
  assert.equal(p.eq.weapon, sable); assert.equal(ecs.weapon[a], WEAPON.PUNOS);
  assert.equal(skillOf(ecs, a, 'q'), 'none'); assert.equal(skillOf(ecs, a, 'e'), 'none'); assert.equal(skillOf(ecs, a, 'r'), 'none');
  // The save is the armed profile; a re-attach draws the item's kit. An empty slot in an old save is refilled.
  const clean = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  assert.equal(clean.eq.weapon.b, sable.b); assert.equal(clean.mast.length, 2, 'the saved profile keeps its two mastery rows'); assert.equal(clean.sk.lo.length, 2);
  assert.equal(sanitizeProfile({ ...JSON.parse(JSON.stringify(p)), eq: { ...p.eq, weapon: null } }).eq.weapon.b, 'sable');
  attachProfile(w, a, clean); assert.equal(ecs.weapon[a], WEAPON.SABLE);
  assert.ok(holsterWeapon(w, a)); assert.equal(ecs.weapon[a], WEAPON.PUNOS);
  assert.equal(sanitizeProfile(JSON.parse(JSON.stringify(newProfile()))).eq.weapon.b, 'sable', 'a new profile still has its starter');
  // A rack refuses fists and gives an unarmed pirate the sabre without a hole in the bag.
  const rack = map.racks[0];
  ecs.x[a] = rack.x; ecs.z[a] = rack.z;
  assert.equal(stepEquip(w, a, { w: WEAPON.PUNOS + 1, seq: 1 }), false);
  assert.equal(ecs.weapon[a], WEAPON.PUNOS);
  assert.equal(stepEquip(w, a, { w: WEAPON.SABLE + 1, seq: 2 }), true);
  assert.equal(ecs.weapon[a], WEAPON.SABLE); assert.ok(clean.bag.every(Boolean)); assert.equal(kitOf(w.profiles.get(a).eq.weapon), 'sable');
  // Holstering twice draws the weapon again; the server command does the same.
  assert.ok(holsterWeapon(w, a)); assert.equal(ecs.weapon[a], WEAPON.PUNOS);
  assert.ok(holsterWeapon(w, a)); assert.equal(ecs.weapon[a], WEAPON.SABLE);
  S.s.receive(1, { t: MSG.CMD, type: 'holster' }); assert.equal(ecs.weapon[a], WEAPON.PUNOS);
});

test('the fist blows carry Terry\'s frames and swingKey names the near and far rows', () => {
  assert.deepEqual(FIST_STAGES.map((s) => [s.start, s.end, s.link, s.open, s.close, s.iasa, s.total]),
    [[3, 4, 5, 1, 13, 14, 14], [3, 7, 8, 1, 24, 25, 25], [7, 10, 0, 0, 0, 34, 34]]);
  assert.equal(swingStages(1, WEAPON.PUNOS), FIST_STAGES); assert.notEqual(swingStages(1, WEAPON.SABLE), FIST_STAGES);
  assert.notEqual(swingStages(0, WEAPON.PUNOS), FIST_STAGES, 'the old machine swings the sabre numbers');
  assert.equal(swingKey(1, 0, WEAPON.PUNOS, 1), 'fist1f'); assert.equal(swingKey(2, 0, WEAPON.PUNOS, 0), 'fist2');
  assert.equal(swingKey(3, 1, WEAPON.PUNOS, 1), 'fist3'); assert.equal(swingKey(3, 1), 'melee3s');
});

for (const pct of [0, 60]) {
  test(`Cala duel at ${pct} percent: jab 1 -> 2 -> 3 land and every link is a true combo`, () => {
    const S = pvp(pct), { hits, table } = mash(`pvp ${pct}%`, S);
    assert.equal(hits.length, 3, 'all three blows land');
    assert.equal(S.ecs.hp[S.b] > 0, true);
    assert.equal(table[2].skill, 'fist3');
    for (const row of table.slice(0, 2)) assert.ok(typeof row.gap === 'number' && row.gap <= 0, `link ${row.hit}: gap ${row.gap}`);
  });
  test(`Sandbag at ${pct} percent: jab 1 -> 2 -> 3 land and every link is a true combo`, () => {
    const S = sandbag(pct), { hits, table } = mash(`sandbag ${pct}%`, S);
    assert.equal(hits.length, 3, 'all three blows land');
    for (const row of table.slice(0, 2)) assert.ok(typeof row.gap === 'number' && row.gap <= 0, `link ${row.hit}: gap ${row.gap}`);
  });
}

test('near and far boxes pick the row; a far jab pulls the victim toward the attacker', () => {
  for (const [stage, near, far] of [[1, 'fist1', 'fist1f'], [2, 'fist2', 'fist2f']]) {
    const blow = FIST_STAGES[stage - 1];
    for (const [gap, skill] of [[blow.near - 0.05, near], [blow.near + 0.05, far]]) {
      const S = calaDuel(), { w, ecs, a, b } = S;
      w.meleeVersion = 1; w.rng = Object.assign(() => 1, w.rng);
      holsterWeapon(w, a);
      ecs.facing[a] = Math.PI / 2; S.put(b, ecs.x[a] + gap + ecs.hurtR[b], ecs.z[a]);
      for (let i = 0; i < 8; i++) S.both(); // the blow sees the victim interpTicks (6) behind: let the history catch up
      ecs.atkStage[a] = stage; ecs.atkT[a] = 0; ecs.swingId[a]++;
      S.sent.clear(); w.events.length = 0;
      w.meleeHits(a, blow, w.tick, 1);
      const ev = w.events.find((e) => e.type === 'duel');
      assert.ok(ev, `${skill} landed`); assert.equal(ev.skill, skill);
      const row = MELEE[skill], percent = ev.p, damage = meleePercent(ecs.maxHp[b] - ecs.hp[b], ecs.maxHp[b], LAWLESS.meleeStamina);
      const kb = knockback(percent, damage, 87, row.bkb, row.kbg);
      assert.equal(ev.hs, hitstunFrames(kb) + (row.react || 0), `${skill} hitstun carries its reaction frames`);
      assert.equal(ev.hl, hitlagFrames(damage));
      assert.ok(row.pull ? ecs.lvx[b] < 0 : ecs.lvx[b] > 0, `${skill} launches ${row.pull ? 'toward' : 'away from'} the attacker`);
    }
  }
});

test('server and prediction stay identical through the fist chain', () => {
  const { w, e } = arena(), ecs = w.ecs;
  w.meleeVersion = 1; setWeapon(w, e, WEAPON.PUNOS);
  const pred = new World(GAME.seed, { map, server: false }), pe = pred.spawnPlayer({});
  pred.meleeVersion = 1; pred.setPlayerState(pe, w.playerState(e)); setWeapon(pred, pe, WEAPON.PUNOS);
  const FIELDS = PLAYER_FIELDS, skip = new Set(['cpX', 'cpZ']); // the checkpoint follows the world's own map position
  const same = (msg) => assert.deepEqual(pred.playerState(pe).filter((_, k) => !skip.has(FIELDS[k])), w.playerState(e).filter((_, k) => !skip.has(FIELDS[k])), msg);
  same('start');
  const pressed = new Set(); let stage3 = false;
  for (let i = 0; i < 70; i++) {
    const st = ecs.atkStage[e], f = swingFrame(ecs.atkT[e]);
    let c = {};
    if (i === 0) c = PRESS;
    else if (st > 0 && !pressed.has(st) && f + 1 >= swingDescriptor(1, ecs, e).open) { c = PRESS; pressed.add(st); }
    const cmd = { seq: i + 1, mx: 0, mz: 0, ax: ecs.x[e] + 10, az: ecs.z[e], btn: 0, prs: 0, pt: 10 + i, ...c };
    w.tick = pred.tick = 10 + i;
    w.applyCommand(e, cmd); pred.applyCommand(pe, cmd);
    same(`tick ${i}`);
    if (ecs.atkStage[e] === 3) stage3 = true;
  }
  assert.ok(stage3, 'the chain reached jab 3');
});

test('with meleeVersion 0 the fists chain runs without throwing', () => {
  const { w, e, step } = arena(), ecs = w.ecs;
  w.meleeVersion = 0; setWeapon(w, e, WEAPON.PUNOS);
  const mob = w.spawnEnemy('grunt', ecs.x[e] + 1.2, ecs.z[e], 0);
  let top = 0;
  for (let i = 0; i < 90; i++) { step(i % 4 === 0 ? PRESS : {}); top = Math.max(top, ecs.atkStage[e]); }
  assert.equal(top, 3, 'the old machine chains the three blows');
  assert.ok(ecs.hp[mob] < ecs.maxHp[mob], 'and they land, with no Melee knockback');
  assert.equal(ecs.hitlag[mob], 0);
});
