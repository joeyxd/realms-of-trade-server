import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { navalPose, newNavalState } from '../src/sim/naval/handling.js';
import { operationalNavalRig, rebaseNavalState } from '../src/sim/naval/operational.js';
import { applyPartDamage, createNavalStructure, hullIntegrity } from '../src/sim/naval/structure.js';
import { labFixture } from '../tools/naval-lab/fixtures.js';

const entriesFor = (parts) => parts.map((part, index) => ({ id: `part:${index + 1}`, part: [...part] }));
const starterStructure = () => createNavalStructure(entriesFor(STARTER_RAFT));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${message}: expected ${expected}, got ${actual}`);

function pointWorld(state, rig, localX, localZ) {
  const pose = navalPose(state, rig), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { x: pose.x + c * localX + s * localZ, z: pose.z - s * localX + c * localZ };
}

function pointVelocity(state, rig, localX, localZ) {
  const dx = localX - rig.cx, dz = localZ - rig.cz, s = Math.sin(state.yaw), c = Math.cos(state.yaw);
  return { x: state.vx + state.omega * (-s * dx + c * dz),
    z: state.vz + state.omega * (-c * dx - s * dz) };
}

function assertSamePointMotion(before, beforeRig, after, afterRig, localX = 3.25, localZ = -1.75) {
  const p0 = pointWorld(before, beforeRig, localX, localZ), p1 = pointWorld(after, afterRig, localX, localZ);
  const v0 = pointVelocity(before, beforeRig, localX, localZ), v1 = pointVelocity(after, afterRig, localX, localZ);
  close(p1.x, p0.x, 'point world x'); close(p1.z, p0.z, 'point world z');
  close(v1.x, v0.x, 'point velocity x'); close(v1.z, v0.z, 'point velocity z');
  close(after.yaw, before.yaw, 'yaw');
}

test('destroying a sail removes its propulsion while preserving hull integrity and the blueprint', () => {
  const structure = starterStructure(), before = operationalNavalRig(structure);
  const sailId = structure.entries.find((entry) => entry.part[0] === 'sail').id;
  const damaged = applyPartDamage(structure, sailId, 40).structure;
  const after = operationalNavalRig(damaged);
  assert.ok(before.rig.sail > 0);
  assert.equal(after.rig.sail, 0);
  assert.equal(after.disabled, false);
  assert.deepEqual(hullIntegrity(damaged), hullIntegrity(structure));
  assert.equal(structure.entries.find((entry) => entry.id === sailId).hp, 40);
  assert.equal(damaged.entries.find((entry) => entry.id === sailId).part[0], 'sail');
});

test('destroying a foundation lowers live mass and buoyancy, then rebases every fixed hull point', () => {
  const structure = starterStructure(), beforeBody = operationalNavalRig(structure);
  const damaged = applyPartDamage(structure, 'part:1', 60).structure;
  const afterBody = operationalNavalRig(damaged);
  assert.equal(afterBody.disabled, false);
  assert.ok(afterBody.rig.mass < beforeBody.rig.mass);
  assert.ok(afterBody.rig.buoyancy < beforeBody.rig.buoyancy);
  assert.equal(damaged.entries.length, STARTER_RAFT.length);
  assert.equal(damaged.entries[0].hp, 0);
  const state = { ...newNavalState(), tick: 40, x: 19, z: -7, yaw: 0.73, vx: 2.2, vz: -0.6, omega: 0.31 };
  const rebased = rebaseNavalState(state, beforeBody.rig, afterBody.rig);
  assertSamePointMotion(state, beforeBody.rig, rebased, afterBody.rig);
  assert.notEqual(rebased, state);
  assert.equal(state.x, 19);
});

test('cargo removal rebases the same motion without changing cargo or structure inputs', () => {
  const structure = starterStructure();
  const cargo = [{ mass: 24, x: 3.55, z: 2, height: 3.2 }];
  const cargoBefore = JSON.stringify(cargo), structureBefore = JSON.stringify(structure);
  const loaded = operationalNavalRig(structure, cargo);
  const empty = operationalNavalRig(structure, []);
  const state = { ...newNavalState(), tick: 7, x: -4, z: 12, yaw: -1.2, vx: 0.4, vz: 1.7, omega: -0.24 };
  assertSamePointMotion(state, loaded.rig, rebaseNavalState(state, loaded.rig, empty.rig), empty.rig, -5, 3);
  assert.equal(JSON.stringify(cargo), cargoBefore);
  assert.equal(JSON.stringify(structure), structureBefore);
});

test('last live float disables the body without dropping cargo or erasing dead blueprint entries', () => {
  const structure = starterStructure();
  let destroyed = structure;
  for (let i = 1; i <= 4; i++) destroyed = applyPartDamage(destroyed, `part:${i}`, 60).structure;
  const cargo = [{ mass: 8, x: 1, z: 1, height: 0.4 }], originalCargo = JSON.stringify(cargo);
  const body = operationalNavalRig(destroyed, cargo);
  assert.equal(body.disabled, true);
  assert.equal(body.rig, null);
  assert.deepEqual(body.parts.map((part) => part[0]), ['sail', 'crate']);
  assert.equal(destroyed.entries.length, STARTER_RAFT.length);
  assert.equal(destroyed.entries.filter((entry) => entry.part[0] === 'foundation').length, 4);
  assert.equal(JSON.stringify(cargo), originalCargo);
  assert.throws(() => operationalNavalRig(destroyed, new Array(601)), TypeError);
});

test('the existing 29-part house still builds an operational rig with its full blueprint', () => {
  const fixture = labFixture('house'), structure = createNavalStructure(entriesFor(fixture.parts));
  const body = operationalNavalRig(structure, fixture.cargo);
  assert.equal(structure.entries.length, 29);
  assert.equal(body.parts.length, 29);
  assert.equal(body.disabled, false);
  assert.ok(body.rig.mass > 0 && body.rig.buoyancy > 0 && body.rig.sail > 0);
});

test('rebasing rejects malformed states and non-finite rigs without mutating inputs', () => {
  const state = { ...newNavalState(), x: 3, z: 4, yaw: 0.2, vx: 1, vz: 2, omega: 0.1 };
  const rig = operationalNavalRig(starterStructure()).rig;
  const before = JSON.stringify(state);
  for (const badState of [null, { ...state, tick: -1 }, { ...state, x: Infinity }, { ...state, omega: NaN }])
    assert.throws(() => rebaseNavalState(badState, rig, rig), TypeError);
  for (const badRig of [null, { ...rig, cx: Infinity }, { ...rig, cz: NaN }, { ...rig, mass: Infinity }])
    assert.throws(() => rebaseNavalState(state, badRig, rig), TypeError);
  assert.equal(JSON.stringify(state), before);
});
