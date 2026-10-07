import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNavalContact } from '../src/sim/naval/contact.js';

const rig = { beam: 2, length: 4, cx: 0, cz: 0, hullCx: 0, hullCz: 0 };
const state = (tick, x, z, vx, vz, yaw = 0) => ({ tick, x, z, yaw, vx, vz, omega: 0 });
const rock = { id: 'rock', x: 0, z: 0, radius: 0.5 };

test('head-on contact takes more damage than a glancing contact at the same total speed', () => {
  const head = resolveNavalContact(state(0, -4, 0, 5, 0), state(1, 1, 0, 5, 0), rig, [rock]);
  const glancing = resolveNavalContact(state(0, -4, -2, 3, 4), state(1, 1, 3, 3, 4), rig, [rock]);
  assert.equal(Math.hypot(5, 0), Math.hypot(3, 4));
  assert.equal(head.contacts.length, 1);
  assert.equal(glancing.contacts.length, 1);
  assert.ok(head.contacts[0].damage > glancing.contacts[0].damage);
  assert.ok(Math.abs(head.contacts[0].normalZ) < 1e-8);
});

test('gentle contact, clear trajectory, and resting contact do not cause damage', () => {
  const gentle = resolveNavalContact(state(0, -4, 0, 1, 0), state(1, -2.5, 0, 1, 0), rig, [rock]);
  assert.equal(gentle.contacts.length, 1);
  assert.equal(gentle.contacts[0].damage, 0);

  const clear = resolveNavalContact(state(0, -4, 8, 3, 0), state(1, 0, 8, 3, 0), rig, [rock]);
  assert.deepEqual(clear.contacts, []);

  const resting = resolveNavalContact(state(0, -2.7360679775, 0, 0, 0), state(1, -2.7360679775, 0, 0, 0), rig, [rock]);
  assert.deepEqual(resting.contacts, []);
});

test('swept path catches a fast crossing and returns a finite corrected state', () => {
  const result = resolveNavalContact(state(0, -100, 0, 100, 0), state(1, 100, 0, 100, 0), rig, [rock]);
  assert.equal(result.contacts.length, 1);
  assert.ok(result.contacts[0].damage > 0);
  assert.ok(result.state.x < 0);
  assert.ok(Object.values(result.state).every(Number.isFinite));
});

test('outward motion escapes initial penetration without an artificial bounce', () => {
  const result = resolveNavalContact(state(0, -1, 0, -2, 0), state(1, -3, 0, -2, 0), rig, [rock]);
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].damage, 0);
  assert.equal(result.state.vx, -2);
  assert.ok(result.state.x < -3);
});

test('initial penetration recognizes outward motion along +Z and a diagonal normal', () => {
  const alongZ = resolveNavalContact(state(0, 0, 0.4, 0, 0.8), state(1, 0, 0.9, 0, 0.8), rig, [rock]);
  assert.equal(alongZ.contacts.length, 1);
  assert.equal(alongZ.contacts[0].damage, 0);
  assert.equal(alongZ.state.vz, 0.8, 'outward Z velocity is not bounced back');
  assert.ok(alongZ.state.z > 3.1, 'outward Z movement retains its unblocked remainder');

  const diagonal = resolveNavalContact(state(0, -0.8, 0.8, 0, 0.8), state(1, -0.8, 1.2, 0, 0.8), rig, [rock]);
  assert.equal(diagonal.contacts.length, 1);
  assert.ok(diagonal.contacts[0].normalX < 0 && diagonal.contacts[0].normalZ > 0,
    'the initial penetration has a diagonal outward normal');
  assert.equal(diagonal.contacts[0].damage, 0);
  assert.equal(diagonal.state.vz, 0.8, 'the positive-Z component moves outward on this diagonal');
  assert.ok(diagonal.state.z > 2.25, 'diagonal outward motion retains its swept remainder');
});

test('tangential motion from initial penetration preserves velocity without impact damage', () => {
  const tangent = resolveNavalContact(state(0, -0.8, 0.8, 0.6, 0.6), state(1, -0.5, 1.1, 0.6, 0.6), rig, [rock]);
  assert.equal(tangent.contacts.length, 1);
  assert.equal(tangent.contacts[0].damage, 0);
  assert.equal(tangent.state.vx, 0.6);
  assert.equal(tangent.state.vz, 0.6);
});

test('hull offset follows angular pose and local contact coordinates use corrected pose', () => {
  const offsetRig = { ...rig, cx: 1, cz: 0, hullCx: 3, hullCz: 0 };
  const before = state(0, -4, 0, 5, 0, Math.PI / 2);
  const next = state(1, 1, 0, 5, 0, Math.PI / 2);
  const result = resolveNavalContact(before, next, offsetRig, [rock]);
  assert.equal(result.contacts.length, 1);
  assert.ok(Math.abs(result.contacts[0].normalZ) > 0.5);
  assert.ok(Number.isFinite(result.contacts[0].localX));
  assert.ok(Number.isFinite(result.contacts[0].localZ));
});

test('contact order is deterministic, capped at four, and input objects are not mutated', () => {
  const obstacles = ['e', 'd', 'c', 'b', 'a'].map((id, i) => ({ id, x: i * 0.1, z: 0, radius: 0.5 }));
  const snapshot = structuredClone(obstacles);
  const before = state(0, 0, 0, 0, 0), next = state(1, 0, 0, 0, 0);
  const a = resolveNavalContact(before, next, rig, obstacles);
  const b = resolveNavalContact(before, next, rig, obstacles);
  assert.deepEqual(a, b);
  assert.deepEqual(a.contacts.map((contact) => contact.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(obstacles, snapshot);
  assert.deepEqual(before, state(0, 0, 0, 0, 0));
  assert.deepEqual(next, state(1, 0, 0, 0, 0));
});

test('rejects malformed numeric inputs and nonconsecutive ticks', () => {
  assert.throws(() => resolveNavalContact(state(0, 0, 0, 0, 0), state(1, 0, 0, 0, 0), rig,
    [{ ...rock, x: NaN }]), TypeError);
  assert.throws(() => resolveNavalContact(state(0, 0, 0, 0, 0), state(2, 0, 0, 0, 0), rig, []), TypeError);
});
