import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { ARTISAN } from '../src/data/artisan.js';
import {
  ACCOUNT_ONE, RESOURCE_WORLD, calmAt, connect, copy, deferred, makeResourceHost,
  makeResourceStore, startResourceHost, submitAndApply, turn,
} from './helpers/resource-authority-fixture.mjs';

const profileFor = (host, entity) => host.server.world.profiles.get(entity);
function standOnRaft(host, entity, raft) {
  const ecs = host.server.world.ecs, angle = ecs.facing[raft.entity], c = Math.cos(angle), s = Math.sin(angle);
  ecs.x[entity] = ecs.x[raft.entity] + c + s; ecs.z[entity] = ecs.z[raft.entity] - s + c;
  ecs.y[entity] = ecs.y[raft.entity]; ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0;
  ecs.vx[entity] = 0; ecs.vz[entity] = 0; ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}
const learn = (profile, project, opId) => ({ type: 'artisan', op: 'learn', lesson: ARTISAN.lesson,
  expectedRev: profile.eco.tradeRev, expectedProjectRev: project.version, opId });

async function artisanHost(t, store, options = {}) {
  await store.checkArtisanOperations();
  return startResourceHost(t, store, { goods: { madera: 2, piedra: 1 }, options: {
    loggingOperations: true, artisanOperations: true,
    communityRequirements: { madera: 2, piedra: 1 }, ...options,
  } });
}

async function completeProject(host, client) {
  const project = host.worldState.community.project;
  const wood = await submitAndApply(host, client, { type: 'community', op: 'contribute', projectId: ARTISAN.projectId,
    good: 'madera', amount: 2, expectedRev: project.version, opId: 'artisan-project-wood' });
  assert.equal(wood?.ok, true, `wood contribution denied: ${JSON.stringify({ wood, status: host.economicAuthority.status(), world: host.worldState.status() })}`);
  const stone = await submitAndApply(host, client, { type: 'community', op: 'contribute', projectId: ARTISAN.projectId,
    good: 'piedra', amount: 1, expectedRev: host.worldState.community.project.version, opId: 'artisan-project-stone' });
  assert.equal(stone?.ok, true, `stone contribution denied: ${JSON.stringify({ stone, status: host.economicAuthority.status(), world: host.worldState.status(), events: client.events('artisan-project-stone') })}`);
}

test('storage lesson requires the completed community project, logging practice, and carried materials', async (t) => {
  await t.test('unfinished community project', async (st) => {
    const { store } = makeResourceStore(), f = await artisanHost(st, store);
    const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
    calmAt(host, entity, host.server.world.resources.bench);
    profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
    const denied = await submitAndApply(host, client, learn(profile, host.worldState.community.project, 'learn-project-first'));
    assert.equal(denied?.why, 'project');
  });
  await t.test('logging practice below threshold', async (st) => {
    const { store } = makeResourceStore(), f = await artisanHost(st, store);
    const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
    calmAt(host, entity, host.server.world.resources.bench); await completeProject(host, client);
    profile.progression = { v: 1, practice: { logging: 59 }, milestones: [], knowledge: [] };
    profile.eco.pack.goods.madera = 2;
    const denied = await submitAndApply(host, client, learn(profile, host.worldState.community.project, 'learn-practice-first'));
    assert.equal(denied?.why, 'practice');
  });
  await t.test('missing carried materials', async (st) => {
    const { store } = makeResourceStore(), f = await artisanHost(st, store);
    const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
    calmAt(host, entity, host.server.world.resources.bench); await completeProject(host, client);
    profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
    profile.eco.pack.goods = {};
    const denied = await submitAndApply(host, client, learn(profile, host.worldState.community.project, 'learn-goods-first'));
    assert.equal(denied?.why, 'goods');
  });
  await t.test('successful personal teaching spends wood once', async (st) => {
    const { store } = makeResourceStore(), f = await artisanHost(st, store);
    const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
    calmAt(host, entity, host.server.world.resources.bench); await completeProject(host, client);
    profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
    profile.eco.pack.goods.madera = 2;
    const command = learn(profile, host.worldState.community.project, 'learn-storage');
    const taught = await submitAndApply(host, client, command);
    assert.equal(taught?.ok, true); assert.equal(profile.progression.knowledge.includes(ARTISAN.lesson), true);
    assert.equal(profile.eco.pack.goods.madera, undefined); assert.equal(profile.eco.tradeRev, taught.rev);
    const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
    assert.equal(receipt.request.before.eco.tradeRev, taught.rev - 1, 'receipt binds the exact pre-teaching profile');
  });
});

test('lost learning commit response is reconciled and its historical replay cannot undo newer progress', async (t) => {
  const { base, store } = makeResourceStore();
  const gate = deferred(), entered = deferred(); let lose = true;
  store.commitEconomicOperation = async (input) => {
    if (input.request.command.opId !== 'lost-learn-response') return base.commitEconomicOperation(input);
    entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(input);
    if (lose) { lose = false; throw new Error('injected lost artisan commit response'); }
    return result;
  };
  const f = await artisanHost(t, store), { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  calmAt(host, entity, host.server.world.resources.bench);
  profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  await completeProject(host, client);
  profile.eco.pack.goods.madera = 2;
  const command = learn(profile, host.worldState.community.project, 'lost-learn-response');
  const before = copy(profile), tick = host.server.world.tick;
  client.send(command); await entered.promise;
  assert.equal(client.events(command.opId).length, 0);
  assert.deepEqual(profile, before);
  host.server.step(); assert.equal(host.server.world.tick, tick, 'ambiguous learning commit holds the simulation tick');
  gate.resolve(); await host.economicAuthority.settle();
  assert.equal(client.events(command.opId).length, 0, 'settlement alone cannot publish before the drain boundary');
  assert.deepEqual(profile, before);
  host.server.step();
  assert.equal(client.events(command.opId).at(-1)?.ok, true);
  profile.progression.practice.logging = 80;
  const afterLearningAndProgress = copy(profile);
  const replay = await submitAndApply(host, client, command);
  assert.equal(replay?.replay, true); assert.equal(replay?.historical, true);
  assert.deepEqual(profile, afterLearningAndProgress, 'replay returns the old receipt without restoring its old profile');
  assert.ok(await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId)));
});

test('artisan readiness failure prevents host admission', async () => {
  const { base, store } = makeResourceStore({ checkArtisanOperations: async () => { throw new Error('SQL019 unavailable'); } });
  const initial = (await import('../src/sim/systems/inventory.js')).newProfile();
  initial.pirateId = `account:${ACCOUNT_ONE}`;
  await store.initializeProfile(ACCOUNT_ONE, initial);
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, { loggingOperations: true, artisanOperations: true });
  await assert.rejects(host.prepare(), /SQL019 unavailable/);
  assert.equal(host.worldState.ready, false, 'the host cannot admit players while migration readiness is unavailable');
});

test('artisan commands and new storage remain disabled when the opt-in flag is off', async (t) => {
  const { base, store } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { madera: 6 }, options: {
    loggingOperations: true, artisanOperations: false,
    communityRequirements: { madera: 2, piedra: 1 },
  } });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  calmAt(host, entity, host.server.world.resources.bench);
  profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  const list = await submitAndApply(host, client, { type: 'artisan', op: 'list', opId: 'flagoff-list' });
  assert.equal(list?.ok, false); assert.equal(list.why, 'disabled');
  const command = learn(profile, host.worldState.community.project, 'flagoff-learn');
  const learned = await submitAndApply(host, client, command);
  assert.equal(learned?.ok, false); assert.equal(learned.why, 'disabled');
  assert.equal(profile.progression.knowledge.includes(ARTISAN.lesson), false);

  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  const raft = host.server.world.rafts.get(ship.id); standOnRaft(host, entity, raft);
  const piece = ['storage', 0, 1, 0, 0], before = copy(profile);
  const placed = await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: ship.rev, piece, opId: 'flagoff-storage' });
  assert.equal(placed?.ok, false); assert.equal(placed.why, 'disabled');
  assert.deepEqual(profile, before, 'the LocalServer command path cannot apply artisan effects when opted out');
  for (const opId of ['flagoff-list', 'flagoff-learn', 'flagoff-storage'])
    assert.equal(await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, opId)), null);
});

test('enabled artisan rejects guests and malformed raw learn commands before writing receipts', async (t) => {
  const { base, store } = makeResourceStore(); await store.checkArtisanOperations();
  const f = await startResourceHost(t, store, { goods: { madera: 2 }, resolvePlayer: async () => null,
    options: { loggingOperations: true, artisanOperations: true, communityRequirements: { madera: 2, piedra: 1 } } });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  calmAt(host, entity, host.server.world.resources.bench);
  const guest = await submitAndApply(host, client, learn(profile, host.worldState.community.project, 'guest-learn'));
  assert.equal(guest?.ok, false); assert.equal(guest.why, 'account_required');
  assert.equal(await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'guest-learn')), null);

  // Exercise the raw message boundary: extra keys, an unknown lesson, and malformed revisions.
  const malformed = [
    { ...learn(profile, host.worldState.community.project, 'artisan-extra-key'), gold: 1000 },
    { ...learn(profile, host.worldState.community.project, 'artisan-bad-lesson'), lesson: 'all_recipes' },
    { ...learn(profile, host.worldState.community.project, 'artisan-bad-rev'), expectedRev: '0' },
  ];
  for (const command of malformed) {
    const ack = await submitAndApply(host, client, command);
    assert.equal(ack?.ok, false); assert.equal(ack.why, 'command', `unexpected raw-command result: ${JSON.stringify(ack)}`);
    assert.equal(await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId)), null);
  }
});

test('economic receipt validation rejects forged artisan baseline and profile effect', async (t) => {
  for (const forge of ['before', 'profile']) await t.test(`forged ${forge}`, async (st) => {
    const { base, store } = makeResourceStore();
    let rejection;
    store.commitEconomicOperation = async ({ operationId, request }) => {
      if (request.command.type !== 'artisan') return base.commitEconomicOperation({ operationId, request });
      const forged = copy(request);
      if (forge === 'before') forged.before.gold++;
      else forged.profile.gold++;
      rejection = await base.commitEconomicOperation({ operationId, request: forged });
      return rejection;
    };
    const f = await artisanHost(st, store), { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
    calmAt(host, entity, host.server.world.resources.bench);
    profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
    profile.eco.pack.goods.madera = 2;
    await completeProject(host, client);
    client.send(learn(profile, host.worldState.community.project, `forged-${forge}`));
    await turn(); await host.economicAuthority.settle();
    assert.equal(rejection?.ok, false);
    assert.ok(['conflict', 'operation', 'effect'].includes(rejection.why), `unexpected rejection: ${rejection.why}`);
    assert.equal((await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, `forged-${forge}`))), null,
      'a forged request never creates a receipt');
  });
});
