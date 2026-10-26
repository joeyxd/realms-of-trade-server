// A deterministic aggregate body for D08's isolated handling bay. Nothing here loads a profile,
// changes goods, or attaches a raft to the live world. Fixed ticks are independent of render FPS.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { NAVAL_HANDLING as H, NAVAL_STEP, NAVAL_WW as W, WW_SPEED, WW_ANGLE, WW_FRAME_TICKS } from '../../data/navalHandling.js';
import { NAVAL_NAVIGATION as N } from '../../data/navalNavigation.js';
import { PILOTING } from '../../data/progression.js';
export { NAVAL_STEP };

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
const wrap = (n) => Math.atan2(Math.sin(n), Math.cos(n));
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
export const isValidHelmResponse = (value) => value === 1 || value === PILOTING.rudderMultiplier;

export function buildNavalRig(parts, cargo = []) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 600 || !Array.isArray(cargo) || cargo.length > 600)
    throw new TypeError('Invalid lab blueprint or ballast');
  const masses = [], bases = [];
  let dryMass = 0, cargoMass = 0, buoyancy = 0, sail = 0;
  for (const part of parts) {
    if (!Array.isArray(part)) throw new TypeError('Invalid lab part');
    const [id, x, z, level, dir = 0] = part, p = RAFT_PARTS[id];
    if (!p || ![x, z, level, dir].every(Number.isInteger) || Math.abs(x) > 12 || Math.abs(z) > 12 ||
      level < 0 || level >= RAFT.levels || dir < 0 || dir > 3) throw new TypeError('Invalid lab part');
    const size = p.size || [1, 1];
    let cx = (x + size[0] / 2) * RAFT.cell, cz = (z + size[1] / 2) * RAFT.cell;
    if (p.layer === 'edge') {
      cx = (x + (dir === 1 ? 1 : dir === 3 ? 0 : 0.5)) * RAFT.cell;
      cz = (z + (dir === 2 ? 1 : dir === 0 ? 0 : 0.5)) * RAFT.cell;
    }
    masses.push({ mass: p.weight, x: cx, z: cz, height: level * RAFT.levelHeight,
      intrinsic: RAFT.cell ** 2 * (size[0] ** 2 + size[1] ** 2) / 12 });
    dryMass += p.weight; sail += p.sail || 0;
    if (p.floats) { buoyancy += RAFT.buoyancy * p.floats; bases.push({ x: cx, z: cz }); }
  }
  if (!bases.length) throw new TypeError('A handling fixture needs flotation');
  for (const c of cargo) {
    if (!c || ![c.mass, c.x, c.z, c.height ?? 0].every(finite) || c.mass <= 0 || c.mass > 10000 ||
      Math.abs(c.x) > 26 || Math.abs(c.z) > 26 || (c.height ?? 0) < 0 || (c.height ?? 0) > 8)
      throw new TypeError('Invalid lab ballast');
    masses.push({ ...c, height: c.height ?? 0, intrinsic: RAFT.cell ** 2 / 6 });
    cargoMass += c.mass;
  }
  const mass = dryMass + cargoMass;
  const cx = masses.reduce((n, c) => n + c.mass * c.x, 0) / mass;
  const cz = masses.reduce((n, c) => n + c.mass * c.z, 0) / mass;
  const height = masses.reduce((n, c) => n + c.mass * c.height, 0) / mass;
  const inertia = masses.reduce((n, c) => n + c.mass * ((c.x - cx) ** 2 + (c.z - cz) ** 2 + c.intrinsic), 0);
  const minX = Math.min(...bases.map((b) => b.x)) - RAFT.cell / 2;
  const maxX = Math.max(...bases.map((b) => b.x)) + RAFT.cell / 2;
  const minZ = Math.min(...bases.map((b) => b.z)) - RAFT.cell / 2;
  const maxZ = Math.max(...bases.map((b) => b.z)) + RAFT.cell / 2;
  const beam = maxX - minX, length = maxZ - minZ;
  const imbalance = Math.hypot((cx - (minX + maxX) / 2) / (beam / 2), (cz - (minZ + maxZ) / 2) / (length / 2));
  const load = mass / buoyancy;
  const stability = 1 / (1 + 0.7 * imbalance + 0.18 * height);
  const flotation = 1 / (1 + 3 * Math.max(0, load - 1) ** 2);
  const wetted = (bases.length / 4) ** 0.7 * (1 + 0.7 * load ** 2);
  return Object.freeze({ dryMass, cargoMass, mass, buoyancy, load, cx, cz, height, inertia,
    beam, length, hullCx: (minX + maxX) / 2, hullCz: (minZ + maxZ) / 2,
    imbalance, stability, flotation, wetted, sail, cells: bases.length });
}

export function newNavalState() { return { tick: 0, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, omega: 0, helm: 0 }; }

function addCalcTick(value, target, scale, maxStep, minStep) {
  const diff = target - value;
  if (diff === 0) return value;
  const step = Math.abs(diff * scale) >= minStep
    ? Math.min(Math.abs(diff) * (1 - Math.sqrt(1 - scale)), maxStep / WW_FRAME_TICKS)
    : Math.min(Math.abs(diff), minStep / WW_FRAME_TICKS);
  return value + Math.sign(diff) * step;
}

// Jump-and-hoist state of the WW path. Every field is optional and absent means 0, so older states stay valid.
// mast: FN_MAST_ON2 anim frame; burst: mTargetSpeed in u/s (0 = none); y/vy: height above the sea and its rate;
// fly: 0|1; land: m0388 turn-boost counter in WW frames; jumpLatch: the jump key was held last tick.
const WW_FIELDS = Object.freeze({
  mast: W.mastEnd, burst: W.burstMax * WW_SPEED, y: 20, vy: W.maxFall * WW_SPEED, fly: 1, land: W.landFrames, jumpLatch: 1 });
export function validWindWakerFields(state) {
  return Object.entries(WW_FIELDS).every(([key, max]) => !Object.hasOwn(state, key) || (finite(state[key]) &&
    (key === 'vy' ? Math.abs(state[key]) <= max + 1e-9 : state[key] >= 0 && state[key] <= max + 1e-9) &&
    (key !== 'fly' && key !== 'jumpLatch' || state[key] === 0 || state[key] === 1)));
}
// Zeroes the WW fields a state carries (parked or disabled hull), leaving a state without them as it was.
export function settleWindWakerFields(state) {
  const out = { ...state };
  for (const key of Object.keys(WW_FIELDS)) if (Object.hasOwn(out, key)) out[key] = 0;
  return out;
}

function stepWindWaker(state, rig, wind, throttle, brake, steer, jump, forward, waterX, waterZ, multiplier, maxSpeed, helmResponse) {
  const flying = state.fly === 1, land = state.land ?? 0, ground = (n) => (flying ? 0 : n);
  // In the air the tiller is driven to 0 at its usual rate and the yaw is frozen (SH:1587, 1661-1664).
  const helm = addCalcTick(state.helm ?? 0, ground(steer * W.tillerMax * WW_ANGLE),
    1 / W.tillerDivisor, W.tillerMaxStep * WW_ANGLE, W.tillerMinStep * WW_ANGLE);
  let turnRate = clamp(W.turnBase - W.turnSlope * Math.abs(forward) / (W.sailMax * WW_SPEED), W.turnMin, W.turnMax);
  // The landing counter blends the rate up to the maximum (SH:1121-1126).
  turnRate = land >= W.landFull ? W.turnMax : turnRate + (W.turnMax - turnRate) * land / W.landFull;
  const turn = flying ? 0 : turnRate * helm / W.tillerShift / WW_FRAME_TICKS * helmResponse * rig.flotation;
  const yaw = wrap(state.yaw + turn), a = Math.abs(wrap((finite(wind?.yaw) ? wind.yaw : 0) - yaw)) / WW_ANGLE;
  const factor = a < W.windBeam ? 1 - a / 65536 : a <= W.windQuarter
    ? W.factorBeam - (a - W.windBeam) * W.slopeMid : Math.max(0, W.factorQuarter - (a - W.windQuarter) * W.slopeBack);
  const envelope = W.sailMax * WW_SPEED * maxSpeed / H.maxSpeed;
  const sailTarget = rig.sail > 0 ? Math.min(envelope, throttle * Math.min(1, clamp(wind?.strength, 0, 1) / W.windNormal)
    * factor * W.sailMax * WW_SPEED * multiplier * rig.flotation) : 0;
  // The mast rises while the lever is up and drops at once when it is furled; the sail is ON from frame 7 (SH:1591).
  const lastMast = state.mast ?? 0;
  const mast = throttle > 0 ? Math.min(W.mastEnd, lastMast + W.mastRate / WW_FRAME_TICKS) : 0;
  const sailOn = mast >= W.mastSailOn;
  const paddleTarget = throttle * W.paddleMax * WW_SPEED * rig.flotation;
  // Our single lever takes the higher sail/paddle target, so a headwind still permits paddling.
  const sailing = sailOn && sailTarget > 0 && sailTarget >= paddleTarget;
  const target = brake > 0 ? 0 : sailing ? sailTarget : paddleTarget;
  const params = brake > 0 ? W.stopBrake : sailing && forward < sailTarget ? W.sailAccel : W.coast;
  const amount = brake > 0 ? brake : 1;
  const fd = W.firstDecrement;
  let burst = state.burst ?? 0, speed = forward, y = state.y ?? 0, vy = state.vy ?? 0, fly = flying ? 1 : 0;
  let nextLand = Math.max(0, land - 1 / WW_FRAME_TICKS), nextHelm = helm;
  if (flying) {
    // Forward speed is kept (no accel, no coast); gravity with a fall cap (SH:4612-4613, 1147).
    vy = Math.max(vy - W.gravity * WW_SPEED / WW_FRAME_TICKS, -W.maxFall * WW_SPEED);
    y += vy * NAVAL_STEP;
    if (y <= 0) {
      // Landing (SH:900-917).
      y = 0; fly = 0; vy = Math.max(vy, -W.landVy * WW_SPEED); speed *= W.landSpeed; nextLand = W.landFrames;
    }
  } else {
    if (throttle > 0 && lastMast < W.mastSailOn && sailOn) {
      // Hoist burst, exactly once as the mast passes frame 7 (SH:1616-1628).
      const lurch = Math.min(W.burstFactor * sailTarget, W.burstMax * WW_SPEED);
      if (forward < lurch) { speed = lurch; burst = sailTarget; }
    } else if (brake <= 0 && burst > 0 && burst < forward) {
      // Burst leftover: the fast brake toward the sail target, spent once the gap is under 3 (SH:1629-1630, 1095-1099).
      // Our brake lever overrides it (WW sail mode has no brake) and spends the burst.
      speed = addCalcTick(forward, burst, fd.scale, fd.maxStep * WW_SPEED, fd.minStep * WW_SPEED);
      if (Math.abs(speed - burst) < W.burstGap * WW_SPEED) burst = 0;
    } else {
      burst = 0;
      speed = addCalcTick(forward, target, params.scale, params.maxStep * WW_SPEED * amount, params.minStep * WW_SPEED * amount);
    }
    // Jump gate (SH:1638-1659): sail up, fast enough, a real sail target and a fresh key press.
    if (sailOn && forward > W.jumpSpeed * WW_SPEED && sailTarget >= W.jumpTarget * WW_SPEED && jump && !state.jumpLatch) {
      fly = 1;
      vy = clamp(sailTarget / WW_SPEED, W.jumpVyMin, W.jumpVyMax) * WW_SPEED;
      // WW halves the lean m036C; our nearest field is the tiller.
      nextHelm = helm / 2;
    }
  }
  const cap = burst > 0 ? envelope * W.burstMax / W.sailMax : envelope;
  let vx = speed * Math.sin(yaw) + waterX, vz = speed * Math.cos(yaw) + waterZ;
  const total = Math.hypot(vx, vz);
  if (total > cap) { vx *= cap / total; vz *= cap / total; }
  return { tick: state.tick + 1, x: state.x + vx * NAVAL_STEP, z: state.z + vz * NAVAL_STEP,
    yaw, vx, vz, omega: turn / NAVAL_STEP, helm: nextHelm, mast, burst, y, vy, fly, land: nextLand, jumpLatch: jump ? 1 : 0 };
}

export function windEfficiency(yaw, wind) {
  const strength = clamp(wind?.strength, 0, 1);
  const alignment = Math.cos(yaw - (finite(wind?.yaw) ? wind.yaw : 0));
  return strength * (H.headwindEfficiency + (1 - H.headwindEfficiency) * Math.sqrt(Math.max(0, (alignment + 1) / 2)));
}

export function stepNaval(state, input, rig, wind, environment = {}) {
  if (!state || !['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((k) => finite(state[k])) ||
    (Object.hasOwn(state, 'helm') && (!finite(state.helm) || Math.abs(state.helm) > Math.PI / 4 + 1e-9)) || !validWindWakerFields(state) ||
    !Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick >= Number.MAX_SAFE_INTEGER ||
    Math.abs(state.x) > 1e9 || Math.abs(state.z) > 1e9 || Math.hypot(state.vx, state.vz) > 100 || Math.abs(state.omega) > 10 ||
    !rig || !['mass', 'inertia', 'sail', 'flotation', 'wetted', 'stability', 'cells'].every((k) => finite(rig[k])) ||
    rig.mass <= 0 || rig.inertia <= 0 || rig.sail < 0 || rig.flotation <= 0 || rig.wetted <= 0 || rig.stability <= 0 || rig.cells < 1)
    throw new TypeError('Invalid naval body');
  const helmResponse = environment && Object.hasOwn(environment, 'rudderMultiplier')
    ? environment.rudderMultiplier : 1;
  if (!isValidHelmResponse(helmResponse)) throw new TypeError('Invalid helm response');
  const throttle = clamp(input?.throttle, 0, 1), brake = clamp(input?.brake, 0, 1), steer = clamp(input?.steer, -1, 1);
  const jump = input?.jump === 1;
  const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
  let waterX = clamp(environment.current?.x, -N.maxCurrentSpeed, N.maxCurrentSpeed), waterZ = clamp(environment.current?.z, -N.maxCurrentSpeed, N.maxCurrentSpeed);
  const waterSpeed = Math.hypot(waterX, waterZ);
  if (waterSpeed > N.maxCurrentSpeed) { waterX *= N.maxCurrentSpeed / waterSpeed; waterZ *= N.maxCurrentSpeed / waterSpeed; }
  const relativeX = state.vx - waterX, relativeZ = state.vz - waterZ;
  const forward = relativeX * s + relativeZ * c, side = relativeX * c - relativeZ * s;
  const multiplier = clamp(environment.sailMultiplier ?? 1, 1, N.perfectMultiplier);
  const maxSpeed = clamp(environment.maxSpeed ?? H.maxSpeed, H.maxSpeed, N.boostMaxSpeed);
  if (environment.handling === 'windwaker') return stepWindWaker(state, rig, wind, throttle, brake, steer, jump,
    forward, waterX, waterZ, multiplier, maxSpeed, helmResponse);
  const force = (H.paddleForce + H.sailForce * rig.sail * windEfficiency(state.yaw, wind) * multiplier) * throttle * (1 - brake) * rig.flotation;
  // Exponential drag cannot overshoot through zero; braking removes momentum, never reverses a sail.
  const dragRate = rig.wetted * (H.forwardDrag + H.quadraticDrag * Math.abs(forward)) / rig.mass;
  let nextForward = forward * Math.exp(-dragRate * NAVAL_STEP) + force / rig.mass * NAVAL_STEP;
  const removed = H.brakeForce * rig.wetted / rig.mass * brake * NAVAL_STEP;
  nextForward = Math.sign(nextForward) * Math.max(0, Math.abs(nextForward) - removed);
  nextForward = clamp(nextForward, -maxSpeed, maxSpeed);
  const nextSide = side * Math.exp(-H.lateralDamping * NAVAL_STEP);
  const flow = H.lowSpeedHelm + (1 - H.lowSpeedHelm) * Math.min(1, Math.abs(forward) / 3);
  // A larger hull has more control surface and leverage, while its much larger yaw inertia
  // still makes it slower to turn. A single fixed-size rudder made the house nearly unsteerable.
  const torque = steer * H.rudderTorque * (rig.cells / 4) ** 1.5 * flow * rig.stability * rig.flotation * helmResponse;
  const omega = clamp(state.omega * Math.exp(-H.yawDamping * NAVAL_STEP) + torque / rig.inertia * NAVAL_STEP,
    -H.maxTurnRate, H.maxTurnRate);
  let vx = nextForward * s + nextSide * c + waterX, vz = nextForward * c - nextSide * s + waterZ;
  const speed = Math.hypot(vx, vz);
  if (speed > maxSpeed) { vx *= maxSpeed / speed; vz *= maxSpeed / speed; }
  return { tick: state.tick + 1, x: state.x + (state.vx + vx) * NAVAL_STEP / 2,
    z: state.z + (state.vz + vz) * NAVAL_STEP / 2, yaw: wrap(state.yaw + omega * NAVAL_STEP), vx, vz, omega, helm: state.helm ?? 0 };
}

// The simulated position is the centre of mass; renderer blueprints are rooted at grid origin.
export function navalPose(state, rig) {
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  return { x: state.x - c * rig.cx - s * rig.cz, z: state.z + s * rig.cx - c * rig.cz,
    y: 0.72 - Math.min(0.18, rig.load * 0.12), yaw: state.yaw };
}

export function jettisonLabCargo(fixture, state) {
  const next = { ...fixture, parts: fixture.parts.map((p) => [...p]), cargo: [] };
  const before = buildNavalRig(fixture.parts, fixture.cargo), after = buildNavalRig(next.parts, next.cargo);
  const dx = after.cx - before.cx, dz = after.cz - before.cz, c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  // Changing the mass reference point is a coordinate transform, not an impulse or hull teleport.
  // Preserve the velocity of every hull point while changing the measured centre-of-mass velocity.
  return { fixture: next, state: { ...state, x: state.x + c * dx + s * dz, z: state.z - s * dx + c * dz,
    vx: state.vx + state.omega * (-s * dx + c * dz), vz: state.vz + state.omega * (-c * dx - s * dz) } };
}
