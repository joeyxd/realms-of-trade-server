import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTISAN } from '../src/data/artisan.js';
import {
  ACCOUNT_ONE, RESOURCE_WORLD, calmAt, connect, copy, deferred, makeResourceHost,
  makeResourceStore, startResourceHost, submitAndApply, turn,
} from './helpers/resource-authority-fixture.mjs';

const artisanOptions = { loggingOperations: true, artisanOperations: true,
  resourceOperations: true,
  communityRequirements: { madera: 2, piedra: 1 } };
const profileFor = (host, entity) => host.server.world.profiles.get(entity);

async function prepareLesson(host, client, entity, profile) {
  calmAt(host, entity, host.server.world.resources.bench);
  profile.eco.pack.goods = { madera: 2, piedra: 1 };
  const project = host.worldState.community.project;
  const wood = await submitAndApply(host, client, { type: 'community', op: 'contribute', projectId: ARTISAN.projectId,
    good: 'madera', amount: 2, expectedRev: project.version, opId: `project-wood-${host.worldState.version}` });
  assert.equal(wood?.ok, true);
  const stone = await submitAndApply(host, client, { type: 'community', op: 'contribute', projectId: ARTISAN.projectId,
    good: 'piedra', amount: 1, expectedRev: host.worldState.community.project.version,
    opId: `project-stone-${host.worldState.version}` });
  assert.equal(stone?.ok, true);
  profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  profile.eco.pack.goods.madera = 2;
}

async function fundStorage(host, client, entity, profile, ship, opId) {
  // Expand the starter raft through the regular editor, then stage a capacity-valid build cost.
  profile.eco.pack.goods.madera = 2;
  const raft = host.server.world.rafts.get(ship.id);
  standOnRaft(host, entity, raft);
  const crate = await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: ship.rev, piece: ['crate', 1, 0, 0, 0], opId: `${opId}-crate` });
  assert.equal(crate?.ok, true, `second crate setup failed: ${JSON.stringify(crate)}`);
  ship.hold.goods.madera = 4;
  profile.eco.pack.goods.madera = 2;
}

function standOnRaft(host, entity, raft) {
  const ecs = host.server.world.ecs, angle = ecs.facing[raft.entity];
  const c = Math.cos(angle), s = Math.sin(angle);
  ecs.x[entity] = ecs.x[raft.entity] + c + s;
  ecs.z[entity] = ecs.z[raft.entity] - s + c;
  ecs.y[entity] = ecs.y[raft.entity]; ecs.regenT[entity] = 100;
  ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

test('new raft storage is denied before learning, then paid and committed after the personal lesson', async (t) => {
  const { base, store } = makeResourceStore(); await store.checkArtisanOperations();
  const f = await startResourceHost(t, store, { goods: { madera: 2, piedra: 1 }, options: artisanOptions });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  const woodBefore = profile.eco.pack.goods.madera;
  const ship = profile.eco.ships.find((s) => s.kind === 'raft'), raft = host.server.world.rafts.get(ship.id);
  standOnRaft(host, entity, raft);
  const piece = ['storage', 0, 1, 0, 0];
  const denied = await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: ship.rev, piece, opId: 'storage-before-lesson' });
  assert.equal(denied?.ok, false); assert.equal(denied.why, 'knowledge');
  assert.equal(ship.grid.parts.some((p) => p[0] === 'storage'), false);
  assert.equal(profile.eco.pack.goods.madera, woodBefore, 'rejected placement never consumes materials');

  await prepareLesson(host, client, entity, profile);
  const learned = await submitAndApply(host, client, { type: 'artisan', op: 'learn', lesson: ARTISAN.lesson,
    expectedRev: profile.eco.tradeRev, expectedProjectRev: host.worldState.community.project.version, opId: 'storage-lesson' });
  assert.equal(learned?.ok, true); assert.equal(profile.eco.pack.goods.madera, undefined);
  standOnRaft(host, entity, raft);
  await fundStorage(host, client, entity, profile, ship, 'storage-after-lesson');
  const beforeRev = ship.rev;
  const placed = await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: beforeRev, piece, opId: 'storage-after-lesson' });
  assert.equal(placed?.ok, true, JSON.stringify({ placed, pack: profile.eco.pack, hold: ship.hold, grid: ship.grid.parts, rev: ship.rev })); assert.equal(placed.type, 'raftEdit');
  assert.equal(ship.rev, beforeRev + 1);
  assert.deepEqual(ship.grid.parts.find((p) => p[0] === 'storage'), piece);
  assert.equal(profile.eco.pack.goods.madera, undefined, 'backpack construction materials are debited exactly once');
  assert.equal(ship.hold.goods.madera, undefined, 'raft cargo construction materials are debited exactly once');
  const receipt = await base.loadEconomicOperation((await import('../server/economicAuthority.mjs'))
    .economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'storage-after-lesson'));
  assert.equal(receipt.request.before.eco.pack.goods.madera, 2);
  assert.equal(receipt.request.before.eco.ships.find((s) => s.id === ship.id).hold.goods.madera, 4);
  assert.equal(receipt.request.before.progression.knowledge.includes(ARTISAN.lesson), true,
    'the construction receipt uses the taught profile as its exact baseline');

  const extraCrateIndex = ship.grid.parts.findIndex((part) => part[0] === 'crate' && part[1] === 1 && part[2] === 0);
  const removedCrate = await submitAndApply(host, client, { type: 'raft', op: 'remove', id: ship.id,
    expectedRev: ship.rev, piece: ship.grid.parts[extraCrateIndex], index: extraCrateIndex, opId: 'remove-crate-after-storage' });
  assert.equal(removedCrate?.ok, true, JSON.stringify(removedCrate));
  const afterLaterEdit = copy(profile);
  const historical = await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: beforeRev, piece, opId: 'storage-after-lesson' });
  assert.equal(historical?.replay, true); assert.equal(historical?.historical, true);
  assert.deepEqual(profile, afterLaterEdit, 'historical storage replay does not roll back a later nonstorage raft edit');
});

test('storage placement emits no early ACK while its M5 commit is held', async (t) => {
  const base = (await makeResourceStore()).base, gate = deferred(), entered = deferred();
  const store = { ...base, async commitEconomicOperation(input) {
    if (input.request.command.opId !== 'held-storage-place') return base.commitEconomicOperation(input);
    entered.resolve(); await gate.promise; return base.commitEconomicOperation(input);
  } };
  await store.checkArtisanOperations();
  const f = await startResourceHost(t, store, { goods: { madera: 2, piedra: 1 }, options: artisanOptions });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  await prepareLesson(host, client, entity, profile);
  const learned = await submitAndApply(host, client, { type: 'artisan', op: 'learn', lesson: ARTISAN.lesson,
    expectedRev: profile.eco.tradeRev, expectedProjectRev: host.worldState.community.project.version, opId: 'held-storage-lesson' });
  assert.equal(learned?.ok, true);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft'), raft = host.server.world.rafts.get(ship.id);
  standOnRaft(host, entity, raft);
  await fundStorage(host, client, entity, profile, ship, 'held-storage-place');
  const before = copy(profile), tick = host.server.world.tick;
  const liveRaft = host.server.world.rafts.get(ship.id);
  const physicalBefore = copy({ grid: ship.grid, hold: ship.hold, condition: liveRaft.condition });
  const command = { type: 'raft', op: 'place', id: ship.id, expectedRev: ship.rev,
    piece: ['storage', 0, 1, 0, 0], opId: 'held-storage-place' };
  client.send(command); await entered.promise;
  assert.equal(client.events(command.opId).length, 0);
  assert.deepEqual(profile, before); assert.equal(ship.grid.parts.some((p) => p[0] === 'storage'), false);
  assert.deepEqual({ grid: ship.grid, hold: ship.hold, condition: liveRaft.condition }, physicalBefore,
    'candidate storage cannot alter grid, hold capacity/cargo, or live condition before commit');
  host.server.step(); assert.equal(host.server.world.tick, tick, 'uncertain durable placement holds the simulation tick');
  gate.resolve(); await host.economicAuthority.settle();
  assert.equal(client.events(command.opId).length, 0, 'provider settlement alone cannot send the ACK');
  host.server.step();
  assert.equal(client.events(command.opId).at(-1)?.ok, true);
  assert.equal(ship.grid.parts.some((p) => p[0] === 'storage'), true);
  assert.equal(ship.hold.cap, 32, 'confirmed placement publishes the expanded hold capacity');
  assert.equal(ship.hold.goods.madera, undefined, 'confirmed placement publishes the material debit');
});

test('confirmed storage survives host restart and an unlearned legacy owner can still use and remove it', async (t) => {
  const { store } = makeResourceStore(); await store.checkArtisanOperations();
  const first = await startResourceHost(t, store, { goods: { madera: 2, piedra: 1 }, options: artisanOptions });
  const { host, client } = first, entity = first.entity(), profile = profileFor(host, entity);
  await prepareLesson(host, client, entity, profile);
  assert.equal((await submitAndApply(host, client, { type: 'artisan', op: 'learn', lesson: ARTISAN.lesson,
    expectedRev: profile.eco.tradeRev, expectedProjectRev: host.worldState.community.project.version, opId: 'restart-storage-lesson' }))?.ok, true);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft'), raft = host.server.world.rafts.get(ship.id);
  standOnRaft(host, entity, raft);
  await fundStorage(host, client, entity, profile, ship, 'restart-storage-place');
  const piece = ['storage', 0, 1, 0, 0];
  assert.equal((await submitAndApply(host, client, { type: 'raft', op: 'place', id: ship.id,
    expectedRev: ship.rev, piece, opId: 'restart-storage-place' }))?.ok, true);
  const afterPlace = copy(profile); client.ws.close(); await host.close();

  const second = makeResourceHost(store, async () => ACCOUNT_ONE, artisanOptions);
  t.after(async () => { if (!second.closePromise) await second.close().catch((error) => { if (error.code !== 'flush') throw error; }); });
  await second.prepare();
  const resumed = connect(second); resumed.hello(); await Promise.all([...second.joins]);
  const entity2 = second.server.clients.get(resumed.id).entity, restored = profileFor(second, entity2);
  const restoredShip = restored.eco.ships.find((s) => s.kind === 'raft');
  assert.deepEqual(restored, afterPlace);
  assert.ok(restoredShip.grid.parts.some((p) => p[0] === 'storage'));
  restored.progression.knowledge = [];
  restored.eco.pack.goods.madera = 1;
  await second.profiles.save(resumed.id, restored); await second.profiles.flush();
  const restoredRaft = second.server.world.rafts.get(restoredShip.id); standOnRaft(second, entity2, restoredRaft);
  const countBefore = restoredShip.hold.cap;
  // Existing storage capacity remains part of the raft even after a legacy profile lacks the lesson.
  const loaded = await (async () => {
    resumed.send({ type: 'commerce', op: 'transfer', id: restoredShip.id, expectedRev: restoredShip.rev,
      g: 'madera', n: 1, side: 'deposit', opId: 'legacy-load-storage' });
    await turn(); await second.economicAuthority.settle(); second.server.step();
    return resumed.events('legacy-load-storage').at(-1);
  })();
  assert.equal(loaded?.ok, true, 'existing raft hold remains usable without the lesson');
  assert.equal(restoredShip.hold.goods.madera, 1);
  const roundTrip = await (async () => {
    resumed.send({ type: 'raft', op: 'remove', id: restoredShip.id, expectedRev: restoredShip.rev,
      piece, index: restoredShip.grid.parts.findIndex((p) => p[0] === 'storage'), opId: 'legacy-remove-storage' });
    await turn(); await second.economicAuthority.settle(); second.server.step();
    return resumed.events('legacy-remove-storage').at(-1);
  })();
  assert.equal(roundTrip?.ok, true, 'legacy storage removal does not require relearning');
  assert.equal(restoredShip.grid.parts.some((p) => p[0] === 'storage'), false);
  assert.ok(restoredShip.hold.cap < countBefore);
});
