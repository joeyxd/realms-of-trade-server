import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { createNavalStructure } from '../src/sim/naval/structure.js';
import { encodeRaftCondition, persistRaftCondition } from '../src/sim/naval/condition.js';
import { applyPartDamage } from '../src/sim/naval/structure.js';
import { raftLanternCmd } from '../src/sim/systems/raftLanterns.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';
import { hmacSaves } from '../server/saves.mjs';

const copy = (v) => structuredClone(v);
function profileWithLantern({ placed = true, wood = 0, iron = 0 } = {}) {
  const p = newProfile(), ship = p.eco.ships.find((s) => s.kind === 'raft');
  if (placed) ship.grid = newRaft([...ship.grid.parts, ['lantern', 0, 1, 0, 0]]);
  p.eco.pack.goods = Object.fromEntries([['madera', wood], ['hierro', iron]].filter(([, n]) => n));
  ship.condition = encodeRaftCondition(createNavalStructure(ship.grid.parts.map((part, i) => ({ id: `piece${i + 1}`, part }))), ship.grid.parts.length + 1);
  return p;
}
function profileWithDestroyedUpperFloor() {
  const p = profileWithLantern({ placed: false, wood: 1, iron: 1 }), ship = p.eco.ships.find((s) => s.kind === 'raft');
  ship.grid = newRaft([...ship.grid.parts, ['pillar', 1, 0, 0, 0], ['floor', 1, 0, 1, 0]]);
  const structure = createNavalStructure(ship.grid.parts.map((part, i) => ({ id: `piece${i + 1}`, part })));
  const floor = structure.entries.find((entry) => entry.part[0] === 'floor');
  ship.condition = encodeRaftCondition(applyPartDamage(structure, floor.id, floor.hp).structure, ship.grid.parts.length + 1);
  return p;
}
function setup(profile = profileWithLantern(), trustedProfile = true) {
  const messages = new Map(), saves = hmacSaves('raft-lantern-local-test');
  const server = new LocalServer({ seed: 31, bots: 0, enemies: false, saves,
    send(id, m) { const list = messages.get(id) || []; list.push(copy(m)); messages.set(id, list); } });
  const join = (id, savedProfile = undefined, save = '') => {
    server.connect(id); server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Lamp ${id}`, skin: 0, weapon: 0, save }, savedProfile);
    return server.clients.get(id).entity;
  };
  const owner = trustedProfile ? join(1, profile) : join(1, undefined, saves.store(profile)), guest = join(2, newProfile());
  const source = [...server.world.rafts.values()].find((r) => r.owner === owner);
  assert.ok(source);
  const lamp = source.condition.entries.find((e) => e.part[0] === 'lantern');
  return { server, messages, saves, owner, guest, source, lamp, profile: server.world.profiles.get(owner), ship: source.ship };
}
function pos(ctx, e, source = ctx.source, dx = 1.1, yOffset = 0) {
  const record = publicRafts(ctx.server.world).find((r) => r.id === source.ship.id), part = source.condition.entries.find((x) => x.part[0] === 'lantern').part;
  const p = lanternPoint(record, part), ecs = ctx.server.world.ecs;
  ecs.x[e] = p.x + dx; ecs.y[e] = p.y + yOffset; ecs.z[e] = p.z;
  ecs.moveMag[e] = ecs.vx[e] = ecs.vz[e] = 0;
  return p;
}
function latest(ctx, id, opId) { return [...(ctx.messages.get(ctx.server.clientOf(id)) || [])].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === 'raftLantern' && (!opId || m.ev.opId === opId))?.ev || null; }
function request(ctx, id, lit, expectedLit, opId, source = ctx.source, lamp = ctx.lamp) {
  const c = ctx.server.clientOf(id);
  ctx.server.receive(c, { t: MSG.CMD, type: 'raftLantern', id: source.ship.id, partId: lamp.id,
    expectedRev: source.ship.rev, expectedLit, lit, opId }); ctx.server.flushEvents();
  return latest(ctx, id, opId);
}
function wireEdit(ctx, op, piece, index) {
  const { server, owner, ship } = ctx, id = server.clientOf(owner), opId = `lamp-edit-${op}-${Math.random().toString(36).slice(2, 7)}`;
  const ecs = server.world.ecs, raft = server.world.rafts.get(ship.id), yaw = ecs.facing[raft.entity];
  ecs.x[owner] = ecs.x[raft.entity] + Math.cos(yaw) + Math.sin(yaw); ecs.y[owner] = ecs.y[raft.entity];
  ecs.z[owner] = ecs.z[raft.entity] - Math.sin(yaw) + Math.cos(yaw); ecs.moveMag[owner] = ecs.vx[owner] = ecs.vz[owner] = 0;
  server.receive(server.clientOf(owner), { t: MSG.CMD, type: 'raft', op, id: ship.id, expectedRev: ship.rev, opId,
    ...(piece ? { piece } : {}), ...(index === undefined ? {} : { index }) }); server.flushEvents();
  return [...(ctx.messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === 'raftEdit' && m.ev.opId === opId)?.ev;
}

test('editor charges a lantern on live deck and rejects an unsupported floor without charging', () => {
  const ctx = setup(profileWithLantern({ placed: false, wood: 1, iron: 1 }));
  const accepted = wireEdit(ctx, 'place', ['lantern', 0, 1, 0, 0]);
  assert.equal(accepted?.ok, true);
  assert.deepEqual(ctx.profile.eco.pack.goods, {});
  const source = ctx.source, entry = source.condition.entries.find((e) => e.part[0] === 'lantern');
  assert.ok(entry?.hp > 0);
  assert.deepEqual(ctx.ship.litLanterns || [], [], 'newly constructed lantern starts off');
  assert.deepEqual(publicRafts(ctx.server.world).find((r) => r.id === ctx.ship.id).litLanterns, []);
  ctx.profile.eco.pack.goods = { madera: 1, hierro: 1 };
  const refused = wireEdit(ctx, 'place', ['lantern', 8, 8, 1, 0]);
  assert.equal(refused?.ok, false); assert.ok(['deck', 'support'].includes(refused?.why));
  assert.deepEqual(ctx.profile.eco.pack.goods, { madera: 1, hierro: 1 });

  const deadFloor = setup(profileWithDestroyedUpperFloor());
  const upperLamp = wireEdit(deadFloor, 'place', ['lantern', 1, 0, 1, 0]);
  assert.equal(upperLamp?.ok, false); assert.equal(upperLamp?.why, 'deck', 'a destroyed floor cannot support a new lantern');
  assert.deepEqual(deadFloor.profile.eco.pack.goods, { madera: 1, hierro: 1 });
});

test('owner and nearby visitor use desired lantern state; retries are idempotent and state conflicts are fenced', () => {
  const ctx = setup(); pos(ctx, ctx.owner); pos(ctx, ctx.guest);
  const rev = ctx.ship.rev, intent = { lit: true, expectedLit: false, opId: 'guest-lantern-on' };
  const noOp = request(ctx, ctx.owner, false, false, 'already-dark');
  assert.equal(noOp?.ok, true); assert.equal(noOp.changed, false);
  assert.equal(request(ctx, ctx.owner, false, false, 'already-dark')?.replay, true,
    'repeating accepted no-op retains its receipt without causing an effect');
  const on = request(ctx, ctx.guest, intent.lit, intent.expectedLit, intent.opId);
  assert.equal(on?.ok, true); assert.equal(on.changed, true); assert.deepEqual(ctx.ship.litLanterns, [ctx.lamp.id]);
  assert.equal(ctx.ship.rev, rev);
  const replay = request(ctx, ctx.guest, true, false, intent.opId);
  assert.equal(replay?.ok, true); assert.equal(replay.replay, true); assert.equal(replay.changed, false);
  const conflict = request(ctx, ctx.guest, false, true, intent.opId);
  assert.equal(conflict?.ok, false); assert.equal(conflict.why, 'duplicate');
  assert.deepEqual(ctx.ship.litLanterns, [ctx.lamp.id]);
  const ownerOff = request(ctx, ctx.owner, false, true, 'owner-lantern-off');
  assert.equal(ownerOff?.ok, true); assert.deepEqual(ctx.ship.litLanterns || [], []);
});

test('paused and tick-blocked sessions cannot operate lanterns or allocate receipts', () => {
  const ctx = setup(); pos(ctx, ctx.guest);
  const client = ctx.server.clients.get(ctx.server.clientOf(ctx.guest)), before = copy(ctx.profile);
  client.paused = true;
  ctx.server.receive(ctx.server.clientOf(ctx.guest), { t: MSG.CMD, type: 'raftLantern', id: ctx.ship.id,
    partId: ctx.lamp.id, expectedRev: ctx.ship.rev, expectedLit: false, lit: true, opId: 'paused-lamp' });
  ctx.server.flushEvents();
  assert.equal(latest(ctx, ctx.guest, 'paused-lamp'), null, 'paused session emits no usable acknowledgement');
  client.paused = false; ctx.server.tickBlocked = true;
  ctx.server.receive(ctx.server.clientOf(ctx.guest), { t: MSG.CMD, type: 'raftLantern', id: ctx.ship.id,
    partId: ctx.lamp.id, expectedRev: ctx.ship.rev, expectedLit: false, lit: true, opId: 'blocked-lamp' });
  ctx.server.flushEvents();
  assert.equal(latest(ctx, ctx.guest), null, 'a blocked tick emits no mutation result');
  assert.deepEqual(ctx.profile, before);
  assert.equal(ctx.server.world.raftLanternReceipts?.has(ctx.guest) || false, false);
  ctx.server.tickBlocked = false;
  assert.equal(request(ctx, ctx.guest, true, false, 'normal-lamp')?.ok, true);
  assert.equal(ctx.server.world.raftLanternReceipts.has(ctx.guest), true);
});

test('receipt history stays bounded to 64 accepted operations per actor', () => {
  const ctx = setup(); pos(ctx, ctx.owner);
  for (let i = 0; i < 70; i++) {
    const reply = raftLanternCmd(ctx.server.world, ctx.owner, { type: 'raftLantern', id: ctx.ship.id, partId: ctx.lamp.id,
      expectedRev: ctx.ship.rev, expectedLit: false, lit: false, opId: `bounded-${i}` });
    assert.equal(reply.ok, true); assert.equal(reply.changed, false);
  }
  assert.equal(ctx.server.world.raftLanternReceipts.get(ctx.owner).size, 64);
  assert.equal(ctx.server.world.raftLanternReceipts.get(ctx.owner).has('bounded-0'), false);
});

test('far, wrong-floor, destroyed, stale-state, and save-preflight requests are atomic', () => {
  const ctx = setup(); pos(ctx, ctx.guest, ctx.source, 4);
  const far = request(ctx, ctx.guest, true, false, 'lamp-far');
  assert.equal(far?.ok, false); assert.equal(far.why, 'far');
  pos(ctx, ctx.guest, ctx.source, 0, 0.61);
  const otherFloor = request(ctx, ctx.guest, true, false, 'lamp-floor');
  assert.equal(otherFloor?.ok, false); assert.equal(otherFloor.why, 'far');
  pos(ctx, ctx.guest);
  const stale = request(ctx, ctx.guest, true, true, 'lamp-stale-state');
  assert.equal(stale?.ok, false); assert.equal(stale.why, 'revision');

  const beforeProfile = copy(ctx.profile), beforeLamps = copy(ctx.ship.litLanterns || []);
  pos(ctx, ctx.owner);
  const cmd = { type: 'raftLantern', id: ctx.ship.id, partId: ctx.lamp.id, expectedRev: ctx.ship.rev,
    expectedLit: false, lit: true, opId: 'fit-preflight-denied' };
  const ack = raftLanternCmd(ctx.server.world, ctx.owner, cmd, () => false);
  assert.equal(ack.ok, false); assert.equal(ack.why, 'saveSize');
  assert.deepEqual(ctx.profile, beforeProfile); assert.deepEqual(ctx.ship.litLanterns || [], beforeLamps);

  ctx.source.condition = applyPartDamage(ctx.source.condition, ctx.lamp.id, ctx.lamp.hp).structure;
  persistRaftCondition(ctx.source);
  const record = publicRafts(ctx.server.world).find((r) => r.id === ctx.ship.id);
  assert.deepEqual(record.litLanterns, [], 'destroyed lantern no longer publishes active light geometry');
  const dead = request(ctx, ctx.guest, true, false, 'lamp-destroyed');
  assert.equal(dead?.ok, false); assert.equal(dead.why, 'condition');
  const sanitized = sanitizeProfile(ctx.profile);
  assert.deepEqual(sanitized.eco.ships.find((s) => s.id === ctx.ship.id).litLanterns || [], [], 'persisted destroyed state prunes the light selection');
  const beforeRepairGoods = { madera: 1, hierro: 1 };
  ctx.profile.eco.pack.goods = { ...beforeRepairGoods };
  const id = ctx.server.clientOf(ctx.owner), opId = 'repair-destroyed-lantern';
  const ecs = ctx.server.world.ecs, raft = ctx.server.world.rafts.get(ctx.ship.id), yaw = ecs.facing[raft.entity];
  ecs.x[ctx.owner] = ecs.x[raft.entity] + Math.cos(yaw) + Math.sin(yaw); ecs.y[ctx.owner] = ecs.y[raft.entity];
  ecs.z[ctx.owner] = ecs.z[raft.entity] - Math.sin(yaw) + Math.cos(yaw); ecs.moveMag[ctx.owner] = ecs.vx[ctx.owner] = ecs.vz[ctx.owner] = 0;
  const pieceIndex = ctx.ship.grid.parts.findIndex((p) => p[0] === 'lantern');
  ctx.server.receive(id, { t: MSG.CMD, type: 'raft', op: 'repair', id: ctx.ship.id, expectedRev: ctx.ship.rev, opId,
    index: pieceIndex, piece: ctx.ship.grid.parts[pieceIndex], partId: ctx.lamp.id, expectedHp: 0 }); ctx.server.flushEvents();
  const repairedAck = [...(ctx.messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === 'raftEdit' && m.ev.opId === opId)?.ev;
  assert.equal(repairedAck?.ok, true);
  assert.equal(ctx.source.condition.entries.find((e) => e.id === ctx.lamp.id).hp, ctx.lamp.maxHp);
  assert.deepEqual(ctx.profile.eco.pack.goods, {}, 'repair charges its material cost');
  assert.deepEqual(ctx.ship.litLanterns || [], [], 'paid repair does not relight the prior destroyed instance');
});

test('signed owner save sanitizes and restores lit instance state; rebuilding gets a distinct unlit identity', () => {
  const ctx = setup(profileWithLantern(), false), { server, saves, owner, source, lamp, ship } = ctx; pos(ctx, owner);
  assert.equal(request(ctx, owner, true, false, 'durable-lamp-on')?.ok, true);
  server.sendSave(server.clientOf(owner), server.clients.get(server.clientOf(owner)));
  const blob = (ctx.messages.get(1) || []).filter((m) => m.t === MSG.SAVE).at(-1)?.blob;
  assert.ok(blob);
  const decoded = saves.load(blob);
  assert.deepEqual(decoded.eco.ships[0].litLanterns, [lamp.id]);
  assert.deepEqual(sanitizeProfile(decoded).eco.ships[0].litLanterns, [lamp.id]);
  server.disconnect(1); server.connect(3);
  server.receive(3, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Lantern return', skin: 0, weapon: 0, save: blob });
  const returned = server.clients.get(3).entity, returnedShip = server.world.profiles.get(returned).eco.ships[0];
  assert.deepEqual(returnedShip.litLanterns, [lamp.id]);
  assert.deepEqual(publicRafts(server.world).find((r) => r.id === returnedShip.id).litLanterns, [lamp.part]);
  assert.equal(ship.rev, source.ship.rev);
  const returnedCtx = { ...ctx, owner: returned, source: server.world.rafts.get(returnedShip.id), ship: returnedShip,
    lamp: server.world.rafts.get(returnedShip.id).condition.entries.find((e) => e.part[0] === 'lantern'),
    profile: server.world.profiles.get(returned) };
  const oldId = returnedCtx.lamp.id, oldIndex = returnedShip.grid.parts.findIndex((p) => p[0] === 'lantern');
  const removed = wireEdit(returnedCtx, 'remove', returnedShip.grid.parts[oldIndex], oldIndex);
  assert.equal(removed?.ok, true);
  returnedCtx.profile.eco.pack.goods = { ...(returnedCtx.profile.eco.pack.goods || {}), madera: 5, hierro: 2 };
  const placed = wireEdit(returnedCtx, 'place', ['lantern', 0, 1, 0, 0]);
  assert.equal(placed?.ok, true);
  const replacement = returnedCtx.source.condition.entries.find((e) => e.part[0] === 'lantern');
  assert.notEqual(replacement.id, oldId);
  assert.deepEqual(returnedShip.litLanterns || [], []);
});
