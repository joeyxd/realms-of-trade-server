import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { DT } from '../src/data/tuning.js';
import { PTYPE } from '../src/sim/projectiles.js';
import {
  advancePresence, presenceAnchor, presencePointAllowed, presenceSafety,
  PRESENCE_ANCHOR_RADIUS, PRESENCE_RADIUS,
} from '../server/companionPresencePolicy.mjs';

function setup(seed = 42) {
  const world = new World(seed, { server: true });
  const entity = world.spawnPlayer({ name: 'Companion' });
  return { world, entity, ecs: world.ecs, anchor: presenceAnchor(world) };
}

test('canonical Salty Shore spawn is a valid anchor across world seeds', () => {
  for (const seed of [1, 42, 20261012, 0x7fffffff]) {
    const { world, entity, anchor } = setup(seed);
    assert.ok(anchor);
    assert.deepEqual({ x: world.ecs.x[entity], z: world.ecs.z[entity] }, anchor);
    assert.equal(presencePointAllowed(world, anchor.x, anchor.z), true, `seed ${seed}`);
    assert.equal(presenceSafety(world, entity, { anchor: true }), null, `seed ${seed}`);
  }
});

test('safe footprint has a hard radius and excludes all practice targets', () => {
  const { world, anchor } = setup();
  assert.equal(presencePointAllowed(world, anchor.x + PRESENCE_RADIUS + 0.01, anchor.z), false);
  const practice = world.map.practice;
  for (const p of [practice.ring, practice.cannon, practice.dummy]) {
    const old = world.map.landmarks.spawn;
    world.map.landmarks.spawn = { x: p.x, z: p.z };
    assert.equal(presencePointAllowed(world, p.x, p.z), false);
    world.map.landmarks.spawn = old;
  }
});

test('footprint rejects lawless, dock, raft, and deep-water points', () => {
  const { world, anchor } = setup();
  const originalLawless = world.map.lawlessAt;
  world.map.lawlessAt = () => true;
  assert.equal(presencePointAllowed(world, anchor.x, anchor.z), false);
  world.map.lawlessAt = originalLawless;

  const originalDock = world.map.onDock;
  world.map.onDock = () => true;
  assert.equal(presencePointAllowed(world, anchor.x, anchor.z), false);
  world.map.onDock = originalDock;

  const originalSurface = world.raftDeck.surface;
  world.raftDeck.surface = () => ({ y: 0 });
  assert.equal(presencePointAllowed(world, anchor.x, anchor.z), false);
  world.raftDeck.surface = originalSurface;

  const originalGround = world.map.groundAt;
  world.map.groundAt = () => -100;
  assert.equal(presencePointAllowed(world, anchor.x, anchor.z), false);
  world.map.groundAt = originalGround;
});

test('join and retirement anchor gate checks both the three-unit anchor and presence zone', () => {
  const { world, entity, anchor, ecs } = setup();
  ecs.x[entity] = anchor.x + PRESENCE_ANCHOR_RADIUS + 0.1;
  assert.equal(presenceSafety(world, entity, { anchor: true }), 'outside_anchor');
  ecs.x[entity] = anchor.x + PRESENCE_RADIUS + 0.1;
  assert.equal(presenceSafety(world, entity), 'outside_zone');
});

test('retirement safety rejects nearby hostile enemies, active projectiles, and active AOEs', () => {
  const practiceCase = setup();
  practiceCase.world.populate();
  assert.equal(presenceSafety(practiceCase.world, practiceCase.entity), null,
    'practice cannon and dummy are non-hostile to presence policy');

  const hostile = setup();
  hostile.world.spawnEnemy('archer', hostile.anchor.x + 20, hostile.anchor.z, 0);
  assert.equal(presenceSafety(hostile.world, hostile.entity), 'danger');

  const projectile = setup();
  projectile.world.hazards.spawn(71, PTYPE.PARRY, 0, projectile.anchor.x + 20, 0, projectile.anchor.z,
    -1, 0, 0, 1, projectile.world.map);
  assert.equal(presenceSafety(projectile.world, projectile.entity), 'danger');

  const aoe = setup();
  aoe.world.hazards.addAoe({ owner: 0, x: aoe.anchor.x + 20, z: aoe.anchor.z, r: 1, t0: 0, tAct: 4, keep: 0 });
  assert.equal(presenceSafety(aoe.world, aoe.entity), 'danger');
});

test('presence safety detects active burns and fire trails, then permits stopped or removed effects', () => {
  const burn = setup();
  burn.world.burns = new Map([[burn.entity, { until: burn.world.tick + 1 }]]);
  assert.equal(presenceSafety(burn.world, burn.entity), 'danger', 'active burn can damage the body');
  burn.world.burns.get(burn.entity).until = burn.world.tick - 1;
  assert.equal(presenceSafety(burn.world, burn.entity), null, 'expired burn no longer blocks presence');

  const trail = setup();
  const active = { e: 0, x0: trail.anchor.x - 2, z0: trail.anchor.z,
    x1: trail.anchor.x + 2, z1: trail.anchor.z, until: trail.world.tick + 1 };
  trail.world.fireTrails = [active];
  assert.equal(presenceSafety(trail.world, trail.entity), 'danger', 'active segment crosses the body and anchor');
  active.until = trail.world.tick - 1;
  assert.equal(presenceSafety(trail.world, trail.entity), null, 'expired trail is ignored');

  active.until = trail.world.tick + 1;
  active.x0 += 40; active.x1 += 40;
  assert.equal(presenceSafety(trail.world, trail.entity), null, 'distant active trail is outside the danger radius');
  trail.world.fireTrails.splice(0, 1);
  assert.equal(presenceSafety(trail.world, trail.entity), null, 'removed trail does not block presence');
});

test('settled anchor and retirement checks reject pending combat, movement bursts, buffers, and knockback', () => {
  for (const field of ['atkStage', 'atkBuf', 'dashT', 'dashBuffer', 'castK', 'castLock', 'rBuf', 'qBuf', 'eBuf', 'kbx']) {
    const { world, entity, ecs } = setup();
    ecs[field][entity] = field === 'dashT' ? 0 : 1;
    assert.equal(presenceSafety(world, entity), null, `follow permits transient state ${field}`);
    assert.equal(presenceSafety(world, entity, { anchor: true }), 'danger', field);
  }
});

test('retirement rejects dead or hurt bodies without restoring their health', () => {
  const hurt = setup();
  hurt.ecs.hp[hurt.entity] -= 1;
  hurt.world.hazards.addAoe({ owner: 0, x: hurt.anchor.x + 10, z: hurt.anchor.z, r: 1, t0: 0, tAct: 2, keep: 0 });
  assert.equal(presenceSafety(hurt.world, hurt.entity, { fullHealth: true }), 'hurt');
  assert.equal(presenceSafety(hurt.world, hurt.entity), 'danger');
  assert.equal(hurt.ecs.hp[hurt.entity], hurt.ecs.maxHp[hurt.entity] - 1);

  const dead = setup();
  dead.ecs.dead[dead.entity] = 1;
  assert.equal(presenceSafety(dead.world, dead.entity), 'dead');
  const zeroHp = setup();
  zeroHp.ecs.hp[zeroHp.entity] = 0;
  assert.equal(presenceSafety(zeroHp.world, zeroHp.entity), 'dead');
});

test('moving body can follow but cannot enter or retire through a settled anchor gate', () => {
  const { world, entity, ecs, anchor } = setup(20261012);
  ecs.vx[entity] = 0.6;
  ecs.moveMag[entity] = 0.4;
  assert.equal(presencePointAllowed(world, anchor.x, anchor.z), true,
    'the canonical generated Salty Shore anchor remains standable');
  assert.equal(presenceSafety(world, entity), null,
    'ordinary following is allowed while the target body is moving');
  assert.equal(presenceSafety(world, entity, { anchor: true }), 'danger',
    'joining/retiring waits until the body settles');
  assert.equal(presenceSafety(world, entity, { fullHealth: true }), 'danger');
});

test('advancePresence moves only one collision-stepped walking tick and leaves combat state untouched', () => {
  const { world, entity, ecs, anchor } = setup();
  const before = { x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity], hp: ecs.hp[entity], vx: ecs.vx[entity], vz: ecs.vz[entity] };
  const result = advancePresence(world, entity, { x: anchor.x + 5, z: anchor.z });
  assert.equal(result.reason, null);
  assert.ok(result.moved > 0);
  assert.ok(result.moved <= ecs.speed[entity] * DT + 1e-9);
  assert.ok(Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z) <= PRESENCE_RADIUS);
  assert.equal(ecs.hp[entity], before.hp);
  assert.equal(ecs.vx[entity], before.vx);
  assert.equal(ecs.vz[entity], before.vz);
  assert.ok(ecs.moveMag[entity] > 0 && ecs.moveMag[entity] <= 1);
  assert.equal(ecs.y[entity], world.map.groundAt(ecs.x[entity], ecs.z[entity]));
});

test('advancePresence refuses a target or sampled route through the practice ring', () => {
  const { world, entity, ecs, anchor } = setup();
  const ring = world.map.practice.ring;
  const before = { x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity] };
  const towardRing = advancePresence(world, entity, ring);
  assert.deepEqual(towardRing, { moved: 0, reason: 'outside_zone' });
  assert.equal(ecs.moveMag[entity], 0);
  assert.deepEqual({ x: ecs.x[entity], y: ecs.y[entity], z: ecs.z[entity] }, before);
  assert.ok(PRESENCE_ANCHOR_RADIUS < PRESENCE_RADIUS);
  assert.ok(presencePointAllowed(world, anchor.x, anchor.z));
  assert.deepEqual(advancePresence(world, entity, { x: ecs.x[entity], z: ecs.z[entity] }),
    { moved: 0, reason: null });
  assert.equal(ecs.moveMag[entity], 0);
});

test('advancePresence reports static collision as blocked and keeps the body in place', () => {
  const { world, entity, ecs, anchor } = setup();
  const index = world.map.colliders.length;
  world.map.colliders.push({ x: anchor.x + 2, z: anchor.z, r: 1 });
  world.map.queryColliders = () => world.map.colliders.map((_, i) => i);
  let result;
  for (let i = 0; i < 100; i++) {
    result = advancePresence(world, entity, { x: anchor.x + 5, z: anchor.z });
    if (result.reason) break;
  }
  assert.deepEqual(result, { moved: 0, reason: 'blocked' });
  assert.equal(ecs.moveMag[entity], 0);
  assert.ok(Math.hypot(ecs.x[entity] - anchor.x, ecs.z[entity] - anchor.z) < 2);
  assert.ok(world.map.colliders[index]);
});

test('advancePresence stops when the body is hurt or an incoming hazard is nearby', () => {
  const { world, entity, ecs, anchor } = setup();
  world.hazards.addAoe({ owner: 0, x: anchor.x + 20, z: anchor.z, r: 1, t0: 0, tAct: 4, keep: 0 });
  ecs.moveMag[entity] = 0.7;
  const result = advancePresence(world, entity, { x: anchor.x + 5, z: anchor.z });
  assert.deepEqual(result, { moved: 0, reason: 'danger' });
  assert.equal(ecs.moveMag[entity], 0);
  assert.equal(ecs.x[entity], anchor.x);
});
