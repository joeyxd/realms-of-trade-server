// Community rules reuse A1's pure delta against M5's existing account profile.
import { randomUUID } from 'node:crypto';
import { contributionDelta, contributionProject } from './community/contributionContract.mjs';
import { HARVEST } from '../src/data/resources.js';
import { TRADE } from '../src/sim/systems/trade.js';
import { StoreError } from './store.mjs';

const PROJECT_ID = 'salty-shore-carpentry';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clone = structuredClone;
export function validateCommunityState(raw, world) {
  if (raw === null || raw === undefined) return null;
  try {
    if (!raw || Object.keys(raw).sort().join(',') !== 'epoch,project,v' || raw.v !== 1 ||
        !UUID.test(raw.epoch) || raw.epoch === '00000000-0000-0000-0000-000000000000') throw new Error();
    const p = raw.project;
    if (!p || Object.keys(p).sort().join(',') !== 'contributed,id,requirements,version' || p.id !== PROJECT_ID ||
        Object.keys(p.requirements).sort().join(',') !== 'madera,piedra') throw new Error();
    contributionProject({ worldId: world, worldEpoch: raw.epoch, projectId: p.id, version: p.version,
      requirements: p.requirements, contributed: p.contributed });
    return clone(raw);
  } catch { throw new StoreError('world_format'); }
}

export function newCommunityState(world, requirements) {
  return validateCommunityState({ v: 1, epoch: randomUUID(), project: { id: PROJECT_ID, version: 1,
    requirements: clone(requirements), contributed: { madera: 0, piedra: 0 } } }, world);
}

export function publicCommunity(state) {
  if (!state) return null;
  const p = clone(state.project);
  return { ...p, name: 'Carpintería de Salty Shore',
    complete: Object.entries(p.requirements).every(([g, n]) => p.contributed[g] === n) };
}

export function communityAccess(world, entity) {
  const c = world.ecs, bench = world.resources?.bench;
  if (!c.alive[entity] || c.dead[entity] > 0 || !(c.hp[entity] > 0)) return 'dead';
  if (!bench) return 'disabled';
  if (world.navalPilot?.aboard?.(entity) || world.navalPilot?.locked?.(entity) ||
      world.raftDeck?.surface(c.x[entity], c.z[entity], c.y[entity]) ||
      world.map.onDock?.(c.x[entity], c.z[entity])) return 'land';
  const ground = world.map.groundAt(c.x[entity], c.z[entity]);
  if (!Number.isFinite(ground) || ground < .35 || Math.abs(c.y[entity] - ground) >= 1.5) return 'land';
  if (Math.hypot(c.x[entity] - bench.x, c.z[entity] - bench.z) > HARVEST.benchRadius) return 'far';
  if (c.regenT[entity] < TRADE.calm) return 'combat';
  if (c.moveMag[entity] > 1e-6 || Math.hypot(c.vx[entity], c.vz[entity]) > 1e-6 ||
      c.dashT[entity] >= 0 || c.dashBuffer[entity] > 0 || c.castK[entity] > 0 ||
      c.castLock[entity] > 0 || c.atkStage[entity] > 0) return 'busy';
  return '';
}

export function draftCommunity({ command, profile, state, world, entity, worldId, account, profileVersion, operationId }) {
  const ack = { type: 'community', op: command.op, opId: command.opId, ok: false, why: '',
    rev: profile.eco.tradeRev, project: publicCommunity(state), durable: true };
  const why = state ? communityAccess(world, entity) : 'disabled';
  if (why) { ack.why = why; return { profile, community: state, ack }; }
  const p = state.project;
  if (command.expectedRev !== p.version) { ack.why = 'revision'; return { profile, community: state, ack }; }
  let delta;
  try {
    delta = contributionDelta({ operationId, worldId, worldEpoch: state.epoch, characterId: account,
      projectId: command.projectId, good: command.good, amount: command.amount,
      expectedCharacterVersion: profileVersion, expectedProjectVersion: command.expectedRev },
    { worldId, worldEpoch: state.epoch, characterId: account, version: profileVersion, data: profile },
    { worldId, worldEpoch: state.epoch, projectId: p.id, version: p.version,
      requirements: p.requirements, contributed: p.contributed });
  } catch { ack.why = 'command'; return { profile, community: state, ack }; }
  if (!delta.ok) { ack.why = delta.why; return { profile, community: state, ack }; }
  const community = clone(state);
  community.project.version = delta.project.version;
  community.project.contributed = delta.project.contributed;
  return { profile: delta.character.data, community,
    ack: { ...ack, ok: true, accepted: delta.accepted, good: command.good,
      rev: delta.character.data.eco.tradeRev, project: publicCommunity(community) } };
}
