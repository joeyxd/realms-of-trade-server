import test from 'node:test';
import assert from 'node:assert/strict';
import { doorDistance, doorKey, doorPoint, DOOR_REACH, isDoorOpen, openDoorParts, sanitizeOpenDoors } from '../src/sim/naval/shelter.js';
import { RaftDeck } from '../src/sim/raftGeometry.js';

const door = ['door', 1, 0, 0, 0];
const condition = (id = 'p1', part = door, hp = 40) => ({ v: 1, next: 2, entries: [[id, ...part, hp]] });

test('open door sanitizer accepts only unique, living door instance IDs and sorts the result', () => {
  const encoded = { v: 1, next: 8, entries: [
    ['p3', 'door', 2, 0, 0, 1, 1], ['p1', ...door, 40], ['p2', 'door', 3, 0, 0, 0, 0],
    ['p4', 'wall', 4, 0, 0, 0, 50], ['p5', 'door', 5, 0, 0, 0, 41],
    ['p6', 'door', 6, 0, 0, 0], ['p7', 'door', 7, 0, 0, 0, '40'],
  ] };
  assert.deepEqual(sanitizeOpenDoors(['p3', 'p1', 'p3', 'p2', 'p4', 'p5', 'p6', 'p7', 1], encoded), ['p1', 'p3']);
  assert.deepEqual(sanitizeOpenDoors(['p1'], null), []);
  assert.deepEqual(sanitizeOpenDoors('p1', encoded), []);
});

test('duplicate or replaced instance IDs cannot inherit an old open state', () => {
  const duplicateId = { entries: [['p1', ...door, 40], ['p1', 'door', 2, 0, 0, 0, 40]] };
  assert.deepEqual(sanitizeOpenDoors(['p1'], duplicateId), []);
  const replacement = condition('p2');
  assert.deepEqual(sanitizeOpenDoors(['p1'], replacement), []);
  const source = { ship: { openDoors: ['p1'] }, condition: { entries: [{ id: 'p2', part: door, hp: 40 }] } };
  assert.deepEqual(openDoorParts(source), []);
});

test('destroyed doors are removed from saved and operational open state', () => {
  assert.deepEqual(sanitizeOpenDoors(['p1'], condition('p1', door, 0)), []);
  const source = { ship: { openDoors: ['p1'] }, condition: { entries: [{ id: 'p1', part: door, hp: 0 }] } };
  assert.deepEqual(openDoorParts(source), []);
});

test('door helpers are read-only and compare the complete five-field tuple', () => {
  const source = { ship: { openDoors: ['p1'] }, condition: { entries: [{ id: 'p1', part: door, hp: 12 }] } };
  const before = structuredClone(source);
  const open = openDoorParts(source);
  assert.deepEqual(open, [door]);
  assert.equal(isDoorOpen(open, door), true);
  assert.equal(isDoorOpen(open, ['door', 1, 0, 0, 1]), false);
  assert.equal(doorKey(door), JSON.stringify(door));
  assert.deepEqual(source, before);
});

test('door point and reach use the rotated world edge and reject another deck level', () => {
  const record = { x: 10, y: 0.72, z: 20, yaw: Math.PI / 2 };
  const point = doorPoint(record, door);
  assert.ok(Math.abs(point.x - 10) < 1e-9);
  assert.ok(Math.abs(point.z - 17) < 1e-9);
  assert.ok(Math.abs(point.y - 0.72) < 1e-9);
  assert.ok(doorDistance(record, door, point) < 1e-9);
  assert.ok(Math.abs(doorDistance(record, door, { x: 10, y: 0.72, z: 15 }) - 1) < 1e-9);
  assert.equal(doorDistance(record, door, { ...point, y: point.y + 2.6 }), Infinity);
  assert.equal(DOOR_REACH, 1.7);
});

test('roof cover follows rotated deck cells and never adds a walkable storey', () => {
  const deck = new RaftDeck({ dock: null });
  const record = { id: 'cabin', x: 10, y: 0.72, z: 20, yaw: Math.PI / 2,
    parts: [['foundation', 0, 0, 0, 0], ['roof', 0, 0, 0, 0]] };
  deck.update([record]);
  const cover = deck.shelterAt(11, 19, 0.72);
  assert.equal(cover.id, 'cabin'); assert.ok(Math.abs(cover.y - 3.32) < 1e-9);
  assert.equal(deck.shelterAt(13, 19, 0.72), null, 'uncovered neighboring cell stays outside');
  assert.equal(deck.shelterAt(11, 19, 3.32), null, 'standing above a roof is not inside');
  assert.equal(deck.surface(11, 19, 3.32), null, 'roof creates no floor at its ceiling');
  deck.update([{ ...record, parts: [record.parts[0]] }]);
  assert.equal(deck.shelterAt(11, 19, 0.72), null, 'destroyed/removed operational roof gives no cover');
});
