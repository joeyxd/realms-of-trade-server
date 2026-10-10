import { C, KIND } from '../ecs.js';

const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELDS = new Set(['t', 'type', 'lit', 'opId']);
const PER_ACTOR_RECEIPTS = 64;
const MAX_ACTORS = 256;

function humanPlayer(w, e) {
  const ecs = w.ecs;
  return Number.isInteger(e) && e > 0 && e < ecs.cap && ecs.alive[e] &&
    ecs.kind[e] === KIND.PLAYER && (ecs.mask[e] & C.PLAYER) && !(ecs.mask[e] & C.BOT) &&
    ecs.clientId[e] >= 0 && ecs.hp[e] > 0 && !ecs.dead[e];
}

export function clearPersonalLantern(w, e) {
  if (w.ecs?.lantern && Number.isInteger(e) && e >= 0 && e < w.ecs.cap) w.ecs.lantern[e] = 0;
  w.personalLanternReceipts?.delete(e);
}

export function personalLanternCmd(w, e, msg) {
  const answer = (ok, why, extra = {}) => {
    const ack = { type: 'personalLantern', to: e,
      opId: typeof msg?.opId === 'string' ? msg.opId.slice(0, 64) : '', ok, why, ...extra };
    w.emit(ack);
    return ack;
  };
  if (!msg || msg.t !== 'cmd' || msg.type !== 'personalLantern' ||
      Object.keys(msg).some((field) => !FIELDS.has(field)) || typeof msg.lit !== 'boolean' ||
      typeof msg.opId !== 'string' || !OP_ID.test(msg.opId)) return answer(false, 'command');

  const prior = w.personalLanternReceipts?.get(e)?.get(msg.opId);
  const signature = JSON.stringify([msg.lit]);
  if (prior) {
    if (prior.signature !== signature) return answer(false, 'duplicate');
    const replay = { ...prior.ack, changed: false, replay: true };
    w.emit(replay);
    return replay;
  }
  if (!humanPlayer(w, e)) return answer(false, 'condition');

  const ecs = w.ecs;
  if (!(ecs.lantern instanceof Uint8Array) || ecs.lantern.length !== ecs.cap) ecs.lantern = new Uint8Array(ecs.cap);
  const changed = ecs.lantern[e] !== Number(msg.lit);
  ecs.lantern[e] = Number(msg.lit);
  const ack = answer(true, '', { lit: msg.lit, changed });
  if (!w.personalLanternReceipts) w.personalLanternReceipts = new Map();
  let cache = w.personalLanternReceipts.get(e);
  if (!cache) cache = new Map();
  cache.set(msg.opId, { signature, ack });
  while (cache.size > PER_ACTOR_RECEIPTS) cache.delete(cache.keys().next().value);
  w.personalLanternReceipts.set(e, cache);
  while (w.personalLanternReceipts.size > MAX_ACTORS)
    w.personalLanternReceipts.delete(w.personalLanternReceipts.keys().next().value);
  return ack;
}
