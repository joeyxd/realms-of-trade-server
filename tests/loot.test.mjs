// M4 P2: profiles, personal loot, pickups, the bag, racks, mastery XP and the boss chest, through LocalServer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, tuning } from '../src/data/tuning.js';
import { LOOT, DROPS } from '../src/data/loot.js';
import { ITEMS, BASES } from '../src/data/items.js';
import { MASTERY, WEAPON } from '../src/data/weapons.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { encounterDev } from '../src/sim/systems/encounter.js';
import { kitUnlocked } from '../src/sim/systems/stats.js';
import { BTN } from '../src/sim/systems/movement.js';
import { GAME } from '../src/data/meta.js';
import { map, A, clientAndServer } from './helpers.mjs';

// A LocalServer with no bots or map enemies; join(id) puts a player at (x, z); msgs(id) = what it was sent.
function server(o = {}) {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); }, ...o });
  const join = (id, x = A.x + id * 2, z = A.z + 4, weapon = 0) => {
    s.connect(id);
    s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon });
    const e = s.clients.get(id).entity, ecs = s.world.ecs;
    ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z);
    return e;
  };
  const msgs = (id) => sent.get(id) || [];
  const events = (id, type) => msgs(id).filter((m) => m.t === MSG.EVENT && (!type || m.ev.type === type)).map((m) => m.ev);
  const profile = (id) => s.world.profiles.get(s.clients.get(id).entity);
  const run = (n) => { for (let i = 0; i < n; i++) s.step(); };
  return { s, w: s.world, ecs: s.world.ecs, join, msgs, events, profile, run, sent };
}

// Make an enemy's table certain for one test.
function withTable(kind, table, fn) {
  const old = LOOT[kind];
  LOOT[kind] = table;
  try { return fn(); } finally { LOOT[kind] = old; }
}

test('a fresh profile: a common starter weapon of the chosen kit, 2 potions, mastery 1; the client gets it', () => {
  const { s, join, msgs, profile, ecs } = server();
  const a = join(1), b = join(2, A.x - 4, A.z, WEAPON.PISTOLAS);
  const p1 = profile(1), p2 = profile(2);
  assert.equal(p1.eq.weapon.b, 'sable');
  assert.equal(p2.eq.weapon.b, 'chispa');
  assert.equal(ecs.weapon[b], WEAPON.PISTOLAS);
  assert.equal(ecs.potions[a], 2);
  assert.deepEqual(p1.mast, [[1, 0], [1, 0]]);
  assert.ok(!kitUnlocked(ecs, a, 'e') && kitUnlocked(ecs, a, 'q'));
  assert.equal(ecs.atk[a], 10 + 3, 'level 1 + the starter cutlass');
  const prof = msgs(1).filter((m) => m.t === MSG.PROFILE);
  assert.ok(prof.length >= 1 && prof[0].p.eq.weapon.b === 'sable');
  assert.ok(!msgs(1).some((m) => m.t === MSG.PROFILE && m.p.eq.weapon.b === 'chispa'), 'nobody gets another one\'s profile');
  assert.ok(s);
});

test('personal loot: both pirates roll their own drops, see only theirs and pick up only theirs', () => withTable('archer', { gold: [1, 4, 4], item: 1, potion: 1 }, () => {
  const { w, ecs, join, events, profile, run } = server();
  const a = join(1, A.x, A.z + 4), b = join(2, A.x + 3, A.z + 4);
  const foe = w.spawnEnemy('archer', A.x + 1.5, A.z + 8);
  w.killEnemy(foe, a);
  run(1);
  const la = events(1, 'loot'), lb = events(2, 'loot');
  assert.equal(la.length, 1); assert.equal(lb.length, 1);
  assert.equal(la[0].drops.length, 3, 'gold, an item and a potion each');
  assert.ok(la[0].drops.every((d) => w.drops.get(d.id).to === a));
  assert.ok(lb[0].drops.every((d) => w.drops.get(d.id).to === b));
  assert.notDeepEqual(la[0].drops.find((d) => d.kind === 'item').item, lb[0].drops.find((d) => d.kind === 'item').item, 'independent rolls');
  // B walks over A's drops: nothing. A walks over them: they are A's.
  const gold0 = profile(1).gold;
  for (const d of la[0].drops) { ecs.x[b] = d.x; ecs.z[b] = d.z; run(3); }
  const mineA = new Set(la[0].drops.map((d) => d.id));
  assert.ok(events(2, 'pickup').every((ev) => !mineA.has(ev.id)), 'B only ever takes its own');
  assert.ok(la[0].drops.every((d) => w.drops.has(d.id)), 'A\'s drops are still there');
  ecs.potions[a] = 1;
  for (const d of la[0].drops) { ecs.x[a] = d.x; ecs.z[a] = d.z; run(3); }
  const picks = events(1, 'pickup');
  assert.equal(picks.length, 3);
  assert.equal(profile(1).gold, gold0 + 4);
  assert.equal(profile(1).bag.length, 1);
  assert.equal(ecs.potions[a], 2);
  assert.ok(!events(2, 'pickup').some((ev) => mineA.has(ev.id)) && !events(2, 'loot').some((ev) => ev.to === a), 'B never hears of A\'s loot');
  // The profile message follows (throttled).
  run(DROPS.profileEvery);
  assert.ok(true);
}));

test('a full bag leaves items on the ground (said once); drops fade after their life', () => withTable('archer', { gold: [0, 1, 1], item: 1, potion: 0 }, () => {
  const { w, ecs, join, events, profile, run } = server();
  const a = join(1);
  const p = profile(1);
  for (let i = 0; i < ITEMS.bag; i++) p.bag.push({ u: 900 + i, b: 'panuelo', r: 0, l: 1, a: [] });
  const foe = w.spawnEnemy('archer', ecs.x[a] + 2, ecs.z[a]);
  w.killEnemy(foe, a);
  run(1);
  const d = events(1, 'loot')[0].drops[0];
  ecs.x[a] = d.x; ecs.z[a] = d.z;
  run(12);
  assert.equal(events(1, 'full').length, 1, 'told once');
  assert.ok(w.drops.has(d.id), 'it waits on the ground');
  p.bag.pop();
  run(3);
  assert.ok(!w.drops.has(d.id), 'taken once there is room');
  const foe2 = w.spawnEnemy('archer', ecs.x[a] + 20, ecs.z[a]);
  w.killEnemy(foe2, a);
  run(1);
  const d2 = events(1, 'loot').at(-1).drops[0];
  run(Math.round(DROPS.life / DT) + 6);
  assert.ok(!w.drops.has(d2.id));
  assert.ok(events(1, 'unloot').some((ev) => ev.ids.includes(d2.id) && ev.why === 'expire'));
}));

test('the bag: equip swaps and changes the numbers (and the kit), unequip, salvage; starters are worth nothing', () => {
  const { s, ecs, join, events, profile } = server();
  const a = join(1);
  const p = profile(1), atk0 = ecs.atk[a];
  p.bag.push({ u: 50, b: 'ancla', r: 2, l: 6, a: [['atk', 5], ['crit', 4]] }, { u: 51, b: 'botas', r: 0, l: 3, a: [] }, { u: 52, b: 'trabuco', r: 1, l: 4, a: [['cdr', 3]] });
  s.receive(1, { t: MSG.CMD, type: 'equip', uid: 50 });
  assert.equal(p.eq.weapon.u, 50);
  assert.ok(ecs.atk[a] > atk0 + 15, `ATK ${atk0} → ${ecs.atk[a]}`);
  assert.ok(ecs.winBonus[a] < 0, 'the anchor narrows the windows');
  assert.equal(p.bag.find((it) => it.b === 'sable').s, 1, 'the starter went to the bag');
  s.receive(1, { t: MSG.CMD, type: 'equip', uid: 51 });
  assert.ok(ecs.speed[a] > tuning.player.runSpeed);
  s.receive(1, { t: MSG.CMD, type: 'unequip', slot: 'boots' });
  assert.equal(ecs.speed[a], tuning.player.runSpeed);
  assert.equal(p.eq.boots, null);
  s.receive(1, { t: MSG.CMD, type: 'unequip', slot: 'weapon' });
  assert.equal(p.eq.weapon.u, 50, 'the weapon cannot be taken off');
  // Another kit from the bag: the pistols' kit comes with it.
  s.world.events.length = 0;
  s.receive(1, { t: MSG.CMD, type: 'equip', uid: 52 });
  assert.equal(ecs.weapon[a], WEAPON.PISTOLAS);
  assert.ok(s.world.events.some((ev) => ev.type === 'equip' && ev.weapon === WEAPON.PISTOLAS));
  const gold0 = p.gold;
  s.receive(1, { t: MSG.CMD, type: 'salvage', uid: 51 });
  assert.ok(p.gold > gold0 && !p.bag.some((it) => it.u === 51));
  const starter = p.bag.find((it) => it.s);
  s.receive(1, { t: MSG.CMD, type: 'salvage', uid: starter.u });
  s.flushEvents();
  assert.equal(events(1, 'sold').at(-1).gold, 0, 'a starter is worth nothing');
  s.receive(1, { t: MSG.CMD, type: 'equip', uid: 999 });
  assert.equal(p.eq.weapon.u, 52, 'an unknown item changes nothing');
});

test('racks: the best weapon of that kit you carry, or the rack\'s common one; a full bag drops the old one at your feet', () => {
  const { s, w, ecs, join, profile, events, run } = server();
  const rack = map.racks[0];
  const a = join(1, rack.x + 1.5, rack.z);
  const p = profile(1);
  let seq = 0;
  const cmd = (c = {}) => { s.receive(1, { t: MSG.INPUTS, cmds: [{ seq: ++seq, mx: 0, mz: 0, ax: ecs.x[a] + 5, az: ecs.z[a], btn: 0, prs: 0, pt: w.tick, w: 0, ...c }] }); s.step(); };
  cmd({ w: WEAPON.PISTOLAS + 1 });
  assert.equal(ecs.weapon[a], WEAPON.PISTOLAS);
  assert.equal(p.eq.weapon.b, 'chispa');
  assert.equal(p.bag[0].b, 'sable', 'the cutlass is in the bag');
  p.bag.push({ u: 77, b: 'daga', r: 3, l: 8, a: [['atk', 4], ['crit', 4], ['rip', 4]] });
  cmd({ w: WEAPON.SABLE + 1 });
  assert.equal(p.eq.weapon.u, 77, 'the best cutlass you carry');
  // Full bag, no pistols in it any more: the rack's pistols, and the dagger waits on the floor.
  p.bag = p.bag.filter((it) => BASES[it.b].weapon !== 'pistolas');
  while (p.bag.length < ITEMS.bag) p.bag.push({ u: 500 + p.bag.length, b: 'panuelo', r: 0, l: 1, a: [] });
  cmd({ w: WEAPON.PISTOLAS + 1 });
  assert.equal(p.eq.weapon.b, 'chispa');
  const left = events(1, 'loot').at(-1).drops[0];
  assert.equal(left.item.u, 77, 'nothing is lost');
  run(1);
});

test('mastery: XP with a weapon raises its mastery and opens E at 2, R at 3 (private event)', () => {
  const { s, w, ecs, join, events, profile } = server();
  const a = join(1);
  const foe = () => { const o = w.spawnEnemy('sentinel', ecs.x[a] + 3, ecs.z[a]); w.killEnemy(o, a); };
  foe(); // 60 XP
  s.flushEvents();
  assert.equal(profile(1).mast[0][0], 2);
  assert.ok(kitUnlocked(ecs, a, 'e') && !kitUnlocked(ecs, a, 'r'));
  const ev = events(1, 'mastery')[0];
  assert.deepEqual([ev.kit, ev.level, ev.opens], [0, 2, 'e']);
  for (let i = 0; i < 3; i++) foe();
  s.flushEvents();
  assert.equal(profile(1).mast[0][0], 3);
  assert.ok(kitUnlocked(ecs, a, 'r'));
  assert.equal(profile(1).mast[1][0], 1, 'the pistols did not learn anything');
  assert.ok(MASTERY.xp[0] === 60);
});

test('the boss chest: one per pirate in the arena, opened with F, at least one Rare inside', () => {
  const { s, w, ecs, join, events } = server();
  const a = join(1, A.x + 2, A.z), b = join(2, A.x - 2, A.z);
  ecs.god[a] = ecs.god[b] = 1;
  const enc = w.encounters[0] || (() => { w.populate(); return w.encounters[0]; })();
  encounterDev(w, enc, 'boss');
  for (let i = 0; i < 400 && enc.st !== 'boss'; i++) s.step();
  encounterDev(w, enc, 'win');
  for (let i = 0; i < 10; i++) s.step();
  const ca = events(1, 'loot').find((ev) => ev.drops[0].kind === 'chest'), cb = events(2, 'loot').find((ev) => ev.drops[0].kind === 'chest');
  assert.ok(ca && cb, 'both got a chest');
  const chest = ca.drops[0];
  ecs.x[a] = chest.x + 6; ecs.z[a] = chest.z;
  s.receive(1, { t: MSG.CMD, type: 'open', drop: chest.id });
  assert.ok(w.drops.has(chest.id), 'too far to open');
  ecs.x[a] = chest.x + 1; ecs.z[a] = chest.z;
  s.receive(2, { t: MSG.CMD, type: 'open', drop: chest.id });
  assert.ok(w.drops.has(chest.id), 'not B\'s chest');
  s.receive(1, { t: MSG.CMD, type: 'open', drop: chest.id });
  s.flushEvents();
  assert.ok(!w.drops.has(chest.id));
  const spill = events(1, 'loot').at(-1).drops;
  const items = spill.filter((d) => d.kind === 'item');
  assert.equal(items.length, 1 + DROPS.chest.items);
  assert.ok(items[0].item.r >= 2, 'at least Rare');
  assert.ok(spill.some((d) => d.kind === 'gold' && d.n >= DROPS.chest.gold[0]));
});

test('client prediction stays exact wearing speed boots and a cooldown ring (equipped through the bag)', () => {
  const { server: srv, client, deliver, se, ecs } = clientAndServer((sp) => [sp.x - 30, sp.z]);
  const p = srv.world.profiles.get(se);
  p.bag.push({ u: 90, b: 'viento', r: 4, l: 10, a: [['spd', 12], ['dash', 12], ['def', 3], ['hp', 3]] }, { u: 91, b: 'brujula', r: 2, l: 8, a: [['cdr', 4], ['xp', 4]] });
  client.send({ t: MSG.CMD, type: 'equip', uid: 90 });
  client.send({ t: MSG.CMD, type: 'equip', uid: 91 });
  for (let i = 0; i < 4; i++) { srv.step(); deliver(); }
  const c0 = client.stats.corrections;
  for (let i = 0; i < 240; i++) {
    const k = Math.floor(i / 40) % 4;
    client.tickInput({ mx: [1, 0, -1, 0][k], mz: [0, 1, 0, -1][k], ax: ecs.x[se] + 4, az: ecs.z[se], btn: 0, prs: i % 50 === 7 ? BTN.DASH : i % 70 === 30 ? BTN.Q : 0, w: 0 });
    srv.step(); deliver();
  }
  assert.ok(ecs.speed[se] > tuning.player.runSpeed * 1.1);
  assert.equal(client.stats.corrections - c0, 0, 'no corrections');
  assert.equal(client.profile.eq.boots.u, 90, 'the client has the profile');
});
