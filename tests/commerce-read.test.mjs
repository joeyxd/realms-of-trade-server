import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { readCommerce } from '../src/sim/systems/commerce.js';
import { townAt } from '../src/sim/systems/trade.js';
import { TOWNS } from '../src/data/towns.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const sent = [];
  const server = new LocalServer({ seed: 71, bots: 0, enemies: false,
    send: (id, msg) => sent.push({ id, msg: copy(msg) }) });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Trader', skin: 0, weapon: 0, save: '' }, newProfile());
  const entity = server.clients.get(1).entity;
  const town = TOWNS.aldea, point = server.world.map.landmarks[town.landmark] || server.world.map[town.landmark];
  const ecs = server.world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = server.world.map.groundAt(point.x, point.z);
  ecs.regenT[entity] = 100;
  assert.equal(townAt(server.world, entity), 'aldea');
  sent.length = 0;
  return { server, entity, profile: server.world.profiles.get(entity), sent };
}

function state(world, profile) {
  return {
    profile: copy(profile),
    markets: copy(world.economy.markets),
    receipts: world.commerceReceipts,
    dirty: world.profileDirty ? [...world.profileDirty] : null,
  };
}

test('readCommerce returns bounded current list and quote projections without side effects', () => {
  const { server, entity, profile, sent } = fixture(), world = server.world;
  const before = state(world, profile);
  const list = readCommerce(world, entity, { op: 'list', town: 'aldea' });
  assert.equal(list.ok, true);
  assert.deepEqual(Object.keys(list.rows[0]).sort(), ['buy', 'g', 'illegal', 'sell', 'stock', 'trend']);
  assert.deepEqual(list.pack, { cap: profile.eco.pack.cap, maxMass: profile.eco.pack.maxMass,
    goods: { ...profile.eco.pack.goods } });
  assert.equal(list.gold, profile.gold);
  const quote = readCommerce(world, entity, { op: 'quote', town: 'aldea', g: 'fruta', n: 3, side: 'buy' });
  assert.equal(quote.ok, true);
  assert.deepEqual({ ...quote, ok: undefined, why: undefined, rev: undefined }, {
    ok: undefined, why: undefined, rev: undefined, town: 'aldea', g: 'fruta', n: 3,
    side: 'buy', total: world.economy.quote('aldea', 'fruta', 3, 'buy').total,
    avg: world.economy.quote('aldea', 'fruta', 3, 'buy').avg,
    law: world.economy.quote('aldea', 'fruta', 3, 'buy').law,
  });
  assert.deepEqual(state(world, profile), before, 'reads do not touch profile, stock, receipts, or dirty tracking');
  assert.equal(sent.length, 0, 'the helper has no transport side effect');
});

test('readCommerce enforces exact bounded shape, physical town service, life, and naval lock', () => {
  const { server, entity } = fixture(), world = server.world;
  const malformed = [
    { op: 'list', town: 'aldea', extra: true },
    { op: 'quote', town: 'aldea', g: 'fruta', n: 1.5, side: 'buy' },
    { op: 'quote', town: 'aldea', g: 'fruta', n: 501, side: 'buy' },
    { op: 'quote', town: 'aldea', g: 'fruta', n: 1, side: 'transfer' },
    { op: 'buy', town: 'aldea', g: 'fruta', n: 1, side: 'buy' },
  ];
  for (const request of malformed) assert.equal(readCommerce(world, entity, request).why, 'command');

  assert.equal(readCommerce(world, entity, { op: 'list', town: 'cala' }).why, 'far');
  world.ecs.x[entity] += TOWNS.aldea.r + 10;
  assert.equal(readCommerce(world, entity, { op: 'list', town: 'aldea' }).why, 'far');
  world.ecs.x[entity] -= TOWNS.aldea.r + 10;

  world.ecs.dead[entity] = 1;
  assert.equal(readCommerce(world, entity, { op: 'list', town: 'aldea' }).why, 'dead');
  world.ecs.dead[entity] = 0;
  world.navalPilot = { locked: (candidate) => candidate === entity };
  assert.equal(readCommerce(world, entity, { op: 'list', town: 'aldea' }).why, 'busy');
});

test('readCommerce preserves list and quote semantics of human commerce transport', () => {
  const { server, entity, profile, sent } = fixture(), world = server.world;
  const directList = readCommerce(world, entity, { op: 'list', town: 'aldea' });
  server.receive(1, { t: MSG.CMD, type: 'commerce', op: 'list', town: 'aldea', opId: 'read-list' });
  server.flushEvents();
  const listAck = sent.find(({ msg }) => msg.t === MSG.EVENT && msg.ev?.opId === 'read-list')?.msg.ev;
  assert.ok(listAck?.ok);
  const { type, to, op, opId, ...listPayload } = listAck;
  assert.deepEqual(listPayload, directList);

  const directQuote = readCommerce(world, entity, { op: 'quote', town: 'aldea', g: 'fruta', n: 2, side: 'sell' });
  server.receive(1, { t: MSG.CMD, type: 'commerce', op: 'quote', town: 'aldea', g: 'fruta', n: 2,
    side: 'sell', opId: 'read-quote' });
  server.flushEvents();
  const quoteAck = sent.find(({ msg }) => msg.t === MSG.EVENT && msg.ev?.opId === 'read-quote')?.msg.ev;
  assert.ok(quoteAck?.ok);
  const { type: quoteType, to: quoteTo, op: quoteOp, opId: quoteOpId, ...quotePayload } = quoteAck;
  assert.deepEqual(quotePayload, directQuote);
  assert.equal(profile.eco.tradeRev, 0);
});
