import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../src/data/meta.js';
import { HARVEST, resourceLayout } from '../src/data/resources.js';
import { GOODS } from '../src/data/goods.js';
import { C } from '../src/sim/ecs.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { installResources, publicResources, resourceCmd } from '../src/sim/systems/resources.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { hmacSaves } from '../server/saves.mjs';

const copy = (value) => structuredClone(value);
const palmCommand = (opId, expectedRev = 1, node = 'palm-1') =>
  ({ type: 'resource', op: 'gather', opId, node, expectedRev });

function fixture({ players = 1, tools = { axe: 1, pickaxe: 1 } } = {}) {
  const map = {
    seed: 17,
    landmarks: { spawn: { x: 0, z: 0 }, village: { x: 30, z: 0 } },
    heightAt: () => 2,
    groundAt: () => 2,
    onDock: () => false,
    lawlessAt: () => false,
    colliders: [], npcs: [], racks: [],
    practice: { dummy: { x: 100, z: 100 }, ring: { x: 100, z: 100, r: 1 } },
    toWorld: (x, z) => ({ x, z }),
  };
  const w = { map, tick: 100, events: [], emit(ev) { this.events.push(ev); },
    raftDeck: { surface: () => null }, profiles: new Map(), profileDirty: new Set(),
    ecs: { alive: new Uint8Array(32), dead: new Float32Array(32), mask: new Uint16Array(32), hp: new Float32Array(32),
      x: new Float32Array(32), y: new Float32Array(32), z: new Float32Array(32), moveMag: new Float32Array(32),
      vx: new Float32Array(32), vz: new Float32Array(32), dashT: new Float32Array(32), dashBuffer: new Float32Array(32),
      castK: new Float32Array(32), castLock: new Float32Array(32), atkStage: new Float32Array(32), regenT: new Float32Array(32) },
  };
  installResources(w);
  w.resources.nodes = new Map([
    ['palm-1', { id: 'palm-1', kind: 'palm', x: 0, y: 2, z: 0, propIndex: 4, scale: 0.9, rot: 1.2,
      rev: 1, readyTick: 0, hits: 0 }],
    ['stone-1', { id: 'stone-1', kind: 'stone', x: 5, y: 2, z: 0, rev: 1, readyTick: 0 }],
  ]);
  for (let e = 1; e <= players; e++) {
    w.ecs.alive[e] = 1; w.ecs.mask[e] = C.PLAYER; w.ecs.hp[e] = 100;
    w.ecs.x[e] = 0; w.ecs.y[e] = 2; w.ecs.z[e] = 0;
    w.ecs.dashT[e] = -1; w.ecs.regenT[e] = 100;
    const profile = newProfile();
    profile.eco.pack = { cap: 10, goods: {} };
    // These legacy palm/stone behavior fixtures model already-equipped utility tools.
    profile.tools = { axe: tools.axe || 0, pickaxe: tools.pickaxe || 0 };
    w.profiles.set(e, profile);
  }
  return w;
}

function latestResourceEvent(w) { return [...w.events].reverse().find((ev) => ev.type === 'resource'); }
function lastHitEvent(w) { return [...w.events].reverse().find((ev) => ev.type === 'resourceHit'); }
function stand(server, entity, point) {
  const ecs = server.world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z;
  ecs.vx[entity] = ecs.vz[entity] = 0; ecs.moveMag[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = ecs.castLock[entity] = ecs.atkStage[entity] = 0;
  ecs.regenT[entity] = 100;
}

function serverFixture({ seed = GAME.seed, saves } = {}) {
  const messages = new Map();
  const server = new LocalServer({ seed, saves, bots: 0, enemies: false, dev: false,
    send(id, message) {
      const list = messages.get(id) || [];
      list.push(copy(message)); messages.set(id, list);
    } });
  return { server, messages };
}

function join(server, id, save = '') {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Palm ${id}`, skin: 0, weapon: 0, save });
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'signed guest profile joins the real LocalServer');
  return entity;
}

function sendResource(server, messages, clientId, command) {
  server.receive(clientId, { t: MSG.CMD, ...command });
  server.flushEvents();
  return [...(messages.get(clientId) || [])].reverse().find((m) => m.t === MSG.EVENT
    && m.ev?.type === 'resource' && m.ev.opId === command.opId)?.ev || null;
}

function latestSave(messages, id) {
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.SAVE)?.blob || '';
}

function latestSnapshot(messages, id) {
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.SNAPSHOT) || null;
}

function makeSnapshotClient(map) {
  return new GameClient({ onMessage() {}, onSnapshot() {} }, map, { emit() {} });
}

test('palm and stone layout is repeatable, bounded, and leaves map data and world RNG untouched', () => {
  const map = generateWorld(GAME.seed);
  const props = copy(map.props), colliders = copy(map.colliders);
  const world = new World(GAME.seed, { map });
  const rngState = world.rng.state();
  const expected = resourceLayout(map);
  installResources(world);
  assert.deepEqual(resourceLayout(map), expected);
  assert.equal(world.rng.state(), rngState);
  assert.deepEqual(map.props, props);
  assert.deepEqual(map.colliders, colliders);
  assert.ok(expected.bench && Number.isFinite(expected.bench.y));
  assert.ok(expected.nodes.length <= HARVEST.maxNodes);
  assert.ok(expected.nodes.some((node) => node.kind === 'palm'));
  assert.ok(expected.nodes.some((node) => node.kind === 'stone'));
});

test('GAME.seed and alternate layouts distribute harvestable palms and stones on clear ground', () => {
  for (const seed of [GAME.seed, 17, 71]) {
    const map = generateWorld(seed), beforeProps = copy(map.props), beforeColliders = copy(map.colliders);
    const { nodes } = resourceLayout(map);
    const palms = nodes.filter((node) => node.kind === 'palm');
    const stones = nodes.filter((node) => node.kind === 'stone');
    assert.ok(palms.length >= 30, `${seed} has a useful palm distribution`);
    assert.ok(stones.length >= 20, `${seed} has a useful stone distribution`);
    assert.ok(nodes.length <= HARVEST.maxNodes);
    for (const node of nodes) {
      assert.ok(map.heightAt(node.x, node.z) >= 0.35, `${node.id} is on dry ground`);
      assert.equal(map.onDock(node.x, node.z), false, `${node.id} is outside the dock`);
    assert.equal(map.lawlessAt(node.x, node.z), false, `${node.id} is outside the no-law area`);
      assert.ok(map.npcs.every((npc) => Math.hypot(node.x - npc.x, node.z - npc.z) >= 4), `${node.id} avoids NPCs`);
      assert.ok(map.racks.every((rack) => Math.hypot(node.x - rack.x, node.z - rack.z) >= 4), `${node.id} avoids racks`);
      assert.ok(Math.hypot(node.x - map.practice.dummy.x, node.z - map.practice.dummy.z) >= 6, `${node.id} avoids the dummy`);
      assert.ok(Math.hypot(node.x - map.practice.ring.x, node.z - map.practice.ring.z) >= map.practice.ring.r + 3,
        `${node.id} avoids the practice ring`);
      for (const key of ['spawn', 'village', 'dockBase', 'dockEnd']) {
        const point = map.landmarks[key];
        assert.ok(Math.hypot(node.x - point.x, node.z - point.z) >= 7, `${node.id} avoids ${key}`);
      }
      const ownProp = node.kind === 'palm' ? map.props[node.propIndex] : null;
      if (node.kind === 'palm') {
        assert.equal(ownProp.kind, 'palm');
        assert.equal(node.x, ownProp.x); assert.equal(node.z, ownProp.z);
      }
      assert.ok(map.colliders.every((collider) => collider === (ownProp && map.colliders.find((c) =>
        c.x === ownProp.x && c.z === ownProp.z && c.r === ownProp.r))
        || Math.hypot(node.x - collider.x, node.z - collider.z) >= (collider.r || 0) + 1.2),
      `${node.id} overlaps no collider except its own palm trunk`);
    }
    assert.deepEqual(map.props, beforeProps, 'layout only references existing palms; it does not edit props');
    assert.deepEqual(map.colliders, beforeColliders, 'layout does not edit collision geometry');
  }
});

test('three stationary palm hits advance node revision, then grant two logs once and respawn shared', () => {
  const w = fixture({ players: 2 }), node = w.resources.nodes.get('palm-1'), p = w.profiles.get(1);
  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    if (hit > 1) w.tick += HARVEST.chopTicks;
    const beforeTradeRev = p.eco.tradeRev;
    const ok = resourceCmd(w, 1, palmCommand(`chop-${hit}`, node.rev));
    assert.equal(ok, true);
    const ack = latestResourceEvent(w), hitEvent = lastHitEvent(w);
    assert.equal(ack.count, hit === HARVEST.palmHits ? HARVEST.palmYield : 0);
    assert.equal(node.rev, hit + 1);
    assert.equal(p.eco.tradeRev, beforeTradeRev + (hit === HARVEST.palmHits ? 1 : 0));
    assert.equal(p.eco.pack.goods.tronco, hit === HARVEST.palmHits ? 2 : undefined);
    assert.equal(hitEvent.remaining, HARVEST.palmHits - hit);
    assert.equal(hitEvent.felled, hit === HARVEST.palmHits);
    const view = publicResources(w).nodes.find((entry) => entry.id === node.id);
    assert.deepEqual(Object.keys(view).sort(),
      ['hits', 'id', 'kind', 'propIndex', 'ready', 'remaining', 'rev', 'rot', 'scale', 'wait', 'x', 'y', 'z']);
    assert.equal(view.propIndex, node.propIndex);
    assert.equal(view.scale, node.scale);
    assert.equal(view.rot, node.rot);
    assert.equal(view.hits, hit);
    assert.equal(view.remaining, HARVEST.palmHits - hit);
    assert.equal(view.ready, hit === HARVEST.palmHits ? false : true);
    assert.equal(resourceCmd(w, 2, palmCommand(`race-${hit}`, 1)), false);
    assert.equal(latestResourceEvent(w).why, 'revision');
    assert.equal(w.profiles.get(2).eco.pack.goods.tronco, undefined);
  }
  const finalState = copy(node), finalHitEvents = w.events.filter((event) => event.type === 'resourceHit').length;
  assert.equal(resourceCmd(w, 1, palmCommand('chop-3', 3)), true);
  assert.deepEqual(node, finalState);
  assert.equal(p.eco.pack.goods.tronco, HARVEST.palmYield);
  assert.equal(w.events.filter((event) => event.type === 'resourceHit').length, finalHitEvents);
  assert.equal(node.readyTick, w.tick + HARVEST.respawnTicks);
  w.tick = node.readyTick;
  const restored = publicResources(w).nodes.find((entry) => entry.id === node.id);
  assert.equal(restored.ready, true);
  assert.equal(restored.hits, 0);
  assert.equal(restored.remaining, HARVEST.palmHits);
  p.eco.pack.goods = {}; // Make room for another full palm yield after the snapshot reset.
  assert.equal(resourceCmd(w, 1, palmCommand('after-respawn', node.rev)), true);
  assert.equal(node.hits, 1);
  assert.equal(node.readyTick, 0);
  assert.equal(publicResources(w).nodes.find((entry) => entry.id === node.id).remaining, HARVEST.palmHits - 1);
});

test('palm cooldown, operation replay, and reused IDs cannot create extra hits or public events', () => {
  const w = fixture(), node = w.resources.nodes.get('palm-1');
  assert.equal(resourceCmd(w, 1, palmCommand('same-hit')), true);
  const eventCount = w.events.filter((event) => event.type === 'resourceHit').length;
  const stateAfterHit = copy(node);
  assert.equal(resourceCmd(w, 1, palmCommand('same-hit')), true);
  assert.deepEqual(node, stateAfterHit);
  assert.equal(w.events.filter((event) => event.type === 'resourceHit').length, eventCount);
  assert.equal(resourceCmd(w, 1, palmCommand('same-hit', 2)), false);
  assert.equal(latestResourceEvent(w).why, 'opIdReuse');
  assert.deepEqual(node, stateAfterHit);
  assert.equal(resourceCmd(w, 1, palmCommand('too-soon', 2)), false);
  assert.equal(latestResourceEvent(w).why, 'cooldown');
  assert.equal(w.events.filter((event) => event.type === 'resourceHit').length, eventCount);
  w.tick += HARVEST.chopTicks;
  assert.equal(resourceCmd(w, 1, palmCommand('next-hit', 2)), true);
  assert.equal(node.hits, 2);
});

test('full pack and failed or throwing save preflight leave every attempted palm hit atomic', () => {
  for (const preflight of [() => false, () => { throw new Error('save rejected'); }]) {
    const w = fixture(), node = w.resources.nodes.get('palm-1'), profile = w.profiles.get(1);
    for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
      if (hit > 1) w.tick += HARVEST.chopTicks;
      const beforeNode = copy(node), beforeProfile = copy(profile), dirty = new Set(w.profileDirty);
      assert.equal(resourceCmd(w, 1, palmCommand(`save-${hit}`, node.rev), preflight), false);
      assert.equal(latestResourceEvent(w).why, 'saveSize');
      assert.deepEqual(node, beforeNode);
      assert.deepEqual(profile, beforeProfile);
      assert.deepEqual(w.profileDirty, dirty);
    }
  }
  const w = fixture(), node = w.resources.nodes.get('palm-1'), profile = w.profiles.get(1);
  profile.eco.pack.goods = { tronco: Math.floor(profile.eco.pack.cap / GOODS.tronco.volume) };
  const beforeNode = copy(node), beforeProfile = copy(profile);
  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    if (hit > 1) w.tick += HARVEST.chopTicks;
    assert.equal(resourceCmd(w, 1, palmCommand(`full-${hit}`, node.rev)), false);
    assert.equal(latestResourceEvent(w).why, 'full');
    assert.deepEqual(node, beforeNode);
    assert.deepEqual(profile, beforeProfile);
  }
});

test('movement, death, combat, and being aboard deny palm chopping without changing node or profile', () => {
  const w = fixture(), node = w.resources.nodes.get('palm-1'), profile = w.profiles.get(1);
  const beforeNode = copy(node), beforeProfile = copy(profile);
  const cases = [
    ['moving', () => { w.ecs.moveMag[1] = 1; }, () => { w.ecs.moveMag[1] = 0; }, 'busy'],
    ['dead', () => { w.ecs.dead[1] = 1; }, () => { w.ecs.dead[1] = 0; }, 'dead'],
    ['combat', () => { w.ecs.regenT[1] = 0; }, () => { w.ecs.regenT[1] = 100; }, 'combat'],
    ['aboard', () => { w.navalPilot = { aboard: () => true }; }, () => { w.navalPilot = null; }, 'land'],
  ];
  for (const [id, set, reset, why] of cases) {
    set();
    assert.equal(resourceCmd(w, 1, palmCommand(`denied-${id}`, node.rev)), false);
    assert.equal(latestResourceEvent(w).why, why);
    assert.deepEqual(node, beforeNode);
    assert.deepEqual(profile, beforeProfile);
    reset();
  }
});

test('real LocalServer commands save and reload a signed guest with two palm logs and one stone', () => {
  const saves = hmacSaves('harvest-palm-test-secret'), initial = newProfile();
  initial.gold = 246; initial.eco.tradeRev = 7;
  initial.tools = { axe: 1, pickaxe: 1 };
  const f = serverFixture({ saves }), owner = join(f.server, 31, saves.store(initial));
  const profile = f.server.world.profiles.get(owner);
  const shipBefore = copy(profile.eco.ships);
  const palm = [...f.server.world.resources.nodes.values()].find((node) => node.kind === 'palm');
  const stone = [...f.server.world.resources.nodes.values()].find((node) => node.kind === 'stone');
  assert.ok(palm, 'the production map has a harvestable palm');
  assert.ok(stone, 'the production map has a harvestable stone');

  stand(f.server, owner, palm);
  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    if (hit > 1) for (let tick = 0; tick < HARVEST.chopTicks; tick++) f.server.step();
    stand(f.server, owner, palm);
    const ack = sendResource(f.server, f.messages, 31,
      palmCommand(`server-palm-${hit}`, palm.rev, palm.id));
    assert.equal(ack?.ok, true, `palm hit ${hit} was acknowledged: ${JSON.stringify(ack)}`);
    assert.equal(ack.count, hit === HARVEST.palmHits ? HARVEST.palmYield : 0);
  }
  for (let tick = 0; tick < HARVEST.chopTicks; tick++) f.server.step();
  stand(f.server, owner, stone);
  const rockAck = sendResource(f.server, f.messages, 31,
    { type: 'resource', op: 'gather', node: stone.id, expectedRev: stone.rev, opId: 'server-stone' });
  assert.equal(rockAck?.ok, true);
  assert.equal(profile.eco.pack.goods.tronco, 2);
  assert.equal(profile.eco.pack.goods.piedra, 1);
  assert.equal(profile.eco.tradeRev, 9);
  assert.equal(profile.gold, 246);
  assert.deepEqual(profile.eco.ships, shipBefore);

  f.server.step();
  const blob = latestSave(f.messages, 31), saved = saves.load(blob);
  assert.ok(saved, 'the signed guest save validates');
  assert.deepEqual(saved.eco.pack.goods, { tronco: 2, piedra: 1 });
  assert.equal(saved.eco.tradeRev, 9);
  assert.equal(saved.gold, 246);
  assert.deepEqual(saved.eco.ships, shipBefore);
  f.server.disconnect(31);
  const reopened = serverFixture({ saves }), nextOwner = join(reopened.server, 32, blob);
  const restored = reopened.server.world.profiles.get(nextOwner);
  assert.deepEqual(restored.eco.pack.goods, { tronco: 2, piedra: 1 });
  assert.equal(restored.eco.tradeRev, 9);
  assert.equal(restored.gold, 246);
  assert.deepEqual(restored.eco.ships, shipBefore);
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(restored))).eco.pack.goods, { tronco: 2, piedra: 1 });
  reopened.server.disconnect(32);
});

test('LocalServer sends the resource catalogue on change and admission, while clients retain it between updates', () => {
  const saves = hmacSaves('harvest-palm-catalogue-secret'), initial = newProfile();
  initial.tools = { axe: 1, pickaxe: 1 };
  const f = serverFixture({ saves }), owner = join(f.server, 41, saves.store(initial));
  const client = makeSnapshotClient(f.server.world.map);
  f.server.broadcastSnapshot();
  let snapshot = latestSnapshot(f.messages, 41);
  assert.ok(snapshot && Object.hasOwn(snapshot, 'resources'), 'the first client receives the full catalogue');
  client.onSnapshot(snapshot);
  assert.deepEqual(client.resources, snapshot.resources);
  const firstCatalogue = copy(snapshot.resources);
  const palm = [...f.server.world.resources.nodes.values()].find((node) => node.kind === 'palm');
  assert.ok(palm);

  f.server.step();
  f.server.broadcastSnapshot();
  snapshot = latestSnapshot(f.messages, 41);
  assert.equal(Object.hasOwn(snapshot, 'resources'), false, 'an unchanged tick omits the large catalogue');
  client.onSnapshot(snapshot);
  assert.deepEqual(client.resources, firstCatalogue, 'omitting an unchanged catalogue preserves client state');

  sendResource(f.server, f.messages, 41,
    { type: 'resource', op: 'gather', node: 'unknown-node', expectedRev: 1, opId: 'invalid-no-change' });
  f.server.broadcastSnapshot();
  snapshot = latestSnapshot(f.messages, 41);
  assert.equal(Object.hasOwn(snapshot, 'resources'), false, 'a rejected command does not dirty the catalogue');

  for (let hit = 1; hit <= HARVEST.palmHits; hit++) {
    if (hit > 1) for (let tick = 0; tick < HARVEST.chopTicks; tick++) f.server.step();
    stand(f.server, owner, palm);
    const ack = sendResource(f.server, f.messages, 41,
      palmCommand(`catalogue-hit-${hit}`, palm.rev, palm.id));
    assert.equal(ack?.ok, true);
    f.server.broadcastSnapshot();
    snapshot = latestSnapshot(f.messages, 41);
    assert.ok(Object.hasOwn(snapshot, 'resources'), `palm revision ${hit} publishes a fresh catalogue`);
    const publishedPalm = snapshot.resources.nodes.find((node) => node.id === palm.id);
    assert.equal(publishedPalm.hits, hit);
    assert.equal(publishedPalm.rev, hit + 1);
    client.onSnapshot(snapshot);
    assert.deepEqual(client.resources, snapshot.resources);
  }

  f.server.world.tick = palm.readyTick;
  f.server.broadcastSnapshot();
  snapshot = latestSnapshot(f.messages, 41);
  assert.ok(Object.hasOwn(snapshot, 'resources'), 'the respawn state change publishes the catalogue');
  const respawned = snapshot.resources.nodes.find((node) => node.id === palm.id);
  assert.equal(respawned.ready, true);
  assert.equal(respawned.hits, 0);
  assert.equal(respawned.remaining, HARVEST.palmHits);
  client.onSnapshot(snapshot);
  assert.deepEqual(client.resources, snapshot.resources);

  const lateOwner = join(f.server, 42), lateClient = makeSnapshotClient(f.server.world.map);
  f.server.broadcastSnapshot();
  const lateSnapshot = latestSnapshot(f.messages, 42);
  assert.ok(Object.hasOwn(lateSnapshot, 'resources'), 'a late join receives its own complete catalogue');
  lateClient.onSnapshot(lateSnapshot);
  assert.deepEqual(lateClient.resources, lateSnapshot.resources);

  f.server.disconnect(41);
  join(f.server, 41);
  f.server.broadcastSnapshot();
  const reconnected = latestSnapshot(f.messages, 41);
  assert.ok(Object.hasOwn(reconnected, 'resources'), 'a reconnect receives the complete catalogue again');
  f.server.disconnect(41); f.server.disconnect(42);
});

test('HELLO invalidates a catalogue cached by a pre-admission spectator snapshot', () => {
  const f = serverFixture(), clientId = 51;
  f.server.connect(clientId);
  f.server.broadcastSnapshot();
  const spectatorSnapshot = latestSnapshot(f.messages, clientId);
  assert.ok(Object.hasOwn(spectatorSnapshot, 'resources'), 'the pre-HELLO spectator receives and caches the catalogue');
  assert.equal(typeof f.server.clients.get(clientId).resourceSignature, 'string');

  f.server.receive(clientId, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Late hello', skin: 0, weapon: 0, save: '' });
  assert.ok(f.server.clients.get(clientId)?.entity, 'HELLO admits the connected spectator');
  assert.ok((f.messages.get(clientId) || []).some((message) => message.t === MSG.WELCOME), 'admission publishes WELCOME');
  assert.equal(f.server.clients.get(clientId).resourceSignature, null,
    'admission clears the spectator catalogue cache so the browser can attach its snapshot listener');

  f.server.broadcastSnapshot();
  const admittedSnapshot = latestSnapshot(f.messages, clientId);
  assert.ok(Object.hasOwn(admittedSnapshot, 'resources'), 'the first post-WELCOME snapshot repeats the unchanged catalogue');
  assert.deepEqual(admittedSnapshot.resources, spectatorSnapshot.resources);
  f.server.disconnect(clientId);
});
