import assert from 'node:assert/strict';
import { database, reopenDatabase } from './ground-world-adoption-sql.mjs';

const [mode, path, phase] = process.argv.slice(2);
assert.ok(['hold', 'inspect'].includes(mode));
assert.ok(path && ['before-commit', 'after-commit'].includes(phase));

const world = 'ground-adoption-process';
const operationId = 'a2200000-0000-4000-8000-000000000201';
const tick = 987;
function candidate(data) {
  return { world, expectedWorldVersion: 1, worldData: data };
}
async function state(f) {
  const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0] ?? null;
  return {
    world: await one('select economy,version from public.mn_worlds where world=$1', [world]),
    adoption: await one('select world,operation_id,request,result from public.mn_ground_world_adoptions where world=$1', [world]),
    clock: await one('select world,tick,version,operation_id from public.mn_ground_clocks where world=$1', [world]),
    clockReceipt: await one('select request,result from public.mn_ground_clock_operations where operation_id=$1::uuid', [operationId]),
  };
}

if (mode === 'hold') {
  const f = await database(path);
  const data = await f.seedWorld(world, { tick, version: 1 });
  const request = candidate(data);
  if (phase === 'before-commit') await f.db.exec('BEGIN');
  const committed = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
    [operationId, request])).rows[0].data;
  assert.deepEqual(committed, { ok: true, replay: false, worldVersion: 1,
    clock: { world, tick, version: 1, operationId } });
  const provisional = await state(f);
  assert.equal(provisional.adoption.operation_id, operationId);
  assert.equal(provisional.clock.tick, tick);
  assert.equal(provisional.clockReceipt !== null, true);
  // before-commit keeps all SQL022 rows provisional until the parent SIGKILLs this process.
  process.stdout.write(`READY ${phase}\n`);
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else {
  // Reopen the persisted PGlite file directly; SQL023 and all other migrations are not rerun.
  const f = await reopenDatabase(path);
  try {
    const before = await state(f);
    const wasCommitted = phase === 'after-commit';
    if (wasCommitted) {
      assert.equal(before.adoption.operation_id, operationId);
      assert.equal(before.clock.operation_id, operationId);
      assert.ok(before.clockReceipt);
    } else {
      assert.equal(before.adoption, null);
      assert.equal(before.clock, null);
      assert.equal(before.clockReceipt, null);
    }
    const request = candidate(before.world.economy);
    const retry = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
      [operationId, request])).rows[0].data;
    assert.deepEqual(retry, { ok: true, replay: wasCommitted, worldVersion: 1,
      clock: { world, tick, version: 1, operationId } });

    const after = await state(f);
    assert.deepEqual(after.world, before.world, 'adoption never rewrites the world or increments its legacy version');
    assert.deepEqual(after.world, { economy: request.worldData, version: 1 });
    assert.deepEqual(after.adoption, { world, operation_id: operationId, request,
      result: { ok: true, replay: false, worldVersion: 1,
        clock: { world, tick, version: 1, operationId } } });
    assert.deepEqual(after.clock, { world, tick, version: 1, operation_id: operationId });
    assert.deepEqual(after.clockReceipt, { request: { world, expectedVersion: 0, expectedTick: 0, tick },
      result: { ok: true, replay: false, clock: { world, tick, version: 1, operationId } } });
    assert.equal(after.world.economy.resources.tick, tick);
    assert.equal(after.world.economy.resources.nodes[0].readyAt, 0,
      'adoption preserves resource timers without offline catch-up');

    const changed = structuredClone(request.worldData);
    changed.economy.markets.aldea.stock.madera++;
    await assert.rejects(f.store.saveWorld(world, changed, 1), error => error.code === 'operation',
      'the adopted world fence rejects legacy snapshot writes');
    const clockWrite = await f.store.commitGroundClock({ operationId: 'a2200000-0000-4000-8000-000000000202',
      world, expectedVersion: 1, expectedTick: tick, tick: tick + 10 });
    assert.deepEqual(clockWrite, { ok: false, why: 'operation' }, 'standalone clock writes remain fenced');
    assert.deepEqual(await state(f), after, 'fences reject writes and leave the adopted state unchanged');
    process.stdout.write(JSON.stringify({ phase, replay: retry.replay, worldVersion: after.world.version,
      tick: after.clock.tick, readyAt: after.world.economy.resources.nodes[0].readyAt }));
  } finally { await f.close(); }
}
