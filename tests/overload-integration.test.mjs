// INV02d integration checks across the authoritative world, predicted movement, and cargo commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { installResources, resourceCmd } from '../src/sim/systems/resources.js';
import { commerceCmd } from '../src/sim/systems/commerce.js';
import { packLoadTier } from '../src/sim/economy/carry.js';
import { holdMass } from '../src/sim/economy/cargo.js';
import { FRESHWATER } from '../src/data/freshwater.js';
import { BTN } from '../src/sim/systems/movement.js';
import { tuning } from '../src/data/tuning.js';
import { MOVER_FIELDS, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';
import { TOWNS } from '../src/data/towns.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { map as island } from './helpers.mjs';

function goodsForMass(mass) {
  const hierro = Math.floor(mass / 6), fruta = mass % 6;
  return { ...(hierro ? { hierro } : {}), ...(fruta ? { fruta } : {}) };
}

function adoptedProfile({ mass = 0, maxMass = 50, level = 1, carga = 0, goods = null } = {}) {
  const p = newProfile();
  p.lvl = level;
  p.carry = { v: 1, backpack: 2 };
  p.attr = { v: 1, carga, re: 0 };
  p.eco.pack.cap = 42;
  p.eco.pack.maxMass = maxMass;
  p.eco.pack.goods = goods || goodsForMass(mass);
  return p;
}

function worldPair(profile) {
  const authority = new World(GAME.seed, { map: island, server: true });
  const prediction = new World(GAME.seed, { map: island, server: false });
  const e = authority.spawnPlayer({ x: -20, z: -20 });
  const predicted = prediction.spawnPlayer({ x: -20, z: -20 });
  authority.profiles = new Map([[e, structuredClone(profile)]]);
  prediction.profiles = new Map([[predicted, structuredClone(profile)]]);
  authority.applyCommand(e, { seq: 0, pt: 0, mx: 0, mz: 0, ax: -15, az: -20, btn: 0, prs: 0 });
  prediction.setPlayerState(predicted, authority.playerState(e));
  return { authority, prediction, e, predicted };
}

function applyPair(pair, seq, command) {
  const { authority, prediction, e, predicted } = pair;
  const cmd = { seq, pt: seq, ax: -15, az: -20, btn: 0, prs: 0, ...command };
  authority.tick = prediction.tick = seq;
  authority.applyCommand(e, cmd);
  prediction.applyCommand(predicted, cmd);
  const actual = prediction.playerState(predicted), expected = authority.playerState(e);
  const moverIndices = MOVER_FIELDS.map(field => PLAYER_FIELDS.indexOf(field));
  for (let i = 0; i < moverIndices.length; i++)
    assert.equal(actual[moverIndices[i]], expected[moverIndices[i]], `${MOVER_FIELDS[i]} prediction replay at command ${seq}`);
}

function snapshot(pair, seq, command = {}) {
  const { authority, prediction, e, predicted } = pair;
  authority.tick = prediction.tick = seq;
  authority.applyCommand(e, { seq, pt: seq, ax: -15, az: -20, btn: 0, prs: 0, ...command });
  prediction.setPlayerState(predicted, authority.playerState(e));
  assert.deepEqual(prediction.playerState(predicted), authority.playerState(e), `authority snapshot ${seq}`);
}

test('authority snapshots carry each adopted load tier into bit-identical predicted movement replay', () => {
  assert.ok(PLAYER_FIELDS.includes('load'));
  for (const [mass, tier] of [[40, 0], [45, 1], [55, 2]]) {
    const pair = worldPair(adoptedProfile({ mass }));
    assert.equal(packLoadTier(pair.authority.profiles.get(pair.e)), tier);
    for (let i = 1; i <= 24; i++) {
      applyPair(pair, i, { mx: 0.6, mz: 0.8, prs: i === 5 ? BTN.DASH : 0 });
      assert.equal(pair.authority.ecs.load[pair.e], tier);
    }
    assert.equal(pair.authority.ecs.dashCount[pair.e], tier === 0 ? 1 : 0);
  }
});

test('load boundaries use exact comfort/ceiling values, including level 10 Carga 9', () => {
  for (const [mass, expected] of [[40, 0], [41, 1], [50, 1], [51, 2]])
    assert.equal(packLoadTier(adoptedProfile({ mass })), expected, `level 1 at ${mass}`);
  // Boundary helper checks intentionally isolate mass; the synthetic level-10 cases above cap 42 by volume.
  for (const [mass, expected] of [[76, 0], [77, 1], [95, 1], [96, 2]])
    assert.equal(packLoadTier(adoptedProfile({ mass, level: 10, carga: 9, maxMass: 95 })), expected,
      `level 10 Carga 9 at ${mass}`);
});

test('the next authority command reflects profile and cargo changes, including water vessel mass', () => {
  const pair = worldPair(adoptedProfile({ mass: 40 }));
  applyPair(pair, 1, { mx: 0, mz: 0 });
  assert.equal(pair.authority.ecs.load[pair.e], 0);

  const profile = pair.authority.profiles.get(pair.e);
  profile.eco.pack.goods = goodsForMass(41);
  snapshot(pair, 2, { mx: 0, mz: 0 });
  assert.equal(pair.authority.ecs.load[pair.e], 1);
  applyPair(pair, 3, { mx: 0.5, mz: 0 });

  profile.eco.pack.goods = goodsForMass(36);
  profile.eco.pack.vessels = [{ id: FRESHWATER.bucketId, kind: 'bucket', water: 4 }];
  assert.equal(holdMass(profile.eco.pack), 36 + FRESHWATER.bucketMass + 4);
  snapshot(pair, 4, { mx: 0, mz: 0 });
  assert.equal(pair.authority.ecs.load[pair.e], 1, 'bucket and its water count toward land load');
  applyPair(pair, 5, { mx: 0.5, mz: 0 });

  profile.lvl = 2;
  profile.attr.carga = 1;
  profile.eco.pack.maxMass = 55;
  snapshot(pair, 6, { mx: 0, mz: 0 });
  assert.equal(pair.authority.ecs.load[pair.e], 0, 'the valid level-2 Carga 1 assignment raises comfort to 44');
  applyPair(pair, 7, { mx: 0.5, mz: 0 });
});

test('swimming applies its own saturated cargo slowdown without stacking the land tier multiplier', () => {
  const coast = { ...island, onDock: () => false, groundAt: x => Math.max(-3, Math.min(0.2, -x)),
    colliders: [], queryColliders: () => [], checkpointAt: () => null };
  const make = (maxMass, adopted) => {
    const w = new World(GAME.seed, { map: coast, server: true });
    const e = w.spawnPlayer({ x: 3, z: 0 });
    const profile = adopted ? adoptedProfile({ mass: 54, maxMass }) : newProfile({ starter: false });
    profile.eco.pack.cap = 42; profile.eco.pack.maxMass = 50; profile.eco.pack.goods = goodsForMass(54);
    if (adopted) profile.eco.pack.maxMass = maxMass;
    w.profiles = new Map([[e, profile]]);
    return { w, e, seq: 0 };
  };
  const lightLand = make(50, false), overLand = make(50, true);
  assert.equal(packLoadTier(lightLand.w.profiles.get(lightLand.e)), 0);
  assert.equal(packLoadTier(overLand.w.profiles.get(overLand.e)), 2);
  assert.equal(lightLand.w.ecs.swimLoad[lightLand.e], overLand.w.ecs.swimLoad[overLand.e]);
  const step = (f) => f.w.applyCommand(f.e, { seq: ++f.seq, pt: f.seq, mx: 1, mz: 0, ax: 20, az: 0, btn: 0, prs: 0 });
  for (let i = 0; i < 100; i++) { step(lightLand); step(overLand); }
  assert.equal(lightLand.w.ecs.swim[lightLand.e], 1);
  assert.equal(overLand.w.ecs.swim[overLand.e], 1);
  assert.equal(lightLand.w.ecs.swimLoad[lightLand.e], overLand.w.ecs.swimLoad[overLand.e]);
  assert.ok(Math.abs(lightLand.w.ecs.x[lightLand.e] - overLand.w.ecs.x[overLand.e]) < 1e-9,
    'equal swim load yields equal swimming movement despite different land tiers');
  assert.ok(Math.abs(lightLand.w.ecs.vx[lightLand.e] - tuning.swim.speed *
    (1 - tuning.swim.loadSlow * lightLand.w.ecs.swimLoad[lightLand.e])) < 1e-6);
});

test('gather capacity rejects over-ceiling cargo commands without consuming the node and accepts an exact-ceiling result', () => {
  const run = (mass) => {
    const w = new World(GAME.seed, { map: island, server: true });
    const spawn = w.map.landmarks.spawn;
    const e = w.spawnPlayer({ x: spawn.x, z: spawn.z });
    w.ecs.regenT[e] = 100;
    const profile = adoptedProfile({ mass });
    profile.eco.tradeRev = 0;
    w.profiles = new Map([[e, profile]]);
    installResources(w);
    const node = { id: 'overload-wood', kind: 'wood', x: w.ecs.x[e], y: w.ecs.y[e], z: w.ecs.z[e], rev: 1, readyTick: 0 };
    w.resources.nodes = new Map([[node.id, node]]);
    const result = resourceCmd(w, e, { type: 'resource', op: 'gather', opId: `gather-${mass}`, node: node.id, expectedRev: 1 });
    return { result, profile, node, why: w.events.at(-1)?.why };
  };
  const over = run(51);
  assert.equal(over.result, false);
  assert.equal(over.why, 'full');
  assert.deepEqual(over.profile.eco.pack.goods, goodsForMass(51));
  assert.equal(over.node.rev, 1);

  const exact = run(47);
  assert.equal(exact.result, true);
  assert.equal(holdMass(exact.profile.eco.pack), 50);
  assert.equal(exact.node.rev, 2);
});

test('commerce capacity rejects a buy cargo command above the ceiling without changing pack, gold, or market stock', () => {
  const profile = newProfile({ starter: false });
  profile.gold = 1000;
  profile.eco.pack.cap = 42;
  profile.eco.pack.maxMass = 50;
  profile.eco.pack.goods = goodsForMass(54);
  // Use the production LocalServer economy initialization without adding a second market implementation.
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: () => {} });
  server.connect(21);
  server.receive(21, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Overload', skin: 0, weapon: 0, save: '' }, profile);
  const live = server.world, player = server.clients.get(21).entity, p = live.profiles.get(player);
  p.carry = { v: 1, backpack: 2 }; p.attr = { v: 1, carga: 0, re: 0 }; p.lvl = 1;
  const town = TOWNS.aldea;
  const marketPoint = live.map.landmarks[town.landmark] || live.map[town.landmark];
  live.ecs.x[player] = marketPoint.x; live.ecs.z[player] = marketPoint.z;
  live.ecs.y[player] = live.map.groundAt(marketPoint.x, marketPoint.z); live.ecs.regenT[player] = 100;
  p.eco.pack.cap = 42; p.eco.pack.maxMass = 50; p.eco.pack.goods = goodsForMass(54); p.gold = 1000;
  const before = { pack: structuredClone(p.eco.pack), gold: p.gold,
    stock: live.economy.markets.aldea.stock.fruta };
  const quote = live.economy.quote('aldea', 'fruta', 1, 'buy');
  const denied = commerceCmd(live, player, { type: 'commerce', op: 'buy', opId: 'over-ceiling-buy',
    town: 'aldea', g: 'fruta', n: 1, expectedTotal: quote.total });
  assert.equal(denied.ok, false);
  assert.equal(denied.why, 'room');
  assert.equal(holdMass(p.eco.pack), 54);
  assert.deepEqual(p.eco.pack, before.pack);
  assert.equal(p.gold, before.gold);
  assert.equal(live.economy.markets.aldea.stock.fruta, before.stock);

  p.eco.pack.goods = goodsForMass(49);
  const positive = live.economy.quote('aldea', 'fruta', 1, 'buy');
  const accepted = commerceCmd(live, player, { type: 'commerce', op: 'buy', opId: 'exact-ceiling-buy',
    town: 'aldea', g: 'fruta', n: 1, expectedTotal: positive.total });
  assert.equal(accepted.ok, true);
  assert.equal(holdMass(p.eco.pack), 50);
});
