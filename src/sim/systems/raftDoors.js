// Unlocked cabin doors: explicit, instance-bound intent, shared collision and the owner's existing save.
import { C } from '../ecs.js';
import { SLOTS, slotSkill } from '../../data/tattoos.js';
import { tuning } from '../../data/tuning.js';
import { publicRafts } from './rafts.js';
import { DOOR_REACH, doorDistance, openDoorParts } from '../naval/shelter.js';

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELDS = new Set(['t', 'type', 'id', 'partId', 'expectedRev', 'expectedOpen', 'open', 'opId']);

export function raftDoorCmd(w, e, msg, saveFits = () => true) {
  const answer = (ok, why, extra = {}) => {
    const ack = { type: 'raftDoor', to: e, opId: typeof msg?.opId === 'string' ? msg.opId.slice(0, 64) : '', ok, why, ...extra };
    w.emit(ack); return ack;
  };
  if (!msg || msg.type !== 'raftDoor' || Object.keys(msg).some((key) => !FIELDS.has(key)) ||
      typeof msg.opId !== 'string' || !OP_ID.test(msg.opId) || typeof msg.id !== 'string' || msg.id.length > 100 ||
      typeof msg.partId !== 'string' || msg.partId.length > 100 || !Number.isSafeInteger(msg.expectedRev) ||
      typeof msg.expectedOpen !== 'boolean' || typeof msg.open !== 'boolean') return answer(false, 'command');
  const source = w.rafts?.get(msg.id), ecs = w.ecs;
  if (!source || !ecs.alive[e] || ecs.dead[e] || ecs.hp[e] <= 0 ||
      !ecs.alive[source.owner] || !w.profiles.has(source.owner) || source.ship.hp <= 0) return answer(false, 'condition');
  if (ecs.dashT[e] >= 0 || ecs.castK[e] > 0 || ecs.castLock[e] > 0 ||
      w.navalPilot?.snapshot(e)?.active && !w.navalPilot?.deckSnapshot(e)?.active) return answer(false, 'busy');
  const entry = source.condition?.entries.find((p) => p.id === msg.partId && p.part[0] === 'door' && p.hp > 0);
  if (!entry) return answer(false, 'condition');
  const record = publicRafts(w).find((r) => r.id === msg.id);
  if (!record || doorDistance(record, entry.part, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e] }) > DOOR_REACH)
    return answer(false, 'far');
  if (!w.raftDoorReceipts) w.raftDoorReceipts = new Map();
  const cache = w.raftDoorReceipts.get(e) || new Map();
  const signature = JSON.stringify([msg.id, msg.partId, msg.expectedRev, msg.expectedOpen, msg.open]);
  const accept = (changed) => {
    const ack = answer(true, '', { open: msg.open, changed });
    cache.set(msg.opId, { signature, ack });
    while (cache.size > 64) cache.delete(cache.keys().next().value);
    w.raftDoorReceipts.set(e, cache);
    while (w.raftDoorReceipts.size > 256) w.raftDoorReceipts.delete(w.raftDoorReceipts.keys().next().value);
    return ack;
  };
  const prior = cache.get(msg.opId);
  if (prior) {
    if (prior.signature !== signature) return answer(false, 'duplicate');
    const replay = { ...prior.ack, changed: false, replay: true }; w.emit(replay); return replay;
  }
  if (source.ship.rev !== msg.expectedRev) return answer(false, 'revision');
  const old = source.ship.openDoors || [], wasOpen = old.includes(entry.id);
  if (wasOpen !== msg.expectedOpen) return answer(false, 'revision');
  if (wasOpen === msg.open) return accept(false);
  const next = msg.open ? [...old, entry.id].sort() : old.filter((id) => id !== entry.id);
  const changed = { ...record, openDoors: openDoorParts({ condition: source.condition, ship: { openDoors: next } }) };
  const after = new w.raftDeck.constructor(w.map);
  after.update(publicRafts(w).map((r) => r.id === msg.id ? changed : r));
  // New leaf/jamb blockers may not intersect a character or reserved leap landing.
  // A cabin can be closed around occupants: each character may reopen its unlocked door from either side.
  const collides = (x, z, y, radius) => after.blocked(x, z, y, radius) && !w.raftDeck.blocked(x, z, y, radius);
  for (const p of ecs.each(C.PLAYER)) {
    const radius = ecs.radius[p] || tuning.player.radius;
    if (collides(ecs.x[p], ecs.z[p], ecs.y[p], radius)) return answer(false, 'occupied');
    const slot = SLOTS[ecs.castK[p] - 1];
    if (slot && slotSkill(ecs, p, slot) === 'leap' && collides(ecs.lpX1[p], ecs.lpZ1[p], ecs.y[p], radius))
      return answer(false, 'occupied');
  }
  const profile = w.profiles.get(source.owner);
  const candidate = { ...profile, eco: { ...profile.eco, ships: profile.eco.ships.map((ship) =>
    ship === source.ship ? { ...ship, openDoors: next } : ship) } };
  let fits = false;
  try { fits = saveFits(candidate) === true; } catch { /* No mutation until the save-size preflight passes. */ }
  if (!fits) return answer(false, 'saveSize');
  if (next.length) source.ship.openDoors = next; else delete source.ship.openDoors;
  // Door use changes cabin state, not the blueprint/rig revision captured by a moving deck membership.
  w.raftDeck.update(publicRafts(w)); w.profileDirty?.add(source.owner);
  return accept(true);
}
