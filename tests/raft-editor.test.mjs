import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { RAFT } from '../src/data/raftparts.js';
import { raftStats, newRaft } from '../src/sim/economy/raft.js';
import { MAX_SAVE } from '../src/net/saves.js';
import { hmacSaves } from '../server/saves.mjs';
import { load } from '../src/sim/economy/cargo.js';
import { GameClient } from '../src/client/gameClient.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { raftGangplank } from '../src/sim/raftGeometry.js';
import { map } from './helpers.mjs';

const copy = (v) => JSON.parse(JSON.stringify(v));

function makeServer(options = {}) {
  const messages = new Map(), saved = new Map();
  const server = new LocalServer({ seed: 52, bots: 0, enemies: false,
    send: (id, message) => {
      if (!messages.has(id)) messages.set(id, []);
      messages.get(id).push(copy(message));
    },
    onSave: (id, profile) => saved.set(id, copy(profile)),
    ...options,
  });
  return { server, messages, saved };
}

function profileFixture({ woodInHold = 0, woodInPack = 0, gold = 0 } = {}) {
  const profile = newProfile({ starter: false });
  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = {};
  profile.eco.pack.goods = {};
  profile.gold = gold;
  if (woodInHold && !load(ship.hold, 'madera', woodInHold)) throw new Error('hold fixture exceeds its cap');
  if (woodInPack) profile.eco.pack.goods.madera = woodInPack;
  return profile;
}

function join(server, clientId, profile = profileFixture()) {
  server.connect(clientId);
  server.receive(clientId, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Editor ${clientId}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(clientId).entity;
  assert.ok(entity, 'the trusted server-side profile fixture joined');
  return entity;
}

function ownShip(server, entity) {
  const profile = server.world.profiles.get(entity);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft');
  const active = [...server.world.rafts.values()].find((r) => r.owner === entity && r.ship === ship);
  assert.ok(active, 'fixture has a registered owner raft');
  return { profile, ship, active, record: server.world.rafts.get(ship.id) };
}

function standOn(server, entity, raftRecord, lx = 1, lz = 1, level = 0) {
  const ecs = server.world.ecs, c = Math.cos(ecs.facing[raftRecord.entity]);
  const s = Math.sin(ecs.facing[raftRecord.entity]);
  const x = server.world.ecs.x[raftRecord.entity] + c * lx + s * lz;
  const z = server.world.ecs.z[raftRecord.entity] - s * lx + c * lz;
  ecs.x[entity] = x;
  ecs.z[entity] = z;
  ecs.y[entity] = ecs.y[raftRecord.entity] + level * RAFT.levelHeight;
  ecs.regenT[entity] = 100; // Calm, server-owned test fixture for supply authorization.
  return { x, z, y: ecs.y[entity] };
}

function pointOnRaft(server, raftRecord, lx, lz) {
  const ecs = server.world.ecs, c = Math.cos(ecs.facing[raftRecord.entity]), s = Math.sin(ecs.facing[raftRecord.entity]);
  return { x: ecs.x[raftRecord.entity] + c * lx + s * lz, z: ecs.z[raftRecord.entity] - s * lx + c * lz };
}

function wire(server, clientId, fields) {
  server.receive(clientId, { t: MSG.CMD, type: 'raft', ...fields });
  server.flushEvents();
}

function editEvent(messages, clientId, opId) {
  return (messages.get(clientId) || []).slice().reverse().find((m) => m.t === MSG.EVENT
    && m.ev?.type === 'raftEdit' && (!opId || m.ev.opId === opId))?.ev || null;
}

function partList(ship) { return ship.grid.parts.map((p) => [...p]); }
function privateState(profile, ship) {
  return { rev: ship.rev, parts: partList(ship), hold: copy(ship.hold), pack: copy(profile.eco.pack), gold: profile.gold };
}

test('raft edit route rejects forged ownership, visitors, distance, dead players, mooring loss, and bad pieces atomically', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 1), visitor = join(server, 2);
  const own = ownShip(server, owner), visitorOwn = ownShip(server, visitor);
  standOn(server, owner, own.active);
  standOn(server, visitor, visitorOwn.active);
  const beforeOwner = privateState(own.profile, own.ship), beforeVisitor = privateState(visitorOwn.profile, visitorOwn.ship);
  let op = 0;
  const denied = (clientId, fields, expected = null) => {
    wire(server, clientId, fields);
    const event = editEvent(messages, clientId, fields.opId);
    assert.ok(event, `denial reply exists for ${fields.opId}`);
    assert.equal(event.ok, false, `operation ${fields.opId} is refused`);
    assert.ok(event.why, 'denial identifies its reason');
    if (expected) assert.equal(event.why, expected);
    return event;
  };

  denied(2, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `visitor-${++op}`, piece: ['foundation', 2, 0, 0, 0] }, 'owner');
  assert.deepEqual(privateState(own.profile, own.ship), beforeOwner, 'visitor cannot affect another owner');
  assert.deepEqual(privateState(visitorOwn.profile, visitorOwn.ship), beforeVisitor, 'denial does not touch visitor resources');

  denied(1, { op: 'place', id: 'forged:raft', expectedRev: own.ship.rev, opId: `id-${++op}`, piece: ['foundation', 2, 0, 0, 0] }, 'owner');
  assert.deepEqual(privateState(own.profile, own.ship), beforeOwner);

  const ecs = server.world.ecs;
  const original = { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner], dead: ecs.dead[owner] };
  ecs.x[owner] = server.world.map.half - 2; ecs.z[owner] = server.world.map.half - 2;
  denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `far-${++op}`, piece: ['foundation', 2, 0, 0, 0] }, 'far');
  ecs.x[owner] = original.x; ecs.y[owner] = original.y; ecs.z[owner] = original.z;

  ecs.dead[owner] = 1;
  denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `dead-${++op}`, piece: ['foundation', 2, 0, 0, 0] }, 'dead');
  ecs.dead[owner] = original.dead;

  own.ship.at = 'mar';
  denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `unmoored-${++op}`, piece: ['foundation', 2, 0, 0, 0] }, 'owner');
  own.ship.at = 'aldea';

  for (const [label, piece, why] of [
    ['unknown', ['invented', 2, 0, 0, 0], 'piece'], ['not-in-editor', ['sail', 2, 0, 0, 0], 'piece'],
    ['bad-level', ['floor', 2, 0, 3, 0], 'level'], ['fractional-cell', ['foundation', 2.5, 0, 0, 0], 'piece'],
    ['unsafe-coordinate', ['foundation', Number.MAX_SAFE_INTEGER, 0, 0, 0], 'level'],
    ['off-map-coordinate', ['foundation', 129, 0, 0, 0], 'level'],
    ['malformed-tuple', ['foundation', 2, 0, 0], 'piece'],
    ['bad-edge-direction', ['wall', 2, 0, 0, 4], 'level'], ['unsupported-floor', ['floor', 8, 8, 1, 0], 'support'],
  ]) {
    denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `${label}-${++op}`, piece }, why);
    assert.deepEqual(privateState(own.profile, own.ship), beforeOwner, `${label} denial preserves resources, revision, and plan`);
  }

  const invalidId = { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: 'contains spaces', piece: ['foundation', 2, 0, 0, 0] };
  wire(server, 1, invalidId);
  const badIdReply = (messages.get(1) || []).slice().reverse().find((m) => m.t === MSG.EVENT
    && m.ev?.type === 'raftEdit' && m.ev.id === own.ship.id);
  assert.ok(badIdReply); assert.equal(badIdReply.ev.ok, false); assert.equal(badIdReply.ev.why, 'command');
  assert.equal(badIdReply.ev.opId, '', 'malformed id is not echoed into the operation receipt channel');
  assert.deepEqual(privateState(own.profile, own.ship), beforeOwner);

  const validRev = own.ship.rev;
  own.ship.rev = 2147483647;
  const atRevisionLimit = privateState(own.profile, own.ship);
  denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `revision-limit-${++op}`,
    piece: ['foundation', 2, 0, 0, 0] }, 'revisionLimit');
  assert.deepEqual(privateState(own.profile, own.ship), atRevisionLimit, 'revision exhaustion is an atomic refusal');
  own.ship.rev = validRev;

  load(own.ship.hold, 'madera', 2);
  own.profile.eco.pack.goods.madera = 10;
  const beforeDock = privateState(own.profile, own.ship);
  denied(1, { op: 'place', id: own.ship.id, expectedRev: own.ship.rev, opId: `dock-overlap-${++op}`,
    piece: ['foundation', 2, 0, 0, 0] }, 'layout');
  assert.deepEqual(privateState(own.profile, own.ship), beforeDock,
    'expansion into the fixed village dock is rejected without charging the owner');
});

test('anonymous signed saves restore a paid edit and refuse oversized subsequent saves before market settlement', () => {
  const saves = hmacSaves('d05-isolated-test-signing-key');
  const { server, messages } = makeServer({ saves });
  const p = profileFixture({ woodInHold: 2, woodInPack: 2, gold: 1000 });
  server.connect(71);
  server.receive(71, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Signed builder', save: saves.store(p) });
  const owner = server.clients.get(71).entity, { profile, ship, record } = ownShip(server, owner);
  assert.equal(server.clients.get(71).serverProfile, false);
  standOn(server, owner, record);
  wire(server, 71, { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'signed-paid-edit', piece: ['foundation', 0, 2, 0, 0] });
  assert.equal(editEvent(messages, 71, 'signed-paid-edit').ok, true);
  const accepted = privateState(profile, ship), pose = publicRafts(server.world).find((r) => r.id === ship.id);
  server.sendSave(71, server.clients.get(71));
  const blob = messages.get(71).filter((m) => m.t === MSG.SAVE).at(-1).blob;
  assert.ok(blob.length <= MAX_SAVE);
  assert.equal(saves.load(blob).eco.ships[0].rev, ship.rev);
  server.disconnect(71);
  server.connect(72); server.receive(72, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Reopened builder', save: blob });
  const reopened = server.clients.get(72).entity, restored = ownShip(server, reopened);
  assert.deepEqual(privateState(restored.profile, restored.ship), accepted);
  const restoredPose = publicRafts(server.world).find((r) => r.id === restored.ship.id);
  assert.deepEqual([restoredPose.x, restoredPose.y, restoredPose.z, restoredPose.yaw], [pose.x, pose.y, pose.z, pose.yaw]);
  standOn(server, reopened, restored.record);
  // Valid inactive blueprints reproduce an oversized guest fleet without forged command fields.
  const parts = [];
  for (const kind of ['foundation', 'pillar', 'floor']) for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++)
    parts.push([kind, x, z, kind === 'floor' ? 1 : 0, 0]);
  const large = newRaft(parts); assert.equal(large.parts.length, 432);
  for (let i = 0; i < 4; i++) restored.profile.eco.ships.push({ ...copy(restored.ship), id: `test:inactive${i}`, at: 'sol', grid: copy(large) });
  assert.ok(saves.store(restored.profile).length > MAX_SAVE);
  const before = privateState(restored.profile, restored.ship), stock = server.world.economy.markets.aldea.stock.madera;
  wire(server, 72, { op: 'supply', id: restored.ship.id, expectedRev: restored.ship.rev, opId: 'signed-oversized-supply', g: 'madera', n: 1 });
  const denied = editEvent(messages, 72, 'signed-oversized-supply');
  assert.equal(denied.ok, false); assert.equal(denied.why, 'saveSize');
  assert.deepEqual(privateState(restored.profile, restored.ship), before);
  assert.equal(server.world.economy.markets.aldea.stock.madera, stock);
});

test('allowed foundation placement charges held wood before the owner pack, then deduplicates and fences stale operations', () => {
  const { server, messages, saved } = makeServer();
  const owner = join(server, 7, profileFixture({ woodInHold: 2, woodInPack: 2 }));
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  const mooredPose = { x: server.world.ecs.x[record.entity], y: server.world.ecs.y[record.entity],
    z: server.world.ecs.z[record.entity], yaw: server.world.ecs.facing[record.entity], berth: ship.berth };
  const piece = ['foundation', 0, 2, 0, 0], initial = privateState(profile, ship);
  const base = { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'place-foundation-1', piece };
  wire(server, 7, { ...base, owner: 9999, x: -9000, z: 9000, price: 0, cost: 0,
    resources: { madera: 99 }, hold: { goods: { madera: 99 } }, pack: { goods: { madera: 99 } }, grid: { parts: [['foundation', 99, 99, 0, 0]] } });
  const placed = editEvent(messages, 7, base.opId);
  assert.ok(placed);
  assert.equal(placed.ok, true);
  assert.equal(placed.rev, initial.rev + 1);
  assert.equal(ship.rev, initial.rev + 1);
  assert.deepEqual({ x: server.world.ecs.x[record.entity], y: server.world.ecs.y[record.entity],
    z: server.world.ecs.z[record.entity], yaw: server.world.ecs.facing[record.entity], berth: ship.berth }, mooredPose,
  'editing deck cells never changes the server-selected berth or authoritative raft pose');
  assert.equal(ship.grid.parts.filter((p) => p[0] === 'foundation' && p[1] === 0 && p[2] === 2).length, 1);
  assert.equal(ship.hold.goods.madera, undefined, 'the raft hold is charged first');
  assert.equal(profile.eco.pack.goods.madera, undefined, 'the remainder is charged from the owner pack');
  assert.equal(profile.gold, initial.gold, 'client cost claims cannot change gold');
  const afterPlace = privateState(profile, ship);

  wire(server, 7, base);
  const repeated = editEvent(messages, 7, base.opId);
  assert.ok(repeated, 'retries receive a private operation result');
  assert.equal(ship.rev, initial.rev + 1);
  assert.equal(ship.grid.parts.filter((p) => p[0] === 'foundation' && p[1] === 0 && p[2] === 2).length, 1);
  assert.equal(ship.hold.goods.madera, undefined);
  assert.equal(profile.eco.pack.goods.madera, undefined);

  wire(server, 7, { ...base, piece: ['foundation', 2, 1, 0, 0] });
  const opIdReuse = editEvent(messages, 7, base.opId);
  assert.ok(opIdReuse); assert.equal(opIdReuse.ok, false); assert.equal(opIdReuse.why, 'duplicate');
  assert.deepEqual(privateState(profile, ship), afterPlace, 'opId reuse cannot alter the accepted transaction');

  wire(server, 7, { ...base, opId: 'stale-after-place', piece: ['foundation', 2, 1, 0, 0] });
  const stale = editEvent(messages, 7, 'stale-after-place');
  assert.ok(stale); assert.equal(stale.ok, false); assert.equal(stale.why, 'revision');
  assert.equal(stale.record?.rev, ship.rev, 'stale replies carry the current public revision for client recovery');
  assert.deepEqual(privateState(profile, ship), afterPlace, 'a stale revision cannot spend or mutate again');

  wire(server, 7, { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'insufficient-wood', piece: ['foundation', 2, 1, 0, 0] });
  const insufficient = editEvent(messages, 7, 'insufficient-wood');
  assert.ok(insufficient); assert.equal(insufficient.ok, false); assert.equal(insufficient.why, 'goods');
  assert.deepEqual(privateState(profile, ship), afterPlace, 'insufficient combined stock is atomic');

  const client = new GameClient({ onMessage() {}, onSnapshot() {}, send() {}, sendInput() {}, start() {} }, map, { emit() {} });
  const deckPoint = pointOnRaft(server, record, 1, 5);
  const edge = pointOnRaft(server, record, 1, 3.72), ecs = server.world.ecs;
  ecs.x[owner] = edge.x; ecs.z[owner] = edge.z; ecs.y[owner] = 0.72;
  const local = client.pred.spawnPlayer({ name: 'Prediction fixture', x: edge.x, z: edge.z });
  client.youLocal = local; client.youServer = owner;
  const beforeEditSnapshot = publicRafts(server.world).map((r) => r.id === ship.id ? { ...r, parts: initial.parts } : r);
  const ownerState = server.world.playerState(owner);
  client.onSnapshot({ tick: 10, ack: 0, ents: [], you: ownerState, rafts: beforeEditSnapshot });
  assert.equal(client.pred.raftDeck.surface(edge.x, edge.z, 0.72)?.id, ship.id,
    'the reconciliation baseline has the old raft surface only');
  for (let i = 0; i < 40; i++) client.tickInput({ mx: 0, mz: 1, ax: 0, az: 1, btn: 0, prs: 0, w: 0 });
  assert.ok(client.pending.length, 'a real predicted movement command is pending across the old deck edge');
  const localPosition = (x, z) => {
    const dx = x - server.world.ecs.x[record.entity], dz = z - server.world.ecs.z[record.entity];
    const yaw = server.world.ecs.facing[record.entity];
    return { x: Math.cos(yaw) * dx - Math.sin(yaw) * dz, z: Math.sin(yaw) * dx + Math.cos(yaw) * dz };
  };
  const oldEdgePosition = localPosition(client.pred.ecs.x[local], client.pred.ecs.z[local]);
  assert.ok(oldEdgePosition.z < 4.05, 'without the new surface, prediction remains at the old foundation edge');
  const expandedSnapshot = publicRafts(server.world);
  client.onSnapshot({ tick: 11, ack: 0, ents: [], you: ownerState, rafts: expandedSnapshot });
  const replayedPosition = localPosition(client.pred.ecs.x[local], client.pred.ecs.z[local]);
  assert.ok(replayedPosition.z > oldEdgePosition.z + 0.3, 'the same pending commands advance after refreshed geometry arrives');
  assert.equal(client.pred.raftDeck.surface(client.pred.ecs.x[local], client.pred.ecs.z[local], client.pred.ecs.y[local])?.id, ship.id,
    'new geometry is installed before unacknowledged movement is replayed');
  assert.equal(client.pred.raftDeck.surface(deckPoint.x, deckPoint.z, 0.72)?.id, ship.id,
    'the accepted public snapshot installs newly placed deck geometry in prediction');

  const pieceIndex = ship.grid.parts.findIndex((p) => p[0] === piece[0] && p[1] === piece[1] && p[2] === piece[2]);
  const wrongIdentity = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-wrong-identity', index: pieceIndex,
    piece: ['foundation', 1, 1, 0, 0] };
  wire(server, 7, wrongIdentity);
  const wrongPiece = editEvent(messages, 7, wrongIdentity.opId);
  assert.ok(wrongPiece); assert.equal(wrongPiece.ok, false);
  assert.deepEqual(privateState(profile, ship), afterPlace, 'a stale index identity cannot withdraw another piece');

  load(ship.hold, 'hierro', 2);
  load(profile.eco.pack, 'madera', 3);
  const fullState = privateState(profile, ship);
  const cannotRefund = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-no-refund-capacity', index: pieceIndex, piece };
  wire(server, 7, cannotRefund);
  const room = editEvent(messages, 7, cannotRefund.opId);
  assert.ok(room); assert.equal(room.ok, false); assert.equal(room.why, 'room');
  assert.deepEqual(privateState(profile, ship), fullState, 'a refund that cannot fit is rejected before plan or goods change');

  ship.hold.goods = {}; profile.eco.pack.goods = {};
  const remove = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-extra-foundation', index: pieceIndex, piece };
  wire(server, 7, remove);
  const removed = editEvent(messages, 7, remove.opId);
  assert.ok(removed); assert.equal(removed.ok, true); assert.equal(removed.rev, afterPlace.rev + 1);
  assert.deepEqual(partList(ship), initial.parts);
  assert.equal(ship.hold.goods.madera, 2, 'half-cost refund fills the raft hold first');
  assert.equal(profile.eco.pack.goods.madera, undefined);
  client.onSnapshot({ tick: 12, ack: 0, ents: [], you: ownerState, rafts: publicRafts(server.world) });
  assert.equal(client.pred.rafts[0].rev, ship.rev);
  assert.equal(client.pred.raftDeck.surface(deckPoint.x, deckPoint.z, 0.72), null,
    'the next full snapshot removes deleted deck support from prediction');

  server.connect(9);
  server.broadcastSnapshot();
  const lateSnapshot = messages.get(9).filter((m) => m.t === MSG.SNAPSHOT).at(-1);
  assert.equal(lateSnapshot.rafts.length, 1);
  assert.equal(lateSnapshot.rafts[0].rev, ship.rev);
  assert.deepEqual(lateSnapshot.rafts[0].parts, initial.parts);
  assert.equal(lateSnapshot.rafts[0].hold, undefined);
  assert.ok(!JSON.stringify(lateSnapshot.rafts).includes('goods'), 'late snapshots publish the blueprint but no cargo');

  server.disconnect(7);
  const persisted = saved.get(7);
  assert.ok(persisted, 'accepted plan changes are saved on disconnect');
  const returned = join(server, 8, persisted), restored = ownShip(server, returned);
  assert.equal(restored.ship.id, ship.id);
  assert.equal(restored.ship.rev, ship.rev);
  assert.deepEqual(partList(restored.ship), initial.parts);
  assert.deepEqual(restored.ship.berthBasis, ship.berthBasis, 'rejoin retains the saved berth basis independently of later edits');
  assert.deepEqual({ x: server.world.ecs.x[restored.record.entity], y: server.world.ecs.y[restored.record.entity],
    z: server.world.ecs.z[restored.record.entity], yaw: server.world.ecs.facing[restored.record.entity], berth: restored.ship.berth }, mooredPose,
  'disconnect and rejoin restore the same approved local mooring, never a client pose');
  assert.deepEqual(restored.ship.hold, ship.hold);
  assert.deepEqual(restored.profile.eco.pack, profile.eco.pack);
  assert.equal(restored.profile.gold, profile.gold);
});

test('read-only village quote and supply buy real goods once with actual price, shared capacity, and atomic failures', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 11, profileFixture({ gold: 10000 }));
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  const initial = privateState(profile, ship);
  const quoteRequest = { op: 'quote', id: ship.id, expectedRev: ship.rev };
  wire(server, 11, quoteRequest);
  const quote = editEvent(messages, 11);
  assert.ok(quote); assert.equal(quote.ok, true); assert.equal(quote.rev, initial.rev);
  assert.deepEqual(privateState(profile, ship), initial, 'quote cannot mutate wallet, cargo, plan, or revision');
  const woodQuote = quote.supplies.find((s) => s.g === 'madera');
  assert.ok(woodQuote && woodQuote.n === 1 && woodQuote.price > 0 && woodQuote.stock > 0);

  const trueFourUnitQuote = server.world.economy.quote('aldea', 'madera', 4, 'buy');
  const purchase = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'buy-four-wood', g: 'madera', n: 4,
    price: 1, total: 1, stock: 999999, pack: { goods: { madera: 99 } }, hold: { goods: { madera: 99 } } };
  wire(server, 11, purchase);
  const bought = editEvent(messages, 11, purchase.opId);
  assert.ok(bought); assert.equal(bought.ok, true); assert.equal(bought.n, 4);
  assert.equal(bought.total, trueFourUnitQuote.total, 'the server charged the live market price, ignoring the client claim');
  assert.equal(profile.gold, initial.gold - bought.total);
  assert.equal(ship.hold.goods.madera, 2, 'available raft hold is filled first');
  assert.equal(profile.eco.pack.goods.madera, 2, 'remaining goods go to the owner pack');
  assert.equal(ship.rev, initial.rev + 1);

  wire(server, 11, purchase);
  const duplicate = editEvent(messages, 11, purchase.opId);
  assert.ok(duplicate); assert.equal(profile.gold, initial.gold - bought.total);
  assert.equal(ship.hold.goods.madera, 2); assert.equal(profile.eco.pack.goods.madera, 2);
  assert.equal(ship.rev, initial.rev + 1, 'retry cannot repeat market debit or revision bump');

  const afterPurchaseQuote = (() => {
    wire(server, 11, { ...quoteRequest, expectedRev: ship.rev });
    return editEvent(messages, 11);
  })();
  const nextWoodPrice = afterPurchaseQuote.supplies.find((s) => s.g === 'madera').price;
  const forgedPricePurchase = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'buy-one-forged-price', g: 'madera', n: 1, price: 0 };
  wire(server, 11, forgedPricePurchase);
  const actualPurchase = editEvent(messages, 11, forgedPricePurchase.opId);
  assert.ok(actualPurchase); assert.equal(actualPurchase.ok, true);
  assert.equal(actualPurchase.total, nextWoodPrice);
  assert.equal(profile.gold, initial.gold - bought.total - nextWoodPrice);
  assert.equal(ship.rev, initial.rev + 2);

  const beforeFailure = privateState(profile, ship);
  const noRoom = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'buy-no-capacity', g: 'madera', n: 2 };
  wire(server, 11, noRoom);
  const roomFailure = editEvent(messages, 11, noRoom.opId);
  assert.ok(roomFailure); assert.equal(roomFailure.ok, false); assert.equal(roomFailure.why, 'room');
  assert.deepEqual(privateState(profile, ship), beforeFailure, 'combined capacity is checked before market or hold mutation');

  for (const [suffix, payload] of [
    ['bad-good', { g: 'oro', n: 1 }], ['zero', { g: 'hierro', n: 0 }], ['over-limit', { g: 'hierro', n: 11 }],
  ]) {
    const invalid = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: `invalid-supply-${suffix}`, ...payload };
    wire(server, 11, invalid);
    const denied = editEvent(messages, 11, invalid.opId);
    assert.ok(denied); assert.equal(denied.ok, false);
    assert.deepEqual(privateState(profile, ship), beforeFailure, `${suffix} supply request is atomic`);
  }

  ship.hold.goods = {}; profile.eco.pack.goods = {}; profile.gold = 0;
  const beforeGoldFailure = privateState(profile, ship);
  const marketBefore = (() => {
    wire(server, 11, { ...quoteRequest, expectedRev: ship.rev });
    return editEvent(messages, 11).supplies.find((s) => s.g === 'madera');
  })();
  const noGold = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'buy-without-gold', g: 'madera', n: 1 };
  wire(server, 11, noGold);
  const goldFailure = editEvent(messages, 11, noGold.opId);
  assert.ok(goldFailure); assert.equal(goldFailure.ok, false); assert.equal(goldFailure.why, 'gold');
  assert.deepEqual(privateState(profile, ship), beforeGoldFailure, 'insufficient gold does not change any ledger');
  wire(server, 11, { ...quoteRequest, expectedRev: ship.rev });
  const marketAfter = editEvent(messages, 11).supplies.find((s) => s.g === 'madera');
  assert.equal(marketAfter.stock, marketBefore.stock, 'failed purchase leaves market stock unchanged');
});

test('supply preflight rejects wood when neither fragmented hold can fit one weighted unit', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 16, profileFixture({ gold: 10000 }));
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  // Wood weighs three slots. Each container has two free slots, so the combined nominal space is four,
  // but neither can accept a whole unit. The server must preflight both before touching the market.
  ship.hold.goods.fruta = 4; profile.eco.pack.goods.fruta = 8;
  const before = privateState(profile, ship);
  wire(server, 16, { op: 'quote', id: ship.id, expectedRev: ship.rev });
  const quote = editEvent(messages, 16);
  const stockBefore = quote.supplies.find((s) => s.g === 'madera').stock;
  const request = { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'wood-fragmented-capacity', g: 'madera', n: 1 };
  wire(server, 16, request);
  const refused = editEvent(messages, 16, request.opId);
  assert.ok(refused); assert.equal(refused.ok, false); assert.equal(refused.why, 'room');
  assert.deepEqual(privateState(profile, ship), before, 'unfillable unit leaves both holds, gold, revision, and plan unchanged');
  wire(server, 16, { op: 'quote', id: ship.id, expectedRev: ship.rev });
  const stockAfter = editEvent(messages, 16).supplies.find((s) => s.g === 'madera').stock;
  assert.equal(stockAfter, stockBefore, 'failed preflight does not reserve or consume market stock');
});

test('placing a second crate grows authoritative capacity and persists that cap across reconnect', () => {
  const { server, messages, saved } = makeServer();
  const owner = join(server, 18, profileFixture({ gold: 10000 }));
  const { ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  const initialCap = ship.hold.cap;
  assert.equal(initialCap, 6);
  wire(server, 18, { op: 'supply', id: ship.id, expectedRev: ship.rev, opId: 'second-crate-stock', g: 'madera', n: 2 });
  const bought = editEvent(messages, 18, 'second-crate-stock');
  assert.ok(bought); assert.equal(bought.ok, true);
  wire(server, 18, { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'place-second-crate', piece: ['crate', 1, 0, 0, 0] });
  const placed = editEvent(messages, 18, 'place-second-crate');
  assert.ok(placed); assert.equal(placed.ok, true);
  assert.equal(ship.hold.cap, 12, 'the editor recalculates hold capacity from both crates');
  assert.deepEqual(ship.hold.goods, {}, 'construction consumes the purchased wood from the hold');

  server.disconnect(18);
  const persisted = saved.get(18);
  assert.ok(persisted);
  const returned = join(server, 19, persisted), restored = ownShip(server, returned);
  assert.equal(restored.ship.hold.cap, 12, 'sanitization/rejoin restores the plan-derived capacity');
  assert.equal(restored.ship.hold.cap, raftStats(restored.ship.grid).hold);
  assert.equal(restored.ship.grid.parts.filter((p) => p[0] === 'crate').length, 2);
});

test('placing the last wall across a visitor’s only room exit is denied without moving or charging anyone', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 21, profileFixture({ gold: 50000 }));
  const visitor = join(server, 22);
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record, 1, 1);
  const supply = (n, opId) => {
    wire(server, 21, { op: 'supply', id: ship.id, expectedRev: ship.rev, opId, g: 'madera', n });
    const event = editEvent(messages, 21, opId);
    assert.ok(event); assert.equal(event.ok, true, `test construction stock ${opId}`);
  };
  const placeWall = (dir, opId) => {
    wire(server, 21, { op: 'place', id: ship.id, expectedRev: ship.rev, opId, piece: ['wall', 1, 0, 0, dir] });
    const event = editEvent(messages, 21, opId);
    assert.ok(event); assert.equal(event.ok, true, `test room wall ${dir}`);
  };
  // Buy only what fits, place a wall, and repeat; the real server supply route keeps each fixture purchase legal.
  for (const dir of [0, 2, 3]) {
    supply(3, `room-wall-goods-${dir}`);
    placeWall(dir, `room-wall-${dir}`);
  }
  const publicBefore = publicRafts(server.world).find((r) => r.id === ship.id);
  const gangplank = raftGangplank(publicBefore, server.world.map.dock);
  assert.ok(gangplank, 'the occupied room belongs to a raft with its live dock exit');
  const guestPoint = pointOnRaft(server, record, 3, 1); // Cell (1,0), enclosed on north/south/west.
  const plankEnd = { x: gangplank.x + Math.sin(gangplank.yaw) * gangplank.length / 2,
    z: gangplank.z + Math.cos(gangplank.yaw) * gangplank.length / 2 };
  const ecs = server.world.ecs;
  ecs.x[visitor] = guestPoint.x; ecs.z[visitor] = guestPoint.z; ecs.y[visitor] = 0.72;
  assert.equal(server.world.raftDeck.surface(guestPoint.x, guestPoint.z, 0.72)?.id, ship.id);
  assert.equal(server.world.raftDeck.surface(plankEnd.x, plankEnd.z, 0.72)?.id, ship.id,
    'the sole opening on the east side leads to the connected dock gangplank');
  const visitorBefore = { x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] };
  const wall = ['wall', 1, 0, 0, 1];
  supply(3, 'last-wall-goods');
  const beforeWall = privateState(profile, ship);
  wire(server, 21, { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'close-only-room-exit', piece: wall });
  const denied = editEvent(messages, 21, 'close-only-room-exit');
  assert.ok(denied); assert.equal(denied.ok, false); assert.equal(denied.why, 'occupied');
  assert.deepEqual(privateState(profile, ship), beforeWall, 'the refused enclosure keeps owner inventory, plan, and revision intact');
  assert.deepEqual({ x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] }, visitorBefore,
    'the server never teleports the visitor to manufacture an escape');
  assert.ok(!ship.grid.parts.some((p) => p[0] === wall[0] && p[1] === wall[1] && p[2] === wall[2] && p[4] === wall[4]));
  assert.deepEqual(ship.grid.parts.filter((p) => p[0] === 'wall').map((p) => p[4]).sort(), [0, 2, 3],
    'the room retains its three prior walls and the only opening is unchanged');
});

test('occupied floors and stairs plus structural supports and body blockers are protected atomically', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 31, profileFixture({ gold: 50000 }));
  const visitor = join(server, 32);
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record, 1, 1);
  const buy = (n, opId) => {
    wire(server, 31, { op: 'supply', id: ship.id, expectedRev: ship.rev, opId, g: 'madera', n });
    const ev = editEvent(messages, 31, opId);
    assert.ok(ev); assert.equal(ev.ok, true);
  };
  const place = (piece, opId) => {
    wire(server, 31, { op: 'place', id: ship.id, expectedRev: ship.rev, opId, piece });
    const ev = editEvent(messages, 31, opId);
    assert.ok(ev); assert.equal(ev.ok, true, `server accepted fixture piece ${piece[0]}: ${JSON.stringify(ev)}`);
  };
  buy(5, 'upper-floor-materials');
  place(['pillar', 0, 1, 0, 0], 'upper-floor-pillar');
  place(['floor', 0, 1, 1, 0], 'upper-floor');
  buy(4, 'stairs-materials');
  place(['stairs', 1, 0, 0, 0], 'walkable-stairs');

  const ecs = server.world.ecs;
  const upper = pointOnRaft(server, record, 1, 3);
  ecs.x[visitor] = upper.x; ecs.z[visitor] = upper.z; ecs.y[visitor] = 0.72 + RAFT.levelHeight;
  const upperSurface = server.world.raftDeck.surface(upper.x, upper.z, ecs.y[visitor]);
  assert.equal(upperSurface?.kind, 'deck'); assert.equal(upperSurface.id, ship.id);
  const beforeFloorRemoval = privateState(profile, ship), floorIndex = ship.grid.parts.findIndex((p) => p[0] === 'floor');
  const floorRemoval = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-occupied-upper-floor', index: floorIndex,
    piece: [...ship.grid.parts[floorIndex]] };
  const visitorBeforeFloor = { x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] };
  wire(server, 31, floorRemoval);
  const floorDenied = editEvent(messages, 31, floorRemoval.opId);
  assert.ok(floorDenied); assert.equal(floorDenied.ok, false); assert.equal(floorDenied.why, 'occupied');
  assert.deepEqual(privateState(profile, ship), beforeFloorRemoval);
  assert.deepEqual({ x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] }, visitorBeforeFloor);

  const pillarIndex = ship.grid.parts.findIndex((p) => p[0] === 'pillar');
  const supportRemoval = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-needed-pillar', index: pillarIndex,
    piece: [...ship.grid.parts[pillarIndex]] };
  wire(server, 31, supportRemoval);
  const supportDenied = editEvent(messages, 31, supportRemoval.opId);
  assert.ok(supportDenied); assert.equal(supportDenied.ok, false); assert.equal(supportDenied.why, 'needed');
  assert.deepEqual(privateState(profile, ship), beforeFloorRemoval, 'support removal cannot orphan the upper floor');

  const stairPoint = pointOnRaft(server, record, 3, 1);
  ecs.x[visitor] = stairPoint.x; ecs.z[visitor] = stairPoint.z; ecs.y[visitor] = 0.72 + RAFT.levelHeight / 2;
  assert.equal(server.world.raftDeck.surface(stairPoint.x, stairPoint.z, ecs.y[visitor])?.kind, 'stairs');
  const stairIndex = ship.grid.parts.findIndex((p) => p[0] === 'stairs');
  const stairRemoval = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-occupied-stairs', index: stairIndex,
    piece: [...ship.grid.parts[stairIndex]] };
  const beforeStairRemoval = privateState(profile, ship), visitorBeforeStairs = { x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] };
  wire(server, 31, stairRemoval);
  const stairsDenied = editEvent(messages, 31, stairRemoval.opId);
  assert.ok(stairsDenied); assert.equal(stairsDenied.ok, false); assert.equal(stairsDenied.why, 'occupied');
  assert.deepEqual(privateState(profile, ship), beforeStairRemoval);
  assert.deepEqual({ x: ecs.x[visitor], y: ecs.y[visitor], z: ecs.z[visitor] }, visitorBeforeStairs);

  buy(3, 'blocker-materials');
  const wallPoint = pointOnRaft(server, record, 2, 3);
  ecs.x[visitor] = wallPoint.x; ecs.z[visitor] = wallPoint.z; ecs.y[visitor] = 0.72;
  const wall = ['wall', 0, 1, 0, 1], beforeWall = privateState(profile, ship);
  const blocker = { op: 'place', id: ship.id, expectedRev: ship.rev, opId: 'block-visitor', piece: wall };
  wire(server, 31, blocker);
  const blocked = editEvent(messages, 31, blocker.opId);
  assert.ok(blocked); assert.equal(blocked.ok, false); assert.equal(blocked.why, 'occupied');
  assert.deepEqual(privateState(profile, ship), beforeWall, 'blocking a visitor is refused before charging material');
  assert.equal(ship.hold.cap, raftStats(ship.grid).hold, 'denials never alter the crate-derived hold cap');
});

test('crate removal shrinks hold capacity by moving goods into the pack before adding its refund', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 41, profileFixture());
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  load(ship.hold, 'madera', 2); // Full six-unit crate hold; the pack has room for the transfer and refund.
  const before = privateState(profile, ship), index = ship.grid.parts.findIndex((p) => p[0] === 'crate');
  const crate = [...ship.grid.parts[index]];
  const request = { op: 'remove', id: ship.id, expectedRev: ship.rev, opId: 'remove-crate-with-cargo', index, piece: crate };
  wire(server, 41, request);
  const result = editEvent(messages, 41, request.opId);
  assert.ok(result); assert.equal(result.ok, true); assert.equal(result.rev, before.rev + 1);
  assert.equal(ship.hold.cap, 0, 'removing the only storage piece removes its capacity');
  assert.deepEqual(ship.hold.goods, {}, 'no goods remain in a zero-capacity hold');
  assert.equal(profile.eco.pack.goods.madera, 3, 'two carried units plus the permitted one-unit crate refund survive in the pack');
  assert.equal(ship.hold.cap, raftStats(ship.grid).hold);
  assert.equal(ship.grid.parts.some((p) => p[0] === 'crate'), false);
  assert.equal(profile.gold, before.gold);
});

test('crate removal chooses a lossless cargo transfer independent of goods insertion order', () => {
  const { server, messages } = makeServer();
  const owner = join(server, 43, profileFixture());
  const { profile, ship, record } = ownShip(server, owner);
  standOn(server, owner, record);
  ship.grid.parts.push(['crate', 1, 0, 0, 0]);
  ship.hold.cap = raftStats(ship.grid).hold;
  load(ship.hold, 'madera', 1); load(ship.hold, 'agua', 5);
  load(profile.eco.pack, 'fruta', 5);
  server.world.raftDeck.update(publicRafts(server.world));
  const index = ship.grid.parts.length - 1;
  wire(server, 43, { op: 'remove', id: ship.id, expectedRev: ship.rev,
    opId: 'remove-crate-mixed-cargo', index, piece: [...ship.grid.parts[index]] });
  const result = editEvent(messages, 43, 'remove-crate-mixed-cargo');
  assert.equal(result.ok, true);
  assert.equal(ship.hold.cap, 6);
  assert.deepEqual(ship.hold.goods, { madera: 1, agua: 3 });
  assert.deepEqual(profile.eco.pack.goods, { fruta: 5, agua: 2, madera: 1 });
  assert.equal(ship.rev, 2);
});
