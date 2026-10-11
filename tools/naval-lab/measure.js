import { buildNavalRig, newNavalState, stepNaval, NAVAL_STEP } from '../../src/sim/naval/handling.js';

// Comparisons deliberately start braking/turning at the same speed. Measuring each boat only
// from its own top speed would conceal the braking cost of mass. Distances are centre-of-mass paths.
export function measureHandling(fixture, wind) {
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  let state = newNavalState();
  for (let n = 0; n < 360; n++) state = stepNaval(state, { throttle: 1 }, rig, wind);
  const acceleration = { seconds: 6, speed: Math.hypot(state.vx, state.vz), distance: Math.hypot(state.x, state.z) };
  state = { ...newNavalState(), vz: 2 };
  let brakeTicks = 0, brakeDistance = 0;
  while (Math.hypot(state.vx, state.vz) > 0.1 && brakeTicks < 3600) {
    const next = stepNaval(state, { brake: 1 }, rig, wind);
    brakeDistance += Math.hypot(next.x - state.x, next.z - state.z); state = next; brakeTicks++;
  }
  const braking = { seconds: brakeTicks * NAVAL_STEP, distance: brakeDistance, reached: Math.hypot(state.vx, state.vz) <= 0.1 };
  state = { ...newNavalState(), vz: 2 };
  let turnTicks = 0, angle = 0, turnDistance = 0;
  while (angle < Math.PI / 2 && turnTicks < 3600) {
    const next = stepNaval(state, { throttle: 1, steer: 1 }, rig, wind);
    angle += next.omega * NAVAL_STEP; turnDistance += Math.hypot(next.x - state.x, next.z - state.z);
    state = next; turnTicks++;
  }
  return { rig, acceleration, braking, turning: { seconds: turnTicks * NAVAL_STEP,
    distance: turnDistance, reached: angle >= Math.PI / 2 }, initialSpeed: 2, step: NAVAL_STEP };
}
