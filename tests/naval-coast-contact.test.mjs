import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavalRig, navalPose } from '../src/sim/naval/handling.js';
import { resolveNavalCoast } from '../src/sim/naval/coastContact.js';
import { createTrialBody, damageTrialBody, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { hitHullAt } from '../src/sim/naval/structure.js';

const parts = [['foundation', 0, 0, 0]];
const rig = buildNavalRig(parts);
const state = (tick, x, z, vx, vz, yaw = 0, omega = 0) => ({ tick, x, z, yaw, vx, vz, omega });

function polygon(id, minX, minZ, maxX, maxZ, kind = 'terrain') {
  return Object.freeze({ id, kind, vertices: Object.freeze([
    Object.freeze({ x: minX, z: minZ }), Object.freeze({ x: maxX, z: minZ }),
    Object.freeze({ x: maxX, z: maxZ }), Object.freeze({ x: minX, z: maxZ }),
  ]) });
}

function coastOf(polygons) {
  const source = [...polygons];
  return Object.freeze({ version: 1, query(minX, minZ, maxX, maxZ) {
    return Object.freeze(source.filter((p) => {
      const xs = p.vertices.map((v) => v.x), zs = p.vertices.map((v) => v.z);
      return Math.max(...xs) >= minX && Math.min(...xs) <= maxX &&
        Math.max(...zs) >= minZ && Math.min(...zs) <= maxZ;
    }));
  } });
}

const verticalStrip = (id = 'strip', kind = 'terrain') => polygon(id, 0, -8, 0.04, 8, kind);

test('swept hull catches a narrow shoreline strip even when the tick crosses it completely', () => {
  const before = state(0, -2.5, 0, 4, 0), next = state(1, 1.5, 0, 4, 0);
  const result = resolveNavalCoast(before, next, rig, parts, coastOf([verticalStrip()]));
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].id, 'strip');
  assert.ok(result.state.x < 0, 'the hull is corrected to the water side instead of tunnelling across');
  assert.ok(result.state.x > -2.5, 'the corrected state retains progress up to contact');
  assert.deepEqual(before, state(0, -2.5, 0, 4, 0));
  assert.deepEqual(next, state(1, 1.5, 0, 4, 0));
});

test('frontal impact damages above the normal-speed threshold while safe and tangential contact do not', () => {
  const coast = coastOf([verticalStrip()]);
  const frontal = resolveNavalCoast(state(0, -2.5, 0, 4, 0), state(1, 1.5, 0, 4, 0), rig, parts, coast);
  assert.ok(frontal.contacts[0].damage > 0);
  assert.ok(frontal.contacts[0].speed > 1.8);

  const safe = resolveNavalCoast(state(0, -1.5, 0, 1, 0), state(1, -0.5, 0, 1, 0), rig, parts, coast);
  assert.ok(safe.contacts.length > 0);
  assert.ok(safe.contacts.every((hit) => hit.damage === 0));

  const tangent = resolveNavalCoast(state(0, -0.99, 0, 0, 1), state(1, -0.99, 0.5, 0, 1), rig, parts, coast);
  assert.ok(tangent.contacts.every((hit) => hit.damage === 0), 'sliding along the coast cannot apply normal-impact damage');
});

test('a frontal collision separates and rebounds while an oblique remainder slides along the coast', () => {
  const coast = coastOf([verticalStrip()]);
  const head = resolveNavalCoast(state(0, -2.5, 0, 4, 0), state(1, 1.5, 0, 4, 0), rig, parts, coast);
  assert.ok(head.state.x < 0);
  assert.ok(head.state.vx < 0, 'normal velocity rebounds away from the shore');

  const oblique = resolveNavalCoast(state(0, -2.5, -1, 3.8, 1), state(1, 1.3, 0, 3.8, 1), rig, parts, coast);
  assert.ok(oblique.contacts.length > 0);
  assert.ok(oblique.state.x < 0, 'normal travel is stopped at the coast');
  assert.ok(oblique.state.z > -1, 'the tangential remainder advances along the coast');
  assert.ok(oblique.state.vx < 0);
});

test('pure yaw uses the bounded rotation envelope to catch a hull corner', () => {
  const asymmetricParts = [['foundation', 0, 0, 0], ['foundation', 1, 0, 0]];
  const asymmetricRig = buildNavalRig(asymmetricParts);
  const corner = polygon('corner', -2.03, 1.27, -1.97, 1.33);
  const before = state(0, 0, 0, 0, 0, 0, 1.2), next = state(1, 0, 0, 0, 0, 0.2, 1.2);
  const result = resolveNavalCoast(before, next, asymmetricRig, asymmetricParts, coastOf([corner]));
  assert.ok(result.contacts.some((hit) => hit.id === 'corner'), 'the rotating endpoint corner is covered by the envelope');
});

test('polygon ties use stable IDs, input polygons remain immutable, and contacts stop at the four-contact cap', () => {
  const sameA = polygon('a', 0, -2, 0.1, 2), sameB = polygon('b', 0, -2, 0.1, 2);
  const tieCoast = coastOf([sameB, sameA]);
  const start = state(0, -2.5, 0, 4, 0), end = state(1, 1.5, 0, 4, 0);
  const one = resolveNavalCoast(start, end, rig, parts, tieCoast);
  const two = resolveNavalCoast(start, end, rig, parts, tieCoast);
  assert.deepEqual(one, two);
  assert.equal(one.contacts[0].id, 'a', 'same-cell, same-time obstacle tie resolves by polygon ID');

  const walls = [polygon('near', 0.05, -2, 0.15, 2), polygon('far', -1.22, -2, -1.12, 2)];
  const wallsBefore = structuredClone(walls);
  const capped = resolveNavalCoast(state(0, -1, 0, 4, 0), state(1, 3, 0, 4, 0), rig, parts, coastOf(walls));
  assert.equal(capped.contacts.length, 4, 'the fixed contact budget prevents an unbounded correction loop');
  assert.deepEqual(walls, wallsBefore);
  assert.deepEqual(start, state(0, -2.5, 0, 4, 0));
  assert.deepEqual(end, state(1, 1.5, 0, 4, 0));
});

test('repeated same-cell seam contacts apply HP loss only once to the original instance', () => {
  const body = createTrialBody(parts, { x: -1, y: 0.72, z: 0, yaw: 0 }, 'seam:test');
  const movingState = { ...body.state, x: -1, vx: 4, vz: 0 };
  const movingPose = navalPose(movingState, body.operational.rig);
  const moving = Object.freeze({ ...body, state: Object.freeze(movingState),
    pose: Object.freeze({ ...movingPose, y: body.pose.y }) });
  const seam = coastOf([polygon('a', 0.05, -2, 0.15, 2), polygon('b', -1.22, -2, -1.12, 2)]);
  const stepped = stepTrialBody(moving, { throttle: 0, steer: 0 }, { x: 0, z: 0 }, seam);
  const contacts = stepped.impacts.filter((hit) => hit.cell === 0);
  assert.ok(contacts.length > 1, 'the split coast fixture produces repeated contacts on the same swept cell');
  assert.equal(contacts.filter((hit) => hit.partId === 'seam:test:p1').length, 1,
    'only one same-tick hit can apply HP loss to the original piece');
  assert.ok(contacts.slice(1).every((hit) => hit.partId === null && hit.damage === 0));
  assert.equal(stepped.structure.entries.find((entry) => entry.id === 'seam:test:p1').hp, 54);
  assert.deepEqual(body.structure.entries[0].part.slice(0, 4), parts[0]);
});

test('localized contact damage rebases the remaining raft without changing its source plan', () => {
  const blueprint = [['foundation', 0, 0, 0], ['foundation', 1, 0, 0],
    ['foundation', 0, 1, 0], ['foundation', 1, 1, 0]];
  const bodyRig = buildNavalRig(blueprint), body = createTrialBody(blueprint,
    { x: -2.5, y: 0.72, z: 0, yaw: 0 }, 'coast:test');
  const savedBlueprint = structuredClone(blueprint), savedOrigin = { ...body.pose };
  const before = { ...body.state, x: -1.5, z: 2, vx: 10, vz: 0, tick: body.state.tick };
  const next = { ...before, tick: before.tick + 1, x: 2.5 };
  const impact = resolveNavalCoast(before, next, bodyRig, blueprint, coastOf([verticalStrip()]));
  assert.ok(impact.contacts[0].damage > 0);
  const hit = impact.contacts[0];
  const selected = hitHullAt(body.structure, { x: hit.localX, z: hit.localZ, damage: hit.damage });
  assert.ok(selected.event?.damage > 0, 'impact applies localized HP loss to the struck floating piece');
  assert.equal(body.structure.entries.find((entry) => entry.id === selected.event.partId).part[0], 'foundation');

  const contactPose = navalPose(impact.state, bodyRig);
  const candidate = Object.freeze({ ...body, state: impact.state, pose: Object.freeze({ ...contactPose, y: body.pose.y }) });
  const damaged = damageTrialBody(candidate, selected.event.partId, selected.event.damage).body;
  assert.ok(damaged.operational.rig.cx !== bodyRig.cx || damaged.operational.rig.cz !== bodyRig.cz,
    'destroying an off-center float changes the live centre of mass');
  assert.ok(Math.abs(damaged.pose.x - contactPose.x) < 1e-9);
  assert.ok(Math.abs(damaged.pose.z - contactPose.z) < 1e-9);
  assert.equal(damaged.pose.yaw, contactPose.yaw);
  assert.deepEqual(blueprint, savedBlueprint);
  assert.deepEqual(body.pose, savedOrigin);
});

test('rejects malformed coast polygons, parts, ticks, and fixed-step envelopes', () => {
  const before = state(0, 0, 0, 0, 0), next = state(1, 0, 0, 0, 0);
  for (const coast of [null, {}, { version: 2, query() { return []; } }, { version: 1, query() { return [{}]; } }])
    assert.throws(() => resolveNavalCoast(before, next, rig, parts, coast), TypeError);
  for (const badParts of [null, [['unknown', 0, 0, 0]], new Array(601).fill(['foundation', 0, 0, 0])])
    assert.throws(() => resolveNavalCoast(before, next, rig, badParts, coastOf([])), TypeError);
  assert.throws(() => resolveNavalCoast(before, { ...next, tick: 2 }, rig, parts, coastOf([])), TypeError);
  assert.throws(() => resolveNavalCoast(before, { ...next, x: 4.01 }, rig, parts, coastOf([])), TypeError);
  assert.throws(() => resolveNavalCoast(before, { ...next, yaw: 0.201 }, rig, parts, coastOf([])), TypeError);
});
