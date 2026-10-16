import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORLD = 'raft-lantern-host-test';
const copy = (value) => structuredClone(value);
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}
function connect(host, name) {
  const ws = new Socket(); host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name })), false);
  return { id, ws, of: (type) => ws.messages.filter((message) => message.t === type) };
}
function profile(account, withLantern = false) {
  const value = newProfile(); value.pirateId = `account:${account}`;
  if (withLantern) value.eco.ships.find((ship) => ship.kind === 'raft').grid.parts.push(['lantern', 0, 1, 0, 0]);
  return value;
}
function makeHost(store) {
  return new GameHost({ seed: 82, bots: 0, log: () => {}, store, saves: hmacSaves('raft-lantern-host-test'),
    resolvePlayer: async (_request, message) => message.name === 'Owner' ? OWNER : message.name === 'Guest' ? GUEST : null,
    initializeAccounts: true, worldId: WORLD });
}
async function openHost(t, store) {
  const h = makeHost(store); t.after(async () => { if (!h.closePromise) await h.close().catch(() => {}); });
  await h.prepare(); const owner = connect(h, 'Owner'), guest = connect(h, 'Guest');
  await Promise.all([...h.joins]); await h.profiles.flush();
  return { h, owner, guest, ownerEntity: h.server.clients.get(owner.id).entity,
    guestEntity: h.server.clients.get(guest.id).entity };
}
function target(h, guestEntity) {
  const raft = publicRafts(h.server.world).find((row) => row.owner !== guestEntity && row.partHealth?.some((p) => p.part[0] === 'lantern'));
  assert.ok(raft, 'account raft has a live lantern');
  const part = raft.partHealth.find((p) => p.part[0] === 'lantern'), point = lanternPoint(raft, part.part), ecs = h.server.world.ecs;
  ecs.x[guestEntity] = point.x + Math.sin(raft.yaw) * 1.05;
  ecs.y[guestEntity] = point.y; ecs.z[guestEntity] = point.z + Math.cos(raft.yaw) * 1.05;
  return { raft, part };
}
function command(raft, part, lit, opId) {
  return { t: 'cmd', type: 'raftLantern', id: raft.id, partId: part.id, expectedRev: raft.rev,
    expectedLit: !lit, lit, opId };
}

test('GameHost enforces profile mutation access for another account lantern and returns private command acknowledgements', async (t) => {
  const store = { ...createMemoryStore(), durable: true };
  await store.initializeProfile(OWNER, profile(OWNER, true)); await store.initializeProfile(GUEST, profile(GUEST));
  const { h, owner, guest, ownerEntity, guestEntity } = await openHost(t, store), { raft, part } = target(h, guestEntity);
  const world = h.server.world, guestConn = h.server.clients.get(guest.id), ownerBefore = copy(world.profiles.get(ownerEntity));
  const saveAt = guestConn.saveAt, dirty = [...world.profileDirty], beforeReceipts = world.raftLanternReceipts;
  let allowed = false; const access = h.server.commandAccess, calls = [];
  h.server.commandAccess = (...args) => { calls.push(args); return allowed && access(...args); };
  assert.equal(h.server.playerCommand(guestConn, command(raft, part, true, 'guest-denied')), false);
  assert.deepEqual(calls.map(([id, entity, plan]) => [id, entity, plan]), [[guest.id, guestEntity, { world: true, target: ownerEntity }]]);
  assert.deepEqual(world.profiles.get(ownerEntity), ownerBefore);
  assert.deepEqual([...world.profileDirty], dirty); assert.equal(guestConn.saveAt, saveAt);
  assert.equal(world.raftLanternReceipts, beforeReceipts, 'denial allocates no receipts');
  assert.deepEqual(raft.litLanterns, []);
  guestConn.paused = true;
  assert.equal(h.server.playerCommand(guestConn, command(raft, part, true, 'guest-paused')), false);
  guestConn.paused = false; h.server.tickBlocked = true;
  assert.equal(h.server.playerCommand(guestConn, command(raft, part, true, 'guest-tick-blocked')), false);
  h.server.tickBlocked = false;
  assert.equal(world.raftLanternReceipts?.has(guestEntity) || false, false, 'host lifecycle gates reject before receipts');
  allowed = true;
  assert.equal(h.server.playerCommand(guestConn, command(raft, part, true, 'guest-light')), true);
  h.server.flushEvents(); await h.profiles.flush();
  assert.deepEqual(world.rafts.get(raft.id).ship.litLanterns, [part.id]);
  assert.deepEqual(publicRafts(world).find((row) => row.id === raft.id).litLanterns, [part.part]);
  const ack = guest.ws.messages.flatMap((m) => m.ev ? [m.ev] : []).find((ev) => ev.type === 'raftLantern' && ev.opId === 'guest-light');
  assert.equal(ack?.ok, true); assert.equal(ack?.lit, true);
  assert.equal(owner.ws.messages.flatMap((m) => m.ev ? [m.ev] : []).some((ev) => ev.type === 'raftLantern' && ev.opId === 'guest-light'),
    false, 'interaction acknowledgement is private to the initiating visitor');
  assert.deepEqual(world.profiles.get(guestEntity).eco.ships.find((s) => s.kind === 'raft').litLanterns, undefined,
    'guest profile does not acquire owner raft state');
  assert.equal(calls[1][2].target, ownerEntity);
});

test('authorized lantern state is durable on the owner profile and restored on host reentry', async (t) => {
  const store = { ...createMemoryStore(), durable: true };
  await store.initializeProfile(OWNER, profile(OWNER, true)); await store.initializeProfile(GUEST, profile(GUEST));
  const first = await openHost(t, store), selected = target(first.h, first.guestEntity);
  const cmd = command(selected.raft, selected.part, true, 'persist-lit');
  first.h.server.commandAccess = () => true;
  assert.equal(first.h.server.playerCommand(first.h.server.clients.get(first.guest.id), cmd), true);
  await first.h.profiles.flush();
  const persisted = await store.loadProfile(OWNER), ship = persisted.data.eco.ships.find((s) => s.id === selected.raft.id);
  assert.deepEqual(ship.litLanterns, [selected.part.id]);
  await first.h.close();
  const second = await openHost(t, store), restored = publicRafts(second.h.server.world).find((row) => row.owner === second.ownerEntity);
  assert.deepEqual(restored.litLanterns, [selected.part.part]);
  assert.deepEqual(second.h.server.world.rafts.get(restored.id).ship.litLanterns, [selected.part.id]);
});
