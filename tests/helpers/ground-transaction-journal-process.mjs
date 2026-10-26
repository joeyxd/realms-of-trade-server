import assert from 'node:assert/strict';
import { database, reopenDatabase } from './ground-transaction-journal-sql.mjs';
import { createSupabaseGroundTransactionJournal } from '../../server/groundTransactionJournal.mjs';
import { GroundTransactionSession } from '../../server/groundTransactionSession.mjs';
import { Economy } from '../../src/sim/economy/economy.js';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { groundOperation } from '../../server/pearlGround.mjs';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'inspect'].includes(mode));
assert.ok(path && ['after-prepare', 'before-commit', 'after-commit'].includes(phase));
const id = n => `b0170000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const world = 'ground-process', account = id(1), uid = 'ground-process-pearl';
const initial = () => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick: 1000, nodes: [{ id: 'palm-1', kind: 'palm', rev: 2, hits: 0, readyAt: 1600 }], cooldowns: {} } });
function request() {
  const profile = newProfile(); profile.pirateId = `account:${account}`;
  profile.pearls.bag.push({ uid, kind: 'brasa' });
  const data = initial(); data.resources.tick = 1010;
  return { operationId: id(4), request: { world, expectedWorldVersion: 1, worldData: data,
    clock: { operationId: id(5), expectedVersion: 1, expectedTick: 1000, tick: 1010 },
    family: 'ground', operation: groundOperation({ operationId: id(4), uid, kind: 'brasa',
      world, from: null, to: account, expectedVersion: 1, ground: null,
      profiles: [{ id: account, expectedVersion: 1, data: profile }] }).request } };
}
async function inspect(f) {
  const one = async (table, select, where, params) => (await f.db.query(
    `select ${select} from public.${table} where ${where}`, params)).rows[0];
  return {
    profile: await one('mn_profiles', 'data,version', 'player_id=$1::uuid', [account]),
    world: await one('mn_worlds', 'economy,version', 'world=$1', [world]),
    clock: await f.store.loadGroundClock(world),
    unique: await one('mn_unique_items', 'kind,holder,version', 'uid=$1', [uid]),
    location: await one('mn_pearl_locations', 'world,ground,version', 'uid=$1', [uid]),
    receipt: await f.store.loadGroundTransaction(id(4)),
    clockReceipt: await f.store.loadGroundClockOperation(id(5)),
    intent: await createSupabaseGroundTransactionJournal(f.journalClient, world).load(id(4)),
    familyCount: Number((await f.db.query(
      'select count(*)::int as n from public.mn_pearl_ground_operations where operation_id=$1::uuid', [id(4)])).rows[0].n),
  };
}

if (mode === 'hold') {
  const seed = await database(path);
  const p = newProfile(); p.pirateId = `account:${account}`;
  assert.equal((await seed.store.saveProfile(account, p, 0)).ok, true);
  await seed.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, initial()]);
  assert.equal((await seed.store.commitGroundClock({ operationId: id(2), world,
    expectedVersion: 0, expectedTick: 0, tick: 1000 })).ok, true);
  assert.equal((await seed.store.commitPearlGround({ operationId: id(3), uid, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world, ground: { x: 2, z: 3, availableAt: 990, returnAt: 1600 }, profiles: [] })).ok, true);
  // Close only the seed connection. The transaction process below is killed without any close.
  await seed.close();
  const f = await reopenDatabase(path);
  const journal = createSupabaseGroundTransactionJournal(f.journalClient, world);
  assert.equal((await journal.prepare(request())).state, 'pending');
  if (phase === 'after-prepare') {
    const state = await inspect(f);
    assert.equal(state.profile.version, 1); assert.equal(state.clock.tick, 1000);
    assert.equal(state.receipt, null); assert.equal(state.intent.state, 'pending');
    process.stdout.write(`READY ${phase}\n`);
    setInterval(() => {}, 1000); await new Promise(() => {});
  }
  if (phase === 'before-commit') await f.db.exec('BEGIN');
  const committed = await f.store.commitGroundTransaction(request());
  assert.equal(committed.ok, true);
  const state = await inspect(f);
  assert.equal(state.profile.version, 2);
  assert.equal(state.clock.tick, 1010);
  assert.equal(state.world.version, 2);
  assert.equal(state.unique.holder, account);
  // The first phase holds an actual uncommitted SQL transaction, including every provisional write.
  process.stdout.write(`READY ${phase}\n`);
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else {
  const f = await reopenDatabase(path);
  try {
    const committedBeforeCrash = phase === 'after-commit';
    const before = await inspect(f);
    assert.equal(before.profile.version, committedBeforeCrash ? 2 : 1);
    assert.equal(before.world.version, committedBeforeCrash ? 2 : 1);
    assert.equal(before.clock.tick, committedBeforeCrash ? 1010 : 1000);
    assert.equal(before.unique.holder, committedBeforeCrash ? account : null);
    assert.equal(before.familyCount, Number(committedBeforeCrash));
    assert.equal(before.receipt !== null, committedBeforeCrash);
    assert.equal(before.clockReceipt !== null, committedBeforeCrash);
    assert.equal(before.profile.data.pearls.bag.length, Number(committedBeforeCrash));
    assert.equal(before.location.ground === null, committedBeforeCrash);
    assert.equal(before.intent.state, committedBeforeCrash ? 'committed' : 'pending');
    const session = new GroundTransactionSession({ store: f.store, worldId: world,
      journal: createSupabaseGroundTransactionJournal(f.journalClient, world) });
    await session.load(0); assert.equal(session.worldVersion, null);
    assert.equal(session.drain(0).state, 'ready');
    assert.deepEqual(session.recovery, { committed: Number(!committedBeforeCrash), conflicts: 0, rejected: 0 });
    assert.equal(session.logicalTick(0), 1010);
    const retried = await f.store.commitGroundTransaction(request());
    assert.equal(retried.ok, true); assert.equal(retried.replay, true);
    const after = await inspect(f);
    assert.equal(after.intent.state, 'committed');
    assert.equal(after.profile.version, 2);
    assert.equal(after.world.version, 2);
    assert.equal(after.clock.tick, 1010);
    assert.equal(after.clock.version, 2);
    assert.equal(after.familyCount, 1);
    assert.deepEqual(after.profile.data.pearls.bag, [{ uid, kind: 'brasa' }]);
    assert.equal(after.unique.holder, account);
    assert.equal(after.location.ground, null);
    assert.equal(after.world.economy.resources.tick, 1010);
    assert.equal(after.world.economy.resources.nodes[0].readyAt - after.clock.tick, 590);
    if (committedBeforeCrash) assert.deepEqual(after, before, 'replay does not restore historical snapshots or increment versions');
    process.stdout.write(JSON.stringify({ phase, recovered: session.recovery.committed, replay: retried.replay, profileVersion: after.profile.version,
      worldVersion: after.world.version, clockVersion: after.clock.version, tick: after.clock.tick,
      pearls: after.profile.data.pearls.bag.length, familyReceipts: after.familyCount, remainingTicks: 590 }));
  } finally { await f.close(); }
}
