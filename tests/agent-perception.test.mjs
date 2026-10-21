import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentPerception, AGENT_PILOT_POLICY, AGENT_WORLD_POLICY } from '../server/agentPerception.mjs';
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

// IC04 observation v2: the `world` block of an agent snapshot.
function worldFixture(nodes = [], { bench = null, freshwater = false } = {}) {
  const { world, entity } = fixture();
  world.tick = 100;
  world.resources = { nodes: new Map(nodes.map((n) => [n.id, { rev: 1, readyTick: 0, ...n }])), bench };
  world.freshwaterEnabled = freshwater;
  world.gameHoursAt = () => 13.46;
  // freshwaterSource(map) reads toWorld(-69, 15): the spring sits at (-69, 1, 15) here.
  Object.assign(world.map, { toWorld: (u, v) => ({ x: u, z: v }), groundAt: () => 1 });
  return { world, entity };
}
const node = (id, kind, x, z, extra = {}) => ({ id, kind, x, y: 0, z, ...extra });
const worldOf = (p, world, self, tick = 1) => p.project(snap(tick), world, self).at(-1).world;

test('IC04 policy constants are fixed and the entity policy is untouched', () => {
  assert.deepEqual(AGENT_PILOT_POLICY, { v: 1, serverEnforced: true, policy: 'server_radius_colliders', radius: 24,
    maxEntities: 64, occlusion: 'static_circles' });
  assert.deepEqual(AGENT_WORLD_POLICY, { v: 1, radius: 24, maxNodes: 16 });
  assert.equal(Object.isFrozen(AGENT_WORLD_POLICY), true);
  const { world, entity } = worldFixture([node('palm-1', 'palm', 3, 4)]);
  const self = entity(KIND.PLAYER, 0);
  const projected = new AgentPerception().project(snap(), world, self).at(-1);
  assert.deepEqual(projected.perception, { ...AGENT_PILOT_POLICY, revision: 1, tick: 1, truncated: false });
  assert.equal(projected.world.v, 1);
  assert.equal(projected.world.tick, 1);
  assert.equal(projected.resources, undefined, 'the raw resource catalogue is still not forwarded');
});

test('IC04 nodes inside the radius are included, outside excluded, with rounded fields and hours', () => {
  const { world, entity } = worldFixture([
    node('palm-1', 'palm', 3.04, 4.06, { hits: 1 }),
    node('coast-1', 'wood', 0, 24),
    node('coast-2', 'wood', 0, 24.2),
    node('stone-1', 'stone', 20, 20),
    node('mine-1', 'iron_ore', 6, 0, { readyTick: 190, hits: 2 }),
  ]);
  const self = entity(KIND.PLAYER, 0);
  const out = worldOf(new AgentPerception(), world, self);
  assert.deepEqual(out.nodes.map((n) => n.id), ['palm-1', 'mine-1', 'coast-1']);
  assert.deepEqual(out.nodes[0], { id: 'palm-1', kind: 'palm', x: 3, y: 0, z: 4.1, ready: true, wait: 0, remaining: 2 });
  assert.equal(out.nodes[1].ready, false);
  assert.equal(out.nodes[1].wait, 1.5);
  assert.equal(out.nodes[2].remaining, undefined, 'only kinds with hits carry remaining');
  assert.equal(out.hours, 13.5);
  assert.equal(out.truncated, false);
  assert.equal(Object.is(out.nodes[2].x, 0), true, 'no negative zero');
});

test('IC04 more than 16 nodes keep the 16 nearest (ties by id) and set truncated', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => node(`coast-${String(i).padStart(2, '0')}`, 'wood', 5 + (i >= 18 ? 0 : i), 0));
  const { world, entity } = worldFixture(nodes);
  const self = entity(KIND.PLAYER, 0);
  const out = worldOf(new AgentPerception(), world, self);
  assert.equal(out.nodes.length, 16);
  assert.equal(out.truncated, true);
  const expected = nodes.map((n, i) => ({ id: n.id, d: n.x })).sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1)).slice(0, 16).map((n) => n.id);
  assert.deepEqual(out.nodes.map((n) => n.id), expected);
  assert.equal(out.nodes[0].id, 'coast-00', 'tie at distance 5 resolves by id');
  const exact = worldFixture(nodes.slice(0, 16));
  assert.equal(worldOf(new AgentPerception(), exact.world, exact.entity(KIND.PLAYER, 0)).truncated, false, 'exactly 16 is not truncated');
});

test('IC04 water and bench are null out of range and set inside, water also needs freshwater enabled', () => {
  const bench = { x: 10, y: 0, z: 0 };
  const { world, entity } = worldFixture([], { bench, freshwater: true });
  const self = entity(KIND.PLAYER, -69, 1, 15);
  let out = worldOf(new AgentPerception(), world, self);
  assert.deepEqual(out.water, { x: -69, y: 1, z: 15, distance: 0 });
  assert.equal(out.bench, null, 'bench is 80 away');
  world.ecs.x[self] = 0; world.ecs.y[self] = 0; world.ecs.z[self] = 0;
  out = worldOf(new AgentPerception(), world, self);
  assert.equal(out.water, null);
  assert.deepEqual(out.bench, { x: 10, y: 0, z: 0, distance: 10 });
  world.ecs.x[self] = -69; world.ecs.y[self] = 1; world.ecs.z[self] = 15;
  world.freshwaterEnabled = false;
  assert.equal(worldOf(new AgentPerception(), world, self).water, null, 'no source when the feature is off');
  world.resources = undefined;
  assert.deepEqual(worldOf(new AgentPerception(), world, self).nodes, []);
});

test('IC04 world fails closed for a dead, zero-hp or unpositioned self', () => {
  const { world, entity } = worldFixture([node('palm-1', 'palm', 3, 4)]);
  const self = entity(KIND.PLAYER, 0);
  const p = new AgentPerception();
  assert.notEqual(worldOf(p, world, self), null);
  world.ecs.dead[self] = 1;
  assert.equal(worldOf(p, world, self, 2), null);
  world.ecs.dead[self] = 0; world.ecs.hp[self] = 0;
  assert.equal(worldOf(p, world, self, 3), null);
  assert.equal(worldOf(p, world, 99, 4), null, 'a missing self entity has no world view');
  world.ecs.hp[self] = 100; world.ecs.x[self] = NaN;
  assert.equal(worldOf(p, world, self, 5), null);
});

test('IC04 the serialized world at its caps stays within 2400 bytes', () => {
  const kinds = ['palm', 'rock', 'iron_ore', 'wood', 'stone'];
  const nodes = Array.from({ length: 20 }, (_, i) => node(`${['palm', 'coast', 'stone', 'mine'][i % 4]}-${100 + i}`, kinds[i % 5],
    -12.3 + (i % 5) * 1.1, 8.7 - (i % 7), { y: -1.2, readyTick: 3600 + i * 7, hits: 1 }));
  const { world, entity } = worldFixture(nodes, { bench: { x: -9.5, y: 1.4, z: 4.5 }, freshwater: true });
  world.tick = 1234567;
  world.gameHoursAt = () => 123456.78;
  const self = entity(KIND.PLAYER, -69, 1, 15);
  world.ecs.x[self] = -9.9; world.ecs.z[self] = 6.2; world.ecs.y[self] = 1;
  world.map.toWorld = () => ({ x: -12.8, z: 10.1 });
  const out = worldOf(new AgentPerception(), world, self, 1234567);
  assert.equal(out.nodes.length, 16);
  assert.notEqual(out.water, null);
  assert.notEqual(out.bench, null);
  assert.ok(JSON.stringify(out).length <= 2400, `world is ${JSON.stringify(out).length} bytes`);
});
