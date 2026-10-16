import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { TOWNS } from '../src/data/towns.js';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const copy = (value) => structuredClone(value);

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState !== 1) return; this.readyState = 3; this.code = code; this.emit('close'); }
  ping() {}
}

function connect(host, name = 'Economic tester') {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name })), false);
  const send = (command) => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false);
  const of = (type) => ws.messages.filter((m) => m.t === type);
  return { id, ws, hello, send, of, events: (opId) => ws.messages.filter((m) => m.t === MSG.EVENT && m.ev?.opId === opId).map((m) => m.ev) };
}

function accountProfile({ gold = 1000, goods = {} } = {}) {
  const p = newProfile(); p.gold = gold; p.pirateId = `account:${ACCOUNT}`;
  p.eco.pack.goods = { ...goods }; return p;
}

function makeHost(store, resolvePlayer = async () => ACCOUNT) {
  return new GameHost({ seed: 71, bots: 0, log: () => {}, store, saves: hmacSaves('test-key'),
    resolvePlayer, initializeAccounts: true, worldId: 'economic-test', economicOperations: true,
    communityRequirements: { madera: 4, piedra: 2 } });
}

async function fixture(t, { goods = {}, gold = 1000, store: suppliedStore, resolvePlayer = async () => ACCOUNT } = {}) {
  const store = suppliedStore || createMemoryStore();
  const initial = accountProfile({ goods, gold });
  await store.initializeProfile(ACCOUNT, initial);
  const h = makeHost(store, resolvePlayer);
  t.after(async () => { if (!h.closePromise) { try { await h.close(); } catch (error) { if (error.code !== 'flush') throw error; } } });
  await h.prepare();
  const c = connect(h); c.hello(); await Promise.all([...h.joins]);
  assert.equal(c.of(MSG.WELCOME).length, 1, 'trusted account joins the prepared world');
  const entity = h.server.clients.get(c.id).entity;
  return { h, store, c, entity, initial };
}

function calmAt(host, entity, point) {
  const world = host.server.world, ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = Number.isFinite(point.y) ? point.y : world.map.groundAt(point.x, point.z);
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

async function submitAndApply(h, c, command) {
  c.send(command); await turn(); await h.economicAuthority.settle(); h.server.step();
  return c.events(command.opId).at(-1);
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await turn(); }
  assert.fail(message);
}

const marketPoint = (world) => {
  const town = TOWNS.aldea, p = world.map.landmarks[town.landmark] || world.map[town.landmark];
  return p;
};

test('deferred response-lost commit has no precommit acknowledgement or mutation; tick and legacy mutation paths wait', async (t) => {
  const base = createMemoryStore(), gate = deferred(), entered = deferred(); let responseLost = false;
  const store = { ...base, async commitEconomicOperation(input) {
    entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(input);
    if (!responseLost) { responseLost = true; throw new Error('injected lost commit response'); }
    return result;
  } };
  const { h, c, entity } = await fixture(t, { goods: { fruta: 2 }, store });
  calmAt(h, entity, marketPoint(h.server.world));
  const world = h.server.world, profile = world.profiles.get(entity), beforeProfile = copy(profile), beforeEconomy = copy(world.economy.serialize()), tick = world.tick;
  const quote = world.economy.quote('aldea', 'fruta', 1, 'buy');
  const buy = { type: 'commerce', op: 'buy', opId: 'held-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote.total };
  c.send(buy); await entered.promise;
  assert.equal(h.economicAuthority.status().pending, 1);
  assert.equal(h.worldState.operationBusy, true);
  assert.equal(c.events('held-buy').length, 0, 'a provider continuation cannot publish before the durable result is applied');
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(world.economy.serialize(), beforeEconomy);
  assert.deepEqual((await h.store.loadProfile(ACCOUNT)).data, profile, 'the baseline remains the live profile while the candidate commit is held');
  h.server.step();
  assert.equal(world.tick, tick, 'the simulation tick is held behind the async commit');
  c.send({ type: 'resource', op: 'craft', recipe: 'madera', expectedRev: profile.eco.tradeRev, opId: 'bypass-craft' });
  c.send({ type: 'dev', op: 'gold', n: 999 });
  await turn(); h.server.step();
  assert.equal(profile.gold, beforeProfile.gold, 'ordinary/dev profile mutations cannot bypass the economic gate');
  assert.equal(c.events('held-buy').length, 0);
  gate.resolve(); await h.economicAuthority.settle();
  assert.equal(h.economicAuthority.failed, false, 'receipt recovery leaves the economic authority usable');
  assert.equal(c.events('held-buy').length, 0, 'settlement alone does not publish outside the simulation boundary');
  h.server.step();
  const ack = c.events('held-buy').at(-1);
  assert.ok(ack, 'economic result is published at the next tick boundary');
  assert.equal(ack.ok, true); assert.equal(ack.durable, false, 'the explicit memory test store is not represented as durable');
  assert.equal(profile.eco.pack.goods.fruta, 3);
  assert.equal(h.worldState.operationBusy, false);
  assert.equal((await h.store.loadProfile(ACCOUNT)).version, 3, 'join baseline and atomic economic receipt each advance the profile row');
});

test('commerce buy/sell/cargo and community contribution use one profile, exact receipts, and capped conservation', async (t) => {
  const { h, c, entity, store } = await fixture(t, { goods: { fruta: 1 } });
  const w = h.server.world, profile = w.profiles.get(entity);
  calmAt(h, entity, marketPoint(w));
  const buyQuote = w.economy.quote('aldea', 'fruta', 1, 'buy');
  const bought = await submitAndApply(h, c, { type: 'commerce', op: 'buy', opId: 'buy-one', town: 'aldea', g: 'fruta', n: 1, expectedTotal: buyQuote.total });
  assert.equal(bought?.ok, true); assert.equal(profile.eco.pack.goods.fruta, 2);
  const stockAfterBuy = w.economy.markets.aldea.stock.fruta, profileAfterBuy = copy(profile);
  const sellQuote = w.economy.quote('aldea', 'fruta', 1, 'sell');
  const sold = await submitAndApply(h, c, { type: 'commerce', op: 'sell', opId: 'sell-one', town: 'aldea', g: 'fruta', n: 1, expectedTotal: sellQuote.total });
  assert.equal(sold?.ok, true); assert.equal(profile.eco.pack.goods.fruta, 1); assert.ok(profile.gold > profileAfterBuy.gold);
  assert.notEqual(w.economy.markets.aldea.stock.fruta, stockAfterBuy);

  const ship = profile.eco.ships.find((s) => s.kind === 'raft'), active = w.rafts.get(ship.id);
  assert.ok(active, 'trusted profile raft is attached once to the same account entity');
  const ecs = w.ecs, r = active.entity, cos = Math.cos(ecs.facing[r]), sin = Math.sin(ecs.facing[r]);
  calmAt(h, entity, { x: ecs.x[r] + cos + sin, z: ecs.z[r] - sin + cos, y: ecs.y[r] });
  const transfer = await submitAndApply(h, c, { type: 'commerce', op: 'transfer', opId: 'cargo-fruit', id: ship.id,
    expectedRev: ship.rev, g: 'fruta', n: 1, side: 'deposit' });
  assert.equal(transfer?.ok, true); assert.equal(profile.eco.pack.goods.fruta, undefined); assert.equal(ship.hold.goods.fruta, 1);
  assert.equal((profile.eco.pack.goods.fruta ?? 0) + ship.hold.goods.fruta, 1, 'cargo transfer conserves owned goods');

  const bench = w.resources.bench; assert.ok(bench, 'the deterministic world provides its carpentry bench'); calmAt(h, entity, bench);
  const projectId = 'salty-shore-carpentry';
  profile.eco.pack.goods = { madera: 3 };
  h.profiles.save(c.id, profile); await h.profiles.flush();
  const contribution = await submitAndApply(h, c, { type: 'community', op: 'contribute', opId: 'project-wood', projectId,
    good: 'madera', amount: 3, expectedRev: h.worldState.community.project.version });
  assert.equal(contribution?.ok, true); assert.equal(contribution.accepted, 3);
  assert.equal(h.worldState.community.project.contributed.madera, 3);
  assert.equal(profile.eco.pack.goods.madera, undefined);
  assert.equal((profile.eco.pack.goods.madera ?? 0) + h.worldState.community.project.contributed.madera, 3,
    'contribution consumes exactly the accepted amount');

  profile.eco.pack.goods = { madera: 1 };
  h.profiles.save(c.id, profile); await h.profiles.flush();
  const finalWood = await submitAndApply(h, c, { type: 'community', op: 'contribute', opId: 'project-wood-last', projectId,
    good: 'madera', amount: 9, expectedRev: h.worldState.community.project.version });
  assert.equal(finalWood?.ok, true); assert.equal(finalWood.accepted, 1, 'accepted amount is capped at the single unit remaining');
  assert.equal(h.worldState.community.project.contributed.madera, 4);

  profile.eco.pack.goods = { piedra: 2 };
  h.profiles.save(c.id, profile); await h.profiles.flush();
  const stone = await submitAndApply(h, c, { type: 'community', op: 'contribute', opId: 'project-stone', projectId,
    good: 'piedra', amount: 3, expectedRev: h.worldState.community.project.version });
  assert.equal(stone?.ok, true); assert.equal(stone.accepted, 2);
  assert.equal(profile.eco.pack.goods.piedra, undefined); assert.equal(h.worldState.community.project.contributed.piedra, 2);
  const latestVersion = profile.eco.tradeRev, latestGoods = copy(profile.eco.pack.goods), latestWorld = copy(h.worldState.community);

  const replay = await submitAndApply(h, c, { type: 'community', op: 'contribute', opId: 'project-wood', projectId,
    good: 'madera', amount: 3, expectedRev: 1 });
  assert.equal(replay?.ok, true); assert.equal(replay.replay, true); assert.equal(replay.historical, true);
  assert.equal(profile.eco.tradeRev, latestVersion); assert.deepEqual(profile.eco.pack.goods, latestGoods);
  assert.deepEqual(h.worldState.community, latestWorld, 'old receipts never roll back newer profile or project progress');
  assert.equal((await store.loadEconomicOperation(economicOperationId('economic-test', ACCOUNT, 'project-wood'))).result.ack.accepted, 3);

  const altered = await submitAndApply(h, c, { type: 'community', op: 'contribute', opId: 'project-wood', projectId,
    good: 'piedra', amount: 1, expectedRev: h.worldState.community.project.version });
  assert.equal(altered?.ok, false); assert.equal(altered.why, 'duplicate', 'same operation id cannot be rebound to another request');
  assert.deepEqual(profile.eco.pack.goods, latestGoods); assert.deepEqual(h.worldState.community, latestWorld);
  assert.equal(h.worldState.community.project.version, 4);
});

test('same pending submit is idempotent; guest cannot mutate; disconnect during blocked commit is finalized by close', async (t) => {
  const base = createMemoryStore(), gate = deferred(), entered = deferred();
  const store = { ...base, async commitEconomicOperation(input) { entered.resolve(); await gate.promise; return base.commitEconomicOperation(input); } };
  const { h, c, entity } = await fixture(t, { goods: { fruta: 1 }, store,
    resolvePlayer: async (_request, hello) => hello.name === 'guest' ? null : ACCOUNT });
  calmAt(h, entity, marketPoint(h.server.world));
  const quote = h.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  const command = { type: 'commerce', op: 'buy', opId: 'double-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote.total };
  c.send(command); await entered.promise; c.send(command); await turn();
  assert.equal(c.events('double-buy').length, 0);
  const admission = new Socket(); h.onConnection(admission, { headers: {}, socket: { remoteAddress: 'test' } });
  assert.equal(admission.readyState, 3, 'a second socket is refused while the shared world commit is unresolved');
  assert.equal(h.sockets.size, 1);
  gate.resolve(); await h.economicAuthority.settle(); h.server.step();
  assert.equal(c.events('double-buy').length, 1); assert.equal(c.events('double-buy')[0].ok, true);

  const guest = connect(h, 'guest'); guest.hello(); await Promise.all([...h.joins]);
  assert.equal(guest.of(MSG.WELCOME).length, 1);
  guest.send({ type: 'community', op: 'contribute', opId: 'guest-project', projectId: 'salty-shore-carpentry', good: 'madera', amount: 1, expectedRev: 1 });
  await turn();
  assert.equal(guest.events('guest-project').at(-1)?.why, 'account_required');

  const secondGate = deferred(), secondEntered = deferred();
  store.commitEconomicOperation = async (input) => { secondEntered.resolve(); await secondGate.promise; return base.commitEconomicOperation(input); };
  calmAt(h, entity, marketPoint(h.server.world));
  const quote2 = h.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  c.send({ type: 'commerce', op: 'buy', opId: 'close-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote2.total });
  await secondEntered.promise;
  c.ws.close();
  const closing = h.close(); await turn();
  secondGate.resolve(); await closing;
  assert.equal(h.sockets.size, 0); assert.equal(h.economicAuthority.status().pending, 0);
  assert.equal((await base.loadEconomicOperation(economicOperationId('economic-test', ACCOUNT, 'close-buy')))?.result.ok, true,
    'shutdown settles and applies the atomic receipt before the final profile/world flush');
  assert.equal(c.events('close-buy').length, 0, 'closed transport receives no delayed acknowledgement');
});

test('same-store host restart preserves community and replays prior commerce/contribution receipts without rollback', async (t) => {
  const store = createMemoryStore(), starting = accountProfile({ goods: { madera: 3, fruta: 1 } });
  await store.initializeProfile(ACCOUNT, starting);
  const hosts = [];
  t.after(async () => { for (const host of hosts) if (!host.closePromise) {
    try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
  } });
  const first = makeHost(store); hosts.push(first); await first.prepare();
  const c1 = connect(first); c1.hello(); await Promise.all([...first.joins]);
  const entity1 = first.server.clients.get(c1.id).entity, world1 = first.server.world;
  calmAt(first, entity1, marketPoint(world1));
  const sellQuote = world1.economy.quote('aldea', 'fruta', 1, 'sell');
  const sell = { type: 'commerce', op: 'sell', opId: 'restart-sell', town: 'aldea', g: 'fruta', n: 1, expectedTotal: sellQuote.total };
  const sellAck = await submitAndApply(first, c1, sell); assert.equal(sellAck?.ok, true);
  const buyQuote = world1.economy.quote('aldea', 'tabaco', 1, 'buy');
  const buy = { type: 'commerce', op: 'buy', opId: 'restart-buy', town: 'aldea', g: 'tabaco', n: 1, expectedTotal: buyQuote.total };
  const buyAck = await submitAndApply(first, c1, buy); assert.equal(buyAck?.ok, true);
  calmAt(first, entity1, world1.resources.bench);
  const contribute = { type: 'community', op: 'contribute', opId: 'restart-project', projectId: 'salty-shore-carpentry',
    good: 'madera', amount: 2, expectedRev: first.worldState.community.project.version };
  const contributionAck = await submitAndApply(first, c1, contribute); assert.equal(contributionAck?.ok, true);
  const persistedProfile = await store.loadProfile(ACCOUNT), persistedCommunity = copy(first.worldState.community);
  assert.equal(persistedCommunity.project.contributed.madera, 2);
  c1.ws.close(); await first.close();

  const second = makeHost(store); hosts.push(second); await second.prepare();
  assert.deepEqual(second.worldState.community, persistedCommunity, 'the new authority loads the community projection from the same world row');
  const c2 = connect(second); c2.hello(); await Promise.all([...second.joins]);
  const entity2 = second.server.clients.get(c2.id).entity, profile2 = second.server.world.profiles.get(entity2);
  assert.deepEqual(await store.loadProfile(ACCOUNT), persistedProfile);
  const durableMarketsBefore = copy(second.server.world.economy.serialize().markets), profileBefore = copy(profile2), projectBefore = copy(second.worldState.community);
  calmAt(second, entity2, marketPoint(second.server.world));
  for (const command of [sell, buy]) {
    const replay = await submitAndApply(second, c2, command);
    assert.equal(replay?.ok, true); assert.equal(replay.replay, true); assert.equal(replay.historical, true);
  }
  calmAt(second, entity2, second.server.world.resources.bench);
  const replayContribution = await submitAndApply(second, c2, contribute);
  assert.equal(replayContribution?.ok, true); assert.equal(replayContribution.replay, true);
  assert.deepEqual(profile2.gold, profileBefore.gold); assert.deepEqual(profile2.eco.pack, profileBefore.eco.pack);
  assert.deepEqual(second.server.world.economy.serialize().markets, durableMarketsBefore, 'historical replay does not debit or restock a second time');
  assert.deepEqual(second.worldState.community, projectBefore, 'historical contribution does not increment progress twice');

  const alteredBuy = await submitAndApply(second, c2, { ...buy, n: 2, expectedTotal: 0 });
  assert.equal(alteredBuy?.ok, false); assert.equal(alteredBuy.why, 'duplicate');
  const alteredContribution = await submitAndApply(second, c2, { ...contribute, good: 'piedra', amount: 1 });
  assert.equal(alteredContribution?.ok, false); assert.equal(alteredContribution.why, 'duplicate');
  assert.deepEqual(profile2.gold, profileBefore.gold); assert.deepEqual(profile2.eco.pack, profileBefore.eco.pack);
  assert.deepEqual(second.server.world.economy.serialize().markets, durableMarketsBefore);
  assert.deepEqual(second.worldState.community, projectBefore);
});

test('paused and malformed economic commands are denied without a receipt or authority fence', async (t) => {
  const { h, c, entity, store } = await fixture(t, { goods: { fruta: 1 } });
  const world = h.server.world, profile = world.profiles.get(entity), before = copy(profile), markets = copy(world.economy.serialize().markets);
  calmAt(h, entity, marketPoint(world));
  h.server.clients.get(c.id).paused = true;
  const quote = world.economy.quote('aldea', 'fruta', 1, 'buy');
  c.send({ type: 'commerce', op: 'buy', opId: 'paused-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote.total });
  await turn(); await h.economicAuthority.settle(); h.server.step();
  const paused = c.events('paused-buy').at(-1);
  assert.equal(paused?.ok, false); assert.equal(paused?.why, 'busy');
  assert.equal(await store.loadEconomicOperation(economicOperationId('economic-test', ACCOUNT, 'paused-buy')), null);
  h.server.clients.get(c.id).paused = false;

  c.send({ type: 'community', op: 'contribute', projectId: 'salty-shore-carpentry', good: 'madera', amount: 1, expectedRev: 1 });
  c.send({ type: 'community', op: 'contribute', opId: 7, projectId: 'salty-shore-carpentry', good: 'madera', amount: 1, expectedRev: 1 });
  await turn();
  const invalid = c.ws.messages.filter((m) => m.t === MSG.EVENT && m.ev?.type === 'community' && m.ev.why === 'command');
  assert.equal(invalid.length, 2, 'missing and non-string operation IDs are both explicitly rejected');
  assert.equal(h.economicAuthority.failed, false); assert.equal(h.economicAuthority.busy, false);
  assert.deepEqual(profile.eco, before.eco); assert.deepEqual(world.economy.serialize().markets, markets);
  assert.equal(h.worldState.community.project.contributed.madera, 0);
});

test('ambiguous failed commit fences the host rather than reopening mutations', async (t) => {
  const base = createMemoryStore();
  const store = { ...base,
    async commitEconomicOperation() { throw new Error('injected uncertainty'); },
    async loadEconomicOperation(id) { if (id === '00000000-0000-4000-8000-000000000014') return base.loadEconomicOperation(id); throw new Error('injected receipt read failure'); } };
  const { h, c, entity } = await fixture(t, { goods: { fruta: 1 }, store });
  calmAt(h, entity, marketPoint(h.server.world));
  const quote = h.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  c.send({ type: 'commerce', op: 'buy', opId: 'uncertain-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote.total });
  await waitFor(() => h.economicAuthority.failed, 'ambiguous commit/read failure must fence the authority');
  assert.equal(h.worldState.failed, true);
  assert.equal(h.economicAuthority.status().pending, 1, 'uncertain intent remains represented as pending evidence');
  assert.equal(c.events('uncertain-buy').length, 0);
  const tick = h.server.world.tick; h.server.step();
  assert.equal(h.server.world.tick, tick, 'fenced authority cannot resume world ticks');
  assert.equal(h.healthy(), false);
  await assert.rejects(h.close(), (error) => error?.code === 'flush');
});
