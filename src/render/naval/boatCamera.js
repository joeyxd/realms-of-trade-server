// Client-only Wind Waker "Boat" camera (rideCamera with style BN07; research/wind-waker/04-camara-boat-disco.md,
// T-1025-05). Pure maths, no three.js: fed with the pilot's drawn position and the raft's heading, it returns the eye,
// the look-at centre, the vertical FOV and the roll. Lengths are WW units inside, our units outside; WW logic runs at
// 30 frames a second from a fixed accumulator and the output is interpolated, so it is the same at 30 or 144 fps.
import { NAVAL_CAMERA as C } from '../../data/navalCamera.js';
import { WW_ANGLE, WW_SPEED, WW_UNIT } from '../../data/navalHandling.js';
import { seaSurfaceY } from './seaSwell.js';

const FRAME = 1 / C.frameRate, TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const wrap = (a) => a - TAU * Math.round(a / TAU);
const finitePoint = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// cLib addCalc / addCalcAngleS: step = diff * scale; below minStep it moves by minStep without overshoot.
function addCalc(v, target, scale, max, min) {
  const diff = target - v;
  if (diff === 0) return v;
  const step = diff * scale;
  if (Math.abs(step) >= min) return v + clamp(step, -max, max);
  return Math.abs(diff) <= min ? target : v + Math.sign(diff) * min;
}

export function createBoatCamera() {
  return {
    started: false, steady: false, acc: 0, k: 0, lastX: 0, lastZ: 0, pendX: 0, pendZ: 0, pendT: 0, speed: 0,
    cx: 0, cy: 0, cz: 0, ex: 0, ey: 0, ez: 0, r: C.radius, lat: C.latitude * D2R, az: 0, fov: C.fov, bank: 0,
    gx: 0, gy: 0, gz: 0, gazeK: C.gazeLag, baseR: C.radius, speedR: 0, baseLat: C.latitude, speedLat: 0, sideK: 0,
    sail: 0, sailAim: 0, prev: null, cur: null, out: null,
  };
}

function placeEye(s) {
  const h = s.r * Math.cos(s.lat);
  s.ex = s.cx + h * Math.sin(s.az); s.ey = s.cy + s.r * Math.sin(s.lat); s.ez = s.cz + h * Math.cos(s.az);
}

// One WW logic frame (rideCamera's path for a pilot on the open sea). p holds WW units and radians.
function rideFrame(s, p) {
  s.speed += C.speedSmooth * (p.travel - s.speed); // updateMonitor
  const sp = clamp(s.speed / C.speedRef, -1, 1);
  // setSailAngle: the boom goes to the side the wind blows toward, with hysteresis.
  const rel = wrap(p.windYaw - p.yaw) / WW_ANGLE;
  if (rel > C.sailHysteresis) s.sailAim = -C.sailAngle;
  else if (rel < -C.sailHysteresis) s.sailAim = C.sailAngle;
  else if (s.sailAim === 0) s.sailAim = rel >= 0 ? -C.sailAngle : C.sailAngle;
  s.sail = addCalc(s.sail, s.sailAim, 1 / C.sailCalc.divisor, C.sailCalc.max, C.sailCalc.min);

  s.baseR += C.styleLag * (C.radius - s.baseR); s.speedR += C.styleLag * (C.radiusSpeed - s.speedR);
  s.baseLat += C.styleLag * (C.latitude - s.baseLat); s.speedLat += C.styleLag * (C.latitudeSpeed - s.speedLat);
  const radius = (s.baseR + s.speedR * sp * sp) * p.zoom, fov = C.fov + C.fovSpeed * sp;
  let lat = (s.baseLat + s.speedLat * sp * sp) * D2R + p.lookPitch;
  if (p.hull) {
    // The camera lifts with the swell coming at the bow: the angle from the hull to the sea 200 ahead.
    const ax = p.shipX + C.waveAhead * Math.sin(p.yaw), az = p.shipZ + C.waveAhead * Math.cos(p.yaw);
    const wave = seaSurfaceY(ax * WW_UNIT, az * WW_UNIT) / WW_UNIT; // the drawn sea, at the shared clock
    lat += C.wavePitch * sp * Math.atan2(wave - p.hull.y, C.waveAhead);
  }
  const azimuth = p.yaw + Math.PI + p.lookYaw;

  // Gaze: ahead of and above the pilot's head, pushed to the boom's side as speed builds (x is the pilot's left).
  s.sideK += C.sideLag * (sp - s.sideK);
  const ox = -C.side * Math.sin(s.sail * WW_ANGLE) * s.sideK, oy = C.height + C.heightSpeed * sp, oz = C.ahead;
  const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  s.gazeK += C.gazeLag * (1 - s.gazeK);
  s.gx += (p.x + c * ox + sn * oz - s.gx) * s.gazeK;
  s.gy += (p.y + C.headHeight + oy - s.gy) * s.gazeK;
  s.gz += (p.z - sn * ox + c * oz - s.gz) * s.gazeK;

  if (!s.steady) {
    // Switch-in: close 1 / (20 - k) of every gap, arriving exactly on frame 19.
    const f = 1 / (C.blendFrames - s.k);
    s.cx += (s.gx - s.cx) * f; s.cy += (s.gy - s.cy) * f; s.cz += (s.gz - s.cz) * f;
    s.r += (radius - s.r) * f; s.lat += (lat - s.lat) * f; s.az = wrap(s.az + wrap(azimuth - s.az) * f);
    s.fov += (fov - s.fov) * f;
    if (s.k >= C.blendFrames - 1) s.steady = true;
  } else {
    s.cx += C.followXZ * (s.gx - s.cx); s.cy += C.followY * (s.gy - s.cy); s.cz += C.followXZ * (s.gz - s.cz);
    // Slow or stopped, the latitude target leans toward where the eye already sits: the bob does not tilt the view.
    const hold = sp <= 0.5 ? 2 * (0.5 - sp) : 0;
    const dx = s.ex - s.cx, dz = s.ez - s.cz, current = Math.atan2(s.ey - s.cy, Math.hypot(dx, dz));
    lat += (current - lat) * C.latHold * hold;
    s.r += C.lag * (radius - s.r);
    s.az = wrap(s.az + wrap(azimuth - s.az) * C.azimuthLag);
    s.lat = clamp(s.lat + (lat - s.lat) * C.lag, C.latMin * D2R, C.latMax * D2R);
    s.fov += C.lag * (fov - s.fov);
    s.bank += (C.bank * p.stickX - s.bank) * C.bankRate * Math.abs(sp);
  }
  placeEye(s);
  s.k++;
  return { ex: s.ex, ey: s.ey, ez: s.ez, cx: s.cx, cy: s.cy, cz: s.cz, fov: s.fov, bank: s.bank, speed: sp };
}

function seed(s, p, from) {
  if (finitePoint(from?.eye) && finitePoint(from?.center)) {
    // rideCamera's first frame keeps the current view: radius and latitude become the bases that ease to the style.
    s.cx = from.center.x / WW_UNIT; s.cy = from.center.y / WW_UNIT; s.cz = from.center.z / WW_UNIT;
    const dx = from.eye.x / WW_UNIT - s.cx, dy = from.eye.y / WW_UNIT - s.cy, dz = from.eye.z / WW_UNIT - s.cz;
    s.r = Math.max(1, Math.hypot(dx, dy, dz)); s.lat = Math.atan2(dy, Math.hypot(dx, dz)); s.az = Math.atan2(dx, dz);
    s.fov = num(from.fov, C.fov); s.baseR = s.r; s.speedR = 0; s.baseLat = s.lat / D2R; s.speedLat = 0;
    s.gx = s.cx; s.gy = s.cy; s.gz = s.cz; s.gazeK = C.gazeLag; s.steady = false;
  } else {
    // No view to blend from: start settled behind the pilot.
    s.baseR = C.radius; s.speedR = C.radiusSpeed; s.baseLat = C.latitude; s.speedLat = C.latitudeSpeed;
    s.r = C.radius * p.zoom; s.lat = C.latitude * D2R + p.lookPitch; s.az = wrap(p.yaw + Math.PI + p.lookYaw); s.fov = C.fov;
    s.gx = p.x + Math.sin(p.yaw) * C.ahead; s.gy = p.y + C.headHeight + C.height; s.gz = p.z + Math.cos(p.yaw) * C.ahead;
    s.cx = s.gx; s.cy = s.gy; s.cz = s.gz; s.gazeK = 1; s.steady = true;
  }
  s.k = 0;
  placeEye(s);
}

function toOut(a, b, t) {
  const lerp = (u, v) => u + (v - u) * t;
  return {
    eye: { x: lerp(a.ex, b.ex) * WW_UNIT, y: lerp(a.ey, b.ey) * WW_UNIT, z: lerp(a.ez, b.ez) * WW_UNIT },
    center: { x: lerp(a.cx, b.cx) * WW_UNIT, y: lerp(a.cy, b.cy) * WW_UNIT, z: lerp(a.cz, b.cz) * WW_UNIT },
    fov: lerp(a.fov, b.fov), bank: lerp(a.bank, b.bank) * D2R, speed: b.speed,
  };
}

/**
 * Advance by dt seconds. x, y, z: the pilot's drawn position (our units, y includes the hull sway); yaw: the raft's heading;
 * windYaw: where the wind blows toward; stickX: the steering stick, right positive; hull: the raft's hull-motion state
 * (optional, for the swell term) with shipX / shipZ its centre; from: { eye, center, fov } of the view to blend from on the
 * first call; speed (our u/s, optional) is the raft's sim speed, used instead of the measured travel (Link rides fixed to
 * the boat, so WW's monitor reads the boat's speed; a render hitch cannot inflate it); zoom multiplies the distance; lookYaw / lookPitch (radians) offset the targets. Returns { eye, center } in
 * our units, fov in vertical degrees and bank in radians (positive turns the image counter-clockwise).
 */
export function stepBoatCamera(s, { dt = 0, x = 0, y = 0, z = 0, yaw = 0, windYaw = 0, stickX = 0, hull = null, shipX = x,
  shipZ = z, from = null, speed = NaN, zoom = 1, lookYaw = 0, lookPitch = 0 } = {}) {
  x = num(x); y = num(y); z = num(z);
  const p = { x: x / WW_UNIT, y: y / WW_UNIT, z: z / WW_UNIT, yaw: num(yaw), windYaw: num(windYaw), stickX: clamp(num(stickX), -1, 1),
    hull: hull?.started ? hull : null, shipX: num(shipX, x) / WW_UNIT, shipZ: num(shipZ, z) / WW_UNIT,
    zoom: Math.max(0.1, num(zoom, 1)), lookYaw: num(lookYaw), lookPitch: num(lookPitch), travel: 0 };
  if (!s.started) {
    s.started = true; s.lastX = x; s.lastZ = z; s.acc = 0; s.pendX = s.pendZ = s.pendT = 0;
    seed(s, p, from);
    s.prev = s.cur = rideFrame(s, p);
    s.out = toOut(s.cur, s.cur, 1);
    return s.out;
  }
  s.pendX += x - s.lastX; s.pendZ += z - s.lastZ; s.lastX = x; s.lastZ = z;
  const step = clamp(num(dt), 0, 1);
  s.acc += step; s.pendT += step;
  let n = Math.floor(s.acc / FRAME + 1e-6);
  if (n > C.maxFramesPerStep) { n = C.maxFramesPerStep; s.acc %= FRAME; } else s.acc -= n * FRAME;
  if (s.acc < 1e-9) s.acc = 0;
  if (n > 0) {
    // Travel per WW frame from the time that really passed: a capped slow frame must not read as extra speed.
    p.travel = Number.isFinite(speed) ? Math.abs(speed) / WW_SPEED : Math.hypot(s.pendX, s.pendZ) / Math.max(s.pendT / FRAME, 1e-6) / WW_UNIT;
    s.pendX = s.pendZ = s.pendT = 0;
    for (let i = 0; i < n; i++) { s.prev = s.cur; s.cur = rideFrame(s, p); }
  }
  s.out = toOut(s.prev, s.cur, clamp(s.acc / FRAME, 0, 1));
  return s.out;
}
