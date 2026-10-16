import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { harvestLoot } from '../src/data/harvestLoot.js';
import { MSG } from '../src/net/protocol.js';
import { ACCOUNT_ONE, RESOURCE_WORLD, accountProfile, calmAt, connect, makeResourceHost, makeResourceStore,
  startResourceHost, submitAndApply, turn, copy } from './helpers/resource-authority-fixture.mjs';

const torchOptions = { loggingOperations: true, artisanOperations: true, workshopOperations: true,
  fireOperations: true, freshwaterOperations: true, canteenOperations: true,
  torchResinCoconutOperations: true };
const handTorch = (opId, expectedRev, versioned = true) => ({ type: 'fire', op: 'load', opId, ship: '', part: 'hand',
  kind: 'handTorch', expectedRev, lit: true, ...(versioned ? { rules: 2 } : {}) });
const latestSnapshot = client => client.ws.messages.filter(message => message.t === MSG.SNAPSHOT).at(-1);

async function closedHost(host) {
  if (host.closePromise) return;
  try { await host.close(); }
  catch (error) { if (error.code !== 'flush') throw error; }
}

async function palmHit(f, node, opId) {
  const { host, client } = f;
  while ((host.server.world.resources.cooldowns.get(f.entity()) || 0) > host.server.world.tick)
    assert.equal(host.server.step(), true);
  calmAt(host, f.entity(), node);
  client.send({ type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
  await turn();
  const aim = client.ws.messages.filter(message => message.ev?.type === 'loggingAim').at(-1)?.ev;
  assert.equal(aim?.ok, true, JSON.stringify(aim));
  const receivedAt = aim.challenge.targetTick + 6;
  while (host.worldState.resourceTick() < receivedAt) assert.equal(host.server.step(), true);
  assert.equal(host.worldState.resourceTick(), receivedAt);
  const command = { type: 'resource', op: 'gather', opId, node: node.id, expectedRev: node.rev,
    challenge: aim.challengeId, lootRules: 1 };
  return { command, ack: await submitAndApply(host, client, command) };
}

test('capability snapshot advertises versioned rules and enabled host rejects unversioned commands', async t => {
  const { store, base } = makeResourceStore();
  const f = await startResourceHost(t, store, { tools: { axe: 1 }, options: torchOptions });
  const { host, client } = f, profile = host.server.world.profiles.get(f.entity());
  const node = [...host.server.world.resources.nodes.values()].find(row => row.kind === 'palm');
  assert.ok(node);
  host.server.broadcastSnapshot();
  const snapshot = latestSnapshot(client);
  assert.equal(snapshot.fire.torchRules, 2);
  assert.equal(snapshot.resources.lootRules, 1);

  const before = copy(profile);
  const unversionedFire = handTorch('unversioned-fire', 0, false);
  assert.equal((await submitAndApply(host, client, unversionedFire))?.why, 'command');
  const unversionedPalm = { type: 'resource', op: 'gather', opId: 'unversioned-palm', node: node.id,
    expectedRev: node.rev };
  assert.equal((await submitAndApply(host, client, unversionedPalm))?.why, 'command');
  assert.deepEqual(profile, before);
  assert.equal((await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, unversionedFire.opId))), null);
  assert.equal((await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, unversionedPalm.opId))), null);
});

test('torch capability fails closed when its SQL readiness check is unavailable', async t => {
  const { store } = makeResourceStore({ checkTorchResinCoconutOperations: async () => ({ version: 0 }) });
  await store.initializeProfile(ACCOUNT_ONE, accountProfile());
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, torchOptions);
  t.after(() => closedHost(host));
  await assert.rejects(host.prepare(), error => error.code === 'configuration');
  assert.equal(host.worldState.ready, false, 'failed readiness cannot adopt or expose the world');
});

test('marked final palm receipt grants exact drops once and versioned torch spends two logs plus resin', async t => {
  const { store, base } = makeResourceStore();
  const f = await startResourceHost(t, store, { tools: { axe: 1 }, options: torchOptions });
  const { host, client } = f, profile = host.server.world.profiles.get(f.entity());
  const node = [...host.server.world.resources.nodes.values()].find(row => row.kind === 'palm' &&
    Object.keys(harvestLoot('palm', row.id, 4)).join(',') === 'resina,coco');
  assert.ok(node, 'fixture contains an authored palm whose revision-4 hash yields both goods');
  assert.deepEqual(harvestLoot('palm', node.id, 4), { resina: 1, coco: 1 });

  for (let index = 0; index < 3; index++) {
    const { ack } = await palmHit(f, node, `torch-loot-hit-${index + 1}`);
    assert.equal(ack?.ok, true, JSON.stringify(ack));
    assert.equal(ack.timing.quality, 0, 'late but valid timing keeps the yield at three logs');
    if (index < 2) assert.equal(Object.hasOwn(ack, 'loot'), false, 'partial hits never award bonus goods');
  }
  assert.deepEqual(profile.eco.pack.goods, { tronco: 3, resina: 1, coco: 1 });
  assert.equal(node.rev, 4); assert.equal(node.hits, 3);
  const finalId = economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'torch-loot-hit-3');
  const receipt = await base.loadEconomicOperation(finalId);
  assert.deepEqual(receipt.request.command.lootRules, 1);
  assert.deepEqual(receipt.request.ack.loot, { resina: 1, coco: 1 });
  assert.deepEqual(receipt.request.profile.eco.pack.goods, { tronco: 3, resina: 1, coco: 1 });

  const beforeReplay = copy(profile), resourcesBeforeReplay = copy(host.worldState.resources);
  const replay = await submitAndApply(host, client, { type: 'resource', op: 'gather', opId: 'torch-loot-hit-3',
    node: node.id, expectedRev: 3, challenge: client.ws.messages.filter(m => m.ev?.type === 'loggingAim').at(-1).ev.challengeId,
    lootRules: 1 });
  assert.equal(replay?.replay, true);
  assert.deepEqual(profile, beforeReplay);
  const resourcesAfterReplay = copy(host.worldState.resources);
  resourcesAfterReplay.tick = resourcesBeforeReplay.tick; // replay transport still advances the simulation clock
  assert.deepEqual(resourcesAfterReplay, resourcesBeforeReplay);

  const forged = copy(receipt.request);
  forged.command.opId = 'forged-loot-quantity'; forged.ack.opId = 'forged-loot-quantity'; forged.ack.loot.resina = 2;
  const forgedId = economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, forged.command.opId);
  await assert.rejects(base.commitEconomicOperation({ operationId: forgedId, request: forged }), { code: 'input' });
  assert.equal(await base.loadEconomicOperation(forgedId), null, 'memory receipt validation rejects forged loot before writing');
  const malformed = copy(receipt.request);
  malformed.command.opId = 'malformed-loot-version'; malformed.ack.opId = 'malformed-loot-version'; malformed.command.lootRules = 2;
  await assert.rejects(base.commitEconomicOperation({
    operationId: economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, malformed.command.opId), request: malformed,
  }), { code: 'input' });

  const torch = handTorch('resin-hand-torch', profile.fire?.rev ?? 0);
  const loaded = await submitAndApply(host, client, torch);
  assert.equal(loaded?.ok, true, JSON.stringify(loaded));
  assert.equal(profile.eco.pack.goods.tronco, 1);
  assert.equal(profile.eco.pack.goods.resina, undefined);
  assert.equal(profile.eco.pack.goods.coco, 1);
  assert.equal(profile.eco.pack.goods.madera, undefined, 'new recipe does not debit legacy planks');
  const torchReceipt = await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, torch.opId));
  assert.deepEqual(torchReceipt.request.command.rules, 2);
  assert.deepEqual(torchReceipt.request.before.eco.pack.goods, { tronco: 3, resina: 1, coco: 1 });
  const afterTorch = copy(profile);
  assert.equal((await submitAndApply(host, client, torch))?.replay, true);
  assert.deepEqual(profile, afterTorch, 'replaying the durable load never debits a second set of fuel');
});

test('coconut hydration is capped, durable across restart, and receipt replay consumes only once', async t => {
  const { base, store } = makeResourceStore();
  const initialize = store.initializeProfile;
  store.initializeProfile = async (id, profile, importedKey) => {
    profile.surv = { v: 1, sat: 42, hyd: 80 };
    return initialize(id, profile, importedKey);
  };
  const f = await startResourceHost(t, store, { goods: { coco: 1 }, options: torchOptions });
  const profile = f.host.server.world.profiles.get(f.entity());
  const before = copy(profile.surv);
  const command = { type: 'freshwater', op: 'eat', opId: 'eat-coconut-once', expectedRev: profile.eco.tradeRev,
    source: 'coco', ship: '', part: '', n: 1 };
  const ack = await submitAndApply(f.host, f.client, command);
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  assert.equal(profile.surv.sat, before.sat, 'coconut does not restore saturation');
  assert.equal(profile.surv.hyd, 100, 'hydration clamps at the cap');
  assert.equal(profile.eco.pack.goods.coco, undefined);
  const receiptId = economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId);
  const receipt = await base.loadEconomicOperation(receiptId);
  assert.equal(receipt.request.before.surv.hyd, 80);
  assert.deepEqual(receipt.request.profile.surv, { v: 1, sat: 42, hyd: 100 });

  await closedHost(f.host);
  const resumed = await startResourceHost(t, store, { goods: { coco: 1 }, options: torchOptions });
  const restored = resumed.host.server.world.profiles.get(resumed.entity());
  assert.deepEqual(restored.surv, { v: 1, sat: 42, hyd: 100 });
  assert.equal(restored.eco.pack.goods.coco, undefined);
  const replay = await submitAndApply(resumed.host, resumed.client, command);
  assert.equal(replay?.replay, true);
  assert.deepEqual(restored.surv, { v: 1, sat: 42, hyd: 100 });
  assert.equal(await base.loadEconomicOperation(receiptId) !== null, true);
});

test('disabled capability retains unversioned one-plank hand torch and no palm drops', async t => {
  const { store, base } = makeResourceStore();
  const options = { fireOperations: true };
  const f = await startResourceHost(t, store, { goods: { madera: 1 }, tools: { axe: 1 }, options });
  const { host, client } = f, profile = host.server.world.profiles.get(f.entity());
  host.server.broadcastSnapshot();
  const snapshot = latestSnapshot(client);
  assert.notEqual(snapshot.fire.torchRules, 2);
  assert.notEqual(snapshot.resources.lootRules, 1);

  const node = [...host.server.world.resources.nodes.values()].find(row => row.kind === 'palm');
  assert.ok(node);
  for (let index = 0; index < 3; index++) {
    while ((host.server.world.resources.cooldowns.get(f.entity()) || 0) > host.server.world.tick) host.server.step();
    calmAt(host, f.entity(), node);
    const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', opId: `legacy-palm-${index + 1}`,
      node: node.id, expectedRev: node.rev });
    assert.equal(ack?.ok, true, JSON.stringify(ack));
    assert.equal(Object.hasOwn(ack, 'loot'), false);
  }
  assert.equal(profile.eco.pack.goods.resina, undefined);
  assert.equal(profile.eco.pack.goods.coco, undefined);
  assert.equal(profile.eco.pack.goods.madera, 1);

  const command = handTorch('legacy-hand-torch', profile.fire?.rev ?? 0, false);
  const loaded = await submitAndApply(host, client, command);
  assert.equal(loaded?.ok, true, JSON.stringify(loaded));
  assert.equal(profile.eco.pack.goods.madera, undefined);
  const receipt = await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(Object.hasOwn(receipt.request.command, 'rules'), false);
  assert.equal(receipt.request.before.eco.pack.goods.madera, 1);
  assert.equal(receipt.request.profile.eco.pack.goods.madera, undefined);

  await closedHost(host);
  const enabled = await startResourceHost(t, store, { tools: { axe: 1 }, options: torchOptions });
  const resumedProfile = enabled.host.server.world.profiles.get(enabled.entity());
  const beforeReplay = copy(resumedProfile);
  const historical = await submitAndApply(enabled.host, enabled.client, command);
  assert.equal(historical?.replay, true);
  assert.equal(historical?.historical, true);
  assert.deepEqual(resumedProfile, beforeReplay, 'historical retry cannot spend or restore profile goods after feature activation');

  const unversioned = handTorch('new-unversioned-hand-torch', resumedProfile.fire.rev, false);
  const denied = await submitAndApply(enabled.host, enabled.client, unversioned);
  assert.equal(denied?.ok, false);
  assert.equal(denied?.why, 'command');
  assert.deepEqual(resumedProfile, beforeReplay, 'new operations still require the enabled version marker');
  assert.equal(await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, unversioned.opId)), null);
});
