import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { AgentPerception } from '../server/agentPerception.mjs';
import { MSG, encodeEntity } from '../src/net/protocol.js';
import { tuning } from '../src/data/tuning.js';
import { GameHost } from '../server/host.mjs';
import { burnOnHit, stepBurns } from '../src/sim/systems/pearlcombat.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const WORLD = 'l06a-runner';
const caps = ['move', 'aim', 'attack_pve', 'body_pve', 'chat'];
async function until(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Pilot runner evidence timeout');
}

test('managed runner uses server exposure lives for real PvE input, loses hidden targets and releases its queue', { timeout: 15000 }, async (t) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, seed: 42, maxPlayers: 2,
    worldId: WORLD, store: createMemoryStore(), saveSecret: 'l06a-runner-fixture-only', log() {},
    resolvePlayer: async (_req, msg) => msg.token === 'pilot-fixture' ? CHARACTER : null,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: caps }] },
    agentPilot: { maxAgents: 1 } });
  const world = server.game.server.world, ecs = world.ecs, spawn = world.map.landmarks.spawn;
  // An explicit melee practice fixture; no teleport or debug capability is exposed over the wire.
  for (const s of world.spawners) if (s.entity && ecs.alive[s.entity]) world.despawn(s.entity);
  world.spawners = []; world.clearHostile();
  world.map.colliders = []; world.map.queryColliders = () => [];
  const enemy = world.spawnEnemy('dummy', spawn.x + 1.5, spawn.z, 0);
  ecs.hp[enemy] = ecs.maxHp[enemy] = 200;
  world.events.length = 0;
  const port = await server.listen(); t.after(() => server.close());
  const runner = new AgentNetworkRunner({ url: `ws://127.0.0.1:${port}/ws`, name: 'Brisa',
    authorization: { token: 'pilot-fixture' }, grant: { v: 1,
      scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: 'placeholder' },
      controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities: caps } });
  t.after(() => runner.close());
  await runner.connect();
  assert.equal(runner.viewReport.serverEnforced, true);
  const target = await until(() => runner.observation.confirmed.entities.find(e => e.ref.entityId === enemy));
  assert.equal(target.kind, 'enemy');
  const sock = [...server.game.sockets.values()].find(s => s.agentIdentity === CHARACTER);
  const connection = server.game.server.clients.get(sock.id);
  assert.equal(sock.agentView.target(target.ref, world, connection.entity, 3), true);
  assert.equal(runner.order({ v: 1, actionId: 'pilot-melee', scope: runner.grant.scope,
    controlRevision: runner.grant.controlRevision, observationRevision: runner.observation.revision,
    type: 'attack_pve', args: { target: target.ref, durationMs: 1000 } }).ok, true);
  await until(() => runner.authority?.task?.actionId === 'pilot-melee');
  await until(() => ecs.hp[enemy] < 200);
  await until(() => runner.actions.find(a => a.order.actionId === 'pilot-melee').result?.code === 'swing_started');
  // The server rejects stale exposure before the next perception update reaches the runner.
  ecs.x[enemy] += 100;
  assert.equal(sock.agentView.target(target.ref, world, connection.entity, 3), false);
  await until(() => !runner.observation.confirmed.entities.some(e => e.ref.entityId === enemy));
  assert.equal(runner.order({ v: 1, actionId: 'hidden-melee', scope: runner.grant.scope,
    controlRevision: runner.grant.controlRevision, observationRevision: runner.observation.revision,
    type: 'attack_pve', args: { target: target.ref, durationMs: 500 } }).why, 'target_unavailable');
  runner.stop(OWNER);
  await until(() => runner.state === 'stopped');
  assert.equal(runner.lifecycle.current.termination.serverQueueRevocation, 'confirmed');
  assert.equal(connection.queue.length, 0);
  assert.equal(server.game.agentControl.byCharacter(CHARACTER).task, null);
  assert.equal(server.game.errors, 0);
});

test('pilot hit resolution rejects a hidden second enemy and a target lost during windup', () => {
  const host = new GameHost({ bots: 0, seed: 42, maxPlayers: 2, worldId: WORLD,
    store: createMemoryStore(), log() {}, resolvePlayer: async () => CHARACTER,
    agentControl: { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: caps }] },
    agentPilot: { maxAgents: 1 } });
  const world = host.server.world, ecs = world.ecs, clientId = 99;
  const self = world.spawnPlayer({ clientId, name: 'Pilot', x: 0, z: 0 });
  ecs.facing[self] = Math.PI / 2;
  host.server.clients.set(clientId, { entity: self, agentManaged: true });
  const view = new AgentPerception();
  host.sockets.set(clientId, { worldAdmitted: true, agentIdentity: CHARACTER, agentView: view });
  const visible = world.spawnEnemy('dummy', 1.3, 0, 0), hidden = world.spawnEnemy('dummy', 2.1, 0, 0);
  for (const e of [visible, hidden]) { ecs.hp[e] = ecs.maxHp[e] = 200; ecs.y[e] = ecs.y[self]; }
  world.map.colliders = [{ x: 1.75, z: 0, r: 0.15 }];
  view.project({ t: MSG.SNAPSHOT, tick: world.tick, ack: 0, ents: [], you: encodeEntity(ecs, self) }, world, self);
  assert.equal(world.canHit(self, visible), true);
  assert.equal(world.canHit(self, hidden), false);
  ecs.swingId[self] = 1; ecs.atkStage[self] = 1;
  world.meleeHits(self, tuning.melee.stages[0], world.tick + tuning.combat.interpTicks, 1);
  assert.ok(ecs.hp[visible] < 200, 'ordinary melee still damages an exposed enemy');
  assert.equal(ecs.hp[hidden], 200, 'aiming through another target cannot damage a hidden enemy');
  assert.equal(world.strike(hidden, 50, { by: self, kind: 'melee' }), 0, 'secondary strike boundary also rejects hidden targets');
  const remaining = ecs.hp[visible];
  world.map.colliders = [{ x: 0.6, z: 0, r: 0.15 }];
  ecs.swingId[self]++;
  world.meleeHits(self, tuning.melee.stages[0], world.tick + tuning.combat.interpTicks, 2);
  assert.equal(ecs.hp[visible], remaining, 'windup does not retain permission after visibility is lost');
  const human = world.spawnPlayer({ clientId: 100, name: 'Human', x: 0, z: 0 });
  assert.equal(world.canHit(human, hidden), true, 'ordinary human combat retains the existing rules');
  assert.equal(world.canHit(self, human), false, 'pilot damage cannot become PvP');
  // A burn and a reflected shot must not become anonymous damage after source-id reuse.
  burnOnHit(world, hidden, self);
  const sid = world.spawnShot(self, { x: 0, y: 2, z: 0, dx: 1, dz: 0, speed: 10, dmg: 50, life: 10, r: 0.2, homing: 0 });
  const humanSid = world.spawnShot(human, { x: 0, y: 2, z: 0, dx: 1, dz: 0, speed: 10, dmg: 50, life: 10, r: 0.2, homing: 0 });
  assert.ok(world.burns.has(hidden));
  world.despawn(self);
  assert.equal(world.shots.slot.has(sid), false);
  assert.equal(world.shots.slot.has(humanSid), true, 'human effects are preserved');
  assert.equal(world.burns.has(hidden), false);
  const reused = world.spawnPlayer({ clientId: 101, name: 'Replacement', x: 0, z: 0 });
  assert.equal(reused, self, 'fixture exercises numeric entity reuse');
  world.tick += 120; stepBurns(world);
  assert.equal(ecs.hp[hidden], 200);
  host.sockets.clear(); host.server.clients.clear();
});
