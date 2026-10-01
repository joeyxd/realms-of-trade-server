// Authoritative server that runs the shared sim. Lives in a Web Worker (or in-process as a fallback);
// a future Node server wraps the same class behind WebSockets.
import { DT, SNAPSHOT_EVERY } from '../data/tuning.js';
import { World } from '../sim/world.js';
import { C, KIND } from '../sim/ecs.js';
import { BOT_NAMES } from '../sim/systems/bots.js';
import { MSG, PROTOCOL_VERSION, encodeEntity, sanitizeCmd } from './protocol.js';

const MAX_CMDS_PER_TICK = 2; // normal pace
const CATCHUP_CMDS = 4;      // when a client's queue backs up
const MAX_QUEUE = 30;        // anything beyond is dropped (anti speed-hack / tab stalls)

export class LocalServer {
  constructor({ seed, send, bots = 5, debug = false, now = () => performance.now() }) {
    this.debug = debug;
    this.world = new World(seed);
    this.send = send; // (clientId, msg) => void
    this.now = now;
    this.clients = new Map(); // clientId -> {entity, queue, ack}
    this.acc = 0;
    this.last = 0;
    this.timer = null;
    for (const npc of this.world.map.npcs) this.world.spawnNpc(npc);
    const rng = this.world.rng;
    for (let i = 0; i < bots; i++) {
      const wp = this.world.map.botWaypoints[i % this.world.map.botWaypoints.length];
      this.world.spawnPlayer({
        name: BOT_NAMES[i % BOT_NAMES.length], skin: (i + 1) % 5, level: rng.int(2, 9),
        x: wp.x + rng.range(-1, 1), z: wp.z + rng.range(-1, 1), bot: true, facing: rng.range(0, 6.28),
      });
    }
    this.world.events.length = 0;
  }

  // Connected clients spectate (see bots, NPCs) until they say hello and get a player entity.
  connect(clientId) {
    this.clients.set(clientId, { entity: 0, queue: [], ack: 0 });
    const ecs = this.world.ecs;
    for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e]) this.send(clientId, { t: MSG.SPAWN, e: this.world.describe(e) });
  }

  disconnect(clientId) {
    const c = this.clients.get(clientId);
    if (c && c.entity) this.world.despawn(c.entity);
    this.clients.delete(clientId);
  }

  receive(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || !msg) return;
    switch (msg.t) {
      case MSG.HELLO: {
        if (c.entity) return;
        const name = String(msg.name || 'Grumete').slice(0, 20);
        const skin = Math.max(0, Math.min(4, msg.skin | 0));
        c.entity = this.world.spawnPlayer({ name, skin, level: 1, clientId, facing: 2.4 });
        this.flushEvents();
        this.send(clientId, { t: MSG.WELCOME, v: PROTOCOL_VERSION, you: c.entity, tick: this.world.tick, seed: this.world.seed });
        break;
      }
      case MSG.INPUTS: {
        if (!c.entity || !Array.isArray(msg.cmds)) return;
        for (const raw of msg.cmds) {
          const cmd = sanitizeCmd(raw);
          if (cmd && cmd.seq > c.ack && (c.queue.length === 0 || cmd.seq > c.queue[c.queue.length - 1].seq)) c.queue.push(cmd);
        }
        if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
        break;
      }
      case MSG.CMD: {
        // Local-only debug teleport (used by tools/shot.mjs). A real server never implements this.
        if (this.debug && msg.type === 'debug_teleport' && c.entity && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
          const ecs = this.world.ecs;
          ecs.x[c.entity] = msg.x; ecs.z[c.entity] = msg.z; ecs.y[c.entity] = this.world.map.groundAt(msg.x, msg.z);
          ecs.vx[c.entity] = 0; ecs.vz[c.entity] = 0;
        }
        break;
      }
      case MSG.PING:
        this.send(clientId, { t: MSG.PONG, t0: msg.t0, tick: this.world.tick });
        break;
      default:
        break;
    }
  }

  start() {
    this.last = this.now();
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  pump() {
    const t = this.now();
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25; // tab stall: don't spiral
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.step();
    }
  }

  step() {
    const w = this.world;
    for (const c of this.clients.values()) {
      if (!c.entity) continue;
      const n = c.queue.length > 6 ? CATCHUP_CMDS : MAX_CMDS_PER_TICK;
      // Process at most one per tick unless backlog: keeps the player in step with real time.
      const take = c.queue.length > 2 ? Math.min(n, c.queue.length) : Math.min(1, c.queue.length);
      for (let i = 0; i < take; i++) {
        const cmd = c.queue.shift();
        w.applyCommand(c.entity, cmd);
        c.ack = cmd.seq;
      }
    }
    w.stepWorld();
    this.flushEvents();
    if (w.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  flushEvents() {
    const w = this.world;
    for (const ev of w.events) {
      if (ev.type === 'spawn') this.broadcast({ t: MSG.SPAWN, e: w.describe(ev.id) });
      else if (ev.type === 'despawn') this.broadcast({ t: MSG.DESPAWN, id: ev.id });
      else this.broadcast({ t: MSG.EVENT, ev });
    }
    w.events.length = 0;
  }

  broadcast(msg) {
    for (const id of this.clients.keys()) this.send(id, msg);
  }

  broadcastSnapshot() {
    const w = this.world, ecs = w.ecs;
    const ents = [];
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.POS)) continue;
      ents.push(encodeEntity(ecs, e));
    }
    for (const [id, c] of this.clients) {
      this.send(id, { t: MSG.SNAPSHOT, tick: w.tick, ack: c.ack, ents, you: c.entity ? w.moverState(c.entity) : null });
    }
  }
}

export { KIND };
