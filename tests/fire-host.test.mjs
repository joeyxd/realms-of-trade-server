import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { MSG, ENT } from '../src/net/protocol.js';
import { ACCOUNT_ONE, connect, makeResourceHost, makeResourceStore, startResourceHost,
  turn, submitAndApply, copy } from './helpers/resource-authority-fixture.mjs';

const fireOptions = { fireOperations: true };
const hand = (op, opId, expectedRev, lit = false) => ({ type: 'fire', op, opId,
  ship: '', part: 'hand', kind: 'handTorch', expectedRev, lit });
const latestSnapshot = client => client.ws.messages.filter(message => message.t === MSG.SNAPSHOT).at(-1);

test('paid hand fuel is replay-safe, lit state is public, and simulation expiry clears the public flame', async t => {
  const { store, base } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { madera: 1 }, options: fireOptions });
  const { host, client } = f, entity = f.entity(), profile = host.server.world.profiles.get(entity);

  const guest = connect(host, 'guest'); guest.hello(); await Promise.all([...host.joins]);
  const guestEntity = host.server.clients.get(guest.id).entity, guestProfile = host.server.world.profiles.get(guestEntity);
  guest.send(hand('load', 'guest-fire-load', 0, true)); await turn();
  assert.equal(guest.events('guest-fire-load').at(-1)?.why, 'account_required');
  assert.equal(guestProfile.fire, undefined, 'unauthenticated session cannot create fuel state');

  const command = hand('load', 'paid-hand-fire', 0, true);
  const loaded = await submitAndApply(host, client, command);
  assert.equal(loaded?.ok, true, JSON.stringify(loaded));
  assert.equal(profile.eco.pack.goods.madera, undefined);
  assert.equal(profile.eco.tradeRev, 1);
  assert.deepEqual(profile.fire.slots.hand, { kind: 'handTorch', seconds: 1200,
    since: host.server.world.economy.hours * 40, lit: true });
  assert.equal(host.server.world.ecs.lantern[entity], 1);
  host.server.broadcastSnapshot();
  let snapshot = latestSnapshot(client);
  assert.equal(snapshot.fire.enabled, true);
  assert.equal(snapshot.fire.slots.find(slot => slot.key === 'hand')?.lit, true);
  assert.equal(snapshot.ents.find(row => row[ENT.ID] === entity)?.[ENT.LANTERN], 1);

  const receiptId = economicOperationId(host.worldState.id, `account:${ACCOUNT_ONE}`.replace('account:', ''), command.opId);
  const receipt = await base.loadEconomicOperation(receiptId);
  assert.ok(receipt); assert.deepEqual(receipt.request.command, command);
  assert.equal(receipt.request.before.eco.pack.goods.madera, 1);
  const profileAfterLoad = copy(profile);

  const replay = await submitAndApply(host, client, command);
  assert.equal(replay?.replay, true);
  assert.deepEqual(profile, profileAfterLoad, 'exact retry cannot debit wood twice or restore fuel later');
  const changedSameId = await submitAndApply(host, client, hand('load', command.opId, 0, false));
  assert.equal(changedSameId?.ok, false);
  assert.equal(changedSameId?.why, 'duplicate');
  assert.deepEqual(profile, profileAfterLoad);

  const changedId = await submitAndApply(host, client, hand('load', 'second-hand-load', 1, true));
  assert.equal(changedId?.ok, false);
  assert.equal(changedId?.why, 'occupied');
  assert.deepEqual(profile, profileAfterLoad, 'an occupied load attempt leaves profile and fuel unchanged');

  // Active simulation time, rather than wall time, burns the persistent paid unit.
  host.server.world.economy.advance(1200);
  host.server.broadcastSnapshot();
  snapshot = latestSnapshot(client);
  assert.deepEqual(snapshot.fire.slots.find(slot => slot.key === 'hand'),
    { key: 'hand', kind: 'handTorch', seconds: 0, lit: false });
  assert.equal(snapshot.ents.find(row => row[ENT.ID] === entity)?.[ENT.LANTERN], 0);

  client.ws.close(); await turn();
  const reconnected = connect(host); reconnected.hello(); await Promise.all([...host.joins]);
  const resumedEntity = host.server.clients.get(reconnected.id).entity;
  const resumed = host.server.world.profiles.get(resumedEntity);
  assert.equal(resumed.eco.pack.goods.madera, undefined);
  assert.equal(resumed.fire.rev, 2, 'disconnect settles the hand fire into the persisted exhausted state');
  assert.equal(resumed.fire.slots.hand.seconds, 0, 'reconnect cannot turn off and refund elapsed fuel');
  assert.equal(resumed.fire.slots.hand.lit, false);
  host.server.broadcastSnapshot();
  const resumedSnapshot = latestSnapshot(reconnected);
  assert.equal(resumedSnapshot.fire.slots.find(slot => slot.key === 'hand')?.seconds, 0);
  assert.equal(resumedSnapshot.ents.find(row => row[ENT.ID] === resumedEntity)?.[ENT.LANTERN], 0);
});

test('no wood denies fuel without changing profile, and missing fire readiness blocks host startup', async t => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { options: fireOptions });
  const { host, client } = f, profile = host.server.world.profiles.get(f.entity()), before = copy(profile);
  const denied = await submitAndApply(host, client, hand('load', 'no-wood-fire', 0, true));
  assert.equal(denied?.ok, false); assert.equal(denied?.why, 'goods');
  assert.deepEqual(profile, before, 'failed debit does not leave a lit slot, revision, or hidden profile change');

  const missingStore = { ...createMemoryStore(), checkFireOperations: undefined };
  await missingStore.initializeProfile(ACCOUNT_ONE, profile);
  const missingHost = makeResourceHost(missingStore, async () => ACCOUNT_ONE, fireOptions);
  t.after(async () => {
    if (!missingHost.closePromise) {
      try { await missingHost.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    }
  });
  await assert.rejects(missingHost.prepare(), error => error.code === 'configuration');
});
