// Freshwater uses the existing M5 economic receipt and locked profile/world baseline.
import { freshwaterMutation, freshwaterProfileDelta } from '../src/sim/systems/freshwaterProfile.js';
import { storageProfileDelta } from '../src/sim/systems/raftEditor.js';
import { canonicalEconomicText } from './economicOperation.mjs';
export { freshwaterMutation };
const same = (a,b) => canonicalEconomicText(a) === canonicalEconomicText(b);
export function vesselsUnchanged(before, next) {
  const projection = p => ({meal:p.meal ?? null, pack:p.eco.pack.vessels ?? null, ships:p.eco.ships.map(s=>[s.id,s.hold?.vessels ?? null])});
  return same(projection(before),projection(next));
}
export function freshwaterWorldTransition(current, request) {
  try {
    if (!freshwaterMutation(request.command)) return false;
    const a=structuredClone(current), b=structuredClone(request.worldData);
    if (a.resources && b.resources) {
      if (!Number.isSafeInteger(b.resources.tick) || b.resources.tick<a.resources.tick) return false;
      a.resources.tick=0; b.resources.tick=0;
    }
    if (!same(a,b)) return false;
    if (!request.ack.ok) return same(request.before,request.profile);
    const result=request.command.type==='freshwater' ? freshwaterProfileDelta(request.before,request.command)
      : storageProfileDelta(request.before,request.command);
    const rev=request.command.type==='freshwater' ? result.profile?.eco.tradeRev
      : result.profile?.eco.ships.find(s=>s.id===request.command.id)?.rev;
    return !result.why && same(result.profile,request.profile) && request.ack.rev===rev;
  } catch {return false;}
}
