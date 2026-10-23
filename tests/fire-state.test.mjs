import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_KIND_SECONDS, FIRE_MAX_SLOTS, FIRE_SECONDS } from '../src/data/fire.js';
import { changeFireSlot, fireRows, newFire, projectFireStatus, readFire, remainingFire } from '../src/sim/economy/fire.js';

const apply = (state, key, command, now) => changeFireSlot(state, key, command, now);

test('central durations define one loaded unit for each private fire kind', () => {
  assert.deepEqual(FIRE_SECONDS, {
    handTorch: 1200, lantern: 3600, torchFloor: 3600, torchWall: 3600, campfire: 1800, grill: 1800,
  });
  assert.equal(FIRE_MAX_SLOTS, 601);
  assert.equal(FIRE_KIND_SECONDS, FIRE_SECONDS);
});

test('legacy omission reads as empty while malformed and future versions fail closed', () => {
  assert.deepEqual(readFire(undefined), newFire());
  assert.throws(() => readFire(null), /fire state/);
  assert.throws(() => readFire({ v: 2, rev: 0, slots: {} }), /fire state/);
  assert.throws(() => readFire({ v: 1, rev: 0, slots: { hand: { kind: 'handTorch', seconds: 1201, since: 0, lit: false } } }), /fire state/);
});

test('load is one unit, refuses occupied slots, and does not extract wood automatically', () => {
  let result = apply(newFire(), 'hand', { op: 'load', kind: 'handTorch' }, 10);
  assert.equal(result.why, '');
  assert.deepEqual(result.state.slots.hand, { kind: 'handTorch', seconds: 1200, since: 0, lit: false });
  assert.equal(result.state.rev, 1);
  result = apply(result.state, 'hand', { op: 'load', kind: 'handTorch' }, 10);
  assert.equal(result.why, 'occupied');
  assert.equal(result.state.rev, 1);
});

test('active-time countdown floors, pauses cleanly, and resumes without free fuel', () => {
  let state = apply(newFire(), 'hand', { op: 'load', kind: 'handTorch' }, 0).state;
  state = apply(state, 'hand', { op: 'set', lit: true }, 100).state;
  assert.equal(remainingFire(state.slots.hand, 100), 1200);
  assert.equal(remainingFire(state.slots.hand, 100.4), 1199);
  state = apply(state, 'hand', { op: 'set', lit: false }, 400.25).state;
  assert.deepEqual(state.slots.hand, { kind: 'handTorch', seconds: 899, since: 0, lit: false });
  state = apply(state, 'hand', { op: 'set', lit: true }, 900).state;
  assert.deepEqual(state.slots.hand, { kind: 'handTorch', seconds: 899, since: 900, lit: true });
  assert.equal(remainingFire(state.slots.hand, 900), 899);
  assert.equal(remainingFire(state.slots.hand, 901.1), 897);
});

test('an exhausted flame cannot relight; loading then creates a fresh unlit unit', () => {
  let state = apply(newFire(), 'hand', { op: 'load', kind: 'handTorch' }, 0).state;
  state = apply(state, 'hand', { op: 'set', lit: true }, 5).state;
  assert.equal(remainingFire(state.slots.hand, 1205), 0);
  assert.equal(fireRows(state, 1205)[0].lit, false);
  const denied = apply(state, 'hand', { op: 'set', lit: true }, 1205);
  assert.equal(denied.why, 'empty');
  const loaded = apply(state, 'hand', { op: 'load', kind: 'handTorch' }, 1205);
  assert.equal(loaded.why, '');
  assert.equal(loaded.state.slots.hand.lit, false);
  assert.equal(loaded.state.slots.hand.seconds, FIRE_SECONDS.handTorch);
});

test('stable composite keys are bounded, detached, and prototype-safe', () => {
  const key = JSON.stringify(['ship:1', 'p_22']);
  const loaded = apply(newFire(), key, { op: 'load', kind: 'torchWall' }, 0);
  assert.equal(loaded.why, '');
  const status = projectFireStatus(loaded.state, 0);
  status[0].seconds = 0;
  assert.equal(loaded.state.slots[key].seconds, 3600);
  assert.equal(apply(loaded.state, '__proto__', { op: 'load', kind: 'campfire' }, 0).why, 'slot');
  assert.equal(apply(loaded.state, '[]', { op: 'load', kind: 'campfire' }, 0).why, 'slot');
  const raw = { v: 1, rev: 0, slots: Object.fromEntries(Array.from({ length: FIRE_MAX_SLOTS + 1 }, (_, i) => [
    JSON.stringify(['s', `p${i}`]), { kind: 'torchFloor', seconds: 100, since: 0, lit: false },
  ])) };
  assert.throws(() => readFire(raw), /fire slots/);
});

test('invalid clocks and timestamps from the future fail instead of using wall time', () => {
  const lit = { kind: 'lantern', seconds: 3000, since: 900, lit: true };
  assert.throws(() => remainingFire(lit, 899), /fire clock precedes state/);
  assert.throws(() => remainingFire(lit, NaN), /fire clock/);
  assert.throws(() => projectFireStatus({ v: 1, rev: 0, slots: { hand: lit } }, 899), /fire clock precedes state/);
  const originalNow = Date.now;
  Date.now = () => { throw new Error('wall clock read'); };
  try { assert.equal(remainingFire(lit, 901), 2999); }
  finally { Date.now = originalNow; }
});

test('same command replay is effect-free and revision limits refuse mutations', () => {
  const loaded = apply(newFire(), 'hand', { op: 'load', kind: 'handTorch' }, 0).state;
  const replay = apply(loaded, 'hand', { op: 'load', kind: 'handTorch' }, 0);
  assert.equal(replay.why, 'occupied');
  assert.equal(replay.state.rev, loaded.rev);
  const maxed = { ...loaded, rev: 2147483646 };
  const result = apply(maxed, 'hand', { op: 'set', lit: true }, 1);
  assert.equal(result.why, 'revisionLimit');
  assert.equal(result.state.rev, maxed.rev);
});
