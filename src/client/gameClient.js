// Client-side netcode: local-player prediction + reconciliation, remote entity interpolation.
// The renderer only ever reads from here; it never decides gameplay.
import { DT, INTERP_DELAY, tuning } from '../data/tuning.js';
import { World } from '../sim/world.js';
import { MSG, ENT, quantAxis } from '../net/protocol.js';
import { lerp, wrapAngle } from '../core/math.js';

const BUF_MAX = 40;

export class GameClient {
  constructor(transport, map, bus) {
    this.t = transport;
    this.map = map;
    this.bus = bus;
    this.pred = new World(map.seed, { map });
    this.youServer = 0;
    this.youLocal = 0;
    this.seq = 0;
    this.pending = [];
    this.entities = new Map(); // serverId -> record
    this.clock = 0;
    this.serverOffset = null;
    this.prev = { x: 0, y: 0, z: 0, f: 0 };
    this.cur = { x: 0, y: 0, z: 0, f: 0 };
    this.err = { x: 0, y: 0, z: 0 };
    this.awaitingFirst = false;
    this.stats = { predErr: 0, corrections: 0, pending: 0, snapAge: 0 };
    this.lastSnapClock = 0;
    transport.onMessage((m) => this.onMessage(m));
    transport.onSnapshot((s) => this.onSnapshot(s));
  }

  // Begin receiving (call after everything that listens to the bus is registered).
  start() { this.t.start(); }

  get joined() { return this.youLocal !== 0 && !this.awaitingFirst; }

  join(name, skin) {
    this.t.send({ t: MSG.HELLO, v: 1, name, skin });
  }

  onMessage(m) {
    switch (m.t) {
      case MSG.SPAWN: {
        const d = m.e;
        const rec = {
          id: d.id, kind: d.kind, name: d.name, title: d.title, skin: d.skin, level: d.level,
          buf: [], r: { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, mag: 0, wade: 0, dashes: 0 }, ready: false,
        };
        this.entities.set(d.id, rec);
        this.bus.emit('entity:spawn', rec);
        break;
      }
      case MSG.DESPAWN: {
        const rec = this.entities.get(m.id);
        this.entities.delete(m.id);
        if (rec) this.bus.emit('entity:despawn', rec);
        break;
      }
      case MSG.WELCOME: {
        this.youServer = m.you;
        const rec = this.entities.get(m.you);
        this.youLocal = this.pred.spawnPlayer({
          name: rec ? rec.name : 'Grumete', skin: rec ? rec.skin : 0, level: rec ? rec.level : 1,
        });
        this.pred.events.length = 0;
        this.awaitingFirst = true;
        if (rec) rec.isYou = true;
        this.bus.emit('you:welcome', { id: m.you, rec });
        break;
      }
      case MSG.EVENT:
        this.bus.emit('net:event', m.ev);
        break;
      default:
        break;
    }
  }

  onSnapshot(s) {
    const st = s.tick * DT;
    const off = st - this.clock;
    if (this.serverOffset === null || Math.abs(off - this.serverOffset) > 0.25) this.serverOffset = off;
    else this.serverOffset += (off - this.serverOffset) * 0.08;
    this.lastSnapClock = this.clock;

    for (const e of s.ents) {
      const rec = this.entities.get(e[ENT.ID]);
      if (!rec) continue;
      if (e[ENT.ID] === this.youServer) { rec.serverState = e; continue; }
      const sample = {
        time: st, x: e[ENT.X], y: e[ENT.Y], z: e[ENT.Z], f: e[ENT.F], vx: e[ENT.VX], vz: e[ENT.VZ],
        st: e[ENT.ST], mag: e[ENT.MAG], wade: e[ENT.WADE], dashes: e[ENT.DASHES],
      };
      const b = rec.buf;
      if (b.length && b[b.length - 1].time >= st) continue;
      b.push(sample);
      if (b.length > BUF_MAX) b.shift();
      if (!rec.ready) { Object.assign(rec.r, sample); rec.ready = true; }
    }

    if (s.you && this.youLocal) this.reconcile(s.ack, s.you);
  }

  reconcile(ack, state) {
    const ecs = this.pred.ecs, e = this.youLocal;
    if (this.awaitingFirst) {
      this.pred.setMoverState(e, state);
      this.pending = this.pending.filter((c) => c.seq > ack);
      for (const c of this.pending) this.pred.applyCommand(e, c);
      this.cur.x = this.prev.x = ecs.x[e];
      this.cur.y = this.prev.y = ecs.y[e];
      this.cur.z = this.prev.z = ecs.z[e];
      this.cur.f = this.prev.f = ecs.facing[e];
      this.awaitingFirst = false;
      this.bus.emit('you:ready', { x: ecs.x[e], z: ecs.z[e] });
      return;
    }
    const bx = ecs.x[e], by = ecs.y[e], bz = ecs.z[e];
    this.pred.setMoverState(e, state);
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= ack) i++;
    if (i) this.pending.splice(0, i);
    for (const c of this.pending) this.pred.applyCommand(e, c);
    const dx = bx - ecs.x[e], dy = by - ecs.y[e], dz = bz - ecs.z[e];
    const errLen = Math.hypot(dx, dz);
    this.stats.predErr = errLen;
    if (errLen > 1e-6) {
      this.stats.corrections++;
      if (errLen > 4) { this.err.x = this.err.y = this.err.z = 0; } // teleport: don't smooth
      else { this.err.x += dx; this.err.y += dy; this.err.z += dz; }
      this.cur.x = ecs.x[e]; this.cur.y = ecs.y[e]; this.cur.z = ecs.z[e];
      this.prev.x -= dx; this.prev.y -= dy; this.prev.z -= dz;
    }
  }

  // One fixed client tick: build the command, predict, send.
  tickInput(input) {
    if (!this.youLocal || this.awaitingFirst) return;
    const ecs = this.pred.ecs, e = this.youLocal;
    const cmd = {
      seq: ++this.seq,
      mx: quantAxis(input.mx), mz: quantAxis(input.mz),
      ax: input.ax, az: input.az, btn: input.btn | 0, prs: input.prs | 0,
    };
    this.prev.x = this.cur.x; this.prev.y = this.cur.y; this.prev.z = this.cur.z; this.prev.f = this.cur.f;
    const wasDash = ecs.dashT[e] >= 0;
    const ch = ecs.dashCharges[e];
    this.pred.applyCommand(e, cmd);
    this.cur.x = ecs.x[e]; this.cur.y = ecs.y[e]; this.cur.z = ecs.z[e]; this.cur.f = ecs.facing[e];
    if (!wasDash && ecs.dashT[e] >= 0) {
      this.bus.emit('local:dash', { x: ecs.x[e], z: ecs.z[e], dx: ecs.dashDirX[e], dz: ecs.dashDirZ[e] });
    } else if ((cmd.prs & 1) && ch < 1 && ecs.dashT[e] < 0 && ecs.dashBuffer[e] > 0) {
      this.bus.emit('local:dashDenied', {});
    }
    this.pending.push(cmd);
    if (this.pending.length > 240) this.pending.shift();
    this.stats.pending = this.pending.length;
    this.t.sendInput(cmd.seq, cmd);
  }

  update(realDt) {
    this.clock += realDt;
    const k = Math.exp(-tuning.visual.errorSmoothLambda * realDt);
    this.err.x *= k; this.err.y *= k; this.err.z *= k;
    this.stats.snapAge = this.clock - this.lastSnapClock;
    const rt = this.serverOffset === null ? 0 : this.clock + this.serverOffset - INTERP_DELAY;
    for (const rec of this.entities.values()) {
      if (rec.id === this.youServer || !rec.buf.length) continue;
      this.sampleRemote(rec, rt);
    }
  }

  sampleRemote(rec, time) {
    const b = rec.buf, r = rec.r;
    // drop samples we no longer need (keep one before `time`)
    while (b.length > 2 && b[1].time <= time) b.shift();
    const a = b[0];
    const c = b.length > 1 ? b[1] : null;
    if (!c || time <= a.time) {
      // Before the buffer or only one sample: hold / brief extrapolation.
      const ex = c ? 0 : Math.min(0.1, Math.max(0, time - a.time));
      r.x = a.x + a.vx * ex; r.z = a.z + a.vz * ex; r.y = a.y; r.f = a.f;
      r.vx = a.vx; r.vz = a.vz; r.st = a.st; r.mag = a.mag; r.wade = a.wade; r.dashes = a.dashes;
      return;
    }
    const t = Math.min(1, (time - a.time) / (c.time - a.time));
    r.x = lerp(a.x, c.x, t); r.y = lerp(a.y, c.y, t); r.z = lerp(a.z, c.z, t);
    r.f = a.f + wrapAngle(c.f - a.f) * t;
    r.vx = lerp(a.vx, c.vx, t); r.vz = lerp(a.vz, c.vz, t);
    r.st = t < 0.5 ? a.st : c.st; r.mag = lerp(a.mag, c.mag, t); r.wade = lerp(a.wade, c.wade, t);
    r.dashes = c.dashes;
  }

  // Interpolated, error-smoothed local player state for rendering.
  localState(alpha, out) {
    const ecs = this.pred.ecs, e = this.youLocal;
    out.x = lerp(this.prev.x, this.cur.x, alpha) + this.err.x;
    out.y = lerp(this.prev.y, this.cur.y, alpha) + this.err.y;
    out.z = lerp(this.prev.z, this.cur.z, alpha) + this.err.z;
    out.f = this.prev.f + wrapAngle(this.cur.f - this.prev.f) * alpha;
    out.vx = ecs.vx[e]; out.vz = ecs.vz[e];
    out.st = ecs.state[e]; out.mag = ecs.moveMag[e]; out.wade = ecs.wade[e];
    out.dashT = ecs.dashT[e]; out.dashes = ecs.dashCount[e];
    out.charges = ecs.dashCharges[e]; out.maxCharges = ecs.dashMax[e]; out.recharge = ecs.dashRecharge[e];
    out.iframes = ecs.iframes[e];
    return out;
  }
}
