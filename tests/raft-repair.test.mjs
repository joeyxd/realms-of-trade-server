import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { RAFT_PARTS, STARTER_RAFT } from '../src/data/raftparts.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { load, roomFor } from '../src/sim/economy/cargo.js';
import { raftCmd } from '../src/sim/systems/raftEditor.js';
import { commerceCmd } from '../src/sim/systems/commerce.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { raftGangplank } from '../src/sim/raftGeometry.js';
import { stepRaftWork } from '../src/sim/systems/raftProduction.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { applyPartDamage, createNavalStructure } from '../src/sim/naval/structure.js';
import { repairPartCost, salvagePartCost } from '../src/sim/naval/structure.js';
import { refitRaftCondition } from '../src/sim/naval/condition.js';

const copy = (v) => structuredClone(v);

function fixture({ wood = 0, iron = 0, parts = null, holdGoods = {} } = {}) {
  const messages = [];
  const server = new LocalServer({ seed: 67, bots: 0, enemies: false,
    send: (_id, message) => messages.push(copy(message)) });
  server.connect(1);
  const profile = newProfile();
  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  if (parts) ship.grid = newRaft(parts);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = {};
  for (const [good, count] of Object.entries(holdGoods)) ship.hold.goods[good] = count;
  profile.eco.pack.goods = {};
  if (wood) {
    const inHold = Math.min(wood, roomFor(ship.hold, 'madera'));
    if (inHold) load(ship.hold, 'madera', inHold);
    if (wood > inHold) profile.eco.pack.goods.madera = wood - inHold;
  }
  if (iron) {
    const inHold = Math.min(iron, roomFor(ship.hold, 'hierro'));
    if (inHold) load(ship.hold, 'hierro', inHold);
    if (iron > inHold) profile.eco.pack.goods.hierro = iron - inHold;
  }
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Reparadora', skin: 0, weapon: 0, save: '' }, profile);
  const owner = server.clients.get(1).entity;
  const source = [...server.world.rafts.values()].find((r) => r.owner === owner);
  assert.ok(source, 'the admitted raft is registered');
  const { x, y, z } = server.world.ecs;
  // Put the owner at the real fixed helm; the editor still checks its own safe radius.
  const raftView = publicRafts(server.world).find((r) => r.id === source.ship.id);
  const helm = pilotPoint(raftView, raftView.helm);
  x[owner] = helm.x; z[owner] = helm.z; y[owner] = helm.y;
  server.world.ecs.regenT[owner] = 100;
  return { server, messages, owner, profile: server.world.profiles.get(owner), source, ship: source.ship };
}

function damage(structure, id, hp) {
  const target = structure.entries.find((entry) => entry.id === id);
  assert.ok(target && hp >= 0 && hp <= target.maxHp);
  return applyPartDamage(structure, id, target.hp - hp).structure;
}

function state(f) {
  return { rev: f.ship.rev, condition: copy(f.source.condition), parts: copy(f.ship.grid.parts),
    hold: copy(f.ship.hold), pack: copy(f.profile.eco.pack) };
}

function madera(f) { return (f.ship.hold.goods.madera || 0) + (f.profile.eco.pack.goods.madera || 0); }

function standBesidePlanGangplank(f, offset = 0) {
  const w = f.server.world, ecs = w.ecs;
  const view = publicRafts(w).find((record) => record.id === f.ship.id);
  const plank = raftGangplank({ ...view, parts: f.ship.grid.parts }, w.map.dock);
  assert.ok(plank, 'the saved blueprint still defines the dock access ramp');
  ecs.x[f.owner] = plank.x + offset; ecs.z[f.owner] = plank.z;
  ecs.y[f.owner] = w.map.groundAt(ecs.x[f.owner], ecs.z[f.owner]);
  ecs.vx[f.owner] = ecs.vz[f.owner] = ecs.moveMag[f.owner] = 0;
  w.raftDeck.update(publicRafts(w));
  return plank;
}

test('part repair cost and salvage scale with missing or surviving HP without changing the blueprint', () => {
  const parts = [
    { id: 'float-a', part: ['foundation', 0, 0, 0, 0] },
    { id: 'sail-a', part: ['sail', 0, 0, 0, 0] },
  ];
  const structure = createNavalStructure(parts);
  const damaged = damage(structure, 'float-a', 30);
  const entry = damaged.entries.find((part) => part.id === 'float-a');
  assert.deepEqual(repairPartCost(entry), { madera: 2 });
  assert.deepEqual(salvagePartCost(entry), { madera: 1 });
  const destroyed = damage(damaged, 'float-a', 0);
  const wreck = destroyed.entries.find((part) => part.id === 'float-a');
  assert.deepEqual(repairPartCost(wreck), { madera: 4 });
  assert.deepEqual(salvagePartCost(wreck), {});
  assert.deepEqual(damaged.entries[0].part, parts[0].part, 'damage and repair costs never rewrite the plan tuple');
});

test('damaged voyage condition survives docking and repair debits once while preserving part identity', () => {
  const f = fixture({ wood: 4 });
  const original = f.source.condition;
  const target = original.entries.find((entry) => entry.part[0] === 'foundation');
  // The real trial is mounted and docked through the live authority. Condition is independent from pose/cargo.
  const raft = f.server.world.rafts.get(f.ship.id);
  const raftView = publicRafts(f.server.world).find((r) => r.id === f.ship.id);
  const helm = pilotPoint(raftView, raftView.helm);
  f.server.world.ecs.x[f.owner] = helm.x; f.server.world.ecs.z[f.owner] = helm.z; f.server.world.ecs.y[f.owner] = helm.y;
  let handle = null;
  const start = f.server.world.navalTrial.start.bind(f.server.world.navalTrial);
  f.server.world.navalTrial.start = (owner, shipId) => (handle = start(owner, shipId));
  assert.equal(f.server.playerCommand(f.server.clients.get(1), { type: 'navalPilot', op: 'mount', shipId: f.ship.id }), true);
  assert.ok(handle);
  assert.equal(f.server.world.navalTrial.queueDamage(handle, target.id, target.maxHp / 2), true);
  assert.equal(f.server.step(), true, 'damage commits only at the authoritative World tick');
  const afterDamage = f.source.condition;
  assert.equal(afterDamage.entries.find((entry) => entry.id === target.id).hp, target.maxHp / 2);
  assert.equal(publicRafts(f.server.world).find((record) => record.id === f.ship.id)
    .partHealth.find((part) => part.id === target.id).hp, target.maxHp / 2,
  'public condition mirrors the authoritative committed trial body');
  f.server.playerCommand(f.server.clients.get(1), { type: 'navalPilot', op: 'dock', epoch: f.server.world.navalPilot.snapshot(f.owner).epoch });
  assert.deepEqual(f.source.condition, afterDamage, 'the committed session damage survives the trial stop path');

  const damagedEntry = f.source.condition.entries.find((entry) => entry.id === target.id);
  const gridBefore = copy(f.ship.grid.parts), goodsBefore = state(f);
  const command = { type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev, opId: 'repair-half',
    index: gridBefore.findIndex((part) => JSON.stringify(part) === JSON.stringify(damagedEntry.part)),
    piece: [...damagedEntry.part], partId: damagedEntry.id, expectedHp: damagedEntry.hp };
  const ack = raftCmd(f.server.world, f.owner, command);
  assert.equal(ack.ok, true);
  assert.equal(ack.rev, goodsBefore.rev + 1);
  assert.equal(f.source.condition.entries.find((entry) => entry.id === target.id).hp, target.maxHp);
  assert.equal(publicRafts(f.server.world).find((record) => record.id === f.ship.id)
    .partHealth.find((part) => part.id === target.id).hp, target.maxHp,
  'the public live part-health projection updates after repair');
  assert.deepEqual(f.ship.grid.parts, gridBefore);
  const originalMadera = (goodsBefore.hold.goods.madera || 0) + (goodsBefore.pack.goods.madera || 0);
  assert.equal(madera(f), originalMadera - 2,
  'half of foundation HP consumes exactly the rounded half-cost');
  assert.equal(f.ship.rev, goodsBefore.rev + 1);
  const after = state(f);
  const duplicate = raftCmd(f.server.world, f.owner, command);
  assert.deepEqual(duplicate, ack);
  assert.deepEqual(state(f), after, 'an exact retry cannot charge or heal twice');
  const alias = raftCmd(f.server.world, f.owner, { ...command, expectedHp: target.maxHp });
  assert.equal(alias.ok, false); assert.equal(alias.why, 'duplicate');
  assert.deepEqual(state(f), after, 'reusing the receipt for a different HP expectation cannot mutate state');
  assert.equal(helm && typeof helm.x === 'number', true);
});

test('repair rejects forged HP, changed tuple, stale revision, extra fields, healthy parts and receipt aliases atomically', () => {
  const f = fixture({ wood: 8 });
  const original = f.source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  f.source.condition = damage(f.source.condition, original.id, original.maxHp / 2);
  const target = f.source.condition.entries.find((entry) => entry.id === original.id);
  const damagedIndex = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(target.part));
  const valid = { type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev,
    index: damagedIndex, piece: [...target.part], partId: target.id, expectedHp: target.hp };
  for (const expectedHp of [target.hp - 1, target.hp + 1, NaN, Infinity]) {
    const before = state(f);
    const forged = raftCmd(f.server.world, f.owner, { ...valid, opId: `forged-${Number.isFinite(expectedHp) ? expectedHp : 'nonfinite'}`,
      expectedHp });
    assert.equal(forged.ok, false); assert.equal(forged.why, 'condition');
    assert.deepEqual(state(f), before, 'an untrusted HP claim is rejected before considering a repair');
  }
  const base = raftCmd(f.server.world, f.owner, { ...valid, opId: 'repair-op' });
  assert.equal(base.ok, true);
  const healthy = f.source.condition.entries.find((entry) => entry.id === target.id);
  const index = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(healthy.part));
  const make = (changes = {}) => ({ type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev,
    opId: 'reject-repair', index, piece: [...healthy.part], partId: healthy.id, expectedHp: healthy.hp, ...changes });
  for (const [label, changes] of [
    ['wrong tuple', { piece: ['sail', 0, 0, 0, 0] }],
    ['extra key', { clientCost: { madera: 0 } }],
  ]) {
    const before = state(f), denied = raftCmd(f.server.world, f.owner, make(changes));
    assert.equal(denied.ok, false, label);
    assert.deepEqual(state(f), before, `${label} must not mutate state`);
  }
  const alias = raftCmd(f.server.world, f.owner, make({ partId: `${healthy.id}-other` }));
  assert.equal(alias.ok, false);
  const before = state(f);
  const stale = raftCmd(f.server.world, f.owner, make({ expectedRev: f.ship.rev - 1 }));
  assert.equal(stale.ok, false); assert.deepEqual(state(f), before);

  const full = raftCmd(f.server.world, f.owner, make({ expectedRev: f.ship.rev, opId: 'heal-again' }));
  assert.equal(full.ok, false); assert.equal(full.why, 'healthy');
});

test('save preflight and insufficient materials roll back repair, condition, inventory, revision, and receipt', () => {
  const f = fixture({ wood: 4 });
  const target = f.source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  f.source.condition = damage(f.source.condition, target.id, 0);
  const entry = f.source.condition.entries.find((part) => part.id === target.id);
  const command = { type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev, opId: 'save-failure',
    index: f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(entry.part)),
    piece: [...entry.part], partId: entry.id, expectedHp: entry.hp };
  const before = state(f);
  const noSave = raftCmd(f.server.world, f.owner, command, () => false);
  assert.equal(noSave.ok, false); assert.equal(noSave.why, 'saveSize'); assert.deepEqual(state(f), before);
  f.ship.hold.goods = {};
  f.profile.eco.pack.goods = {};
  const empty = state(f);
  const noMaterials = raftCmd(f.server.world, f.owner, { ...command, opId: 'no-materials' });
  assert.equal(noMaterials.ok, false); assert.equal(noMaterials.why, 'goods'); assert.deepEqual(state(f), empty);
  f.profile.eco.pack.goods.madera = 4;
  const now = state(f);
  const success = raftCmd(f.server.world, f.owner, command);
  assert.equal(success.ok, true, `failed preflight did not reserve its receipt (${success.why})`);
  assert.equal(success.repair.reconstructed, true);
  assert.deepEqual(f.ship.hold.goods, {}, 'repair consumes hold-first, with no material duplication');
  assert.equal(f.source.condition.entries.find((part) => part.id === entry.id).hp, entry.maxHp);
  assert.equal(f.source.condition.entries.filter((part) => part.id === entry.id).length, 1,
    'reconstructing a destroyed instance does not create a second identity');
  assert.deepEqual(f.ship.grid.parts, before.parts, 'repair restores the instance without inserting a new blueprint piece');
  assert.equal(f.ship.rev, now.rev + 1);
});

test('repair is restricted to the owner at the mooring/editor zone and pauses while busy or underway', () => {
  const f = fixture({ wood: 4 }), ecs = f.server.world.ecs;
  const entry = f.source.condition.entries.find((part) => part.part[0] === 'foundation');
  f.source.condition = damage(f.source.condition, entry.id, entry.maxHp / 2);
  const index = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(entry.part));
  const command = { type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev, opId: 'repair-gates',
    index, piece: [...entry.part], partId: entry.id, expectedHp: entry.hp };
  const before = state(f), x = ecs.x[f.owner], z = ecs.z[f.owner], y = ecs.y[f.owner];
  f.server.connect(2);
  f.server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Visitante', skin: 0, weapon: 0, save: '' }, newProfile());
  const visitor = f.server.clients.get(2).entity;
  const foreign = raftCmd(f.server.world, visitor, { ...command, opId: 'foreign-repair' });
  assert.equal(foreign.ok, false); assert.equal(foreign.why, 'owner'); assert.deepEqual(state(f), before);

  ecs.x[f.owner] = f.server.world.map.half - 2; ecs.z[f.owner] = f.server.world.map.half - 2;
  const far = raftCmd(f.server.world, f.owner, command);
  assert.equal(far.ok, false); assert.equal(far.why, 'far'); assert.deepEqual(state(f), before);
  ecs.x[f.owner] = x; ecs.z[f.owner] = z; ecs.y[f.owner] = y;

  ecs.dashT[f.owner] = 0;
  const busy = raftCmd(f.server.world, f.owner, { ...command, opId: 'repair-busy' });
  assert.equal(busy.ok, false); assert.equal(busy.why, 'busy'); assert.deepEqual(state(f), before);
  ecs.dashT[f.owner] = -1;

  assert.equal(f.server.playerCommand(f.server.clients.get(1), { type: 'navalPilot', op: 'mount', shipId: f.ship.id }), true);
  const underway = raftCmd(f.server.world, f.owner, { ...command, opId: 'repair-underway' });
  assert.equal(underway.ok, false); assert.equal(underway.why, 'busy'); assert.deepEqual(state(f), before);
});

test('one original-plan foundation can be repaired from the dock ramp after every live float is destroyed', () => {
  const f = fixture({ parts: [...STARTER_RAFT], holdGoods: {}, wood: 0 });
  const originalPlan = copy(f.ship.grid.parts);
  f.profile.eco.pack.goods.madera = 4;
  const foundations = f.source.condition.entries.filter((entry) => entry.part[0] === 'foundation');
  for (const entry of foundations) f.source.condition = damage(f.source.condition, entry.id, 0);
  f.server.world.raftDeck.update(publicRafts(f.server.world));
  const view = publicRafts(f.server.world).find((record) => record.id === f.ship.id);
  assert.equal(view.parts.some((part) => part[0] === 'foundation'), false);
  standBesidePlanGangplank(f, 1.7);

  const chosen = foundations[0], index = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(chosen.part));
  const command = { type: 'raft', op: 'repair', id: f.ship.id, expectedRev: f.ship.rev, opId: 'restore-first-float',
    index, piece: [...chosen.part], partId: chosen.id, expectedHp: 0 };
  const result = raftCmd(f.server.world, f.owner, command);
  assert.equal(result.ok, true, result.why);
  assert.equal(f.source.condition.entries.find((entry) => entry.id === chosen.id).hp, chosen.maxHp);
  assert.equal(f.source.condition.entries.filter((entry) => entry.id === chosen.id).length, 1,
    'restoration revives the original instance');
  assert.equal(publicRafts(f.server.world).find((record) => record.id === f.ship.id)
    .parts.some((part) => part[0] === 'foundation'), true, 'the repaired float becomes operational again');
  assert.deepEqual(f.ship.grid.parts, originalPlan, 'condition never deletes or rewrites the saved plan');
});

test('destroyed cargo modules and floats preserve legacy stock; withdrawal stays possible and excess-increasing deposits stop', () => {
  const f = fixture();
  f.ship.hold.goods = { piedra: 2 };
  f.profile.eco.pack.goods.piedra = 1;
  const originalHoldCap = f.ship.hold.cap;
  const crate = f.source.condition.entries.find((entry) => entry.part[0] === 'crate');
  const floats = f.source.condition.entries.filter((entry) => entry.part[0] === 'foundation').slice(0, 2);
  f.source.condition = damage(f.source.condition, crate.id, 0);
  for (const float of floats) f.source.condition = damage(f.source.condition, float.id, 0);
  assert.deepEqual(f.ship.hold.goods, { piedra: 2 }, 'wrecking storage never silently deletes its saved contents');
  assert.equal(f.ship.hold.cap, originalHoldCap, 'destroyed storage does not rewrite legacy hold capacity');
  standBesidePlanGangplank(f);

  const transfer = (opId, side) => commerceCmd(f.server.world, f.owner, { type: 'commerce', op: 'transfer',
    opId, id: f.ship.id, expectedRev: f.ship.rev, g: 'piedra', n: 1, side });
  const beforeDeposit = state(f);
  const denied = transfer('deposit-overload', 'deposit');
  assert.equal(denied.ok, false); assert.equal(denied.why, 'capacity');
  assert.deepEqual(state(f), beforeDeposit, 'rejecting an excess-increasing deposit keeps both inventories intact');

  const withdrawn = transfer('withdraw-wrecked-hold', 'withdraw');
  assert.equal(withdrawn.ok, true, withdrawn.why);
  assert.equal(f.ship.hold.goods.piedra, 1);
  assert.equal(f.profile.eco.pack.goods.piedra, 2);
  const overLimitDeposit = transfer('deposit-after-withdrawal', 'deposit');
  assert.equal(overLimitDeposit.ok, false); assert.equal(overLimitDeposit.why, 'capacity');
  assert.equal(f.ship.hold.goods.piedra, 1);
  assert.equal(f.profile.eco.pack.goods.piedra, 2);
});

test('destroyed production modules stop while dormant work and other module progress are conserved through repair', () => {
  const parts = [...STARTER_RAFT, ['foundation', 2, 0, 0, 0], ['foundation', 3, 0, 0, 0],
    ['foundation', 2, 1, 0, 0], ['net', 2, 0, 0, 0], ['net', 3, 0, 0, 0], ['grill', 2, 1, 0, 0]];
  const f = fixture({ parts, holdGoods: { pescado: 2 } });
  const netKey = productionKey(['net', 2, 0, 0, 0]), otherNetKey = productionKey(['net', 3, 0, 0, 0]);
  const grillKey = productionKey(['grill', 2, 1, 0, 0]);
  f.ship.grid.work = { [netKey]: 0.4, [otherNetKey]: 0.1, [grillKey]: 0.2 };
  const disabledNet = f.source.condition.entries.find((entry) => JSON.stringify(entry.part) === JSON.stringify(['net', 2, 0, 0, 0]));
  const disabledGrill = f.source.condition.entries.find((entry) => JSON.stringify(entry.part) === JSON.stringify(['grill', 2, 1, 0, 0]));
  f.source.condition = damage(f.source.condition, disabledNet.id, 0);
  f.source.condition = damage(f.source.condition, disabledGrill.id, 0);
  const goodsBefore = copy(f.ship.hold.goods);

  stepRaftWork(f.server.world, 0.05);
  assert.equal(f.ship.grid.work[netKey], 0.4, 'destroyed net does not earn progress while absent');
  assert.equal(f.ship.grid.work[grillKey], 0.2, 'destroyed grill keeps its dormant recipe fraction');
  assert.equal(f.ship.grid.work[otherNetKey], 0.4, 'an unrelated live net keeps progressing');
  assert.deepEqual(f.ship.hold.goods, goodsBefore, 'no partial input/output is charged on the disabled modules');

  const index = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(disabledNet.part));
  f.profile.eco.pack.goods.madera = 2; f.profile.eco.pack.goods.lona = 3;
  const repaired = raftCmd(f.server.world, f.owner, { type: 'raft', op: 'repair', id: f.ship.id,
    expectedRev: f.ship.rev, opId: 'repair-production-net', index, piece: [...disabledNet.part],
    partId: disabledNet.id, expectedHp: 0 });
  assert.equal(repaired.ok, true, repaired.why);
  stepRaftWork(f.server.world, 0.05);
  assert.ok(Math.abs(f.ship.grid.work[netKey] - 0.7) < 1e-9,
    'the repaired net resumes from saved work and does not bank the interval while destroyed');
  assert.ok(Math.abs(f.ship.grid.work[otherNetKey] - 0.7) < 1e-9);
  assert.equal(f.ship.grid.work[grillKey], 0.2);
  assert.deepEqual(f.ship.hold.goods, goodsBefore, 'work fractions conserve each good until a full recipe settles');
});

test('reinforcement preserves the damaged fraction and removing a destroyed part refunds no materials', () => {
  const f = fixture(), foundation = f.source.condition.entries.find((part) => part.part[0] === 'foundation');
  f.profile.eco.pack.goods.madera = 1; f.profile.eco.pack.goods.hierro = 1;
  f.source.condition = damage(f.source.condition, foundation.id, foundation.maxHp / 2);
  const index = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(foundation.part));
  const upgraded = raftCmd(f.server.world, f.owner, { type: 'raft', op: 'reinforce', id: f.ship.id,
    expectedRev: f.ship.rev, opId: 'reinforce-damaged', index, piece: [...foundation.part] });
  assert.equal(upgraded.ok, true);
  const reinforced = f.source.condition.entries.find((part) => part.id === foundation.id);
  assert.equal(reinforced.part[0], 'reinforcedFoundation');
  assert.equal(reinforced.hp, 45); assert.equal(reinforced.maxHp, 90);
  assert.equal(f.profile.eco.pack.goods.madera, undefined); assert.equal(f.profile.eco.pack.goods.hierro, undefined);

  const crate = f.source.condition.entries.find((part) => part.part[0] === 'crate');
  f.source.condition = damage(f.source.condition, crate.id, 0);
  const crateIndex = f.ship.grid.parts.findIndex((part) => JSON.stringify(part) === JSON.stringify(crate.part));
  const inventoryBefore = { hold: copy(f.ship.hold.goods), pack: copy(f.profile.eco.pack.goods) };
  const removed = raftCmd(f.server.world, f.owner, { type: 'raft', op: 'remove', id: f.ship.id,
    expectedRev: f.ship.rev, opId: 'remove-destroyed-crate', index: crateIndex, piece: [...crate.part] });
  assert.equal(removed.ok, true, removed.why);
  assert.deepEqual({ hold: f.ship.hold.goods, pack: f.profile.eco.pack.goods }, inventoryBefore,
    'a zero-HP part has no salvage value');
  assert.equal(f.ship.grid.parts.some((part) => JSON.stringify(part) === JSON.stringify(crate.part)), false);
  assert.equal(f.source.condition.entries.some((part) => part.id === crate.id), false);
});

test('condition is captured before detach and reattachment preserves the damaged instance', () => {
  const f = fixture();
  const part = f.source.condition.entries.find((entry) => entry.part[0] === 'foundation');
  f.source.condition = damage(f.source.condition, part.id, part.maxHp / 2);
  f.server.disconnect(1);
  assert.equal(f.server.world.rafts.has(f.ship.id), false, 'detach releases the session-owned live vessel');

  f.server.connect(2);
  f.server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Reentrada', skin: 0, weapon: 0, save: '' }, f.profile);
  const owner = f.server.clients.get(2).entity;
  const attached = [...f.server.world.rafts.values()].find((record) => record.owner === owner);
  assert.ok(attached?.condition);
  assert.equal(attached.condition.entries.find((entry) => entry.part[0] === 'foundation').hp,
    part.maxHp / 2, 'a new session restores the saved operational condition');
  assert.equal(attached.condition.entries.find((entry) => entry.part[0] === 'foundation').id, part.id);
});

test('refits preserve unrelated damage, reinforcement scales current HP, and removing a wreck yields no salvage', () => {
  const parts = [
    { id: 'float-a', part: ['foundation', 0, 0, 0, 0] },
    { id: 'float-b', part: ['foundation', 1, 0, 0, 0] },
  ];
  const damaged = damage(createNavalStructure(parts), 'float-a', 30);
  const placed = [parts[0].part, parts[1].part];
  const source = { entity: 88, condition: damaged, conditionNext: 1, ship: { grid: { parts: placed } } };
  const edited = refitRaftCondition(source, placed);
  assert.equal(edited.structure.entries.find((entry) => entry.id === 'float-a').hp, 30,
    'editing a different cell does not reset existing condition');
  assert.equal(edited.structure.entries.find((entry) => entry.id === 'float-b').hp, 60);

  const reinforced = [['reinforcedFoundation', 0, 0, 0, 0], parts[1].part];
  const upgraded = refitRaftCondition(source, reinforced,
    { reinforceIndex: 0 });
  const upgradedPart = upgraded.structure.entries.find((entry) => entry.part[1] === 0);
  assert.equal(upgradedPart.hp, 45, 'reinforcement keeps the damaged fraction while using its new maximum HP');
  assert.equal(upgradedPart.maxHp, RAFT_PARTS.reinforcedFoundation.hp);

  const wreck = damage(damaged, 'float-a', 0);
  assert.deepEqual(salvagePartCost(wreck.entries.find((entry) => entry.id === 'float-a')), {});
  assert.equal(edited.nextId, upgraded.nextId, 'unchanged cell identities do not mint replacement parts');
});

