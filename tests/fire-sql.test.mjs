import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from './helpers/ground-clock-sql.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { Economy } from '../src/sim/economy/economy.js';
import { fireProfileDelta } from '../src/sim/systems/fireProfile.js';

const migrations = ['014_economic_operations.sql', '015_resource_operations.sql', '016_logging_operations.sql',
  '017_agent_goods_budget.sql', '018_ground_transactions.sql', '019_ground_transaction_journal.sql',
  '020_gm_drafts.sql', '021_artisan_operations.sql', '022_fire_operations.sql'];
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', world = 'fire-sql-test';

test('SQL022 validates, commits, and replays an exact paid hand-fuel receipt', async t => {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  for (const name of migrations) await f.db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  await f.db.exec('SET ROLE service_role');
  const before = newProfile(); before.eco.pack.goods.madera = 1;
  const worldData = { v: 1, seed: 91, economy: new Economy(91).serialize() };
  const command = { type: 'fire', op: 'load', opId: 'fire-load-sql', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: true };
  const delta = fireProfileDelta(before, command, worldData.economy.hours * 40);
  const request = { world, account, command, expectedProfileVersion: 1, expectedWorldVersion: 1,
    before, profile: delta.profile, worldData, ack: { type: 'fire', op: 'load', opId: command.opId, ok: true, why: '', rev: 1 } };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, before]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, worldData]);
  const valid = await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) value', [account, request]);
  assert.equal(valid.rows[0].value, true);
  const nullCommandOp = structuredClone(request);
  nullCommandOp.command.op = null; nullCommandOp.ack.op = null;
  const nullOpResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    ['10000000-0000-4000-8000-000000000031', nullCommandOp])).rows[0].value;
  assert.deepEqual(nullOpResult, { ok: false, why: 'operation' }, 'JSON null is not a fire operation enum');
  const nullAckOp = structuredClone(request); nullAckOp.ack.op = null;
  const nullAckResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    ['10000000-0000-4000-8000-000000000032', nullAckOp])).rows[0].value;
  assert.deepEqual(nullAckResult, { ok: false, why: 'operation' }, 'ack op must be a matching nonnull string');
  const nullKind = structuredClone(request); nullKind.command.kind = null;
  const nullKindResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    ['10000000-0000-4000-8000-000000000034', nullKind])).rows[0].value;
  assert.deepEqual(nullKindResult, { ok: false, why: 'operation' }, 'kind must be one of the exact string enums');
  assert.equal((await f.db.query('select count(*)::int n from public.mn_economic_operations')).rows[0].n, 0,
    'malformed commands cannot leave receipts');
  const altered = structuredClone(request); altered.profile.eco.pack.goods.madera = 1;
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) value', [account, altered])).rows[0].value, true,
    'request shape validator leaves locked baseline delta enforcement to commit');
  const rejected = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value', [account, altered])).rows[0].value;
  assert.deepEqual(rejected, { ok: false, why: 'conflict' });
  const badClock = structuredClone(request); badClock.worldData.economy.hours += 0.1;
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value', [account, badClock])).rows[0].value,
    { ok: false, why: 'conflict' }, 'fire receipt cannot choose a clock outside the locked current world');
  const badFuelClock = structuredClone(request); badFuelClock.profile.fire.slots.hand.since += 1;
  assert.deepEqual((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value', [account, badFuelClock])).rows[0].value,
    { ok: false, why: 'conflict' }, 'lit start time must equal the locked active simulation seconds');
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value', [account, request])).rows[0].value;
  assert.deepEqual(result, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: request.ack });
  const replay = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value', [account, request])).rows[0].value;
  assert.equal(replay.replay, true);
  const stored = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].data;
  assert.equal(stored.eco.pack.goods.madera, undefined);
  assert.deepEqual(stored.fire.slots.hand, { kind: 'handTorch', seconds: 1200, since: worldData.economy.hours * 40, lit: true });

  const stationAccount = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', stationWorld = 'fire-station-sql';
  const stationBefore = newProfile(), ship = stationBefore.eco.ships[0];
  ship.id = 'raft-one'; ship.grid.parts.push(['lantern', 0, 0, 0, 0]);
  ship.condition = { v: 1, next: 2, entries: [['p1', 'lantern', 0, 0, 0, 0, 10]] };
  ship.hold.goods.madera = 1; stationBefore.eco.pack.goods.madera = 2;
  const stationWorldData = { v: 1, seed: 92, economy: new Economy(92).serialize() };
  const stationCommand = { type: 'fire', op: 'load', opId: 'fire-station-sql', ship: ship.id, part: 'p1', kind: 'lantern', expectedRev: 0, lit: false };
  const stationDelta = fireProfileDelta(stationBefore, stationCommand, stationWorldData.economy.hours * 40);
  assert.equal(stationDelta.why, '');
  const stationRequest = { world: stationWorld, account: stationAccount, command: stationCommand,
    expectedProfileVersion: 1, expectedWorldVersion: 1, before: stationBefore, profile: stationDelta.profile,
    worldData: stationWorldData,
    ack: { type: 'fire', op: 'load', opId: stationCommand.opId, ok: true, why: '', rev: 1 } };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [stationAccount, stationBefore]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [stationWorld, stationWorldData]);
  const stationResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    [stationAccount, stationRequest])).rows[0].value;
  assert.deepEqual(stationResult, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: stationRequest.ack });
  const stationStored = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [stationAccount])).rows[0].data;
  assert.equal(stationStored.eco.ships[0].hold.goods.madera, undefined);
  assert.equal(stationStored.eco.pack.goods.madera, 2, 'raft station spends hold wood before pack wood');
});

test('SQL022 rejects a candidate that exceeds the new fire-slot bound without writing profile, world, or receipt', async t => {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  for (const name of migrations) await f.db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  await f.db.exec('SET ROLE service_role');
  const boundedAccount = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', boundedWorld = 'fire-slot-bound-test';
  const before = newProfile(); before.eco.pack.goods.madera = 1;
  before.fire = { v: 1, rev: 0, slots: {} };
  for (let i = 0; i < 601; i++) before.fire.slots[JSON.stringify([`raft-${i}`, 'p1'])] =
    { kind: 'lantern', seconds: 0, since: 0, lit: false };
  const worldData = { v: 1, seed: 93, economy: new Economy(93).serialize() };
  const command = { type: 'fire', op: 'load', opId: 'fire-over-slot-bound', ship: '', part: 'hand',
    kind: 'handTorch', expectedRev: 0, lit: false };
  const overBound = structuredClone(before);
  overBound.fire = { v: 1, rev: 1, slots: { ...before.fire.slots,
    hand: { kind: 'handTorch', seconds: 1200, since: 0, lit: false } } };
  delete overBound.eco.pack.goods.madera; overBound.eco.tradeRev++;
  const request = { world: boundedWorld, account: boundedAccount, command, expectedProfileVersion: 1,
    expectedWorldVersion: 1, before, profile: overBound, worldData,
    ack: { type: 'fire', op: 'load', opId: command.opId, ok: true, why: '', rev: 1 } };
  const operationId = '10000000-0000-4000-8000-000000000033';
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [boundedAccount, before]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [boundedWorld, worldData]);
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    [operationId, request])).rows[0].value;
  assert.equal(result.ok, false);
  assert.ok(['operation', 'conflict'].includes(result.why));
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [boundedAccount])).rows[0].version, 1);
  assert.equal((await f.db.query('select version from public.mn_worlds where world=$1', [boundedWorld])).rows[0].version, 1);
  assert.equal((await f.db.query('select count(*)::int n from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).rows[0].n, 0);
});

test('SQL022 preserves paid fire across commerce while allowing exact historical replay', async t => {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  for (const name of migrations) await f.db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  await f.db.exec('SET ROLE service_role');
  const worldData = { v: 1, seed: 94, economy: new Economy(94).serialize() };
  const paidFire = { v: 1, rev: 1, slots: { hand: { kind: 'handTorch', seconds: 1177, since: 323, lit: true } } };
  const makeRequest = (accountId, worldId, opId, before, profile) => ({ world: worldId, account: accountId,
    command: { type: 'commerce', op: 'buy', opId, town: 'aldea', g: 'fruta', n: 1, expectedTotal: 0 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile, worldData,
    ack: { type: 'commerce', op: 'buy', opId, ok: true, why: '', rev: 1 } });
  const cases = [
    ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'fire-commerce-reset', 'commerce-reset-fire'],
    ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'fire-commerce-preserve', 'commerce-preserve-fire'],
    ['ffffffff-ffff-4fff-8fff-ffffffffffff', 'fire-commerce-replay', 'commerce-replay-fire'],
  ];
  for (const [accountId, worldId] of cases) {
    const before = newProfile(); before.fire = structuredClone(paidFire);
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [accountId, before]);
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, worldData]);
  }

  const [resetAccount, resetWorld, resetOp] = cases[0];
  const resetBefore = newProfile(); resetBefore.fire = structuredClone(paidFire);
  const resetCandidate = structuredClone(resetBefore); delete resetCandidate.fire; resetCandidate.gold--;
  const resetRequest = makeRequest(resetAccount, resetWorld, resetOp, resetBefore, resetCandidate);
  const resetResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    ['30000000-0000-4000-8000-000000000001', resetRequest])).rows[0].value;
  assert.deepEqual(resetResult, { ok: false, why: 'conflict' }, 'commerce cannot discard previously paid fuel');
  assert.deepEqual((await f.db.query('select data->\'fire\' fire from public.mn_profiles where player_id=$1::uuid',
    [resetAccount])).rows[0].fire, paidFire);

  const [preserveAccount, preserveWorld, preserveOp] = cases[1];
  const preserveBefore = newProfile(); preserveBefore.fire = structuredClone(paidFire);
  const preserveCandidate = structuredClone(preserveBefore); preserveCandidate.gold--;
  const preserveRequest = makeRequest(preserveAccount, preserveWorld, preserveOp, preserveBefore, preserveCandidate);
  const preserveResult = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    ['30000000-0000-4000-8000-000000000002', preserveRequest])).rows[0].value;
  assert.equal(preserveResult.ok, true, 'ordinary commerce still commits when it carries the exact fire state forward');
  assert.deepEqual((await f.db.query('select data->\'fire\' fire from public.mn_profiles where player_id=$1::uuid',
    [preserveAccount])).rows[0].fire, paidFire);

  const [replayAccount, replayWorld, replayOp] = cases[2];
  const replayBefore = newProfile(); replayBefore.fire = structuredClone(paidFire);
  const replayCandidate = structuredClone(replayBefore); replayCandidate.gold--;
  const replayRequest = makeRequest(replayAccount, replayWorld, replayOp, replayBefore, replayCandidate);
  const replayId = '30000000-0000-4000-8000-000000000003';
  assert.equal((await f.db.query('select (public.mn_commit_economic_operation($1::uuid,$2::jsonb))->>\'ok\' value',
    [replayId, replayRequest])).rows[0].value, 'true');
  const newerFire = { v: 1, rev: 2, slots: { hand: { kind: 'handTorch', seconds: 900, since: 600, lit: true } } };
  await f.db.query('update public.mn_profiles set data=jsonb_set(data,\'{fire}\',$2::jsonb),version=3 where player_id=$1::uuid',
    [replayAccount, newerFire]);
  const replay = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
    [replayId, replayRequest])).rows[0].value;
  assert.equal(replay.replay, true, 'an exact receipt replays before comparing its old fire projection to the current one');
  assert.deepEqual((await f.db.query('select data->\'fire\' fire from public.mn_profiles where player_id=$1::uuid',
    [replayAccount])).rows[0].fire, newerFire, 'historical replay cannot restore older fire state');
});
