// Personal teaching uses the current M5 profile/world lane, not a second quest save.
import { ARTISAN } from '../src/data/artisan.js';
import { loggingStatus, readProgression } from '../src/sim/systems/progression.js';
import { communityAccess, publicCommunity } from './communityProject.mjs';
import { storageProfileDelta } from '../src/sim/systems/raftEditor.js';
import { draftWorkshop, workshopProfileDelta } from './workshopOperation.mjs';

const clone = structuredClone;
const text = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function artisanMutation(command) {
  return command?.type === 'artisan' && command.op === 'learn' ||
    command?.type === 'artisan' && ['contribute', 'craftCrate', 'upgradePack'].includes(command.op) ||
    command?.type === 'raft' && ['place', 'remove'].includes(command.op) &&
      (command.piece?.[0] === 'storage' || command.rules === 2 && command.piece?.[0] === 'crate');
}
export function teachStorage(profile) {
  const progression = readProgression(profile.progression);
  if (progression.knowledge.includes(ARTISAN.lesson)) return { why: 'learned' };
  if (!loggingStatus(progression).canLearnStorage) return { why: 'practice' };
  if (profile.eco.tradeRev >= 2147483646) return { why: 'revisionLimit' };
  if (Object.entries(ARTISAN.cost).some(([good, count]) => (profile.eco.pack.goods[good] || 0) < count)) return { why: 'goods' };
  const next = clone(profile);
  for (const [good, count] of Object.entries(ARTISAN.cost)) {
    next.eco.pack.goods[good] -= count;
    if (!next.eco.pack.goods[good]) delete next.eco.pack.goods[good];
  }
  progression.knowledge.push(ARTISAN.lesson);
  next.progression = progression; next.eco.tradeRev++;
  return { profile: next, why: '' };
}
export function draftArtisan({ command, profile, state, world, entity }) {
  if (['contribute', 'craftCrate', 'upgradePack'].includes(command.op)) return draftWorkshop({ command, profile, state, world, entity });
  const ack = { type: 'artisan', op: command.op, opId: command.opId, lesson: ARTISAN.lesson,
    ok: false, why: '', rev: profile.eco.tradeRev, project: publicCommunity(state) };
  let why = state ? communityAccess(world, entity) : 'disabled';
  if (!why && (command.expectedRev !== profile.eco.tradeRev || command.expectedProjectRev !== state.project.version)) why = 'revision';
  if (!why && (state.project.id !== ARTISAN.projectId || !publicCommunity(state).complete)) why = 'project';
  const taught = why ? null : teachStorage(profile);
  why ||= taught.why;
  return { profile: why ? profile : taught.profile, community: state,
    ack: { ...ack, ok: !why, why, rev: why ? profile.eco.tradeRev : taught.profile.eco.tradeRev } };
}
// Locked-baseline check for memory fixtures. SQL021 enforces the same delta on the durable store.
export function artisanWorldTransition(current, request) {
  if (!artisanMutation(request.command)) return !Object.hasOwn(request, 'before');
  const old = clone(current), next = clone(request.worldData);
  if (old.resources && next.resources) { old.resources.tick = 0; next.resources.tick = 0; }
  if (text(old) !== text(next)) return false;
  if (!request.ack.ok) return text(request.before) === text(request.profile);
  if (request.command.type === 'artisan' && ['contribute', 'craftCrate', 'upgradePack'].includes(request.command.op)) {
    const planned = workshopProfileDelta(request.before, request.command);
    return !planned.why && text(planned.profile) === text(request.profile) && request.ack.rev === planned.profile.eco.tradeRev
      && text(planned.workshop) === text(request.ack.workshop) && text(planned.carry) === text(request.ack.carry);
  }
  if (request.command.type !== 'artisan') {
    const changed = storageProfileDelta(request.before, request.command);
    const ship = changed.profile?.eco.ships.find(s => s.id === request.command.id);
    return !changed.why && text(changed.profile) === text(request.profile) && request.ack.rev === ship.rev;
  }
  const p = publicCommunity(current.community), cmd = request.command;
  if (!p?.complete || p.id !== ARTISAN.projectId || p.version !== cmd.expectedProjectRev ||
      cmd.expectedRev !== request.before.eco.tradeRev || cmd.lesson !== ARTISAN.lesson) return false;
  const taught = teachStorage(request.before);
  return !taught.why && text(taught.profile) === text(request.profile) && request.ack.rev === taught.profile.eco.tradeRev;
}
