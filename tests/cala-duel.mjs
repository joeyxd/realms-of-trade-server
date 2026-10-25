import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { map } from './helpers.mjs';

const K = map.cala;
// A clear stretch inside the fort: 9 u along +x with no prop within 1.6 u of it (bullets fly, nobody stands in a fire).
export const OPEN = (() => {
  for (let r = 3; r < K.r - 10; r += 1) for (let a = 0; a < 6.28; a += 0.4) {
    const x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r;
    let ok = true;
    for (const c of map.colliders) {
      const t = Math.max(0, Math.min(9, c.x - x));
      if (Math.hypot(c.x - (x + t), c.z - z) < c.r + 1.6) { ok = false; break; }
    }
    if (ok && map.lawlessAt(x + 9, z)) return { x, z };
  }
  throw new Error('no open ground in the Cala');
})();

// A LocalServer with no bots or map enemies. join(id, x, z) puts a pirate there; act(id, cmd) queues one command
// (aiming at `at`, the other pirate by default) and steps the world once.
export function calaServer() {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const w = s.world, ecs = w.ecs, seqs = new Map();
  const put = (e, x, z) => { ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z); ecs.vx[e] = ecs.vz[e] = 0; };
  const join = (id, x, z, weapon = 0) => {
    s.connect(id);
    s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon });
    const e = s.clients.get(id).entity;
    put(e, x, z);
    s.receive(id, { t: MSG.CMD, type: 'dev', op: 'mastery', level: 3 });
    return e;
  };
  const ent = (id) => s.clients.get(id).entity;
  const act = (id, c = {}, at = null) => {
    const e = ent(id), seq = (seqs.get(id) || 0) + 1;
    seqs.set(id, seq);
    const t = at ?? ent(id === 1 ? 2 : 1);
    s.receive(id, { t: MSG.INPUTS, cmds: [{ seq, mx: 0, mz: 0, ax: ecs.x[t], az: ecs.z[t], btn: 0, prs: 0, pt: w.tick, ...c }] });
    s.step();
    return e;
  };
  // Both pirates act each tick (the second one idles unless told).
  const both = (c1 = {}, c2 = {}) => {
    for (const [id, c] of [[1, c1], [2, c2]]) {
      const seq = (seqs.get(id) || 0) + 1;
      seqs.set(id, seq);
      const t = ent(id === 1 ? 2 : 1);
      s.receive(id, { t: MSG.INPUTS, cmds: [{ seq, mx: 0, mz: 0, ax: ecs.x[t], az: ecs.z[t], btn: 0, prs: 0, pt: w.tick, ...c }] });
    }
    s.step();
  };
  const events = (id, type) => (sent.get(id) || []).filter((m) => m.t === MSG.EVENT && (!type || m.ev.type === type)).map((m) => m.ev);
  const profile = (id) => w.profiles.get(ent(id));
  return { s, w, ecs, join, put, ent, act, both, events, profile, sent };
}

// Two pirates 1.6 u apart, face to face, at (x, z).
export function calaDuel(at = OPEN) {
  const S = calaServer();
  const a = S.join(1, at.x, at.z), b = S.join(2, at.x + 1.6, at.z);
  for (let i = 0; i < 4; i++) S.both();
  return { ...S, a, b };
}
