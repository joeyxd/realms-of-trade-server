import test from 'node:test';
import assert from 'node:assert/strict';
import { loggingWorldTransition } from '../server/loggingOperation.mjs';
import { checkedResourceState } from '../server/resourceState.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import {
  ACCOUNT_ONE, ACCOUNT_TWO, RESOURCE_WORLD, calmAt, copy, deferred, findNode,
  makeResourceStore, startResourceHost, submitAndApply, turn,
} from './helpers/resource-authority-fixture.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { StoreError } from '../server/store.mjs';

const gather = (node, opId) => ({ type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId });
const liveProfile = (host, account) => host.server.world.profiles.get(
  host.server.clients.get(host.profiles.accounts.get(account)?.id)?.entity);
const waitAction = host => { for (let i = 0; i < 55; i++) assert.equal(host.server.step(), true); };

async function seed(store, account, progression, legacy = false) {
  const profile = newProfile(); profile.pirateId = `account:${account}`; profile.tools.axe = 1;
  if (progression !== undefined) profile.progression = copy(progression);
  if (legacy) delete profile.progression;
  await store.initializeProfile(account, profile);
}

async function captureFinal(t, { secondActor = true, progressions = {}, legacyActor = false } = {}) {
  const { base, store } = makeResourceStore();
  await seed(store, ACCOUNT_ONE, progressions[ACCOUNT_ONE], legacyActor);
  if (secondActor) await seed(store, ACCOUNT_TWO, progressions[ACCOUNT_TWO]);
  const entered = deferred(), release = deferred();
  let intercepted = null;
  const original = store.commitEconomicOperation;
  store.commitEconomicOperation = async raw => {
    const node = raw.request.worldData?.resources?.nodes?.find(n => n.id === raw.request.command.node);
    if (!intercepted && node?.kind === 'palm' && node.hits === 3) {
      intercepted = copy(raw);
      entered.resolve();
      await release.promise;
      return { ok: false, why: 'operation' };
    }
    return original(raw);
  };
  const f = await startResourceHost(t, store, { accounts: secondActor ? [ACCOUNT_ONE, ACCOUNT_TWO] : [ACCOUNT_ONE],
    options: { loggingOperations: true } });
  const host = f.host, first = f.clients.get(ACCOUNT_ONE), actor = f.entity(ACCOUNT_ONE);
  const node = findNode(host, 'palm'); calmAt(host, actor, node);
  const one = await submitAndApply(host, first, gather(node, `contract-one-${Date.now()}`));
  assert.equal(one?.ok, true);
  if (legacyActor) {
    assert.equal(Object.hasOwn(liveProfile(host, ACCOUNT_ONE), 'progression'), false);
    const denied = await submitAndApply(host, first, gather(host.server.world.resources.nodes.get(node.id), `contract-denied-${Date.now()}`));
    assert.equal(denied?.ok, false);
    assert.equal(Object.hasOwn(liveProfile(host, ACCOUNT_ONE), 'progression'), false);
    assert.equal(Object.hasOwn((await base.loadProfile(ACCOUNT_ONE)).data, 'progression'), false);
  }
  if (secondActor) {
    const second = f.clients.get(ACCOUNT_TWO), entity = f.entity(ACCOUNT_TWO);
    waitAction(host); calmAt(host, entity, host.server.world.resources.nodes.get(node.id));
    assert.equal((await submitAndApply(host, second, gather(host.server.world.resources.nodes.get(node.id), `contract-two-${Date.now()}`)))?.ok, true);
  } else {
    waitAction(host); calmAt(host, actor, host.server.world.resources.nodes.get(node.id));
    assert.equal((await submitAndApply(host, first, gather(host.server.world.resources.nodes.get(node.id), `contract-mid-${Date.now()}`)))?.ok, true);
  }
  waitAction(host); calmAt(host, actor, host.server.world.resources.nodes.get(node.id));
  const command = gather(host.server.world.resources.nodes.get(node.id), `contract-final-${Date.now()}`);
  first.send(command);
  try { await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(
    `final capture timed out: ${JSON.stringify({ busy: host.economicAuthority.busy, status: host.economicAuthority.status(),
      events: first.events(command.opId), node: host.server.world.resources.nodes.get(node.id) })}`)), 5000))]); }
  catch (error) { release.resolve(); await host.economicAuthority.settle().catch(() => {}); throw error; }
  const raw = intercepted;
  const worldBefore = await base.loadWorld(RESOURCE_WORLD);
  const profilesBefore = new Map();
  for (const account of (secondActor ? [ACCOUNT_ONE, ACCOUNT_TWO] : [ACCOUNT_ONE])) profilesBefore.set(account, await base.loadProfile(account));
  const finish = async () => {
    release.resolve(); await host.economicAuthority.settle(); host.server.step();
    await host.close().catch(() => {});
  };
  return { base, f, raw, profilesBefore, worldBefore, finish };
}

async function unchanged(attempt, operationId = null) {
  const { base, profilesBefore, worldBefore, raw } = attempt;
  assert.deepEqual(await base.loadWorld(RESOURCE_WORLD), worldBefore);
  for (const [account, row] of profilesBefore) assert.deepEqual(await base.loadProfile(account), row);
  assert.equal(await base.loadEconomicOperation(operationId ?? raw.operationId), null);
}
async function denied(store, raw) {
  let result;
  try {
    result = await store.commitEconomicOperation(raw);
  } catch (error) {
    assert.ok(error instanceof StoreError, 'descriptor/schema failures may reject before the store transaction');
    return;
  }
  assert.equal(result.ok, false, 'invalid economic requests must be rejected');
}

test('valid cooperative final hit atomically commits the two contributor profiles and receipt', async t => {
  const a = await captureFinal(t);
  const result = await a.base.commitEconomicOperation(a.raw);
  assert.equal(result.ok, true);
  assert.equal(result.profiles.length, 2);
  assert.deepEqual(result.profiles.map(row => row.account), [ACCOUNT_ONE, ACCOUNT_TWO].sort());
  const saved = await a.base.loadEconomicOperation(a.raw.operationId);
  assert.ok(saved);
  assert.equal(saved.request.ack.count, 2);
  await a.finish();
});

test('memory contract rejects omitted contributors, fabricated practice, ACK count and cooldowns atomically', async t => {
  for (const mutate of [
    raw => { raw.request.beneficiaries = raw.request.beneficiaries.filter(row => row.account === ACCOUNT_ONE); },
    raw => { raw.request.beneficiaries.find(row => row.account === ACCOUNT_TWO).profile.progression.practice.logging += 1; },
    raw => { raw.request.ack.count = 1; },
    raw => { raw.request.ack.loggingStatus.practice = 999; },
    raw => { raw.request.worldData.resources.cooldowns[ACCOUNT_ONE] += 1; },
    raw => { raw.request.worldData.resources.cooldowns[ACCOUNT_TWO] = raw.request.worldData.resources.tick + 45; },
    raw => { raw.request.profile.eco.pack.goods.tronco = 999;
      raw.request.beneficiaries.find(row => row.account === ACCOUNT_ONE).profile.eco.pack.goods.tronco = 999; },
    raw => { raw.request.profile.gold++;
      raw.request.beneficiaries.find(row => row.account === ACCOUNT_ONE).profile.gold++; },
  ]) {
    const a = await captureFinal(t), candidate = copy(a.raw); mutate(candidate);
    try {
      await denied(a.base, candidate);
      await unchanged(a);
    } finally { await a.finish(); }
  }
});

test('reusing a committed cycle under a fresh operation ID cannot award it again', async t => {
  const a = await captureFinal(t);
  const first = await a.base.commitEconomicOperation(a.raw);
  assert.equal(first.ok, true);
  const replay = copy(a.raw); replay.operationId = economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, 'fresh-forged-cycle');
  const second = await a.base.commitEconomicOperation(replay);
  assert.deepEqual(second, { ok: false, why: 'conflict' });
  assert.deepEqual(await a.base.loadProfile(ACCOUNT_ONE), { data: a.raw.request.beneficiaries.find(r => r.account === ACCOUNT_ONE).profile,
    version: a.raw.request.beneficiaries.find(r => r.account === ACCOUNT_ONE).expectedVersion + 1 });
  assert.equal((await a.base.loadEconomicOperation(replay.operationId)), null);
  await a.finish();
});

test('one stale beneficiary CAS leaves every profile, world and receipt untouched', async t => {
  const a = await captureFinal(t);
  const updated = copy(a.profilesBefore.get(ACCOUNT_TWO).data); updated.gold++;
  const stale = await a.base.saveProfile(ACCOUNT_TWO, updated, a.profilesBefore.get(ACCOUNT_TWO).version);
  assert.equal(stale.ok, true);
  const afterExternal = await a.base.loadProfile(ACCOUNT_TWO);
  const result = await a.base.commitEconomicOperation(a.raw);
  assert.deepEqual(result, { ok: false, why: 'conflict' });
  assert.deepEqual(await a.base.loadProfile(ACCOUNT_ONE), a.profilesBefore.get(ACCOUNT_ONE));
  assert.deepEqual(await a.base.loadProfile(ACCOUNT_TWO), afterExternal);
  assert.deepEqual(await a.base.loadWorld(RESOURCE_WORLD), a.worldBefore);
  assert.equal(await a.base.loadEconomicOperation(a.raw.operationId), null);
  await a.finish();
});

test('legacy null-cycle deadline is rejected and omitted progress survives partial hits and denial', async t => {
  const invalid = { v: 2, tick: 0, nodes: [{ id: 'palm-x', kind: 'palm', rev: 4, hits: 3, readyAt: 0 }],
    cooldowns: {}, logging: { 'palm-x': null } };
  assert.throws(() => checkedResourceState(invalid), /world_format/);

  const a = await captureFinal(t, { secondActor: false, legacyActor: true });
  try {
    // The integration path separately exercises legacy omission; this assertion guards the profile DTO.
    const stored = await a.base.loadProfile(ACCOUNT_ONE);
    assert.equal(Object.hasOwn(stored.data, 'progression'), false);
    assert.equal(Object.hasOwn(liveProfile(a.f.host, ACCOUNT_ONE), 'progression'), false);
  } finally { await a.finish(); }
});

test('pilot v2 progression is preserved by the cooperative award and participant contract', async t => {
  const pilot = { v: 2, practice: { logging: 0 }, milestones: ['pilot_coastal'], knowledge: [] };
  const a = await captureFinal(t, { progressions: { [ACCOUNT_TWO]: pilot } });
  try {
    const result = await a.base.commitEconomicOperation(a.raw);
    assert.equal(result.ok, true);
    const saved = (await a.base.loadProfile(ACCOUNT_TWO)).data.progression;
    assert.equal(saved.v, 2);
    assert.deepEqual(saved.milestones, ['pilot_coastal']);
    assert.equal(saved.practice.logging, 3);
  } finally { await a.finish(); }
});
