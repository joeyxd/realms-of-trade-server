import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { EconomicOperationError, economicOperation } from '../server/economicOperation.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const opId = '00000000-0000-4000-8000-000000000901';
const operationId = '00000000-0000-4000-8000-000000000902';
const seed = 77;
const command = changes => ({ type: 'raft', op: 'supply', opId: 'raft_supply_1', id: 'raft:shore-1',
  expectedRev: 1, g: 'madera', n: 1, ...changes });
function request(cmd = command(), ackType = 'raftEdit') {
  return { operationId, request: { world: 'world:salty-shore', account: opId, command: cmd,
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: newProfile(),
    worldData: { v: 1, seed, economy: new Economy(seed).serialize() },
    ack: { type: ackType, op: 'supply', opId: cmd.opId, ok: true, why: '', rev: 2 } } };
}

test('raft supply DTO preserves raftEdit ACK identity and exact bounded fields', () => {
  const parsed = economicOperation(request());
  assert.deepEqual(parsed.request.command, command());
  assert.equal(parsed.request.ack.type, 'raftEdit');

  for (const changes of [
    { extra: true }, { id: `x${'a'.repeat(120)}` }, { id: 'raft/1' }, { expectedRev: 0 },
    { expectedRev: 2147483647 }, { g: 'piedra' }, { n: 0 }, { n: 11 },
  ]) {
    assert.throws(() => economicOperation(request(command(changes))), EconomicOperationError, JSON.stringify(changes));
  }
  assert.throws(() => economicOperation(request(command(), 'raft')), EconomicOperationError, 'ACK keeps legacy raftEdit type');
});

test('SQL014 accepts only the raft supply market command with the legacy raftEdit ACK', async t => {
  const f = await database();
  t.after(() => f.close());
  const migration = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
  await f.db.exec('RESET ROLE');
  await f.db.exec(migration);
  await f.db.exec('SET ROLE service_role');

  const requestValue = request();
  const valid = async value => (await f.db.query(
    'select public.mn_valid_economic_request($1::uuid,$2::jsonb) as valid',
    [operationId, JSON.stringify(value.request)],
  )).rows[0].valid;
  assert.equal(await valid(requestValue), true);
  for (const edit of [
    value => { value.request.command.extra = 1; },
    value => { value.request.command.n = 11; },
    value => { value.request.command.g = 'piedra'; },
    value => { value.request.command.id = 'raft/shore'; },
    value => { value.request.ack.type = 'raft'; },
  ]) {
    const altered = structuredClone(requestValue);
    edit(altered);
    assert.equal(await valid(altered), false);
  }
});
