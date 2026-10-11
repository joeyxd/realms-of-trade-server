import assert from 'node:assert/strict';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { GroundTransactionSession } from '../../server/groundTransactionSession.mjs';
import { groundOperation } from '../../server/pearlGround.mjs';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'recover'].includes(mode));
assert.ok(path && ['after-journal-prepare', 'after-sql-commit'].includes(phase));
const WORLD = 'ground-family-process';
const OP_ID = adoptionId(401), UID = 'ground-family-process-pearl';
const waitForever = () => new Promise(() => {});

function makeHost(fixture, holdAt = null) {
  const store = holdAt === 'after-sql-commit' ? { ...fixture.store,
    async commitGroundTransaction(raw) {
      const result = await fixture.store.commitGroundTransaction(raw);
      if (raw.request.family === 'ground') {
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
      process.stdout.write(`READY ${phase}\n`);
      await waitForever();
      return result;
    } };
  }
  return new GameHost({ seed: 91, bots: 0, store, resolvePlayer: async () => '00000000-0000-4000-8000-000000000401',
    worldId: WORLD, economicOperations: true, resourceOperations: true, loggingOperations: true,
    groundTransactions: { journal }, log() {} });
}

async function initialize(path) {
  const f = await database(path);
  try {
    const template = new GameHost({ seed: 91, bots: 0, store: createMemoryStore(), log() {} });
    const resources = upgradeLoggingState(newResourceState(template.server.world));
    resources.tick = 500;
    const data = { v: 1, seed: 91, economy: template.server.world.economy.serialize(), resources };
    await template.close();
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, data]);
    const adoption = await f.adoptionClient.rpc('mn_adopt_ground_world', {
      p_operation_id: adoptionId(400), p_request: { world: WORLD, expectedWorldVersion: 1, worldData: data },
    });
    assert.equal(adoption.error, null, adoption.error?.message);
    assert.equal(adoption.data.ok, true);
  } finally { await f.close(); }
}

function mint() {
  return groundOperation({ operationId: OP_ID, uid: UID, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, profiles: [], world: WORLD,
    ground: { x: 4, z: 8, availableAt: 500, returnAt: 700 } }).request;
}

async function hold() {
  await initialize(path);
  const f = await reopenDatabase(path); // Open existing SQL018/019/023 state without migrations.
  const host = makeHost(f, phase);
  await host.prepare();
  const promise = host.groundAuthority.stageFamily({ operationId: OP_ID, family: 'ground', operation: mint() }, () => {
    process.stdout.write('APPLIED\n'); return true;
  });
  promise.catch(() => {});
  if (phase === 'after-sql-commit') await waitForever();
  await waitForever();
}

async function recover() {
  const f = await reopenDatabase(path); // Deliberately no migration repair on restart.
  const host = makeHost(f);
  const before = {
    receipt: await f.store.loadGroundTransaction(OP_ID),
    location: (await f.db.query('select world,ground,version from public.mn_pearl_locations where uid=$1', [UID])).rows[0] ?? null,
    world: await f.store.loadWorld(WORLD),
    clock: await f.store.loadGroundClock(WORLD),
    intent: (await f.db.query('select state from public.mn_ground_transaction_intents where operation_id=$1::uuid', [OP_ID])).rows[0] ?? null,
  };
  const wasCommitted = phase === 'after-sql-commit';
  assert.equal(!!before.receipt, wasCommitted);
  assert.equal(!!before.location, wasCommitted);
  assert.equal(before.world.version, wasCommitted ? 2 : 1);
  assert.equal(before.clock.tick, 500);
  assert.equal(before.intent?.state, wasCommitted ? 'committed' : 'pending');
  let historicalApplyCalls = 0;
  const originalDrain = GroundTransactionSession.prototype.drain;
  GroundTransactionSession.prototype.drain = function(localTick, apply = null) {
    if (typeof apply === 'function') historicalApplyCalls++;
    return originalDrain.call(this, localTick, apply);
  };
  try {
    await host.prepare();
    assert.equal(historicalApplyCalls, 0, 'startup recovery drains persisted world state without a historical family callback');
    const receipt = await f.store.loadGroundTransaction(OP_ID);
    assert.ok(receipt, 'recovery completes the prepared SQL transaction and its receipt');
    assert.equal(receipt.request.family, 'ground');
    assert.equal(receipt.request.operation.uid, UID);
    const location = (await f.db.query('select world,ground,version from public.mn_pearl_locations where uid=$1', [UID])).rows[0] ?? null;
    assert.deepEqual(location, { world: WORLD, ground: { x: 4, z: 8, availableAt: 500, returnAt: 700 }, version: 1 });
    const world = await f.store.loadWorld(WORLD), clock = await f.store.loadGroundClock(WORLD);
    assert.equal(world.version, 2);
    assert.equal(world.data.resources.tick, clock.tick);
    assert.equal(clock.tick, 500);
    const counts = {
      transactions: Number((await f.db.query('select count(*)::int n from public.mn_ground_transactions where operation_id=$1::uuid', [OP_ID])).rows[0].n),
      committed: Number((await f.db.query('select count(*)::int n from public.mn_ground_transaction_intents where operation_id=$1::uuid and state=\'committed\'', [OP_ID])).rows[0].n),
      locations: Number((await f.db.query('select count(*)::int n from public.mn_pearl_locations where uid=$1', [UID])).rows[0].n),
    };
    assert.deepEqual(counts, { transactions: 1, committed: 1, locations: 1 });
    assert.equal(host.groundAuthority.status().recovery.committed, Number(phase === 'after-journal-prepare'));
    assert.deepEqual(host.worldState.snapshot(host.server.world.economy), world.data,
      'restart rehydrates the persisted world snapshot instead of applying a historical callback');
    assert.equal(host.server.world.pearlLedger.has(UID), false,
      'the separate lifecycle mount remains off; recovery does not hydrate runtime pearl entities');
    assert.equal(host.groundAuthority.status().clock.tick, 500);
    process.stdout.write(JSON.stringify({ phase, committed: counts.committed, operationReceipts: counts.transactions,
      worldVersion: world.version, clockTick: clock.tick, uid: location ? UID : null,
      locationVersion: location?.version ?? null, historicalApplyCalls }));
  } finally {
    GroundTransactionSession.prototype.drain = originalDrain;
    try { await host.close(); } finally { await f.close(); }
  }
}

if (mode === 'hold') await hold();
else await recover();
