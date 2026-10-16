// One cargo reading for economy, editor forecasts and the owner-only server snapshot.
// A reading never trims legacy goods. Admission and cargo writers enforce its limits separately.
import { RAFT, RAFT_PARTS, RAFT_LOAD } from '../../data/raftparts.js';
import { holdUsed, holdMass } from './cargo.js';

export function raftCapacity(parts, hold = null, pack = null, rig = null, crew = {}) {
  let dryMass = 0, buoyancy = 0, structuralLimit = 0;
  for (const [id] of parts) {
    const p = RAFT_PARTS[id];
    if (!p) continue;
    dryMass += p.weight;
    buoyancy += (p.floats || 0) * RAFT.buoyancy;
    structuralLimit += p.structuralCapacity || 0;
  }
  const holdCargo = holdMass(hold), packCargo = holdMass(pack);
  // A live rig already contains authoritative damage and the admitted voyage payload.
  if (rig) { dryMass = rig.dryMass; buoyancy = rig.buoyancy; }
  const crewCount = crew.crewCount ?? 1, crewMass = crew.crewMass ?? crewCount * RAFT_LOAD.crewMass;
  const guestMass = crew.guestMass ?? 0;
  const cargoMass = rig ? Math.max(0, rig.cargoMass - crewMass) : holdCargo + packCargo + guestMass;
  const safeDisplacement = buoyancy * RAFT_LOAD.safeFraction;
  const totalLimit = Math.min(structuralLimit, safeDisplacement);
  const totalMass = dryMass + cargoMass + crewMass, cargoMax = Math.max(0, totalLimit - dryMass - crewMass);
  const overMass = Math.max(0, totalMass - totalLimit), freeMass = Math.max(0, totalLimit - totalMass);
  const status = overMass > 1e-8 ? 'overloaded' : totalLimit <= 0 || totalMass / totalLimit >= RAFT_LOAD.heavyFraction ? 'heavy' : 'ready';
  const holdVolume = hold ? holdUsed(hold) : 0, packVolume = pack ? holdUsed(pack) : 0;
  const holdCap = hold?.cap || 0, packCap = pack?.cap || 0;
  return {
    dryMass, holdMass: holdCargo, packMass: packCargo, cargoMass, totalMass, buoyancy, cargoMax,
    structuralLimit, safeDisplacement, totalLimit, crewCount, crewMass, guestMass, freeMass, overMass, status,
    load: buoyancy > 0 ? totalMass / buoyancy : 99,
    holdVolume, holdFree: Math.max(0, holdCap - holdVolume), holdCap,
    packVolume, packFree: Math.max(0, packCap - packVolume), packCap,
  };
}

// Hold-only admission reserves a pilot, so personal purchases/harvesting remain independent.
// An old or damaged overfull hold may be reduced or rearranged without deleting saved goods.
export function holdLoadIncreases(parts, beforeHold, afterHold) {
  return raftCapacity(parts, afterHold).overMass > raftCapacity(parts, beforeHold).overMass + 1e-8;
}
