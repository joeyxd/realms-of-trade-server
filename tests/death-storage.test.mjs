import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { deathOperation, deathResult } from '../server/deathOperation.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { deathContract, makeDeath, planRequest, seedDeathStore, deathOp, VICTIM, KILLER, WORLD } from './helpers/death-storage.mjs';

test('memory stores whole death atomically, including zero-pearl deaths and durable drop pages', (t) =>
  deathContract(t, async () => ({ store: createMemoryStore() })));

test('victim and killer baselines are exact CAS inputs', async (t) => {
  for (const drift of ['victim', 'killer']) await t.test(drift, async () => {
    const f = makeDeath({ lawless: true, killer: true }), store = createMemoryStore();
    const { request } = planRequest(f, deathOp(20)); await seedDeathStore(store, f, request);
    const id = drift === 'victim' ? VICTIM : KILLER, row = await store.loadProfile(id), changed = structuredClone(row.data);
    changed.gold++;
    assert.equal((await store.saveProfile(id, changed, row.version)).ok, true);
    const before = { v: await store.loadProfile(VICTIM), k: await store.loadProfile(KILLER), drops: await store.listDeathDrops(WORLD) };
    assert.deepEqual(await store.commitDeath(request), { ok: false, why: 'conflict' });
    assert.deepEqual({ v: await store.loadProfile(VICTIM), k: await store.loadProfile(KILLER), drops: await store.listDeathDrops(WORLD) }, before);
    assert.equal(await store.loadDeathOperation(request.operationId), null);
  });
  for (const endpoint of [VICTIM, KILLER]) await t.test(`${endpoint}: same-version JSON mismatch`, async () => {
    const f = makeDeath({ lawless: true, killer: true }), store = createMemoryStore();
    const { request } = planRequest(f, deathOp(endpoint === VICTIM ? 21 : 22)); await seedDeathStore(store, f, request);
    const row = request.profiles.find((p) => p.id === endpoint);
    row.before.gold++; row.data.gold++;
    const before = { v: await store.loadProfile(VICTIM), k: await store.loadProfile(KILLER) };
    assert.deepEqual(await store.commitDeath(request), { ok: false, why: 'conflict' });
    assert.deepEqual({ v: await store.loadProfile(VICTIM), k: await store.loadProfile(KILLER) }, before);
  });
});

test('death request validation rejects malformed fields and arbitrary deltas before storage', async (t) => {
  const f = makeDeath({ lawless: true, killer: true, pearlCount: 2, loot: true }), store = createMemoryStore();
  const { request } = planRequest(f, deathOp(30)); await seedDeathStore(store, f, request);
  const cases = [
    ['extra root field', (r) => { r.extra = true; }],
    ['XP source baseline mismatch', (r) => { r.rules.xpBefore += 0.01; }],
    ['invalid loss fraction', (r) => { r.rules.xpLossFraction = 1.1; }],
    ['killer outside lawless zone', (r) => { r.rules.lawless = false; }],
    ['duplicate profile endpoint', (r) => { r.profiles[1].id = r.profiles[0].id; }],
    ['reordered profiles', (r) => { r.profiles.reverse(); }],
    ['changed victim gold', (r) => { r.profiles.find((p) => p.id === VICTIM).data.gold++; }],
    ['changed killer PK', (r) => { r.profiles.find((p) => p.id === KILLER).data.stats.pk++; }],
    ['dropped pearl omitted', (r) => { r.pearls.pop(); }],
    ['duplicate pearl UID', (r) => { r.pearls[1].uid = r.pearls[0].uid; }],
    ['skipped drop ordinal', (r) => { r.drops[0].ordinal++; }],
    ['item payload changed', (r) => { r.drops.find((d) => d.kind === 'item').item.u++; }],
    ['potion has item payload', (r) => { const d = r.drops.find((d) => d.kind === 'potion'); if (d) d.item = {}; else r.drops.push({ ordinal: r.drops.length + 1, kind: 'potion', item: {}, ground: r.drops[0].ground }); }],
    ['expired drop', (r) => { r.drops[0].ground.expiresAt = r.drops[0].ground.availableAt; }],
    ['negative pearl generation', (r) => { r.pearls[0].expectedVersion = 0; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const bad = structuredClone(request); mutate(bad);
    await assert.rejects(store.commitDeath(bad));
    assert.equal(await store.loadDeathOperation(request.operationId), null);
  });
});

test('receipt replay is exact and remains historical after later profile progress', async () => {
  const f = makeDeath({ lawless: true, killer: true, pearlCount: 3, loot: true }), store = createMemoryStore();
  const { request } = planRequest(f, deathOp(40)); await seedDeathStore(store, f, request);
  const expected = deathResult(request, request.operationId);
  assert.deepEqual(await store.commitDeath(request), expected);
  const after = await store.loadProfile(VICTIM), progressed = structuredClone(after.data); progressed.xp += 9;
  assert.equal((await store.saveProfile(VICTIM, progressed, after.version)).ok, true);
  const state = { profile: await store.loadProfile(VICTIM), drops: await store.listDeathDrops(WORLD) };
  assert.deepEqual(await store.commitDeath(request), { ...expected, replay: true });
  assert.deepEqual({ profile: await store.loadProfile(VICTIM), drops: await store.listDeathDrops(WORLD) }, state);
  const changed = structuredClone(request); changed.drops[0].ground.x += 1;
  assert.deepEqual(await store.commitDeath(changed), { ok: false, why: 'operation' });
});

test('bounded drop pages are ordered, scoped, and reject malformed cursors', async () => {
  const store = createMemoryStore(), f = makeDeath({ lawless: true, loot: true, seed: 52 });
  const { request } = planRequest(f, deathOp(52)); await seedDeathStore(store, f, request);
  assert.equal((await store.commitDeath(request)).ok, true);
  const all = await store.listDeathDrops(WORLD, { limit: 256 });
  assert.ok(all.length > 2);
  const first = await store.listDeathDrops(WORLD, { limit: 2 });
  const second = await store.listDeathDrops(WORLD, { limit: 256, after: { operationId: first.at(-1).operationId, ordinal: first.at(-1).ordinal } });
  assert.deepEqual([...first, ...second], all);
  assert.deepEqual(await store.listDeathDrops('another:world'), []);
  for (const options of [{ limit: 0 }, { after: { operationId: 'bad', ordinal: 1 } }, { extra: 1 }]) {
    await assert.rejects(store.listDeathDrops(WORLD, options));
  }
});

test('bound memory journal intents and prior receipt families reserve death operation IDs', async () => {
  const store = createMemoryStore(), journals = createMemoryPearlJournals(store), journal = journals(WORLD);
  const f = makeDeath(), { request } = planRequest(f, deathOp(60)); await seedDeathStore(store, f, request);
  const intent = { operationId: request.operationId, uid: 'intent-pearl', kind: 'brasa', from: null, to: VICTIM,
    expectedVersion: 0, profiles: [{ id: VICTIM, expectedVersion: 1, data: (await store.loadProfile(VICTIM)).data }] };
  await journal.prepare('pearl', intent);
  assert.deepEqual(await store.commitDeath(request), { ok: false, why: 'operation' });
  assert.equal(await store.loadDeathOperation(request.operationId), null);
  assert.equal(await store.loadProfile(VICTIM).then((p) => p.version), request.profiles[0].expectedVersion);
  // A committed death must also reserve its UUID against the older receipt API.
  const store2 = createMemoryStore(), free = makeDeath(), next = planRequest(free, deathOp(61)).request;
  await seedDeathStore(store2, free, next); assert.equal((await store2.commitDeath(next)).ok, true);
  const current = await store2.loadProfile(VICTIM), withPearl = structuredClone(current.data);
  withPearl.pearls.bag.push({ uid: 'death-collision-pearl', kind: 'brasa' });
  const endpoint = [{ id: VICTIM, expectedVersion: current.version, data: withPearl }];
  const transfer = { operationId: next.operationId, uid: 'death-collision-pearl', kind: 'brasa', from: null, to: VICTIM,
    expectedVersion: 0, profiles: endpoint };
  assert.deepEqual(await store2.commitPearl(transfer), { ok: false, why: 'operation' });
  const groundRequest = { ...transfer, world: WORLD, ground: null };
  assert.deepEqual(await store2.commitPearlGround(groundRequest), { ok: false, why: 'operation' });
  assert.deepEqual(await store2.commitPearlBatch({ operationId: next.operationId, world: WORLD, mode: 'death',
    profile: { id: VICTIM, expectedVersion: current.version, data: current.data },
    items: [{ uid: 'death-collision-pearl', kind: 'brasa', expectedVersion: 1,
      ground: { x: 1, z: 2, availableAt: 3, returnAt: 4 } }] }), { ok: false, why: 'operation' });
  const boundJournal = createMemoryPearlJournals(store2)(WORLD);
  await assert.rejects(boundJournal.prepare('pearl', transfer), { code: 'operation' });
});
