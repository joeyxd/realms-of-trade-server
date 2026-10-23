// Rebuild the handling body from the live pieces while retaining the source blueprint.
import { buildNavalRig } from './handling.js';
import { hullIntegrity, liveStructureParts } from './structure.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function assertFiniteState(state) {
  if (!state || !Number.isSafeInteger(state.tick) || state.tick < 0 ||
      !['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((key) => finite(state[key])))
    throw new TypeError('Invalid naval state');
}

function assertRig(rig) {
  if (!rig || typeof rig !== 'object' || !finite(rig.cx) || !finite(rig.cz) ||
      !Object.values(rig).every(finite))
    throw new TypeError('Invalid naval rig');
}

export function operationalNavalRig(structure, cargo = []) {
  if (!Array.isArray(cargo) || cargo.length > 600) throw new TypeError('Invalid naval cargo');
  const parts = liveStructureParts(structure);
  const integrity = hullIntegrity(structure);
  return Object.freeze({ parts, rig: integrity.disabled ? null : buildNavalRig(parts, cargo), disabled: integrity.disabled });
}

export function rebaseNavalState(state, beforeRig, afterRig) {
  assertFiniteState(state);
  assertRig(beforeRig);
  assertRig(afterRig);
  const dx = afterRig.cx - beforeRig.cx, dz = afterRig.cz - beforeRig.cz;
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw), omega = state.omega;
  const next = {
    ...state,
    x: state.x + c * dx + s * dz,
    z: state.z - s * dx + c * dz,
    vx: state.vx + omega * (-s * dx + c * dz),
    vz: state.vz + omega * (-c * dx - s * dz),
  };
  if (![next.x, next.z, next.vx, next.vz].every(finite)) throw new TypeError('Naval state rebase overflow');
  return next;
}
