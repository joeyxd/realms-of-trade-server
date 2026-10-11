import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newHold, load } from '../src/sim/economy/cargo.js';
import { canPlace, newRaft, sanitizeRaft } from '../src/sim/economy/raft.js';
import {
  MAX_PRODUCTION_DAYS_PER_STEP, PRODUCTION_PARTS, productionKey, productionRows,
  sanitizeProduction, stepRaftProduction,
} from '../src/sim/economy/raftProduction.js';

function chainRaft({ nets = 1, grills = 1 } = {}) {
  const pieces = [...STARTER_RAFT];
  for (let x = 2; x < 2 + nets + grills; x++) pieces.push(['foundation', x, 0, 0, 0]);
  for (let i = 0; i < nets; i++) pieces.push(['net', 2 + i, 0, 0, 0]);
  for (let i = 0; i < grills; i++) pieces.push(['grill', 2 + nets + i, 0, 0, 0]);
  return newRaft(pieces);
}

test('the selected chain produces fish and biscuits at the authored rates', () => {
  assert.deepEqual(PRODUCTION_PARTS, ['net', 'grill', 'purifier']);
  const raft = chainRaft();
  const hold = newHold(100);
  const result = stepRaftProduction(raft, hold, 1);
  assert.deepEqual(result, { made: { pescado: 6, galleta: 6 }, used: { pescado: 6 }, changed: true });
  assert.equal(hold.goods.pescado, undefined);
  assert.equal(hold.goods.galleta, 6);
  assert.deepEqual(raft.work, {});
});

test('identical modules keep independent tuple identities and reorder keeps their fractions', () => {
  const raft = chainRaft({ nets: 2, grills: 1 });
  const netA = raft.parts.find((p) => p[0] === 'net');
  const netB = raft.parts.filter((p) => p[0] === 'net')[1];
  const keyA = productionKey(netA), keyB = productionKey(netB);
  assert.notEqual(keyA, keyB);
  raft.work[keyA] = 0.25; raft.work[keyB] = 0.75;
  const production = raft.parts.filter((p) => p[0] === 'net' || p[0] === 'grill');
  raft.parts = [...raft.parts.filter((p) => p[0] !== 'net' && p[0] !== 'grill'), ...production.reverse()];
  const restored = sanitizeRaft({ parts: raft.parts, work: raft.work });
  assert.equal(restored.work[keyA], 0.25);
  assert.equal(restored.work[keyB], 0.75);
});

test('whole lots preflight post-input capacity and never consume ingredients on a blocked output', () => {
  const grillOnly = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0], ['grill', 2, 0, 0]]);
  const hold = newHold(2);
  assert.equal(load(hold, 'pescado', 2), true);
  const result = stepRaftProduction(grillOnly, hold, 1 / 6);
  assert.deepEqual(result, { made: { galleta: 2 }, used: { pescado: 2 }, changed: true });
  assert.equal(hold.goods.galleta, 2);
  assert.equal(hold.goods.pescado, undefined);

  const netOnly = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0], ['net', 2, 0, 0]]);
  const full = newHold(0);
  netOnly.work[productionKey(netOnly.parts.find((p) => p[0] === 'net'))] = 0.4;
  const blocked = stepRaftProduction(netOnly, full, 0.5);
  assert.deepEqual(blocked, { made: {}, used: {}, changed: false });
  assert.equal(Object.values(netOnly.work)[0], 0.4);
  assert.equal(productionRows(netOnly, full)[0].status, 'room');
});

test('missing inputs freeze fractional work and stopped rows have no time estimate', () => {
  const raft = chainRaft({ nets: 0, grills: 1 });
  const grill = raft.parts.find((p) => p[0] === 'grill'), key = productionKey(grill);
  raft.work[key] = 0.375;
  const hold = newHold(30);
  const result = stepRaftProduction(raft, hold, 0.5);
  assert.deepEqual(result, { made: {}, used: {}, changed: false });
  const row = productionRows(raft, hold)[0];
  assert.equal(row.status, 'inputs');
  assert.equal(row.progress, 0.375);
  assert.equal(row.remainingDays, null);
  assert.equal(productionRows(raft, hold, { blocked: 'saveSize' })[0].status, 'saveSize');
  assert.equal(productionRows(raft, hold, { blocked: 'revisionLimit' })[0].status, 'revisionLimit');
});

test('sanitization keeps only bounded fractions for extant net and grill tuple keys', () => {
  const raft = chainRaft({ nets: 1, grills: 1 });
  const netKey = productionKey(raft.parts.find((p) => p[0] === 'net'));
  const grillKey = productionKey(raft.parts.find((p) => p[0] === 'grill'));
  const raw = { [netKey]: 0.2, [grillKey]: 0.9, '#0': 0.5, missing: 0.3,
    badLow: -0.1, badHigh: 1, badNan: NaN, badString: '0.5' };
  Object.defineProperty(raw, '__proto__', { value: 0.7, enumerable: true });
  assert.deepEqual(sanitizeProduction(raft.parts, raw), { [netKey]: 0.2, [grillKey]: 0.9 });
  const removed = sanitizeRaft({ parts: raft.parts.filter((p) => p[0] !== 'net'), work: raw });
  assert.equal(Object.hasOwn(removed.work, netKey), false);
  assert.deepEqual(newRaft().work, {});
  assert.deepEqual(sanitizeRaft(null).work, {});
});

test('production rows are detached views with rate, recipe, progress, and remaining time', () => {
  const raft = chainRaft();
  const netKey = productionKey(raft.parts.find((p) => p[0] === 'net'));
  raft.work[netKey] = 0.5;
  const rows = productionRows(raft, newHold(100));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { key: netKey, part: 'net', name: 'Red de pesca', rate: 6,
    inputs: {}, outputs: { pescado: 1 }, progress: 0.5, status: 'working', remainingDays: 1 / 12 });
  rows[0].outputs.pescado = 99;
  assert.equal(raft.parts.some((p) => p[0] === 'net'), true);
  assert.deepEqual(productionRows(raft, newHold(100))[0].outputs, { pescado: 1 });
});

test('invalid and oversized time is guarded, capped, and deterministic', () => {
  const left = chainRaft({ nets: 1, grills: 0 }), right = structuredClone(left);
  const holdA = newHold(100), holdB = newHold(100);
  const before = structuredClone({ left, holdA });
  assert.equal(stepRaftProduction(left, holdA, Infinity).changed, false);
  assert.equal(stepRaftProduction(left, holdA, -1).changed, false);
  assert.deepEqual({ left, holdA }, before);
  assert.equal(MAX_PRODUCTION_DAYS_PER_STEP, 1);
  const a = stepRaftProduction(left, holdA, 100);
  const b = stepRaftProduction(right, holdB, MAX_PRODUCTION_DAYS_PER_STEP);
  assert.deepEqual(a, b);
  assert.deepEqual(left, right);
  assert.deepEqual(holdA, holdB);
  assert.equal(holdA.goods.pescado, 6, 'time past the documented one-day cap is not banked');
});

test('nets can only be placed on the ground-level rim', () => {
  assert.equal(canPlace([], ['net', 0, 0, 1, 0]), 'level');
  const raft = chainRaft({ nets: 1, grills: 0 });
  const upperNet = sanitizeRaft({ parts: [...raft.parts, ['floor', 2, 0, 1, 0], ['net', 2, 0, 1, 0]] });
  assert.equal(upperNet.parts.some((p) => p[0] === 'net' && p[3] !== 0), false);
});
