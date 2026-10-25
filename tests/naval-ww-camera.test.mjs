import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatCamera, stepBoatCamera } from '../src/render/naval/boatCamera.js';
import { NAVAL_CAMERA as C } from '../src/data/navalCamera.js';
import { WW_UNIT, WW_SPEED } from '../src/data/navalHandling.js';

const DEG = 180 / Math.PI, TOP = 55 * WW_SPEED; // the WW boat's top speed in our units a second (21.03)

// Runs `seconds` at `fps`; pose(t) gives the pilot's x, y, z and the heading. Returns the last output.
function run(cam, seconds, fps, pose = () => ({}), extra = {}) {
  let out = null;
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) out = stepBoatCamera(cam, { dt: i ? 1 / fps : 0, ...extra, ...pose(i / fps) });
  return out;
}

const view = (out) => {
  const dx = out.eye.x - out.center.x, dy = out.eye.y - out.center.y, dz = out.eye.z - out.center.z;
  return { radius: Math.hypot(dx, dy, dz), lat: Math.atan2(dy, Math.hypot(dx, dz)) * DEG, az: Math.atan2(dx, dz) * DEG };
};
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);
const cruise = (t) => ({ x: 0, y: 0, z: TOP * t, yaw: 0 });

test('at rest: 800 WW units behind the pilot, 5 degrees up, vertical FOV 70, looking 90 ahead of the head', () => {
  const out = run(createBoatCamera(), 4, 60);
  const v = view(out);
  near(v.radius, C.radius * WW_UNIT, 1e-3, 'radius');
  near(v.lat, C.latitude, 0.05, 'latitude');
  near(Math.abs(v.az), 180, 1e-6, 'azimuth behind a +z heading');
  near(out.fov, C.fov, 1e-6, 'fov');
  near(out.center.y, (C.headHeight + C.height) * WW_UNIT, 1e-6, 'gaze height');
  near(out.center.z, C.ahead * WW_UNIT, 1e-6, 'gaze ahead');
});

test('at top speed: the camera closes to 370, levels to 0 degrees and opens the FOV to 90', () => {
  const cam = createBoatCamera();
  const out = run(cam, 12, 60, cruise);
  const v = view(out);
  near(out.speed, 1, 1e-9, 'speed ratio saturates at 40 WW units a frame');
  near(v.radius, (C.radius + C.radiusSpeed) * WW_UNIT, 1e-3, 'radius');
  near(v.lat, C.latitude + C.latitudeSpeed, 0.05, 'latitude');
  near(out.fov, C.fov + C.fovSpeed, 1e-3, 'fov');
});

test('the sim speed, when given, replaces the measured travel', () => {
  near(run(createBoatCamera(), 6, 60, () => ({}), { speed: TOP }).speed, 1, 1e-9, 'parked pilot, raft at top speed');
  near(run(createBoatCamera(), 6, 60, cruise, { speed: 0 }).speed, 0, 1e-9, 'moving pilot, raft stopped');
});

test('the gaze moves to the boom side: tailwind puts the boom at -30 degrees and the view 75 WW units left', () => {
  const left = run(createBoatCamera(), 12, 60, cruise, { windYaw: 0 });
  near(left.center.x, 75 * WW_UNIT, 1e-3, 'tailwind: boom left');
  // Wind blowing toward the raft's right (-x for a +z heading) swings the boom and the view to the right.
  const right = run(createBoatCamera(), 12, 60, cruise, { windYaw: -Math.PI / 2 });
  near(right.center.x, -75 * WW_UNIT, 1e-3, 'wind to the right: boom right');
  // Stopped, the side weight is zero whatever the boom does.
  near(run(createBoatCamera(), 6, 60, () => ({}), { windYaw: -Math.PI / 2 }).center.x, 0, 1e-9, 'stopped');
});

test('switch-in: closes 1 / (20 - k) of every gap and sits on the target after exactly 20 WW frames', () => {
  const cam = createBoatCamera();
  const from = { eye: { x: 40, y: 30, z: -10 }, center: { x: 5, y: 1, z: 8 }, fov: 45 };
  stepBoatCamera(cam, { dt: 0, from });
  for (let i = 0; i < 18; i++) stepBoatCamera(cam, { dt: 1 / 30 });
  assert.equal(cam.steady, false, 'still blending after 19 frames');
  assert.ok(Math.abs(cam.cx - cam.gx) > 1, 'centre not there yet');
  stepBoatCamera(cam, { dt: 1 / 30 });
  assert.equal(cam.steady, true, 'steady on frame 20');
  near(cam.cx, cam.gx, 1e-9, 'centre x on the gaze'); near(cam.cz, cam.gz, 1e-9, 'centre z on the gaze');
  // The first frame kept the current view: its radius is the base that eases to the style's 800.
  const first = createBoatCamera();
  const out = stepBoatCamera(first, { dt: 0, from });
  assert.ok(view(out).radius > 40, `starts from the old view, radius ${view(out).radius}`);
});

test('bank: -5 degrees per unit of stick, eased by speed; none when stopped', () => {
  const fast = run(createBoatCamera(), 15, 60, cruise, { stickX: 1 });
  assert.ok(fast.bank * DEG < -4.5 && fast.bank * DEG > -5, `bank at speed ${fast.bank * DEG}`);
  near(run(createBoatCamera(), 6, 60, () => ({}), { stickX: 1 }).bank, 0, 1e-12, 'bank at rest');
});

test('limits and knobs: latitude stays in [-10, 30] degrees; zoom scales the distance', () => {
  near(view(run(createBoatCamera(), 6, 60, () => ({}), { lookPitch: 1.5 })).lat, C.latMax, 1e-6, 'look up clamps at 30');
  near(view(run(createBoatCamera(), 6, 60, () => ({}), { lookPitch: -1.5 })).lat, C.latMin, 1e-6, 'look down clamps at -10');
  near(view(run(createBoatCamera(), 6, 60, () => ({}), { zoom: 2 })).radius, 2 * C.radius * WW_UNIT, 1e-2, 'zoom 2');
});

test('the same at 30, 60, 120 and 144 fps', () => {
  const turn = (t) => ({ x: Math.sin(t) * 8, y: Math.sin(t * 2) * 0.2, z: TOP * t, yaw: 0.4 * Math.sin(t) });
  const a = run(createBoatCamera(), 6, 30, turn, { stickX: 0.5 });
  // At 144 fps a WW frame takes the pose of the render frame that crosses its boundary, up to 1/144 s late: at most one
  // 144 fps step of travel (0.15 of our units at top speed). Multiples of 30 fps sample the same instants.
  for (const [fps, tol] of [[60, 1e-3], [120, 1e-3], [144, TOP / 144 + 0.01]]) {
    const b = run(createBoatCamera(), 6, fps, turn, { stickX: 0.5 });
    for (const k of ['x', 'y', 'z']) {
      near(b.eye[k], a.eye[k], tol, `${fps} fps eye ${k}`);
      near(b.center[k], a.center[k], tol, `${fps} fps center ${k}`);
    }
    near(b.fov, a.fov, tol, `${fps} fps fov`);
  }
});

test('heading: the camera swings behind a new heading at 0.2 a frame, no look-ahead', () => {
  const cam = createBoatCamera();
  run(cam, 4, 60);
  // Eye azimuth from the centre: behind a +z heading is 180, behind +x is -90. Three WW frames after a 90 degree turn the
  // eye has covered 1 - 0.8^2 = 36 percent of the swing (the output trails the newest frame by one).
  const early = view(run(cam, 0.1, 60, () => ({ yaw: Math.PI / 2 }))).az;
  near(early, -180 + 90 * (1 - 0.8 ** 2), 0.5, 'partway');
  near(view(run(cam, 3, 60, () => ({ yaw: Math.PI / 2 }))).az, -90, 0.05, 'settled behind the new heading');
});
