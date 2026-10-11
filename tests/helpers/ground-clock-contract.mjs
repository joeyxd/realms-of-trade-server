import assert from 'node:assert/strict';
import { createMemoryStore } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { seedDeathDropScenario, expiryRequest, WORLD as DROP_WORLD } from './death-drop-storage.mjs';

export const CLOCK_WORLD = 'island:clock-test';
export const clockOp = (n) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const clockRequest = (operationId, patch = {}) => ({ operationId, world: CLOCK_WORLD,
  expectedVersion: 0, expectedTick: 0, tick: 1, ...patch });

export async function groundClockContract(t, setup = async () => ({ store: createMemoryStore() })) {
  await t.test('creates explicitly, advances monotonically with both CAS values, and keeps worlds independent', async () => {
    const f = await setup();
    try {
      const first = clockRequest(clockOp(1), { tick: 0 });
      const created = await f.store.commitGroundClock(first);
      assert.deepEqual(created, { ok: true, replay: false, clock: { world: first.world, tick: 0, version: 1, operationId: first.operationId } });
      const expectedClock = structuredClone(created.clock);
      created.clock.tick = 777;
      assert.deepEqual(await f.store.loadGroundClock(first.world), expectedClock);
      assert.deepEqual(await f.store.commitGroundClock(clockRequest(clockOp(2), { expectedVersion: 1, expectedTick: 1, tick: 2 })), { ok: false, why: 'conflict' });
      assert.deepEqual(await f.store.commitGroundClock(clockRequest(clockOp(3), { expectedVersion: 0, expectedTick: 0, tick: 3 })), { ok: false, why: 'conflict' });
      const advanced = await f.store.commitGroundClock(clockRequest(clockOp(4), { expectedVersion: 1, expectedTick: 0, tick: 5 }));
      assert.equal(advanced.clock.version, 2); assert.equal(advanced.clock.tick, 5);
      const other = clockRequest(clockOp(5), { world: 'island:other', tick: 9 });
      assert.equal((await f.store.commitGroundClock(other)).ok, true);
      assert.equal((await f.store.loadGroundClock(other.world)).tick, 9);
      assert.equal((await f.store.loadGroundClock(first.world)).tick, 5);
    } finally { await f.close?.(); }
  });

  await t.test('replays immutable UUID receipts after later advances and rejects identity changes', async () => {
    const f = await setup();
    try {
      const first = clockRequest(clockOp(10), { tick: 2 });
      const original = await f.store.commitGroundClock(first);
      await f.store.commitGroundClock(clockRequest(clockOp(11), { expectedVersion: 1, expectedTick: 2, tick: 3 }));
      assert.deepEqual(await f.store.commitGroundClock(first), { ...original, replay: true });
      assert.deepEqual(await f.store.loadGroundClockOperation(first.operationId), { request: { world: first.world, expectedVersion: 0, expectedTick: 0, tick: 2 }, result: original });
      for (const changed of [ { ...first, world: 'island:other' }, { ...first, tick: 4 } ])
        assert.deepEqual(await f.store.commitGroundClock(changed), { ok: false, why: 'operation' });
      await assert.rejects(f.store.commitGroundClock({ ...first, expectedTick: 1 }));
      assert.deepEqual(await f.store.commitGroundClock({ ...first, expectedVersion: 1, expectedTick: 2, tick: 3 }), { ok: false, why: 'operation' });
    } finally { await f.close?.(); }
  });

  await t.test('lost response recovers from receipt without a second advance', async () => {
    const f = await setup();
    try {
      const raw = clockRequest(clockOp(20), { tick: 7 });
      f.loseNextReply?.();
      await assert.rejects(f.store.commitGroundClock(raw));
      const receipt = await f.store.loadGroundClockOperation(raw.operationId);
      assert.equal(receipt.result.clock.tick, 7);
      assert.deepEqual(await f.store.commitGroundClock(raw), { ...receipt.result, replay: true });
      assert.equal((await f.store.loadGroundClock(raw.world)).version, 1);
    } finally { await f.close?.(); }
  });

  await t.test('rejects unsafe DTOs without mutation or callbacks and enforces numeric boundaries', async () => {
    const f = await setup();
    try {
      let callbacks = 0;
      const getter = {}; Object.defineProperty(getter, 'world', { enumerable: true, get() { callbacks++; throw Error('getter'); } });
      const proxy = new Proxy({}, { ownKeys() { callbacks++; throw Error('proxy'); } });
      for (const bad of [getter, proxy, null, [], { ...clockRequest('A1000000-0000-4000-8000-000000000001') },
        clockRequest(clockOp(31), { tick: -1 }), clockRequest(clockOp(32), { tick: 1.5 }),
        clockRequest(clockOp(33), { tick: Number.MAX_SAFE_INTEGER + 1 }), clockRequest(clockOp(34), { expectedVersion: 2147483647 })])
        await assert.rejects(f.store.commitGroundClock(bad));
      assert.equal(callbacks, 0);
      assert.equal(await f.store.loadGroundClock(CLOCK_WORLD), null);
      const max = clockRequest(clockOp(35), { tick: Number.MAX_SAFE_INTEGER });
      assert.equal((await f.store.commitGroundClock(max)).ok, true);
      const highBaseline = await f.store.commitGroundClock(clockRequest(clockOp(36), { world: 'island:max-version', expectedVersion: 2147483646, expectedTick: 0, tick: 1 }));
      assert.deepEqual(highBaseline, { ok: false, why: 'conflict' });
      await assert.rejects(f.store.commitGroundClock(clockRequest(clockOp(37), { world: 'island:max-version', expectedVersion: 2147483647, expectedTick: 1, tick: 2 })));
    } finally { await f.close?.(); }
  });

  await t.test('shares operation UUIDs with pearl intents in both directions', async () => {
    const f = await setup();
    try {
      const source = await seedDeathDropScenario(f.store, { sourceOperation: 1800 });
      const raw = await expiryRequest(source, { operation: 1801 });
      const journal = f.journal ? f.journal(DROP_WORLD) : createMemoryPearlJournals(f.store)(DROP_WORLD);
      const held = await journal.prepare('drop', raw);
      assert.equal(held.state, 'pending');
      assert.deepEqual(await f.store.commitGroundClock(clockRequest(raw.operationId, { world: 'island:intent-clock' })), { ok: false, why: 'operation' });

      const reverse = await expiryRequest(source, { operation: 1802 });
      assert.equal((await f.store.commitGroundClock(clockRequest(reverse.operationId, { world: 'island:receipt-clock' }))).ok, true);
      await assert.rejects(journal.prepare('drop', reverse), { code: 'operation' });
      assert.equal((await f.store.loadDeathDrop(source.itemDrop.operationId, source.itemDrop.ordinal)).state, 'ground');
    } finally { await f.close?.(); }
  });
}
