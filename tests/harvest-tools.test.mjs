import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../src/data/meta.js';
import { HARVEST } from '../src/data/resources.js';
import { C } from '../src/sim/ecs.js';
import { installResources, publicResources, resourceCmd } from '../src/sim/systems/resources.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { hmacSaves } from '../server/saves.mjs';

const copy = (value) => structuredClone(value);

function serverFixture({ saves } = {}) {
  const messages = new Map();
  const server = new LocalServer({ seed: GAME.seed, saves, bots: 0, enemies: false, dev: false,
    send(id, message) { const list = messages.get(id) || []; list.push(copy(message)); messages.set(id, list); } });
  return { server, messages };
}

function join(server, id, save = '') {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Tool ${id}`, skin: 0, weapon: 0, save });
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'the signed guest joins');
  return entity;
}

function stand(server, entity, node) {
  const ecs = server.world.ecs;
  ecs.x[entity] = node.x; ecs.y[entity] = node.y; ecs.z[entity] = node.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = ecs.castLock[entity] = ecs.atkStage[entity] = 0;
  ecs.regenT[entity] = 100;
}

function command(server, messages, id, body) {
  server.receive(id, { t: MSG.CMD, ...body }); server.flushEvents();
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT
    && m.ev?.type === 'resource' && m.ev.opId === body.opId)?.ev || null;
}

function latestSave(messages, id) {
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.SAVE)?.blob || '';
}

function craftWorld() {
  const map = { seed: 3, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 30, z: 0 } },
    heightAt: () => 2, groundAt: () => 2, onDock: () => false, lawlessAt: () => false,
    colliders: [], npcs: [], racks: [], practice: { dummy: { x: 100, z: 100 }, ring: { x: 100, z: 100, r: 1 } },
    toWorld: (x, z) => ({ x, z }) };
  const ecs = { alive: new Uint8Array(4), dead: new Float32Array(4), mask: new Uint16Array(4),
    hp: new Float32Array(4), x: new Float32Array(4), y: new Float32Array(4), z: new Float32Array(4),
    moveMag: new Float32Array(4), vx: new Float32Array(4), vz: new Float32Array(4), dashT: new Float32Array(4),
    dashBuffer: new Float32Array(4), castK: new Float32Array(4), castLock: new Float32Array(4),
    atkStage: new Float32Array(4), regenT: new Float32Array(4) };
  const w = { map, tick: 100, events: [], emit(event) { this.events.push(event); }, ecs,
    raftDeck: { surface: () => null }, profiles: new Map(), profileDirty: new Set() };
  installResources(w); w.resources.nodes.clear(); w.resources.bench = { x: 0, y: 2, z: 0 };
  ecs.alive[1] = 1; ecs.mask[1] = C.PLAYER; ecs.hp[1] = 100; ecs.y[1] = 2;
  ecs.dashT[1] = -1; ecs.regenT[1] = 100;
  const profile = newProfile(); profile.eco.pack = { cap: 10, goods: { madera: 1, piedra: 2 } };
  w.profiles.set(1, profile);
  return w;
}

const toolCraft = (opId, expectedRev = 0) => ({ type: 'resource', op: 'craft', opId,
  recipe: 'pico_piedra', expectedRev });

function waitForWork(server, ticks = HARVEST.chopTicks) {
  for (let i = 0; i < ticks; i++) server.step();
}

test('new and legacy profiles sanitize utility tools into bounded integer slots', () => {
  const fresh = newProfile();
  assert.deepEqual(fresh.tools, { axe: 0, pickaxe: 0 });
  const legacy = copy(fresh); delete legacy.tools;
  assert.deepEqual(sanitizeProfile(legacy).tools, { axe: 0, pickaxe: 0 });
  for (const [input, expected] of [
    [{ axe: 2, pickaxe: -1 }, { axe: 0, pickaxe: 0 }],
    [{ axe: 0.5, pickaxe: '1' }, { axe: 0, pickaxe: 0 }],
    [{ axe: null, pickaxe: 1 }, { axe: 0, pickaxe: 1 }],
  ]) assert.deepEqual(sanitizeProfile({ ...fresh, tools: input }).tools, expected);
  assert.deepEqual(sanitizeProfile(fresh).tools, { axe: 0, pickaxe: 0 });
});

test('tool crafting commits pack, unique belt slot, trade revision, and save preflight atomically', () => {
  for (const saveFits of [() => false, () => { throw new Error('save rejected'); }]) {
    const world = craftWorld(), profile = world.profiles.get(1), before = copy(profile);
    assert.equal(resourceCmd(world, 1, toolCraft('save-fail'), saveFits), false);
    assert.equal(world.events.at(-1).why, 'saveSize');
    assert.deepEqual(profile, before);
    assert.equal(world.profileDirty.size, 0);
  }

  const world = craftWorld(), profile = world.profiles.get(1);
  assert.equal(resourceCmd(world, 1, toolCraft('first')), true);
  const first = world.events.at(-1);
  assert.deepEqual({ ok: first.ok, tool: first.tool, tier: first.tier, count: first.count, rev: first.rev },
    { ok: true, tool: 'pickaxe', tier: 1, count: 1, rev: 1 });
  assert.deepEqual(profile.tools, { axe: 0, pickaxe: 1 });
  assert.deepEqual(profile.eco.pack.goods, {});
  assert.equal(profile.eco.tradeRev, 1);
  const committed = copy(profile);
  assert.equal(resourceCmd(world, 1, toolCraft('first')), true);
  assert.deepEqual(profile, committed, 'exact successful replay never charges twice');
  world.tick += HARVEST.actionTicks;
  assert.equal(resourceCmd(world, 1, toolCraft('stale', 0)), false);
  assert.equal(world.events.at(-1).why, 'revision');
  assert.deepEqual(profile, committed);
  world.tick += HARVEST.chopTicks;
  assert.equal(resourceCmd(world, 1, toolCraft('already-owned', 1)), false);
  assert.equal(world.events.at(-1).why, 'alreadyOwned');
  assert.deepEqual(profile, committed, 'already-owned acknowledgement consumes no materials or revision');
});

test('rock final yield preflight failure and replay leave node, inventory, and fresh-hit events atomic', () => {
  const world = craftWorld(), profile = world.profiles.get(1), node =
    { id: 'rock-test', kind: 'rock', x: 0, y: 2, z: 0, rev: 1, readyTick: 0, hits: 0 };
  profile.tools.pickaxe = 1;
  const ecs = world.ecs, contender = newProfile();
  contender.tools.pickaxe = 1; contender.eco.pack = { cap: 10, goods: {} };
  world.profiles.set(2, contender);
  ecs.alive[2] = 1; ecs.mask[2] = C.PLAYER; ecs.hp[2] = 100; ecs.y[2] = 2;
  ecs.dashT[2] = -1; ecs.regenT[2] = 100;
  profile.eco.pack.goods = {};
  world.resources.nodes.set(node.id, node);
  for (let hit = 1; hit <= 3; hit++) {
    if (hit > 1) world.tick += HARVEST.chopTicks;
    const expectedRev = node.rev;
    assert.equal(resourceCmd(world, 1, { type: 'resource', op: 'gather', opId: `rock-${hit}`,
      node: node.id, expectedRev }), true);
    if (hit === 1) {
      const hitCount = world.events.filter((event) => event.type === 'resourceHit').length;
      assert.equal(resourceCmd(world, 2, { type: 'resource', op: 'gather', opId: 'rock-contender',
        node: node.id, expectedRev }), false, 'the second player loses the shared node revision race');
      assert.equal(world.events.at(-1).why, 'revision');
      assert.equal(world.events.filter((event) => event.type === 'resourceHit').length, hitCount);
      assert.equal(node.hits, 1);
    }
  }
  world.tick += HARVEST.chopTicks;
  for (const [attempt, saveFits] of [() => false, () => { throw new Error('save rejected'); }].entries()) {
    const beforeNode = copy(node), beforeProfile = copy(profile);
    const hits = world.events.filter((event) => event.type === 'resourceHit').length;
    assert.equal(resourceCmd(world, 1, { type: 'resource', op: 'gather', opId: `rock-fail-${attempt}`,
      node: node.id, expectedRev: node.rev }, saveFits), false);
    assert.equal(world.events.at(-1).why, 'saveSize');
    assert.deepEqual(node, beforeNode); assert.deepEqual(profile, beforeProfile);
    assert.equal(world.events.filter((event) => event.type === 'resourceHit').length, hits);
  }
  const finalCommand = { type: 'resource', op: 'gather', opId: 'rock-final', node: node.id, expectedRev: node.rev };
  assert.equal(resourceCmd(world, 1, finalCommand), true);
  assert.equal(node.hits, 4); assert.equal(profile.eco.pack.goods.piedra, 2);
  const hits = world.events.filter((event) => event.type === 'resourceHit').length;
  assert.equal(resourceCmd(world, 1, finalCommand), true);
  assert.equal(world.events.filter((event) => event.type === 'resourceHit').length, hits,
    'receipt replay sends its acknowledgement without another fresh resourceHit');
});

test('both mining kinds require a pickaxe, reserve the entire yield, and reset progress on tick regrowth', () => {
  for (const [kind, totalHits, good, count] of [['rock', 4, 'piedra', 2], ['iron_ore', 5, 'mineral_hierro', 1]]) {
    const world = craftWorld(), profile = world.profiles.get(1);
    const node = { id: `work-${kind}`, kind, x: 0, y: 2, z: 0, rev: 1, readyTick: 0, hits: 0 };
    world.resources.nodes.set(node.id, node); profile.eco.pack.goods = {};
    const cmd = (opId, expectedRev = node.rev) => ({ type: 'resource', op: 'gather', opId, expectedRev, node: node.id });
    profile.tools.axe = 1;
    assert.equal(resourceCmd(world, 1, cmd('wrong-tool')), false);
    assert.equal(world.events.at(-1).why, 'tool'); assert.equal(node.hits, 0);
    profile.tools.pickaxe = 1;
    profile.eco.pack.goods = { madera: 3 };
    assert.equal(resourceCmd(world, 1, cmd('full')), false);
    assert.equal(world.events.at(-1).why, 'full'); assert.equal(node.rev, 1);
    profile.eco.pack.goods = {};
    for (const [i, preflight] of [() => false, () => { throw new Error('preflight'); }].entries()) {
      assert.equal(resourceCmd(world, 1, cmd(`first-save-${i}`), preflight), false);
      assert.equal(world.events.at(-1).why, 'saveSize'); assert.equal(node.hits, 0); assert.equal(node.rev, 1);
    }
    for (let hit = 1; hit <= totalHits; hit++) {
      assert.equal(resourceCmd(world, 1, cmd(`hit-${hit}`)), true);
      assert.equal(world.events.at(-1).count, hit === totalHits ? count : 0);
      assert.equal(profile.eco.tradeRev, hit === totalHits ? 1 : 0);
      world.tick += HARVEST.chopTicks;
    }
    assert.equal(profile.eco.pack.goods[good], count);
    const view = () => publicResources(world).nodes.find(n => n.id === node.id);
    assert.equal(view().ready, false); assert.equal(view().remaining, 0);
    world.tick = node.readyTick;
    assert.equal(view().ready, true); assert.equal(view().hits, 0); assert.equal(view().remaining, totalHits);
    assert.equal(resourceCmd(world, 1, cmd('regrow')), true);
    assert.equal(node.hits, 1); assert.equal(profile.eco.pack.goods[good], count);
  }
});

test('empty signed guest must bootstrap materials, craft both tools, then save and rejoin with raw ore', () => {
  const saves = hmacSaves('harvest-tools-test-secret');
  const first = serverFixture({ saves }), entity = join(first.server, 61);
  const world = first.server.world, profile = world.profiles.get(entity);
  assert.deepEqual(profile.tools, { axe: 0, pickaxe: 0 });
  const palm = [...world.resources.nodes.values()].find((node) => node.kind === 'palm');
  const rocks = [...world.resources.nodes.values()].filter((node) => node.kind === 'stone');
  const bench = world.resources.bench;
  const ore = [...world.resources.nodes.values()].find((node) => node.kind === 'iron_ore');
  assert.ok(palm && rocks.length >= 3 && ore, 'the production map offers the complete bootstrap loop');

  stand(first.server, entity, palm);
  const denied = command(first.server, first.messages, 61,
    { type: 'resource', op: 'gather', node: palm.id, expectedRev: palm.rev, opId: 'no-axe' });
  assert.equal(denied?.ok, false); assert.equal(denied?.why, 'tool');
  assert.equal(palm.hits, 0);

  // Starter wood and loose stones can be collected by hand; the large rock nodes need a pickaxe.
  const looseWood = [...world.resources.nodes.values()].filter((node) => node.kind === 'wood').slice(0, 4);
  const looseStone = [...world.resources.nodes.values()].filter((node) => node.kind === 'stone').slice(0, 3);
  assert.equal(looseWood.length, 4); assert.equal(looseStone.length, 3);
  for (const [index, node] of looseWood.slice(0, 2).entries()) {
    if (index) waitForWork(first.server, HARVEST.actionTicks);
    stand(first.server, entity, node);
    const ack = command(first.server, first.messages, 61,
      { type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId: `hand-${node.id}` });
    assert.equal(ack?.ok, true, `hand gathering ${node.id} succeeds: ${JSON.stringify(ack)}`);
  }
  assert.equal(profile.eco.pack.goods.tronco, 2);
  waitForWork(first.server, HARVEST.actionTicks);
  const craft = (opId, recipe) => {
    stand(first.server, entity, bench);
    return command(first.server, first.messages, 61,
      { type: 'resource', op: 'craft', opId, recipe, expectedRev: profile.eco.tradeRev });
  };
  const madera = craft('wood-one', 'madera');
  assert.equal(madera?.ok, true); assert.equal(profile.eco.pack.goods.madera, 1);
  waitForWork(first.server);
  stand(first.server, entity, looseStone[0]);
  assert.equal(command(first.server, first.messages, 61,
    { type: 'resource', op: 'gather', node: looseStone[0].id, expectedRev: looseStone[0].rev, opId: 'hand-stone-1' })?.ok, true);
  waitForWork(first.server, HARVEST.actionTicks);
  const axeRev = profile.eco.tradeRev;
  const axeAck = craft('axe', 'hacha_piedra');
  assert.equal(axeAck?.ok, true);
  assert.deepEqual({ tool: axeAck.tool, tier: axeAck.tier, count: axeAck.count, rev: axeAck.rev },
    { tool: 'axe', tier: 1, count: 1, rev: axeRev + 1 });
  assert.deepEqual(profile.tools, { axe: 1, pickaxe: 0 });
  waitForWork(first.server);
  for (const [index, node] of looseWood.slice(2).entries()) {
    stand(first.server, entity, node);
    assert.equal(command(first.server, first.messages, 61,
      { type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId: `hand-extra-${index}` })?.ok, true);
    waitForWork(first.server, HARVEST.actionTicks);
  }
  assert.equal(profile.eco.pack.goods.tronco, 2);
  assert.equal(craft('wood-two', 'madera')?.ok, true);
  waitForWork(first.server);
  for (const [index, node] of looseStone.slice(1).entries()) {
    waitForWork(first.server, HARVEST.actionTicks);
    stand(first.server, entity, node);
    assert.equal(command(first.server, first.messages, 61,
      { type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId: `hand-stone-${index + 2}` })?.ok, true);
  }
  assert.equal(profile.eco.pack.goods.piedra, 2);
  waitForWork(first.server);
  const pickRev = profile.eco.tradeRev;
  const pickAck = craft('pickaxe', 'pico_piedra');
  assert.equal(pickAck?.ok, true);
  assert.deepEqual({ tool: pickAck.tool, tier: pickAck.tier, count: pickAck.count, rev: pickAck.rev },
    { tool: 'pickaxe', tier: 1, count: 1, rev: pickRev + 1 });
  assert.deepEqual(profile.tools, { axe: 1, pickaxe: 1 });
  assert.equal(profile.eco.pack.goods.madera, undefined);

  // Tool recipes are unique permanent belt slots; replay and crafting the owned tool never debit materials.
  const beforeReplay = copy(profile);
  assert.equal(craft('pickaxe', 'pico_piedra')?.why, 'opIdReuse');
  assert.deepEqual(profile, beforeReplay);
  const beforeOwned = copy(profile);
  waitForWork(first.server);
  const owned = craft('already-owned', 'pico_piedra');
  assert.equal(owned?.ok, false); assert.equal(owned?.why, 'alreadyOwned');
  assert.deepEqual(profile.eco.pack.goods, beforeOwned.eco.pack.goods);

  // Utility tools never replace the equipped combat weapon.
  const weaponBefore = copy(profile.eq.weapon);
  const oreView = world.resources.nodes.get(ore.id);
  stand(first.server, entity, ore);
  for (let hit = 1; hit <= 5; hit++) {
    if (hit > 1) waitForWork(first.server);
    stand(first.server, entity, ore);
    const ack = command(first.server, first.messages, 61,
      { type: 'resource', op: 'gather', node: oreView.id, expectedRev: oreView.rev, opId: `ore-${hit}` });
    assert.equal(ack?.ok, true);
  }
  assert.equal(profile.eco.pack.goods.mineral_hierro, 1);
  assert.deepEqual(profile.eq.weapon, weaponBefore);
  first.server.step();
  const blob = latestSave(first.messages, 61), saved = saves.load(blob);
  assert.ok(saved, 'the save signature validates');
  assert.deepEqual(saved.tools, { axe: 1, pickaxe: 1 });
  assert.equal(saved.eco.pack.goods.mineral_hierro, 1);
  first.server.disconnect(61);
  const second = serverFixture({ saves }), rejoined = join(second.server, 62, blob);
  const restored = second.server.world.profiles.get(rejoined);
  assert.deepEqual(restored.tools, { axe: 1, pickaxe: 1 });
  assert.equal(restored.eco.pack.goods.mineral_hierro, 1);
  second.server.disconnect(62);
});

test('unowned tool recipes and resource commands reject forged tiers, counts, and extra authority fields', () => {
  const saves = hmacSaves('harvest-tools-schema-secret'), f = serverFixture({ saves }), entity = join(f.server, 71);
  const profile = f.server.world.profiles.get(entity), bench = f.server.world.resources.bench;
  f.server.world.ecs.x[entity] = bench.x; f.server.world.ecs.y[entity] = bench.y; f.server.world.ecs.z[entity] = bench.z;
  profile.eco.pack.goods = { madera: 1, piedra: 2 };
  for (const [suffix, extra] of [['tool', { tool: 'pickaxe' }], ['tier', { tier: 1 }], ['count', { count: 9 }],
    ['batch', { n: 2 }]]) {
    const before = copy(profile);
    const ack = command(f.server, f.messages, 71, { type: 'resource', op: 'craft', opId: `forge-${suffix}`,
      recipe: 'pico_piedra', expectedRev: profile.eco.tradeRev, ...extra });
    assert.equal(ack?.ok, false); assert.equal(ack?.why, 'schema');
    assert.deepEqual(profile, before);
  }
  const node = [...f.server.world.resources.nodes.values()].find((entry) => entry.kind === 'palm');
  stand(f.server, entity, node);
  const badGather = command(f.server, f.messages, 71, { type: 'resource', op: 'gather', node: node.id,
    expectedRev: node.rev, opId: 'smuggled-gather', tool: 'axe', tier: 1 });
  assert.equal(badGather?.ok, false); assert.equal(badGather?.why, 'schema');
  assert.equal(node.hits, 0);
});
