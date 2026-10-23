import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundClockContract, CLOCK_WORLD, clockOp, clockRequest } from './helpers/ground-clock-contract.mjs';
import { database, reopenDatabase, groundClockSql } from './helpers/ground-clock-sql.mjs';

test('SQL013 storage contract through Supabase SDK transport', async (t) => groundClockContract(t, database));

test('SQL013 binds exact RPC parameters and exposes only service-role access', async () => {
  const f = await database();
  try {
    const raw = clockRequest(clockOp(50), { tick: 6 });
    const result = await f.store.commitGroundClock(raw);
    assert.equal(result.ok, true);
    assert.deepEqual(f.calls.at(-1), { name: 'mn_commit_ground_clock', body: {
      p_operation_id: raw.operationId, p_request: { world: raw.world, expectedVersion: 0, expectedTick: 0, tick: 6 },
    } });
    await f.store.loadGroundClock(CLOCK_WORLD);
    assert.deepEqual(f.calls.at(-1), { name: 'mn_load_ground_clock', body: { p_world: CLOCK_WORLD } });
    await f.store.loadGroundClockOperation(raw.operationId);
    assert.deepEqual(f.calls.at(-1), { name: 'mn_load_ground_clock_operation', body: { p_operation_id: raw.operationId } });

    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(f.db.query('select * from public.mn_ground_clocks'), { code: '42501' });
      await assert.rejects(f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb)', [clockOp(51), raw]), { code: '42501' });
      await assert.rejects(f.db.query('select public.mn_load_ground_clock($1)', [CLOCK_WORLD]), { code: '42501' });
      await assert.rejects(f.db.query('select public.mn_load_ground_clock_operation($1::uuid)', [raw.operationId]), { code: '42501' });
    }
    await f.db.exec('RESET ROLE; SET ROLE service_role');
    await assert.rejects(f.db.query("insert into public.mn_ground_clocks(world,tick,version,operation_id) values($1,1,1,$2::uuid)", [CLOCK_WORLD, clockOp(52)]), { code: '42501' });
    await assert.rejects(f.db.query("update public.mn_ground_clocks set tick=2 where world=$1", [CLOCK_WORLD]), { code: '42501' });
    assert.deepEqual(await f.store.loadGroundClock(CLOCK_WORLD), result.clock);
  } finally { await f.close(); }
});

test('SQL013 rejects fractional JSON ticks atomically and rolls back failed writes', async () => {
  const f = await database();
  try {
    const invalid = await f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data',
      [clockOp(60), { world: CLOCK_WORLD, expectedVersion: 0, expectedTick: 0, tick: 1.25 }]);
    assert.deepEqual(invalid.rows[0].data, { ok: false, why: 'operation' });
    assert.equal(await f.store.loadGroundClock(CLOCK_WORLD), null);
    await f.db.exec('begin');
    await f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb)',
      [clockOp(61), { world: CLOCK_WORLD, expectedVersion: 0, expectedTick: 0, tick: 1 }]);
    await assert.rejects(f.db.query('select 1/0'), { code: '22012' });
    await f.db.exec('rollback');
    assert.equal(await f.store.loadGroundClock(CLOCK_WORLD), null);
    assert.equal(await f.store.loadGroundClockOperation(clockOp(61)), null);
  } finally { await f.close(); }
});

test('SQL013 clock and receipt survive file-backed PGlite close and reopen', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ground-clock-'));
  const path = join(dir, 'db');
  t.diagnostic(`Retained PGlite fixture: ${path}`);
  const first = await database(path);
  const raw = clockRequest(clockOp(70), { tick: Number.MAX_SAFE_INTEGER });
  let result;
  try { result = await first.store.commitGroundClock(raw); }
  finally { await first.close(); }
  const reopened = await reopenDatabase(path);
  try {
    assert.deepEqual(await reopened.store.loadGroundClock(CLOCK_WORLD), result.clock);
    assert.deepEqual(await reopened.store.loadGroundClockOperation(raw.operationId), {
      request: { world: raw.world, expectedVersion: 0, expectedTick: 0, tick: Number.MAX_SAFE_INTEGER }, result,
    });
    assert.deepEqual(await reopened.store.commitGroundClock(raw), { ...result, replay: true });
  } finally { await reopened.close(); }
});

test('SQL013 migration remains idempotent when reapplied by its database owner', async () => {
  const f = await database();
  try {
    await f.db.exec('RESET ROLE'); await f.db.exec(groundClockSql); await f.db.exec('SET ROLE service_role');
    assert.equal(await f.store.loadGroundClock(CLOCK_WORLD), null);
  } finally { await f.close(); }
});
