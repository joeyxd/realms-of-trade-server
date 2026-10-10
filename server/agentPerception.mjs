import { randomUUID } from 'node:crypto';
import { C, KIND } from '../src/sim/ecs.js';
import { encodeEntity, MSG } from '../src/net/protocol.js';

// This pilot exposes nearby character entities only. It does not model hazards,
// resources, vehicles, or other global world systems as agent perception.
export const AGENT_PILOT_POLICY = Object.freeze({
  v: 1,
  serverEnforced: true,
  policy: 'server_radius_colliders',
  radius: 24,
  maxEntities: 64,
  occlusion: 'static_circles',
});

const PASS_THROUGH = new Set([
  MSG.WELCOME, MSG.CHAT_STATE, MSG.CHAT_MESSAGE, MSG.CHAT_RESULT,
  MSG.AGENT_STATE, MSG.AGENT_INVENTORY_RESULT, MSG.AGENT_MARKET_RESULT, MSG.PONG, MSG.ERROR, MSG.FULL,
]);

function positioned(ecs, id) {
  return Number.isInteger(id) && id > 0 && id < ecs.cap && ecs.alive[id] && (ecs.mask[id] & C.POS) !== 0 &&
    Number.isFinite(ecs.x[id]) && Number.isFinite(ecs.y[id]) && Number.isFinite(ecs.z[id]);
}

function blocked(map, ax, ay, az, bx, by, bz) {
  for (const c of map?.colliders || []) {
    const r = Number(c?.r), cx = Number(c?.x), cz = Number(c?.z);
    if (!(r > 0) || !Number.isFinite(cx) || !Number.isFinite(cz)) continue;
    const arx = ax - cx, arz = az - cz, brx = bx - cx, brz = bz - cz;
    const rr = r * r;
    // Ignore circles containing either endpoint; this avoids self-occlusion.
    if (arx * arx + arz * arz <= rr || brx * brx + brz * brz <= rr) continue;
    const dx = bx - ax, dz = bz - az, den = dx * dx + dz * dz;
    if (!den) continue;
    const t = Math.max(0, Math.min(1, -((ax - cx) * dx + (az - cz) * dz) / den));
    const px = ax + t * dx - cx, pz = az + t * dz - cz;
    if (px * px + pz * pz < rr) return true;
  }
  return false;
}

function ownEvent(ev, selfEntity) {
  if (!ev || typeof ev !== 'object') return null;
  const n = (v) => Number.isFinite(v) ? v : undefined;
  if (ev.type === 'swing' && ev.e === selfEntity)
    return { type: 'swing', e: selfEntity, stage: n(ev.stage), seq: n(ev.seq) };
  if (ev.type === 'potion' && ev.e === selfEntity)
    return { type: 'potion', e: selfEntity, seq: n(ev.seq), denied: typeof ev.denied === 'string' ? ev.denied : undefined,
      heal: n(ev.heal), n: n(ev.n), x: n(ev.x), z: n(ev.z) };
  if ((ev.type === 'death' || ev.type === 'respawn') && ev.id === selfEntity)
    return { type: ev.type, id: selfEntity, seq: n(ev.seq), x: n(ev.x), z: n(ev.z) };
  return null;
}

export class AgentPerception {
  #lives = new Map();
  #serial = 0;
  #revision = 0;

  constructor() {}

  clear() {
    this.#lives.clear();
    this.#revision = 0;
  }

  hasEnemy(world, selfEntity) {
    return this.#visibleIds(world, selfEntity).some((id) => id !== selfEntity && this.#lives.has(id) &&
      world.ecs.kind[id] === KIND.ENEMY && world.ecs.hp[id] > 0 && world.ecs.dead[id] <= 0);
  }

  canHitEnemy(id, world, selfEntity) {
    return this.target({ entityId: id, life: this.#lives.get(id) }, world, selfEntity, KIND.ENEMY);
  }

  target(ref, world, selfEntity, kind = null) {
    const id = ref?.entityId;
    const life = typeof ref === 'object' && ref ? ref.life : null;
    const ecs = world?.ecs;
    if (!ecs || !Number.isInteger(id) || !positioned(ecs, id) || (ecs.mask[id] & C.VEHICLE) || ecs.kind[id] === KIND.SHIP) return false;
    if (kind != null && ecs.kind[id] !== kind) return false;
    if (ecs.hp[id] <= 0 || ecs.dead[id] > 0) return false;
    if (id === selfEntity || !life || this.#lives.get(id) !== life) return false;
    return this.#visibleIds(world, selfEntity).includes(id);
  }

  project(message, world, selfEntity) {
    if (!message || typeof message !== 'object') return [];
    if (PASS_THROUGH.has(message.t)) return [message];
    if (message.t === MSG.SPAWN) {
      const id = message.e?.id;
      if (!positioned(world?.ecs, id)) return [];
      if (id !== selfEntity) {
        // Other entities become visible only through a filtered snapshot. A
        // reused ECS id still invalidates the previous exposure immediately.
        if (this.#lives.has(id)) {
          this.#lives.delete(id);
          return [{ t: MSG.DESPAWN, id }];
        }
        return [];
      }
      const life = this.#newLife(id);
      return [{ t: MSG.SPAWN, e: { ...world.describe(id), life } }];
    }
    if (message.t === MSG.EVENT) {
      const ev = ownEvent(message.ev, selfEntity);
      return ev ? [{ t: MSG.EVENT, ev }] : [];
    }
    if (message.t === MSG.DESPAWN) {
      if (!this.#lives.delete(message.id)) return [];
      return [{ t: MSG.DESPAWN, id: message.id }];
    }
    if (message.t !== MSG.SNAPSHOT) return [];
    const ecs = world?.ecs;
    if (!ecs || !Array.isArray(message.ents)) return [];

    const ids = this.#visibleIds(world, selfEntity);
    const current = new Set(ids);
    const out = [];
    for (const id of this.#lives.keys()) {
      if (!current.has(id)) {
        out.push({ t: MSG.DESPAWN, id });
        this.#lives.delete(id);
      }
    }
    for (const id of ids) {
      if (id === selfEntity || this.#lives.has(id)) continue;
      const life = this.#newLife(id);
      out.push({ t: MSG.SPAWN, e: { ...world.describe(id), life } });
    }
    this.#revision++;
    const entTuples = ids.map((id) => encodeEntity(ecs, id));
    out.push({
      t: MSG.SNAPSHOT,
      tick: message.tick,
      ack: message.ack,
      you: Array.isArray(message.you) ? [...message.you] : null,
      ents: entTuples,
      enc: [], frost: [], storm: [], ink: { clouds: [], marks: [] }, rafts: [],
      perception: { ...AGENT_PILOT_POLICY, revision: this.#revision, tick: message.tick, truncated: this.#visibleIds(world, selfEntity, Infinity).length > AGENT_PILOT_POLICY.maxEntities + 1 },
    });
    return out;
  }

  #newLife(id) {
    const life = `${randomUUID()}:${++this.#serial}`;
    this.#lives.set(id, life);
    return life;
  }

  #visibleIds(world, selfEntity, limit = AGENT_PILOT_POLICY.maxEntities) {
    const ecs = world?.ecs;
    if (!ecs || !positioned(ecs, selfEntity)) return [];
    if (ecs.hp[selfEntity] <= 0 || ecs.dead?.[selfEntity] > 0) return [selfEntity];
    const sx = ecs.x[selfEntity], sy = ecs.y[selfEntity], sz = ecs.z[selfEntity];
    const candidates = [];
    for (let id = 1; id < ecs.cap; id++) {
      if (id === selfEntity || !positioned(ecs, id) || (ecs.mask[id] & C.VEHICLE) ||
          ![KIND.PLAYER, KIND.NPC, KIND.ENEMY].includes(ecs.kind[id])) continue;
      const dx = ecs.x[id] - sx, dy = ecs.y[id] - sy, dz = ecs.z[id] - sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > AGENT_PILOT_POLICY.radius ** 2 || blocked(world.map, sx, sy, sz, ecs.x[id], ecs.y[id], ecs.z[id])) continue;
      candidates.push({ id, d2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2 || a.id - b.id);
    return [selfEntity, ...candidates.slice(0, limit).map((c) => c.id)];
  }
}
