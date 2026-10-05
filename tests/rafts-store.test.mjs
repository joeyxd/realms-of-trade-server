import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { newRaft } from '../src/sim/economy/raft.js';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clone = (v) => JSON.parse(JSON.stringify(v));
const turn = () => new Promise((resolve) => setImmediate(resolve));

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

function connect(host, id) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'raft-test' } });
  const clientId = host.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Raft ${id}`, skin: 0, weapon: 0 })), false);
  return { ws, id: clientId };
}

async function joined(host) { await Promise.all([...host.joins]); await turn(); }

test('memory-store account reopen preserves raft identity, berth, blueprint, hold, and does not mint a second starter', { timeout: 15000 }, async (t) => {
  const store = createMemoryStore();
  const makeHost = () => new GameHost({ seed: 42, bots: 0, dev: true, log: () => {}, store, resolvePlayer: async () => ACCOUNT });

  const firstHost = makeHost();
  t.after(async () => { try { await firstHost.close(); } catch (err) { if (err.code !== 'flush') throw err; } });
  const firstClient = connect(firstHost, 1);
  await joined(firstHost);
  const firstEntity = firstHost.server.clients.get(firstClient.id).entity;
  const firstProfile = firstHost.server.world.profiles.get(firstEntity);
  const ship = firstProfile.eco.ships.find((s) => s.kind === 'raft');
  assert.ok(ship);
  assert.equal(firstProfile.eco.ships.filter((s) => s.kind === 'raft').length, 1);
  const stableOwner = firstProfile.eco.id, stableShip = ship.id, stableBerth = ship.berth;
  assert.ok(stableOwner); assert.ok(stableShip); assert.ok(stableBerth >= 0);

  ship.grid = newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0]]);
  ship.hold.goods.madera = 2;
  ship.hp = 0.375;
  ship.rev = 7;
  firstHost.server.broadcastSnapshot();
  await firstHost.close(); // disconnect detaches the active ECS vehicle and queues the final profile snapshot
  const stored = await store.loadProfile(ACCOUNT);
  assert.ok(stored);
  const savedShip = stored.data.eco.ships.find((s) => s.kind === 'raft');
  assert.equal(savedShip.id, stableShip);
  assert.equal(savedShip.berth, stableBerth);
  assert.equal(savedShip.rev, 7);
  assert.equal(savedShip.hp, 0.375);
  assert.deepEqual(savedShip.grid.parts, newRaft([...STARTER_RAFT, ['foundation', 2, 0, 0]]).parts);
  assert.deepEqual(savedShip.hold.goods, { madera: 2 });

  const secondHost = makeHost();
  t.after(async () => { try { await secondHost.close(); } catch (err) { if (err.code !== 'flush') throw err; } });
  const secondClient = connect(secondHost, 2);
  await joined(secondHost);
  const secondEntity = secondHost.server.clients.get(secondClient.id).entity;
  const reopened = secondHost.server.world.profiles.get(secondEntity);
  assert.equal(reopened.eco.id, stableOwner);
  assert.equal(reopened.eco.ships.filter((s) => s.kind === 'raft').length, 1);
  const reopenedShip = reopened.eco.ships.find((s) => s.kind === 'raft');
  assert.equal(reopenedShip.id, stableShip);
  assert.equal(reopenedShip.berth, stableBerth);
  assert.equal(reopenedShip.rev, 7);
  assert.equal(reopenedShip.hp, 0.375);
  assert.deepEqual(reopenedShip.grid.parts, savedShip.grid.parts);
  assert.deepEqual(reopenedShip.hold.goods, { madera: 2 });

  secondHost.server.broadcastSnapshot();
  const snap = secondClient.ws.messages.filter((m) => m.t === MSG.SNAPSHOT).at(-1);
  const visible = snap.rafts.find((r) => r.id === stableShip);
  assert.ok(visible);
  assert.equal(visible.owner, secondEntity);
  assert.deepEqual(visible.parts, savedShip.grid.parts);
  assert.equal(visible.hold, undefined, 'the public mooring record never includes private cargo');
  assert.ok(!secondClient.ws.messages.some((m) => m.t === MSG.SAVE), 'account profiles do not become replayable anonymous blobs');
});
