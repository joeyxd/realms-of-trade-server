import assert from 'node:assert/strict';
import { World } from '../../src/sim/world.js';
import { DT } from '../../src/data/tuning.js';
import { PEARL } from '../../src/data/pearls.js';
import { installInventory, newProfile, attachProfile, giveItem } from '../../src/sim/systems/inventory.js';
import { givePearl, swallowPearl } from '../../src/sim/systems/pearls.js';
import { rollItem } from '../../src/sim/items.js';
import { captureDeathPlan } from '../../server/deathPlan.mjs';
import { deathResult } from '../../server/deathOperation.mjs';
import { map, A } from '../helpers.mjs';

export const VICTIM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const KILLER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const WORLD = 'death:island';
export const deathOp = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = structuredClone;

export function makeDeath({ lawless = false, killer = false, pearlCount = 0, loot = false, seed = 42 } = {}) {
  const w = new World(seed, { map, server: true }); installInventory(w, 'death-storage');
  const e = w.spawnPlayer({ x: (lawless ? map.cala : A).x, z: (lawless ? map.cala : A).z });
  const p = newProfile(); p.pirateId = `account:${VICTIM}`; p.gold = 73; p.xp = 80; p.mast[0] = [3, 123];
  attachProfile(w, e, p);
  let k = 0;
  if (killer) {
    k = w.spawnPlayer({ x: map.cala.x + 6, z: map.cala.z });
    const kp = newProfile(); kp.pirateId = `account:${KILLER}`; attachProfile(w, k, kp);
  }
  const owned = [];
  for (let i = 0; i < pearlCount; i++) {
    if (i === 8) { w.ecs.regenT[e] = PEARL.calm; assert.ok(swallowPearl(w, e, owned[0].uid)); }
    const q = givePearl(w, e, ['brasa', 'escarcha', 'tormenta', 'tinta'][i % 4]);
    assert.ok(q); owned.push(q);
  }
  if (pearlCount && pearlCount <= 8 && pearlCount % 2 === 0) {
    w.ecs.regenT[e] = PEARL.calm; assert.ok(swallowPearl(w, e, owned[0].uid));
  }
  if (loot) {
    const item = rollItem(w.lootRng, { lvl: 3, slot: 'head', uid: p.uid++ }); p.eq.head = item;
    const bagItem = rollItem(w.lootRng, { lvl: 3, uid: p.uid++ }); giveItem(w, e, bagItem);
    if (lawless) w.ecs.potions[e] = 2;
  }
  w.events.length = 0; w.profileDirty.clear();
  return { world: w, entity: e, killerEntity: k, owned };
}

export function planRequest(f, operationId = deathOp(1), { pearlVersions = {} } = {}) {
  const plan = captureDeathPlan(f.world, f.entity, f.killerEntity ? { by: f.killerEntity } : {});
  const victimPlan = plan.profiles.find((p) => p.entity === f.entity);
  const killerPlan = f.killerEntity ? plan.profiles.find((p) => p.entity === f.killerEntity) : null;
  const before = victimPlan.before, pearls = [...before.pearls.bag, ...(before.pearls.swallowed ? [before.pearls.swallowed] : [])]
    .sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
  const pearlDrops = new Map(plan.drops.filter((d) => d.kind === 'pearl').map((d) => [d.pearl.uid, d]));
  const ground = (x, z, availableAt, expiresAt) => ({ x, z, availableAt, expiresAt });
  const request = {
    operationId, world: WORLD, victim: VICTIM, killer: killerPlan ? KILLER : null,
    rules: { lawless: plan.rules.lawless, xpLossFraction: plan.rules.xpLossFraction, xpBefore: plan.ecs.before.xp },
    profiles: [
      { id: VICTIM, expectedVersion: 1, before: clone(victimPlan.before), data: clone(victimPlan.after) },
      ...(killerPlan ? [{ id: KILLER, expectedVersion: 1, before: clone(killerPlan.before), data: clone(killerPlan.after) }] : []),
    ].sort((a, b) => a.id < b.id ? -1 : 1),
    pearls: pearls.map((q, i) => {
      const d = pearlDrops.get(q.uid);
      return { ...q, expectedVersion: pearlVersions[q.uid] ?? 1,
        ground: { x: d?.x ?? plan.ecs.before.x, z: d?.z ?? plan.ecs.before.z,
          availableAt: d?.pickAt ?? plan.tick + 30, returnAt: d?.t ?? plan.tick + Math.round(PEARL.returnAfter / DT) + i } };
    }),
    drops: plan.drops.filter((d) => d.kind === 'item' || d.kind === 'potion').map((d, i) => ({ ordinal: i + 1, kind: d.kind, item: d.item ? clone(d.item) : null,
      ground: ground(d.x, d.z, plan.tick, d.t) })),
  };
  return { plan, request };
}

export async function seedDeathStore(store, f, request) {
  const victim = request.profiles.find((p) => p.id === VICTIM);
  const base = clone(victim.before); base.pearls = { bag: [], swallowed: null };
  assert.equal((await store.saveProfile(VICTIM, base, 0)).ok, true);
  if (request.killer) assert.equal((await store.saveProfile(KILLER, request.profiles.find((p) => p.id === KILLER).before, 0)).ok, true);
  let version = 1;
  for (const q of request.pearls) {
    const current = (await store.loadProfile(VICTIM)).data;
    if (current.pearls.bag.length < 8) current.pearls.bag.push({ uid: q.uid, kind: q.kind });
    else current.pearls.swallowed = { uid: q.uid, kind: q.kind };
    const reply = await store.commitPearlGround({ operationId: deathOp(100 + version), uid: q.uid, kind: q.kind,
      from: null, to: VICTIM, expectedVersion: 0, world: WORLD, ground: null,
      profiles: [{ id: VICTIM, expectedVersion: version, data: current }] });
    assert.equal(reply.ok, true, `seed pearl ${q.uid}`); version++;
  }
  const final = clone(victim.before);
  const loaded = await store.loadProfile(VICTIM);
  if (request.pearls.length) assert.equal((await store.saveProfile(VICTIM, final, loaded.version)).ok, true);
  const row = await store.loadProfile(VICTIM), killer = request.killer ? await store.loadProfile(KILLER) : null;
  request.profiles.find((p) => p.id === VICTIM).expectedVersion = row.version;
  if (killer) request.profiles.find((p) => p.id === KILLER).expectedVersion = killer.version;
  return { victim: row, killer };
}

export async function advancePearlGeneration(store, request, uid, cycles = 1) {
  const pearl = request.pearls.find((q) => q.uid === uid); assert.ok(pearl);
  for (let cycle = 0; cycle < cycles; cycle++) {
    const before = await store.loadProfile(VICTIM), released = clone(before.data);
    const bagIndex = released.pearls.bag.findIndex((q) => q.uid === uid), swallowed = released.pearls.swallowed?.uid === uid;
    if (bagIndex >= 0) released.pearls.bag.splice(bagIndex, 1);
    else if (swallowed) released.pearls.swallowed = null;
    else assert.fail(`pearl ${uid} missing from baseline`);
    const unique = await store.loadUnique(uid), ordinal = 600 + request.pearls.indexOf(pearl) * 20 + cycle * 2;
    const ground = { x: 2, z: 3, availableAt: 10, returnAt: 100 };
    const release = await store.commitPearlGround({ operationId: deathOp(ordinal), uid, kind: pearl.kind,
      from: VICTIM, to: null, expectedVersion: unique.version, world: WORLD, ground,
      profiles: [{ id: VICTIM, expectedVersion: before.version, data: released }] });
    assert.equal(release.ok, true, 'release one generation');
    const current = await store.loadProfile(VICTIM), restored = clone(current.data);
    if (swallowed) restored.pearls.swallowed = { uid, kind: pearl.kind };
    else restored.pearls.bag.splice(bagIndex, 0, { uid, kind: pearl.kind });
    const reacquire = await store.commitPearlGround({ operationId: deathOp(ordinal + 1), uid, kind: pearl.kind,
      from: null, to: VICTIM, expectedVersion: unique.version + 1, world: WORLD, ground: null,
      profiles: [{ id: VICTIM, expectedVersion: current.version, data: restored }] });
    assert.equal(reacquire.ok, true, 'reacquire at the next generation');
  }
  const final = await store.loadProfile(VICTIM);
  assert.deepEqual(final.data, request.profiles.find((p) => p.id === VICTIM).before);
  pearl.expectedVersion = (await store.loadUnique(uid)).version;
  request.profiles.find((p) => p.id === VICTIM).expectedVersion = final.version;
}

export async function deathContract(t, setup) {
  for (const scenario of [
    ['exterior with zero pearls and no drops', { pearlCount: 0 }],
    ['exterior bag spill and pearls', { pearlCount: 3, loot: true }],
    ['Cala starter kit, worn gear, potions and PK', { lawless: true, killer: true, pearlCount: 2, loot: true }],
    ['Cala full pearl capacity', { lawless: true, pearlCount: 9 }],
  ]) await t.test(scenario[0], async () => {
    const f = makeDeath(scenario[1]), { request } = planRequest(f), db = await setup();
    try {
      await seedDeathStore(db.store, f, request);
      if (scenario[1].pearlCount === 9) {
        await advancePearlGeneration(db.store, request, request.pearls[0].uid, 1);
        await advancePearlGeneration(db.store, request, request.pearls[1].uid, 2);
      }
      const expected = deathResult(request, request.operationId);
      assert.deepEqual(await db.store.commitDeath(request), expected);
      const { operationId: _operationId, ...receiptRequest } = request;
      assert.deepEqual(await db.store.loadDeathOperation(request.operationId), { request: receiptRequest, result: expected });
      for (const p of request.profiles) {
        const row = await db.store.loadProfile(p.id);
        assert.equal(row.version, p.expectedVersion + 1); assert.deepEqual(row.data, p.data);
      }
      for (const q of request.pearls) {
        assert.deepEqual(await db.store.loadUnique(q.uid), { kind: `pearl:${q.kind}`, holder: null, version: q.expectedVersion + 1 });
        assert.deepEqual(await db.store.loadPearlLocation(q.uid), { world: WORLD, ground: q.ground, version: q.expectedVersion + 1 });
      }
      assert.deepEqual(await db.store.listDeathDrops(WORLD), expected.drops);
      assert.deepEqual(await db.store.commitDeath(request), { ...expected, replay: true });
    } finally { await db.close?.(); }
  });
}
