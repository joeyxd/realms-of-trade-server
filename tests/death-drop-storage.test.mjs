import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { deathDropContract, seedDeathDropScenario, pickupRequest, expiryRequest, deathOp, KILLER, WORLD } from './helpers/death-drop-storage.mjs';
import { makeDeath, planRequest, seedDeathStore } from './helpers/death-storage.mjs';

test('memory death-drop contract', (t) => deathDropContract(t, async () => ({ store: createMemoryStore() })));

test('CAS, ownership, and pre-storage validation leave profile and current row atomic', async (t) => {
  await t.test('stale profile CAS reports conflict without changing the row', async () => {
    const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 510 });
    const raw = await pickupRequest(store, source, { operation: 810 });
    const loaded = await store.loadProfile(KILLER), changed = structuredClone(loaded.data); changed.gold++;
    assert.equal((await store.saveProfile(KILLER, changed, loaded.version)).ok, true);
    const before = { profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
    assert.deepEqual(await store.commitDeathDrop(raw), { ok: false, why: 'conflict' });
    assert.deepEqual({ profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, before);
    assert.equal(await store.loadDeathDropOperation(raw.operationId), null);
  });

  await t.test('world mismatch is an ownership result', async () => {
    const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 511 });
    const raw = await pickupRequest(store, source, { operation: 811 });
    const before = await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal);
    const invalid = structuredClone(raw); invalid.world = 'death:other'; invalid.drop.world = 'death:other';
    assert.deepEqual(await store.commitDeathDrop(invalid), { ok: false, why: 'ownership' });
    assert.deepEqual(await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal), before);
  });

  await t.test('schema and arbitrary profile deltas reject before storage', async () => {
    const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 512 });
    const raw = await pickupRequest(store, source, { operation: 812 });
    const before = { profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
    const badDelta = structuredClone(raw); badDelta.operationId = deathOp(813); badDelta.profile.data.gold++;
    await assert.rejects(store.commitDeathDrop(badDelta));
    const badShape = structuredClone(raw); badShape.operationId = deathOp(814); badShape.extra = true;
    await assert.rejects(store.commitDeathDrop(badShape));
    assert.deepEqual({ profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, before);
    assert.equal(await store.loadDeathDropOperation(deathOp(813)), null);
    assert.equal(await store.loadDeathDropOperation(deathOp(814)), null);
  });
});

test('operation IDs collide across new and old receipt families and journal intents', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 520 });
  const raw = await pickupRequest(store, source, { operation: 820 });
  assert.equal((await store.commitDeathDrop(raw)).ok, true);

  const oldDeath = structuredClone(source.request); oldDeath.operationId = raw.operationId;
  assert.deepEqual(await store.commitDeath(oldDeath), { ok: false, why: 'operation' });
  const current = await store.loadProfile(KILLER), withPearl = structuredClone(current.data);
  withPearl.pearls.bag.push({ uid: 'death-drop-collision-pearl', kind: 'brasa' });
  const transfer = { operationId: raw.operationId, uid: 'death-drop-collision-pearl', kind: 'brasa', from: null, to: KILLER,
    expectedVersion: 0, profiles: [{ id: KILLER, expectedVersion: current.version, data: withPearl }] };
  assert.deepEqual(await store.commitPearl(transfer), { ok: false, why: 'operation' });
  assert.deepEqual(await store.commitPearlGround({ ...transfer, world: WORLD, ground: null }), { ok: false, why: 'operation' });
  assert.deepEqual(await store.commitPearlBatch({ operationId: raw.operationId, world: WORLD, mode: 'death',
    profile: { id: KILLER, expectedVersion: current.version, data: current.data },
    items: [{ uid: 'death-drop-collision-pearl', kind: 'brasa', expectedVersion: 1,
      ground: { x: 1, z: 2, availableAt: 3, returnAt: 4 } }] }), { ok: false, why: 'operation' });
  const journal = createMemoryPearlJournals(store)(WORLD);
  await assert.rejects(journal.prepare('pearl', transfer), { code: 'operation' });
});

test('item pickup appends in order with the next receiver UID and enforces bag capacity', async (t) => {
  await t.test('a 23-item bag receives the drop as item 24', async () => {
    const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 525 });
    const row = await store.loadProfile(KILLER), before = structuredClone(row.data);
    for (let i = 0; i < 23; i++) {
      const item = structuredClone(source.itemDrop.item); item.u = before.uid + i; before.bag.push(item);
    }
    before.uid += 23;
    assert.equal((await store.saveProfile(KILLER, before, row.version)).ok, true);
    const raw = await pickupRequest(store, source, { operation: 825 });
    const reply = await store.commitDeathDrop(raw);
    assert.equal(reply.ok, true);
    const expected = structuredClone(before), taken = structuredClone(source.itemDrop.item);
    taken.u = before.uid; expected.bag.push(taken); expected.uid++; expected.stats.items++;
    assert.deepEqual((await store.loadProfile(KILLER)).data, expected);
    assert.equal(expected.bag.length, 24);
    assert.equal(expected.bag.at(-1).u, before.uid);
  });

  await t.test('a full bag rejects without changing its profile or drop', async () => {
    const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 526 });
    const row = await store.loadProfile(KILLER), full = structuredClone(row.data);
    for (let i = 0; i < 24; i++) {
      const item = structuredClone(source.itemDrop.item); item.u = full.uid + i; full.bag.push(item);
    }
    full.uid += 24;
    assert.equal((await store.saveProfile(KILLER, full, row.version)).ok, true);
    const raw = await pickupRequest(store, source, { operation: 826 });
    const before = { profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
    await assert.rejects(store.commitDeathDrop(raw));
    assert.deepEqual({ profile: await store.loadProfile(KILLER), drop: await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, before);
  });
});

test('current list pages are scoped, ordered, detached, and differ from creation history', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 530 });
  const initial = await store.listCurrentDeathDrops(WORLD, { limit: 256 });
  assert.equal(initial.length, source.death.drops.length);
  assert.ok(initial.length > 2);
  const first = await store.listCurrentDeathDrops(WORLD, { limit: 1 });
  const second = await store.listCurrentDeathDrops(WORLD, { after: { operationId: first[0].operationId, ordinal: first[0].ordinal }, limit: 1 });
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.ok(first[0].operationId < second[0].operationId ||
    (first[0].operationId === second[0].operationId && first[0].ordinal < second[0].ordinal));
  assert.deepEqual(await store.listCurrentDeathDrops('death:other'), []);
  first[0].item.u = -100;
  assert.notEqual((await store.loadDeathDrop(first[0].operationId, first[0].ordinal)).item.u, -100);

  const pickup = await pickupRequest(store, source, { operation: 831 });
  assert.equal((await store.commitDeathDrop(pickup)).ok, true);
  assert.equal((await store.listCurrentDeathDrops(WORLD, { limit: 256 })).length, initial.length - 1);
  assert.equal((await store.listDeathDrops(WORLD)).length, initial.length, 'history retains creation rows');
  await assert.rejects(store.listCurrentDeathDrops(WORLD, { limit: 0 }));
  await assert.rejects(store.listCurrentDeathDrops(WORLD, { after: { operationId: 'bad', ordinal: 1 } }));
});

test('expiry writes no profile and remains terminal against pickup', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store, { sourceOperation: 540 });
  const before = await store.loadProfile(KILLER), request = await expiryRequest(source, { operation: 940 });
  const result = await store.commitDeathDrop(request);
  assert.equal(result.ok, true); assert.deepEqual(result.profiles, []);
  assert.equal(result.drop.state, 'expired');
  assert.equal(result.drop.transitionOperationId, request.operationId);
  assert.deepEqual(await store.loadProfile(KILLER), before);
  const pickup = await pickupRequest(store, source, { operation: 841, at: request.at });
  assert.deepEqual(await store.commitDeathDrop(pickup), { ok: false, why: 'conflict' });
});
