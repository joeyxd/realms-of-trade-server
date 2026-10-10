// Unlocked lantern switches use the owner's canonical profile and bounded session receipts.
import { publicRafts } from './rafts.js';
import { LANTERN_REACH, lanternDistance } from '../naval/lantern.js';

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELDS = new Set(['t', 'type', 'id', 'partId', 'expectedRev', 'expectedLit', 'lit', 'opId']);

export function raftLanternCmd(w, e, msg, saveFits = () => true) {
  const answer = (ok, why, extra = {}) => {
    const ack = { type: 'raftLantern', to: e, opId: typeof msg?.opId === 'string' ? msg.opId.slice(0, 64) : '', ok, why, ...extra };
    w.emit(ack); return ack;
  };
  if (!msg || msg.type !== 'raftLantern' || Object.keys(msg).some((field) => !FIELDS.has(field)) ||
      typeof msg.opId !== 'string' || !OP_ID.test(msg.opId) || typeof msg.id !== 'string' || msg.id.length > 100 ||
      typeof msg.partId !== 'string' || msg.partId.length > 100 || !Number.isSafeInteger(msg.expectedRev) ||
      typeof msg.expectedLit !== 'boolean' || typeof msg.lit !== 'boolean') return answer(false, 'command');
  const source = w.rafts?.get(msg.id), ecs = w.ecs;
  if (!source || !ecs.alive[e] || ecs.dead[e] || ecs.hp[e] <= 0 || !ecs.alive[source.owner] ||
      !w.profiles.has(source.owner) || source.ship.hp <= 0) return answer(false, 'condition');
  if (ecs.dashT[e] >= 0 || ecs.castK[e] > 0 || ecs.castLock[e] > 0 ||
      w.navalPilot?.snapshot(e)?.active && !w.navalPilot?.deckSnapshot(e)?.active) return answer(false, 'busy');
  const entry = source.condition?.entries.find((part) => part.id === msg.partId && part.part[0] === 'lantern' && part.hp > 0);
  if (!entry) return answer(false, 'condition');
  const record = publicRafts(w).find((raft) => raft.id === msg.id);
  if (!record || lanternDistance(record, entry.part, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }) > LANTERN_REACH)
    return answer(false, 'far');
  if (!w.raftLanternReceipts) w.raftLanternReceipts = new Map();
  const cache = w.raftLanternReceipts.get(e) || new Map();
  const signature = JSON.stringify([msg.id, msg.partId, msg.expectedRev, msg.expectedLit, msg.lit]);
  const prior = cache.get(msg.opId);
  if (prior) {
    if (prior.signature !== signature) return answer(false, 'duplicate');
    const replay = { ...prior.ack, changed: false, replay: true }; w.emit(replay); return replay;
  }
  if (source.ship.rev !== msg.expectedRev) return answer(false, 'revision');
  const old = source.ship.litLanterns || [], wasLit = old.includes(entry.id);
  if (wasLit !== msg.expectedLit) return answer(false, 'revision');
  const accept = (changed) => {
    const ack = answer(true, '', { lit: msg.lit, changed });
    cache.set(msg.opId, { signature, ack });
    while (cache.size > 64) cache.delete(cache.keys().next().value);
    w.raftLanternReceipts.set(e, cache);
    while (w.raftLanternReceipts.size > 256) w.raftLanternReceipts.delete(w.raftLanternReceipts.keys().next().value);
    return ack;
  };
  if (wasLit === msg.lit) return accept(false);
  const next = msg.lit ? [...old, entry.id].sort() : old.filter((id) => id !== entry.id);
  const profile = w.profiles.get(source.owner);
  const candidate = { ...profile, eco: { ...profile.eco, ships: profile.eco.ships.map((ship) =>
    ship === source.ship ? { ...ship, litLanterns: next } : ship) } };
  let fits = false;
  try { fits = saveFits(candidate) === true; } catch { /* Admit before mutating the canonical profile. */ }
  if (!fits) return answer(false, 'saveSize');
  if (next.length) source.ship.litLanterns = next; else delete source.ship.litLanterns;
  // Switching light changes a service, not the blueprint revision used by moving crew membership.
  w.profileDirty?.add(source.owner);
  return accept(true);
}
