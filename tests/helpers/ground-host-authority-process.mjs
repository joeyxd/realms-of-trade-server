import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { database, reopenDatabase } from './ground-host-authority-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { calmAt, findNode } from './resource-authority-fixture.mjs';
import { newResourceState } from '../../server/resourceState.mjs';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-host-runtime', ACCOUNT = '00000000-0000-4000-8000-000000000315';
const SEED = 97, OP_ID = 'ground-host-process-gather';
const id = n => `b0150000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const waitForever = () => new Promise(() => {});

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

function profile() {
  const value = newProfile();
  value.pirateId = `account:${ACCOUNT}`;
  return value;
}

function makeHost(fixture, { holdAt = null, hasAck = () => false } = {}) {
  const store = holdAt === 'after-sql-commit' ? { ...fixture.store,
    async commitGroundTransaction(raw) {
      const result = await fixture.store.commitGroundTransaction(raw);
      if (raw.request.family === 'economic') {
        assert.equal(hasAck(), false, 'SQL commit is held before the tick-boundary ACK');
        process.stdout.write(`READY ${phase}\n`);
        await waitForever();
      }
      return result;
    } } : fixture.store;
  let journal = fixture.journal(WORLD);
  if (holdAt === 'after-journal-prepare') {
    const original = journal;
    journal = { ...original, async prepare(raw) {
      const result = await original.prepare(raw);
      assert.equal(hasAck(), false, 'journal preparation is held before the tick-boundary ACK');
      process.stdout.write(`READY ${phase}\n`);
      await waitForever();
      return result;
    } };
  }
  const host = new GameHost({ seed: SEED, bots: 0, store, resolvePlayer: async () => ACCOUNT,
    worldId: WORLD, economicOperations: true, resourceOperations: true,
    groundTransactions: { journal }, log() {} });
  return { host, store };
}

async function seed(fixture) {
  const seededProfile = profile();
  assert.equal((await fixture.store.saveProfile(ACCOUNT, seededProfile, 0)).ok, true);
  const template = new GameHost({ seed: SEED, bots: 0, store: fixture.store, resolvePlayer: async () => ACCOUNT,
    worldId: WORLD, economicOperations: true, resourceOperations: true, log() {} });
  const resources = { ...newResourceState(template.server.world), tick: 1000 };
  assert.equal((await fixture.store.saveWorld(WORLD, { v: 1, seed: SEED,
    economy: template.server.world.economy.serialize(), resources }, 0)).version, 1);
  assert.equal((await fixture.store.commitGroundClock({ operationId: id(1), world: WORLD,
    expectedVersion: 0, expectedTick: 0, tick: 1000 })).ok, true);
}

async function connect(host) {
  const socket = new Socket();
  host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-host-process-test' } });
  const clientId = host.nextId - 1;
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Ground recovery' })), false);
  await Promise.all([...host.joins]);
  const entity = host.server.clients.get(clientId)?.entity;
  assert.ok(entity, 'the authenticated account joins GameHost');
  return { socket, clientId, entity };
}

async function hold() {
  const seeded = await database(path);
  try { await seed(seeded); }
  finally { await seeded.close(); }

  const fixture = await reopenDatabase(path); // Deliberately opens without applying migrations.
  let client;
  const { host } = makeHost(fixture, { holdAt: phase,
    hasAck: () => client?.socket.messages.some(message => message.t === MSG.EVENT && message.ev?.opId === OP_ID) ?? false });
  await host.prepare();
  client = await connect(host);
  const node = findNode(host, 'wood');
  calmAt(host, client.entity, node);
  const command = { type: 'resource', op: 'gather', opId: OP_ID, node: node.id, expectedRev: node.rev };
  client.socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...command })), false);
  await waitForever();
}

async function recover() {
  const fixture = await reopenDatabase(path); // No schema changes or migration repair on restart.
  const before = {
    economic: Number((await fixture.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n),
    outer: Number((await fixture.db.query('select count(*)::int as n from public.mn_ground_transactions')).rows[0].n),
  };
  assert.equal(before.economic, Number(phase === 'after-sql-commit'));
  assert.equal(before.outer, Number(phase === 'after-sql-commit'));

  const { host, store } = makeHost(fixture);
  try {
    await host.prepare();
    const recovery = host.groundAuthority.status().recovery;
    assert.equal(recovery.committed, Number(phase === 'after-journal-prepare'));
    const client = await connect(host);
    const rows = (await fixture.db.query('select operation_id,request,result from public.mn_economic_operations')).rows;
    assert.equal(rows.length, 1);
    const receipt = await store.loadEconomicOperation(rows[0].operation_id);
    assert.equal(receipt.request.command.opId, OP_ID);
    assert.equal(receipt.request.command.type, 'resource');
    assert.equal(receipt.request.command.op, 'gather');

    const initial = {
      profile: await store.loadProfile(ACCOUNT),
      world: await store.loadWorld(WORLD),
      clock: await store.loadGroundClock(WORLD),
      liveProfile: structuredClone(host.server.world.profiles.get(client.entity)),
      liveResources: structuredClone(host.worldState.resources),
    };
    assert.equal(initial.profile.version, 3, 'the existing economic authority first writes its baseline, then the transaction');
    assert.deepEqual(initial.liveProfile, initial.profile.data);
    assert.deepEqual(initial.world.data.resources, initial.liveResources);
    assert.equal(initial.clock.tick, initial.liveResources.tick);
    assert.equal(initial.clock.tick, 1000);
    assert.equal(initial.liveProfile.eco.pack.goods.tronco, 1);

    // The exact original request ID must resolve as a replay after restart.
    client.socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.CMD, ...receipt.request.command })), false);
    await host.economicAuthority.settle();
    assert.equal(host.server.beforeTick(), true, 'the common GameHost tick boundary drains the replay');
    const acks = client.socket.messages.filter(message => message.t === MSG.EVENT && message.ev?.opId === OP_ID)
      .map(message => message.ev);
    assert.equal(acks.length, 1);
    assert.equal(acks[0].ok, true);
    assert.equal(acks[0].replay, true);

    const after = {
      profile: await store.loadProfile(ACCOUNT),
      world: await store.loadWorld(WORLD),
      clock: await store.loadGroundClock(WORLD),
      liveProfile: structuredClone(host.server.world.profiles.get(client.entity)),
      liveResources: structuredClone(host.worldState.resources),
      economic: Number((await fixture.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n),
      outer: Number((await fixture.db.query('select count(*)::int as n from public.mn_ground_transactions')).rows[0].n),
    };
    assert.deepEqual(after.profile, initial.profile, 'retry must not install a historical profile or grant a second item');
    assert.deepEqual(after.world, initial.world, 'retry must not reinstall a historical world snapshot');
    assert.deepEqual(after.clock, initial.clock);
    assert.deepEqual(after.liveProfile, initial.liveProfile);
    assert.deepEqual(after.liveResources, initial.liveResources);
    assert.equal(after.economic, 1);
    assert.equal(after.outer, 1);
    assert.equal(host.worldState.resourceTick(), 1000);
    process.stdout.write(JSON.stringify({ phase, recoveredPending: before.outer === 0 ? 1 : 0,
      profileVersion: after.profile.version, worldVersion: after.world.version,
      clockTick: after.clock.tick, resourceTick: after.world.data.resources.tick,
      wood: after.profile.data.eco.pack.goods.tronco, economicReceipts: after.economic,
      outerReceipts: after.outer, acks: acks.length, replay: acks[0].replay === true }));
  } finally {
    try { await host.close(); } finally { await fixture.close(); }
  }
}

if (mode === 'hold') await hold();
else await recover();
