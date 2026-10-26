import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { WW_SPEED, WW_UNIT, NAVAL_WW as W } from '../src/data/navalHandling.js';
import { buildNavalRig, newNavalState, stepNaval } from '../src/sim/naval/handling.js';

const rig = buildNavalRig(STARTER_RAFT), wind = NAVAL_TRIAL.wind, env = { handling: 'windwaker' };
const target = 55 * WW_SPEED;
const forward = (s) => s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
const step = (s, input, w = wind, e = env) => stepNaval(s, input, rig, w, e);
// A sailing state: hoisted mast, heading 0 (with the wind), the given forward speed in WW units per frame.
const sailing = (speed, extra = {}) => ({ ...newNavalState(), mast: W.mastEnd, vz: speed * WW_SPEED, ...extra });
const sail = { throttle: 1, brake: 0, steer: 0 };
const close = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} versus ${expected} (tolerance ${tolerance})`);

test('hoisting bursts exactly once, to min(2 * target, 80), then the fast decrement settles on the target', () => {
  let s = newNavalState(), bursts = 0, crossing = 0;
  for (let tick = 1; tick <= 600; tick++) {
    const before = s;
    s = step(s, sail);
    if (before.burst === undefined ? s.burst > 0 : s.burst > 0 && !(before.burst > 0)) { bursts++; crossing = tick; }
    if (tick < crossing || !crossing) assert.ok(forward(s) < 1, 'the sail is not ON before frame 7');
  }
  assert.equal(bursts, 1);
  assert.equal(crossing, 5, 'mast 7.5 at the fifth tick (1.5 per tick)');
  let probe = newNavalState();
  for (let i = 0; i < 5; i++) probe = step(probe, sail);
  close(forward(probe), 80 * WW_SPEED, 1e-9, 'burst speed');
  close(probe.burst, target, 1e-9, 'burst remembers the target');
  assert.equal(s.burst, 0, 'the burst is spent');
  close(forward(s), target, target * 0.01, 'settles on the target');
});

test('no burst when already faster, and lowering the sail drops the mast at once', () => {
  const fast = step({ ...newNavalState(), mast: 6, vz: 31 }, sail);
  assert.ok(fast.mast >= W.mastSailOn);
  assert.ok(!(fast.burst > 0), 'faster than the burst value: nothing to add');
  const lowered = step({ ...sailing(40), burst: 20 }, { throttle: 0, brake: 0, steer: 0 });
  assert.equal(lowered.mast, 0);
});

test('jump gate: every condition blocks and the press fires', () => {
  const press = { ...sail, jump: 1 };
  const ok = step(sailing(30), press);
  assert.equal(ok.fly, 1);
  close(ok.vy, 40 * WW_SPEED, 1e-9, 'vy = clamp(target, 15, 40)');
  assert.equal(step(sailing(30), sail).fly ?? 0, 0, 'no key');
  assert.equal(step(sailing(30, { fly: 1, y: 1 }), press).y > 0, true);
  assert.equal(step(sailing(30, { mast: 5 }), press).fly, 0, 'sail not ON');
  assert.equal(step(sailing(16), press).fly, 0, 'too slow');
  assert.equal(step(sailing(30), press, { yaw: 0, strength: 0.05 }).fly, 0, 'sail target under 11');
  assert.equal(step(sailing(30, { jumpLatch: 1 }), press).fly, 0, 'key still held');
  assert.equal(step(sailing(30), { ...press, throttle: 0 }).fly, 0, 'sail furled');
});

test('a held or reused command jumps once and a release re-arms the key', () => {
  let s = sailing(30), jumps = 0;
  const press = { ...sail, jump: 1 };
  for (let i = 0; i < 400; i++) { const n = step(s, press); if (n.fly === 1 && s.fly !== 1) jumps++; s = n; }
  assert.equal(jumps, 1);
  assert.equal(s.fly, 0);
  s = step(s, sail);
  const again = step(s, press);
  assert.equal(again.fly, 1, 'released, then pressed again');
});

test('apex and airtime match Wind Waker for the full jump', () => {
  let s = step(sailing(30), { ...sail, jump: 1 }), apex = 0, ticks = 0;
  while (s.fly === 1 && ticks < 400) { s = step(s, sail); apex = Math.max(apex, s.y); ticks++; }
  close(apex / WW_UNIT, 320, 32, 'apex in WW units');
  close(ticks / 2, 32, 2, 'airtime in WW frames');
});

test('steering is frozen in the air, speed is kept, the lean halves, landing costs 15 percent', () => {
  const start = sailing(30, { helm: 0.4 });
  let s = step(start, { ...sail, steer: 1, jump: 1 });
  assert.ok(Math.abs(s.helm) < 0.4 * 0.75, 'the tiller halves at the jump');
  const yaw = s.yaw, speed = Math.hypot(s.vx, s.vz);
  let last = s, previousHelm = Math.abs(s.helm);
  while (s.fly === 1) {
    last = s; s = step(s, { ...sail, steer: 1, jump: 1 });
    if (s.fly !== 1) break;
    close(s.yaw, yaw, 1e-12, 'yaw frozen');
    assert.ok(Math.abs(s.helm) <= previousHelm + 1e-12, 'tiller driven to 0');
    previousHelm = Math.abs(s.helm);
    close(Math.hypot(s.vx, s.vz), speed, 1e-9, 'forward speed kept');
  }
  close(Math.hypot(s.vx, s.vz), speed * W.landSpeed, 1e-9, 'landing speed x0.85');
  assert.equal(s.y, 0);
  assert.equal(s.land, 30);
  close(s.vy, -15 * WW_SPEED, 1e-9, 'landing vy floor');
  assert.ok(last.vy < s.vy, 'the pre-landing vy is the faster fall');
  for (let i = 0; i < 60; i++) s = step(s, sail);
  assert.equal(s.land, 0);
});

test('the landing counter blends the turn rate (SH:1113-1134)', () => {
  const yawStep = (land) => step(sailing(30, { helm: 0.3, land }), sail).yaw;
  const rate = (land) => { const t = Math.max(0.1, Math.min(3.6, 4 - 3 * 30 / 55)); return land >= 15 ? 3.6 : t + (3.6 - t) * land / 15; };
  for (const land of [0, 7.5, 15, 30]) close(yawStep(land) / yawStep(0), rate(land) / rate(0), 1e-9, `land ${land}`);
});

test('malformed jump fields are rejected and the lab path ignores them', () => {
  for (const bad of [{ fly: 2 }, { mast: -1 }, { mast: 31 }, { burst: NaN }, { y: 'a' }, { y: -1 }, { vy: 1e6 }, { land: 99 }, { jumpLatch: 0.5 }])
    assert.throws(() => step({ ...newNavalState(), ...bad }, sail), TypeError, JSON.stringify(bad));
  const lab = {};
  const plain = stepNaval({ ...newNavalState(), vz: 3 }, sail, rig, wind, lab);
  const jumped = stepNaval({ ...newNavalState(), vz: 3, mast: 30, fly: 1, y: 2, vy: 3 }, { ...sail, jump: 1 }, rig, wind, lab);
  assert.deepEqual({ ...jumped }, { ...plain });
  assert.ok(!('fly' in plain));
});
