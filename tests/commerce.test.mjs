import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { MAX_SAVE } from '../src/net/saves.js';
import { hmacSaves } from '../server/saves.mjs';
import { load, holdUsed } from '../src/sim/economy/cargo.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { townAt } from '../src/sim/systems/trade.js';
import { TOWNS } from '../src/data/towns.js';

const copy = (v) => JSON.parse(JSON.stringify(v));

function makeServer(options = {}) {
  const messages = new Map(), saves = new Map();
  const server = new LocalServer({ seed: 71, bots: 0, enemies: false,
    send: (id, msg) => { if (!messages.has(id)) messages.set(id, []); messages.get(id).push(copy(msg)); },
    onSave: (id, profile) => saves.set(id, copy(profile)), ...options });
  return { server, messages, saves };
}

function profileFixture({ gold = 1000, pack = {} } = {}) {
  const p = newProfile({ starter: false }); p.gold = gold; p.eco.tradeRev = 0;
  p.eco.pack.goods = { ...pack };
  return p;
}

function join(server, id, profile = profileFixture()) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Trader ${id}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, `trusted fixture ${id} joined`);
  return entity;
}

function ownRaft(server, e) {
  const profile = server.world.profiles.get(e);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  const active = server.world.rafts.get(ship.id);
  assert.ok(active && active.owner === e);
  return { profile, ship, active, public: publicRafts(server.world).find((r) => r.id === ship.id) };
}

function standInTown(server, e, town = 'aldea') {
  const T = TOWNS[town], point = server.world.map.landmarks[T.landmark] || server.world.map[T.landmark];
  assert.ok(point && T.walkable);
  const ecs = server.world.ecs;
  ecs.x[e] = point.x; ecs.y[e] = server.world.map.groundAt(point.x, point.z); ecs.z[e] = point.z;
  calm(server, e);
  assert.equal(townAt(server.world, e), town);
}

function standOnRaft(server, e, active, lx = 1, lz = 1) {
  const ecs = server.world.ecs, r = active.entity, c = Math.cos(ecs.facing[r]), s = Math.sin(ecs.facing[r]);
  ecs.x[e] = ecs.x[r] + c * lx + s * lz; ecs.z[e] = ecs.z[r] - s * lx + c * lz; ecs.y[e] = ecs.y[r];
  calm(server, e);
}

function calm(server, e) {
  const ecs = server.world.ecs;
  ecs.regenT[e] = 100; ecs.moveMag[e] = 0; ecs.vx[e] = 0; ecs.vz[e] = 0;
}

function command(server, id, fields) {
  server.receive(id, { t: MSG.CMD, type: 'commerce', ...fields }); server.flushEvents();
}

function replies(messages, id) {
  return (messages.get(id) || []).filter((m) => m.t === MSG.EVENT && m.ev?.type === 'commerce').map((m) => m.ev);
}

function lastReply(messages, id, opId) {
  return replies(messages, id).slice().reverse().find((ev) => ev.opId === opId) || null;
}

function mutateState(profile, ship, world, town = 'aldea', g = 'fruta') {
  return { gold: profile.gold, pack: copy(profile.eco.pack), tradeRev: profile.eco.tradeRev,
    hold: copy(ship.hold), shipRev: ship.rev, stock: world.economy.markets[town].stock[g],
    last: world.economy.markets[town].last[g] };
}

test('commerce reads are private, current, non-mutating, and reject malformed payloads strictly', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 1), other = join(server, 2);
  standInTown(server, owner);
  const { profile, ship } = ownRaft(server, owner), initial = mutateState(profile, ship, server.world);

  command(server, 1, { op: 'list', town: 'aldea', opId: 'list-1' });
  const listed = lastReply(messages, 1, 'list-1');
  assert.ok(listed?.ok); assert.equal(listed.town, 'aldea');
  assert.ok(listed.rows.some((row) => row.g === 'fruta'));
  assert.deepEqual(listed.pack, profile.eco.pack, 'the owner receives their pack view');
  assert.equal(replies(messages, 2).length, 0, 'another player receives no private commerce event');

  const quoteData = { op: 'quote', town: 'aldea', g: 'fruta', n: 3, side: 'buy', opId: 'quote-1' };
  command(server, 1, quoteData);
  const quoted = lastReply(messages, 1, quoteData.opId), expected = server.world.economy.quote('aldea', 'fruta', 3, 'buy');
  assert.ok(quoted?.ok); assert.equal(quoted.total, expected.total); assert.equal(quoted.rev, initial.tradeRev);
  assert.deepEqual(mutateState(profile, ship, server.world), initial, 'listing and quoting do not debit balances, stock, or revisions');

  for (const [suffix, fields, why] of [
    ['fractional', { op: 'quote', town: 'aldea', g: 'fruta', n: 1.5, side: 'buy' }, 'command'],
    ['string-qty', { op: 'quote', town: 'aldea', g: 'fruta', n: '2', side: 'buy' }, 'command'],
    ['too-large', { op: 'quote', town: 'aldea', g: 'fruta', n: 501, side: 'buy' }, 'command'],
    ['unexpected-price', { op: 'buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: 1, price: 1 }, 'command'],
    ['unexpected-field', { op: 'list', town: 'aldea', debug: true }, 'command'],
    ['constructor-op', { op: 'constructor' }, 'command'],
    ['proto-op', { op: '__proto__' }, 'command'],
    ['constructor-town', { op: 'list', town: 'constructor' }, 'far'],
    ['constructor-good', { op: 'quote', town: 'aldea', g: 'constructor', n: 1, side: 'buy' }, 'command'],
    ['bad-town', { op: 'list', town: 'unknown' }, 'far'],
  ]) {
    const opId = `malformed-${suffix}`; command(server, 1, { ...fields, opId });
    const refused = lastReply(messages, 1, opId);
    assert.ok(refused); assert.equal(refused.ok, false); assert.equal(refused.why, why, suffix);
    assert.deepEqual(mutateState(profile, ship, server.world), initial, `${suffix} does not mutate state`);
  }
  standInTown(server, owner, 'cala');
  const away = { op: 'quote', town: 'aldea', g: 'fruta', n: 1, side: 'buy', opId: 'wrong-walkable-town' };
  command(server, 1, away);
  assert.equal(lastReply(messages, 1, away.opId)?.why, 'far');
  assert.equal(replies(messages, 2).length, 0);
});

test('market buys and sells use the shared live quote, conserve pack/gold/stock, and deduplicate operation ids', () => {
  const { server, messages } = makeServer();
  const a = join(server, 11), b = join(server, 12);
  standInTown(server, a); standInTown(server, b);
  const A = ownRaft(server, a), B = ownRaft(server, b);
  const stock0 = server.world.economy.markets.aldea.stock.ron;

  const quoteA = { op: 'quote', town: 'aldea', g: 'ron', n: 3, side: 'buy', opId: 'a-quote' };
  command(server, 11, quoteA); const qA = lastReply(messages, 11, quoteA.opId);
  const quoteB = { op: 'quote', town: 'aldea', g: 'ron', n: 4, side: 'buy', opId: 'b-quote' };
  command(server, 12, quoteB); const qB = lastReply(messages, 12, quoteB.opId);
  assert.ok(qA?.ok && qB?.ok);

  const buyB = { op: 'buy', town: 'aldea', g: 'ron', n: 4, expectedTotal: qB.total, opId: 'b-buy-four' };
  command(server, 12, buyB); const boughtB = lastReply(messages, 12, buyB.opId);
  assert.ok(boughtB?.ok); assert.equal(B.profile.gold, 1000 - boughtB.total);
  assert.equal(B.profile.eco.pack.goods.ron, 4); assert.equal(B.profile.eco.tradeRev, 1);
  assert.equal(stock0 - server.world.economy.markets.aldea.stock.ron, 4);

  const beforeA = mutateState(A.profile, A.ship, server.world);
  command(server, 11, { op: 'buy', town: 'aldea', g: 'ron', n: 3, expectedTotal: qA.total, opId: 'a-stale-quote' });
  const stale = lastReply(messages, 11, 'a-stale-quote');
  assert.ok(stale); assert.equal(stale.ok, false); assert.equal(stale.why, 'price');
  assert.deepEqual(mutateState(A.profile, A.ship, server.world), beforeA,
    'a stale price cannot debit gold, add goods, bump revision, or move market stock');

  command(server, 11, { op: 'quote', town: 'aldea', g: 'ron', n: 3, side: 'buy', opId: 'a-refresh-quote' });
  const refreshed = lastReply(messages, 11, 'a-refresh-quote');
  assert.ok(refreshed?.ok); assert.notEqual(refreshed.total, qA.total, 'the other trader changed the live price');
  const buyA = { op: 'buy', town: 'aldea', g: 'ron', n: 3, expectedTotal: refreshed.total, opId: 'a-buy-three' };
  command(server, 11, buyA); const boughtA = lastReply(messages, 11, buyA.opId);
  assert.ok(boughtA?.ok); assert.equal(A.profile.gold, 1000 - boughtA.total);
  assert.equal(A.profile.eco.pack.goods.ron, 3); assert.equal(A.profile.eco.tradeRev, 1);
  const afterBuy = mutateState(A.profile, A.ship, server.world);

  command(server, 11, buyA); assert.deepEqual(mutateState(A.profile, A.ship, server.world), afterBuy,
    'replaying the same operation id and payload does not buy twice');
  command(server, 11, { ...buyA, n: 2 });
  assert.equal(lastReply(messages, 11, buyA.opId)?.why, 'duplicate');
  assert.deepEqual(mutateState(A.profile, A.ship, server.world), afterBuy, 'reusing an id with another payload is refused');

  const sellQuote = { op: 'quote', town: 'aldea', g: 'ron', n: 2, side: 'sell', opId: 'a-sell-quote' };
  command(server, 11, sellQuote); const qs = lastReply(messages, 11, sellQuote.opId);
  const stockBeforeSell = server.world.economy.markets.aldea.stock.ron, goldBeforeSell = A.profile.gold;
  command(server, 11, { op: 'sell', town: 'aldea', g: 'ron', n: 2, expectedTotal: qs.total, opId: 'a-sell-two' });
  const sold = lastReply(messages, 11, 'a-sell-two');
  assert.ok(sold?.ok); assert.equal(A.profile.gold, goldBeforeSell + sold.total);
  assert.equal(A.profile.eco.pack.goods.ron, 1); assert.equal(A.profile.eco.tradeRev, 2);
  assert.equal(server.world.economy.markets.aldea.stock.ron - stockBeforeSell, 2);
});

test('market quantity, availability, calm, gold, and revision denials are atomic', () => {
  const { server, messages } = makeServer();
  const e = join(server, 20, profileFixture({ gold: 0, pack: { fruta: 1 } }));
  standInTown(server, e); const { profile, ship } = ownRaft(server, e);
  const before = mutateState(profile, ship, server.world);
  const deny = (fields, opId, why) => {
    command(server, 20, { ...fields, opId }); const ev = lastReply(messages, 20, opId);
    assert.ok(ev); assert.equal(ev.ok, false); assert.equal(ev.why, why); assert.deepEqual(mutateState(profile, ship, server.world), before);
  };
  deny({ op: 'buy', town: 'aldea', g: 'fruta', n: 1.1, expectedTotal: 5 }, 'bad-qty', 'command');
  deny({ op: 'buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: server.world.economy.quote('aldea', 'fruta', 1, 'buy').total }, 'no-gold', 'gold');
  deny({ op: 'sell', town: 'aldea', g: 'hierro', n: 1, expectedTotal: server.world.economy.quote('aldea', 'hierro', 1, 'sell').total }, 'not-held', 'have');
  deny({ op: 'quote', town: 'aldea', g: 'invented', n: 1, side: 'buy' }, 'bad-good', 'command');

  profile.gold = 1000;
  const stock = server.world.economy.markets.aldea.stock.fruta;
  const q = server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  server.world.ecs.regenT[e] = 0;
  const calmBefore = mutateState(profile, ship, server.world);
  command(server, 20, { op: 'buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: q.total, opId: 'in-combat' });
  assert.equal(lastReply(messages, 20, 'in-combat')?.why, 'calm');
  assert.deepEqual(mutateState(profile, ship, server.world), calmBefore);
  server.world.ecs.regenT[e] = 100;
  profile.eco.tradeRev = 2147483647;
  const maxRevBefore = mutateState(profile, ship, server.world);
  command(server, 20, { op: 'buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: q.total, opId: 'max-trade-rev' });
  assert.equal(lastReply(messages, 20, 'max-trade-rev')?.why, 'revisionLimit');
  assert.deepEqual(mutateState(profile, ship, server.world), maxRevBefore);
  assert.equal(server.world.economy.markets.aldea.stock.fruta, stock);
});

test('raft cargo transfer is owner-only, revisioned, lossless, idempotent, capacity-limited, and private', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 31, profileFixture({ pack: { fruta: 5 } })), visitor = join(server, 32);
  const A = ownRaft(server, owner), V = ownRaft(server, visitor);
  standOnRaft(server, owner, A.active); standOnRaft(server, visitor, V.active);

  command(server, 31, { op: 'cargo', id: A.ship.id, opId: 'cargo-private' });
  const cargo = lastReply(messages, 31, 'cargo-private');
  assert.ok(cargo?.ok); assert.equal(cargo.pack.goods.fruta, 5); assert.equal(cargo.hold.cap, A.ship.hold.cap);
  assert.equal(cargo.raftRev, A.ship.rev);
  assert.equal(replies(messages, 32).length, 0, 'another owner sees no private cargo event');

  const original = { pack: copy(A.profile.eco.pack), hold: copy(A.ship.hold), tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev };
  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 3, side: 'deposit', opId: 'deposit-three' });
  const deposited = lastReply(messages, 31, 'deposit-three');
  assert.ok(deposited?.ok); assert.equal(deposited.rev, original.tradeRev + 1);
  assert.equal(A.ship.rev, original.rev + 1); assert.equal(A.profile.eco.pack.goods.fruta, 2); assert.equal(A.ship.hold.goods.fruta, 3);
  const afterDeposit = { pack: copy(A.profile.eco.pack), hold: copy(A.ship.hold), tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev };
  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: original.rev, g: 'fruta', n: 3, side: 'deposit', opId: 'deposit-three' });
  assert.deepEqual({ pack: A.profile.eco.pack, hold: A.ship.hold, tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev }, afterDeposit,
    'duplicate transfer replays its acknowledgement without moving cargo again');
  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 2, side: 'deposit', opId: 'deposit-three' });
  assert.equal(lastReply(messages, 31, 'deposit-three')?.why, 'duplicate');
  assert.deepEqual({ pack: A.profile.eco.pack, hold: A.ship.hold, tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev }, afterDeposit);

  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 2, side: 'withdraw', opId: 'withdraw-two' });
  assert.equal(lastReply(messages, 31, 'withdraw-two')?.ok, true);
  assert.equal(A.profile.eco.pack.goods.fruta, 4); assert.equal(A.ship.hold.goods.fruta, 1);
  assert.equal(A.profile.eco.tradeRev, original.tradeRev + 2); assert.equal(A.ship.rev, original.rev + 2);
  assert.equal(holdUsed(A.profile.eco.pack), 4);

  load(A.ship.hold, 'madera', 1);
  A.ship.hold.goods.fruta = 0; // 3-unit wood fills three of six slots, then fruta fills the remaining three below.
  load(A.ship.hold, 'fruta', 3);
  const fullHoldBefore = { pack: copy(A.profile.eco.pack), hold: copy(A.ship.hold), tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev };
  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 1, side: 'deposit', opId: 'deposit-no-room' });
  assert.equal(lastReply(messages, 31, 'deposit-no-room')?.why, 'room');
  assert.deepEqual({ pack: A.profile.eco.pack, hold: A.ship.hold, tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev }, fullHoldBefore);

  const privateBefore = replies(messages, 32).length;
  command(server, 32, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 1, side: 'withdraw', opId: 'visitor-transfer' });
  assert.equal(lastReply(messages, 32, 'visitor-transfer')?.why, 'owner');
  assert.equal(replies(messages, 32).length, privateBefore + 1, 'only the visitor receives their own denial');
  standInTown(server, owner);
  command(server, 31, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'fruta', n: 1, side: 'withdraw', opId: 'remote-transfer' });
  assert.equal(lastReply(messages, 31, 'remote-transfer')?.why, 'far');
  assert.deepEqual({ pack: A.profile.eco.pack, hold: A.ship.hold, tradeRev: A.profile.eco.tradeRev, rev: A.ship.rev }, fullHoldBefore);

  server.broadcastSnapshot();
  const snapshot = (messages.get(32) || []).filter((m) => m.t === MSG.SNAPSHOT).at(-1);
  assert.ok(snapshot); assert.ok(!JSON.stringify(snapshot.rafts).includes('goods'), 'public snapshots contain no hold or pack contents');
  assert.ok(!JSON.stringify(replies(messages, 32)).includes('deposit-three'), 'other owners never receive transfer receipts');
  assert.ok(original.pack.goods.fruta === 5, 'the baseline was captured before deposit');
});

function makeOversized(profile) {
  const parts = [];
  for (const kind of ['foundation', 'pillar', 'floor']) for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++)
    parts.push([kind, x, z, kind === 'floor' ? 1 : 0, 0]);
  for (let i = 0; i < 4; i++) profile.eco.ships.push({ kind: 'raft', id: `inactive-save-test-${i}`, n: 'Offline fixture',
    hull: 'balsa', mods: [], hold: { cap: 0, goods: {} }, at: 'sol', hp: 1, grid: { parts: copy(parts) }, rev: 1 });
}

test('HMAC guest save preflight protects both commerce and legacy market stock; repeated join restores trade revisions', () => {
  const saves = hmacSaves('d06-commerce-tests-only-secret');
  const { server, messages } = makeServer({ saves });
  const initial = profileFixture({ gold: 1000 });
  server.connect(51);
  server.receive(51, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Signed guest', skin: 0, weapon: 0, save: saves.store(initial) });
  const e = server.clients.get(51).entity, { profile, ship } = ownRaft(server, e);
  assert.equal(server.clients.get(51).serverProfile, false);
  standInTown(server, e);
  makeOversized(profile); assert.ok(saves.store(profile).length > MAX_SAVE, 'the signed guest fixture exceeds the encoded save budget');
  const stock = server.world.economy.markets.aldea.stock.fruta, gold = profile.gold, pack = copy(profile.eco.pack), rev = profile.eco.tradeRev;
  const q = server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  command(server, 51, { op: 'buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: q.total, opId: 'commerce-save-preflight' });
  const denied = lastReply(messages, 51, 'commerce-save-preflight');
  assert.ok(denied); assert.equal(denied.ok, false); assert.equal(denied.why, 'saveSize');
  assert.equal(profile.gold, gold); assert.deepEqual(profile.eco.pack, pack); assert.equal(profile.eco.tradeRev, rev);
  assert.equal(server.world.economy.markets.aldea.stock.fruta, stock, 'failed preflight does not settle shared market stock');

  command(server, 51, { type: 'market', op: 'buy', town: 'aldea', g: 'fruta', n: 1 });
  const legacyDenied = (messages.get(51) || []).filter((m) => m.t === MSG.EVENT && m.ev?.type === 'tradeDenied').at(-1)?.ev;
  assert.equal(legacyDenied?.why, 'saveSize');
  assert.equal(profile.gold, gold); assert.deepEqual(profile.eco.pack, pack); assert.equal(profile.eco.tradeRev, rev);
  assert.equal(server.world.economy.markets.aldea.stock.fruta, stock, 'legacy market preflight also preserves stock');
  command(server, 51, { type: 'market', op: 'buy', town: 'aldea', g: 'fruta', n: 1.5 });
  const strict = (messages.get(51) || []).filter((m) => m.t === MSG.EVENT && m.ev?.type === 'tradeDenied').at(-1)?.ev;
  assert.equal(strict?.why, 'n', 'legacy market no longer truncates fractional quantity');

  // The key is the real HMAC signer: an accepted ordinary guest mutation survives a signed save/rejoin.
  const fresh = profileFixture({ gold: 1000 }), blob = saves.store(fresh);
  server.disconnect(51); server.connect(52);
  server.receive(52, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Fresh signed guest', skin: 0, weapon: 0, save: blob });
  const e2 = server.clients.get(52).entity, B = ownRaft(server, e2); standInTown(server, e2);
  const q2 = server.world.economy.quote('aldea', 'fruta', 2, 'buy');
  command(server, 52, { op: 'buy', town: 'aldea', g: 'fruta', n: 2, expectedTotal: q2.total, opId: 'signed-buy' });
  assert.equal(lastReply(messages, 52, 'signed-buy')?.ok, true);
  server.sendSave(52, server.clients.get(52));
  const signedBlob = (messages.get(52) || []).filter((m) => m.t === MSG.SAVE).at(-1)?.blob;
  const restored = saves.load(signedBlob);
  assert.ok(restored); assert.equal(restored.eco.tradeRev, 1); assert.equal(restored.eco.pack.goods.fruta, 2);
  assert.equal(restored.eco.ships.find((s) => s.id === B.ship.id).rev, B.ship.rev,
    'market purchase persists its trade revision alongside the existing ship revision');
});

test('merchant NPCs stand inside their intended walkable town markets', () => {
  const { server } = makeServer(); const e = join(server, 61);
  const expected = [['merchant', 'aldea'], ['calaMerchant', 'cala']];
  for (const [id, town] of expected) {
    const npc = server.world.map.npcs.find((n) => n.id === id);
    assert.ok(npc, `${id} exists in generated world`);
    server.world.ecs.x[e] = npc.x; server.world.ecs.z[e] = npc.z;
    assert.equal(townAt(server.world, e), town, `${id} lies within the walkable ${town} market radius`);
    const ground = server.world.map.groundAt(npc.x, npc.z);
    assert.ok(Number.isFinite(ground) && ground > -0.5, `${id} stands over walkable ground, not in deep water`);
    const clearance = Math.min(...server.world.map.queryColliders(npc.x, npc.z, 3)
      .map((i) => Math.hypot(npc.x - server.world.map.colliders[i].x, npc.z - server.world.map.colliders[i].z) - server.world.map.colliders[i].r));
    assert.ok(clearance > 0.8, `${id} has space to approach and talk (nearest collider clearance ${clearance})`);
  }
});

test('cargo enforces alive, stationary, current-revision, weighted-capacity, and signed-save preflight boundaries', () => {
  const { server, messages } = makeServer();
  const e = join(server, 71, profileFixture({ pack: { madera: 3 } }));
  const A = ownRaft(server, e); standOnRaft(server, e, A.active);
  assert.equal(load(A.ship.hold, 'madera', 2), true);
  const unchanged = () => ({ pack: copy(A.profile.eco.pack), hold: copy(A.ship.hold), gold: A.profile.gold,
    tradeRev: A.profile.eco.tradeRev, shipRev: A.ship.rev });
  const base = unchanged();
  command(server, 71, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev + 1, g: 'madera', n: 1, side: 'withdraw', opId: 'cargo-stale-rev' });
  assert.equal(lastReply(messages, 71, 'cargo-stale-rev')?.why, 'revision'); assert.deepEqual(unchanged(), base);

  server.world.ecs.moveMag[e] = 0.5;
  command(server, 71, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'madera', n: 1, side: 'withdraw', opId: 'cargo-moving' });
  assert.equal(lastReply(messages, 71, 'cargo-moving')?.why, 'busy'); assert.deepEqual(unchanged(), base);
  server.world.ecs.moveMag[e] = 0;

  command(server, 71, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'madera', n: 1, side: 'withdraw', opId: 'cargo-weighted-room' });
  assert.equal(lastReply(messages, 71, 'cargo-weighted-room')?.why, 'room', 'three-unit wood cannot fit in the pack’s remaining one weighted slot');
  assert.deepEqual(unchanged(), base);
  server.world.ecs.dead[e] = 1;
  command(server, 71, { op: 'transfer', id: A.ship.id, expectedRev: A.ship.rev, g: 'madera', n: 1, side: 'withdraw', opId: 'cargo-dead' });
  assert.equal(lastReply(messages, 71, 'cargo-dead')?.why, 'dead'); assert.deepEqual(unchanged(), base);

  const saves = hmacSaves('d06-cargo-preflight-test-only');
  const other = makeServer({ saves }), e2 = (server2 => {
    server2.server.connect(72); server2.server.receive(72, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Oversize guest', skin: 0, weapon: 0, save: saves.store(profileFixture({ pack: { madera: 1 } })) });
    return server2.server.clients.get(72).entity;
  })(other);
  const B = ownRaft(other.server, e2); standOnRaft(other.server, e2, B.active);
  makeOversized(B.profile); assert.ok(saves.store(B.profile).length > MAX_SAVE);
  const preflightBefore = { pack: copy(B.profile.eco.pack), hold: copy(B.ship.hold), gold: B.profile.gold,
    tradeRev: B.profile.eco.tradeRev, shipRev: B.ship.rev, stock: other.server.world.economy.markets.aldea.stock.madera };
  command(other.server, 72, { op: 'transfer', id: B.ship.id, expectedRev: B.ship.rev, g: 'madera', n: 1, side: 'deposit', opId: 'cargo-save-too-large' });
  assert.equal(lastReply(other.messages, 72, 'cargo-save-too-large')?.why, 'saveSize');
  assert.deepEqual({ pack: B.profile.eco.pack, hold: B.ship.hold, gold: B.profile.gold,
    tradeRev: B.profile.eco.tradeRev, shipRev: B.ship.rev, stock: other.server.world.economy.markets.aldea.stock.madera }, preflightBefore);
});

test('profile sanitization bounds trade revision and gold before market mutations', () => {
  const raw = profileFixture({ gold: Number.MAX_SAFE_INTEGER });
  raw.eco.tradeRev = Number.MAX_SAFE_INTEGER;
  const clean = sanitizeProfile(raw);
  assert.ok(clean); assert.equal(clean.gold, 1e9); assert.equal(clean.eco.tradeRev, 2147483647);
  raw.gold = -10; raw.eco.tradeRev = -1;
  const bounded = sanitizeProfile(raw);
  assert.equal(bounded.gold, 0); assert.equal(bounded.eco.tradeRev, 0);
});
