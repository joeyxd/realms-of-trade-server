// Pure WW ship water effects, B1-B4 of research/wind-waker/05-vela-y-agua.md (T-1025-10). No three, no sim.
// WW logic runs at 30 Hz from a dt accumulator; positions are our units, WW speeds and rates stay in WW units.
// Side index: 0 = left (+x of the boat), 1 = right. Lists are newest first (index 0 is age 0).
import { NAVAL_WAKE as K } from '../../data/navalWake.js';
import { WW_UNIT, WW_ANGLE } from '../../data/navalHandling.js';

const FRAME = 1 / K.frameRate, O = K.ours;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const unit = (d) => { const l = Math.hypot(d[0], d[1], d[2]); return [d[0] / l, d[1] / l, d[2] / l]; };
const DIR = [unit(K.dirLeft), unit(K.dirRight)];
const WAVE_FIELDS = ['x', 'z', 'h', 'vx', 'vz', 'vy', 'g', 'age'];
const ROW_FIELDS = ['cx', 'cz', 'lx', 'lz', 'hf'];
const zeroSurface = () => 0;

function shift(obj, fields, n, cap) {
  const count = Math.min(n, cap - 1);
  if (count > 0) for (const f of fields) obj[f].copyWithin(1, 0, count);
}

export function createWake(rig, { mobile = false } = {}) {
  const key = mobile ? 'mobile' : 'desktop', cap = O.waveCap[key], rows = O.trackRows[key];
  const w = { acc: 0, fwd: 0, k: WW_UNIT, beam: 2, scale: 1, cap, rows, every: O.waveEvery[key], burst: 0,
    waveOn: false, bow: { x: 0, y: 0, z: 0 }, anchorsLocal: [[[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0]]],
    anchors: [new Float32Array(6), new Float32Array(6)],
    splash: { scale: 0, speed: 0, pending: 0 },
    waves: [0, 1].map(() => {
      const e = { n: 0, speed: 0, frozen: 0, phase: 0, y: new Float32Array(cap) };
      for (const f of WAVE_FIELDS) e[f] = new Float32Array(cap);
      return e;
    }),
    track: { n: 0, alpha: 0, scroll: 0, cap: rows, tx: new Float32Array(rows * 3), ty: new Float32Array(rows * 3), tz: new Float32Array(rows * 3) } };
  for (const f of ROW_FIELDS) w.track[f] = new Float32Array(rows);
  setWakeRig(w, rig);
  return w;
}

// Hull offsets scale with the raft: WW's boat is 565 u = 7.2 of ours.
export function setWakeRig(w, rig) {
  const length = Number(rig?.length) > 0 ? rig.length : K.refLength;
  w.scale = length / K.refLength; w.k = WW_UNIT * w.scale;
  w.beam = Number(rig?.beam) > 0 ? rig.beam : 2;
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? -1 : 1; // anchors are listed for the right side; the left negates x
    for (let a = 0; a < 2; a++) {
      const src = K.anchors[a], dst = w.anchorsLocal[side][a];
      dst[0] = sign * src[0] * w.k; dst[1] = src[1] * w.k; dst[2] = src[2] * w.k;
    }
  }
  return w;
}

// Cadence of the landing burst (SH:2945-2959) for vy in WW units per frame.
export function landingCount(vyWW) {
  const n = K.landingBase + K.landingGain * (-(num(vyWW) - K.landingRef) / K.landingSpan);
  return Math.round(clamp(n, K.landingMin, K.landingMax));
}

// vy: our units per second. Queues the puffs for the effects to spawn at the bow point.
export function landing(w, vy) {
  const n = landingCount(num(vy) / (WW_UNIT * K.frameRate));
  w.burst += n;
  return n;
}

function emitWave(w, e, side, bx, bz, sin, cos) {
  const d = DIR[side], speed = e.speed * WW_UNIT;
  shift(e, WAVE_FIELDS, e.n, w.cap);
  const vy = d[1] * speed * O.crestRise;
  e.x[0] = bx; e.z[0] = bz; e.h[0] = 0; e.age[0] = 0;
  e.vx[0] = (d[0] * cos + d[2] * sin) * speed;
  e.vz[0] = (-d[0] * sin + d[2] * cos) * speed;
  e.vy[0] = vy; e.g[0] = 2 * vy / (O.waveLife - 1); // the crest is back on the surface at end of life
  if (e.n < w.cap) e.n++;
}

function frame(w, i) {
  const fwd = i.fwd, prev = w.fwd;
  const signOk = Math.abs(prev) <= K.stopEpsilon || Math.sign(fwd) === Math.sign(prev);
  w.fwd = fwd;
  const running = Math.abs(fwd) > K.stopEpsilon && signOk && !i.flying;
  const abs = Math.abs(fwd);
  if (!running) w.waveOn = false; else if (!w.waveOn && abs > K.waveStart) w.waveOn = true;
  const bowDist = fwd * WW_UNIT + K.bowAhead * w.k;
  const bx = i.x + i.sin * bowDist, bz = i.z + i.cos * bowDist;
  const kRoll = clamp(i.roll / WW_ANGLE / K.rollUnit, -K.rollMax, K.rollMax);
  for (let side = 0; side < 2; side++) {
    const e = w.waves[side];
    if (w.waveOn) {
      e.frozen = 0;
      const pitch = side === 1 ? 1 + kRoll : 1 - kRoll;
      const want = K.waveFactor * Math.min(abs, K.waveDispMax) * pitch;
      e.speed = clamp(e.speed + clamp(want - e.speed, -K.waveSlew, K.waveSlew), 0, K.waveSpeedMax);
      for (let p = 0; p < e.n; p++) {
        e.x[p] += e.vx[p]; e.z[p] += e.vz[p]; e.h[p] += e.vy[p]; e.vy[p] -= e.g[p]; e.age[p]++;
      }
      while (e.n > 0 && e.age[e.n - 1] >= O.waveLife) e.n--;
      if (e.phase++ % w.every === 0) emitWave(w, e, side, bx, bz, i.sin, i.cos);
    } else {
      e.speed = 0; e.phase = 0;
      if (e.n > 0) { if (++e.frozen >= K.freezeFrames) { e.n = 0; e.frozen = 0; } } else e.frozen = 0;
    }
  }
  const sp = w.splash;
  if (w.waveOn) { sp.scale = Math.min(abs / K.splashFull, 1); sp.speed = K.splashSpeed * sp.scale; }
  else { sp.scale = Math.max(0, sp.scale - K.splashFall); sp.speed = 0; }
  if (sp.scale > 0) sp.pending += Math.round(O.puffBase + O.puffGain * sp.scale);
  const t = w.track;
  t.scroll += K.trackScroll;
  if (running && abs > K.trackStart) {
    t.alpha = Math.min(K.trackAlphaMax, t.alpha + K.trackRise);
    shift(t, ROW_FIELDS, t.n, t.cap);
    const back = K.sternBack * w.k;
    t.cx[0] = i.x - i.sin * back; t.cz[0] = i.z - i.cos * back;
    t.lx[0] = i.cos; t.lz[0] = -i.sin; t.hf[0] = w.beam / 2;
    if (t.n < t.cap) t.n++;
  } else {
    t.alpha -= running ? K.trackFall : K.trackFallStop;
    if (t.n > 0) t.n--; // the oldest row leaves, so the tail recedes while the alpha falls
    if (t.alpha <= 0) { t.alpha = 0; t.n = 0; }
  }
}

/** Advance by dt seconds. surfaceAt(x, z): the drawn surface height. hullY: the hull's height (our units, same frame as the surface). */
export function stepWake(w, { dt = 0, x = 0, z = 0, yaw = 0, vx = 0, vz = 0, roll = 0, hullY, surfaceAt } = {}) {
  x = num(x); z = num(z); yaw = num(yaw);
  const surf = typeof surfaceAt === 'function' ? surfaceAt : zeroSurface;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const fwd = (num(vx) * sin + num(vz) * cos) * FRAME / WW_UNIT; // horizontal displacement per WW frame along the heading
  const flying = Number.isFinite(hullY) && hullY - surf(x, z) > K.flyHeight * WW_UNIT;
  w.acc += clamp(num(dt), 0, 1);
  let n = Math.floor(w.acc / FRAME + 1e-6);
  if (n > K.maxFramesPerStep) { n = K.maxFramesPerStep; w.acc %= FRAME; } else w.acc -= n * FRAME;
  if (w.acc < 1e-9) w.acc = 0;
  const input = { fwd, x, z, sin, cos, roll: num(roll), flying };
  for (let f = 0; f < n; f++) frame(w, input);
  // Everything drawn rides the swell of this moment.
  const bowDist = fwd * WW_UNIT + K.bowAhead * w.k;
  w.bow.x = x + sin * bowDist; w.bow.z = z + cos * bowDist; w.bow.y = surf(w.bow.x, w.bow.z);
  for (let side = 0; side < 2; side++) {
    const out = w.anchors[side];
    for (let a = 0; a < 2; a++) {
      const l = w.anchorsLocal[side][a];
      const ax = x + l[0] * cos + l[2] * sin, az = z - l[0] * sin + l[2] * cos;
      out[a * 3] = ax; out[a * 3 + 1] = surf(ax, az) + l[1]; out[a * 3 + 2] = az;
    }
    const e = w.waves[side];
    for (let p = 0; p < e.n; p++) e.y[p] = surf(e.x[p], e.z[p]) + e.h[p];
  }
  const t = w.track, lift = K.trackHeight * WW_UNIT;
  for (let r = 0; r < t.n; r++) {
    for (let c = 0; c < 3; c++) {
      const s = (1 - c) * t.hf[r], j = r * 3 + c; // column 0 (u 0) is the left side, +x of the boat
      const px = t.cx[r] + t.lx[r] * s, pz = t.cz[r] + t.lz[r] * s;
      t.tx[j] = px; t.tz[j] = pz; t.ty[j] = surf(px, pz) + lift;
    }
  }
  return w;
}
