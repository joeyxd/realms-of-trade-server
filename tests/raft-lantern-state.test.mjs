import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLitLanterns, litLanternParts, isLanternLit, lanternPoint, lanternDistance, LANTERN_REACH } from '../src/sim/naval/lantern.js';

const part = ['lantern', 2, -1, 0, 0];
const entry = (id, tuple = part, hp = 10) => [id, ...tuple, hp];

test('lit lantern state sanitizes to unique sorted live stable IDs and ignores malformed, stale, or destroyed references', () => {
  const condition = { entries: [entry('z-lamp'), entry('a-lamp', ['lantern', 1, 0, 1, 0]),
    entry('dead-lamp', ['lantern', 0, 0, 0, 0], 0), entry('door-id', ['door', 0, 0, 0, 0]),
    entry('duplicate', ['lantern', 3, 0, 0, 0]), entry('duplicate', ['lantern', 4, 0, 0, 0]),
    ['bad id', ...part, 10], ['bad-row', 'lantern', 0]] };
  assert.deepEqual(sanitizeLitLanterns(['z-lamp', 'a-lamp', 'z-lamp', 'dead-lamp', 'door-id', 'missing', 4], condition),
    ['a-lamp', 'z-lamp']);
  assert.deepEqual(sanitizeLitLanterns('z-lamp', condition), []);
  assert.deepEqual(sanitizeLitLanterns(['duplicate'], condition), [], 'ambiguous repeated IDs cannot identify a live instance');
  assert.deepEqual(sanitizeLitLanterns(['z-lamp'], null), []);
  const source = { condition: { entries: [
    { id: 'z-lamp', part, hp: 10 }, { id: 'a-lamp', part: ['lantern', 1, 0, 1, 0], hp: 3 },
    { id: 'dead-lamp', part: ['lantern', 0, 0, 0, 0], hp: 0 },
  ] }, ship: { litLanterns: ['z-lamp', 'dead-lamp', 'missing'] } };
  assert.deepEqual(litLanternParts(source), [part]);
  assert.deepEqual(source.ship.litLanterns, ['z-lamp', 'dead-lamp', 'missing'], 'derivation does not mutate source');
});

test('lighting uses exact five-field tuple identity and computes cell-center reach in the same deck band', () => {
  const point = lanternPoint({ x: 10, y: 2, z: -4, yaw: Math.PI / 2 }, part);
  assert.ok(Math.abs(point.x - 9) < 1e-9);
  assert.ok(Math.abs(point.y - 2) < 1e-9);
  assert.ok(Math.abs(point.z + 9) < 1e-9);
  assert.equal(lanternDistance({ x: 10, y: 2, z: -4, yaw: Math.PI / 2 }, part, point), 0);
  assert.ok(lanternDistance({ x: 10, y: 2, z: -4, yaw: Math.PI / 2 }, part,
    { x: point.x + LANTERN_REACH, y: point.y, z: point.z }) <= LANTERN_REACH + 1e-9);
  assert.equal(lanternDistance({ x: 10, y: 2, z: -4, yaw: Math.PI / 2 }, part,
    { x: point.x, y: point.y + 0.61, z: point.z }), Infinity);
  assert.equal(isLanternLit([part], [...part]), true);
  assert.equal(isLanternLit([part], ['lantern', 2, -1, 0, 1]), false);
  assert.equal(isLanternLit([part.slice(0, 4)], part), false);
});

test('sanitizer bounds work to the contract maximum of 600 condition entries', () => {
  const rows = Array.from({ length: 601 }, (_, i) => entry(`lamp-${String(i).padStart(3, '0')}`));
  const ids = rows.map((row) => row[0]);
  const clean = sanitizeLitLanterns(ids, { entries: rows });
  assert.equal(clean.length, 600);
  assert.equal(clean.includes('lamp-600'), false);
});
