// M4.8 P2: Escarcha's passive, ground cast, and analytic frost fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AimCast } from '../src/client/aimcast.js';
import { PEARLS, newPearls } from '../src/data/pearls.js';
import { SKILLS } from '../src/data/weapons.js';
import { SKILL_IDS, skillId, skillIndex, castKind } from '../src/data/tattoos.js';
import { GAME } from '../src/data/meta.js';
import { DT, tuning } from '../src/data/tuning.js';
import { World } from '../src/sim/world.js';
import { SHOT, clipDistance } from '../src/sim/projectiles.js';
import { installInventory, newProfile, sanitizeProfile, attachProfile, devLoadout } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { BTN } from '../src/sim/systems/movement.js';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG } from '../src/net/protocol.js';
import { GameClient } from '../src/client/gameClient.js';
import { trustSaves } from '../src/net/saves.js';
import { map, A } from './helpers.mjs';

function fixture(kind = 'escarcha') {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'escarcha-test');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 5, facing: Math.PI / 2 });
  const profile = newProfile();
  attachProfile(w, e, profile);
  w.ecs.regenT[e] = 99;
  let seq = 0;
  const step = (cmd = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...cmd });
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
    w.ecs.cdG[e] = 0;
    w.ecs.regenT[e] = 99;
    w.events.length = 0;
  }
  return { w, e, ecs: w.ecs, profile, pearl, step };
}

function network() {
  const queues = new Map(), bindings = new Map(), clients = new Map();
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send: (id, msg) => queues.get(id)?.push(structuredClone(msg)) });
  const deliver = (id, holdSnapshots = false) => {
    const q = queues.get(id), keep = [];
    const n = q.length;
    for (let i = 0; i < n; i++) {
      const m = q.shift();
      if (holdSnapshots && m.t === MSG.SNAPSHOT) { keep.push(m); continue; }
      const b = bindings.get(id);
      if (m.t === MSG.SNAPSHOT) b.snapshot(m); else b.message(m);
    }
    q.push(...keep);
  };
  const join = (id) => {
    queues.set(id, []);
    const binding = {};
    bindings.set(id, binding);
    const transport = {
      onMessage: (cb) => { binding.message = cb; },
      onSnapshot: (cb) => { binding.snapshot = cb; },
      start() {},
      sendInput: (_seq, cmd) => server.receive(id, { t: MSG.INPUTS, cmds: [cmd] }),
      send: (msg) => server.receive(id, msg),
    };
    const client = new GameClient(transport, map, { emit() {} });
    client.start();
    server.connect(id);
    deliver(id);
    client.join(`Test ${id}`, 0);
    deliver(id);
    server.broadcastSnapshot();
    deliver(id);
    clients.set(id, client);
    return { client, e: server.clients.get(id).entity };
  };
  return { server, clients, deliver, join };
}

test('Escarcha profiles migrate and survive saves, while G stays separate from tattoo loadouts', () => {
  assert.equal(PEARLS.escarcha.elem, 2);
  assert.equal(PEARLS.escarcha.skill, 'iceanchor');
  assert.equal(SKILL_IDS.at(-1), 'iceanchor');
  assert.equal(skillIndex('comet'), 8, 'adding Escarcha preserves Brasa saves');
  assert.equal(skillId(skillIndex('iceanchor')), 'iceanchor');
  const legacy = newProfile(); delete legacy.pearls;
  assert.deepEqual(sanitizeProfile(legacy).pearls, newPearls());

  const { w, e, profile } = fixture();
  assert.deepEqual(trustSaves.load(trustSaves.store(profile)).pearls.swallowed, { ...profile.pearls.swallowed });
  assert.equal(devLoadout(w, e, 'q', 'iceanchor'), false, 'a pearl power cannot be assigned to Q');
  assert.equal(devLoadout(w, e, 'e', 'iceanchor'), false, 'a pearl power cannot be assigned to E');
  assert.equal(skillId(w.ecs.skG[e]), 'iceanchor');
  assert.equal(w.ecs.elem[e], 2);
});

test('ground G aim sends only on release, and cancel or lost focus drops the preview', () => {
  const ac = new AimCast();
  const keys = (g = false) => ({ q: false, e: false, r: false, g });
  const tick = ({ down = false, up = false, held = false, cancel = false } = {}) => ac.step({
    down: keys(down), up: keys(up), held: keys(held), cancel,
    kinds: { q: 'dir', e: 'dir', r: 'self', g: castKind(PEARLS.escarcha.skill) },
  });

  let result = tick({ down: true, held: true });
  assert.equal(result.prs, 0);
  assert.deepEqual(result.preview, { slot: 'g', kind: 'ground' });
  result = tick({ up: true });
  assert.equal(result.prs, BTN.G);
  assert.equal(result.fire, 'g');
  assert.equal(result.preview, null);

  tick({ down: true, held: true });
  result = tick({ held: true, cancel: true });
  assert.equal(result.prs, 0);
  assert.equal(result.preview, null);
  assert.equal(tick({ up: true }).prs, 0, 'release after cancel does not cast');

  tick({ down: true, held: true });
  result = tick();
  assert.equal(result.prs, 0);
  assert.equal(result.preview, null, 'lost focus clears the marker');
});

test('G clamps the server-owned field to range, starts its cooldown, and does nothing without Escarcha', () => {
  const { w, e, ecs, step } = fixture();
  const x = ecs.x[e], z = ecs.z[e];
  step({ prs: BTN.G, ax: x + 40, az: z });
  for (let i = 0; i < 30; i++) step({ ax: x + 40, az: z });
  const field = w.hazards.frostFields.find((f) => f.e === e);
  assert.ok(field, 'server created the field');
  assert.ok(Math.abs(Math.hypot(field.x - x, field.z - z) - SKILLS.iceanchor.range) < 1e-6, 'aim is clamped to range');
  assert.ok(Math.abs(field.r - 3) < 1e-9);
  assert.ok(Math.abs((field.tEnd - field.t0) * DT - 4) <= DT);
  assert.ok(ecs.cdG[e] > 15);

  const bare = fixture(null);
  bare.step({ prs: BTN.G });
  for (let i = 0; i < 30; i++) bare.step();
  assert.equal(bare.w.hazards.frostFields.length, 0);
  assert.equal(bare.w.events.filter((v) => v.type === 'cast' && v.skill === 'iceanchor').length, 0);
  assert.equal(bare.ecs.cdG[bare.e], 0);
});

test('kit strikes chill for 3 seconds, apply one 30% slow, and freeze ordinary enemies on the third hit', () => {
  const { w, e, ecs } = fixture();
  const target = w.spawnEnemy('grunt', ecs.x[e] + 7, ecs.z[e]);
  const strike = (victim, raw = 1) => w.strike(victim, raw, {
    by: e, kind: 'skill', elem: 2, x: ecs.x[e], z: ecs.z[e], knock: 0, noCrit: true,
  });

  strike(target); strike(target);
  const chills = w.events.filter((v) => v.type === 'chill' && v.id === target);
  assert.deepEqual(chills.map((v) => v.stacks), [1, 2]);
  assert.equal((chills[1].until - w.tick) * DT, 3);
  assert.equal(w.enemyMoveMul(target), 0.7, 'chill slows movement by 30%');
  w.hazards.addFrostField({ e, seq: 80, x: ecs.x[target], z: ecs.z[target], r: 3, t0: w.tick, tEnd: w.tick + 30, slow: 0.5 });
  assert.equal(w.enemyMoveMul(target), 0.5, 'overlapping slows use the minimum factor');

  strike(target);
  const frozen = w.events.find((v) => v.type === 'freeze' && v.id === target);
  assert.ok(frozen, 'third successful hit freezes');
  assert.equal((frozen.until - w.tick) * DT, 0.6);
  assert.equal(w.enemyMoveMul(target), 0, 'freeze holds movement for 0.6 seconds');
  assert.equal(w.events.filter((v) => v.type === 'damage' && v.id === target).length, 3, 'cold status adds no recursive damage hit');

  w.tick = frozen.until + 1;
  assert.equal(w.enemyMoveMul(target), 0.7, 'after freeze, the chill slow remains until its own expiry');
  w.tick = chills[0].until + 1;
  w.stepWorld();
  assert.equal(w.chills.has(target), false, 'expired stacks are removed');
  assert.equal(w.enemyMoveMul(target), 1);
});

test('bosses keep the chill slow but never freeze, and death plus entity reuse cannot retain chill', () => {
  const { w, e, ecs } = fixture();
  const coldHit = (target, raw = 1) => w.strike(target, raw, {
    by: e, kind: 'skill', elem: 2, x: ecs.x[e], z: ecs.z[e], knock: 0, noCrit: true,
  });
  const boss = w.spawnEnemy('hellfire', ecs.x[e] + 8, ecs.z[e]);
  w.ecs.brain[boss].inv = 0;
  w.ecs.brain[boss].state = 'chase';
  w.ecs.brain[boss].shieldOn = false;
  coldHit(boss); coldHit(boss); coldHit(boss);
  assert.equal(w.enemyMoveMul(boss), 0.7);
  assert.equal(w.events.filter((v) => v.type === 'freeze' && v.id === boss).length, 0);
  assert.deepEqual(w.events.filter((v) => v.type === 'chill' && v.id === boss).map((v) => v.stacks), [1, 2, 0],
    'the third boss stack is consumed without a freeze');

  const target = w.spawnEnemy('grunt', ecs.x[e] + 6, ecs.z[e]);
  coldHit(target);
  assert.ok(w.chills.has(target));
  ecs.hp[target] = 1;
  w.strike(target, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], knock: 0, noCrit: true });
  assert.equal(w.chills.has(target), false, 'death removes the state immediately');
  const reused = w.spawnEnemy('grunt', ecs.x[e] + 6, ecs.z[e]);
  assert.equal(reused, target, 'the freed ECS slot was reused');
  assert.equal(w.enemyMoveMul(reused), 1, 'a new enemy starts without old chill state');
});

test('Escarcha takes 1.5x fire and lava damage while ordinary physical damage stays unchanged', () => {
  const { w, e, ecs } = fixture();
  ecs.def[e] = 0;
  const hurt = (raw, extra = {}) => {
    const before = ecs.hp[e];
    hurtPlayer(w, e, raw, { x: ecs.x[e] + 1, z: ecs.z[e], kind: 'test', noInv: true, pierce: true, ...extra });
    return before - ecs.hp[e];
  };
  assert.equal(hurt(10), 10, 'physical damage is unchanged');
  assert.equal(hurt(10, { fire: 1, kind: 'lava' }), 15, 'lava is fire damage');
  assert.equal(hurt(10, { fire: 1, kind: 'proj' }), 15, 'hostile fire is fire damage');
  ecs.elem[e] = 0;
  assert.equal(hurt(10, { fire: 1 }), 10, 'the curse only applies while Escarcha is swallowed');
});

test('a guarded fire projectile keeps its fire marker through the block reduction', () => {
  const { w, e, ecs, step } = fixture();
  ecs.def[e] = 0;
  ecs.guardRe[e] = 1; // Raise an ordinary guard, outside the perfect window.
  const raw = 8;
  const bullet = w.hazards.spawn(9300, 0, 0, ecs.x[e] + 2, ecs.y[e] + 1.1, ecs.z[e], -10, 0,
    w.tick, raw, map, 0, 1, 1);
  assert.ok(bullet >= 0);
  let blocked = null;
  for (let i = 0; i < 20 && !blocked; i++) {
    const events = step({ btn: BTN.GUARD, ax: ecs.x[e] + 4, az: ecs.z[e] });
    blocked = events.find((v) => v.type === 'hurt' && v.kind === 'block');
  }
  assert.ok(blocked, 'the projectile reaches the guard');
  const expectedRaw = raw * tuning.guard.blockMult * 1.5;
  assert.equal(blocked.raw, expectedRaw, 'the guarded share is multiplied after guard mitigation');
  assert.equal(blocked.dmg, Math.round(expectedRaw), 'the Escarcha curse survives the guard path');
});

test('hostile fire AOE, beams, and lava carry the curse marker into damage resolution', () => {
  const aoe = fixture();
  aoe.ecs.def[aoe.e] = 0;
  aoe.w.addAoe({ owner: 0, x: aoe.ecs.x[aoe.e], z: aoe.ecs.z[aoe.e], r: 2, t0: 0, tAct: 1, dmg: 10, fire: 1 });
  aoe.step();
  const areaHit = aoe.step().find((v) => v.type === 'hurt' && v.kind === 'aoe');
  assert.ok(areaHit);
  assert.equal(areaHit.raw, 15, 'the fire AOE applies 1.5x');

  const beam = fixture();
  beam.ecs.def[beam.e] = 0;
  beam.w.addBeam({ kind: 'lane', x0: beam.ecs.x[beam.e], z0: beam.ecs.z[beam.e] - 5, ang0: 0,
    off: 0, len: 10, w: 2, t0: 0, tAct: 0, tEnd: 60, dmg: 10, every: 1, fire: 1 });
  const beamHit = beam.step().find((v) => v.type === 'hurt' && v.kind === 'beam');
  assert.ok(beamHit);
  assert.equal(beamHit.raw, 15, 'the fire beam applies 1.5x');

  const lava = fixture();
  lava.ecs.def[lava.e] = 0;
  lava.w.tick = 1;
  lava.w.setLava({ cx: lava.ecs.x[lava.e] + 1, cz: lava.ecs.z[lava.e], r0: 0, rMin: 0, rate: 0, t0: 0,
    R: 1, dmg: 10, every: 1 });
  const lavaHit = lava.step().find((v) => v.type === 'hurt' && v.kind === 'lava');
  assert.ok(lavaHit);
  assert.equal(lavaHit.raw, 15, 'lava always applies 1.5x to Escarcha');
});

test('a perfect guard catches fire without taking the multiplied block damage', () => {
  const { w, e, ecs, step } = fixture();
  ecs.guardT[e] = 0.02; ecs.guardP[e] = 1;
  const bullet = w.hazards.spawn(9400, 0, 0, ecs.x[e] + 0.3, ecs.y[e] + 1.1, ecs.z[e], -0.1, 0,
    w.tick - 30, 8, null, 0, 1, 1);
  assert.ok(bullet >= 0);
  const startHp = ecs.hp[e];
  const events = [];
  for (let i = 0; i < 18 && ecs.hp[e] === startHp; i++) events.push(...step({ btn: BTN.GUARD, ax: ecs.x[e] + 4, az: ecs.z[e] }));
  assert.equal(ecs.hp[e], startHp, 'a perfect guard takes no chip damage');
  assert.ok(events.some((v) => v.type === 'guard' && v.st === 'perfect' && v.pid === 9400));
  assert.equal(events.some((v) => v.type === 'hurt' && v.kind === 'block'), false);
});

test('a frost field slows hostile bullets analytically only while active, including rewind samples', () => {
  const { w } = fixture(null);
  const H = w.hazards;
  const x0 = A.x - 8, z = A.z + 5, t0 = 20;
  const id = 9001;
  const slot = H.spawn(id, 0, 0, x0, 1, z, 10, 0, 0, 8, null, 0, 6);
  assert.ok(slot >= 0);
  H.addFrostField({ e: 17, seq: 1, x: A.x, z, r: 3, t0, tEnd: t0 + 120, slow: 0.5 });

  // The sample precedes the field; the point enters, slows inside, then exits at half speed.
  const before = H.px(slot, t0 - 1);
  const entry = H.px(slot, t0 + 12);
  const middle = H.px(slot, t0 + 42);
  const exit = H.px(slot, t0 + 90);
  const expired = H.px(slot, t0 + 121);
  assert.ok(before < A.x - 3);
  assert.ok(entry <= A.x - 3 + 0.2, `entry position ${entry}`);
  assert.ok(middle < A.x + 3, 'the projectile is still in the field after its slowed traversal');
  assert.ok(exit > middle, 'it exits the far edge');
  assert.ok(expired > exit, 'after expiry it resumes full speed');
  assert.ok(H.px(slot, t0 + 30) < H.px(slot, t0 + 42), 'arbitrary historical samples remain ordered');
  assert.equal(H.fieldSlowAt(A.x, z, t0 + 10), 0.5);
  assert.equal(H.fieldSlowAt(A.x, z, t0 - 1), 1, 'the field is inactive before t0');
  assert.equal(H.fieldSlowAt(A.x, z, t0 + 120), 1, 'the field is inactive at tEnd');

  H.addFrostField({ e: 18, seq: 2, x: A.x, z, r: 3, t0: t0 + 20, tEnd: t0 + 60, slow: 0.25 });
  H.addFrostField({ e: 18, seq: 2, x: A.x, z, r: 3, t0: t0 + 20, tEnd: t0 + 60, slow: 0.25 });
  assert.equal(H.frostFields.length, 2, 'event replay is deduplicated');
  assert.equal(H.fieldSlowAt(A.x, z, t0 + 30), 0.25, 'overlap takes the minimum factor');
  assert.equal(H.fieldSlowAt(A.x, z, t0 + 60), 0.5, 'the second field is inactive at its tEnd');

  H.addFrostField({ e: 19, seq: 3, x: A.x, z, r: 3, t0: 0, tEnd: 1, slow: 0.5 });
  const history = H.maxLifeTicks + tuning.combat.rewind;
  H.sweep(1 + history + 1);
  assert.equal(H.frostFields.some((f) => f.e === 19), false, 'field history is bounded after projectile life plus rewind');
});

test('analytic bullet paths use the correct disk entry and exit ticks and invalidate same-tick reconciliation caches', () => {
  const { w } = fixture(null);
  const H = w.hazards;
  const s = H.spawn(9050, 0, 0, -5, 1, 0, 10, 0, 0, 8, null, 0, 3);
  H.addFrostField({ e: 1, seq: 7, x: 0, z: 0, r: 2, t0: 0, tEnd: 600, slow: 0.5, predicted: true });
  assert.ok(Math.abs(H.px(s, 18) - (-2)) < 1e-8, 'first reaches disk edge at full speed');
  assert.ok(Math.abs(H.px(s, 66) - 2) < 1e-8, 'spends 48 ticks crossing the disk at half speed');
  assert.ok(Math.abs(H.px(s, 90) - 6) < 1e-8, 'resumes full speed after leaving the disk');
  const replayed = H.px(s, 90);
  assert.ok(Math.abs(H.px(s, 30) - (-1)) < 1e-8, 'rewind samples are computed from the same path');
  H.addFrostField({ e: 1, seq: 7, x: 100, z: 0, r: 2, t0: 0, tEnd: 600, slow: 0.5, predicted: false });
  assert.ok(Math.abs(H.px(s, 90) - 10) < 1e-8, 'authoritative replacement invalidates the path cached at this same tick');
  assert.notEqual(H.px(s, 90), replayed);
});

test('frost never slows player shots, and hostile bullets still stop at static blockers', () => {
  const { w } = fixture(null);
  const H = w.hazards;
  H.addFrostField({ e: 7, seq: 1, x: A.x + 2.5, z: A.z, r: 3, t0: 0, tEnd: 120, slow: 0.5 });
  const S = w.shots;
  for (const [k, kind] of [SHOT.REFLECT, SHOT.BULLET, SHOT.PELLET, SHOT.RELEASE].entries()) {
    const slot = S.spawn(9100 + k, { owner: 7, type: 0, x: A.x, y: 1, z: A.z, dx: 1, dz: 0,
      speed: 10, life: 2, r: 0.2, dmg: 1, kind, homing: 0 });
    assert.ok(slot >= 0);
    S.step(slot, 0.5, () => 0, () => false, {});
    assert.ok(Math.abs(S.x[slot] - (A.x + 5)) < 1e-9, `shot kind ${kind} keeps full speed`);
  }

  const wall = { x: A.x + 5, z: A.z + 5, r: 0.8 };
  const obstacleMap = { ...map, groundAt: () => 0, colliders: [wall], queryColliders: () => [0] };
  const obstacleWorld = new World(GAME.seed, { map: obstacleMap, server: true });
  const bullet = obstacleWorld.hazards.spawn(9200, 0, 0, wall.x - 8, 1, wall.z, 12, 0, 0, 8, obstacleMap, 0, 3);
  obstacleWorld.hazards.addFrostField({ e: 8, seq: 1, x: wall.x - 3, z: wall.z, r: 3, t0: 0, tEnd: 120, slow: 0.5 });
  const H2 = obstacleWorld.hazards;
  const expectedClip = clipDistance(obstacleMap, wall.x - 8, 1, wall.z, 1, 0, H2.r[bullet], 12 * 3);
  assert.equal(H2.clipD[bullet], expectedClip, 'spawn retains the static collision distance');
  assert.equal(H2.live(bullet, H2.tEnd[bullet]), false);
  assert.ok(Math.abs(H2.px(bullet, H2.tEnd[bullet] + 30) - (wall.x - 8 + expectedClip)) < 1e-9,
    'analytic samples stop at the sampled static collision point');
});

test('field events reach remote clients, snapshots repair a missed event, and a late joiner restores active fields', () => {
  const n = network(), first = n.join(1), w = n.server.world;
  const field = { e: 800, seq: 12, x: A.x + 2, z: A.z + 1, r: 3, t0: w.tick, tEnd: w.tick + 240, slow: 0.5 };
  const fieldState = (f) => f && Object.fromEntries(Object.keys(field).map((k) => [k, f[k]]));
  w.hazards.addFrostField(field);
  w.emit({ type: 'frostField', ...field });
  n.server.flushEvents(); n.deliver(1);
  assert.deepEqual(fieldState(first.client.hazards.frostFields.find((f) => f.e === 800)), field, 'event installs a remote field');

  first.client.hazards.frostFields = [];
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.deepEqual(fieldState(first.client.hazards.frostFields.find((f) => f.e === 800)), field, 'snapshot repairs the missed field event');

  const late = n.join(2);
  n.server.broadcastSnapshot(); n.deliver(1); n.deliver(2);
  assert.deepEqual(fieldState(late.client.hazards.frostFields.find((f) => f.e === 800)), field, 'late join receives existing field history');

  // The last-cast ECS columns outlive their field; replay must respect the same retention window.
  const s = w.ecs, e = first.e;
  s.icX[e] = field.x; s.icZ[e] = field.z; s.icT0[e] = field.t0;
  s.icEnd[e] = field.tEnd; s.icSeq[e] = field.seq;
  w.tick = field.tEnd + w.hazards.maxLifeTicks + tuning.combat.rewind + 1;
  w.hazards.sweep(w.tick);
  first.client.ptCur = w.tick;
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.equal(first.client.hazards.frostFields.length, 0, 'reconciliation never revives field history past bullet lifetime plus rewind');
});

test('a delayed authoritative snapshot removes an ice field predicted from a rejected G cast', () => {
  const n = network(), { client, e } = n.join(1), w = n.server.world, serverEntity = e;
  const serverClient = n.server.clients.get(1);
  w.ecs.regenT[serverEntity] = 99;
  const pearl = givePearl(w, serverEntity, 'escarcha');
  assert.ok(swallowPearl(w, serverEntity, pearl.uid));
  n.server.sendProfile(1, serverClient);
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.equal(client.pred.ecs.elem[client.youLocal], 2);

  // Simulate an authoritative cooldown update arriving just before the input while the client's
  // last snapshot still shows G ready. Hold the resulting snapshots to model delayed reconciliation.
  w.ecs.cdG[serverEntity] = 8;
  client.pred.ecs.cdG[client.youLocal] = 0;
  for (let i = 0; i < 80; i++) {
    client.tickInput({ mx: 0, mz: 0, ax: client.pred.ecs.x[client.youLocal] + 8, az: client.pred.ecs.z[client.youLocal], btn: 0, prs: i === 0 ? BTN.G : 0 });
    n.server.step();
    n.deliver(1, true);
  }
  const before = client.hazards.frostFields.filter((f) => f.predicted);
  assert.equal(before.length, 1, 'local prediction created the rejected field');
  assert.equal(w.hazards.frostFields.length, 0, 'the authoritative server rejected G during cooldown');

  n.deliver(1, false);
  assert.equal(client.hazards.frostFields.some((f) => f.predicted), false, 'the delayed snapshot rolls back the prediction');
  assert.equal(client.hazards.frostFields.length, 0);
});
