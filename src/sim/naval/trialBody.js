// Pure, ephemeral trial body that binds a blueprint, operational damage and fixed-tick handling.
import { navalPose, newNavalState, stepNaval } from './handling.js';
import { operationalNavalRig, rebaseNavalState } from './operational.js';
import { applyPartDamage, createNavalStructure, hullIntegrity } from './structure.js';
import { resolveNavalCoast } from './coastContact.js';
import { currentAt, gustAt, newSailingActivity, sailingEnvironment, stepSailingActivity } from './navigation.js';

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
  if (body.impacts !== undefined && (!Array.isArray(body.impacts) || body.impacts.length > 4 || body.impacts.some((p) =>
    !p || typeof p.id !== 'string' || !['terrain', 'dock', 'boundary'].includes(p.kind) ||
    !['x', 'z', 'normalX', 'normalZ', 'speed', 'damage', 'localX', 'localZ'].every((k) => finite(p[k])) ||
    p.speed < 0 || p.speed > 1000 || p.damage < 0 || p.damage > 1e6 || p.tick !== body.state.tick ||
    !Number.isSafeInteger(p.cell) || p.cell < 0 || p.cell >= 600 ||
    (p.partId !== null && typeof p.partId !== 'string') || typeof p.destroyed !== 'boolean')))
    fail('Invalid trial impact feedback');
  if (body.navigation !== undefined) {
    const a = body.activity, g = body.gust, f = body.flow, o = body.flowOrigin, w = body.wind;
    if (body.navigation !== true || !Array.isArray(body.cargo) || body.cargo.length > 600 ||
        body.cargo.some((item) => !item || !['mass', 'x', 'z', 'height'].every((key) => finite(item[key])) ||
          item.mass <= 0 || item.mass > 10000 || Math.abs(item.x) > 26 || Math.abs(item.z) > 26 || item.height < 0 || item.height > 8) ||
        !o || !['x', 'z', 'yaw'].every((key) => finite(o[key])) || Math.abs(o.x) > 1e9 || Math.abs(o.z) > 1e9 ||
        !f || !['x', 'z', 'strength'].every((key) => finite(f[key])) || Math.hypot(f.x, f.z) > 4 || f.strength < 0 || f.strength > 3.2 ||
        !g || !Number.isSafeInteger(g.id) || g.id < 0 || !['idle', 'approach', 'window'].includes(g.phase) ||
          !finite(g.progress) || g.progress < -1 || g.progress > 1 || !finite(g.remaining) || g.remaining < 0 ||
        !a || !Number.isSafeInteger(a.boostUntil) || a.boostUntil < 0 || !finite(a.multiplier) || a.multiplier < 1 || a.multiplier > 3 ||
          !Number.isSafeInteger(a.lastAttempt) || a.lastAttempt < -1 || !['', 'early', 'angle', 'miss', 'capture', 'perfect'].includes(a.result) ||
          !Number.isSafeInteger(a.resultUntil) || a.resultUntil < 0 ||
        typeof body.parked !== 'boolean' || !w || !finite(w.yaw) || !finite(w.strength) || w.strength < 0 || w.strength > 1)
      fail('Invalid trial navigation state');
  }
}

function freezeState(state) { return freeze({ ...state }); }
function freezePose(pose) { return freeze({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw }); }

function freezeCargo(cargo) {
  if (!Array.isArray(cargo) || cargo.length > 600) fail('Invalid trial cargo');
  return freeze(cargo.map((item) => {
    if (!item || !['mass', 'x', 'z'].every((key) => finite(item[key])) || item.mass <= 0 || item.mass > 10000 ||
        Math.abs(item.x) > 26 || Math.abs(item.z) > 26 || (item.height !== undefined && (!finite(item.height) || item.height < 0 || item.height > 8)))
      fail('Invalid trial cargo');
    return freeze({ mass: item.mass, x: item.x, z: item.z, height: item.height ?? 0 });
  }));
}

function freezeOrigin(origin) {
  if (!origin || !['x', 'z', 'yaw'].every((key) => finite(origin[key])) || Math.abs(origin.x) > 1e9 || Math.abs(origin.z) > 1e9)
    fail('Invalid current flow origin');
  return freeze({ x: origin.x, z: origin.z, yaw: origin.yaw });
}

function localPoint(x, z, origin) {
  const dx = x - origin.x, dz = z - origin.z, c = Math.cos(origin.yaw), s = Math.sin(origin.yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

function localVectorToWorld(vector, origin) {
  const c = Math.cos(origin.yaw), s = Math.sin(origin.yaw);
  return { x: c * vector.x + s * vector.z, z: -s * vector.x + c * vector.z };
}

function freezeActivity(activity) {
  return freeze({ boostUntil: activity.boostUntil, multiplier: activity.multiplier, lastAttempt: activity.lastAttempt,
    result: activity.result, resultUntil: activity.resultUntil });
}

function freezeWind(wind) {
  if (!wind || !finite(wind.yaw) || !finite(wind.strength) || wind.strength < 0 || wind.strength > 1)
    fail('Invalid trial wind');
  return freeze({ yaw: wind.yaw, strength: wind.strength });
}

function navigationFrame(state, flowOrigin, activity, wind, navigation) {
  if (!navigation) return { flow: null, gust: null, activity };
  const p = localPoint(state.x, state.z, flowOrigin);
  const current = currentAt(p.x, p.z, true), flow = localVectorToWorld(current, flowOrigin);
  const gust = gustAt(state.tick, wind, true);
  return { flow: freeze({ ...flow, strength: current.strength }), gust: freeze(gust), activity };
}

function makeBody(structure, operational, state, poseOffsetY, pose, impacts = [], options = {}) {
  const navigation = options.navigation === true;
  const cargo = freezeCargo(options.cargo || []);
  const flowOrigin = navigation ? freezeOrigin(options.flowOrigin) : null;
  const activity = navigation ? freezeActivity(options.activity || newSailingActivity()) : null;
  const wind = navigation ? freezeWind(options.wind || { yaw: 0, strength: 0 }) : null;
  const parked = navigation ? options.parked === true : false;
  const frame = navigation ? navigationFrame(state, flowOrigin, activity, wind, true)
    : { flow: null, gust: null };
  const body = freeze({ structure, operational, state: freezeState(state), pose: freezePose(pose), poseOffsetY,
    impacts: freeze(impacts.map((impact) => freeze({ ...impact }))),
    ...(navigation ? { navigation: true, cargo, flowOrigin, flow: frame.flow, activity, gust: frame.gust, parked, wind } : {}) });
  validateBody(body);
  return body;
}

function poseAt(state, rig, poseOffsetY) {
  const p = navalPose(state, rig);
  return { x: p.x, y: p.y + poseOffsetY, z: p.z, yaw: p.yaw };
}

export function createTrialBody(parts, pose, instanceNamespace, tick = 0, options = {}) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) fail('Invalid trial blueprint');
  validatePose(pose);
  validateTick(tick);
  if (typeof instanceNamespace !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(instanceNamespace))
    fail('Invalid trial namespace');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['cargo', 'navigation', 'flowOrigin', 'activity', 'parked', 'wind', 'structure'].includes(key)) ||
      (options.navigation !== undefined && typeof options.navigation !== 'boolean')) fail('Invalid trial options');
  const navigation = options.navigation === true;
  const cargo = freezeCargo(options.cargo || []);
  const flowOrigin = navigation ? freezeOrigin(options.flowOrigin) : null;
  const wind = options.wind || { yaw: 0, strength: 0 };
  const entries = parts.map((part, index) => {
    const id = `${instanceNamespace}:p${index + 1}`;
    if (id.length > 100) fail('Trial part ID is too long');
    return { id, part: Array.isArray(part) ? [...part] : part };
  });
  const structure = options.structure || createNavalStructure(entries);
  if (structure.entries.length !== parts.length || structure.entries.some((entry, i) =>
    entry.part[0] !== parts[i][0] || entry.part.slice(1, 4).some((v, j) => v !== parts[i][j + 1]) ||
    (entry.part[4] || 0) !== (parts[i][4] || 0))) fail('Trial condition does not match its blueprint');
  const operational = operationalNavalRig(structure, cargo);
  if (operational.disabled || !operational.rig) fail('Trial blueprint needs live flotation');

  const state = { ...newNavalState(), tick, yaw: pose.yaw };
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw), rig = operational.rig;
  state.x = pose.x + c * rig.cx + s * rig.cz;
  state.z = pose.z - s * rig.cx + c * rig.cz;
  const hydroPose = navalPose(state, rig);
  const poseOffsetY = pose.y - hydroPose.y;
  return makeBody(structure, operational, state, poseOffsetY, pose, [], {
    navigation, cargo, flowOrigin, activity: options.activity || newSailingActivity(), parked: options.parked, wind,
  });
}

export function stepTrialBody(body, input, wind, coast = null, { parked = body?.parked === true } = {}) {
  validateBody(body);
  if (body.navigation && (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input.capture !== undefined && typeof input.capture !== 'boolean'))) fail('Invalid sailing input');
  if (body.state.tick >= MAX_TICK) fail('Trial tick exhausted');
  const activityStep = body.navigation
    ? stepSailingActivity(body.activity, body.state, parked ? { ...input, capture: false } : input, body.operational.rig || { sail: 0 }, wind, true)
    : { activity: null, event: null };
  const common = { navigation: body.navigation, cargo: body.cargo, flowOrigin: body.flowOrigin,
    activity: activityStep.activity || undefined, parked, wind };
  if (parked) {
    const state = { ...body.state, tick: body.state.tick + 1, vx: 0, vz: 0, omega: 0 };
    const frame = navigationFrame(state, body.flowOrigin, activityStep.activity, wind, true);
    return makeBody(body.structure, body.operational, state, body.poseOffsetY, body.pose, [], { ...common, gust: frame.gust });
  }
  if (body.operational.disabled || !body.operational.rig) {
    const state = { ...body.state, tick: body.state.tick + 1, vx: 0, vz: 0, omega: 0 };
    return makeBody(body.structure, body.operational, state, body.poseOffsetY, body.pose, [], common);
  }
  const frame = body.navigation ? navigationFrame(body.state, body.flowOrigin, activityStep.activity, wind, true) : null;
  const environment = body.navigation ? { ...sailingEnvironment(activityStep.activity, body.state, true), current: frame.flow } : {};
  let state = stepNaval(body.state, input, body.operational.rig, wind, environment);
  const contact = coast ? resolveNavalCoast(body.state, state, body.operational.rig, body.operational.parts, coast) : null;
  if (contact) state = contact.state;
  const pose = poseAt(state, body.operational.rig, body.poseOffsetY);
  let candidate = makeBody(body.structure, body.operational, state, body.poseOffsetY, pose, [], common);
  const impacts = [];
  const struck = new Set();
  for (const hit of contact?.contacts || []) {
    // A terrain seam is not a second damaging impact. Bind the swept cell to its original instance
    // before any rig rebuild changes operational indices; never transfer its excess damage to a neighbor.
    const tuple = body.operational.parts[hit.cell];
    const entry = body.structure.entries.find((p) => p.part.length === tuple?.length &&
      p.part.every((value, i) => value === tuple[i]));
    let event = null;
    if (entry && !struck.has(entry.id) && hit.damage > 0) {
      struck.add(entry.id);
      const result = damageTrialBody(candidate, entry.id, hit.damage);
      candidate = result.body; event = result.event;
    }
    impacts.push({ ...hit, tick: state.tick, partId: event?.partId || null,
      damage: event?.damage || 0, destroyed: event?.destroyed || false });
  }
  return makeBody(candidate.structure, candidate.operational, candidate.state, candidate.poseOffsetY, candidate.pose, impacts, common);
}

export function damageTrialBody(body, partId, amount) {
  validateBody(body);
  const result = applyPartDamage(body.structure, partId, amount);
  if (!result.event) return { body, event: null };
  const operational = operationalNavalRig(result.structure, body.cargo || []);
  if (operational.disabled || !operational.rig) {
    const state = { ...body.state, vx: 0, vz: 0, omega: 0 };
    return { body: makeBody(result.structure, operational, state, body.poseOffsetY, body.pose, [], body), event: result.event };
  }

  const beforeRig = body.operational.rig;
  if (!beforeRig) fail('Cannot rebase an enabled trial without its prior rig');
  const poseOffsetY = body.pose.y - navalPose(body.state, beforeRig).y;
  const state = rebaseNavalState(body.state, beforeRig, operational.rig);
  const pose = poseAt(state, operational.rig, poseOffsetY);
  return { body: makeBody(result.structure, operational, state, poseOffsetY, pose, [], body), event: result.event };
}

export function parkTrialBody(body, parked) {
  validateBody(body);
  if (!body.navigation || typeof parked !== 'boolean') fail('Invalid parked trial body');
  if (body.parked === parked) return body;
  const state = { ...body.state, vx: 0, vz: 0, omega: 0 };
  return makeBody(body.structure, body.operational, state, body.poseOffsetY, body.pose, [], {
    ...body, parked, activity: body.activity, wind: body.wind,
  });
}

// Reweight a parked voyage from server-owned cargo while preserving its world-space pose and damage.
export function setTrialCargo(body, cargo) {
  validateBody(body);
  if (!body.navigation || body.parked !== true) fail('Cargo can only be refreshed while parked');
  return refreshTrialPayload(body, cargo);
}

// Server-admitted crew can board or leave while underway. Rebase the changed aggregate without
// stopping, moving the world-space hull, resetting activity/ACKs, or healing a damaged piece.
export function refreshTrialPayload(body, cargo) {
  validateBody(body);
  if (!body.navigation) fail('Payload refresh requires live navigation');
  const frozenCargo = freezeCargo(cargo);
  const operational = operationalNavalRig(body.structure, frozenCargo);
  if (operational.disabled || !operational.rig || !body.operational.rig) fail('Cannot reweight disabled trial body');
  const state = rebaseNavalState(body.state, body.operational.rig, operational.rig);
  const poseOffsetY = body.pose.y - navalPose(state, operational.rig).y;
  return makeBody(body.structure, operational, state, poseOffsetY, body.pose, [], { ...body, cargo: frozenCargo });
}
