import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { database } from './helpers/ground-host-authority-sql.mjs';
import { GameHost } from '../server/host.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { newResourceState } from '../server/resourceState.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const WORLD = 'fire-ground-combined';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOCK_ID = 'c4100000-0000-4000-8000-000000000071';

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

test('fire paid operation commits through the optional ground journal and shared SQL receipt', async t => {
  const f = await database();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  await f.db.exec(await readFile(new URL('../server/migrations/022_fire_operations.sql', import.meta.url), 'utf8'));
  await f.db.exec('SET ROLE service_role');

  // This helper predates SQL022's readiness RPC mapping; SQL itself is migrated above, so adapt
  // only that readiness probe while retaining its real SQL store and ground journal.
  const store = { ...f.store, async checkFireOperations() { return { version: 1 }; } };
  const host = new GameHost({ seed: 71, bots: 0, log: () => {}, store,
    resolvePlayer: async () => ACCOUNT, worldId: WORLD,
    economicOperations: true, resourceOperations: true, fireOperations: true,
    groundTransactions: { journal: f.journal(WORLD) } });
  t.after(async () => {
    if (host.closePromise) return;
    try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
  });

  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.pack.goods.madera = 1;
  assert.equal((await store.saveProfile(ACCOUNT, profile, 0)).ok, true);
  const resources = newResourceState(host.server.world);
  assert.equal(resources.tick, 0);
  assert.equal((await store.saveWorld(WORLD, { v: 1, seed: host.server.world.seed,
    economy: host.server.world.economy.serialize(), resources }, 0)).version, 1);
  assert.equal((await store.commitGroundClock({ operationId: CLOCK_ID, world: WORLD,
    expectedVersion: 0, expectedTick: 0, tick: 0 })).ok, true);
  await host.prepare();
  assert.equal(host.groundAuthority.ready, true);

  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'fire-ground-test' } });
  const clientId = host.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Fuel owner' })), false);
  await Promise.all([...host.joins]);
  const entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity);
  const command = { t: MSG.CMD, type: 'fire', op: 'load', opId: 'fire-through-ground',
    ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true };
  ws.emit('message', Buffer.from(JSON.stringify(command)), false);
  await new Promise(resolve => setImmediate(resolve));
  await host.economicAuthority.settle();
  assert.equal(host.server.step(), true, 'the ground boundary drains the prepared M5 effect');

  const ack = ws.messages.map(message => message.ev).find(ev => ev?.opId === command.opId);
  assert.equal(ack?.type, 'fire');
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  assert.deepEqual(host.server.world.profiles.get(entity).fire.slots.hand,
    { kind: 'handTorch', seconds: 1200, since: host.server.world.economy.hours * 40, lit: true });
  const outer = (await f.db.query('select request,result from public.mn_ground_transactions')).rows;
  const inner = (await f.db.query('select request,result from public.mn_economic_operations')).rows;
  assert.equal(outer.length, 1);
  assert.equal(outer[0].request.family, 'economic');
  assert.equal(outer[0].request.operation.command.type, 'fire');
  assert.equal(outer[0].result.effect.ack.opId, command.opId);
  assert.equal(inner.length, 1);
  assert.equal(inner[0].request.command.type, 'fire');
  assert.equal(inner[0].result.ack.opId, command.opId);
  assert.equal(host.groundAuthority.status().failed, false);
});
