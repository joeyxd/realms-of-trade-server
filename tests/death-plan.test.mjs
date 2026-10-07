import test from 'node:test';
import assert from 'node:assert/strict';
import { C, KIND } from '../src/sim/ecs.js';
import { World } from '../src/sim/world.js';
import { installInventory, newProfile, attachProfile, giveItem } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { rollItem } from '../src/sim/items.js';
import { killPlayer } from '../src/sim/systems/combat.js';
import { captureDeathPlan } from '../server/deathPlan.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { map, A } from './helpers.mjs';

const clone = structuredClone;
function fixture({ victimAt = A, killer = false, seed = 42 } = {}) {
  const w = new World(seed, { map, server: true }); installInventory(w, 'death-plan');
  const e = w.spawnPlayer({ x: victimAt.x, z: victimAt.z }), p = newProfile();
  p.pirateId = 'account:death-plan-victim'; p.lvl = 4; p.xp = 80; p.gold = 73;
  p.mast[0] = [3, 123]; attachProfile(w, e, p); w.ecs.regenT[e] = 99;
  let k = 0, kp = null;
  if (killer) {
    k = w.spawnPlayer({ x: A.x + 6, z: A.z }); kp = newProfile();
    kp.pirateId = 'account:death-plan-killer'; attachProfile(w, k, kp);
  }
  w.events.length = 0; w.profileDirty.clear();
  return { w, e, p, k, kp };
}
function snapshot(w, e, k = 0) {
  const row = (entity) => Object.fromEntries(Object.entries(w.ecs)
    .filter(([, col]) => ArrayBuffer.isView(col) && !(col instanceof DataView))
    .map(([key, col]) => [key, col[entity]]));
  return { victim: row(e), killer: k ? row(k) : null, profiles: clone([...w.profiles]), ledger: clone([...w.pearlLedger]),
    drops: clone([...w.drops]), nextDrop: w.nextDrop, events: clone(w.events), rng: w.lootRng.state(), dirty: [...w.profileDirty] };
}

test('captures a real exterior death with bound and bag pearls, item loss, XP loss, and decorated events without live writes', () => {
  const { w, e, p } = fixture(), bound = givePearl(w, e, 'brasa');
  assert.ok(swallowPearl(w, e, bound.uid));
  const bagPearl = givePearl(w, e, 'tinta');
  const item = rollItem(w.lootRng, { lvl: 3, slot: 'head', uid: p.uid++ }); giveItem(w, e, item);
  const before = snapshot(w, e), mastery = clone(p.mast);

  const plan = captureDeathPlan(w, e, { seq: 17 });

  assert.deepEqual(snapshot(w, e), before);
  assert.equal(plan.entity, e); assert.equal(plan.tick, w.tick); assert.deepEqual(plan.cause, { seq: 17, by: 0 });
  const victim = plan.profiles.find((q) => q.entity === e);
  assert.equal(victim.before.xp, 80); assert.equal(victim.after.xp, 72); assert.equal(victim.after.lvl, 4);
  assert.deepEqual(victim.after.bag, []); assert.deepEqual(victim.after.pearls, { bag: [], swallowed: null });
  assert.equal(victim.after.gold, 73); assert.deepEqual(victim.after.mast, mastery);
  assert.deepEqual(new Set(plan.ledgers.map((q) => q.uid)), new Set([bound.uid, bagPearl.uid]));
  assert.ok(plan.ledgers.every((q) => q.data.place === 'ground' && q.data.owner === ''));
  assert.ok(plan.drops.some((q) => q.kind === 'item' && q.item.u === item.u));
  assert.deepEqual(plan.drops.map((q) => q.id), plan.drops.map((_, i) => i + 1));
  assert.ok(plan.events.some((q) => q.type === 'death' && q.id === e && q.seq === 17));
  assert.ok(plan.events.some((q) => q.type === 'loot' && q.pub === 1));
});

test('captures Cala equipment and potions plus the killer PK profile delta, while preserving gold and mastery', () => {
  const { w, e, p, k, kp } = fixture({ victimAt: map.cala, killer: true });
  const item = rollItem(w.lootRng, { lvl: 3, slot: 'head', uid: p.uid++ }); p.eq.head = item;
  const bagItem = rollItem(w.lootRng, { lvl: 3, uid: p.uid++ }); giveItem(w, e, bagItem);
  w.ecs.potions[e] = 2; const oldMastery = clone(p.mast), before = snapshot(w, e, k);

  const plan = captureDeathPlan(w, e, { seq: 9, by: k });

  assert.deepEqual(snapshot(w, e, k), before);
  const victim = plan.profiles.find((q) => q.entity === e), killer = plan.profiles.find((q) => q.entity === k);
  assert.ok(victim); assert.ok(killer);
  assert.equal(victim.after.eq.head, null); assert.ok(victim.after.eq.weapon.s);
  assert.equal(victim.after.pot, 0); assert.equal(victim.after.gold, p.gold); assert.deepEqual(victim.after.mast, oldMastery);
  assert.equal(killer.before.stats.pk, 0); assert.equal(killer.after.stats.pk, 1);
  assert.ok(plan.drops.some((q) => q.kind === 'item' && q.item.u === item.u));
  assert.ok(plan.drops.some((q) => q.kind === 'item' && q.item.u === bagItem.u));
  assert.equal(plan.drops.filter((q) => q.kind === 'potion').length, 2);
});

test('empty inventory death still returns one victim profile and no loot or ledger changes', () => {
  const { w, e } = fixture();
  const plan = captureDeathPlan(w, e);
  assert.equal(plan.profiles.length, 1); assert.deepEqual(plan.drops, []); assert.deepEqual(plan.ledgers, []);
  assert.equal(plan.profiles[0].after.stats.deaths, plan.profiles[0].before.stats.deaths + 1);
});

test('forks loot RNG deterministically and treats existing live drop IDs as foreign', () => {
  const { w, e, p } = fixture();
  const item = rollItem(w.lootRng, { lvl: 2, uid: p.uid++ }); giveItem(w, e, item);
  const foreign = { id: 1, to: 0, kind: 'item', x: A.x + 20, z: A.z, t: 900, item: clone(item) };
  w.drops.set(1, foreign); w.nextDrop = 2;
  const before = snapshot(w, e);
  const first = captureDeathPlan(w, e), second = captureDeathPlan(w, e);
  assert.deepEqual(first, second); assert.deepEqual(snapshot(w, e), before);
  assert.equal(first.lootRng.before, before.rng); assert.equal(first.lootRng.after, second.lootRng.after);
  assert.deepEqual(first.drops.map((q) => q.id), first.drops.map((_, i) => i + 1), 'IDs are temporary plan ordinals');
  assert.deepEqual(w.drops.get(1), foreign);
});

test('rejects dead, non-player, missing-profile, malformed-number, and getter-backed selector inputs without live mutation', () => {
  const { w, e } = fixture();
  assert.throws(() => captureDeathPlan(w, 0), { code: 'session' });
  const noProfile = w.spawnPlayer({ x: A.x + 2, z: A.z });
  assert.throws(() => captureDeathPlan(w, noProfile), { code: 'session' });
  w.ecs.kind[noProfile] = KIND.ENEMY;
  assert.throws(() => captureDeathPlan(w, noProfile), { code: 'session' });
  const before = snapshot(w, e);
  const getter = {}; let getterRead = false;
  Object.defineProperty(getter, 'seq', { enumerable: true, get() { getterRead = true; return 1; } });
  assert.throws(() => captureDeathPlan(w, e, getter), { code: 'operation' }); assert.equal(getterRead, false);
  for (const options of [{ seq: -1 }, { seq: 0.5 }, { by: Number.NaN }, { unknown: 1 }]) {
    assert.throws(() => captureDeathPlan(w, e, options), { code: 'operation' });
  }
  const malformed = w.ecs.xp[e]; w.ecs.xp[e] = Number.NaN;
  assert.throws(() => captureDeathPlan(w, e), { code: 'profile' }); w.ecs.xp[e] = malformed;
  assert.deepEqual(snapshot(w, e), before);
});

test('rejects a malformed current pearl ledger owner and a valid-looking orphan death holder', () => {
  const { w, e } = fixture(), pearl = givePearl(w, e, 'escarcha');
  const original = clone(w.pearlLedger.get(pearl.uid));
  w.pearlLedger.set(pearl.uid, { ...original, entity: e + 50 });
  assert.throws(() => captureDeathPlan(w, e), { code: 'ownership' });
  w.pearlLedger.set(pearl.uid, original);
  w.pearlLedger.set(pearl.uid, { ...original, drop: 4 });
  assert.throws(() => captureDeathPlan(w, e), { code: 'ownership' });
  w.pearlLedger.set(pearl.uid, original);
  w.pearlLedger.set('orphan-pearl-uid', { owner: w.profiles.get(e).pirateId, entity: e, place: 'profile' });
  assert.throws(() => captureDeathPlan(w, e), { code: 'ownership' });
});

test('real killPlayer rejects a second death and preserves the first plan outcome', () => {
  const { w, e } = fixture();
  let calls = 0; w.onDeath = () => { calls++; };
  assert.equal(killPlayer(w, e, 1), true); const after = snapshot(w, e);
  assert.equal(killPlayer(w, e, 2), false); assert.equal(calls, 1); assert.deepEqual(snapshot(w, e), after);
});

test('capture requires a live authoritative player before death, never a dead or retired replay', () => {
  const { w, e } = fixture(), before = snapshot(w, e), mask = w.ecs.mask[e];
  w.isServer = false;
  assert.throws(() => captureDeathPlan(w, e), { code: 'session' }); w.isServer = true;
  w.ecs.mask[e] &= ~C.PLAYER;
  assert.throws(() => captureDeathPlan(w, e), { code: 'session' }); w.ecs.mask[e] = mask;
  assert.deepEqual(snapshot(w, e), before);
  killPlayer(w, e, 1); const dead = snapshot(w, e);
  assert.throws(() => captureDeathPlan(w, e), { code: 'session' });
  assert.deepEqual(snapshot(w, e), dead);
  w.despawn(e); const retired = snapshot(w, e);
  assert.throws(() => captureDeathPlan(w, e), { code: 'session' });
  assert.deepEqual(snapshot(w, e), retired);
});

test('output is recursively frozen and detached from every mutable live authority', () => {
  const { w, e, p } = fixture(), pearl = givePearl(w, e, 'tormenta');
  const item = rollItem(w.lootRng, { lvl: 2, uid: p.uid++ }); giveItem(w, e, item);
  const plan = captureDeathPlan(w, e);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.profiles[0].after));
  const itemDrop = plan.drops.find((d) => d.kind === 'item');
  assert.ok(itemDrop); assert.ok(Object.isFrozen(itemDrop)); assert.ok(Object.isFrozen(plan.events[0]));
  const expectedPlan = clone(plan);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), expectedPlan);
  assert.throws(() => { plan.profiles[0].after.pearls.bag.push({ uid: 'x', kind: 'brasa' }); }, TypeError);
  assert.throws(() => { itemDrop.item.u = 999999; }, TypeError);
  assert.equal(w.profiles.get(e).pearls.bag.length, 1); assert.equal(w.profiles.get(e).pearls.bag[0].uid, pearl.uid);
  p.bag[0].u = 999998;
  assert.deepEqual(plan, expectedPlan, 'later live edits cannot alter the returned snapshot');
  assert.notEqual(w.drops.size, plan.drops.length);
});

test('rejects a killer whose player component is corrupt even when the ECS kind says player', () => {
  const { w, e, k } = fixture({ killer: true });
  w.ecs.mask[k] &= ~C.PLAYER;
  assert.throws(() => captureDeathPlan(w, e, { by: k }), { code: 'session' });
});

test('matches actual killPlayer profile, drops, ledgers, events, numeric ECS row, and forked RNG', () => {
  const left = fixture({ killer: true, victimAt: map.cala }), right = fixture({ killer: true, victimAt: map.cala });
  for (const { w, e, p, k, kp } of [left, right]) {
    const pearl = givePearl(w, e, 'tinta'); assert.ok(swallowPearl(w, e, pearl.uid));
    givePearl(w, e, 'brasa');
    giveItem(w, e, rollItem(w.lootRng, { lvl: 4, slot: 'head', uid: p.uid++ }));
    w.ecs.potions[e] = 2;
    // Let the killer's profile lag behind valid live ECS-backed progress.
    w.ecs.level[k] = 6; w.ecs.xp[k] = 41.25; w.ecs.potions[k] = 3;
    kp.lvl = 2; kp.xp = 4; kp.pot = 0;
    w.events.length = 0; w.profileDirty.clear();
  }
  const plan = captureDeathPlan(left.w, left.e, { seq: 29, by: left.k });
  assert.equal(plan.rules.xpLossFraction, 0.1); assert.equal(plan.rules.lawless, true);
  const killerPlan = plan.profiles.find((q) => q.entity === left.k);
  const freshKiller = capturePearlProfile(left.w, left.k);
  assert.equal(killerPlan.before.xp, freshKiller.xp); assert.equal(killerPlan.before.lvl, freshKiller.lvl);
  assert.equal(killerPlan.before.pot, freshKiller.pot);
  assert.equal(killerPlan.before.stats.pk, freshKiller.stats.pk);
  assert.equal(killerPlan.after.stats.pk, freshKiller.stats.pk + 1);

  assert.equal(killPlayer(right.w, right.e, 29, right.k), true);
  const row = Object.fromEntries(Object.entries(right.w.ecs)
    .filter(([, col]) => ArrayBuffer.isView(col) && !(col instanceof DataView))
    .map(([key, col]) => [key, col[right.e]]));
  const victim = plan.profiles.find((q) => q.entity === left.e);
  assert.deepEqual(victim.after, right.p);
  assert.deepEqual(plan.profiles.find((q) => q.entity === left.k).after,
    capturePearlProfile(right.w, right.k));
  assert.deepEqual(plan.drops, [...right.w.drops.values()]);
  assert.deepEqual(new Map(plan.ledgers.map(({ uid, data }) => [uid, data])), right.w.pearlLedger);
  assert.deepEqual(plan.events, right.w.events);
  assert.deepEqual(plan.ecs.after, row);
  assert.equal(plan.lootRng.after, right.w.lootRng.state());
});

test('captures a bag without any pearls and spills it as ordinary item drops', () => {
  const { w, e, p } = fixture();
  const item = rollItem(w.lootRng, { lvl: 2, uid: p.uid++ }); giveItem(w, e, item);
  const plan = captureDeathPlan(w, e);
  assert.deepEqual(plan.ledgers, []);
  assert.equal(plan.drops.length, 1);
  assert.equal(plan.drops[0].kind, 'item'); assert.equal(plan.drops[0].item.u, item.u);
  assert.deepEqual(plan.profiles[0].after.bag, []);
});

test('matches real pearl fallback to the victim checkpoint when the death occurs in water', () => {
  const { w, e } = fixture(), pearl = givePearl(w, e, 'escarcha');
  const originalMap = w.map;
  w.map = new Proxy(originalMap, { get(target, key, receiver) {
    if (key === 'groundAt') return () => -100;
    if (key === 'onDock') return () => false;
    return Reflect.get(target, key, receiver);
  } });
  w.raftDeck = { surface: () => null, blocked: () => false };
  w.ecs.x[e] = 100; w.ecs.z[e] = 100; w.ecs.cpX[e] = A.x; w.ecs.cpZ[e] = A.z;
  const plan = captureDeathPlan(w, e), deathPearl = plan.drops.find((q) => q.kind === 'pearl' && q.pearl.uid === pearl.uid);
  assert.equal(deathPearl.x, A.x); assert.equal(deathPearl.z, A.z);
});

test('uses the actual raft deck surface when selecting the pearl death drop position', () => {
  const { w, e } = fixture(), pearl = givePearl(w, e, 'tormenta');
  const x = A.x + 0.1, z = A.z + 0.1;
  w.ecs.x[e] = x; w.ecs.z[e] = z; w.ecs.facing[e] = 0;
  w.raftDeck = { surface: () => ({ y: 1 }), blocked: () => false };
  const originalMap = w.map;
  w.map = new Proxy(originalMap, { get(target, key, receiver) {
    if (key === 'groundAt') return () => { throw new Error('land query should be skipped on deck'); };
    return Reflect.get(target, key, receiver);
  } });
  const plan = captureDeathPlan(w, e), deathPearl = plan.drops.find((q) => q.kind === 'pearl' && q.pearl.uid === pearl.uid);
  assert.ok(deathPearl); assert.notDeepEqual([deathPearl.x, deathPearl.z], [w.ecs.cpX[e], w.ecs.cpZ[e]]);
});

test('a throwing terrain query cannot mutate the live profile, ECS, ledger, RNG, drops, or events', () => {
  const { w, e } = fixture(), pearl = givePearl(w, e, 'brasa');
  const before = snapshot(w, e); const originalMap = w.map;
  w.map = new Proxy(originalMap, { get(target, key, receiver) {
    if (key === 'groundAt') return () => { throw new Error('terrain unavailable'); };
    return Reflect.get(target, key, receiver);
  } });
  assert.throws(() => captureDeathPlan(w, e), /terrain unavailable/);
  w.map = originalMap;
  assert.deepEqual(snapshot(w, e), before);
  assert.equal(w.profiles.get(e).pearls.bag[0].uid, pearl.uid);
});
