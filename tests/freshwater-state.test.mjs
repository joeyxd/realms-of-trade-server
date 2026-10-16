import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESHWATER, readVessels, vesselsMass, vesselsVolume, validProfileVessels } from '../src/data/freshwater.js';
import { checkedFreshwaterCommand, freshwaterMutation, freshwaterProfileDelta } from '../src/sim/systems/freshwaterProfile.js';

const fresh = (over = {}) => ({ type: 'freshwater', opId: 'op-1', expectedRev: 0, source: '', ship: '', part: '', n: 0, ...over });
const profile = () => ({ gold: 5, eco: { tradeRev: 0, pack: { cap: 10, maxMass: 50, goods: { madera: 2 }, vessels: [] }, ships: [{ kind: 'raft', id: 'raft-a', rev: 3,
  grid: { parts: [['foundation', 0, 0, 0, 0], ['foundation', 1, 0, 0, 0], ['foundation', 0, 1, 0, 0], ['foundation', 1, 1, 0, 0], ['waterBarrel', 0, 0, 0, 0]] }, condition: { entries: [
    ['p2', 'foundation', 0, 0, 0, 0, 60], ['p3', 'foundation', 1, 0, 0, 0, 60], ['p4', 'foundation', 0, 1, 0, 0, 60], ['p5', 'foundation', 1, 1, 0, 0, 60], ['p1', 'waterBarrel', 0, 0, 0, 0, 100],
  ] },
  hold: { cap: 20, goods: {}, vessels: [] } }] } });
const run = (p, c) => freshwaterProfileDelta(p, fresh({ expectedRev: p.eco.tradeRev, ...c }));

test('vessel decoder is strict and missing legacy state stays empty', () => {
  assert.deepEqual(readVessels(), []);
  assert.throws(() => readVessels(null));
  assert.throws(() => readVessels([{ id: 'bucket', kind: 'bucket', water: 5 }]));
  assert.throws(() => readVessels([{ id: 'bucket', kind: 'bucket', water: 0, extra: 1 }]));
  assert.throws(() => readVessels([{ id: 'p12345678901', kind: 'barrel', water: 0 }]));
  assert.throws(() => readVessels(Array.from({ length: 33 }, (_, i) => ({ id: `p${i}`, kind: 'barrel', water: 0 }))));
  let getterCalled = false;
  const hostile = {}; Object.defineProperty(hostile, 'water', { enumerable: true, get() { getterCalled = true; return 0; } });
  Object.defineProperties(hostile, { id: { value: 'bucket', enumerable: true }, kind: { value: 'bucket', enumerable: true } });
  assert.throws(() => readVessels([hostile]));
  assert.equal(getterCalled, false);
  assert.deepEqual(readVessels([{ id: 'bucket', kind: 'bucket', water: 4 }, { id: 'p1', kind: 'barrel', water: 20 }]), [
    { id: 'bucket', kind: 'bucket', water: 4 }, { id: 'p1', kind: 'barrel', water: 20 },
  ]);
});

test('container mass and volume include the reusable bucket and its water', () => {
  const h = { vessels: [{ id: 'bucket', kind: 'bucket', water: 3 }, { id: 'p1', kind: 'barrel', water: 7 }] };
  assert.equal(vesselsMass(h), 11);
  assert.equal(vesselsVolume(h), 2);
});

test('commands have an exact bounded shape', () => {
  assert.ok(checkedFreshwaterCommand(fresh({ op: 'craftBucket' })));
  assert.equal(checkedFreshwaterCommand({ ...fresh({ op: 'craftBucket' }), extra: true }), null);
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'craftBucket', n: 1 })), null);
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'fill', source: '', n: 1 })), null);
  assert.ok(checkedFreshwaterCommand(fresh({ op: 'fill', source: 'salty-spring', n: 1 })));
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'fill', source: 'spring-1', n: 1 })), null);
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'fill', source: 'salty-spring', n: 5 })), null);
  assert.ok(checkedFreshwaterCommand(fresh({ op: 'deposit', ship: 'raft-a', part: 'p1', n: 1 })));
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'fill', source: 'spring-1', n: 1, expectedRev: FRESHWATER.maxRevision + 1 })), null);
  assert.equal(checkedFreshwaterCommand(fresh({ opId: 'bad:op', op: 'craftBucket' })), null);
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'deposit', ship: 'x'.repeat(121), part: 'p1', n: 1 })), null);
  assert.equal(checkedFreshwaterCommand(fresh({ op: 'deposit', ship: 'raft-a', part: 'p12345678901', n: 1 })), null);
  let getterCalled = false; const hostile = {};
  Object.defineProperty(hostile, 'op', { enumerable: true, get() { getterCalled = true; return 'craftBucket'; } });
  assert.equal(checkedFreshwaterCommand(hostile), null);
  assert.equal(getterCalled, false);
  assert.equal(freshwaterMutation(fresh({ op: 'craftBucket' })), true);
  assert.equal(freshwaterMutation({ type: 'raft', op: 'place', part: ['waterBarrel', 0, 0, 0, 0] }), true);
  assert.equal(freshwaterMutation({ type: 'raft', op: 'remove', id: 'waterBarrel' }), true);
  assert.equal(freshwaterMutation({ type: 'raft', op: 'place', part: ['storage', 0, 0, 0, 0] }), false);
  let mutationGetterCalled = false; const hostileMutation = {};
  Object.defineProperty(hostileMutation, 'type', { get() { mutationGetterCalled = true; return 'freshwater'; } });
  assert.equal(freshwaterMutation(hostileMutation), false);
  assert.equal(mutationGetterCalled, false);
});

test('craft, fill, deposit, withdraw and decant conserve water without mutating input', () => {
  const start = profile();
  const crafted = run(start, { op: 'craftBucket' });
  assert.equal(crafted.why, '');
  assert.equal(start.eco.pack.goods.madera, 2);
  assert.equal(crafted.profile.eco.pack.goods.madera, undefined);
  assert.equal(crafted.profile.eco.pack.vessels[0].water, 0);
  let p = crafted.profile;
  p = run(p, { op: 'fill', source: 'salty-spring', n: 4 }).profile;
  assert.equal(p.eco.pack.vessels[0].water, 4);
  p = run(p, { op: 'deposit', ship: 'raft-a', part: 'p1', n: 3 }).profile;
  assert.equal(p.eco.pack.vessels[0].water, 1);
  assert.deepEqual(p.eco.ships[0].hold.vessels, [{ id: 'p1', kind: 'barrel', water: 3 }]);
  p = run(p, { op: 'withdraw', ship: 'raft-a', part: 'p1', n: 2 }).profile;
  assert.equal(p.eco.pack.vessels[0].water, 3);
  assert.equal(p.eco.ships[0].hold.vessels[0].water, 1);
  p = run(p, { op: 'decant', n: 2 }).profile;
  assert.equal(p.eco.pack.vessels[0].water, 1);
  assert.equal(p.eco.pack.goods.agua, 2);
  assert.deepEqual([crafted.profile.eco.tradeRev, p.eco.tradeRev, p.eco.ships[0].rev], [1, 5, 5]);
});

test('full, empty, stale, owner, condition, room and revision-limit refusals are atomic', () => {
  const p0 = profile();
  assert.equal(run(p0, { op: 'fill', source: 'salty-spring', n: 1 }).why, 'empty');
  let p = run(p0, { op: 'craftBucket' }).profile;
  p = run(p, { op: 'fill', source: 'salty-spring', n: 4 }).profile;
  assert.equal(run(p, { op: 'fill', source: 'salty-spring', n: 1 }).why, 'full');
  assert.equal(freshwaterProfileDelta(p, fresh({ op: 'fill', source: 'salty-spring', n: 1 })).why, 'revision');
  assert.equal(run(p, { op: 'deposit', ship: 'other', part: 'p1', n: 1 }).why, 'owner');
  const broken = structuredClone(p); broken.eco.ships[0].condition.entries.find((r) => r[0] === 'p1')[6] = 0;
  assert.equal(run(broken, { op: 'deposit', ship: 'raft-a', part: 'p1', n: 1 }).why, 'condition');
  assert.equal(validProfileVessels({ eco: { ...broken.eco, pack: { ...broken.eco.pack, vessels: [] }, ships: [{ ...broken.eco.ships[0], hold: { goods: {}, vessels: [{ id: 'p1', kind: 'barrel', water: 8 }] } }] } }), true);
  const noRoom = structuredClone(p); noRoom.eco.pack.cap = 1;
  assert.equal(run(noRoom, { op: 'decant', n: 1 }).why, 'room');
  const limit = structuredClone(p); limit.eco.tradeRev = FRESHWATER.maxRevision;
  assert.equal(freshwaterProfileDelta(limit, fresh({ op: 'decant', n: 1, expectedRev: FRESHWATER.maxRevision })).why, 'revisionLimit');
  assert.equal(p.eco.tradeRev, 2);
  const noBucket = structuredClone(p); noBucket.eco.pack.vessels = [];
  assert.equal(run(noBucket, { op: 'withdraw', ship: 'raft-a', part: 'p1', n: 1 }).why, 'empty');
  const fullArray = structuredClone(p);
  const ship = fullArray.eco.ships[0];
  ship.hold.vessels.push({ id: 'p1', kind: 'barrel', water: 0 });
  for (let i = 10; i <= 40; i++) {
    const id = `p${i}`, x = i;
    ship.grid.parts.push(['waterBarrel', x, 0, 0, 0]);
    ship.condition.entries.push([id, 'waterBarrel', x, 0, 0, 0, 25]);
    ship.hold.vessels.push({ id, kind: 'barrel', water: 0 });
  }
  ship.grid.parts.push(['waterBarrel', 50, 0, 0, 0]);
  ship.condition.entries.push(['p50', 'waterBarrel', 50, 0, 0, 0, 25]);
  assert.equal(run(fullArray, { op: 'deposit', ship: 'raft-a', part: 'p50', n: 1 }).why, 'full');
});

test('profile vessel validation preserves valid broken barrel contents and rejects mismatched identities', () => {
  const p = profile();
  p.eco.pack.vessels = [{ id: 'bucket', kind: 'bucket', water: 0 }];
  p.eco.ships[0].hold.vessels = [{ id: 'p1', kind: 'barrel', water: 20 }];
  p.eco.ships[0].condition.entries[0][6] = 0;
  assert.equal(validProfileVessels(p), true);
  let getterCalled = false;
  const accessorProfile = structuredClone(p); delete accessorProfile.eco.pack.vessels;
  Object.defineProperty(accessorProfile.eco.pack, 'vessels', { enumerable: true, get() { getterCalled = true; return []; } });
  assert.equal(validProfileVessels(accessorProfile), false);
  assert.equal(getterCalled, false);
  p.eco.ships[0].hold.vessels[0].id = 'p2';
  assert.equal(validProfileVessels(p), false);
});
