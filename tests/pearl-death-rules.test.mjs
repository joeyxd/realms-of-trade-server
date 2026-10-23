import test from 'node:test';
import assert from 'node:assert/strict';
import { tuning } from '../src/data/tuning.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { installInventory, newProfile, attachProfile, detachProfile, sanitizeProfile, stepDrops, giveItem } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl, spitPearl } from '../src/sim/systems/pearls.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { rollItem } from '../src/sim/items.js';
import { map, A } from './helpers.mjs';

const copy = structuredClone;
const kill = (w, e) => hurtPlayer(w, e, 99999, { x: w.ecs.x[e], z: w.ecs.z[e], kind: 'test', seq: 1, knock: 0 });
function fixture(at = A, kind = 'brasa') {
  const w = new World(42, { map, server: true }); installInventory(w, 'death-rules');
  const e = w.spawnPlayer({ x: at.x, z: at.z }), p = newProfile(); p.lvl = 4; p.xp = 80; p.gold = 73;
  p.mast[0] = [3, 123]; attachProfile(w, e, p); w.ecs.regenT[e] = 99;
  const bound = givePearl(w, e, kind); assert.ok(swallowPearl(w, e, bound.uid));
  const bagPearl = givePearl(w, e, 'tinta');
  const item = rollItem(w.lootRng, { lvl: 3, slot: 'head', uid: p.uid++ }); giveItem(w, e, item);
  const head = rollItem(w.lootRng, { lvl: 3, slot: 'head', uid: p.uid++ }); p.eq.head = head;
  w.ecs.potions[e] = 2; w.events.length = 0; w.profileDirty.clear();
  return { w, e, p, bound, bagPearl, item, head };
}

for (const kind of ['brasa', 'escarcha', 'tormenta', 'tinta']) test(`${kind}: death releases bound and bag pearls, loses XP and bag, preserves earned progression`, () => {
  const { w, e, p, bound, bagPearl, item, head } = fixture(A, kind), mastery = copy(p.mast), tattoos = copy(p.sk);
  assert.equal(map.lawlessAt(w.ecs.x[e], w.ecs.z[e]), false);
  assert.equal(spitPearl(w, e), false); assert.equal(p.pearls.swallowed.uid, bound.uid);
  assert.equal(swallowPearl(w, e, bagPearl.uid, bound.uid), false);
  kill(w, e);
  assert.equal(w.ecs.dead[e], 1); assert.equal(w.ecs.xp[e], 72); assert.equal(p.xp, 72); assert.equal(p.lvl, 4);
  assert.deepEqual(p.bag, []); assert.deepEqual(p.pearls, { bag: [], swallowed: null }); assert.equal(w.ecs.elem[e], 0);
  assert.equal(p.eq.head, head); assert.equal(w.ecs.potions[e], 2); assert.equal(p.gold, 73);
  assert.deepEqual(p.mast, mastery); assert.deepEqual(p.sk, tattoos); assert.equal(p.stats.deaths, 1);
  const drops = [...w.drops.values()]; assert.equal(drops.length, 3);
  assert.deepEqual(new Set(drops.filter(d => d.kind === 'pearl').map(d => d.pearl.uid)), new Set([bound.uid, bagPearl.uid]));
  assert.deepEqual(drops.find(d => d.kind === 'item').item, item); assert.ok(drops.every(d => d.to === 0));
  const before = copy({ xp: p.xp, drops, nextDrop: w.nextDrop, deaths: p.stats.deaths }); kill(w, e);
  assert.deepEqual({ xp: p.xp, drops: [...w.drops.values()], nextDrop: w.nextDrop, deaths: p.stats.deaths }, before);
  const saved = sanitizeProfile(detachProfile(w, e)); w.despawn(e);
  const rejoined = w.spawnPlayer({ x: A.x, z: A.z }); attachProfile(w, rejoined, saved);
  assert.equal(w.ecs.xp[rejoined], 72); assert.equal(w.ecs.level[rejoined], 4); assert.equal(saved.pearls.swallowed, null);
  assert.deepEqual(saved.mast, mastery); assert.equal(w.drops.size, 3, 'rejoin does not duplicate public loot');
});

test('Cala keeps its additional equipment and potion risk alongside XP and all bag contents', () => {
  const { w, e, p, head } = fixture(map.cala); kill(w, e);
  assert.equal(p.xp, 72); assert.equal(p.lvl, 4); assert.equal(p.eq.head, null); assert.ok(p.eq.weapon.s);
  assert.equal(w.ecs.potions[e], 0); assert.equal(p.gold, 73);
  assert.equal([...w.drops.values()].filter(d => d.kind === 'item').length, 2);
  assert.ok([...w.drops.values()].some(d => d.item?.u === head.u));
  assert.equal([...w.drops.values()].filter(d => d.kind === 'potion').length, 2);
});

test('another pirate can recover the death loot with the same pearl UIDs while mastery stays with its owner', () => {
  const { w, e, p, bound, bagPearl } = fixture(), mastery = copy(p.mast); kill(w, e);
  const itemDrop = [...w.drops.values()].find(d => d.kind === 'item');
  const other = w.spawnPlayer({ x: itemDrop.x, z: itemDrop.z }), q = newProfile(); attachProfile(w, other, q);
  w.tick = 33; stepDrops(w);
  w.ecs.x[other] = w.ecs.x[e]; w.ecs.z[other] = w.ecs.z[e]; w.tick = 36; stepDrops(w);
  assert.deepEqual(new Set(q.pearls.bag.map(v => v.uid)), new Set([bound.uid, bagPearl.uid]));
  assert.equal(q.pearls.swallowed, null); assert.deepEqual(p.mast, mastery); assert.deepEqual(q.mast, newProfile().mast);
  assert.equal(q.bag.length, 1); assert.equal(w.drops.size, 0);
});

test('zero and fractional XP never become negative, lower a level or consume mastery', () => {
  for (const xp of [0, 0.25, 80.75]) {
    const { w, e, p } = fixture(); w.ecs.xp[e] = xp; const mastery = copy(p.mast); kill(w, e);
    assert.ok(w.ecs.xp[e] >= 0); assert.ok(Math.abs(w.ecs.xp[e] - xp * (1 - tuning.combat.deathXpLoss)) < 0.00001);
    assert.equal(w.ecs.level[e], 4); assert.equal(p.xp, Math.round(w.ecs.xp[e] * 100) / 100); assert.deepEqual(p.mast, mastery);
  }
});

test('real command authority denies a legacy spit or exact replacement and saves the death penalty', () => {
  const sent = [], s = new LocalServer({ seed: 42, bots: 0, enemies: false, send: (_id, m) => sent.push(copy(m)) });
  s.connect(1); s.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Bound' });
  const w = s.world, e = s.clients.get(1).entity, p = w.profiles.get(e); w.ecs.regenT[e] = 99;
  const first = givePearl(w, e), second = givePearl(w, e, 'escarcha');
  s.receive(1, { t: MSG.CMD, type: 'pearl', op: 'swallow', uid: first.uid });
  s.receive(1, { t: MSG.CMD, type: 'pearl', op: 'spit' });
  s.receive(1, { t: MSG.CMD, type: 'pearl', op: 'swallow', uid: second.uid, replaceUid: first.uid });
  assert.equal(p.pearls.swallowed.uid, first.uid); assert.equal(w.drops.size, 0);
  w.ecs.xp[e] = 80; kill(w, e); s.step();
  const stored = s.saves.load(sent.findLast(m => m.t === MSG.SAVE).blob);
  assert.equal(stored.xp, 72); assert.deepEqual(stored.pearls, { bag: [], swallowed: null });
});
