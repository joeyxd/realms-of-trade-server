import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newHold, load, unload } from '../src/sim/economy/cargo.js';
import { newRaft, sanitizeRaft } from '../src/sim/economy/raft.js';
import { productionKey, productionRows, stepRaftProduction } from '../src/sim/economy/raftProduction.js';

function purifierRaft(count = 1) {
  const parts = [...STARTER_RAFT];
  for (let i = 0; i < count; i++) {
    const x = 2 + i;
    parts.push(['foundation', x, 0, 0, 0], ['purifier', x, 0, 0, 0]);
  }
  return newRaft(parts);
}

test('purifier produces one water per 0.1 game day (96 simulation seconds)', () => {
  const raft = purifierRaft();
  const hold = newHold(100);
  const purifier = raft.parts.find(part => part[0] === 'purifier');
  const key = productionKey(purifier);

  assert.equal(productionRows(raft, hold)[0].rate, 10);
  assert.deepEqual(stepRaftProduction(raft, hold, 95 / 960), { made: {}, used: {}, changed: true });
  assert.ok(Math.abs(raft.work[key] - (95 / 96)) < 1e-12);
  assert.equal(hold.goods.agua, undefined);
  assert.deepEqual(stepRaftProduction(raft, hold, 1 / 960), { made: { agua: 1 }, used: {}, changed: true });
  assert.equal(hold.goods.agua, 1);
  assert.equal(Object.hasOwn(raft.work, key), false);
});

test('a full hold pauses at its saved fraction and resumes a whole water lot', () => {
  const raft = purifierRaft();
  const hold = newHold(1);
  const key = productionKey(raft.parts.find(part => part[0] === 'purifier'));

  assert.equal(stepRaftProduction(raft, hold, 0.05).changed, true);
  assert.equal(raft.work[key], 0.5);
  assert.equal(load(hold, 'agua', 1), true);
  assert.equal(stepRaftProduction(raft, hold, 0.2).changed, false);
  assert.equal(raft.work[key], 0.5);
  assert.equal(productionRows(raft, hold)[0].status, 'room');

  assert.equal(unload(hold, 'agua', 1), true);
  assert.deepEqual(stepRaftProduction(raft, hold, 0.05), { made: { agua: 1 }, used: {}, changed: true });
  assert.equal(hold.goods.agua, 1);
  assert.equal(Object.hasOwn(raft.work, key), false);
});

test('purifier fractions follow tuple identity across reorder and removal; modules progress independently', () => {
  const raft = purifierRaft(2);
  const [first, second] = raft.parts.filter(part => part[0] === 'purifier');
  const firstKey = productionKey(first), secondKey = productionKey(second);
  raft.work[firstKey] = 0.2;
  raft.work[secondKey] = 0.6;

  const purifiers = raft.parts.filter(part => part[0] === 'purifier').reverse();
  raft.parts = [...raft.parts.filter(part => part[0] !== 'purifier'), ...purifiers];
  const restored = sanitizeRaft({ parts: raft.parts, work: raft.work });
  assert.equal(restored.work[firstKey], 0.2);
  assert.equal(restored.work[secondKey], 0.6);

  const hold = newHold(100);
  assert.deepEqual(stepRaftProduction(restored, hold, 0.03), { made: {}, used: {}, changed: true });
  assert.ok(Math.abs(restored.work[firstKey] - 0.5) < 1e-12);
  assert.ok(Math.abs(restored.work[secondKey] - 0.9) < 1e-12);
  const removed = sanitizeRaft({ parts: restored.parts.filter(part => productionKey(part) !== firstKey), work: restored.work });
  assert.equal(Object.hasOwn(removed.work, firstKey), false);
  assert.ok(Math.abs(removed.work[secondKey] - 0.9) < 1e-12);
});

test('adding purifier production leaves net and grill rates, inputs, outputs, and lots unchanged', () => {
  const raft = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0, 0], ['net', 2, 0, 0, 0],
    ['foundation', 3, 0, 0, 0], ['grill', 3, 0, 0, 0]]);
  const hold = newHold(100);
  const rows = productionRows(raft, hold);
  assert.deepEqual(rows.map(({ part, rate, inputs, outputs }) => ({ part, rate, inputs, outputs })), [
    { part: 'net', rate: 6, inputs: {}, outputs: { pescado: 1 } },
    { part: 'grill', rate: 6, inputs: { pescado: 2 }, outputs: { galleta: 2 } },
  ]);
  assert.deepEqual(stepRaftProduction(raft, hold, 1), {
    made: { pescado: 6, galleta: 6 }, used: { pescado: 6 }, changed: true,
  });
  assert.equal(hold.goods.pescado, undefined);
  assert.equal(hold.goods.galleta, 6);
});

test('rows expose broken and voyage stops without changing saved work or cargo', () => {
  const raft = purifierRaft();
  const hold = newHold(100);
  const key = productionKey(raft.parts.find(part => part[0] === 'purifier'));
  raft.work[key] = 0.4;
  const before = structuredClone({ work: raft.work, goods: hold.goods });

  const broken = productionRows(raft, hold, { activeKeys: new Set() })[0];
  assert.equal(broken.status, 'broken');
  assert.equal(broken.progress, 0.4);
  assert.equal(broken.remainingDays, null);
  const voyage = productionRows(raft, hold, { blocked: 'voyage' })[0];
  assert.equal(voyage.status, 'voyage');
  assert.equal(voyage.progress, 0.4);
  assert.equal(voyage.remainingDays, null);
  assert.deepEqual({ work: raft.work, goods: hold.goods }, before);
});
