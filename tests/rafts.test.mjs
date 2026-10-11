import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { LocalServer } from '../src/net/localServer.js';
import { C, KIND } from '../src/sim/ecs.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GameClient } from '../src/client/gameClient.js';
import { map } from './helpers.mjs';
import { createGameServer } from '../server/index.mjs';
import { hmacSaves } from '../server/saves.mjs';

const copy = (x) => JSON.parse(JSON.stringify(x));
const starterOf = (p) => p.eco.ships.filter((s) => s.kind === 'raft');

test('raft profile migration grants once, preserves old boats, and respects explicit empty state', () => {
  const fresh = newProfile();
  assert.equal(fresh.eco.raftV, 1);
  assert.equal(starterOf(fresh).length, 1);
  assert.deepEqual(starterOf(fresh)[0].grid.parts, newRaft().parts);
  assert.equal(starterOf(fresh)[0].hold.cap, 6);

  const legacyEmpty = copy(fresh);
  delete legacyEmpty.eco.raftV;
  legacyEmpty.eco.ships = [];
  const migrated = sanitizeProfile(legacyEmpty);
  assert.equal(migrated.eco.raftV, 1);
  assert.equal(starterOf(migrated).length, 1);
  assert.equal(starterOf(sanitizeProfile(copy(migrated))).length, 1, 'resaving cannot grant a second starter');

  const legacyExisting = copy(legacyEmpty);
  legacyExisting.eco.ships = [{ kind: 'raft', id: 'legacy:boat', grid: newRaft(), hold: { goods: { madera: 4 } }, at: 'aldea', hp: 0 }];
  const preserved = sanitizeProfile(legacyExisting);
  assert.equal(starterOf(preserved).length, 1, 'an existing legacy raft counts as the starter');
  assert.equal(starterOf(preserved)[0].id, 'legacy:boat');
  assert.equal(starterOf(preserved)[0].hold.goods.madera, 4);
  assert.equal(starterOf(preserved)[0].hp, 0);

  const markedEmpty = copy(fresh);
  markedEmpty.eco.ships = [];
  assert.equal(sanitizeProfile(markedEmpty).eco.ships.length, 0, 'a marked empty fleet must not respawn a lost raft');
  const emptyBlueprint = copy(fresh);
  emptyBlueprint.eco.ships = [{ ...starterOf(fresh)[0], grid: { parts: [] } }];
  const empty = sanitizeProfile(emptyBlueprint);
  assert.equal(starterOf(empty).length, 1);
  assert.deepEqual(starterOf(empty)[0].grid.parts, [], 'an explicit empty grid is not replaced by the default grid');
});

test('raft preparation assigns stable unique owner and ship ids, rejects live clones, and repairs intra-profile duplicate ids', () => {
  const w = { profiles: new Map() };
  installRafts(w, 'test-namespace');
  const owner = newProfile();
  assert.equal(prepareRaftProfile(w, owner), true);
  const shipId = starterOf(owner)[0].id;
  assert.match(owner.eco.id, /^[a-z0-9]{1,24}$/);
  assert.ok(shipId.startsWith('test-namespace:r'));
  w.profiles.set(1, owner);
  assert.equal(prepareRaftProfile(w, copy(owner)), false, 'a concurrent copy of the same profile is fenced');

  const colliding = newProfile();
  colliding.eco.id = 'anotherowner';
  starterOf(colliding)[0].id = shipId;
  assert.equal(prepareRaftProfile(w, colliding), false, 'a raft id already active under another owner is fenced');

  const duplicateInside = newProfile();
  duplicateInside.eco.ships.push(copy(starterOf(duplicateInside)[0]));
  duplicateInside.eco.ships[0].id = duplicateInside.eco.ships[1].id = 'duplicate:inside';
  assert.equal(prepareRaftProfile(w, duplicateInside), true);
  assert.notEqual(duplicateInside.eco.ships[0].id, duplicateInside.eco.ships[1].id);
});

function makeServer() {
  const messages = new Map(), saved = new Map();
  const server = new LocalServer({ seed: 42, bots: 0, enemies: false,
    send: (id, m) => { if (!messages.has(id)) messages.set(id, []); messages.get(id).push(copy(m)); },
    onSave: (id, p) => saved.set(id, copy(p)),
  });
  return { server, messages, saved };
}

function join(server, id, profile = undefined) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, skin: 0, weapon: 0, save: '' }, profile);
  return server.clients.get(id).entity;
}

const snapshots = (messages, id) => (messages.get(id) || []).filter((m) => m.t === MSG.SNAPSHOT);

test('local server moors one private-profile raft per owner and snapshots repair join and logout state', () => {
  const { server, messages, saved } = makeServer();
  const firstEntity = join(server, 1);
  const firstProfile = server.world.profiles.get(firstEntity);
  const firstShip = starterOf(firstProfile)[0];
  firstShip.berth = 0;
  firstShip.x = 9999; firstShip.y = 9999; firstShip.z = -9999; firstShip.yaw = 2.7;
  firstShip.look = { banner: 'calavera', paint: 0x123456, hold: { gold: 999 } };
  const first = publicRafts(server.world)[0];
  const ecs = server.world.ecs;
  assert.equal(ecs.kind[first.entity], KIND.SHIP);
  assert.ok((ecs.mask[first.entity] & (C.POS | C.VEHICLE)) === (C.POS | C.VEHICLE));
  assert.equal(ecs.mask[first.entity] & (C.PLAYER | C.MOVER), 0);
  assert.notEqual(first.x, 9999); assert.equal(first.y, 0.72); assert.notEqual(first.yaw, 2.7);
  assert.deepEqual(first.parts, firstShip.grid.parts);
  assert.equal(first.look.hold, undefined);
  assert.equal(first.hold, undefined);

  server.connect(2);
  assert.ok(!(messages.get(2) || []).some((m) => m.t === MSG.SPAWN && m.e?.id === first.entity), 'vehicles are not generic character spawns');
  server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P2', skin: 0, weapon: 0, save: '' });
  const secondEntity = server.clients.get(2).entity;
  const both = publicRafts(server.world);
  assert.equal(both.length, 2);
  assert.equal(new Set(both.map((r) => r.id)).size, 2);
  assert.equal(new Set(both.map((r) => r.entity)).size, 2);
  assert.equal(new Set(both.map((r) => r.berth)).size, 2);
  assert.ok(Math.hypot(both[0].x - both[1].x, both[0].z - both[1].z) > 1);
  server.broadcastSnapshot();
  for (const id of [1, 2]) {
    const snap = snapshots(messages, id).at(-1);
    assert.equal(snap.rafts.length, 2);
    assert.deepEqual(snap.rafts.map((r) => r.id).sort(), both.map((r) => r.id).sort());
    assert.ok(!JSON.stringify(snap.rafts).includes('goods'), 'public records omit private cargo');
  }

  const firstId = firstShip.id, firstBerth = firstShip.berth, firstEcoId = firstProfile.eco.id;
  server.disconnect(1);
  assert.equal(saved.has(1), true);
  assert.ok(!server.world.ecs.alive[first.entity]);
  server.broadcastSnapshot();
  assert.deepEqual(snapshots(messages, 2).at(-1).rafts.map((r) => r.id), [starterOf(server.world.profiles.get(secondEntity))[0].id]);

  server.connect(3);
  server.broadcastSnapshot();
  assert.equal(snapshots(messages, 3).at(-1).rafts.length, 1, 'a late join receives the complete current list');
  const returnedEntity = join(server, 3, saved.get(1));
  const returned = publicRafts(server.world).find((r) => r.owner === returnedEntity);
  assert.ok(returned);
  assert.equal(returned.id, firstId);
  assert.equal(returned.berth, firstBerth, 'a free prior berth is reused on reconnect');
  assert.equal(server.world.profiles.get(returnedEntity).eco.id, firstEcoId);
  server.broadcastSnapshot();
  assert.equal(snapshots(messages, 3).at(-1).rafts.length, 2);
});

test('destroyed or explicitly empty rafts do not allocate a vehicle', () => {
  for (const mutate of [
    (ship) => { ship.hp = 0; },
    (ship) => { ship.grid = { parts: [] }; },
  ]) {
    const { server } = makeServer();
    const p = newProfile(); mutate(starterOf(p)[0]);
    const e = join(server, 1, p);
    assert.equal(publicRafts(server.world).length, 0);
    assert.equal([...server.world.ecs.mask].filter((mask, i) => i && server.world.ecs.alive[i] && (mask & C.VEHICLE)).length, 0);
    assert.equal(server.world.profiles.get(e).eco.ships[0].hp === 0 || server.world.profiles.get(e).eco.ships[0].grid.parts.length === 0, true);
  }
});

test('out-of-map saved berth is replaced with a valid pose without changing raft contents', () => {
  const { server } = makeServer();
  const p = newProfile(), ship = starterOf(p)[0];
  ship.berth = 63;
  ship.hold.goods.madera = 2;
  ship.grid = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0]]);
  const expectedParts = copy(ship.grid.parts);
  const e = join(server, 1, p);
  const active = publicRafts(server.world)[0];
  assert.ok(active);
  assert.notEqual(active.berth, 63, 'a saved far-away berth is not trusted as a world transform');
  assert.deepEqual(active.parts, expectedParts);
  assert.deepEqual(server.world.profiles.get(e).eco.ships[0].grid.parts, expectedParts);
  assert.deepEqual(server.world.profiles.get(e).eco.ships[0].hold.goods, { madera: 2 });
  const c = Math.cos(active.yaw), s = Math.sin(active.yaw), limit = map.half - 0.5;
  for (const piece of active.parts) for (const dx of [0, 2]) for (const dz of [0, 2]) {
    const lx = piece[1] * 2 + dx, lz = piece[2] * 2 + dz;
    assert.ok(Math.abs(active.x + c * lx + s * lz) <= limit);
    assert.ok(Math.abs(active.z - s * lx + c * lz) <= limit);
  }
});

test('GameClient accepts complete current raft snapshots and ignores older ticks', () => {
  const snaps = [], msgs = [];
  const transport = { onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), send() {}, sendInput() {}, start() {} };
  const client = new GameClient(transport, map, { emit() {} });
  const feed = (tick, rafts) => client.onSnapshot({ tick, ack: 0, ents: [], rafts });
  const one = [{ id: 'ns:r1', entity: 20, owner: 4, rev: 1, name: 'La Balsa', berth: 0, x: 1, y: 0.72, z: 2, yaw: 0, parts: copy(STARTER_RAFT), look: null }];
  feed(10, one);
  assert.deepEqual(client.pred.rafts, one);
  feed(9, []);
  assert.deepEqual(client.pred.rafts, one, 'an old tick cannot roll back the blueprint list');
  feed(11, []);
  assert.deepEqual(client.pred.rafts, [], 'a newer full list removes logged-out vessels');
});

test('real WebSocket snapshots expose moored blueprints, remove logout, and restore signed raft identity', { timeout: 30000 }, async (t) => {
  const secret = 'raft-snapshot-test-secret', saves = hmacSaves(secret);
  const game = createGameServer({ port: 0, host: '127.0.0.1', seed: 44, bots: 0, dev: true, log: () => {}, saveSecret: secret });
  t.after(async () => { await game.close(); });
  const port = await game.listen();
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
    ws.onmessage = (ev) => messages.push(JSON.parse(ev.data));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const wait = async (predicate, label = 'protocol message') => {
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        const message = messages.find(predicate);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail(`Timed out waiting for ${label}`);
    };
    return { ws, messages, wait };
  };
  const hello = (ws, name, save = '') => ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 0, weapon: 0, save,
    x: 9000, y: 9000, z: -9000, yaw: 2.6, owner: 'spoofed' }));

  const owner = await open();
  hello(owner.ws, 'Owner');
  const profileMsg = await owner.wait((m) => m.t === MSG.PROFILE, 'private profile');
  const firstSnapshot = await owner.wait((m) => m.t === MSG.SNAPSHOT && m.rafts?.length === 1, 'first raft snapshot');
  const first = firstSnapshot.rafts[0];
  assert.equal(profileMsg.p.eco.ships.filter((s) => s.kind === 'raft').length, 1);
  assert.equal(first.owner, owner.messages.find((m) => m.t === MSG.WELCOME).you);
  assert.equal(first.parts.length, profileMsg.p.eco.ships.find((s) => s.kind === 'raft').grid.parts.length);
  assert.equal(first.y, 0.72);
  assert.notEqual(first.yaw, 2.6);
  assert.equal(first.hold, undefined);
  assert.ok(!JSON.stringify(firstSnapshot.rafts).includes('goods'));
  const blob = (await owner.wait((m) => m.t === MSG.SAVE && m.blob, 'signed profile blob')).blob;
  const stored = saves.load(blob);
  const savedShip = stored.eco.ships.find((s) => s.kind === 'raft');
  assert.equal(savedShip.id, first.id);
  assert.equal(savedShip.berth, first.berth);

  const second = await open();
  hello(second.ws, 'Second owner');
  await second.wait((m) => m.t === MSG.PROFILE, 'second private profile');
  const twoOwners = await second.wait((m) => m.t === MSG.SNAPSHOT && m.tick > firstSnapshot.tick && m.rafts?.length === 2, 'two owner snapshot');
  const other = twoOwners.rafts.find((r) => r.id !== first.id);
  assert.ok(other);
  assert.notEqual(other.owner, first.owner);
  assert.notEqual(other.berth, first.berth);
  assert.notEqual(other.id, first.id);

  const spectator = await open();
  const late = await spectator.wait((m) => m.t === MSG.SNAPSHOT && m.rafts?.length === 2 && m.rafts.some((r) => r.id === first.id), 'late-join full raft list');
  assert.ok(!spectator.messages.some((m) => m.t === MSG.PROFILE), 'profile remains private to its owner');
  assert.ok(!spectator.messages.some((m) => m.t === MSG.SPAWN && m.e?.id === first.entity), 'raft vehicle is not a character spawn');

  const beforeTick = late.tick;
  owner.ws.send(JSON.stringify({ t: MSG.CMD, type: 'raft', op: 'place', piece: ['foundation', 8, 8, 0], owner: 'spoofed' }));
  const afterForged = await spectator.wait((m) => m.t === MSG.SNAPSHOT && m.tick > beforeTick, 'snapshot after ignored forged raft command');
  const unchanged = afterForged.rafts.find((r) => r.id === first.id);
  assert.deepEqual(unchanged.parts, first.parts);
  assert.equal(unchanged.rev, first.rev);

  const ownerClosed = new Promise((resolve) => { owner.ws.onclose = resolve; });
  owner.ws.close(); await ownerClosed;
  const removed = await spectator.wait((m) => m.t === MSG.SNAPSHOT && m.tick > afterForged.tick && !m.rafts.some((r) => r.id === first.id), 'logout removal snapshot');
  assert.equal(removed.rafts.length, 1);
  assert.equal(removed.rafts[0].id, other.id);

  const forged = saves.load(blob);
  const forgedShip = forged.eco.ships.find((s) => s.kind === 'raft');
  forgedShip.x = 9000; forgedShip.y = 9000; forgedShip.z = -9000; forgedShip.yaw = 2.6;
  const forgedBlob = saves.store(forged);
  const returned = await open();
  hello(returned.ws, 'Owner', forgedBlob);
  await returned.wait((m) => m.t === MSG.PROFILE, 'reconnected profile');
  const restored = await returned.wait((m) => m.t === MSG.SNAPSHOT && m.rafts?.some((r) => r.id === first.id), 'reconnected raft');
  const sameBoat = restored.rafts.find((r) => r.id === first.id);
  assert.equal(sameBoat.berth, first.berth);
  assert.equal(sameBoat.x, first.x); assert.equal(sameBoat.y, first.y); assert.equal(sameBoat.z, first.z); assert.equal(sameBoat.yaw, first.yaw);
  assert.equal(sameBoat.owner, returned.messages.find((m) => m.t === MSG.WELCOME).you);
  assert.ok(restored.rafts.some((r) => r.id === other.id));
  assert.equal(restored.rafts.filter((r) => r.id === first.id).length, 1);
  assert.ok(!JSON.stringify(restored.rafts).includes('goods'));
  returned.ws.close(); spectator.ws.close(); second.ws.close();
});
