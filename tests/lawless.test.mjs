// M4.5 P2: La Cala Calavera. Inside the ring of skulls every pirate's blow lands on every other pirate in it, the
// loot is public and a pirate who falls there drops everything they carry. Outside, nothing changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning } from '../src/data/tuning.js';
import { LAWLESS } from '../src/data/lawless.js';
import { LOOT } from '../src/data/loot.js';
import { WEAPON } from '../src/data/weapons.js';
import { ITEMS } from '../src/data/items.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';
import { rollItem } from '../src/sim/items.js';
import { GAME } from '../src/data/meta.js';
import { map, A } from './helpers.mjs';

const K = map.cala;
// A clear stretch inside the fort: 9 u along +x with no prop within 1.6 u of it (bullets fly, nobody stands in a fire).
const OPEN = (() => {
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
function server() {
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
function duel(at = OPEN) {
  const S = server();
  const a = S.join(1, at.x, at.z), b = S.join(2, at.x + 1.6, at.z);
  for (let i = 0; i < 4; i++) S.both();
  return { ...S, a, b };
}

test('the Cala on the map: inside the ring of skulls is lawless, its door is a checkpoint outside, nothing random grows there', () => {
  assert.ok(map.lawlessAt(K.x, K.z));
  assert.ok(!map.lawlessAt(A.x, A.z), 'La Caldera keeps its law');
  assert.ok(!map.lawlessAt(map.landmarks.village.x, map.landmarks.village.z));
  assert.equal(map.zoneAt(K.x, K.z), 'calavera');
  const cp = map.checkpoints.calavera;
  assert.ok(cp && !map.lawlessAt(cp.x, cp.z) && Math.hypot(cp.x - K.x, cp.z - K.z) < K.r + 6, 'you wake at its door');
  assert.equal(map.checkpointAt(K.x, K.z), 'calavera');
  const wild = map.props.filter((p) => ['palm', 'bush', 'rock'].includes(p.kind) && (Math.hypot(p.x - K.x, p.z - K.z) < K.r || map.trailInfo(p.x, p.z).d < 3));
  assert.equal(wild.length, 0, 'the fort and the trail are cleared');
  assert.equal(map.props.filter((p) => p.kind === 'skullPost').length, 16);
  assert.ok(map.masks(K.entry.x, K.entry.z).path > 0.5 && map.masks(map.cala.trail[1].x, map.cala.trail[1].z).path > 0.5, 'a dirt trail leads there');
  // The walk in is gentle: no step on the trail is steeper than the sim allows.
  for (let i = 0; i < 60; i++) {
    const t0 = i / 60, t1 = (i + 1) / 60, T = map.cala.trail;
    const at = (t) => { const seg = Math.min(T.length - 2, Math.floor(t * (T.length - 1))), u = t * (T.length - 1) - seg; return { x: T[seg].x + (T[seg + 1].x - T[seg].x) * u, z: T[seg].z + (T[seg + 1].z - T[seg].z) * u }; };
    const p = at(t0), q = at(t1);
    const slope = Math.abs(map.groundAt(q.x, q.z) - map.groundAt(p.x, p.z)) / Math.hypot(q.x - p.x, q.z - p.z);
    assert.ok(slope < 0.35, `trail slope ${slope.toFixed(2)} at ${i}`);
  }
});

test('outside the Cala there is no friendly fire', () => {
  const { ecs, a, b, both } = duel(A);
  const hp = ecs.hp[b];
  for (let i = 0; i < 40; i++) both({ prs: i % 12 === 0 ? BTN.ATTACK : 0 });
  assert.equal(ecs.hp[b], hp, 'the cutlass passes through your crewmate');
  assert.ok(ecs.alive[a]);
});

test('inside, the cutlass, the pistols and the storm hurt the other pirate (× pvpDmg, after their DEF), lag-compensated', () => {
  const { ecs, w, a, b, both, events } = duel();
  const hp0 = ecs.hp[b];
  for (let i = 0; i < 30; i++) both({ prs: i === 0 ? BTN.ATTACK : 0 });
  const hits = events(2, 'hurt').filter((ev) => ev.e === b && ev.kind === 'pvp');
  assert.ok(hits.length >= 1, 'a cutlass hit');
  assert.equal(hits[0].by, a);
  assert.ok(ecs.hp[b] < hp0);
  const raw = ecs.atk[a] * tuning.melee.stages[0].mult * LAWLESS.pvpDmg;
  assert.ok(hits[0].dmg <= Math.ceil(raw * (tuning.stats.critMult + 0.01)) && hits[0].dmg >= 1);
  assert.ok(events(1, 'hurt').some((ev) => ev.e === b && ev.kind === 'pvp'), 'the attacker hears it too');
  // Pistols.
  const P = server();
  const p1 = P.join(1, OPEN.x, OPEN.z, WEAPON.PISTOLAS), p2 = P.join(2, OPEN.x + 6, OPEN.z);
  for (let i = 0; i < 4; i++) P.both();
  const h2 = P.ecs.hp[p2];
  for (let i = 0; i < 50; i++) P.both({ btn: BTN.ATTACK, prs: i === 0 ? BTN.ATTACK : 0 });
  assert.ok(P.ecs.hp[p2] < h2, 'bullets');
  assert.ok(P.events(2, 'hurt').some((ev) => ev.by === p1 && ev.kind === 'pvp'));
  // The storm (R with a full meter): heavy, through DEF.
  const { ecs: e3, a: a3, b: b3, both: both3 } = duel();
  e3.riposte[a3] = tuning.parry.riposte.max;
  const h3 = e3.hp[b3];
  for (let i = 0; i < 10; i++) both3({ prs: i === 0 ? BTN.R : 0 });
  assert.ok(e3.hp[b3] <= h3 - Math.round(e3.atk[a3] * tuning.parry.riposte.dmgMult * LAWLESS.pvpDmg) + 1, 'the storm');
  assert.ok(e3.stagger[b3] > 0 || e3.dead[b3] > 0, 'heavy: it staggers');
  assert.ok(w);
});

test('inside, a raised guard blocks a pirate\'s cutlass, a perfect one stops it and staggers the attacker; the dash dodges it', () => {
  // Block: the guard has been up a while (not perfect).
  {
    const { ecs, a, b, both, events } = duel();
    for (let i = 0; i < 20; i++) both({}, { btn: BTN.GUARD, prs: i === 0 ? BTN.GUARD : 0 });
    const st = ecs.guardSt[b], hp = ecs.hp[b];
    for (let i = 0; i < 20; i++) both({ prs: i === 0 ? BTN.ATTACK : 0 }, { btn: BTN.GUARD });
    const g = events(2, 'guard').filter((ev) => ev.pvp && ev.st === 'block');
    assert.equal(g.length, 1, 'blocked');
    assert.ok(ecs.guardSt[b] < st, 'it cost stamina');
    const lost = hp - ecs.hp[b];
    assert.ok(lost >= 1 && lost < ecs.atk[a] * LAWLESS.pvpDmg * 0.5, `only a little gets through (${lost})`);
  }
  // Perfect: raised just before the blow.
  {
    const { ecs, a, b, both, events } = duel();
    const hp = ecs.hp[b];
    both({ prs: BTN.ATTACK }, { btn: BTN.GUARD, prs: BTN.GUARD });
    for (let i = 0; i < 20; i++) both({}, { btn: BTN.GUARD });
    assert.ok(events(2, 'guard').some((ev) => ev.pvp && ev.st === 'perfect'), 'perfect');
    assert.equal(ecs.hp[b], hp, 'nothing gets through');
    assert.ok(events(1, 'stun').some((ev) => ev.id === a), 'the attacker reels');
  }
  // Dash: the cutlass meets a dashing pirate.
  {
    const { ecs, b, both, events } = duel();
    const hp = ecs.hp[b];
    both({ prs: BTN.ATTACK }, { mx: 0, mz: 1, prs: BTN.DASH });
    for (let i = 0; i < 12; i++) both();
    assert.ok(ecs.hp[b] === hp || events(2, 'dodge').some((ev) => ev.pvp), 'dodged');
  }
});

test('falling inside spills everything you wear and carry (a starter weapon aside) and your potions, for anyone; the gold stays', () => {
  const { w, ecs, a, b, both, events, profile, put } = duel();
  const pb = profile(2);
  // Gear up the victim: a real weapon, a hat, two things in the bag, 3 potions, some gold.
  for (const [slot, r] of [['weapon', 2], ['head', 1]]) { const it = rollItem(w.lootRng, { lvl: 5, slot, rarity: r, weapon: slot === 'weapon' ? 'sable' : undefined }); it.u = pb.uid++; pb.eq[slot] = it; }
  for (const slot of ['boots', 'ring']) { const it = rollItem(w.lootRng, { lvl: 3, slot }); it.u = pb.uid++; pb.bag.push(it); }
  ecs.potions[b] = 3;
  pb.gold = 77;
  const carried = [pb.eq.weapon, pb.eq.head, ...pb.bag].map((it) => it.b).sort();
  ecs.hp[b] = 1;
  for (let i = 0; i < 20 && !ecs.dead[b]; i++) both({ prs: i % 10 === 0 ? BTN.ATTACK : 0 });
  assert.ok(ecs.dead[b] > 0, 'down');
  assert.ok(events(1, 'death').some((ev) => ev.id === b && ev.by === a), 'killed by pirate 1');
  assert.deepEqual(pb.bag, []);
  assert.equal(pb.eq.head, null);
  assert.ok(pb.eq.weapon && pb.eq.weapon.s === 1 && pb.eq.weapon.b === 'sable', 'a starter of the same kit');
  assert.equal(ecs.potions[b], 0);
  assert.equal(pb.gold, 77, 'the gold is safe');
  assert.equal(pb.stats.deaths, 1);
  assert.equal(profile(1).stats.pk, 1);
  const pub = [...w.drops.values()].filter((d) => !d.to);
  assert.equal(pub.filter((d) => d.kind === 'item').length, 4);
  assert.equal(pub.filter((d) => d.kind === 'potion').length, 3);
  assert.deepEqual(pub.filter((d) => d.kind === 'item').map((d) => d.item.b).sort(), carried);
  const sp = events(2, 'spill');
  assert.ok(sp.length === 1 && sp[0].n === 4 && sp[0].pot === 3, 'the fallen pirate is told');
  assert.ok(pub.every((d) => Math.hypot(d.x - sp[0].x, d.z - sp[0].z) < LAWLESS.spill.scatter[1] + 0.01), 'around the body');
  for (const id of [1, 2]) assert.ok(events(id, 'loot').some((ev) => ev.pub && ev.drops.length === 7 && ev.drops.every((d) => d.pub && d.from === 'P2')), `everyone sees it (${id})`);
  // The winner walks over it: it is theirs now (renumbered), and everyone sees it go.
  const pa = profile(1), bag0 = pa.bag.length;
  for (const d of pub) { put(a, d.x, d.z); for (let i = 0; i < 4; i++) both(); }
  assert.equal(pa.bag.length, bag0 + 4);
  assert.equal(new Set(pa.bag.map((it) => it.u)).size, pa.bag.length, 'unique uids');
  assert.ok(events(2, 'unloot').some((ev) => ev.pub && ev.why === 'pick' && ev.by === a));
  assert.equal([...w.drops.values()].filter((d) => !d.to).length, 0);
});

test('outside the Cala a fall costs nothing; a pirate who arrives later sees the public loot on the ground', () => {
  const S = server();
  const a = S.join(1, A.x, A.z), pa = S.profile(1);
  const it = rollItem(S.w.lootRng, { lvl: 3, slot: 'head' }); it.u = pa.uid++; pa.eq.head = it;
  S.ecs.hp[a] = 1;
  S.w.hazards.spawn(S.w.nextPid++, 0, 0, S.ecs.x[a] + 3, S.ecs.y[a] + 1.1, S.ecs.z[a], -10, 0, S.w.tick, 30, map);
  for (let i = 0; i < 30; i++) S.act(1, {}, a);
  assert.ok(S.ecs.dead[a] > 0);
  assert.equal(pa.eq.head, it, 'kept');
  assert.equal(S.w.drops.size, 0);
  // Something public in the Cala, then a newcomer.
  for (let i = 0; i < 200 && S.ecs.dead[a] > 0; i++) S.act(1, {}, a);
  S.put(a, OPEN.x, OPEN.z);
  S.ecs.hp[a] = 1; S.ecs.hurtInv[a] = 0;
  S.w.hazards.spawn(S.w.nextPid++, 0, 0, OPEN.x + 3, S.ecs.y[a] + 1.1, OPEN.z, -10, 0, S.w.tick, 30, map);
  for (let i = 0; i < 30; i++) S.act(1, {}, a);
  assert.ok(S.ecs.dead[a] > 0 && pa.eq.head === null, 'fell in the Cala: spilled');
  const b = S.join(2, A.x, A.z);
  const late = S.events(2, 'loot').find((ev) => ev.pub && ev.late);
  assert.ok(late && late.drops.filter((d) => d.kind === 'item').length === 1 && late.drops.find((d) => d.kind === 'item').item.b === it.b, 'the newcomer sees it');
  assert.equal(late.drops.filter((d) => d.kind === 'potion').length, 2, 'and the potions');
  assert.ok(b);
});

test('a mob killed inside drops public loot, rolled once (quest items stay personal)', () => {
  const S = server();
  const a = S.join(1, OPEN.x, OPEN.z), b = S.join(2, OPEN.x + 3, OPEN.z);
  const old = LOOT.archer;
  LOOT.archer = { gold: [1, 5, 5], item: 1, potion: 0 };
  try {
    const o = S.w.spawnEnemy('archer', OPEN.x + 1, OPEN.z + 1, 0);
    S.w.killEnemy(o, a);
    S.s.flushEvents();
  } finally { LOOT.archer = old; }
  const pub = [...S.w.drops.values()];
  assert.equal(pub.length, 2, 'one roll: the gold and the item');
  assert.ok(pub.every((d) => d.to === 0));
  assert.ok(S.events(2, 'loot').some((ev) => ev.pub), 'the other pirate sees it');
  // Pirate 2 grabs both.
  for (const d of pub) { S.put(b, d.x, d.z); for (let i = 0; i < 4; i++) S.both(); }
  assert.equal(S.profile(2).gold, 5);
  assert.equal(S.profile(2).bag.length, 1);
  assert.ok(ITEMS.bag > 0 && S.ent(1) === a);
});
