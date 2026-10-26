import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { navalPose, newNavalState, stepNaval } from '../src/sim/naval/handling.js';
import { resolveNavalContact } from '../src/sim/naval/contact.js';
import { operationalNavalRig, rebaseNavalState } from '../src/sim/naval/operational.js';
import { applyPartDamage, createNavalStructure, hitHullAt } from '../src/sim/naval/structure.js';

const entriesFor = (parts) => parts.map((part, index) => ({ id: `part:${index + 1}`, part: [...part] }));
const makeStructure = (parts = STARTER_RAFT) => createNavalStructure(entriesFor(parts));
const noWind = { yaw: 0, strength: 0 };

test('swept coast hit damages an identified live foundation and rebases without changing blueprint or cargo', () => {
  const structure = makeStructure();
  const cargo = [{ mass: 8, x: 1, z: 1, height: 0.4 }];
  const sourceBefore = JSON.stringify(structure), cargoBefore = JSON.stringify(cargo);
  const bodyBefore = operationalNavalRig(structure, cargo);
  const offsetX = bodyBefore.rig.hullCx - bodyBefore.rig.cx;
  const desiredHullX = -(0.5 * Math.hypot(bodyBefore.rig.beam, bodyBefore.rig.length) + 0.5 + 0.08);
  const before = { ...newNavalState(), x: desiredHullX - offsetX, z: 2 - (bodyBefore.rig.hullCz - bodyBefore.rig.cz), vx: 10 };
  const moved = stepNaval(before, {}, bodyBefore.rig, noWind);
  assert.equal(moved.tick, 1);
  assert.ok(moved.x > before.x, 'the real handling step advances toward the coast');

  const collision = resolveNavalContact(before, moved, bodyBefore.rig, [{ id: 'coast-rock', x: 0, z: 2, radius: 0.5 }]);
  assert.equal(collision.contacts.length, 1);
  const contact = collision.contacts[0];
  const hit = hitHullAt(structure, { x: contact.localX, z: contact.localZ, damage: contact.damage });
  assert.ok(hit.event, 'contact resolves to a real floating foundation');
  assert.equal(hit.event.type, 'foundation');
  assert.equal(hit.event.destroyed, true);

  const bodyAfter = operationalNavalRig(hit.structure, cargo);
  const destroyedPart = hit.structure.entries.find((entry) => entry.id === hit.event.partId).part;
  assert.equal(bodyAfter.disabled, false);
  assert.equal(bodyAfter.parts.length, STARTER_RAFT.length - 1);
  assert.equal(bodyAfter.parts.some((part) => JSON.stringify(part) === JSON.stringify(destroyedPart)), false);
  assert.equal(hit.structure.entries.length, STARTER_RAFT.length, 'the source blueprint keeps the destroyed entry');
  assert.equal(hit.structure.entries.find((entry) => entry.id === hit.event.partId).part[0], 'foundation');

  const rebased = rebaseNavalState(collision.state, bodyBefore.rig, bodyAfter.rig);
  const originBefore = navalPose(collision.state, bodyBefore.rig), originAfter = navalPose(rebased, bodyAfter.rig);
  assert.ok(Math.abs(originAfter.x - originBefore.x) < 1e-10);
  assert.ok(Math.abs(originAfter.z - originBefore.z) < 1e-10);
  assert.equal(JSON.stringify(structure), sourceBefore);
  assert.equal(JSON.stringify(cargo), cargoBefore);
});

test('a resting or pressing contact contributes zero repeated hull damage', () => {
  const structure = makeStructure(), body = operationalNavalRig(structure);
  const state = { ...newNavalState(), tick: 4, x: -1, z: 0, vx: 0, vz: 0 };
  const result = resolveNavalContact(state, { ...state, tick: state.tick + 1 }, body.rig,
    [{ id: 'overlapping-rock', x: 0, z: 2, radius: 0.5 }]);
  assert.equal(result.contacts.length, 1, 'the initial overlap is reported and corrected');
  assert.equal(result.contacts[0].damage, 0);
  const foundation = structure.entries.find((entry) => entry.part[0] === 'foundation');
  const hit = hitHullAt(structure, { x: result.contacts[0].localX, z: result.contacts[0].localZ,
    damage: result.contacts[0].damage });
  assert.equal(hit.event, null);
  assert.equal(hit.structure, structure);
  assert.equal(foundation.hp, 60);
});

test('destroying the last floats disables the operational body while retaining blueprint and cargo', () => {
  const structure = makeStructure();
  let damaged = structure;
  for (const entry of structure.entries.filter((entry) => entry.part[0] === 'foundation'))
    damaged = applyPartDamage(damaged, entry.id, entry.maxHp).structure;
  const cargo = [{ mass: 8, x: 1, z: 1, height: 0.4 }];
  const body = operationalNavalRig(damaged, cargo);
  assert.equal(body.disabled, true);
  assert.equal(body.rig, null);
  assert.equal(body.parts.length, STARTER_RAFT.length - 4);
  assert.equal(damaged.entries.length, STARTER_RAFT.length);
  assert.equal(damaged.entries.filter((entry) => entry.part[0] === 'foundation' && entry.hp === 0).length, 4);
  assert.equal(cargo[0].mass, 8);
});

test('a destroyed sail removes propulsion while leaving floating foundations operational', () => {
  const structure = makeStructure(), before = operationalNavalRig(structure);
  const sail = structure.entries.find((entry) => entry.part[0] === 'sail');
  const damaged = applyPartDamage(structure, sail.id, sail.maxHp).structure;
  const after = operationalNavalRig(damaged);
  assert.ok(before.rig.sail > 0);
  assert.equal(after.rig.sail, 0);
  assert.equal(after.disabled, false);
  assert.equal(after.parts.length, STARTER_RAFT.length - 1);
  assert.equal(damaged.entries.find((entry) => entry.id === sail.id).part[0], 'sail');
  assert.ok(damaged.entries.filter((entry) => entry.part[0] === 'foundation').every((entry) => entry.hp > 0));
});
