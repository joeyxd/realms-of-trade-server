import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from './helpers/ground-clock-sql.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { Economy } from '../src/sim/economy/economy.js';
import { fireClockSeconds } from '../src/data/fire.js';
import { fireProfileDelta } from '../src/sim/systems/fireProfile.js';

const migrations = ['014_economic_operations.sql', '015_resource_operations.sql', '016_logging_operations.sql',
  '017_agent_goods_budget.sql', '018_ground_transactions.sql', '019_ground_transaction_journal.sql',
  '020_gm_drafts.sql', '021_artisan_operations.sql', '022_fire_operations.sql'];

test('fractional accumulated economy clocks use the same quantized seconds for JS and SQL receipts', async t => {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  for (const name of migrations) await f.db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  await f.db.exec('SET ROLE service_role');

  // Repeated fractional jumps exercise the serialized Economy.hours value rather than a hand-authored clock.
  for (const [i, jumps] of [
    [0.1, 0.2, 0.3, 0.4], [1 / 3, 2 / 7, 0.125, 0.0625], [0.000001, 0.000001, 0.000001],
    [5.1, 0.2, 0.7, 1 / 11],
  ].entries()) {
    const account = `d${String(i).repeat(7)}-dddd-4ddd-8ddd-${String(i).repeat(12)}`;
    const world = `fire-clock-${i}`;
    const economy = new Economy(701 + i);
    for (const seconds of jumps) economy.advance(seconds);
    const worldData = { v: 1, seed: 701 + i, economy: economy.serialize() };
    const now = fireClockSeconds(worldData.economy.hours);
    const before = newProfile(); before.eco.pack.goods.madera = 1;
    const command = { type: 'fire', op: 'load', opId: `fractional-${i}`, ship: '', part: 'hand',
      kind: 'handTorch', expectedRev: 0, lit: true };
    const delta = fireProfileDelta(before, command, now);
    assert.equal(delta.why, '');
    const request = { world, account, command, expectedProfileVersion: 1, expectedWorldVersion: 1,
      before, profile: delta.profile, worldData,
      ack: { type: 'fire', op: 'load', opId: command.opId, ok: true, why: '', rev: 1 } };
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, before]);
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, worldData]);
    const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) value',
      [`20000000-0000-4000-8000-${String(i).padStart(12, '0')}`, request])).rows[0].value;
    assert.deepEqual(result, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: request.ack },
      `fractional economy clock case ${i} should be accepted by SQL`);
    const stored = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [account])).rows[0].data;
    assert.equal(stored.fire.slots.hand.since, now, `SQL and JS quantization disagree in case ${i}`);
  }
});
