import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { StoreError } from '../server/store.mjs';
import { createSupabaseGroundWorldAdoption } from '../server/groundWorldAdoption.mjs';

const WORLD = 'salty-shore';
const OP = 'ab120000-0000-4000-8000-000000000001';
const tick = 918;
const worldData = () => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });
const request = () => ({ world: WORLD, expectedWorldVersion: 7, worldData: worldData() });
const result = (id = OP, replay = false) => ({ ok: true, replay, worldVersion: 7,
  clock: { world: WORLD, tick, version: 1, operationId: id } });
const receipt = (id = OP, req = request()) => ({ operationId: id, request: req, result: result(id) });

function service(handlers = {}) {
  const calls = [];
  const client = { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (handlers[name]) return handlers[name](args, calls);
    throw new Error(`unexpected ${name}`);
  } };
  return { adoption: createSupabaseGroundWorldAdoption(client), calls };
}

test('readiness and per-world receipt use exact RPC parameters and validate persisted identity', async () => {
  const row = receipt();
  const f = service({
    mn_ground_world_adoption_ready: async () => ({ data: { version: 1 }, error: null }),
    mn_load_ground_world_adoption: async args => ({ data: args.p_world === WORLD ? row : null, error: null }),
  });
  assert.deepEqual(await f.adoption.ready(), { version: 1 });
  assert.deepEqual(f.calls[0], { name: 'mn_ground_world_adoption_ready', args: {} });
  assert.deepEqual(await f.adoption.load(WORLD), row);
  assert.deepEqual(f.calls[1], { name: 'mn_load_ground_world_adoption', args: { p_world: WORLD } });
  assert.deepEqual(await f.adoption.load('other-world'), null);
});

test('readiness rejects a malformed capability response', async () => {
  const f = service({ mn_ground_world_adoption_ready: async () => ({ data: { version: 2 }, error: null }) });
  await assert.rejects(f.adoption.ready(), error => error instanceof StoreError && error.code === 'response');
});

test('adoption validates exact IDs, version, resource snapshot, and hostile input before RPC', async () => {
  const f = service();
  const getterRequest = {};
  Object.defineProperty(getterRequest, 'world', { enumerable: true, get() { throw new Error('getter ran'); } });
  for (const raw of [
    { operationId: OP.toUpperCase(), request: request() },
    { operationId: '00000000-0000-0000-0000-000000000000', request: request() },
    { operationId: OP, request: { ...request(), expectedWorldVersion: 0 } },
    { operationId: OP, request: { ...request(), worldData: { v: 1, seed: 91, economy: new Economy(91).serialize() } } },
    { operationId: OP, request: getterRequest },
    new Proxy({ operationId: OP, request: request() }, {}),
  ]) {
    await assert.rejects(f.adoption.adopt(raw), error => error instanceof StoreError && error.code === 'operation');
  }
  assert.equal(f.calls.length, 0);
});

test('adoption sends a detached snapshot and accepts the exact clock-only result', async () => {
  let seen;
  const f = service({ mn_adopt_ground_world: async args => {
    seen = args;
    return { data: result(), error: null };
  } });
  const input = { operationId: OP, request: request() };
  const reply = await f.adoption.adopt(input);
  input.request.worldData.resources.tick = 12;
  assert.deepEqual(reply, result());
  assert.equal(seen.p_request.worldData.resources.tick, tick);
  assert.deepEqual(seen, { p_operation_id: OP, p_request: request() });
});

test('SQL conflict and operation rejections are returned as exact domain outcomes', async () => {
  for (const why of ['conflict', 'operation']) {
    const f = service({ mn_adopt_ground_world: async () => ({ data: { ok: false, why }, error: null }) });
    assert.deepEqual(await f.adoption.adopt({ operationId: OP, request: request() }), { ok: false, why });
    assert.equal(f.calls.length, 1);
  }
});

test('an ambiguous committed response resolves through the exact durable receipt without a second write', async () => {
  let stored = null;
  const f = service({
    mn_adopt_ground_world: async () => { stored = receipt(); throw new Error('reply lost after commit'); },
    mn_load_ground_world_adoption: async () => ({ data: stored, error: null }),
  });
  assert.deepEqual(await f.adoption.adopt({ operationId: OP, request: request() }), result(OP, true));
  assert.deepEqual(f.calls.map(call => call.name), ['mn_adopt_ground_world', 'mn_load_ground_world_adoption']);
});

test('malformed success is terminal and never triggers receipt recovery or a second write', async () => {
  const f = service({
    mn_adopt_ground_world: async () => ({ data: { ok: true, replay: false, worldVersion: 8,
      clock: { world: WORLD, tick, version: 1, operationId: OP } }, error: null }),
    mn_load_ground_world_adoption: async () => ({ data: null, error: null }),
  });
  await assert.rejects(f.adoption.adopt({ operationId: OP, request: request() }),
    error => error instanceof StoreError && error.code === 'response');
  assert.deepEqual(f.calls.map(call => call.name), ['mn_adopt_ground_world']);
});

test('malformed durable evidence after a lost reply fails closed without retry', async () => {
  const bad = { ...receipt(), result: result(OP, true) };
  const f = service({
    mn_adopt_ground_world: async () => { throw new Error('reply lost'); },
    mn_load_ground_world_adoption: async () => ({ data: bad, error: null }),
  });
  await assert.rejects(f.adoption.adopt({ operationId: OP, request: request() }),
    error => error instanceof StoreError && error.code === 'response');
  assert.deepEqual(f.calls.map(call => call.name), ['mn_adopt_ground_world', 'mn_load_ground_world_adoption']);
});

test('an absent receipt retries the same frozen operation once and accepts SQL replay', async () => {
  const sent = [];
  const f = service({
    mn_adopt_ground_world: async args => {
      sent.push(structuredClone(args));
      return sent.length === 1
        ? Promise.reject(new Error('first reply lost'))
        : { data: result(OP, true), error: null };
    },
    mn_load_ground_world_adoption: async () => ({ data: null, error: null }),
  });
  const input = { operationId: OP, request: request() };
  assert.deepEqual(await f.adoption.adopt(input), result(OP, true));
  input.request.worldData.resources.tick = 3;
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[1].p_request.worldData.resources.tick, tick);
});

test('a receipt for another candidate conflicts and an unknown post-retry outcome stays unavailable', async () => {
  const otherId = 'ab120000-0000-4000-8000-000000000002';
  const conflict = service({
    mn_adopt_ground_world: async () => { throw new Error('lost'); },
    mn_load_ground_world_adoption: async () => ({ data: receipt(otherId), error: null }),
  });
  assert.deepEqual(await conflict.adoption.adopt({ operationId: OP, request: request() }), { ok: false, why: 'conflict' });
  assert.equal(conflict.calls.filter(call => call.name === 'mn_adopt_ground_world').length, 1);

  const unknown = service({
    mn_adopt_ground_world: async () => { throw new Error('timeout'); },
    mn_load_ground_world_adoption: async () => { throw new Error('read timeout'); },
  });
  await assert.rejects(unknown.adoption.adopt({ operationId: OP, request: request() }),
    error => error instanceof StoreError && error.code === 'unavailable');
  assert.equal(unknown.calls.filter(call => call.name === 'mn_adopt_ground_world').length, 2);
});

test('malformed or mismatched persisted receipts fail closed', async () => {
  const malformed = service({
    mn_load_ground_world_adoption: async () => ({ data: { ...receipt(), result: result(OP, true) }, error: null }),
  });
  await assert.rejects(malformed.adoption.load(WORLD), error => error instanceof StoreError && error.code === 'response');
  const wrongWorld = service({ mn_load_ground_world_adoption: async () => ({ data: receipt(OP, { ...request(), world: 'other' }), error: null }) });
  await assert.rejects(wrongWorld.adoption.load(WORLD), error => error instanceof StoreError && error.code === 'response');
});
