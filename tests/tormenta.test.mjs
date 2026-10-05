import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { emitPattern, Hazards, KILL, SHOT, STORM_CURSE } from '../src/sim/projectiles.js';
import { PEARLS, newPearls } from '../src/data/pearls.js';
import { SKILLS } from '../src/data/weapons.js';
import { SKILL_IDS, skillId, skillIndex, castKind } from '../src/data/tattoos.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { BTN } from '../src/sim/systems/movement.js';
import { timeToContact } from '../src/sim/systems/combat.js';
import { installInventory, newProfile, sanitizeProfile, attachProfile, devLoadout } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { trustSaves } from '../src/net/saves.js';
import { AimCast } from '../src/client/aimcast.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { LocalServer } from '../src/net/localServer.js';
import { A, map } from './helpers.mjs';

function fixture(kind = 'tormenta', customMap = map) {
  const w = new World(GAME.seed, { map: customMap, server: true });
  installInventory(w, 'tormenta-test');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 5, facing: Math.PI / 2 });
  const profile = newProfile();
  attachProfile(w, e, profile);
  const ecs = w.ecs;
  ecs.regenT[e] = 99;
  let seq = 0;
  const step = (cmd = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 8, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...cmd });
    w.stepWorld();
    const events = w.events.slice();
    w.events.length = 0;
    return events;
  };
  let pearl = null;
  if (kind) {
    pearl = givePearl(w, e, kind);
    assert.ok(pearl, `fixture pearl ${kind}`);
    assert.ok(swallowPearl(w, e, pearl.uid));
    ecs.cdG[e] = 0;
    ecs.regenT[e] = 99;
    w.events.length = 0;
  }
  return { w, e, ecs, profile, pearl, step };
}

function aimKeys(g = false) { return { q: false, e: false, r: false, g }; }

test('Tormenta profile migrates and saves, G is charge-only, and old tattoo slots retain their indices', () => {
  assert.equal(PEARLS.tormenta.elem, 3);
  assert.equal(PEARLS.tormenta.skill, 'mastbolt');
  assert.equal(SKILL_IDS[8], 'comet', 'Brasa keeps its persisted tattoo index');
  assert.equal(SKILL_IDS[9], 'iceanchor', 'Escarcha keeps its persisted tattoo index');
  assert.equal(SKILL_IDS[10], 'mastbolt');
  assert.equal(skillIndex('comet'), 8);
  assert.equal(skillId(skillIndex('mastbolt')), 'mastbolt');
  assert.equal(castKind('mastbolt'), 'charge');

  const old = newProfile(); delete old.pearls;
  assert.deepEqual(sanitizeProfile(old).pearls, newPearls());
  const { w, e, profile } = fixture();
  assert.deepEqual(trustSaves.load(trustSaves.store(profile)).pearls.swallowed, profile.pearls.swallowed);
  assert.equal(w.ecs.elem[e], 3);
  assert.equal(skillId(w.ecs.skG[e]), 'mastbolt');
  assert.equal(devLoadout(w, e, 'q', 'mastbolt'), false);
  assert.equal(devLoadout(w, e, 'e', 'mastbolt'), false);
});

test('charge aiming begins on press, remains previewed while held, and clears on release or lost focus', () => {
  const aim = new AimCast();
  const input = ({ down = false, up = false, held = false, cancel = false } = {}) => aim.step({
    down: aimKeys(down), up: aimKeys(up), held: aimKeys(held), cancel,
    kinds: { q: 'dir', e: 'dir', r: 'self', g: castKind(PEARLS.tormenta.skill) },
  });

  let out = input({ down: true, held: true });
  assert.equal(out.prs, BTN.G);
  assert.equal(out.held, BTN.G);
  assert.deepEqual(out.preview, { slot: 'g', kind: 'charge' });
  out = input({ held: true });
  assert.equal(out.prs, 0);
  assert.equal(out.held, BTN.G);
  assert.ok(out.preview);
  out = input({ up: true });
  assert.equal(out.prs, 0, 'the release is represented by clearing the held bit');
  assert.equal(out.held, 0);
  assert.equal(out.preview, null);

  input({ down: true, held: true });
  out = input();
  assert.equal(out.preview, null, 'lost focus drops the charge preview');
  assert.equal(out.held, 0);
  out = input({ up: true });
  assert.equal(out.prs, 0, 'release after lost focus cannot create a new cast');
});

test('a tap throws a short mastbolt, charges move slowly, and cooldown/no-pearl checks stay server-owned', () => {
  const { w, e, ecs, step } = fixture();
  const x0 = ecs.x[e];
  step({ prs: BTN.G, btn: BTN.G, mx: 1, ax: x0 + 8, az: ecs.z[e] });
  assert.equal(ecs.castK[e], 3);
  assert.equal(ecs.chg[e], 1);
  const chargeX = ecs.x[e];
  step({ btn: BTN.G, mx: 1, ax: x0 + 8, az: ecs.z[e] });
  assert.ok(ecs.x[e] > chargeX, 'the caster can still move while charging');
  assert.equal(ecs.moveMul[e], SKILLS.mastbolt.move, 'charge movement uses the skill slow');
  assert.equal(w.events.some((ev) => ev.type === 'mastbolt'), false, 'pressing alone does not throw');

  const release = step({ btn: 0, ax: x0 + 8, az: ecs.z[e] });
  const bolt = release.find((ev) => ev.type === 'mastbolt');
  assert.ok(bolt, 'letting go throws the bolt');
  assert.ok(bolt.k > 0 && bolt.k < 0.1, 'a quick tap has only a small charge');
  assert.equal(bolt.jumps, 1, 'minimum charge still reaches one additional enemy');
  assert.equal(ecs.castK[e], 0);
  assert.ok(ecs.cdG[e] > SKILLS.mastbolt.cd - 0.1);

  const blocked = step({ prs: BTN.G, btn: BTN.G });
  assert.equal(blocked.some((ev) => ev.type === 'cast' && ev.skill === 'mastbolt'), false, 'cooldown rejects a second cast');
  assert.equal(blocked.some((ev) => ev.type === 'mastbolt'), false);
  const cancelled = fixture();
  cancelled.step({ prs: BTN.G, btn: BTN.G });
  cancelled.step({ btn: BTN.G });
  const dash = cancelled.step({ prs: BTN.DASH, btn: BTN.G });
  assert.equal(cancelled.ecs.castK[cancelled.e], 0, 'a dash cancels an active charge');
  assert.equal(cancelled.ecs.cdG[cancelled.e], 0, 'a cancelled charge spends no cooldown');
  assert.equal(dash.some((ev) => ev.type === 'mastbolt'), false);
  assert.equal(cancelled.step().some((ev) => ev.type === 'mastbolt'), false, 'cancellation cannot throw on the next release');
  const bare = fixture(null);
  bare.step({ prs: BTN.G, btn: BTN.G });
  assert.equal(bare.ecs.castK[bare.e], 0, 'G does nothing without a swallowed Tormenta');
  assert.equal(bare.ecs.cdG[bare.e], 0);
});

test('holding to maxHold auto-fires at full charge and caps the chain at five targets', () => {
  const { w, e, ecs, step } = fixture();
  let events = [];
  for (let i = 0; i < 3 * 60 + 4; i++) events.push(...step({ prs: i === 0 ? BTN.G : 0, btn: BTN.G }));
  const bolt = events.find((ev) => ev.type === 'mastbolt');
  assert.ok(bolt, 'the max-hold timeout releases the charge');
  assert.equal(bolt.k, 1);
  assert.equal(bolt.jumps, 4, 'four additional jumps cap the total target count at five');
  assert.equal(ecs.castK[e], 0);
  assert.ok(ecs.cdG[e] > 14);
});

test('a successful Tormenta kit hit chains once to the nearest NPC, with no recursive or PvP chain', () => {
  const { w, e, ecs } = fixture();
  const first = w.spawnEnemy('dummy', ecs.x[e] + 2, ecs.z[e]);
  const nearLowId = w.spawnEnemy('dummy', ecs.x[e] + 4, ecs.z[e] + 1);
  const nearHighId = w.spawnEnemy('dummy', ecs.x[e] + 4, ecs.z[e] - 1);
  w.events.length = 0;
  const strikes = [], strike = w.strike.bind(w);
  w.strike = (id, raw, options) => { strikes.push({ id, raw, options }); return strike(id, raw, options); };
  const dealt = w.strike(first, 20, { by: e, kind: 'skill', skill: 'test', elem: 3, x: ecs.x[e], z: ecs.z[e], noCrit: true, knock: 0 });
  assert.ok(dealt > 0);
  const lightning = w.events.filter((ev) => ev.type === 'lightning' && ev.kind === 'chain');
  assert.equal(lightning.length, 1, 'one primary kit hit emits one passive chain');
  assert.deepEqual(lightning[0].points.map((p) => p.id), [first, nearLowId], 'equal-distance ties resolve by stable entity id');
  const damage = w.events.filter((ev) => ev.type === 'damage' && ev.by === e);
  assert.deepEqual(damage.map((ev) => ev.id), [first, nearLowId], 'the chained target cannot trigger another chain');
  assert.deepEqual(strikes.map((hit) => [hit.id, hit.raw]), [[first, 20], [nearLowId, 10]], 'the passive applies half the primary raw damage');
  assert.equal(strikes[1].options.noCrit, true);
  assert.equal(strikes[1].options.noElement, true);
  assert.equal(damage[1].crit, 0, 'passive damage cannot crit');
  assert.equal(damage[1].elem, 3, 'the secondary hit retains Storm visuals while its noElement flag prevents recursion');

  const otherPlayer = w.spawnPlayer({ x: ecs.x[e] + 2, z: ecs.z[e] + 5 });
  w.events.length = 0;
  w.strike(otherPlayer, 10, { by: e, kind: 'melee', elem: 3, x: ecs.x[e], z: ecs.z[e], noInv: true, noCrit: true });
  assert.equal(w.events.some((ev) => ev.type === 'lightning'), false, 'Tormenta passive is NPC-only');
});

test('charged mastbolt picks the first enemy in the cone and unique nearest jumps within range', () => {
  const { w, e, ecs, step } = fixture();
  const first = w.spawnEnemy('dummy', ecs.x[e] + 4, ecs.z[e] + 0.25);
  const second = w.spawnEnemy('dummy', ecs.x[e] + 7, ecs.z[e] + 0.25);
  const third = w.spawnEnemy('dummy', ecs.x[e] + 9, ecs.z[e] - 0.25);
  const outside = w.spawnEnemy('dummy', ecs.x[e] + 3, ecs.z[e] + 2.5);
  const strikes = [], strike = w.strike.bind(w);
  w.strike = (id, raw, options) => { strikes.push({ id, raw, options }); return strike(id, raw, options); };
  for (let i = 0; i < 72; i++) step({ prs: i === 0 ? BTN.G : 0, btn: BTN.G, ax: ecs.x[e] + 10, az: ecs.z[e] });
  const evs = step({ btn: 0, ax: ecs.x[e] + 10, az: ecs.z[e] });
  const lightning = evs.find((ev) => ev.type === 'lightning' && ev.kind === 'mastbolt');
  assert.ok(lightning, 'the authoritative server resolves the hit chain');
  assert.equal(lightning.points[0].id, first, 'the initial target is selected in the 20-degree half-cone');
  const damage = evs.filter((ev) => ev.type === 'damage' && ev.by === e && lightning.points.some((p) => p.id === ev.id));
  assert.deepEqual(damage.map((ev) => ev.id), lightning.points.map((p) => p.id), 'damage follows authoritative chain points without revisiting a target');
  assert.equal(lightning.points[0].id === outside, false, 'an out-of-cone NPC cannot be the initial target');
  assert.equal(new Set(lightning.points.map((p) => p.id)).size, lightning.points.length, 'a chain never cycles');
  for (let i = 1; i < lightning.points.length; i++) {
    assert.ok(Math.hypot(lightning.points[i].x - lightning.points[i - 1].x, lightning.points[i].z - lightning.points[i - 1].z) <= SKILLS.mastbolt.chainR,
      'each additional target is within the five-unit jump radius');
  }
  assert.deepEqual(strikes.map((hit) => hit.id), lightning.points.map((p) => p.id));
  for (let i = 0; i < strikes.length; i++) {
    assert.ok(Math.abs(strikes[i].raw - ecs.atk[e] * SKILLS.mastbolt.mult * SKILLS.mastbolt.falloff ** i) < 1e-9);
    assert.equal(strikes[i].options.noCrit, true);
    assert.equal(strikes[i].options.noElement, true);
  }
  assert.ok(damage.every((ev) => ev.crit === 0));
});

const flatMap = { ...map, groundAt: () => 0, queryColliders: () => [], colliders: [] };
function pattern(overrides = {}) {
  return {
    type: 'pattern', pid0: 5000, tick: 0, src: 9, pat: 'single', ptype: 'parry', n: 1,
    gap: 0, spread: 0, speed: 10, dmg: 8, x: A.x, y: 1, z: A.z, ang: 0,
    ...overrides,
  };
}

function network() {
  const queues = new Map(), bindings = new Map();
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send: (id, msg) => queues.get(id)?.push(structuredClone(msg)) });
  const deliver = (id, holdSnapshots = false) => {
    const q = queues.get(id), keep = [];
    for (let i = q.length; i > 0; i--) {
      const m = q.shift();
      if (holdSnapshots && m.t === MSG.SNAPSHOT) keep.push(m);
      else {
        const b = bindings.get(id);
        if (m.t === MSG.SNAPSHOT) b.snapshot(m); else b.message(m);
      }
    }
    q.push(...keep);
  };
  const join = (id) => {
    queues.set(id, []);
    const binding = {}; bindings.set(id, binding);
    const transport = {
      onMessage: (cb) => { binding.message = cb; }, onSnapshot: (cb) => { binding.snapshot = cb; }, start() {},
      sendInput: (_seq, cmd) => server.receive(id, { t: MSG.INPUTS, cmds: [cmd] }),
      send: (msg) => server.receive(id, msg),
    };
    const shown = [], client = new GameClient(transport, map, { emit: (type, ev) => { if (type === 'combat') shown.push(ev); } });
    client.start(); server.connect(id); deliver(id); client.join(`Tormenta ${id}`, 0); deliver(id);
    server.broadcastSnapshot(); deliver(id);
    return { client, shown, e: server.clients.get(id).entity };
  };
  return { server, deliver, join };
}

test('World.pattern emission freezes living Storm anchors into the shared event and chooses nearest then entity id', () => {
  const w = new World(GAME.seed, { map: flatMap, server: true });
  const low = w.spawnPlayer({ x: A.x - 8, z: A.z + 3 });
  const high = w.spawnPlayer({ x: A.x + 8, z: A.z + 3 });
  const dead = w.spawnPlayer({ x: A.x, z: A.z + 1 });
  w.ecs.elem[low] = 3; w.ecs.elem[high] = 3; w.ecs.elem[dead] = 3; w.ecs.dead[dead] = 1;
  w.firePattern(pattern({ x: A.x, z: A.z, ang: 0 }));
  const ev = w.events.find((item) => item.type === 'pattern');
  assert.deepEqual(ev.magnets, [{ e: low, x: A.x - 8, z: A.z + 3 }, { e: high, x: A.x + 8, z: A.z + 3 }],
    'only living Storm players are represented by their emission-time positions');
  const s = w.hazards.slot.get(ev.pid0);
  assert.ok(w.hazards.curve[s] < 0, 'the equal-distance tie selects the lower entity id on the left');
  assert.ok(Math.abs(w.hazards.curve[s]) <= STORM_CURSE.turn);
  const emittedPosition = { x: w.hazards.px(s, 60), z: w.hazards.pz(s, 60) };
  w.ecs.x[low] -= 40;
  assert.deepEqual({ x: w.hazards.px(s, 60), z: w.hazards.pz(s, 60) }, emittedPosition,
    'moving an anchored player after emission cannot re-aim an in-flight bullet');

  const noCurse = new World(GAME.seed, { map: flatMap, server: true });
  noCurse.firePattern(pattern({ pid0: 5100 }));
  assert.equal(noCurse.hazards.curve[noCurse.hazards.slot.get(5100)], 0, 'without a living Storm anchor the pattern stays straight');
});

test('Storm curves bend toward the fixed nearest anchor, obey turn and total-angle bounds, and never live-home', () => {
  const H = new Hazards();
  const ev = pattern({ life: 5, magnets: [{ e: 3, x: A.x + 10, z: A.z }] });
  emitPattern(H, ev, flatMap);
  const s = H.slot.get(ev.pid0);
  assert.ok(H.curve[s] > 0, 'a right-side magnet bends the projectile to the right');
  assert.ok(H.curve[s] <= STORM_CURSE.turn);
  const at60 = { x: H.px(s, 60), z: H.pz(s, 60) };
  ev.magnets = [{ e: 4, x: A.x - 10, z: A.z }];
  assert.deepEqual({ x: H.px(s, 60), z: H.pz(s, 60) }, at60, 'moving a pirate after emission cannot change the stored curve');

  const straight = new Hazards();
  const noMagnet = pattern({ pid0: 5200 });
  emitPattern(straight, noMagnet, flatMap);
  const line = straight.slot.get(noMagnet.pid0);
  assert.equal(straight.curve[line], 0);
  assert.equal(straight.px(line, 60), A.x);
  assert.ok(at60.x > A.x);

  const far = new Hazards();
  const farEvent = pattern({ pid0: 5300, magnets: [{ e: 2, x: A.x + STORM_CURSE.range + 0.1, z: A.z }] });
  emitPattern(far, farEvent, flatMap);
  assert.equal(far.curve[far.slot.get(farEvent.pid0)], 0, 'anchors beyond 18 units are ignored');
  const endpoint = H.px(s, 240), endpointLater = H.px(s, 300);
  assert.ok(Number.isFinite(endpoint) && endpointLater > endpoint, 'the projectile continues after completing its bounded arc');
});

test('server events and storm snapshots reconstruct the same curved path, removals, and frost composition', () => {
  const w = new World(GAME.seed, { map: flatMap, server: true });
  const owner = w.spawnPlayer({ x: A.x + 9, z: A.z + 2 });
  w.ecs.elem[owner] = 3;
  w.firePattern(pattern({ pid0: 5400, x: A.x, z: A.z, ang: 0, life: 5 }));
  const ev = w.events.find((item) => item.type === 'pattern');
  const liveSlot = w.hazards.slot.get(ev.pid0);
  assert.ok(w.hazards.curve[liveSlot] > 0);

  const transport = { onMessage() {}, onSnapshot() {}, start() {} };
  const remote = new GameClient(transport, flatMap, { emit() {} });
  remote.onEvent(structuredClone(ev));
  remote.onEvent(structuredClone(ev));
  const rh = remote.pred.hazards, rs = rh.slot.get(ev.pid0);
  assert.equal(rh.count, 1, 'replaying the same pattern event does not duplicate a projectile');
  for (const tick of [30, 90, 180, 240]) {
    assert.equal(rh.px(rs, tick), w.hazards.px(liveSlot, tick));
    assert.equal(rh.pz(rs, tick), w.hazards.pz(liveSlot, tick));
  }
  const forwardFirst = rh.px(rs, 240); rh.px(rs, 30); rh.px(rs, 120);
  const rewindFirst = new Hazards(); emitPattern(rewindFirst, structuredClone(ev), flatMap);
  const rws = rewindFirst.slot.get(ev.pid0);
  rewindFirst.px(rws, 30); rewindFirst.px(rws, 120);
  assert.equal(rewindFirst.px(rws, 240), forwardFirst, 'rewind query order does not alter the analytical result');

  const f = { e: 77, seq: 4, x: A.x, z: A.z + 2, r: 3, t0: 0, tEnd: 240, slow: 0.5 };
  w.hazards.addFrostField(f); rh.addFrostField(f);
  assert.equal(rh.px(rs, 120), w.hazards.px(liveSlot, 120), 'frost and storm slowdown compose identically on server and remote client');
  const pastEnd = w.hazards.px(liveSlot, 250);
  assert.ok(pastEnd > w.hazards.px(liveSlot, 240), 'the recorded field interval ends without freezing the projectile');

  w.hazards.remove(liveSlot, 80, KILL.REFLECT, owner, 12);
  w.hazards.sweep(130); // The bullet slot is reusable, but its pattern tombstone remains for late joiners.
  assert.equal(w.hazards.slot.has(ev.pid0), false, 'expired bullet slots are reclaimed');
  const snapshot = { tick: 81, ack: 0, ents: [], enc: [], storm: w.hazards.stormSnapshot() };
  const late = new GameClient(transport, flatMap, { emit() {} });
  late.onSnapshot(snapshot);
  const lh = late.pred.hazards, ls = lh.slot.get(ev.pid0);
  assert.notEqual(ls, undefined, 'a late join reconstructs the retained magnet pattern');
  assert.equal(lh.live(ls, 50), false, 'the removal tombstone prevents resurrection on snapshot recovery');
  assert.equal(lh.kill[ls], KILL.REFLECT);

  const crowded = new Hazards(1);
  const burst = pattern({ pid0: 5450, pat: 'burst', n: 3, gap: 0.2,
    magnets: [{ e: owner, x: A.x + 9, z: A.z + 2 }] });
  emitPattern(crowded, burst, flatMap);
  assert.deepEqual(burst.omitted, [5451, 5452], 'the authority records bullets dropped by its full pool');
  const recovered = new GameClient(transport, flatMap, { emit() {} });
  recovered.onSnapshot({ tick: 1, ack: 0, ents: [], enc: [], storm: crowded.stormSnapshot() });
  assert.equal(recovered.pred.hazards.count, 1, 'a larger client pool cannot recreate dropped burst shots');
  assert.equal(recovered.pred.hazards.slot.has(5451), false);
  assert.equal(recovered.pred.hazards.slot.has(5452), false);
});

test('a storm curve clips against a blocker on the curved arc; its TTL stays fixed and reflected player shots stay straight', () => {
  const probe = new Hazards();
  const ev = pattern({ pid0: 5500, magnets: [{ e: 1, x: A.x + 10, z: A.z }], life: 2 });
  emitPattern(probe, structuredClone(ev), flatMap);
  const ps = probe.slot.get(ev.pid0), wall = { x: probe.px(ps, 60), z: probe.pz(ps, 60), r: 0.65 };
  const obstacleMap = { ...flatMap, colliders: [wall], queryColliders: () => [0] };
  const curved = new Hazards(); emitPattern(curved, structuredClone(ev), obstacleMap);
  const cs = curved.slot.get(ev.pid0);
  const straight = new Hazards(); emitPattern(straight, { ...ev, pid0: 5510, magnets: undefined }, obstacleMap);
  const ss = straight.slot.get(5510);
  assert.ok(curved.clipD[cs] < curved.speed[cs] * 2, 'static collision is sampled along the real curved path');
  assert.equal(straight.clipD[ss], straight.speed[ss] * 2, 'the original straight ray misses the obstacle');
  const stop = { x: curved.px(cs, 120), z: curved.pz(cs, 120) };
  assert.deepEqual({ x: curved.px(cs, 240), z: curved.pz(cs, 240) }, stop, 'the bullet stays stopped at its sampled collision point');
  assert.equal(curved.tEnd[cs], 120, 'curvature does not extend the configured two-second lifetime');

  const w = new World(GAME.seed, { map: flatMap, server: true });
  w.hazards.addFrostField({ e: 3, seq: 1, x: A.x, z: A.z + 2, r: 4, t0: 0, tEnd: 300, slow: 0.25 });
  const shot = w.shots.spawn(5600, { owner: 3, type: 0, x: A.x, y: 1, z: A.z, dx: 0, dz: 1,
    speed: 10, life: 2, r: 0.2, dmg: 1, kind: SHOT.REFLECT, homing: 0 });
  w.shots.step(shot, 1, () => 0, () => false, {});
  assert.equal(w.shots.z[shot], A.z + 10, 'a reflected player shot is not curved or slowed by the curse/field path');
  assert.equal(w.shots.x[shot], A.x);
});

test('predicted mastbolt feedback is echoed once, and delayed reconciliation rolls back a rejected G charge', () => {
  const accepted = network(), a = accepted.join(1), aw = accepted.server.world, ae = a.e;
  aw.ecs.regenT[ae] = 99;
  const pearl = givePearl(aw, ae, 'tormenta');
  assert.ok(swallowPearl(aw, ae, pearl.uid));
  aw.ecs.cdG[ae] = 0;
  const target = aw.spawnEnemy('dummy', aw.ecs.x[ae] + 4, aw.ecs.z[ae]);
  accepted.server.sendProfile(1, accepted.server.clients.get(1));
  accepted.server.broadcastSnapshot(); accepted.deliver(1);
  const cast = (client, server, id, deliver, hold = false) => {
    const ecs = client.pred.ecs, me = client.youLocal;
    const aim = { ax: ecs.x[me] + 8, az: ecs.z[me] };
    client.tickInput({ ...aim, btn: BTN.G, prs: BTN.G });
    server.step(); server.broadcastSnapshot(); deliver(id, hold);
    client.tickInput({ ...aim, btn: 0, prs: 0 });
    server.step(); server.broadcastSnapshot(); deliver(id, hold);
  };
  cast(a.client, accepted.server, 1, accepted.deliver);
  assert.equal(a.shown.filter((ev) => ev.type === 'mastbolt' && ev.seq === 2).length, 1,
    `the local cast is predicted and its server echo is not played a second time: ${JSON.stringify({shown:a.shown,joined:a.client.joined,local:a.client.youLocal,elem:a.client.pred.ecs.elem[a.client.youLocal],castK:a.client.pred.ecs.castK[a.client.youLocal],pending:a.client.pending.length,serverCast:aw.ecs.castK[ae],serverEvents:aw.events})}`);
  assert.equal(a.shown.filter((ev) => ev.type === 'lightning' && ev.kind === 'mastbolt').length, 1,
    'the authoritative server supplies one lightning chain');
  assert.equal(aw.ecs.hp[target] < aw.ecs.maxHp[target], true, 'the server resolves the targeted NPC hit');

  const rejected = network(), b = rejected.join(2), bw = rejected.server.world, be = b.e;
  bw.ecs.regenT[be] = 99;
  const secondPearl = givePearl(bw, be, 'tormenta');
  assert.ok(swallowPearl(bw, be, secondPearl.uid));
  bw.ecs.cdG[be] = 0;
  rejected.server.sendProfile(2, rejected.server.clients.get(2));
  rejected.server.broadcastSnapshot(); rejected.deliver(2);
  bw.ecs.cdG[be] = 8;
  b.client.pred.ecs.cdG[b.client.youLocal] = 0; // a stale client still sees G ready
  cast(b.client, rejected.server, 2, rejected.deliver, true);
  assert.ok(b.shown.some((ev) => ev.type === 'mastbolt' && ev.predicted), 'the stale client predicted a bolt before learning its cast was rejected');
  assert.equal(bw.events.some((ev) => ev.type === 'mastbolt'), false, 'the authoritative cooldown rejects the cast');
  assert.equal(bw.ecs.castK[be], 0);
  rejected.deliver(2, false);
  assert.equal(b.client.pred.ecs.castK[b.client.youLocal], 0, 'the delayed snapshot removes the predicted active charge');
  assert.equal(b.client.pred.ecs.chg[b.client.youLocal], 0);
  assert.equal(b.client.pred.ecs.cdG[b.client.youLocal], bw.ecs.cdG[be], 'reconciliation restores the server-owned cooldown');
});

test('parry timing follows the curved frost-slowed path and respects static clipping and projectile lifetime', () => {
  const w = new World(GAME.seed, { map: flatMap, server: true });
  const e = w.spawnPlayer({ x: A.x, z: A.z + 20 });
  const ev = pattern({ pid0: 5700, x: A.x, z: A.z, ang: 0, life: 5,
    magnets: [{ e: 900, x: A.x + 10, z: A.z }] });
  emitPattern(w.hazards, ev, flatMap);
  const H = w.hazards, curved = H.slot.get(ev.pid0);
  H.addFrostField({ e: 901, seq: 1, x: A.x + 0.7, z: A.z + 8, r: 3, t0: 30, tEnd: 160, slow: 0.5 });
  const pt = 90, futureTick = pt + Math.max(3, Math.floor(tuning.sword.poor.tc * 0.75 / DT));
  const future = H._path(curved, futureTick);
  w.ecs.x[e] = future.x; w.ecs.z[e] = future.z;
  const eta = timeToContact(w, e, curved, pt);
  assert.ok(Number.isFinite(eta) && eta > 0 && eta < tuning.sword.poor.tc,
    `a point on the future arc should be contactable inside the POBRE window (${eta})`);

  const straightEv = pattern({ pid0: 5710, x: A.x, z: A.z, ang: 0, life: 5 });
  emitPattern(H, straightEv, flatMap);
  const straight = H.slot.get(straightEv.pid0);
  const radius = w.ecs.hurtR[e] + H.r[straight] + tuning.sword.slack;
  assert.ok(Math.hypot(H.px(straight, pt) - future.x, H.pz(straight, pt) - future.z) > radius,
    'the player is outside the parallel straight bullet radius');
  assert.equal(timeToContact(w, e, straight, pt), Infinity, 'a parallel miss is not promoted to a parry contact');

  const blockerTick = 75, wall = { x: H.px(curved, blockerTick), z: H.pz(curved, blockerTick), r: 0.5 };
  const obstacleMap = { ...flatMap, colliders: [wall], queryColliders: () => [0] };
  const blocked = new World(GAME.seed, { map: obstacleMap, server: true });
  const be = blocked.spawnPlayer({ x: future.x, z: future.z });
  const blockedEvent = { ...ev, pid0: 5720 };
  emitPattern(blocked.hazards, blockedEvent, obstacleMap);
  const bs = blocked.hazards.slot.get(blockedEvent.pid0);
  blocked.hazards.addFrostField({ e: 901, seq: 1, x: A.x + 0.7, z: A.z + 8, r: 3, t0: 30, tEnd: 160, slow: 0.5 });
  assert.ok(blocked.hazards.clipD[bs] < blocked.hazards.speed[bs] * 5, 'the static wall clips the true curved trajectory');
  assert.equal(timeToContact(blocked, be, bs, pt), Infinity, 'the parry solver cannot see through a curved-path blocker');

  const short = new World(GAME.seed, { map: flatMap, server: true });
  const se = short.spawnPlayer({ x: future.x, z: future.z });
  const shortEvent = { ...ev, pid0: 5730, life: (pt + 1) * DT };
  emitPattern(short.hazards, shortEvent, flatMap);
  const ss = short.hazards.slot.get(shortEvent.pid0);
  short.hazards.addFrostField({ e: 901, seq: 1, x: A.x + 0.7, z: A.z + 8, r: 3, t0: 30, tEnd: 160, slow: 0.5 });
  assert.equal(timeToContact(short, se, ss, pt), Infinity, 'a fixed projectile TTL can end before the future arc reaches the player');
});
