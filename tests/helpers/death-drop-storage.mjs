import assert from 'node:assert/strict';
import { makeDeath, planRequest, seedDeathStore, deathOp, VICTIM, KILLER, WORLD } from './death-storage.mjs';

const clone = structuredClone;

// Build expected profile deltas directly from the source and receiver snapshots.
// This intentionally does not call a production delta/DTO builder.
export function expectedPickupProfile(drop, before) {
  const data = clone(before);
  if (drop.kind === 'item') {
    const item = clone(drop.item);
    item.u = before.uid;
    data.bag.push(item);
    data.uid = before.uid + 1;
    data.stats.items = Math.min(1_000_000_000, before.stats.items + 1);
  } else {
    data.pot = Math.min(5, before.pot + 1);
  }
  return data;
}

export async function seedDeathDropScenario(store, { seed = 73, sourceOperation = 500, withKiller = true } = {}) {
  const f = makeDeath({ lawless: true, killer: withKiller, loot: true, seed });
  f.world.tick = 10;
  const { request } = planRequest(f, deathOp(sourceOperation));
  await seedDeathStore(store, f, request);
  const death = await store.commitDeath(request);
  assert.equal(death.ok, true, 'create the source death and its item/potion drops');
  const items = death.drops.filter((row) => row.kind === 'item');
  const potions = death.drops.filter((row) => row.kind === 'potion');
  assert.ok(items.length > 0);
  assert.ok(potions.length > 0);
  return { death, request, itemDrop: items[0], potionDrop: potions[0] };
}

export async function pickupRequest(store, source, { kind = 'item', operation = 800, at } = {}) {
  const sourceDrop = kind === 'potion' ? source.potionDrop : source.itemDrop;
  const current = await store.loadProfile(KILLER);
  const before = clone(current.data);
  const when = at ?? sourceDrop.ground.availableAt;
  return {
    operationId: deathOp(operation), world: sourceDrop.world, mode: 'pickup', at: when,
    drop: {
      operationId: sourceDrop.operationId, ordinal: sourceDrop.ordinal, expectedVersion: 1,
      world: sourceDrop.world, victim: sourceDrop.victim, kind: sourceDrop.kind,
      item: clone(sourceDrop.item), ground: clone(sourceDrop.ground),
    },
    profile: { id: KILLER, expectedVersion: current.version, before, data: expectedPickupProfile(sourceDrop, before) },
  };
}

export async function expiryRequest(source, { operation = 900, at } = {}) {
  const sourceDrop = source.itemDrop;
  return {
    operationId: deathOp(operation), world: sourceDrop.world, mode: 'expire',
    at: at ?? sourceDrop.ground.expiresAt + 1,
    drop: {
      operationId: sourceDrop.operationId, ordinal: sourceDrop.ordinal, expectedVersion: 1,
      world: sourceDrop.world, victim: sourceDrop.victim, kind: sourceDrop.kind,
      item: clone(sourceDrop.item), ground: clone(sourceDrop.ground),
    }, profile: null,
  };
}

export async function deathDropContract(t, setup) {
  await t.test('pickup preserves item fields, assigns receiver UID, replays progressively, and never resurrects', async () => {
    const db = await setup();
    try {
      const source = await seedDeathDropScenario(db.store);
      const raw = await pickupRequest(db.store, source);
      const expectedProfile = clone(raw.profile.data);
      const committed = await db.store.commitDeathDrop(raw);
      assert.equal(committed.ok, true);
      assert.equal(committed.replay, false);
      assert.deepEqual(committed.profiles, [{ id: KILLER, version: raw.profile.expectedVersion + 1 }]);
      assert.equal(committed.drop.state, 'picked');
      assert.equal(committed.drop.version, 2);
      assert.equal(committed.drop.holder, raw.profile.id);
      assert.equal(committed.drop.transitionOperationId, raw.operationId);
      assert.deepEqual((await db.store.loadProfile(KILLER)).data, expectedProfile);
      const { operationId: _operationId, ...receiptRequest } = raw;
      assert.deepEqual(await db.store.loadDeathDropOperation(raw.operationId), { request: receiptRequest, result: committed });

      const progress = await db.store.loadProfile(KILLER);
      const progressed = clone(progress.data); progressed.gold++;
      assert.equal((await db.store.saveProfile(KILLER, progressed, progress.version)).ok, true);
      const state = { profile: await db.store.loadProfile(KILLER), drop: await db.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
      assert.deepEqual(await db.store.commitDeathDrop(raw), { ...committed, replay: true });
      assert.deepEqual({ profile: await db.store.loadProfile(KILLER), drop: await db.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, state);
      assert.equal((await db.store.loadDeathDrop(source.death.drops[0].operationId, source.death.drops[0].ordinal)).state, 'picked');
      assert.equal((await db.store.listDeathDrops(WORLD)).length, source.death.drops.length, 'creation history remains complete');
    } finally { await db.close?.(); }
  });

  await t.test('potion pickup increments below five and a full potion slot rejects', async () => {
    const db = await setup();
    try {
      const source = await seedDeathDropScenario(db.store, { sourceOperation: 501 });
      const row = await db.store.loadProfile(KILLER), full = clone(row.data); full.pot = 5;
      assert.equal((await db.store.saveProfile(KILLER, full, row.version)).ok, true);
      const raw = await pickupRequest(db.store, source, { kind: 'potion', operation: 801 });
      const expected = clone(raw.profile.before);
      const beforeFull = { profile: await db.store.loadProfile(KILLER), drop: await db.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
      await assert.rejects(db.store.commitDeathDrop(raw));
      assert.deepEqual({ profile: await db.store.loadProfile(KILLER), drop: await db.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, beforeFull);

      const nextRow = await db.store.loadProfile(KILLER), atFour = clone(nextRow.data); atFour.pot = 4;
      assert.equal((await db.store.saveProfile(KILLER, atFour, nextRow.version)).ok, true);
      const secondPotion = source.death.drops.filter((row) => row.kind === 'potion')[1];
      source.potionDrop = secondPotion;
      const increments = await pickupRequest(db.store, source, { kind: 'potion', operation: 802 });
      assert.equal(increments.profile.data.pot, 5);
      assert.equal((await db.store.commitDeathDrop(increments)).ok, true);
      assert.equal((await db.store.loadProfile(KILLER)).data.pot, 5);
    } finally { await db.close?.(); }
  });

  await t.test('pickup and expiry obey inclusive pickup window and strict expiry boundary', async () => {
    const db = await setup();
    try {
      const source = await seedDeathDropScenario(db.store, { sourceOperation: 502 });
      const early = await pickupRequest(db.store, source, { operation: 802, at: source.itemDrop.ground.availableAt - 1 });
      assert.deepEqual(await db.store.commitDeathDrop(early), { ok: false, why: 'ownership' });
      const atExpiry = await pickupRequest(db.store, source, { operation: 803, at: source.itemDrop.ground.expiresAt });
      assert.equal((await db.store.commitDeathDrop(atExpiry)).ok, true);

      const expiryDb = await setup();
      try {
        const expSource = await seedDeathDropScenario(expiryDb.store, { sourceOperation: 503 });
        const exact = await expiryRequest(expSource, { operation: 901, at: expSource.itemDrop.ground.expiresAt });
        assert.deepEqual(await expiryDb.store.commitDeathDrop(exact), { ok: false, why: 'ownership' });
        const after = await expiryRequest(expSource, { operation: 902, at: expSource.itemDrop.ground.expiresAt + 1 });
        const expired = await expiryDb.store.commitDeathDrop(after);
        assert.equal(expired.ok, true);
        assert.equal(expired.drop.state, 'expired');
        assert.equal(expired.drop.version, 2);
        assert.equal(expired.drop.holder, null);
        const noResurrection = await pickupRequest(expiryDb.store, expSource, { operation: 804, at: after.at });
        assert.deepEqual(await expiryDb.store.commitDeathDrop(noResurrection), { ok: false, why: 'conflict' });
        assert.equal((await expiryDb.store.loadDeathDrop(after.drop.operationId, after.drop.ordinal)).state, 'expired');
      } finally { await expiryDb.close?.(); }
    } finally { await db.close?.(); }
  });
}

export { KILLER, VICTIM, WORLD, deathOp };
