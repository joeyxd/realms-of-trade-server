import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { createObjectiveStore } from '../tools/agent/objective-store.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { fixtureGrant } from '../tools/agent/fixtures.mjs';
import { createGameServer } from '../server/index.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, timeoutMs = 6000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await sleep(15); }
  throw new Error('Timed out waiting for local PvE evidence');
};
const pveCapabilities = ['move', 'aim', 'attack_pve', 'body_pve'];
const scopeFor = (suffix) => ({ ownerId: 'owner-l03c-local', characterId: `agent-${suffix}`, worldId: 'l03c-local-pve' });
const grantFor = (suffix) => fixtureGrant({ capabilities: pveCapabilities,
  scope: { ...scopeFor(suffix), sessionId: `session-${suffix}` }, expiresAtMs: Date.now() + 60000 });
const orderFor = (client, actionId, args) => ({ v: 1, actionId, scope: client.grant.scope,
  controlRevision: client.grant.controlRevision, observationRevision: client.observation.revision, type: 'body_pve', args });
const action = (client, actionId) => client.actions.find((entry) => entry.order.actionId === actionId);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const bytes = (value) => Buffer.byteLength(value, 'utf8');

// A controlled localhost fixture; player/enemy placements and later health changes are explicit test stimuli.
async function realServer(t, { agentPosition, guestPosition, enemyOffset = 1.5 } = {}) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers: 3,
    dev: false, worldId: null, saveSecret: 'l03c-local-test-only', log: () => {} });
  const world = server.game.server.world;
  world.testCombatEvents = [];
  const emit = world.emit.bind(world);
  world.emit = (event) => {
    if (event?.type === 'swing' || event?.type === 'hurt') world.testCombatEvents.push({ ...event, tick: world.tick });
    return emit(event);
  };
  const spawn = world.map.landmarks.spawn;
  const originalSpawnPlayer = world.spawnPlayer.bind(world);
  world.spawnPlayer = (options) => {
    const isAgent = options.name === 'L03c Agent';
    const position = isAgent ? agentPosition : guestPosition;
    const e = originalSpawnPlayer({ ...options,
      x: position?.x ?? spawn.x - 2,
      z: position?.z ?? (isAgent ? spawn.z : spawn.z + 20) });
    world.ecs.potions[e] = 0;
    world.ecs.hp[e] = world.ecs.maxHp[e];
    return e;
  };
  const boundaryX = spawn.x + 0.45;
  world.map.groundAt = (x) => x > boundaryX ? -20 : 0;
  world.map.queryColliders = () => [];
  for (const spawner of world.spawners) if (spawner.entity && world.ecs.alive[spawner.entity]) world.despawn(spawner.entity);
  world.spawners = [];
  world.clearHostile();
  const enemy = world.spawnEnemy('dummy', spawn.x - 2 + enemyOffset, spawn.z, 0);
  world.ecs.hp[enemy] = world.ecs.maxHp[enemy] = 200;
  world.events.length = 0;
  t.after(() => server.close());
  const port = await server.listen();
  return { server, world, enemy, spawn, url: `ws://127.0.0.1:${port}/ws` };
}

async function ownerDirectory(t, scope) {
  const directory = await mkdtemp(path.join(tmpdir(), 'l03c-goals-pve-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'personality.md'), 'Brisa actúa con prudencia y respeta la autoridad del servidor.\n', 'utf8');
  await writeFile(path.join(directory, 'objectives.json'), `${JSON.stringify({ v: 1, revision: 1, scope,
    goals: [{ id: 'engage', status: 'active', text: 'Fight the nearby dummy while healthy', constraints: ['Use authorized body behavior'] }] })}\n`, 'utf8');
  await writeFile(path.join(directory, 'memory.jsonl'), '', 'utf8');
  return directory;
}

function mindRunner(client) {
  return {
    get state() { return client.state; }, get grant() { return client.grant; }, get authority() { return client.authority; },
    get observation() { return client.observation; }, get actions() { return client.actions; }, get chat() { return client.chat; },
    get priorUncertainty() { return []; },
  };
}

function scriptedAdapter({ holdLowHealthGoal = null, calls, usage }) {
  return {
    id: 'l03c-scripted-local', countMode: 'simulated_tokens', countText: bytes,
    prepare(request) {
      const body = JSON.stringify(request);
      return { body, inputTokens: bytes(body), maxCostUnits: bytes(body) + request.maxOutputTokens };
    },
    async complete({ body, signal }) {
      if (signal.aborted) throw new Error('aborted');
      const packet = JSON.parse(body);
      const required = packet.context.required;
      const self = required.observation.confirmed.self;
      const goalTurn = required.tools.goalRevision;
      let decision;
      if (goalTurn) {
        const low = self.hp / self.maxHp <= 0.25;
        calls.push({ mode: 'goals', revision: goalTurn.expectedRevision, hp: self.hp, tick: required.observation.tick,
          feedbackIds: goalTurn.feedback.map((item) => item.id) });
        if (low && holdLowHealthGoal) await holdLowHealthGoal();
        decision = { type: 'revise_goals', args: {
          goals: [{ id: low ? 'activeRetreat' : 'engage', status: 'active',
            text: low ? 'Retreat from the nearby enemy while health is low' : 'Engage the nearby dummy while healthy',
            constraints: ['Use only authorized body behavior'] }],
          reason: low ? 'Confirmed low health calls for a temporary retreat goal.' : 'Keep the current engagement goal while health is high.',
          basis: [`observation:${required.observation.revision}`],
        } };
      } else {
        const currentGoals = required.goals.goals;
        const retreatGoal = currentGoals.some((goal) => goal.id === 'activeRetreat' && goal.status === 'active');
        calls.push({ mode: 'body', goal: retreatGoal ? 'activeRetreat' : currentGoals.find((goal) => goal.status === 'active')?.id,
          hp: self.hp, tick: required.observation.tick });
        decision = { type: 'body_pve', args: { mode: retreatGoal ? 'defensive' : 'aggressive', protect: null,
          retreatHpFraction: 0.3, allowPotion: false, durationMs: 18000 } };
      }
      const text = JSON.stringify({ v: 1, decision });
      const native = { inputTokens: bytes(body), outputTokens: bytes(text), costUnits: bytes(body) + bytes(text) };
      usage.push(native);
      return { text, usage: native };
    },
  };
}

async function createMind({ client, directory, adapter, limits = {} }) {
  const scope = { ownerId: client.grant.scope.ownerId, characterId: client.grant.scope.characterId, worldId: client.grant.scope.worldId };
  let files = await loadOwnerFiles({ directory, scope });
  const runner = mindRunner(client);
  return new AgentMind({ adapter, budget: new InferenceBudget({ scope, limits: {
    maxCalls: 8, maxTokens: 500000, maxCostUnits: 500000, maxEntries: 8,
  } }),
  readSnapshot: async () => { files = await loadOwnerFiles({ directory, scope }); return runnerMindSnapshot(runner, files); },
  readCommitSnapshot: () => runnerMindSnapshot(runner, files),
  commitGoals: createObjectiveStore({ directory, scope }).commit,
  submitOrder: (order) => client.order(order),
  limits: { timeoutMs: 4000, maxDecisionAgeMs: 1500, maxContextTokens: 16000, maxInputBytes: 64000,
    maxOutputTokens: 2048, marginTokens: 256, maxRequests: 8, maxResponseBytes: 8192, ...limits }, contextLimits: {} });
}

test('local L03c goal/body loop revises owner goals from confirmed PvE feedback and executes the fresh retreat goal', { timeout: 25000 }, async (t) => {
  const fixture = await realServer(t, { enemyOffset: 1.5 });
  const suffix = 'goal-loop'; const grant = grantFor(suffix); const ownerScope = scopeFor(suffix);
  const directory = await ownerDirectory(t, ownerScope);
  const inputs = [];
  const agent = new AgentNetworkClient({ url: fixture.url, grant, name: 'L03c Agent',
    onFeedback: (event) => { if (event.type === 'input' && event.data.actionId) inputs.push(event.data); } });
  const guest = new AgentNetworkClient({ url: fixture.url, grant: grantFor('guest-loop'), name: 'Remote Human Guest' });
  t.after(() => { agent.close(); guest.close(); });
  await agent.connect(); await guest.connect();
  const selfId = agent.identity.entityId;
  await until(() => agent.observation.confirmed.entities.some((entry) => entry.ref.entityId === fixture.enemy), 4000);
  await until(() => agent.observation.confirmed.combat?.playerNearby === false, 3000);
  const guestId = guest.identity.entityId;
  assert.ok(distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] },
    { x: fixture.world.ecs.x[guestId], z: fixture.world.ecs.z[guestId] }) > 8,
  'a human-named guest client stays outside the eight-unit attack-safety radius; this is not a human playtest');

  const calls = [], nativeUsage = [];
  let signalGoalWait = null, releaseGoalWait = null;
  const goalWaiting = new Promise((resolve) => { signalGoalWait = resolve; });
  const adapter = scriptedAdapter({ calls, usage: nativeUsage, holdLowHealthGoal: () => new Promise((resolve) => {
    releaseGoalWait = resolve; signalGoalWait();
  }) });
  const mind = await createMind({ client: agent, directory, adapter });
  const startedAt = performance.now();
  const initialGoals = await mind.reviseGoals();
  assert.equal(initialGoals.ok, true);
  assert.equal(initialGoals.objective.revision, 2);
  assert.ok(calls[0].hp / agent.observation.confirmed.self.maxHp > 0.5,
    'the first goal proposal used the high-health observation delivered in its provider packet');

  const bodyOne = await mind.decide();
  assert.equal(bodyOne.ok, true);
  const firstAction = bodyOne.action.action;
  const firstActionId = firstAction.order.actionId;
  assert.equal(firstAction.order.type, 'body_pve');
  assert.equal(firstAction.order.args.mode, 'aggressive');
  const enemyHpBefore = fixture.world.ecs.hp[fixture.enemy];
  await until(() => fixture.world.ecs.hp[fixture.enemy] < enemyHpBefore &&
    action(agent, firstActionId)?.effects.some((effect) => effect.code === 'body_swing_started' && effect.outcome === 'partial'), 6000);
  assert.equal(action(agent, firstActionId).result, null,
    'a server swing and enemy health change remain partial evidence, not encounter completion');

  const retreatBefore = { x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] };
  const enemyPosition = { x: fixture.world.ecs.x[fixture.enemy], z: fixture.world.ecs.z[fixture.enemy] };
  fixture.world.ecs.hp[selfId] = Math.round(fixture.world.ecs.maxHp[selfId] * 0.2); // Explicit local test stimulus.
  await until(() => agent.observation.confirmed.self.hp / agent.observation.confirmed.self.maxHp <= 0.25, 3000);
  const pulseCountBeforeGoal = inputs.filter((event) => event.actionId === firstActionId).length;
  const goalRevisionPending = mind.reviseGoals();
  await goalWaiting;
  await until(() => inputs.filter((event) => event.actionId === firstActionId).length >= pulseCountBeforeGoal + 3, 1000);
  assert.ok(['accepted', 'sent', 'executing'].includes(action(agent, firstActionId).state),
    'the existing body keeps receiving host pump ticks while goal inference is held');
  await until(() => distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] }, enemyPosition) >
    distance(retreatBefore, enemyPosition) + 0.2, 1200);
  const retreatWhileInference = { x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] };
  assert.ok(distance(retreatWhileInference, enemyPosition) > distance(retreatBefore, enemyPosition) + 0.2,
    'the body continues its low-health retreat during the held provider request');
  assert.ok(calls.some((call) => call.mode === 'goals' && call.hp / agent.observation.confirmed.self.maxHp <= 0.25));
  const heldGoalBodyPulses = inputs.filter((event) => event.actionId === firstActionId).length - pulseCountBeforeGoal;
  releaseGoalWait();
  const updatedGoals = await goalRevisionPending;
  assert.equal(updatedGoals.ok, true);
  assert.equal(updatedGoals.objective.revision, 3);
  const onDisk = JSON.parse(await readFile(path.join(directory, 'objectives.json'), 'utf8'));
  assert.equal(onDisk.revision, 3);
  assert.deepEqual(onDisk.goals.map((goal) => goal.id), ['activeRetreat']);
  assert.equal(updatedGoals.objective.gameplaySuccess, false);

  assert.equal(agent.cancel(firstActionId, grant.scope.ownerId).ok, true);
  const bodyTwo = await mind.decide();
  assert.equal(bodyTwo.ok, true);
  const secondAction = bodyTwo.action.action;
  assert.equal(secondAction.order.type, 'body_pve');
  assert.equal(secondAction.order.args.mode, 'defensive');
  assert.equal(calls.at(-1).goal, 'activeRetreat', 'the next body proposal read the committed objective revision');
  const secondActionId = secondAction.order.actionId;
  const retreatStart = { x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] };
  const secondEnemyPosition = { x: fixture.world.ecs.x[fixture.enemy], z: fixture.world.ecs.z[fixture.enemy] };
  await until(() => action(agent, secondActionId)?.body?.status === 'retreating', 3000);
  await until(() => distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] }, secondEnemyPosition) >
    distance(retreatStart, secondEnemyPosition) + 1.2, 3000);

  const totals = mind.state.ledger.totals;
  assert.equal(totals.calls, 4);
  assert.equal(totals.confirmedTokens, nativeUsage.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0));
  assert.equal(totals.unknownEntries, 0);
  assert.equal(fixture.server.game.status().errors, 0);
  assert.ok(distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] },
    { x: fixture.world.ecs.x[guestId], z: fixture.world.ecs.z[guestId] }) > 8,
  'the remote guest stays outside the safety radius during the retreat phases');
  t.diagnostic(JSON.stringify({ scenario: 'scripted_local_goal_pve_loop', ownerRevision: onDisk.revision,
    observedEnemyHp: fixture.world.ecs.hp[fixture.enemy], enemyDamage: enemyHpBefore - fixture.world.ecs.hp[fixture.enemy],
    observedRetreatDistance: distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] }, secondEnemyPosition),
    goalObservationTicks: calls.filter((call) => call.mode === 'goals').map((call) => call.tick),
    finalObservationTick: agent.observation.tick, heldGoalBodyPulses,
    bodyPulsesAfterFreshDecision: inputs.filter((event) => event.actionId === secondActionId).length,
    goalCallLatenciesMs: mind.state.records.filter((record) => record.mode === 'goals').map((record) => record.finishedAtMs - record.startedAtMs),
    calls: totals.calls, nativeTokens: totals.confirmedTokens, elapsedMs: Math.round(performance.now() - startedAt),
    humanPlaytest: false, encounterComplete: false }));
});

test('fresh no-model baseline produces server damage and low-health retreat through the same body task', { timeout: 20000 }, async (t) => {
  const startedAt = performance.now();
  const fixture = await realServer(t, { enemyOffset: 1.5 });
  const inputs = [];
  const agent = new AgentNetworkClient({ url: fixture.url, grant: grantFor('baseline-agent'), name: 'L03c Agent',
    onFeedback: (event) => { if (event.type === 'input' && event.data.actionId) inputs.push(event.data); } });
  const guest = new AgentNetworkClient({ url: fixture.url, grant: grantFor('baseline-guest'), name: 'Remote Human Guest' });
  t.after(() => { agent.close(); guest.close(); });
  await agent.connect(); await guest.connect();
  const selfId = agent.identity.entityId;
  await until(() => agent.observation.confirmed.entities.some((entry) => entry.ref.entityId === fixture.enemy), 4000);
  await until(() => agent.observation.confirmed.combat?.playerNearby === false, 3000);
  assert.ok(distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] },
    { x: fixture.world.ecs.x[guest.identity.entityId], z: fixture.world.ecs.z[guest.identity.entityId] }) > 8);

  const modelCalls = 0; // No AgentMind or adapter exists in this fresh baseline.
  assert.equal(agent.order(orderFor(agent, 'baseline-body', { mode: 'aggressive', protect: null,
    retreatHpFraction: 0.3, allowPotion: false, durationMs: 12000 })).ok, true);
  const hpBefore = fixture.world.ecs.hp[fixture.enemy];
  await until(() => fixture.world.ecs.hp[fixture.enemy] < hpBefore && action(agent, 'baseline-body')?.effects.some((effect) =>
    effect.code === 'body_swing_started' && effect.outcome === 'partial'), 6000);
  const enemyPosition = { x: fixture.world.ecs.x[fixture.enemy], z: fixture.world.ecs.z[fixture.enemy] };
  const retreatStart = { x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] };
  fixture.world.ecs.hp[selfId] = Math.round(fixture.world.ecs.maxHp[selfId] * 0.2); // Explicit local test stimulus.
  await until(() => agent.observation.confirmed.self.hp / agent.observation.confirmed.self.maxHp <= 0.25, 3000);
  await until(() => action(agent, 'baseline-body')?.body?.status === 'retreating', 3000);
  await until(() => distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] }, enemyPosition) >
    distance(retreatStart, enemyPosition) + 1.2, 3000);
  assert.equal(action(agent, 'baseline-body').result, null);
  assert.ok(inputs.some((event) => event.actionId === 'baseline-body'), 'ordinary host pump inputs drove the no-model body');
  assert.equal(modelCalls, 0);
  assert.equal(fixture.server.game.status().errors, 0);
  t.diagnostic(JSON.stringify({ scenario: 'no_model_body_baseline', ownerRevision: null, calls: 0, nativeTokens: 0,
    enemyHpBefore: hpBefore, enemyHpAfter: fixture.world.ecs.hp[fixture.enemy], enemyDamage: hpBefore - fixture.world.ecs.hp[fixture.enemy],
    retreatDistance: distance({ x: fixture.world.ecs.x[selfId], z: fixture.world.ecs.z[selfId] }, enemyPosition),
    observationTick: agent.observation.tick, bodyPulses: inputs.filter((event) => event.actionId === 'baseline-body').length,
    elapsedMs: Math.round(performance.now() - startedAt),
    humanPlaytest: false, encounterComplete: false }));
});
