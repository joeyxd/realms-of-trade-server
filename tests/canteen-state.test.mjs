import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESHWATER, isCanteenCommand, readVessels, validProfileVessels, vesselsMass, vesselsVolume } from '../src/data/freshwater.js';
import { checkedFreshwaterCommand, freshwaterProfileDelta } from '../src/sim/economy/waterContainers.js';
import { sanitizeHold } from '../src/sim/economy/cargo.js';

const command = (p, over = {}) => ({ type: 'freshwater', opId: `op-${p.eco.tradeRev + 1}`, expectedRev: p.eco.tradeRev,
  source: '', ship: '', part: '', n: 0, ...over });
const profile = (goods = {}, extra = {}) => ({
  ...extra,
  eco: { tradeRev: 0, pack: { cap: 30, maxMass: 100, goods: { ...goods }, vessels: [] }, ships: [{ kind: 'raft', id: 'raft-a', rev: 4,
    grid: { parts: [['waterBarrel', 0, 0, 0, 0]] },
    condition: { entries: [['p1', 'waterBarrel', 0, 0, 0, 0, 100]] },
    hold: { cap: 30, goods: {}, vessels: [] } }] },
});
const run = (p, over) => freshwaterProfileDelta(p, command(p, over));
const success = (result) => { assert.equal(result.why, ''); return result.profile; };

test('canteen vessel data is strict, bounded, and counted in cargo', () => {
  assert.equal(FRESHWATER.canteenCapacity, 3);
  assert.deepEqual(readVessels([{ id: 'canteen', kind: 'canteen', water: 2 }]), [{ id: 'canteen', kind: 'canteen', water: 2 }]);
  assert.throws(() => readVessels([{ id: 'canteen', kind: 'canteen', water: 4 }]));
  assert.throws(() => readVessels([{ id: 'canteen', kind: 'canteen', water: 0, extra: true }]));
  assert.throws(() => readVessels([{ id: 'canteen', kind: 'canteen', water: 0 }, { id: 'canteen', kind: 'canteen', water: 1 }]));
  const hold = { vessels: [{ id: 'canteen', kind: 'canteen', water: 2 }] };
  assert.equal(vesselsMass(hold), 2.5);
  assert.equal(vesselsVolume(hold), 1);
  assert.deepEqual(sanitizeHold({ cap: 10, goods: {}, vessels: hold.vessels }, 10, 10).vessels, hold.vessels);
  assert.throws(() => sanitizeHold({ cap: 10, goods: {}, vessels: [{ id: 'canteen', kind: 'canteen', water: 4 }] }, 10, 10));
});

test('canteen commands have exact shape and allow only documented sources and amounts', () => {
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'craftCanteen' })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'fillCanteen', source: FRESHWATER.sourceId, n: 3 })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'refillCanteen', source: 'bucket', n: 1 })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'refillCanteen', source: 'provisions', n: 1 })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'refillCanteen', source: 'barrel', ship: 'raft-a', part: 'p1', n: 1 })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'drink', n: 1 })));
  assert.ok(checkedFreshwaterCommand(command(profile(), { op: 'eat', source: 'fruta', n: 1 })));
  assert.equal(checkedFreshwaterCommand(command(profile(), { op: 'fillCanteen', source: FRESHWATER.sourceId, n: 4 })), null);
  assert.equal(checkedFreshwaterCommand(command(profile(), { op: 'drink', n: 2 })), null);
  assert.equal(checkedFreshwaterCommand(command(profile(), { op: 'eat', source: 'canteen', n: 1 })), null);
  assert.equal(checkedFreshwaterCommand(command(profile(), { op: 'refillCanteen', source: 'barrel', part: 'p1', n: 1 })), null);
  assert.equal(checkedFreshwaterCommand({ ...command(profile(), { op: 'drink', n: 1 }), extra: true }), null);
  assert.equal(isCanteenCommand(command(profile(), { op: 'drink', n: 1 })), true);
  assert.equal(isCanteenCommand(command(profile(), { op: 'fill', source: FRESHWATER.sourceId, n: 1 })), false);
  let getterCalled = false; const hostile = {};
  Object.defineProperty(hostile, 'op', { get() { getterCalled = true; return 'drink'; } });
  Object.defineProperty(hostile, 'type', { value: 'freshwater' });
  assert.equal(isCanteenCommand(hostile), false);
  assert.equal(getterCalled, false);
});

test('crafting and refilling preserves the existing bucket while transferring water exactly once', () => {
  let p = profile({ lona: 2, madera: 3, agua: 1 });
  p = success(run(p, { op: 'craftBucket' }));
  p = success(run(p, { op: 'craftCanteen' }));
  assert.deepEqual(p.eco.pack.vessels, [
    { id: 'bucket', kind: 'bucket', water: 0 }, { id: 'canteen', kind: 'canteen', water: 0 },
  ]);
  assert.equal(p.eco.pack.goods.lona, undefined);
  assert.equal(p.eco.pack.goods.madera, undefined);
  p = success(run(p, { op: 'fill', source: FRESHWATER.sourceId, n: 3 }));
  p = success(run(p, { op: 'refillCanteen', source: 'bucket', n: 2 }));
  assert.deepEqual(p.eco.pack.vessels.map((v) => v.water), [1, 2]);
  p = success(run(p, { op: 'refillCanteen', source: 'provisions', n: 1 }));
  assert.deepEqual(p.eco.pack.vessels.map((v) => v.water), [1, 3]);
  assert.equal(p.eco.pack.goods.agua, undefined);
  assert.equal(p.eco.tradeRev, 5);
  assert.equal(run(p, { op: 'refillCanteen', source: 'bucket', n: 1 }).why, 'full');
  assert.equal(run(profile({ lona: 2, madera: 1 }), { op: 'fillCanteen', source: FRESHWATER.sourceId, n: 1 }).why, 'empty');
  const noBucket = structuredClone(p); noBucket.eco.pack.vessels = noBucket.eco.pack.vessels.filter((v) => v.kind !== 'bucket'); noBucket.eco.pack.vessels[0].water = 0;
  assert.equal(run(noBucket, { op: 'refillCanteen', source: 'bucket', n: 1 }).why, 'empty');
});

test('barrel refill conserves water and advances the ship revision', () => {
  let p = profile({ lona: 2, madera: 1 });
  p = success(run(p, { op: 'craftCanteen' }));
  p.eco.ships[0].hold.vessels = [{ id: 'p1', kind: 'barrel', water: 3 }];
  p = success(run(p, { op: 'refillCanteen', source: 'barrel', ship: 'raft-a', part: 'p1', n: 2 }));
  assert.equal(p.eco.pack.vessels[0].water, 2);
  assert.equal(p.eco.ships[0].hold.vessels[0].water, 1);
  assert.equal(p.eco.ships[0].rev, 5);
  assert.equal(p.eco.tradeRev, 2);

  const before = profile({ lona: 2, madera: 1 });
  let baseline = success(run(before, { op: 'craftCanteen' }));
  baseline.eco.ships[0].hold.vessels = [{ id: 'p1', kind: 'barrel', water: 3 }];
  const revZero = structuredClone(baseline); revZero.eco.ships[0].rev = 0;
  assert.equal(run(revZero, { op: 'refillCanteen', source: 'barrel', ship: 'raft-a', part: 'p1', n: 1 }).why, 'revisionLimit');
  const broken = structuredClone(baseline); broken.eco.ships[0].condition.entries.find((r) => r[0] === 'p1')[6] = 0;
  assert.equal(run(broken, { op: 'refillCanteen', source: 'barrel', ship: 'raft-a', part: 'p1', n: 1 }).why, 'condition');
  const mismatched = structuredClone(baseline); mismatched.eco.ships[0].grid.parts.find((part) => part[0] === 'waterBarrel')[1] = 1;
  assert.equal(run(mismatched, { op: 'refillCanteen', source: 'barrel', ship: 'raft-a', part: 'p1', n: 1 }).why, 'command');
});

test('canteen-first crafting leaves legacy bucket operations and vessel order intact', () => {
  let p = profile({ lona: 2, madera: 3 });
  p = success(run(p, { op: 'craftCanteen' }));
  p = success(run(p, { op: 'craftBucket' }));
  p = success(run(p, { op: 'fill', source: FRESHWATER.sourceId, n: 2 }));
  p = success(run(p, { op: 'decant', n: 1 }));
  assert.deepEqual(p.eco.pack.vessels, [
    { id: 'canteen', kind: 'canteen', water: 0 }, { id: 'bucket', kind: 'bucket', water: 1 },
  ]);
  assert.equal(p.eco.pack.goods.agua, 1);
});

test('drink consumes one unit, clamps hydration, rejects full or empty state, and checks revisions', () => {
  let p = profile({ lona: 2, madera: 1 });
  p = success(run(p, { op: 'craftCanteen' }));
  p = success(run(p, { op: 'fillCanteen', source: FRESHWATER.sourceId, n: 3 }));
  p.surv = { v: 1, sat: 100, hyd: 61 };
  const consumed = success(run(p, { op: 'drink', n: 1 }));
  assert.equal(consumed.surv.hyd, 100);
  assert.equal(consumed.eco.pack.vessels[0].water, 2);
  assert.equal(run(consumed, { op: 'drink', n: 1 }).why, 'full');
  const stale = freshwaterProfileDelta(consumed, command(p, { op: 'drink', n: 1 }));
  assert.equal(stale.why, 'revision');
  assert.equal(run({ ...p, surv: { v: 1, sat: 100, hyd: 100 }, eco: { ...p.eco, pack: { ...p.eco.pack, vessels: [{ id: 'canteen', kind: 'canteen', water: 1 }] } } }, { op: 'drink', n: 1 }).why, 'full');
  assert.equal(run({ ...p, eco: { ...p.eco, pack: { ...p.eco.pack, vessels: [{ id: 'canteen', kind: 'canteen', water: 0 }] } }, surv: { v: 1, sat: 50, hyd: 50 } }, { op: 'drink', n: 1 }).why, 'empty');
  assert.equal(run({ ...p, surv: { v: 2, sat: 50, hyd: 50 } }, { op: 'drink', n: 1 }).why, 'command');
  const fractional = { ...p, surv: { v: 1, sat: 50.01, hyd: 50.01 } };
  assert.equal(success(run(fractional, { op: 'drink', n: 1 })).surv.hyd, 90.01);
});

test('eating consumes one existing food and restores the profile meters without healing', () => {
  const p = profile({ fruta: 1 }); p.surv = { v: 1, sat: 95, hyd: 95 }; p.hp = 20;
  const next = success(run(p, { op: 'eat', source: 'fruta', n: 1 }));
  assert.deepEqual(next.surv, { v: 1, sat: 100, hyd: 100 });
  assert.equal(next.eco.pack.goods.fruta, undefined);
  assert.equal(next.hp, 20);
  assert.equal(run(next, { op: 'eat', source: 'fruta', n: 1 }).why, 'empty');
  assert.equal(run({ ...next, eco: { ...next.eco, pack: { ...next.eco.pack, goods: { ron: 1 } } } }, { op: 'eat', source: 'ron', n: 1 }).why, 'full');
});
