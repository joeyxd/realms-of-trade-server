// Pure, ephemeral trial body that binds a blueprint, operational damage and fixed-tick handling.
import { navalPose, newNavalState, stepNaval } from './handling.js';
import { operationalNavalRig, rebaseNavalState } from './operational.js';
import { applyPartDamage, createNavalStructure, hullIntegrity } from './structure.js';

const MAX_PARTS = 600;
const MAX_TICK = Number.MAX_SAFE_INTEGER - 1;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const freeze = (value) => Object.freeze(value);

function fail(message) { throw new TypeError(message); }

function validatePose(pose) {
  if (!pose || !['x', 'y', 'z', 'yaw'].every((key) => finite(pose[key]))) fail('Invalid trial pose');
}

function validateTick(tick) {
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > MAX_TICK) fail('Invalid trial tick');
}

function validateBody(body) {
  if (!body || !body.structure || !body.operational || !body.state || !body.pose || !finite(body.poseOffsetY))
    fail('Invalid trial body');
  validatePose(body.pose);
  validateTick(body.state.tick);
  if (!['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((key) => finite(body.state[key]))) fail('Invalid trial state');
  if (Math.abs(body.state.x) > 1e9 || Math.abs(body.state.z) > 1e9 ||
      Math.hypot(body.state.vx, body.state.vz) > 100 || Math.abs(body.state.omega) > 10 ||
      body.operational.disabled !== hullIntegrity(body.structure).disabled)
    fail('Invalid trial state or flotation status');
}

function freezeState(state) { return freeze({ ...state }); }
function freezePose(pose) { return freeze({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw }); }

function makeBody(structure, operational, state, poseOffsetY, pose) {
  const body = freeze({ structure, operational, state: freezeState(state), pose: freezePose(pose), poseOffsetY });
  validateBody(body);
  return body;
}

function poseAt(state, rig, poseOffsetY) {
  const p = navalPose(state, rig);
  return { x: p.x, y: p.y + poseOffsetY, z: p.z, yaw: p.yaw };
}

export function createTrialBody(parts, pose, instanceNamespace, tick = 0) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) fail('Invalid trial blueprint');
  validatePose(pose);
  validateTick(tick);
  if (typeof instanceNamespace !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(instanceNamespace))
    fail('Invalid trial namespace');
  const entries = parts.map((part, index) => {
    const id = `${instanceNamespace}:p${index + 1}`;
    if (id.length > 100) fail('Trial part ID is too long');
    return { id, part: Array.isArray(part) ? [...part] : part };
  });
  const structure = createNavalStructure(entries);
  const operational = operationalNavalRig(structure, []);
  if (operational.disabled || !operational.rig) fail('Trial blueprint needs live flotation');

  const state = { ...newNavalState(), tick, yaw: pose.yaw };
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw), rig = operational.rig;
  state.x = pose.x + c * rig.cx + s * rig.cz;
  state.z = pose.z - s * rig.cx + c * rig.cz;
  const hydroPose = navalPose(state, rig);
  const poseOffsetY = pose.y - hydroPose.y;
  return makeBody(structure, operational, state, poseOffsetY, pose);
}

export function stepTrialBody(body, input, wind) {
  validateBody(body);
  if (body.state.tick >= MAX_TICK) fail('Trial tick exhausted');
  if (body.operational.disabled || !body.operational.rig) {
    const state = { ...body.state, tick: body.state.tick + 1, vx: 0, vz: 0, omega: 0 };
    return makeBody(body.structure, body.operational, state, body.poseOffsetY, body.pose);
  }
  const state = stepNaval(body.state, input, body.operational.rig, wind);
  const pose = poseAt(state, body.operational.rig, body.poseOffsetY);
  return makeBody(body.structure, body.operational, state, body.poseOffsetY, pose);
}

export function damageTrialBody(body, partId, amount) {
  validateBody(body);
  const result = applyPartDamage(body.structure, partId, amount);
  if (!result.event) return { body, event: null };
  const operational = operationalNavalRig(result.structure, []);
  if (operational.disabled || !operational.rig) {
    const state = { ...body.state, vx: 0, vz: 0, omega: 0 };
    return { body: makeBody(result.structure, operational, state, body.poseOffsetY, body.pose), event: result.event };
  }

  const beforeRig = body.operational.rig;
  if (!beforeRig) fail('Cannot rebase an enabled trial without its prior rig');
  const poseOffsetY = body.pose.y - navalPose(body.state, beforeRig).y;
  const state = rebaseNavalState(body.state, beforeRig, operational.rig);
  const pose = poseAt(state, operational.rig, poseOffsetY);
  return { body: makeBody(result.structure, operational, state, poseOffsetY, pose), event: result.event };
}
