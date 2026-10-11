import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { CRAFT_RECIPES } from '../src/data/resources.js';
import { loggingStatus } from '../src/sim/systems/progression.js';
import { TOWNS } from '../src/data/towns.js';
import {
  ACCOUNT_ONE, ACCOUNT_TWO, RESOURCE_WORLD, calmAt, copy, deferred, findNode,
  makeResourceHost, makeResourceStore, resourceSnapshot, startResourceHost, submitAndApply, turn,
} from './helpers/resource-authority-fixture.mjs';

const gather = (node, opId) => ({ type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId });
const profileFor = (host, account = ACCOUNT_ONE) => host.server.world.profiles.get(host.server.clients.get(host.profiles.accounts.get(account)?.id)?.entity);
const palmNodes = (host) => [...host.server.world.resources.nodes.values()].filter(node => node.kind === 'palm');
const waitForAction = (host) => { for (let i = 0; i < 55; i++) assert.equal(host.server.step(), true); };

async function seedProfile(store, account, { tools = { axe: 1 }, gold = 500, progression } = {}) {
  const profile = (await import('../src/sim/systems/inventory.js')).newProfile();
  profile.pirateId = `account:${account}`;
  profile.tools = { ...profile.tools, ...tools };
  profile.gold = gold;
  if (progression) profile.progression = copy(progression);
  await store.initializeProfile(account, profile);
  return profile;
}

async function loggingHost(t, store, { accounts = [ACCOUNT_ONE], ...options } = {}) {
  return startResourceHost(t, store, { accounts, tools: { axe: 1 }, ...options,
    options: { loggingOperations: true, ...(options.options || {}) } });
}

async function completePalm(f, account, node, prefix) {
  const client = f.clients.get(account), entity = f.entity(account), acks = [], commands = [];
  for (let hit = 1; hit <= 3; hit++) {
    if (hit > 1) waitForAction(f.host);
    const live = f.host.server.world.resources.nodes.get(node.id);
    calmAt(f.host, entity, live);
    const command = gather(live, `${prefix}-${hit}`);
    commands.push(command);
    acks.push(await submitAndApply(f.host, client, command));
  }
  return { acks, commands };
}

async function clearPalmYield(f, client, entity, prefix) {
  waitForAction(f.host);
  calmAt(f.host, entity, f.host.server.world.resources.bench);
  const crafted = await submitAndApply(f.host, client, { type: 'resource', op: 'craft', recipe: 'madera', n: 1,
    opId: `${prefix}-craft`, expectedRev: profileFor(f.host).eco.tradeRev });
  assert.equal(crafted?.ok, true, JSON.stringify(crafted));
  const town = TOWNS.aldea;
  const point = f.host.server.world.map.landmarks[town.landmark] || f.host.server.world.map[town.landmark];
  calmAt(f.host, entity, point);
  const quote = f.host.server.world.economy.quote('aldea', 'madera', 1, 'sell');
  assert.equal(quote.ok, true, 'the test character can sell prepared wood');
  const sold = await submitAndApply(f.host, client, { type: 'commerce', op: 'sell', town: 'aldea', g: 'madera', n: 1,
    opId: `${prefix}-sell`, expectedTotal: quote.total });
  assert.equal(sold?.ok, true, JSON.stringify(sold));
  return sold;
}

test('three authoritative palm hits grant two logs and ten practice once through GameHost', async (t) => {
  const { store } = makeResourceStore();
  await seedProfile(store, ACCOUNT_ONE);
  const f = await loggingHost(t, store);
  const { host, client } = f, entity = f.entity(), node = findNode(host, 'palm');
  assert.equal(host.worldState.resources.v, 2, 'the host adopts the legacy resource snapshot into logging v2');
  calmAt(host, entity, node);
  const commands = [];

  for (let hit = 1; hit <= 3; hit++) {
    if (hit > 1) waitForAction(host);
    const live = host.server.world.resources.nodes.get(node.id);
    calmAt(host, entity, live);
    const command = gather(live, `logging-solo-${hit}`); commands.push(command);
    const ack = await submitAndApply(host, client, command);
    assert.equal(ack?.ok, true);
    const profile = profileFor(host);
    if (hit < 3) {
      assert.equal(profile.eco.pack.goods.tronco, undefined);
      assert.equal(profile.progression.practice.logging, 0);
    } else {
      assert.equal(ack.count, 2);
      assert.equal(profile.eco.pack.goods.tronco, 2);
      assert.equal(profile.progression.practice.logging, 10);
      assert.equal(loggingStatus(profile.progression).rank, 1);
      const savedNode = resourceSnapshot(host).nodes.find(row => row.id === node.id);
      assert.equal(savedNode.hits, 3);
    }
  }
});

test('a failed palm ACK preserves v2 contributors and legacy omission through a later non-final hit', async (t) => {
  const { store } = makeResourceStore();
  const legacy = await seedProfile(store, ACCOUNT_ONE);
  delete legacy.progression;
  await store.saveProfile(ACCOUNT_ONE, legacy, 1);
  const f = await loggingHost(t, store), { host, client } = f, entity = f.entity();
  const node = findNode(host, 'palm'); calmAt(host, entity, node);
  const first = await submitAndApply(host, client, gather(node, 'legacy-partial-first'));
  assert.equal(first?.ok, true);
  assert.equal(first.actionTicks, 54);
  assert.equal(Object.hasOwn(profileFor(host), 'progression'), false);
  const beforeFailure = copy(resourceSnapshot(host).logging);

  const current = host.server.world.resources.nodes.get(node.id);
  const denied = await submitAndApply(host, client, gather(current, 'legacy-partial-cooldown-denial'));
  assert.equal(denied?.ok, false); assert.equal(denied.why, 'cooldown');
  assert.deepEqual(resourceSnapshot(host).logging, beforeFailure, 'a failed ACK keeps the accepted partial contributor ledger');
  assert.equal(Object.hasOwn(profileFor(host), 'progression'), false);

  waitForAction(host);
  const next = host.server.world.resources.nodes.get(node.id); calmAt(host, entity, next);
  const second = await submitAndApply(host, client, gather(next, 'legacy-partial-second'));
  assert.equal(second?.ok, true); assert.equal(second.count, 0);
  assert.deepEqual(resourceSnapshot(host).logging[node.id].contributors, [{ actor: ACCOUNT_ONE, hits: 2 }]);
  assert.equal(Object.hasOwn(profileFor(host), 'progression'), false, 'non-final work does not materialize legacy progress');
  assert.equal(Object.hasOwn((await store.loadProfile(ACCOUNT_ONE)).data, 'progression'), false);
});

test('two-account palm practice is split by hits and updates a disconnected contributor from the current stored profile', async (t) => {
  const { store } = makeResourceStore();
  const unrelated = await seedProfile(store, ACCOUNT_TWO, {
    gold: 347,
    progression: { v: 2, practice: { logging: 0 }, milestones: ['pilot_coastal'], knowledge: [] },
  });
  unrelated.lvl = 8; unrelated.xp = 321.5;
  await store.saveProfile(ACCOUNT_TWO, unrelated, 1);
  await seedProfile(store, ACCOUNT_ONE);
  const f = await loggingHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
  const { host } = f, node = findNode(host, 'palm');
  const a = f.clients.get(ACCOUNT_ONE), b = f.clients.get(ACCOUNT_TWO);
  const ea = f.entity(ACCOUNT_ONE), eb = f.entity(ACCOUNT_TWO);
  calmAt(host, ea, node);
  assert.equal((await submitAndApply(host, a, gather(node, 'shared-a-1')))?.ok, true);
  calmAt(host, eb, node);
  let live = host.server.world.resources.nodes.get(node.id);
  assert.equal((await submitAndApply(host, b, gather(live, 'shared-b-1')))?.ok, true);
  b.ws.close(); await turn();
  assert.equal(host.profiles.accounts.has(ACCOUNT_TWO), false, 'the second contributor is now offline');

  waitForAction(host);
  live = host.server.world.resources.nodes.get(node.id); calmAt(host, ea, live);
  const ack = await submitAndApply(host, a, gather(live, 'shared-a-2'));
  assert.equal(ack?.ok, true);
  assert.equal(profileFor(host, ACCOUNT_ONE).progression.practice.logging, 7);
  assert.equal(profileFor(host, ACCOUNT_ONE).eco.pack.goods.tronco, 2);

  const saved = await store.loadProfile(ACCOUNT_TWO), data = saved.data;
  assert.equal(data.progression.practice.logging, 3);
  assert.deepEqual(data.progression.milestones, ['pilot_coastal']);
  assert.equal(data.gold, 347);
  assert.equal(data.lvl, 8);
  assert.equal(data.xp, 321.5);
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'shared-a-2'));
  assert.deepEqual(receipt.request.beneficiaries.map(row => row.account), [ACCOUNT_ONE, ACCOUNT_TWO].sort());
  assert.equal(receipt.result.profiles.length, 2);
});

test('historical completion replay after newer practice leaves live and stored profile versions unchanged', async (t) => {
  const { store } = makeResourceStore();
  await seedProfile(store, ACCOUNT_ONE);
  const f = await loggingHost(t, store), { host, client } = f, entity = f.entity();
  const [first, second] = palmNodes(host);
  const initial = await completePalm(f, ACCOUNT_ONE, first, 'receipt-first');
  assert.equal(initial.acks.at(-1)?.ok, true);
  await clearPalmYield(f, client, entity, 'receipt-clear-first');
  waitForAction(host);
  const later = await completePalm(f, ACCOUNT_ONE, second, 'receipt-later');
  assert.equal(later.acks.at(-1)?.ok, true, JSON.stringify(later.acks));
  const profile = profileFor(host), before = copy(profile), savedBefore = await store.loadProfile(ACCOUNT_ONE);
  assert.equal(profile.progression.practice.logging, 20);

  const replay = await submitAndApply(host, client, initial.commands.at(-1));
  const savedAfter = await store.loadProfile(ACCOUNT_ONE);
  assert.equal(replay?.ok, true); assert.equal(replay.historical, true); assert.equal(replay.replay, true);
  assert.deepEqual(profile, before, 'an old receipt cannot roll the live character back');
  assert.equal(savedAfter.version, savedBefore.version, 'replay does not write a profile version');
  assert.deepEqual(savedAfter.data, savedBefore.data);
});

test('crossing sixty uses the old action time, and the next palm action uses forty-five ticks', async (t) => {
  const { store } = makeResourceStore();
  await seedProfile(store, ACCOUNT_ONE, { progression: { v: 1, practice: { logging: 59 }, milestones: [], knowledge: [] } });
  const f = await loggingHost(t, store), { host, client } = f, entity = f.entity();
  const [first, second] = palmNodes(host);
  const crossed = await completePalm(f, ACCOUNT_ONE, first, 'threshold');
  assert.equal(crossed.acks.at(-1)?.actionTicks, 54, 'the hito does not speed up its completing hit');
  assert.deepEqual(profileFor(host).progression.milestones, ['logging_steady']);
  await clearPalmYield(f, client, entity, 'threshold-clear-first');
  waitForAction(host);
  calmAt(host, entity, second);
  const next = await submitAndApply(host, client, gather(second, 'threshold-next-action'));
  assert.equal(next?.actionTicks, 45, JSON.stringify(next));
});

test('ambiguous shared commit freezes the world and publishes neither profile until the exact receipt is recovered', async (t) => {
  const { base, store } = makeResourceStore();
  const gate = deferred(), entered = deferred(); let block = false, loseReply = false;
  store.commitEconomicOperation = async (request) => {
    if (!block) return base.commitEconomicOperation(request);
    block = false; entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(request);
    if (loseReply) { loseReply = false; throw new Error('injected logging receipt response loss'); }
    return result;
  };
  await seedProfile(store, ACCOUNT_ONE); await seedProfile(store, ACCOUNT_TWO);
  const f = await loggingHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
  const { host } = f, node = findNode(host, 'palm'), a = f.clients.get(ACCOUNT_ONE), b = f.clients.get(ACCOUNT_TWO);
  const ea = f.entity(ACCOUNT_ONE), eb = f.entity(ACCOUNT_TWO);
  calmAt(host, ea, node); await submitAndApply(host, a, gather(node, 'held-a-1'));
  calmAt(host, eb, node); await submitAndApply(host, b, gather(host.server.world.resources.nodes.get(node.id), 'held-b-1'));
  waitForAction(host); calmAt(host, ea, host.server.world.resources.nodes.get(node.id));
  const command = gather(host.server.world.resources.nodes.get(node.id), 'held-a-2');
  const beforeA = copy(profileFor(host, ACCOUNT_ONE)), beforeB = copy(profileFor(host, ACCOUNT_TWO));
  const beforeResources = resourceSnapshot(host), beforeTick = host.server.world.tick;
  block = true; loseReply = true; a.send(command); await entered.promise;
  assert.equal(a.events(command.opId).length, 0);
  host.server.step();
  assert.equal(host.server.world.tick, beforeTick);
  assert.deepEqual(profileFor(host, ACCOUNT_ONE), beforeA);
  assert.deepEqual(profileFor(host, ACCOUNT_TWO), beforeB);
  assert.deepEqual(resourceSnapshot(host), beforeResources);

  gate.resolve(); await host.economicAuthority.settle();
  assert.equal(a.events(command.opId).length, 0, 'the recovered receipt waits for the host drain');
  assert.deepEqual(profileFor(host, ACCOUNT_TWO), beforeB, 'the offline/remote award is not installed early');
  host.server.step();
  assert.equal(a.events(command.opId).at(-1)?.ok, true);
  assert.equal(profileFor(host, ACCOUNT_ONE).progression.practice.logging, 7);
  assert.equal(profileFor(host, ACCOUNT_TWO).progression.practice.logging, 3);
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(receipt.result.profiles.length, 2);
  assert.equal((await store.loadProfile(ACCOUNT_ONE)).data.progression.practice.logging, 7);
  assert.equal((await store.loadProfile(ACCOUNT_TWO)).data.progression.practice.logging, 3);
});

test('disconnect during a deferred shared commit closes without a late reply and closes both profiles durably', async (t) => {
  const { base, store } = makeResourceStore();
  const gate = deferred(), entered = deferred(); let block = false;
  store.commitEconomicOperation = async (request) => {
    if (!block) return base.commitEconomicOperation(request);
    entered.resolve(); await gate.promise;
    return base.commitEconomicOperation(request);
  };
  await seedProfile(store, ACCOUNT_ONE); await seedProfile(store, ACCOUNT_TWO);
  const f = await loggingHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
  const { host } = f, node = findNode(host, 'palm'), a = f.clients.get(ACCOUNT_ONE), b = f.clients.get(ACCOUNT_TWO);
  calmAt(host, f.entity(ACCOUNT_ONE), node); await submitAndApply(host, a, gather(node, 'close-a-1'));
  calmAt(host, f.entity(ACCOUNT_TWO), node); await submitAndApply(host, b, gather(host.server.world.resources.nodes.get(node.id), 'close-b-1'));
  waitForAction(host); calmAt(host, f.entity(ACCOUNT_ONE), host.server.world.resources.nodes.get(node.id));
  const command = gather(host.server.world.resources.nodes.get(node.id), 'close-a-2');
  block = true; a.send(command); await entered.promise;
  a.ws.close(); await turn();
  assert.equal(host.sockets.has(a.id), true, 'the active actor stays attached while the transaction is unresolved');
  gate.resolve(); await host.economicAuthority.settle(); host.server.step();

  const receipt = await base.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(receipt?.result.ok, true);
  assert.equal(a.events(command.opId).length, 0, 'the closed finisher receives no late ACK');
  assert.equal((await base.loadProfile(ACCOUNT_ONE)).data.progression.practice.logging, 7);
  assert.equal((await base.loadProfile(ACCOUNT_TWO)).data.progression.practice.logging, 3);
  assert.equal(host.sockets.has(a.id), false, 'the deferred close completes after the atomic result drains');
  assert.equal(host.economicAuthority.status().pending, 0);
});

test('logging readiness fails before loading or creating the world, and v2 worlds cannot open without the flag', async (t) => {
  const counts = { load: 0, save: 0 };
  const { base, store } = makeResourceStore({
    async checkLoggingOperations() { return { version: 0 }; },
    async loadWorld(id) { counts.load++; return base.loadWorld(id); },
    async saveWorld(...args) { counts.save++; return base.saveWorld(...args); },
  });
  const blocked = makeResourceHost(store, undefined, { loggingOperations: true });
  t.after(async () => { if (!blocked.closePromise) await blocked.close().catch(() => {}); });
  await assert.rejects(blocked.prepare(), error => error.code === 'configuration');
  assert.deepEqual(counts, { load: 0, save: 0 }, 'SQL logging readiness precedes world load/adoption');

  const enabledStore = makeResourceStore().store;
  await seedProfile(enabledStore, ACCOUNT_ONE);
  const enabled = await loggingHost(t, enabledStore);
  assert.equal((await enabledStore.loadWorld(RESOURCE_WORLD)).data.resources.v, 2);
  await enabled.host.close();
  const legacyFlag = makeResourceHost(enabledStore);
  t.after(async () => { if (!legacyFlag.closePromise) await legacyFlag.close().catch(() => {}); });
  await assert.rejects(legacyFlag.prepare(), error => error.code === 'configuration');
});

test('crafting and commerce on a logging v2 world preserve the contributor ledger and practice', async (t) => {
  const { store } = makeResourceStore();
  const initial = await seedProfile(store, ACCOUNT_ONE);
  initial.eco.pack.goods.tronco = 2;
  await store.saveProfile(ACCOUNT_ONE, initial, 1);
  const f = await loggingHost(t, store), { host, client } = f, entity = f.entity();
  const node = findNode(host, 'palm'); calmAt(host, entity, node);
  await submitAndApply(host, client, gather(node, 'ledger-before-other-ops'));
  const ledger = copy(resourceSnapshot(host).logging);
  const progression = copy(profileFor(host).progression);

  const recipe = CRAFT_RECIPES.madera;
  waitForAction(host);
  calmAt(host, entity, host.server.world.resources.bench);
  const crafted = await submitAndApply(host, client, { type: 'resource', op: 'craft', recipe: recipe.id, n: 1,
    opId: 'v2-craft', expectedRev: profileFor(host).eco.tradeRev });
  assert.equal(crafted?.ok, true, JSON.stringify(crafted));
  assert.deepEqual(resourceSnapshot(host).logging, ledger);
  assert.deepEqual(profileFor(host).progression, progression);

  const town = TOWNS.aldea, point = host.server.world.map.landmarks[town.landmark] || host.server.world.map[town.landmark];
  calmAt(host, entity, point);
  const quote = host.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  const bought = await submitAndApply(host, client, { type: 'commerce', op: 'buy', town: 'aldea', g: 'fruta', n: 1,
    opId: 'v2-commerce', expectedTotal: quote.total });
  assert.equal(bought?.ok, true);
  assert.deepEqual(resourceSnapshot(host).logging, ledger);
  assert.deepEqual(profileFor(host).progression, progression);
});
