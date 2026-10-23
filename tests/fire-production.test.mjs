import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newHold, load } from '../src/sim/economy/cargo.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { newFire, changeFireSlot, remainingFire } from '../src/sim/economy/fire.js';
import { productionKey, productionRows, stepRaftProduction } from '../src/sim/economy/raftProduction.js';
import { poweredFireKeys } from '../src/sim/systems/fire.js';

const owner = 7, shipId = 'fuel-test-raft', fixtureId = 'grill-fixture';
const grill = ['grill', 2, 0, 0, 0];
const workKey = productionKey(grill);
const fireSlotKey = JSON.stringify([shipId, fixtureId]);

function rig({ lit = false, hours = 0, progress = 0.375 } = {}) {
  const raft = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0], grill]);
  raft.work[workKey] = progress;
  const hold = newHold(100);
  assert.equal(load(hold, 'pescado', 10), true);
  assert.equal(load(hold, 'madera', 1), true);
  const loaded = changeFireSlot(newFire(), fireSlotKey,
    { op: 'load', lit, kind: 'grill' }, 0);
  assert.equal(loaded.why, '');
  const source = { owner, ship: { id: shipId }, condition: { entries: [{ id: fixtureId, part: grill, hp: 30 }] } };
  const world = { fireEnabled: true, economy: { hours }, profiles: new Map([[owner, { fire: loaded.state }]]) };
  return { raft, hold, source, world, fire: loaded.state };
}

test('unlit grill reports fuel and preserves recipe progress and ingredients', () => {
  const { raft, hold, source, world } = rig();
  const before = structuredClone({ work: raft.work, goods: hold.goods });
  const poweredKeys = poweredFireKeys(world, source);

  assert.equal(poweredKeys.has(workKey), false);
  assert.equal(productionRows(raft, hold, { poweredKeys })[0].status, 'fuel');
  assert.deepEqual(stepRaftProduction(raft, hold, 0.4, { poweredKeys }),
    { made: {}, used: {}, changed: false });
  assert.deepEqual({ work: raft.work, goods: hold.goods }, before);
});

test('expired grill fuel stops production without losing partial work or consuming fish', () => {
  const { raft, hold, source, world } = rig({ lit: true, hours: 45 });
  const poweredKeys = poweredFireKeys(world, source);

  assert.equal(poweredKeys.has(workKey), false, '45 game hours is exactly the grill fuel duration');
  assert.equal(productionRows(raft, hold, { poweredKeys })[0].status, 'fuel');
  assert.deepEqual(stepRaftProduction(raft, hold, 0.4, { poweredKeys }),
    { made: {}, used: {}, changed: false });
  assert.equal(raft.work[workKey], 0.375);
  assert.equal(hold.goods.pescado, 10);
});

test('a lit grill resumes saved work and production does not debit another fire unit', () => {
  const { raft, hold, source, world, fire } = rig({ lit: true });
  const poweredKeys = poweredFireKeys(world, source);
  const fuelBefore = remainingFire(fire.slots[fireSlotKey], world.economy.hours * 40);

  assert.equal(poweredKeys.has(workKey), true);
  assert.equal(productionRows(raft, hold, { poweredKeys })[0].status, 'working');
  assert.deepEqual(stepRaftProduction(raft, hold, 0.12083333333333333, { poweredKeys }),
    { made: { galleta: 2 }, used: { pescado: 2 }, changed: true });
  assert.ok(Math.abs(raft.work[workKey] - 0.1) < 1e-12, 'partial progress resumes from 0.375');
  assert.equal(hold.goods.pescado, 8);
  assert.equal(hold.goods.galleta, 2);
  assert.equal(hold.goods.madera, 1, 'production does not consume extra wood');
  assert.equal(remainingFire(fire.slots[fireSlotKey], world.economy.hours * 40), fuelBefore,
    'production consumes only the fuel already loaded into its fixture');
});
