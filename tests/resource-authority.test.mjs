import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { CRAFT_RECIPES } from '../src/data/resources.js';
import { DT } from '../src/data/tuning.js';
import {
  ACCOUNT_ONE, ACCOUNT_TWO, RESOURCE_WORLD, calmAt, connect, copy, deferred, findNode,
  makeResourceHost, makeResourceStore, resourceSnapshot, startResourceHost, submitAndApply, turn,
} from './helpers/resource-authority-fixture.mjs';

const gather = (node, opId) => ({ type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId });
const profileFor = (host, entity) => host.server.world.profiles.get(entity);
const durableNode = (host, id) => host.worldState.resources.nodes.find((node) => node.id === id);
const sentHits = (client, nodeId) => client.of('event').map((message) => message.ev)
  .filter((event) => event?.type === 'resourceHit' && event.node === nodeId);

test('confirmed gathering commits profile and resource-node state through the M5 receipt', async (t) => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store);
  const entity = f.entity(), host = f.host, client = f.client, node = findNode(host, 'wood');
  const initialRev = node.rev; calmAt(host, entity, node);
  const ack = await submitAndApply(host, client, gather(node, 'gather-wood'));
  assert.equal(ack?.ok, true);
  assert.equal(ack?.good, 'tronco'); assert.equal(ack?.count, 1);
  assert.equal(profileFor(host, entity).eco.pack.goods.tronco, 1);
  assert.equal(durableNode(host, node.id).rev, initialRev + 1);
  assert.ok(durableNode(host, node.id).readyAt > host.worldState.resources.tick,
    'respawn is stored as a logical deadline after the durable clock anchor');
  assert.ok(host.worldState.resources.cooldowns[ACCOUNT_ONE] > host.worldState.resources.tick,
    'the account action cooldown uses the same logical clock');
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'gather-wood'));
  assert.deepEqual(receipt.request.worldData.resources, host.worldState.resources);
  assert.equal(receipt.result.ack.ok, true);
});

test('crafting a stone axe consumes materials once, persists the tool, and exact replay does not debit again', async (t) => {
  const { store } = makeResourceStore();
  const recipe = CRAFT_RECIPES.hacha_piedra;
  const f = await startResourceHost(t, store, { goods: { ...recipe.inputs } });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  calmAt(host, entity, host.server.world.resources.bench);
  const command = { type: 'resource', op: 'craft', recipe: recipe.id, opId: 'craft-stone-axe',
    expectedRev: profile.eco.tradeRev };
  const ack = await submitAndApply(host, client, command);
  assert.equal(ack?.ok, true); assert.equal(ack.tool, 'axe'); assert.equal(ack.tier, 1);
  assert.equal(profile.tools.axe, 1);
  for (const good of Object.keys(recipe.inputs)) assert.equal(profile.eco.pack.goods[good], undefined);
  const after = copy(profile);
  const replay = await submitAndApply(host, client, command);
  assert.equal(replay?.ok, true); assert.equal(replay.replay, true); assert.equal(replay.historical, true);
  assert.deepEqual(profile, after, 'replaying a receipt never installs an old profile snapshot');
  const saved = (await store.loadProfile(ACCOUNT_ONE)).data;
  assert.deepEqual(saved.tools, { axe: 1, pickaxe: 0 });
  for (const good of Object.keys(recipe.inputs)) assert.equal(saved.eco.pack.goods[good], undefined);
});

test('partial palm work persists node revision and hits without granting logs until the final hit', async (t) => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { tools: { axe: 1 } });
  const { host, client } = f, entity = f.entity(), profile = profileFor(host, entity);
  const node = findNode(host, 'palm'); calmAt(host, entity, node);
  const startingTradeRev = profile.eco.tradeRev;

  for (let hit = 1; hit <= 3; hit++) {
    if (hit > 1) host.server.world.tick += 55;
    const liveNode = host.server.world.resources.nodes.get(node.id);
    const ack = await submitAndApply(host, client, gather(liveNode, `palm-hit-${hit}`));
    assert.equal(ack?.ok, true);
    const saved = durableNode(host, node.id);
    assert.equal(saved.rev, hit + 1);
    if (hit < 3) {
      assert.equal(saved.hits, hit); assert.equal(saved.readyAt, 0);
      assert.equal(profile.eco.pack.goods.tronco, undefined);
      assert.equal(profile.eco.tradeRev, startingTradeRev);
    } else {
      assert.equal(saved.hits, 3); assert.ok(saved.readyAt > host.worldState.resources.tick);
      assert.equal(profile.eco.pack.goods.tronco, 2);
      assert.equal(profile.eco.tradeRev, startingTradeRev + 1);
    }
  }
});

test('a second host restores node progress and inventory from the same store without respawning it', async (t) => {
  const { store } = makeResourceStore();
  const first = await startResourceHost(t, store);
  const entity1 = first.entity(), node = findNode(first.host, 'wood'); calmAt(first.host, entity1, node);
  const ack = await submitAndApply(first.host, first.client, gather(node, 'restart-gather'));
  assert.equal(ack?.ok, true);
  first.host.server.world.tick = 100;
  const firstReadyAt = durableNode(first.host, node.id).readyAt;
  const firstProfile = copy(profileFor(first.host, entity1));
  first.client.ws.close(); await first.host.close();
  const savedWorld = await store.loadWorld(RESOURCE_WORLD);
  const persisted = savedWorld.data.resources, readyAt = persisted.nodes.find((saved) => saved.id === node.id).readyAt;
  assert.equal(persisted.tick, 100, 'shutdown checkpoints the logical clock after the last gathered tick');
  assert.equal(firstReadyAt, readyAt, 'shutdown preserves the resource deadline while checkpointing its newer anchor');
  const remaining = readyAt - persisted.tick;

  const second = makeResourceHost(store);
  t.after(async () => { if (!second.closePromise) await second.close().catch((error) => { if (error.code !== 'flush') throw error; }); });
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 365 * 24 * 60 * 60 * 1000;
    await second.prepare();
  } finally { Date.now = originalNow; }
  const client2 = connect(second); client2.hello(); await Promise.all([...second.joins]);
  const entity2 = second.server.clients.get(client2.id).entity;
  const profile2 = profileFor(second, entity2);
  assert.equal(profile2.eco.pack.goods.tronco, firstProfile.eco.pack.goods.tronco);
  assert.deepEqual(second.worldState.resources, persisted);
  assert.equal(durableNode(second, node.id).readyAt, readyAt);
  assert.equal(second.server.world.resources.nodes.get(node.id).readyTick - second.server.world.tick, remaining,
    'restoration keeps the exact tick remainder even after a year of wall-clock time');
  calmAt(second, entity2, second.server.world.resources.nodes.get(node.id));
  const retry = await submitAndApply(second, client2,
    gather(second.server.world.resources.nodes.get(node.id), 'restart-no-respawn'));
  assert.equal(retry?.ok, false);
  assert.ok(['depleted', 'cooldown'].includes(retry.why));
  assert.equal(profile2.eco.pack.goods.tronco, firstProfile.eco.pack.goods.tronco,
    'restart does not create a second harvest while the persisted deadline is active');
});

test('resource cooldown resumes with the same logical remainder after a long offline period', async (t) => {
  const { store } = makeResourceStore();
  const first = await startResourceHost(t, store);
  const entity = first.entity(), firstNode = findNode(first.host, 'wood'); calmAt(first.host, entity, firstNode);
  assert.equal((await submitAndApply(first.host, first.client, gather(firstNode, 'cooldown-first')))?.ok, true);

  // Let that 30-tick action cooldown expire, then create a new one which is still active at durable tick 100.
  first.host.server.world.tick = 99;
  const secondNode = [...first.host.server.world.resources.nodes.values()].find((node) => node.kind === 'wood' && node.id !== firstNode.id);
  assert.ok(secondNode);
  calmAt(first.host, entity, secondNode);
  assert.equal((await submitAndApply(first.host, first.client, gather(secondNode, 'cooldown-second')))?.ok, true);
  first.client.ws.close(); await first.host.close();

  const saved = (await store.loadWorld(RESOURCE_WORLD)).data.resources;
  assert.equal(saved.tick, 100);
  assert.equal(saved.cooldowns[ACCOUNT_ONE] - saved.tick, 29);

  const second = makeResourceHost(store);
  t.after(async () => { if (!second.closePromise) await second.close().catch((error) => { if (error.code !== 'flush') throw error; }); });
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 365 * 24 * 60 * 60 * 1000;
    await second.prepare();
  } finally { Date.now = originalNow; }
  const client = connect(second); client.hello(); await Promise.all([...second.joins]);
  const entity2 = second.server.clients.get(client.id).entity;
  const profile = profileFor(second, entity2), thirdNode = [...second.server.world.resources.nodes.values()]
    .find((node) => node.kind === 'wood' && node.id !== firstNode.id && node.id !== secondNode.id);
  assert.ok(thirdNode);
  calmAt(second, entity2, thirdNode);
  const blocked = await submitAndApply(second, client, gather(thirdNode, 'cooldown-restored'));
  assert.equal(blocked?.ok, false);
  assert.equal(blocked.why, 'cooldown');
  assert.equal(blocked.wait, 29 * DT);
  assert.equal(profile.eco.pack.goods.tronco, 2, 'the restart denial does not grant another resource');
});

test('lost resource commit reply stays behind the tick gate until the exact receipt is recovered', async (t) => {
  const { base, store } = makeResourceStore();
  const gate = deferred(), entered = deferred(); let loseReply = true;
  store.commitEconomicOperation = async (request) => {
    entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(request);
    if (loseReply) { loseReply = false; throw new Error('injected lost resource commit response'); }
    return result;
  };
  const f = await startResourceHost(t, store);
  const { host, client } = f, entity = f.entity(), node = findNode(host, 'wood'); calmAt(host, entity, node);
  const initialRev = node.rev;
  const profile = profileFor(host, entity), beforeProfile = copy(profile), beforeWorld = resourceSnapshot(host);
  const beforeTick = host.server.world.tick;
  const command = gather(node, 'lost-resource-reply');
  client.send(command); await entered.promise;
  assert.equal(client.events(command.opId).length, 0);
  assert.equal(sentHits(client, node.id).length, 0);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(resourceSnapshot(host), beforeWorld);
  assert.equal((await store.loadProfile(ACCOUNT_ONE)).data.eco.pack.goods.tronco, undefined);
  host.server.step();
  assert.equal(host.server.world.tick, beforeTick, 'the simulation cannot advance during an ambiguous commit');
  assert.deepEqual(profile, beforeProfile);
  gate.resolve(); await host.economicAuthority.settle();
  assert.equal(client.events(command.opId).length, 0, 'the durable continuation cannot publish outside drain');
  assert.deepEqual(profile, beforeProfile, 'receipt recovery prepares, but does not mutate the live world');
  host.server.step();
  assert.equal(client.events(command.opId).at(-1)?.ok, true);
  assert.equal(profile.eco.pack.goods.tronco, 1);
  assert.equal(host.server.world.resources.nodes.get(node.id).rev, initialRev + 1);
  assert.equal(sentHits(client, node.id).length, 1);
});

test('two accounts contending for one node can produce only one gather result', async (t) => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
  const { host } = f, node = findNode(host, 'wood');
  const first = f.clients.get(ACCOUNT_ONE), second = f.clients.get(ACCOUNT_TWO);
  const e1 = f.entity(ACCOUNT_ONE), e2 = f.entity(ACCOUNT_TWO);
  calmAt(host, e1, node); calmAt(host, e2, node);
  const stale = node.rev;
  const firstCommand = { type: 'resource', op: 'gather', node: node.id, expectedRev: stale, opId: 'contend-first' };
  const secondCommand = { type: 'resource', op: 'gather', node: node.id, expectedRev: stale, opId: 'contend-second' };
  first.send(firstCommand); await turn(); second.send(secondCommand); await turn();
  assert.equal(second.events(secondCommand.opId).at(-1)?.why, 'busy', 'the in-flight world receipt reserves the shared mutation lane');
  await host.economicAuthority.settle(); host.server.step();
  const winner = first.events(firstCommand.opId).at(-1);
  assert.equal(winner?.ok, true);
  const loser = await submitAndApply(host, second, secondCommand);
  assert.equal(loser?.ok, false); assert.equal(loser.why, 'revision');
  assert.equal(profileFor(host, e1).eco.pack.goods.tronco, 1);
  assert.equal(profileFor(host, e2).eco.pack.goods.tronco, undefined);
  assert.equal(host.server.world.resources.nodes.get(node.id).rev, stale + 1);
});

test('guest gathering is denied and a reused opId cannot be rebound to another resource request', async (t) => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { resolvePlayer: async (_request, hello) => hello.name === 'guest' ? null : ACCOUNT_ONE });
  const { host, client } = f, entity = f.entity(), node = findNode(host, 'wood'); calmAt(host, entity, node);
  const guest = connect(host, 'guest'); guest.hello(); await Promise.all([...host.joins]);
  guest.send(gather(node, 'guest-gather')); await turn();
  assert.equal(guest.events('guest-gather').at(-1)?.why, 'account_required');
  assert.equal(host.server.world.resources.nodes.get(node.id).rev, node.rev);

  const accepted = await submitAndApply(host, client, gather(node, 'bound-resource-id'));
  assert.equal(accepted?.ok, true);
  const other = findNode(host, 'stone');
  const beforeProfile = copy(profileFor(host, entity)), beforeResources = resourceSnapshot(host);
  const altered = await submitAndApply(host, client,
    { type: 'resource', op: 'gather', node: other.id, expectedRev: other.rev, opId: 'bound-resource-id' });
  assert.equal(altered?.ok, false); assert.equal(altered.why, 'duplicate');
  assert.deepEqual(profileFor(host, entity), beforeProfile);
  assert.deepEqual(resourceSnapshot(host), beforeResources);
});
