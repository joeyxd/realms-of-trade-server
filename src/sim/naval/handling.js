// A deterministic aggregate body for D08's isolated handling bay. Nothing here loads a profile,
// changes goods, or attaches a raft to the live world. Fixed ticks are independent of render FPS.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { NAVAL_HANDLING as H, NAVAL_STEP } from '../../data/navalHandling.js';
import { NAVAL_NAVIGATION as N } from '../../data/navalNavigation.js';
export { NAVAL_STEP };

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
const wrap = (n) => Math.atan2(Math.sin(n), Math.cos(n));
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

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

export function newNavalState() { return { tick: 0, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, omega: 0 }; }

export function windEfficiency(yaw, wind) {
  const strength = clamp(wind?.strength, 0, 1);
  const alignment = Math.cos(yaw - (finite(wind?.yaw) ? wind.yaw : 0));
  return strength * (H.headwindEfficiency + (1 - H.headwindEfficiency) * Math.sqrt(Math.max(0, (alignment + 1) / 2)));
}

export function stepNaval(state, input, rig, wind, environment = {}) {
  if (!state || !['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((k) => finite(state[k])) ||
    !Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick >= Number.MAX_SAFE_INTEGER ||
    Math.abs(state.x) > 1e9 || Math.abs(state.z) > 1e9 || Math.hypot(state.vx, state.vz) > 100 || Math.abs(state.omega) > 10 ||
    !rig || !['mass', 'inertia', 'sail', 'flotation', 'wetted', 'stability', 'cells'].every((k) => finite(rig[k])) ||
    rig.mass <= 0 || rig.inertia <= 0 || rig.sail < 0 || rig.flotation <= 0 || rig.wetted <= 0 || rig.stability <= 0 || rig.cells < 1)
    throw new TypeError('Invalid naval body');
  const throttle = clamp(input?.throttle, 0, 1), brake = clamp(input?.brake, 0, 1), steer = clamp(input?.steer, -1, 1);
  const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
  let waterX = clamp(environment.current?.x, -N.maxCurrentSpeed, N.maxCurrentSpeed), waterZ = clamp(environment.current?.z, -N.maxCurrentSpeed, N.maxCurrentSpeed);
  const waterSpeed = Math.hypot(waterX, waterZ);
  if (waterSpeed > N.maxCurrentSpeed) { waterX *= N.maxCurrentSpeed / waterSpeed; waterZ *= N.maxCurrentSpeed / waterSpeed; }
  const relativeX = state.vx - waterX, relativeZ = state.vz - waterZ;
  const forward = relativeX * s + relativeZ * c, side = relativeX * c - relativeZ * s;
  const multiplier = clamp(environment.sailMultiplier ?? 1, 1, N.perfectMultiplier);
  const maxSpeed = clamp(environment.maxSpeed ?? H.maxSpeed, H.maxSpeed, N.boostMaxSpeed);
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
  const torque = steer * H.rudderTorque * (rig.cells / 4) ** 1.5 * flow * rig.stability * rig.flotation;
  const omega = clamp(state.omega * Math.exp(-H.yawDamping * NAVAL_STEP) + torque / rig.inertia * NAVAL_STEP,
    -H.maxTurnRate, H.maxTurnRate);
  let vx = nextForward * s + nextSide * c + waterX, vz = nextForward * c - nextSide * s + waterZ;
  const speed = Math.hypot(vx, vz);
  if (speed > maxSpeed) { vx *= maxSpeed / speed; vz *= maxSpeed / speed; }
  return { tick: state.tick + 1, x: state.x + (state.vx + vx) * NAVAL_STEP / 2,
    z: state.z + (state.vz + vz) * NAVAL_STEP / 2, yaw: wrap(state.yaw + omega * NAVAL_STEP), vx, vz, omega };
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
