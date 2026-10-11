import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOTING } from '../src/data/progression.js';
import { stepNaval } from '../src/sim/naval/handling.js';
import { labFixture, LAB_WINDS } from '../tools/naval-lab/fixtures.js';
import { createTrialBody, damageTrialBody, parkTrialBody, refreshTrialPayload, stepTrialBody } from '../src/sim/naval/trialBody.js';

const POSE = { x: 0, y: 0.72, z: 0, yaw: 0 };
const CALM = LAB_WINDS.find((wind) => wind.id === 'calm');
const INPUT = { throttle: 1, steer: 1 };
const cargo = (id) => labFixture(id).cargo;
const body = (parts, load = [], response = 1, ns = 'pilot-benefit') => createTrialBody(parts, POSE, ns, 0, {
  navigation: true, flowOrigin: { x: 0, z: 0, yaw: 0 }, cargo: load, wind: CALM,
  ...(response === undefined ? {} : { helmResponse: response }),
});
const turn = (source, ticks = 120) => {
  let next = source;
  for (let i = 0; i < ticks; i++) next = stepTrialBody(next, INPUT, CALM);
  return next;
};

test('first-lesson rudder authority improves turning while empty and loaded hull differences remain', () => {
  assert.equal(PILOTING.rudderMultiplier, 1.15);
  const parts = labFixture('empty').parts;
  const cases = [
    { id: 'empty', load: cargo('empty') },
    { id: 'center-loaded', load: cargo('center') },
  ];
  const results = new Map();
  for (const fixture of cases) {
    const base = turn(body(parts, fixture.load, 1, `base-${fixture.id}`));
    const trained = turn(body(parts, fixture.load, PILOTING.rudderMultiplier, `trained-${fixture.id}`));
    const baseYaw = Math.abs(base.state.yaw), trainedYaw = Math.abs(trained.state.yaw);
    assert.ok(trainedYaw > baseYaw * 1.08, `${fixture.id}: learned turn is meaningfully stronger (${trainedYaw} vs ${baseYaw})`);
    assert.equal(base.helmResponse, 1);
    assert.equal(trained.helmResponse, PILOTING.rudderMultiplier);
    for (const field of ['mass', 'inertia', 'buoyancy', 'load', 'flotation', 'stability'])
      assert.equal(base.operational.rig[field], trained.operational.rig[field], `${fixture.id}: training leaves ${field} unchanged`);
    results.set(fixture.id, { baseYaw, trainedYaw, rig: trained.operational.rig });
  }
  assert.ok(results.get('center-loaded').rig.mass > results.get('empty').rig.mass);
  assert.ok(results.get('center-loaded').rig.inertia > results.get('empty').rig.inertia);
  assert.ok(results.get('center-loaded').trainedYaw < results.get('empty').trainedYaw,
    'the learned response does not erase the loaded hull turning penalty');
});

test('neutral and legacy handling remain unchanged; only the configured helm response is accepted', () => {
  const parts = labFixture('empty').parts;
  const noOption = createTrialBody(parts, POSE, 'pilot-neutral-default');
  assert.equal(Object.hasOwn(noOption, 'helmResponse'), false);
  assert.deepEqual(
    stepNaval(noOption.state, INPUT, noOption.operational.rig, CALM),
    stepNaval(noOption.state, INPUT, noOption.operational.rig, CALM, { rudderMultiplier: 1 }),
  );
  assert.throws(() => createTrialBody(parts, POSE, 'pilot-inactive', 0, { helmResponse: PILOTING.rudderMultiplier }), /Inactive helm response/);
  for (const invalid of [null, 0, 1.01, 1.14, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => body(parts, [], invalid, `pilot-invalid-${String(invalid)}`), TypeError);
    assert.throws(() => stepNaval(noOption.state, INPUT, noOption.operational.rig, CALM,
      { rudderMultiplier: invalid }), TypeError);
  }
  assert.throws(() => createTrialBody(parts, POSE, 'pilot-invalid-undefined', 0, {
    navigation: true, flowOrigin: { x: 0, z: 0, yaw: 0 }, helmResponse: undefined,
  }), TypeError);
  assert.throws(() => stepNaval(noOption.state, INPUT, noOption.operational.rig, CALM,
    { rudderMultiplier: undefined }), TypeError);
  const learned = body(parts, [], PILOTING.rudderMultiplier, 'pilot-accepted');
  assert.throws(() => stepTrialBody({ ...learned, helmResponse: 1.14 }, INPUT, CALM), /Invalid trial navigation state/);
});

test('trusted helm response survives prediction steps, damage, parking and payload refresh', () => {
  const parts = labFixture('empty').parts;
  const learned = body(parts, [], PILOTING.rudderMultiplier, 'pilot-preserved');
  const stepped = stepTrialBody(learned, INPUT, CALM);
  assert.equal(stepped.helmResponse, PILOTING.rudderMultiplier);

  const sail = stepped.structure.entries.find((entry) => entry.part[0] === 'sail');
  const damaged = damageTrialBody(stepped, sail.id, 1).body;
  assert.equal(damaged.helmResponse, PILOTING.rudderMultiplier);

  const parked = parkTrialBody(damaged, true);
  assert.equal(parked.helmResponse, PILOTING.rudderMultiplier);
  const loaded = refreshTrialPayload(parked, cargo('center'));
  assert.equal(loaded.helmResponse, PILOTING.rudderMultiplier);
  assert.equal(loaded.operational.rig.cargoMass, 24);
  assert.deepEqual(stepTrialBody(loaded, INPUT, CALM).helmResponse, PILOTING.rudderMultiplier);
});
