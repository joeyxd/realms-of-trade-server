import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { labFixture } from '../tools/naval-lab/fixtures.js';
import {
  applyPartDamage, createNavalStructure, hitHullAt, hullIntegrity, liveStructureParts,
} from '../src/sim/naval/structure.js';

const entriesFor = (parts) => parts.map((part, index) => ({ id: `part:${index + 1}`, part: [...part] }));
const starter = () => createNavalStructure(entriesFor(STARTER_RAFT));

test('structure validates server IDs, tuple bounds and declared HP, then freezes copies', () => {
  const source = entriesFor(STARTER_RAFT);
  const structure = createNavalStructure(source);
  source[0].part[0] = 'sail';
  source[0].id = 'changed';
  assert.equal(structure.version, 1);
  assert.equal(structure.entries[0].id, 'part:1');
  assert.deepEqual(structure.entries[0].part, ['foundation', 0, 0, 0, 0]);
  assert.equal(structure.entries[0].maxHp, 60);
  assert.equal(structure.entries[0].hp, 60);
  assert.ok(Object.isFrozen(structure) && Object.isFrozen(structure.entries));
  assert.ok(Object.isFrozen(structure.entries[0]) && Object.isFrozen(structure.entries[0].part));

  for (const bad of [
    [{ id: 'same', part: STARTER_RAFT[0] }, { id: 'same', part: STARTER_RAFT[1] }],
    [{ id: '', part: STARTER_RAFT[0] }],
    [{ id: 'bad id', part: STARTER_RAFT[0] }],
    [{ id: 'unknown', part: ['not-a-part', 0, 0, 0, 0] }],
    [{ id: 'bad-x', part: ['foundation', 13, 0, 0, 0] }],
    [{ id: 'bad-level', part: ['foundation', 0, 0, 1, 0] }],
    [{ id: 'bad-dir', part: ['wall', 0, 0, 0, 4] }],
    [{ id: 'bad-tuple', part: ['foundation', 0, 0, 0, 0, 9] }],
  ]) assert.throws(() => createNavalStructure(bad), TypeError);
  assert.throws(() => createNavalStructure(new Array(601)), TypeError);
});

test('part IDs keep their damage when entries are reordered; updates preserve the blueprint and inputs', () => {
  const source = entriesFor(STARTER_RAFT);
  const structure = createNavalStructure(source);
  const reversed = createNavalStructure([...source].reverse());
  const before = JSON.stringify(structure);
  const hit = applyPartDamage(reversed, 'part:5', 7);
  assert.equal(hit.event.partId, 'part:5');
  assert.equal(hit.event.type, 'sail');
  assert.equal(hit.event.damage, 7);
  assert.equal(hit.event.destroyed, false);
  assert.equal(hit.structure.entries.find((entry) => entry.id === 'part:5').hp, 33);
  assert.equal(hit.structure.entries.find((entry) => entry.id === 'part:5').maxHp, 40);
  assert.deepEqual(liveStructureParts(hit.structure).find((part) => part[0] === 'sail'), ['sail', 0, 0, 0, 0]);
  assert.equal(JSON.stringify(structure), before);
  assert.equal(source[4].part.length, 4);
});

test('damage clamps at zero, repeats do not emit damage, and unknown IDs fail', () => {
  const first = applyPartDamage(starter(), 'part:1', 15);
  const second = applyPartDamage(first.structure, 'part:1', 500);
  const repeated = applyPartDamage(second.structure, 'part:1', 2);
  assert.equal(first.event.damage, 15);
  assert.equal(second.event.damage, 45);
  assert.equal(second.event.destroyed, true);
  assert.equal(repeated.event, null);
  assert.equal(repeated.structure, second.structure);
  assert.equal(second.structure.entries[0].hp, 0);
  assert.equal(second.structure.entries[0].maxHp, 60);
  assert.throws(() => applyPartDamage(second.structure, 'missing', 1), TypeError);
  for (const amount of [-1, NaN, Infinity]) assert.throws(() => applyPartDamage(second.structure, 'part:1', amount), TypeError);
  assert.equal(applyPartDamage(second.structure, 'part:1', 0).event, null);
});

test('hull integrity aggregates floats only and reports a fully disabled hull without throwing', () => {
  const structure = starter();
  const integrity = hullIntegrity(structure);
  assert.deepEqual(integrity, { hp: 240, maxHp: 240, fraction: 1, destroyed: false, total: 4, disabled: false });
  const sailHit = applyPartDamage(structure, 'part:5', 40).structure;
  assert.deepEqual(hullIntegrity(sailHit), integrity);
  let damaged = structure;
  for (let i = 1; i <= 4; i++) damaged = applyPartDamage(damaged, `part:${i}`, 60).structure;
  assert.deepEqual(hullIntegrity(damaged), { hp: 0, maxHp: 240, fraction: 0, destroyed: true, total: 4, disabled: true });
  assert.deepEqual(liveStructureParts(damaged).map((part) => part[0]), ['sail', 'crate']);
  assert.deepEqual(liveStructureParts(damaged).length, 2);
});

test('impact selects the nearest live float by local AABB and uses lexical ID for exact ties', () => {
  const structure = createNavalStructure([
    { id: 'z-float', part: ['foundation', 0, 0, 0] },
    { id: 'a-float', part: ['foundation', 1, 0, 0] },
  ]);
  const tie = hitHullAt(structure, { x: 2, z: 1, damage: 10 });
  assert.equal(tie.event.partId, 'a-float');
  const side = hitHullAt(structure, { x: -0.25, z: 1, damage: 10 });
  assert.equal(side.event.partId, 'z-float');
  const destroyed = applyPartDamage(side.structure, 'z-float', 60).structure;
  const noRetarget = hitHullAt(destroyed, { x: -0.25, z: 1, damage: 10 });
  assert.equal(noRetarget.event, null);
  assert.equal(noRetarget.structure, destroyed);
  const far = hitHullAt(structure, { x: 8, z: 1, damage: 10 });
  assert.equal(far.event, null);
  for (const hit of [{ x: NaN, z: 0, damage: 1 }, { x: 0, z: 0, damage: -1 }, null])
    assert.throws(() => hitHullAt(structure, hit), TypeError);
});

test('the existing 29-part house blueprint remains complete while destroyed pieces leave only live rig tuples', () => {
  const parts = labFixture('house').parts;
  assert.equal(parts.length, 29);
  const structure = createNavalStructure(entriesFor(parts));
  const destroyedId = structure.entries.find((entry) => entry.part[0] === 'sail').id;
  const damaged = applyPartDamage(structure, destroyedId, 40).structure;
  assert.equal(damaged.entries.length, 29);
  assert.equal(damaged.entries.find((entry) => entry.id === destroyedId).hp, 0);
  assert.equal(damaged.entries.find((entry) => entry.id === destroyedId).part[0], 'sail');
  assert.equal(liveStructureParts(damaged).length, 28);
  assert.equal(structure.entries.length, 29);
});
