// M4 P4: quests (the main chain from the beach to HELLFIRE, Tía Perla's coral, the repeatable hunt), talking
// to people and Tía Perla's stall, all decided by the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/data/tuning.js';
import { QUESTS, QST } from '../src/data/quests.js';
import { CONSUMABLES, ITEMS, BASES } from '../src/data/items.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { encounterDev } from '../src/sim/systems/encounter.js';
import { itemValue } from '../src/sim/items.js';
import { GAME } from '../src/data/meta.js';
import { map, A } from './helpers.mjs';

function server() {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const w = s.world, ecs = w.ecs;
  const join = (id) => { s.connect(id); s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon: 0 }); return s.clients.get(id).entity; };
  const put = (e, x, z) => { ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z); };
  const npc = (id) => w.npcs.get(id);
  const nextTo = (e, id, d = 1.5) => { const n = npc(id); put(e, ecs.x[n] + d, ecs.z[n]); };
  const events = (id, type) => (sent.get(id) || []).filter((m) => m.t === MSG.EVENT && m.ev.type === type).map((m) => m.ev);
  const cmd = (id, o) => { s.receive(id, { t: MSG.CMD, ...o }); s.flushEvents(); };
  const run = (n) => { for (let i = 0; i < n; i++) s.step(); };
  const quest = (e, id) => w.profiles.get(e).quests[id] || [0, 0];
  const kill = (kind, by, extra = {}) => { const o = w.spawnEnemy(kind, ecs.x[by] + 2, ecs.z[by], 0, extra); w.killEnemy(o, by); s.flushEvents(); return o; };
  return { s, w, ecs, join, put, npc, nextTo, events, cmd, run, quest, kill };
}

test('the main chain: the village, Brea, the archers, the sentinels and HELLFIRE, each one starting the next', () => {
  const { w, ecs, join, put, nextTo, events, cmd, run, quest, kill } = server();
  const e = join(1);
  const p = w.profiles.get(e);
  assert.deepEqual(quest(e, 'tierra'), [QST.ACTIVE, 0], 'a fresh pirate starts with «Tierra firme»');
  const v = map.landmarks.village;
  put(e, v.x, v.z);
  run(31);
  assert.equal(quest(e, 'tierra')[0], QST.DONE);
  assert.equal(ecs.xp[e], QUESTS.tierra.reward.xp);
  assert.equal(quest(e, 'brea')[0], QST.ACTIVE, 'the next one starts by itself');
  // Talking from afar does nothing.
  cmd(1, { type: 'talk', npc: w.npcs.get('captain') });
  assert.equal(quest(e, 'brea')[0], QST.ACTIVE);
  nextTo(e, 'captain');
  cmd(1, { type: 'talk', npc: w.npcs.get('captain') });
  assert.equal(quest(e, 'brea')[0], QST.DONE);
  assert.equal(p.gold, 20);
  assert.ok(events(1, 'talk').some((ev) => ev.npc === 'captain'));
  assert.equal(quest(e, 'sendero')[0], QST.ACTIVE);
  ecs.potions[e] = 4;
  for (let i = 0; i < 3; i++) kill('archer', e);
  assert.equal(quest(e, 'sendero')[0], QST.DONE);
  assert.equal(ecs.potions[e], CONSUMABLES.potion.max, 'potions up to the cap…');
  run(1);
  assert.ok(events(1, 'loot').some((ev) => ev.drops.some((d) => d.kind === 'potion')), '…and the rest at your feet');
  kill('sentinel', e); kill('archer', e); kill('sentinel', e);
  assert.equal(quest(e, 'guardianes')[0], QST.DONE);
  assert.equal(quest(e, 'prueba')[0], QST.ACTIVE);
  // HELLFIRE.
  ecs.god[e] = 1;
  put(e, A.x + 2, A.z);
  w.populate();
  const enc = w.encounters[0];
  encounterDev(w, enc, 'boss');
  for (let i = 0; i < 400 && enc.st !== 'boss'; i++) run(1);
  encounterDev(w, enc, 'win');
  run(5);
  assert.equal(quest(e, 'prueba')[0], QST.DONE);
  assert.equal(p.gold, 20 + 40 + 100);
  assert.deepEqual(events(1, 'quest').filter((ev) => ev.st === 'done').map((ev) => ev.id), ['tierra', 'brea', 'sendero', 'guardianes', 'prueba']);
});

test('co-op: a kill counts for everyone with a right to its XP', () => {
  const { ecs, join, put, quest, kill, w } = server();
  const a = join(1), b = join(2);
  for (const e of [a, b]) w.profiles.get(e).quests = { sendero: [QST.ACTIVE, 0] };
  put(a, A.x, A.z); put(b, A.x + 5, A.z);
  kill('archer', a);
  assert.equal(quest(a, 'sendero')[1], 1);
  assert.equal(quest(b, 'sendero')[1], 1, 'the one standing by too');
  put(b, A.x + 60, A.z);
  kill('archer', a);
  assert.equal(quest(b, 'sendero')[1], 1, 'not from across the island');
  assert.ok(ecs);
});

test('Tía Perla\'s coral: offered after Brea, coral drops only while wanted, handed back in person', () => {
  const { w, ecs, join, nextTo, put, events, cmd, quest, kill } = server();
  const e = join(1), p = w.profiles.get(e);
  nextTo(e, 'vendor');
  cmd(1, { type: 'talk', npc: w.npcs.get('vendor') });
  assert.deepEqual(events(1, 'talk').at(-1).offer, [], 'nothing before meeting Brea');
  assert.equal(events(1, 'talk').at(-1).shop, 1);
  p.quests.brea = [QST.DONE, 0];
  cmd(1, { type: 'talk', npc: w.npcs.get('vendor') });
  assert.deepEqual(events(1, 'talk').at(-1).offer, ['coral']);
  assert.ok(!w.questWants(e, 'coral'), 'no coral before the quest');
  put(e, A.x, A.z);
  cmd(1, { type: 'quest', op: 'accept', id: 'coral' });
  assert.equal(quest(e, 'coral')[0], QST.NONE, 'accepting needs her there');
  nextTo(e, 'vendor');
  cmd(1, { type: 'quest', op: 'accept', id: 'coral' });
  assert.equal(quest(e, 'coral')[0], QST.ACTIVE);
  assert.ok(w.questWants(e, 'coral'));
  // Shamans carry coral: kill until six are picked up.
  let n = 0;
  for (let i = 0; i < 80 && (p.items.coral || 0) < 6; i++) {
    kill('shaman', e);
    for (const d of [...w.drops.values()]) if (d.to === e && d.kind === 'quest') { put(e, d.x, d.z); w.tick += 3 - (w.tick % 3); w.stepWorld(); n++; }
  }
  w.events.length = 0;
  assert.equal(p.items.coral, 6);
  assert.equal(quest(e, 'coral')[0], QST.READY);
  assert.ok(!w.questWants(e, 'coral'), 'enough coral: no more drops');
  const gold0 = p.gold, bag0 = p.bag.length;
  put(e, A.x, A.z);
  cmd(1, { type: 'quest', op: 'turnin', id: 'coral' });
  assert.equal(quest(e, 'coral')[0], QST.READY, 'hand it in to her face');
  nextTo(e, 'vendor');
  cmd(1, { type: 'quest', op: 'turnin', id: 'coral' });
  assert.equal(quest(e, 'coral')[0], QST.DONE);
  assert.equal(p.gold, gold0 + 60);
  assert.equal(p.items.coral, 0, 'the coral goes to her');
  const ring = p.bag[bag0];
  assert.ok(ring && BASES[ring.b].slot === 'ring' && ring.r >= 1, 'an uncommon trinket or better');
  cmd(1, { type: 'talk', npc: w.npcs.get('vendor') });
  assert.deepEqual(events(1, 'talk').at(-1).offer, [], 'done for good');
  assert.ok(n >= 6 && ecs);
});

test('«Caza en La Caldera» repeats: 40 enemies of the trial, back to Brea, and again', () => {
  const { w, join, nextTo, cmd, quest, kill } = server();
  const e = join(1), p = w.profiles.get(e);
  p.quests.prueba = [QST.DONE, 0];
  nextTo(e, 'captain');
  cmd(1, { type: 'quest', op: 'accept', id: 'caza' });
  assert.equal(quest(e, 'caza')[0], QST.ACTIVE);
  kill('grunt', e); // not from the trial: does not count
  assert.equal(quest(e, 'caza')[1], 0);
  for (let i = 0; i < 40; i++) kill('grunt', e, { enc: 'caldera' });
  assert.equal(quest(e, 'caza')[0], QST.READY);
  const g = p.gold;
  cmd(1, { type: 'quest', op: 'turnin', id: 'caza' });
  assert.equal(quest(e, 'caza')[0], QST.DONE);
  assert.equal(p.gold, g + 120);
  cmd(1, { type: 'quest', op: 'accept', id: 'caza' });
  assert.deepEqual(quest(e, 'caza'), [QST.ACTIVE, 0], 'again');
});

test('Tía Perla\'s stall: potions and mystery crates for gold, selling pays it all, only next to her', () => {
  const { w, ecs, join, nextTo, put, events, cmd } = server();
  const e = join(1), p = w.profiles.get(e);
  nextTo(e, 'vendor');
  ecs.potions[e] = 0;
  cmd(1, { type: 'buy', what: 'potion' });
  assert.equal(events(1, 'bought').at(-1).fail, 'gold');
  p.gold = 1000;
  cmd(1, { type: 'buy', what: 'potion' });
  assert.equal(ecs.potions[e], 1);
  assert.equal(p.gold, 1000 - CONSUMABLES.potion.price);
  ecs.potions[e] = CONSUMABLES.potion.max;
  cmd(1, { type: 'buy', what: 'potion' });
  assert.equal(events(1, 'bought').at(-1).fail, 'max');
  cmd(1, { type: 'buy', what: 'crate' });
  assert.equal(p.bag.length, 1, 'a mystery item');
  assert.equal(p.gold, 1000 - CONSUMABLES.potion.price - CONSUMABLES.crate.price);
  const it = p.bag[0], g = p.gold;
  put(e, A.x, A.z);
  cmd(1, { type: 'sell', uid: it.u });
  assert.equal(p.bag.length, 1, 'no selling from across the island');
  nextTo(e, 'vendor');
  cmd(1, { type: 'sell', uid: it.u });
  assert.equal(p.gold, g + itemValue(it), 'all its worth');
  cmd(1, { type: 'buy', what: 'rum' });
  assert.equal(p.gold, g + itemValue(it), 'unknown wares');
  for (let i = 0; i < ITEMS.bag; i++) p.bag.push({ u: 900 + i, b: 'panuelo', r: 0, l: 1, a: [] });
  cmd(1, { type: 'buy', what: 'crate' });
  assert.equal(events(1, 'bought').at(-1).fail, 'bag');
});

test('the beach tutorial\'s progress is kept in the profile (only forward)', () => {
  const { w, join, cmd } = server();
  const e = join(1);
  cmd(1, { type: 'tut', i: 3 });
  cmd(1, { type: 'tut', i: 1 });
  assert.equal(w.profiles.get(e).flags.tut, 3);
  assert.ok(DT > 0);
});
