import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { KIND, TEAM, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';
import { createGameServer } from '../server/index.mjs';

const ownId = 2;
const neutral = { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, w: 0 };
const clone = (value) => structuredClone(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fields = Object.fromEntries(PLAYER_FIELDS.map((name, index) => [name, index]));
function state(overrides = {}) {
  const values = { x: 0, y: 1, z: 0, facing: 0, hp: 100, maxHp: 100, atk: 10, speed: 6.5,
    moveMul: 1, dashT: -1, guardT: -1, dashMax: 1, dashCharges: 1, guardSt: 60,
    cdr: 1, ripMul: 1, reflMul: 1, fireMul: 1, potHeal: 1, xpMul: 1, level: 1,
    weapon: 0, atkStage: 0, stagger: 0, castLock: 0, potions: 0, potCd: 0, ...overrides };
  return PLAYER_FIELDS.map((field) => values[field] ?? 0);
}
function row(id, kind, { x = 0, y = 1, z = 0, hp = 100 } = {}) {
  const value = Array(19).fill(0);
  Object.assign(value, { [ENT.ID]: id, [ENT.KIND]: kind, [ENT.X]: x, [ENT.Y]: y, [ENT.Z]: z,
    [ENT.HP]: hp, [ENT.MAXHP]: 100, [ENT.LVL]: 1 });
  return value;
}
function snap({ tick = 10, ack = 0, you = state(), entities = [] } = {}) {
  return { t: MSG.SNAPSHOT, tick, ack, you, ents: [row(ownId, KIND.PLAYER), ...entities], rafts: [],
    resources: { nodes: [], bench: null } };
}
class FakeTransport {
  constructor() { this.opened = Promise.resolve(true); this.ws = { readyState: 1 }; this.closed = false;
    this.sent = []; this.outbox = []; this.messages = []; this.snapshots = []; this.closes = []; }
  start() {}
  onMessage(fn) { this.messages.push(fn); }
  onSnapshot(fn) { this.snapshots.push(fn); }
  onClose(fn) { this.closes.push(fn); }
  message(value) { for (const fn of [...this.messages]) fn(clone(value)); }
  snapshot(value) { for (const fn of [...this.snapshots]) fn(clone(value)); }
  send(value) {
    this.sent.push(clone(value));
    if (value.t !== MSG.HELLO) return;
    queueMicrotask(() => {
      this.message({ t: MSG.SPAWN, e: { id: ownId, kind: KIND.PLAYER, name: 'Brisa', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.ENEMY, name: 'Dummy', level: 1, weapon: 0 } });
      this.message({ t: MSG.SPAWN, e: { id: 10, kind: KIND.PLAYER, name: 'Ana', level: 1, weapon: 0, human: 1, team: TEAM.PLAYERS } });
      this.message({ t: MSG.WELCOME, v: PROTOCOL_VERSION, you: ownId, tick: 10, seed: GAME.seed });
      this.snapshot(snap({ entities: [row(9, KIND.ENEMY, { x: 1, hp: 200 }), row(10, KIND.PLAYER, { x: 4 })] }));
    });
  }
  sendInput(tick, input) { this.outbox.push({ t: MSG.INPUTS, cmds: [{ tick, ...clone(input) }] }); }
  flush() { this.sent.push(...this.outbox); this.outbox.length = 0; }
  close() { if (this.closed) return; this.closed = true; this.ws.readyState = 3; for (const fn of [...this.closes]) fn({ code: 1000, reason: 'test closed' }); }
  get inputs() { return this.sent.filter((m) => m.t === MSG.INPUTS).flatMap((m) => m.cmds); }
}
function orderFor(client, actionId, args) {
  return { v: 1, actionId, scope: client.grant.scope, controlRevision: client.grant.controlRevision,
    observationRevision: client.observation.revision, type: 'body_pve', args };
}
function action(client, actionId) { return client.actions.find((entry) => entry.order.actionId === actionId); }
async function until(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await sleep(15); }
  throw new Error('Timed out waiting for PvE body evidence');
}
const pveCapabilities = ['move', 'aim', 'attack_pve', 'body_pve'];
const args = (overrides = {}) => ({ mode: 'aggressive', protect: null, retreatHpFraction: 0.3, allowPotion: false, durationMs: 8000, ...overrides });
async function fakeClient({ now = () => 0, transport = new FakeTransport() } = {}) {
  const client = new AgentNetworkClient({ url: 'ws://127.0.0.1:1/ws', grant: fixtureGrant({ capabilities: pveCapabilities }),
    now, transportFactory: () => transport });
  await client.connect({ autoTick: false, timeoutMs: 100 });
  return { client, transport };
}

test('fake wire decodes only confirmed combat reserves and predicts no reserve change from input ACK', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  let combat = client.observation.confirmed.combat;
  assert.deepEqual(combat, { weapon: 0, attackStage: 0, stagger: 0, castLock: 0, guardStamina: 60,
    potions: 0, potionCooldown: 0, playerNearby: true, guardRaised: false });
  assert.equal(client.order(orderFor(client, 'nearby', args())).ok, true);
  const first = client.pump();
  assert.equal(first.input.prs, 0, 'nearby human suppresses attack pulse');
  transport.snapshot(snap({ tick: 11, ack: first.sequence, you: state({ potions: 2, potCd: 4, guardT: 1 }),
    entities: [row(9, KIND.ENEMY, { x: 1, hp: 200 })] }));
  combat = client.observation.confirmed.combat;
  assert.deepEqual(combat, { weapon: 0, attackStage: 0, stagger: 0, castLock: 0, guardStamina: 60,
    potions: 2, potionCooldown: 4, playerNearby: false, guardRaised: true });
  assert.equal(action(client, 'nearby').effects.some((effect) => effect.code === 'body_swing_started' || effect.code === 'body_potion_used'), false,
    'ACK does not create a swing or potion effect or alter confirmed reserves');
});

test('fake wire body uses confirmed busy state and cadence; support guards near its ally without attacking', async (t) => {
  let now = 0;
  const { client, transport } = await fakeClient({ now: () => now }); t.after(() => client.close());
  const ally = client.observation.confirmed.entities.find((entry) => entry.kind === 'player');
  transport.snapshot(snap({ tick: 11, you: state({ x: 2 }), entities: [row(9, KIND.ENEMY, { x: 1 }), row(10, KIND.PLAYER, { x: 4 })] }));
  assert.equal(client.order(orderFor(client, 'support-cover', args({ mode: 'support', protect: ally.ref }))).ok, true);
  let pulse = client.pump();
  assert.equal(pulse.input.prs & 2, 0, 'protected player within 8 units suppresses swings');
  assert.ok(pulse.input.btn & 4, 'support remains ready to guard');
  assert.equal(action(client, 'support-cover').body.status, 'guarding');
  transport.snapshot(snap({ tick: 12, ack: pulse.sequence, you: state({ x: 2, atkStage: 1, guardT: 0.1 }),
    entities: [row(9, KIND.ENEMY, { x: 1 }), row(10, KIND.PLAYER, { x: 4 })] }));
  now = 100;
  pulse = client.pump();
  assert.equal(pulse.input.prs, 0, 'an observed partial swing keeps the next attack suppressed while busy');
  assert.equal(action(client, 'support-cover').effects.some((effect) => effect.outcome === 'confirmed'), false);
});

test('fake wire target retirement cancels before a fresh snapshot and late observations cannot resume the body', async (t) => {
  const { client, transport } = await fakeClient(); t.after(() => client.close());
  assert.equal(client.order(orderFor(client, 'retire-body', args())).ok, true);
  client.pump();
  transport.message({ t: MSG.DESPAWN, id: 9 });
  assert.equal(action(client, 'retire-body').body.status, 'cancelled');
  assert.equal(action(client, 'retire-body').state, 'uncertain', 'already submitted input remains uncertain');
  assert.equal(client.order(orderFor(client, 'new-body-old-life', args())).why, 'stale_observation',
    'raw target retirement forbids a new body order from reusing the pre-retirement observation');
  assert.deepEqual(client.pump().input, neutral);
  transport.message({ t: MSG.SPAWN, e: { id: 9, kind: KIND.ENEMY, name: 'New life' } });
  transport.snapshot(snap({ tick: 11, entities: [row(9, KIND.ENEMY, { x: 1 })] }));
  assert.equal(action(client, 'retire-body').body.status, 'cancelled');
  assert.deepEqual(client.pump().input, neutral);
});

test('fake wire partial swings, potion receipts, ACK and guard observation never claim a completed encounter', async (t) => {
  let now = 0;
  const transport = new FakeTransport();
  const { client } = await fakeClient({ now: () => now, transport }); t.after(() => client.close());
  transport.snapshot(snap({ tick: 11, entities: [row(9, KIND.ENEMY, { x: 1, hp: 200 })] }));
  assert.equal(client.order(orderFor(client, 'aggressive', args({ allowPotion: true }))).ok, true);
  const submitted = client.pump();
  assert.equal(submitted.input.prs & 2, 2);
  transport.message({ t: MSG.EVENT, ev: { type: 'swing', e: ownId, seq: submitted.sequence } });
  assert.equal(action(client, 'aggressive').effects.at(-1).code, 'body_swing_started');
  assert.equal(action(client, 'aggressive').result, null);
  transport.snapshot(snap({ tick: 12, ack: submitted.sequence, you: state({ hp: 25, potions: 2, potCd: 0 }),
    entities: [row(9, KIND.ENEMY, { x: 1, hp: 200 })] }));
  now = 100;
  const potion = client.pump();
  assert.equal(potion.input.prs & 256, 256, 'one permitted low-health potion pulse is emitted from confirmed reserves');
  transport.message({ t: MSG.EVENT, ev: { type: 'potion', e: ownId, seq: potion.sequence, heal: 20, n: 1 } });
  assert.equal(action(client, 'aggressive').effects.at(-1).code, 'body_potion_used');
  assert.equal(action(client, 'aggressive').result, null);
  transport.snapshot(snap({ tick: 13, ack: potion.sequence, you: state({ hp: 75, potions: 1, potCd: 10 }),
    entities: [row(9, KIND.ENEMY, { x: 1, hp: 200 })] }));
  now = 200;
  assert.equal(client.pump().input.prs & 256, 0, 'confirmed cooldown prevents a repeated potion');
  assert.equal(action(client, 'aggressive').result, null);
});

test('fake wire cancel, expiry and stop stay neutral and never resume a previously emitted body', async (t) => {
  let now = 0;
  const { client, transport } = await fakeClient({ now: () => now }); t.after(() => client.close());
  assert.equal(client.order(orderFor(client, 'cancel-body', args())).ok, true);
  const sent = client.pump();
  assert.ok(sent.input.btn & 128, 'body emits ordinary aim while approaching');
  assert.equal(client.cancel('cancel-body', 'owner-1').ok, true);
  assert.equal(action(client, 'cancel-body').state, 'uncertain');
  assert.deepEqual(client.pump().input, neutral);
  assert.equal(client.order(orderFor(client, 'expire-body', args({ durationMs: 1000 }))).ok, true);
  client.pump();
  now = 1000;
  assert.deepEqual(client.pump().input, neutral);
  assert.equal(action(client, 'expire-body').body.status, 'cancelled');
  assert.equal(client.order(orderFor(client, 'stop-body', args())).ok, true);
  client.pump();
  assert.equal(client.stop('owner-1').ok, true);
  assert.equal(client.state, 'stopped');
  assert.equal(transport.inputs.at(-1).mx, 0);
  assert.equal(transport.inputs.at(-1).mz, 0);
});

function guestGrant(characterId) {
  return fixtureGrant({ capabilities: pveCapabilities, scope: { characterId, sessionId: `session-${characterId}`, worldId: 'l02b-network' },
    expiresAtMs: Date.now() + 60000 });
}
async function realServer(t, fixture = {}) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 3, dev: false,
    worldId: null, saveSecret: 'l02b-test-secret-only', log: () => {} });
  // Controlled, local-only fixture positions; the live LocalServer still resolves normal movement and combat.
  const world = server.game.server.world;
  world.testCombatEvents = [];
  const emit = world.emit.bind(world);
  world.emit = (event) => {
    if (event?.type === 'swing' || event?.type === 'potion' || event?.type === 'hurt' || event?.type === 'guard')
      world.testCombatEvents.push({ ...event, tick: world.tick,
        guardStAtEmit: event.type === 'guard' && event.e ? world.ecs.guardSt[event.e] : null });
    return emit(event);
  };
  const originalSpawnPlayer = world.spawnPlayer.bind(world);
  world.spawnPlayer = (options) => {
    const isAgent = options.name === 'L02b Agent' || options.name === 'L02b Cover';
    const position = isAgent ? fixture.agentPosition : fixture.allyPosition;
    const e = originalSpawnPlayer({ ...options, x: position?.x ?? world.map.landmarks.spawn.x + (isAgent ? -2 : 0),
      z: position?.z ?? world.map.landmarks.spawn.z + (isAgent ? 0 : 10) });
    if (isAgent) { world.ecs.potions[e] = 2; world.ecs.hp[e] = world.ecs.maxHp[e]; }
    else world.ecs.potions[e] = 0;
    return e;
  };
  const spawn = world.map.landmarks.spawn;
  const boundaryX = fixture.boundaryX ?? spawn.x + 0.45;
  world.map.groundAt = (x, z) => (x > boundaryX ? -20 : 0);
  world.map.queryColliders = () => [];
  // Remove map-generated ambient enemies so the fixture has only the explicitly placed encounter.
  for (const spawner of world.spawners) if (spawner.entity && world.ecs.alive[spawner.entity]) world.despawn(spawner.entity);
  world.spawners = [];
  world.clearHostile();
  const enemy = world.spawnEnemy('dummy', fixture.enemyPosition?.x ?? spawn.x - 2, fixture.enemyPosition?.z ?? spawn.z, 0);
  world.ecs.hp[enemy] = world.ecs.maxHp[enemy] = 200;
  // Discard constructor-time despawns for recycled IDs before the normal WS admission path begins.
  world.events.length = 0;
  t.after(() => server.close());
  const port = await server.listen();
  return { server, world, enemy, spawn, url: `ws://127.0.0.1:${port}/ws` };
}

test('real WS body attacks with authoritative damage, retreats on confirmed low HP, consumes one potion, and respects the map boundary', { timeout: 25000 }, async (t) => {
  const { server, world, enemy, spawn, url } = await realServer(t);
  const feedback = [];
  const agent = new AgentNetworkClient({ url, grant: guestGrant('l02b-agent'), name: 'L02b Agent',
    onFeedback: (event) => feedback.push(event) });
  const ally = new AgentNetworkClient({ url, grant: guestGrant('l02b-ally'), name: 'Ally' });
  t.after(() => { agent.close(); ally.close(); });
  await agent.connect(); await ally.connect();
  const self = agent.identity.entityId;
  world.ecs.potions[self] = 2;
  world.ecs.hp[self] = world.ecs.maxHp[self];
  await until(() => agent.observation.confirmed.entities.some((entity) => entity.ref.entityId === enemy), 5000);
  await until(() => agent.observation.confirmed.combat.potions === 2, 3000);
  assert.equal(agent.order(orderFor(agent, 'real-aggressive', args({ allowPotion: true, retreatHpFraction: 0.8, durationMs: 18000 }))).ok, true);
  const hpBefore = world.ecs.hp[enemy];
  await until(() => world.ecs.hp[enemy] < hpBefore, 10000);
  await until(() => world.testCombatEvents.filter((event) => event.type === 'swing' && event.e === self).length >= 2, 8000);
  const swingTicks = world.testCombatEvents.filter((event) => event.type === 'swing' && event.e === self).map((event) => event.tick);
  assert.ok(swingTicks[1] - swingTicks[0] >= 20, `body swings obey the natural server cadence: ${swingTicks.slice(0, 2).join(', ')}`);
  assert.ok(world.ecs.hp[enemy] < hpBefore, 'ordinary client attack inputs caused authoritative enemy damage');
  const effects = action(agent, 'real-aggressive').effects;
  assert.ok(effects.some((effect) => effect.code === 'body_swing_started' && effect.outcome === 'partial'));
  assert.equal(action(agent, 'real-aggressive').result, null, 'wire swing evidence remains partial');

  // First verify a real retreat away from the target. This phase uses normal server inputs only.
  const targetBeforeRetreat = { x: world.ecs.x[enemy], z: world.ecs.z[enemy] };
  const retreatDistanceBefore = Math.hypot(world.ecs.x[self] - targetBeforeRetreat.x, world.ecs.z[self] - targetBeforeRetreat.z);
  const retreatPositionBefore = { x: world.ecs.x[self], z: world.ecs.z[self] };
  world.ecs.hp[self] = Math.round(world.ecs.maxHp[self] * 0.1);
  await until(() => action(agent, 'real-aggressive')?.body?.status === 'retreating', 3000);
  await until(() => agent.observation.confirmed.combat.potionCooldown > 0, 3000);
  await until(() => Math.hypot(world.ecs.x[self] - targetBeforeRetreat.x, world.ecs.z[self] - targetBeforeRetreat.z) > retreatDistanceBefore + 1.2, 4000);
  const retreatDistanceAfter = Math.hypot(world.ecs.x[self] - targetBeforeRetreat.x, world.ecs.z[self] - targetBeforeRetreat.z);
  const retreatPositionAfter = { x: world.ecs.x[self], z: world.ecs.z[self] };
  assert.ok(retreatDistanceAfter > retreatDistanceBefore + 1.2, 'ordinary retreat inputs increased distance from the hostile');
  assert.ok(Math.hypot(retreatPositionAfter.x - retreatPositionBefore.x, retreatPositionAfter.z - retreatPositionBefore.z) > 1.2,
    'the server moved the body during the real retreat phase');
  await until(() => agent.observation.confirmed.combat.potions === 1 && agent.observation.confirmed.combat.potionCooldown > 0 &&
    agent.observation.confirmed.self.hp / agent.observation.confirmed.self.maxHp < 0.8, 3000);
  assert.ok(action(agent, 'real-aggressive').effects.some((effect) => effect.code === 'body_potion_used' && effect.outcome === 'partial'));
  await sleep(500);
  assert.equal(agent.observation.confirmed.combat.potions, 1, 'the second potion remains during the confirmed cooldown');
  assert.ok(agent.observation.confirmed.combat.potionCooldown > 0);
  assert.ok(agent.observation.confirmed.self.hp / agent.observation.confirmed.self.maxHp < 0.8,
    'confirmed health remains below the configured retreat threshold during cooldown');

  // The following position is an explicit test fixture teleport, isolated from the successful retreat above.
  assert.equal(agent.cancel('real-aggressive', 'owner-1').ok, true);
  world.ecs.x[self] = spawn.x + 0.2;
  world.ecs.z[self] = spawn.z;
  world.ecs.y[self] = world.map.groundAt(world.ecs.x[self], world.ecs.z[self]);
  world.ecs.hp[self] = Math.round(world.ecs.maxHp[self] * 0.1);
  await until(() => agent.observation.confirmed.self.position.x === world.ecs.x[self] &&
    agent.observation.confirmed.self.hp <= world.ecs.maxHp[self] * 0.1, 3000);
  assert.equal(agent.order(orderFor(agent, 'real-boundary-retreat', args({ allowPotion: false, retreatHpFraction: 0.8, durationMs: 12000 }))).ok, true);
  await until(() => action(agent, 'real-boundary-retreat')?.body?.status === 'retreating', 3000);
  await sleep(2200);
  assert.equal(action(agent, 'real-boundary-retreat')?.body?.status, 'blocked',
    `retreat watchdog should report the fixed edge: ${JSON.stringify({ body: action(agent, 'real-boundary-retreat')?.body, pos: { x: world.ecs.x[self], z: world.ecs.z[self] } })}`);
  const before = { x: spawn.x + 0.2, z: world.ecs.z[self] };
  const after = { x: world.ecs.x[self], z: world.ecs.z[self] };
  assert.ok(after.x <= spawn.x + 0.45 + 1e-6, 'server collision kept the retreat on walkable terrain');
  assert.ok(Math.hypot(after.x - (spawn.x + 3), after.z - before.z) > 1, 'the blocked retreat remains far from the impossible point beyond the wall');
  assert.ok(Math.abs(after.x - before.x) < 1, 'the authoritative body did not teleport across the boundary');
  assert.equal(agent.observation.confirmed.combat.potions, 1, 'the separate no-potion boundary fixture leaves the second reserve untouched');
  assert.equal(server.game.status().errors, 0);
});

test('real WS support covers its protected player and the host blocks a directed projectile', { timeout: 15000 }, async (t) => {
  const { server, world, enemy, url } = await realServer(t, {
    agentPosition: { x: -2, z: 0 }, allyPosition: { x: 0, z: 0 }, enemyPosition: { x: 5, z: 0 }, boundaryX: 10,
  });
  const cover = new AgentNetworkClient({ url, grant: guestGrant('l02b-cover'), name: 'L02b Cover' });
  const ally = new AgentNetworkClient({ url, grant: guestGrant('l02b-protected'), name: 'Protected' });
  t.after(() => { cover.close(); ally.close(); });
  await cover.connect(); await ally.connect();
  const protectedPlayer = await until(() => cover.observation.confirmed.entities.find((entity) =>
    entity.kind === 'player' && entity.ref.entityId === ally.identity.entityId), 4000);
  await until(() => cover.observation.confirmed.entities.some((entity) => entity.ref.entityId === enemy), 4000);
  const coverId = cover.identity.entityId, allyId = ally.identity.entityId;
  const coverStart = { x: world.ecs.x[coverId], z: world.ecs.z[coverId] };
  assert.equal(cover.order(orderFor(cover, 'real-support', args({ mode: 'support', protect: protectedPlayer.ref,
    durationMs: 10000 }))).ok, true);
  await until(() => action(cover, 'real-support')?.body?.status === 'guarding', 4000);
  assert.equal(cover.observation.confirmed.combat.playerNearby, true, 'the protected player stays inside the local safety radius');
  const coverHp = world.ecs.hp[coverId], allyHp = world.ecs.hp[allyId];
  const allyStart = { x: world.ecs.x[allyId], z: world.ecs.z[allyId] };
  assert.ok(Math.hypot(world.ecs.x[coverId] - coverStart.x, world.ecs.z[coverId] - coverStart.z) > 3,
    'support reached its interception point through ordinary movement inputs');
  assert.ok(Math.hypot(world.ecs.x[coverId] - 2, world.ecs.z[coverId]) <= 0.6,
    'the body stops between ally x=0 and enemy x=5');
  assert.ok(world.ecs.x[coverId] > allyStart.x && world.ecs.x[coverId] < world.ecs.x[enemy], 'support body stands between ally and visible enemy');
  assert.equal(cover.pump().input.prs & 2, 0, 'the nearby protected player suppresses support attacks');
  await until(() => world.ecs.guardT[coverId] > 0.13, 2000);
  const guardStaminaBefore = world.ecs.guardSt[coverId];
  world.firePattern({ type: 'pattern', pid0: world.nextPid, tick: world.tick, src: enemy, pat: 'single', ptype: 'parry', n: 1,
    gap: 0, spread: 0, speed: 14, dmg: 8, x: world.ecs.x[enemy], y: 1, z: world.ecs.z[enemy], ang: -Math.PI / 2 });
  await until(() => world.testCombatEvents.some((event) => event.type === 'guard' && event.e === coverId && event.st === 'block'), 4000);
  const block = world.testCombatEvents.find((event) => event.type === 'guard' && event.e === coverId && event.st === 'block');
  assert.ok(block.guardStAtEmit < guardStaminaBefore, 'the real server block paid its guard stamina cost');
  await sleep(700); // Longer than the remaining projectile path to the protected player.
  assert.equal(world.ecs.hp[allyId], allyHp, 'the projectile is blocked before the protected player takes damage');
  assert.ok(coverHp - world.ecs.hp[coverId] <= 3, 'the ordinary block sharply reduces the projectile damage to the cover');
  assert.equal(action(cover, 'real-support').result, null, 'a block remains partial evidence');

  assert.equal(cover.cancel('real-support', 'owner-1').ok, true);
  const freshAlly = cover.observation.confirmed.entities.find((entity) => entity.ref.entityId === allyId);
  assert.equal(cover.order(orderFor(cover, 'real-defensive', args({ mode: 'defensive', durationMs: 5000 }))).ok, true);
  await until(() => action(cover, 'real-defensive')?.body?.status === 'guarding' &&
    cover.observation.confirmed.combat.guardRaised, 3000);
  const defensiveInput = cover.pump().input;
  assert.ok(defensiveInput.btn & 4, 'defensive mode holds the ordinary server guard near a threat');
  assert.equal(defensiveInput.prs & 2, 0, 'defensive mode waits in guard instead of attacking outside counter range');
  const defensiveStart = { x: world.ecs.x[coverId], z: world.ecs.z[coverId] };
  await sleep(500);
  assert.ok(Math.hypot(world.ecs.x[coverId] - defensiveStart.x, world.ecs.z[coverId] - defensiveStart.z) < 0.25,
    'defensive mode holds its confirmed position during the guard window');
  assert.ok(freshAlly, 'the protected player remains observable after support mode ends');
  assert.equal(server.game.status().errors, 0);
});
