import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentPerception, AGENT_PILOT_POLICY } from '../server/agentPerception.mjs';
import { C, ECS, KIND } from '../src/sim/ecs.js';
import { MSG } from '../src/net/protocol.js';

function fixture(cap = 128) {
  const ecs = new ECS(cap);
  const world = {
    ecs,
    map: { colliders: [] },
    describe(id) { return { id, kind: ecs.kind[id], name: `entity-${id}` }; },
  };
  function entity(kind, x, y = 0, z = 0) {
    const id = ecs.create(kind, C.POS | C.HEALTH | (kind === KIND.SHIP ? C.VEHICLE : 0));
    ecs.kind[id] = kind;
    ecs.x[id] = x; ecs.y[id] = y; ecs.z[id] = z;
    ecs.hp[id] = 100; ecs.maxHp[id] = 100; ecs.dead[id] = 0;
    return id;
  }
  return { world, entity };
}

function snap(tick = 1) {
  return { t: MSG.SNAPSHOT, tick, ack: 7, you: [1, 2], ents: [],
    enc: [{ private: 'global' }], frost: [{ secret: 1 }], storm: [{ secret: 2 }],
    ink: { clouds: [{ secret: 3 }], marks: [{ secret: 4 }] }, rafts: [{ secret: 5 }], resources: { nodes: ['hidden'] } };
}

function messages(perception, snapshot, world, self) {
  return perception.project(snapshot, world, self);
}

test('policy is fixed and 64 nearest others plus self are deterministic', () => {
  assert.deepEqual(AGENT_PILOT_POLICY, { v: 1, serverEnforced: true, policy: 'server_radius_colliders', radius: 24,
    maxEntities: 64, occlusion: 'static_circles' });
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0);
  const ties = Array.from({ length: 65 }, () => entity(KIND.NPC, 3, 0, 4));
  const p = new AgentPerception();
  let out = messages(p, snap(), world, self);
  let projected = out.at(-1);
  assert.equal(projected.ents.length, 65);
  assert.deepEqual(projected.ents.slice(1).map((row) => row[0]), ties.slice().sort((a, b) => a - b).slice(0, 64));
  assert.equal(projected.perception.truncated, true);
  assert.equal(projected.ents[0][0], self);
  assert.equal(projected.perception.tick, 1);
  assert.equal(projected.perception.revision, 1);
  assert.equal(projected.resources, undefined);
});

test('target requires this socket current life, kind, health, and visibility', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0), target = entity(KIND.ENEMY, 0, 0, 5);
  const a = new AgentPerception(), b = new AgentPerception();
  const spawn = messages(a, snap(), world, self).find((m) => m.t === MSG.SPAWN && m.e.id === target);
  assert.ok(spawn?.e.life);
  const ref = { entityId: target, life: spawn.e.life };
  assert.equal(a.target(ref, world, self, KIND.ENEMY), true);
  assert.equal(a.target(ref, world, self, KIND.PLAYER), false);
  assert.equal(b.target(ref, world, self, KIND.ENEMY), false);
  world.ecs.hp[target] = 0;
  assert.equal(a.target(ref, world, self, KIND.ENEMY), false);
  world.ecs.hp[target] = 100;
  world.ecs.x[target] = 50;
  assert.equal(a.target(ref, world, self, KIND.ENEMY), false);
});

test('leaving visibility despawns the old life and a recycled id gets a new life', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0), target = entity(KIND.NPC, 0, 0, 2);
  const p = new AgentPerception();
  const first = messages(p, snap(1), world, self).find((m) => m.t === MSG.SPAWN && m.e.id === target).e.life;
  world.ecs.x[target] = 40;
  const departed = messages(p, snap(2), world, self);
  assert.ok(departed.some((m) => m.t === MSG.DESPAWN && m.id === target));
  world.ecs.alive[target] = 0;
  world.ecs.alive[target] = 1;
  world.ecs.kind[target] = KIND.NPC;
  world.ecs.x[target] = 0; world.ecs.y[target] = 0; world.ecs.z[target] = 2;
  world.ecs.hp[target] = 100; world.ecs.dead[target] = 0;
  const second = messages(p, snap(3), world, self).find((m) => m.t === MSG.SPAWN && m.e.id === target).e.life;
  assert.notEqual(second, first);
});

test('self is never despawned and dead self receives no other entity perception', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0), other = entity(KIND.ENEMY, 0, 0, 3);
  const p = new AgentPerception();
  const ownSpawn = p.project({ t: MSG.SPAWN, e: { id: self } }, world, self);
  assert.equal(ownSpawn.length, 1);
  assert.ok(ownSpawn[0].e.life, 'self life identifier must be available before welcome');
  assert.equal(messages(p, snap(), world, self).some((m) => m.t === MSG.DESPAWN && m.id === self), false);
  world.ecs.hp[self] = 0;
  const deadOut = messages(p, snap(2), world, self);
  assert.deepEqual(deadOut.at(-1).ents.map((row) => row[0]), [self]);
  assert.ok(deadOut.some((m) => m.t === MSG.DESPAWN && m.id === other));
});

test('late despawn cannot retire a reused live self but a destroyed self still retires', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0), p = new AgentPerception();
  p.project({ t: MSG.SPAWN, e: { id: self } }, world, self);
  const oldLife = { t: MSG.DESPAWN, id: self };
  assert.deepEqual(p.project(oldLife, world, self), [], 'old numeric id cannot terminate the current body');
  assert.equal(messages(p, snap(), world, self).some(m => m.t === MSG.DESPAWN && m.id === self), false);
  world.ecs.destroy(self);
  assert.deepEqual(p.project(oldLife, world, self), [oldLife], 'real despawn remains terminal');
});

test('static circles block interior crossings, allow tangents, and ignore endpoint-contained circles', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, -5, 0, 1);
  const blocked = entity(KIND.NPC, 5, 0, -1);
  const tangent = entity(KIND.NPC, 5, 0, 1);
  const endpoint = entity(KIND.NPC, 0.25, 0, 0);
  world.map.colliders = [{ x: 0, z: 0, r: 1 }];
  const p = new AgentPerception();
  const out = messages(p, snap(), world, self);
  const ids = out.at(-1).ents.map((row) => row[0]);
  assert.equal(ids.includes(blocked), false);
  assert.equal(ids.includes(tangent), true);
  assert.equal(ids.includes(endpoint), true);
});

test('projection fails closed, filters event fields, and does not mutate input', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0);
  const p = new AgentPerception();
  const input = snap();
  const before = structuredClone(input);
  const projected = messages(p, input, world, self).at(-1);
  assert.deepEqual(input, before);
  assert.deepEqual(projected.you, before.you);
  assert.deepEqual(projected.enc, []);
  assert.deepEqual(projected.frost, []);
  assert.deepEqual(projected.storm, []);
  assert.deepEqual(projected.ink, { clouds: [], marks: [] });
  assert.deepEqual(projected.rafts, []);
  assert.deepEqual(p.project({ t: 'unknown', secret: 'x' }, world, self), []);
  assert.deepEqual(p.project({ t: MSG.EVENT, ev: { type: 'loot', e: self, item: 'private' } }, world, self), []);
  const own = p.project({ t: MSG.EVENT, ev: { type: 'potion', e: self, seq: 4, heal: 2, secret: 'hidden' } }, world, self);
  assert.deepEqual(own, [{ t: MSG.EVENT, ev: { type: 'potion', e: self, seq: 4, denied: undefined,
    heal: 2, n: undefined, x: undefined, z: undefined } }]);
});

test('hasEnemy reports only a currently exposed live enemy', () => {
  const { world, entity } = fixture();
  const self = entity(KIND.PLAYER, 0), enemy = entity(KIND.ENEMY, 0, 0, 5);
  const p = new AgentPerception();
  assert.equal(p.hasEnemy(world, self), false);
  messages(p, snap(), world, self);
  assert.equal(p.hasEnemy(world, self), true);
  world.ecs.dead[enemy] = 1;
  assert.equal(p.hasEnemy(world, self), false);
});
