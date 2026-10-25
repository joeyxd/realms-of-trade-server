// Client-only hull and rider motion after Wind Waker's boat (research/wind-waker, T-1025-02). Pure maths, no three.js:
// the hull is fed with the raft's drawn x, z, yaw and returns offsets for the visual group. Angles are kept in s16
// units inside (the WW constants are), radians outside; WW logic runs at 30 frames a second from a fixed accumulator,
// so the motion is the same at 30 or 144 fps.
import { NAVAL_HULL as H } from '../../data/navalHull.js';
import { NAVAL_WW, WW_ANGLE, WW_UNIT } from '../../data/navalHandling.js';
import { seaSurfaceAt, seaTime } from './seaSwell.js';

const FRAME = 1 / H.frameRate, TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const wrap = (a) => a - TAU * Math.round(a / TAU);

// cLib addCalc / addCalcAngleS: step = diff * scale; below minStep it moves by minStep without overshoot.
function addCalc(v, target, scale, max, min) {
  const diff = target - v;
  if (diff === 0) return v;
  const step = diff * scale;
  if (Math.abs(step) >= min) return v + clamp(step, -max, max);
  return Math.abs(diff) <= min ? target : v + Math.sign(diff) * min;
}

export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The drawn sea (seaSwell.js: WW's four cosines with our depth fade) in WW units at WW-unit x, z and time t seconds.
const seaWW = (s, x, z, t) => s.sea(x * WW_UNIT, z * WW_UNIT, t) / WW_UNIT;

// sea(x, z, t): the surface height in our units (default the shared drawn sea; tests pass their own).
export function createHullMotion(seed = 0, { sea = seaSurfaceAt } = {}) {
  const zero = () => ({ y: 0, pitch: 0, roll: 0, turn: 0, speed: 0 });
  return {
    rng: mulberry32(typeof seed === 'number' ? seed : hashSeed(seed)), sea, started: false, acc: 0,
    x: 0, z: 0, yaw: 0, pendX: 0, pendZ: 0, pendYaw: 0, pendT: 0,
    y: 0, vy: 0, pitchPos: 0, pitchV: 0, rollPos: 0, rollV: 0, lean: 0, leanV: 0, phNoise: 0, phPitch: 0, phRoll: 0,
    prev: zero(), cur: zero(), out: zero(),
  };
}

// One WW logic frame at sea time t. fwd: forward displacement in WW units; dYaw: yaw change in s16.
function hullFrame(s, wx, wz, yaw, fwd, dYaw, t) {
  const f = Math.min(Math.abs(fwd) / NAVAL_WW.sailMax, 1);
  const water = seaWW(s, wx, wz, t);
  // setYPos (SH:920-958)
  s.y += f * H.speedFollow * (water - s.y);
  s.vy = clamp(s.vy + (water - s.y) * H.ySpring, -H.vyMax, H.vyMax);
  s.y += s.vy;
  s.phNoise = (s.phNoise + H.noisePhase.base + s.rng() * H.noisePhase.rand + H.noisePhase.speed * f) % 65536;
  s.y += f * H.noiseAmp * Math.sin(s.phNoise * WW_ANGLE) + H.noiseLift;
  s.vy = addCalc(s.vy, 0, H.vyDecay.scale, H.vyDecay.max, H.vyDecay.min);
  s.y = clamp(s.y, water - H.yBelow, water + H.yAbove);
  const ps = H.pitchSway, rs = H.rollSway;
  s.phPitch = (s.phPitch + (f * 0.5 + 1) * (s.rng() * ps.phaseMin + ps.phaseMin)) % 65536;
  s.phRoll = (s.phRoll + (f * 0.5 + 1) * (s.rng() * rs.phaseMin + rs.phaseMin)) % 65536;
  s.pitchPos += f * ps.amp * Math.sin(s.phPitch * WW_ANGLE) + ps.lift;
  s.rollPos += f * rs.amp * Math.sin(s.phRoll * WW_ANGLE) + rs.lift;
  // setWaveAngle (SH:808-849): four probes on the sea, yaw only (the hull tilt moves them by less than 1 percent).
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  const probe = (lx, lz) => seaWW(s, wx + lx * cs + lz * sn, wz - lx * sn + lz * cs, t);
  const front = probe(0, H.probeFront), back = probe(0, H.probeBack), left = probe(H.probeSide, 0), right = probe(-H.probeSide, 0);
  const pitchAim = Math.atan2(-(front - back), H.probeFront - H.probeBack) / WW_ANGLE;
  const rollAim = Math.atan2(-(right - left), 2 * H.probeSide) / WW_ANGLE;
  const d = H.springDecay;
  s.rollV += (rollAim - s.rollPos) * H.waveSpring;
  s.rollPos += s.rollV;
  s.rollV = addCalc(s.rollV, 0, 1 / d.divisor, d.max, d.min);
  s.pitchV += (pitchAim - s.pitchPos) * H.waveSpring;
  s.pitchPos += s.pitchV;
  s.pitchV = addCalc(s.pitchV, 0, 1 / d.divisor, d.max, d.min);
  // setControllAngle (SH:775-789): the lean spring chases the yaw change of this frame.
  const aim = clamp(dYaw * H.leanGain, -H.leanMax, H.leanMax);
  s.leanV += (aim - s.lean) * H.leanSpring;
  s.lean += s.leanV;
  s.leanV = addCalc(s.leanV, 0, 1 / d.divisor, d.max, d.min);
  // Tiller read back from the measured yaw rate (SH:1113-1134 inverted), positive = yaw growing.
  const turnRate = clamp(H.turnBase - H.turnSlope * f, H.turnMin, H.turnMax);
  // y over the still level: the water is drawn with the same swell, so the hull rides it.
  return { y: s.y * WW_UNIT, pitch: s.pitchPos * WW_ANGLE, roll: (s.lean + s.rollPos) * WW_ANGLE,
    turn: clamp(dYaw / (turnRate * H.tillerMax / H.tillerShift), -1, 1), speed: f };
}

// Advance by dt seconds with the raft's drawn pose (our units, radians); returns { y, pitch, roll, turn, speed }:
// y in our units over the still level (the swell included), pitch about the raft-local x axis, roll about local z (both radians), turn the tiller ratio in [-1, 1].
export function stepHullMotion(s, { dt = 0, x = 0, z = 0, yaw = 0 } = {}) {
  x = num(x); z = num(z); yaw = num(yaw);
  if (!s.started) {
    s.started = true;
    s.x = x; s.z = z; s.yaw = yaw;
    s.y = seaWW(s, x / WW_UNIT, z / WW_UNIT, seaTime()); // first call snaps to the water (SH:889-895)
    s.out = { y: s.y * WW_UNIT, pitch: 0, roll: 0, turn: 0, speed: 0 };
    s.prev = { ...s.out }; s.cur = { ...s.out };
    return s.out;
  }
  s.pendX += x - s.x; s.pendZ += z - s.z; s.pendYaw += wrap(yaw - s.yaw);
  s.x = x; s.z = z; s.yaw = yaw;
  const step = clamp(num(dt), 0, 1);
  s.acc += step; s.pendT += step;
  let n = Math.floor(s.acc / FRAME + 1e-6);
  if (n > H.maxFramesPerStep) { n = H.maxFramesPerStep; s.acc %= FRAME; } else s.acc -= n * FRAME;
  if (s.acc < 1e-9) s.acc = 0;
  if (n > 0) {
    // Rates per WW frame come from the time that really passed, not from the frames run: a slow render
    // frame capped at maxFramesPerStep must not read as extra speed or turn.
    const frames = Math.max(s.pendT / FRAME, 1e-6);
    const fwd = (s.pendX * Math.sin(yaw) + s.pendZ * Math.cos(yaw)) / frames / WW_UNIT, dYaw = s.pendYaw / frames / WW_ANGLE;
    s.pendX = s.pendZ = s.pendYaw = s.pendT = 0;
    const now = seaTime();
    for (let i = 0; i < n; i++) {
      s.prev = s.cur;
      s.cur = hullFrame(s, x / WW_UNIT, z / WW_UNIT, yaw, fwd, dYaw, now - (n - 1 - i) * FRAME);
    }
  }
  const t = clamp(s.acc / FRAME, 0, 1), a = s.prev, b = s.cur;
  s.out = { y: a.y + (b.y - a.y) * t, pitch: a.pitch + (b.pitch - a.pitch) * t, roll: a.roll + (b.roll - a.roll) * t,
    turn: b.turn, speed: b.speed };
  return s.out;
}

export function createRiderMotion() {
  return { started: false, acc: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, body: 0, out: { pitch: 0, roll: 0, twist: 0 } };
}

// The pilot's body on the boat: pitch and roll chase the hull's with a lag (S:181-186), the body twists into the turn by
// 2000 s16 times the tiller ratio (S:232-236). `turn` defaults to hull.turn (positive = yaw growing). Returns radians.
export function stepRiderMotion(r, hull, turn = hull.turn, dt = 0) {
  const R = H.rider, shipX = num(hull.pitch) / WW_ANGLE, shipZ = num(hull.roll) / WW_ANGLE;
  if (!r.started) {
    r.started = true;
    r.pitch = shipX; r.roll = shipZ;
  } else {
    r.acc += clamp(num(dt), 0, 1);
    let n = Math.floor(r.acc / FRAME + 1e-6);
    if (n > H.maxFramesPerStep) { n = H.maxFramesPerStep; r.acc %= FRAME; } else r.acc -= n * FRAME;
    if (r.acc < 1e-9) r.acc = 0;
    const target = R.turnLean * clamp(num(turn), -1, 1);
    for (let i = 0; i < n; i++) {
      r.pitch += r.pitchV;
      r.pitchV = addCalc(r.pitchV + R.pitchSpring * (shipX - r.pitch), 0, R.pitchDecay.scale, R.pitchDecay.max, R.pitchDecay.min);
      r.roll += r.rollV;
      r.rollV = addCalc(r.rollV + R.rollSpring * (shipZ - r.roll), 0, R.rollDecay.scale, R.rollDecay.max, R.rollDecay.min);
      r.body = addCalc(r.body, target, R.leanDecay.scale, R.leanDecay.max, R.leanDecay.min);
    }
  }
  r.out = { pitch: r.pitch * WW_ANGLE, roll: r.roll * WW_ANGLE, twist: r.body * WW_ANGLE };
  return r.out;
}
