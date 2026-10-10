import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORLD_ID = 'economic-raft-test';
const turn = () => new Promise(resolve => setImmediate(resolve));
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

function connect(host) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Raft buyer' })), false);
  const send = command => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false);
  return { id, ws, hello, send,
    events: opId => ws.messages.filter(m => m.t === MSG.EVENT && m.ev?.opId === opId).map(m => m.ev),
    eventType: type => ws.messages.filter(m => m.t === MSG.EVENT && m.ev?.type === type).map(m => m.ev) };
}

function profileFixture() {
  const profile = newProfile();
  profile.gold = 10_000;
  profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.pack.goods = {};
  return profile;
}

async function fixture(t, { store = createMemoryStore() } = {}) {
  const initial = profileFixture();
  await store.initializeProfile(ACCOUNT, initial);
  const host = new GameHost({ seed: 71, bots: 0, log: () => {}, store, saves: hmacSaves('test-key'),
    resolvePlayer: async () => ACCOUNT, initializeAccounts: true, worldId: WORLD_ID,
    economicOperations: true, communityRequirements: { madera: 4, piedra: 2 } });
  t.after(async () => {
    if (!host.closePromise) {
      try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    }
  });
  await host.prepare();
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  assert.equal(client.ws.messages.filter(message => message.t === MSG.WELCOME).length, 1);
  const entity = host.server.clients.get(client.id).entity;
  const profile = host.server.world.profiles.get(entity);
  const ship = profile.eco.ships.find(item => item.kind === 'raft');
  const raft = host.server.world.rafts.get(ship.id);
  assert.ok(raft, 'trusted account raft is registered in the prepared world');
  assert.equal(ship.at, 'aldea', 'starter raft is moored at the supply market');
  standOnRaft(host, entity, raft);
  return { host, store, client, entity, profile, ship, raft, initial };
}

function standOnRaft(host, entity, raft) {
  const world = host.server.world, ecs = world.ecs;
  const angle = ecs.facing[raft.entity], c = Math.cos(angle), s = Math.sin(angle);
  ecs.x[entity] = ecs.x[raft.entity] + c + s;
  ecs.z[entity] = ecs.z[raft.entity] - s + c;
  ecs.y[entity] = ecs.y[raft.entity];
  ecs.regenT[entity] = 100;
  ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

async function submitAndApply(host, client, command) {
  client.send(command); await turn(); await host.economicAuthority.settle(); host.server.step();
  return client.events(command.opId).at(-1);
}

function ownedSnapshot(profile, ship, world, good = 'madera') {
  return { gold: profile.gold, pack: copy(profile.eco.pack), hold: copy(ship.hold), shipRev: ship.rev,
    marketStock: world.economy.markets.aldea.stock[good] };
}

test('raft supply commits wallet, hold/pack cargo, ship revision, and market stock as one replayable receipt', async t => {
  const { host, store, client, entity, profile, ship, raft } = await fixture(t);
  standOnRaft(host, entity, raft);
  const world = host.server.world;
  const before = ownedSnapshot(profile, ship, world), quote = world.economy.quote('aldea', 'madera', 4, 'buy');
  assert.equal(quote.ok, true);
  const command = { type: 'raft', op: 'supply', id: ship.id, expectedRev: ship.rev,
    g: 'madera', n: 4, opId: 'raft-supply-four' };
  const bought = await submitAndApply(host, client, command);
  assert.equal(bought?.type, 'raftEdit');
  assert.equal(bought?.ok, true);
  assert.equal(bought?.g, 'madera'); assert.equal(bought?.n, 4); assert.equal(bought?.total, quote.total);
  assert.equal(profile.gold, before.gold - quote.total);
  assert.ok((ship.hold.goods.madera ?? 0) > 0, 'the raft hold receives the available first share');
  assert.ok((profile.eco.pack.goods.madera ?? 0) > 0, 'the remainder is kept in the same account pack');
  assert.equal((ship.hold.goods.madera ?? 0) + (profile.eco.pack.goods.madera ?? 0), 4);
  assert.equal(ship.rev, before.shipRev + 1);
  assert.equal(world.economy.markets.aldea.stock.madera, before.marketStock - 4);

  const receiptId = economicOperationId(WORLD_ID, ACCOUNT, command.opId);
  const receipt = await store.loadEconomicOperation(receiptId);
  assert.ok(receipt, 'wallet, goods, market, and revision change share a durable operation receipt');
  assert.equal(receipt.request.command.type, 'raft');
  assert.equal(receipt.request.command.op, 'supply');
  assert.deepEqual(receipt.request.command, { type: 'raft', op: 'supply', opId: command.opId,
    id: ship.id, expectedRev: before.shipRev, g: 'madera', n: 4 });

  const afterFirst = ownedSnapshot(profile, ship, world);
  const nextQuote = world.economy.quote('aldea', 'madera', 1, 'buy');
  assert.equal(nextQuote.ok, true);
  const next = await submitAndApply(host, client, { type: 'raft', op: 'supply', id: ship.id,
    expectedRev: ship.rev, g: 'madera', n: 1, opId: 'raft-supply-next' });
  assert.equal(next?.ok, true);
  const afterNext = ownedSnapshot(profile, ship, world);

  const replay = await submitAndApply(host, client, command);
  assert.equal(replay?.ok, true); assert.equal(replay.replay, true); assert.equal(replay.historical, true);
  assert.deepEqual(ownedSnapshot(profile, ship, world), afterNext,
    'historical retry cannot charge gold, add cargo, bump raft revision, or restore market stock');
  assert.notDeepEqual(afterFirst, afterNext, 'a newer supply operation makes the old retry historical');
  assert.equal((await store.loadEconomicOperation(receiptId)).result.ack.total, quote.total);
});

test('held raft supply stays unapplied until receipt, lost response recovers, and legacy market mutation is denied', async t => {
  const base = createMemoryStore(), gate = deferred(), entered = deferred();
  let loseReply = true, commitEntered = false;
  const store = { ...base, async commitEconomicOperation(input) {
    commitEntered = true;
    entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(input);
    if (loseReply) { loseReply = false; throw new Error('injected raft supply response loss'); }
    return result;
  } };
  const { host, client, entity, profile, ship, raft } = await fixture(t, { store });
  standOnRaft(host, entity, raft);
  const world = host.server.world, before = ownedSnapshot(profile, ship, world, 'hierro'), tick = world.tick;
  const quote = world.economy.quote('aldea', 'hierro', 1, 'buy');
  assert.equal(quote.ok, true);
  const command = { type: 'raft', op: 'supply', id: ship.id, expectedRev: ship.rev,
    g: 'hierro', n: 1, opId: 'held-raft-supply' };
  client.send(command);
  await Promise.race([entered.promise, new Promise(resolve => setTimeout(resolve, 1000))]);
  assert.equal(commitEntered, true, `valid raft supply reaches storage; events=${JSON.stringify(client.events(command.opId))}`);
  try {
    assert.equal(host.economicAuthority.status().pending, 1);
    assert.equal(client.events(command.opId).length, 0, 'no acknowledgement can precede the atomic result');
    assert.deepEqual(ownedSnapshot(profile, ship, world, 'hierro'), before, 'wallet, pack, hold, revision, and stock stay untouched while held');
    const baseline = await base.loadProfile(ACCOUNT);
    assert.deepEqual(baseline.data.gold, before.gold);
    assert.equal(await base.loadEconomicOperation(economicOperationId(WORLD_ID, ACCOUNT, command.opId)), null);

    client.send({ type: 'market', op: 'buy', opId: 'legacy-market-bypass', town: 'aldea', g: 'hierro', n: 1, expectedTotal: quote.total });
    await turn();
    assert.equal(client.eventType('tradeDenied').at(-1)?.why, 'command', 'legacy market mutation remains explicitly denied');
    assert.deepEqual(ownedSnapshot(profile, ship, world, 'hierro'), before);
    assert.equal(await base.loadEconomicOperation(economicOperationId(WORLD_ID, ACCOUNT, 'legacy-market-bypass')), null);

    host.server.step();
    assert.equal(world.tick, tick, 'world tick remains held while the supply result is uncertain');
    gate.resolve(); await host.economicAuthority.settle();
    assert.equal(host.economicAuthority.failed, false, 'receipt lookup recovers the lost commit response');
    assert.equal(client.events(command.opId).length, 0, 'provider continuation does not publish outside the tick boundary');
    host.server.step();
    const ack = client.events(command.opId).at(-1);
    assert.equal(ack?.ok, true); assert.equal(ack?.type, 'raftEdit');
    assert.equal(profile.gold, before.gold - quote.total);
    assert.equal((ship.hold.goods.hierro ?? 0) + (profile.eco.pack.goods.hierro ?? 0), 1);
    assert.equal(ship.rev, before.shipRev + 1);
    assert.equal(world.economy.markets.aldea.stock.hierro, before.marketStock - 1);
    assert.ok(await base.loadEconomicOperation(economicOperationId(WORLD_ID, ACCOUNT, command.opId)));
  } finally {
    gate.resolve();
    await host.economicAuthority.settle();
  }
});
