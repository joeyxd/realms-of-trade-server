import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorkshop, readWorkshop, workshopPlan, consumeStorageCredit, WorkshopError } from '../src/sim/systems/workshop.js';

const progression = (knowledge = [], v = 1) => ({ v, practice: { logging: 0 }, milestones: [], knowledge });
const profile = ({ wood = 10, tradeRev = 0, workshop, knowledge = [], progressionVersion = 1 } = {}) => ({
  lvl: 7, custom: { preserved: true }, progression: progression(knowledge, progressionVersion),
  eco: { tradeRev, pack: { cap: 50, goods: wood ? { madera: wood, piedra: 3 } : { piedra: 3 } }, ships: [] },
  ...(workshop === undefined ? {} : { workshop }),
});
const act = (p, command) => workshopPlan(p, { ...command, expectedRev: p.eco.tradeRev });
const rejects = (code, fn) => assert.throws(fn, e => e instanceof WorkshopError && e.code === code);

test('missing workshop is empty and present state must be exact safe data', () => {
  assert.deepEqual(readWorkshop(undefined), newWorkshop());
  for (const invalid of [null, { ...newWorkshop(), v: 2 }, { ...newWorkshop(), boards: 11 },
    { ...newWorkshop(), extra: true }, { ...newWorkshop(), crateKits: 100 },
    Object.defineProperty({}, 'v', { enumerable: true, get() { throw new Error('called'); } })]) {
    rejects('state', () => readWorkshop(invalid));
  }
});

test('partial board contributions debit only the pack and the exact final delivery teaches once', () => {
  let p = profile({ wood: 12 }), delivered = 0;
  for (const amount of [3, 3, 4]) {
    const result = act(p, { type: 'contribute', amount });
    p = result.profile;
    delivered += amount;
    assert.equal(p.eco.tradeRev, result.tradeRev);
    assert.equal(p.eco.pack.goods.madera, 12 - delivered);
  }
  assert.equal(p.workshop.boards, 10);
  assert.equal(p.workshop.storageCredit, true);
  assert.deepEqual(p.progression, progression(['raft_storage']));
  assert.equal(p.lvl, 7); assert.deepEqual(p.custom, { preserved: true });
  rejects('lessonKnown', () => act(p, { type: 'contribute', amount: 1 }));
  const consumed = consumeStorageCredit(p);
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.profile.workshop.storageCredit, false);
  assert.equal(consumeStorageCredit(consumed.profile).consumed, false);
});

test('v2 progression preserves all values; existing lesson migration completes without a credit', () => {
  const p = profile({ wood: 10, progressionVersion: 2, knowledge: ['raft_storage'] });
  const result = act(p, { type: 'craftCrate' });
  assert.equal(result.profile.workshop.boards, 10);
  assert.equal(result.profile.workshop.storageCredit, false);
  assert.deepEqual(result.profile.progression, progression(['raft_storage'], 2));
  assert.equal(result.taught, false);
  assert.equal(consumeStorageCredit(result.profile).consumed, false);
  rejects('lessonKnown', () => act(result.profile, { type: 'contribute', amount: 1 }));
});

test('insufficient pack materials, overdelivery, stale revision, and malformed input fail before mutation', () => {
  for (const [p, command, code] of [
    [profile({ wood: 2 }), { type: 'contribute', amount: 3, expectedRev: 0 }, 'goods'],
    [profile({ wood: 10, workshop: { ...newWorkshop(), boards: 9 } }), { type: 'contribute', amount: 2, expectedRev: 0 }, 'overflow'],
    [profile(), { type: 'contribute', amount: 1, expectedRev: 9 }, 'conflict'],
    [profile(), { type: 'contribute', amount: 0, expectedRev: 0 }, 'input'],
  ]) {
    const before = structuredClone(p);
    rejects(code, () => workshopPlan(p, command));
    assert.deepEqual(p, before);
  }
});

test('crate kits cost two pack boards, increment revision, and enforce the maximum', () => {
  const p = profile({ wood: 2 });
  const result = act(p, { type: 'craftCrate' });
  assert.equal(result.profile.workshop.crateKits, 1);
  assert.equal(result.profile.eco.pack.goods.madera, undefined);
  assert.equal(result.profile.eco.pack.goods.piedra, 3);
  assert.equal(result.profile.eco.tradeRev, 1);
  const full = profile({ wood: 2, workshop: { ...newWorkshop(), crateKits: 99 } });
  const before = structuredClone(full);
  rejects('limit', () => act(full, { type: 'craftCrate' }));
  assert.deepEqual(full, before);
});
