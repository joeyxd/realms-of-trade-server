import { randomUUID } from 'node:crypto';
import { C, KIND } from '../src/sim/ecs.js';
import { encodeEntity, MSG } from '../src/net/protocol.js';
import { DT } from '../src/data/tuning.js';
import { hourOfDay } from '../src/data/clock.js';
import { RESOURCE_KINDS } from '../src/data/resources.js';
import { freshwaterSource } from '../src/data/freshwater.js';

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

// IC04: the world block of an agent snapshot. Public catalogue facts around the body, radius gated
// like entities but without occlusion (every human client already receives the node catalogue).
export const AGENT_WORLD_POLICY = Object.freeze({ v: 1, radius: 24, maxNodes: 16 });

const PASS_THROUGH = new Set([
  MSG.WELCOME, MSG.CHAT_STATE, MSG.CHAT_MESSAGE, MSG.CHAT_RESULT,
  MSG.AGENT_STATE, MSG.AGENT_INVENTORY_RESULT, MSG.AGENT_MARKET_RESULT, MSG.AGENT_TRADE_RESULT,
  MSG.AGENT_GOODS_BUDGET_RESULT, MSG.PONG, MSG.ERROR, MSG.FULL,
]);

function positioned(ecs, id) {
  return Number.isInteger(id) && id > 0 && id < ecs.cap && ecs.alive[id] && (ecs.mask[id] & C.POS) !== 0 &&
    Number.isFinite(ecs.x[id]) && Number.isFinite(ecs.y[id]) && Number.isFinite(ecs.z[id]);
}

// One decimal, never -0 (deepEqual and JSON would otherwise disagree).
const round1 = (v) => Math.round(v * 10) / 10 + 0;

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
  #spring = null;

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
      // The outbox may deliver a retired body's despawn after reentry reused its ECS id.
      // A live current self is authoritative; a real destroyed body still retires below.
      if (message.id === selfEntity && positioned(world?.ecs, selfEntity)) return [];
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
      world: this.#worldView(world, selfEntity, message.tick),
    });
    return out;
  }

  // IC04 observation v2. Fails closed (null) for a dead, missing or unpositioned self.
  #worldView(world, selfEntity, tick) {
    const ecs = world?.ecs;
    if (!ecs || !positioned(ecs, selfEntity) || ecs.hp[selfEntity] <= 0 || ecs.dead?.[selfEntity] > 0) return null;
    const sx = ecs.x[selfEntity], sy = ecs.y[selfEntity], sz = ecs.z[selfEntity];
    const r2 = AGENT_WORLD_POLICY.radius ** 2;
    const dist = (p) => Math.hypot(p.x - sx, p.y - sy, p.z - sz);
    const now = Number.isFinite(world.tick) ? world.tick : tick;
    // Only the nodes in radius are collected; views are built for the nearest few.
    const near = [];
    const nodes = world.resources?.nodes;
    if (nodes && typeof nodes.values === 'function') for (const n of nodes.values()) {
      if (!n || ![n.x, n.y, n.z].every(Number.isFinite) || !Object.hasOwn(RESOURCE_KINDS, n.kind)) continue;
      const dx = n.x - sx, dy = n.y - sy, dz = n.z - sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) near.push({ n, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2 || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0));
    const views = near.slice(0, AGENT_WORLD_POLICY.maxNodes).map(({ n }) => {
      const wait = Math.max(0, (Number.isFinite(n.readyTick) ? n.readyTick : 0) - now);
      const view = { id: n.id, kind: n.kind, x: round1(n.x), y: round1(n.y), z: round1(n.z),
        ready: wait === 0, wait: round1(wait * DT) };
      const hits = RESOURCE_KINDS[n.kind].hits;
      if (hits) {
        const used = n.readyTick > 0 && n.readyTick <= now ? 0 : (n.hits || 0);
        view.remaining = Math.max(0, hits - used);
      }
      return view;
    });
    const point = (p) => p && [p.x, p.y, p.z].every(Number.isFinite) && dist(p) <= AGENT_WORLD_POLICY.radius ?
      { x: round1(p.x), y: round1(p.y), z: round1(p.z), distance: round1(dist(p)) } : null;
    let water = null;
    if (world.freshwaterEnabled === true) {
      if (!this.#spring || this.#spring.map !== world.map) this.#spring = { map: world.map, source: freshwaterSource(world.map) };
      water = point(this.#spring.source);
    }
    const hours = typeof world.gameHoursAt === 'function' ? world.gameHoursAt() : NaN;
    return { v: AGENT_WORLD_POLICY.v, tick, hours: Number.isFinite(hours) ? round1(hourOfDay(round1(hours))) : null,
      nodes: views, truncated: near.length > AGENT_WORLD_POLICY.maxNodes, water, bench: point(world.resources?.bench) };
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
