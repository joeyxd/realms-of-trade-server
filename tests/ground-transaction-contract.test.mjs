import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import {
  groundTransactionOperation, checkedGroundTransactionResult, checkedGroundTransactionReceipt,
} from '../server/groundTransaction.mjs';

const id = n => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WORLD = 'world:salty-shore';
const worldData = (tick = 0) => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });
const request = (patch = {}) => ({ world: WORLD, expectedWorldVersion: 1, worldData: worldData(), family: 'checkpoint',
  operation: {}, clock: { operationId: id(2), expectedVersion: 1, expectedTick: 0, tick: 0 }, ...patch });
const operation = (patch = {}) => ({ operationId: id(1), request: request(), ...patch });
const snapshot = (raw = operation()) => groundTransactionOperation(raw);
const success = (raw = snapshot()) => ({ ok: true, replay: false, worldVersion: raw.request.expectedWorldVersion + 1,
  clock: { world: raw.request.world, tick: raw.request.clock.tick,
    version: raw.request.clock.expectedVersion + (raw.request.clock.tick > raw.request.clock.expectedTick ? 1 : 0),
    operationId: raw.request.clock.operationId }, effect: { ok: true, replay: false } });
const rejects = raw => assert.throws(() => groundTransactionOperation(raw));

test('checkpoint envelope accepts exact canonical input and binds its independent clock', () => {
  const raw = operation(), checked = snapshot(raw);
  assert.deepEqual(checked, raw);
  assert.deepEqual(checkedGroundTransactionResult(success(checked), checked.request, checked.operationId), success(checked));
  assert.deepEqual(checkedGroundTransactionReceipt({ request: checked.request, result: success(checked) }, checked.operationId),
    { request: checked.request, result: success(checked) });
  assert.equal(checkedGroundTransactionReceipt(null, checked.operationId), null);
});

test('checkpoint permits a same-tick transaction without increasing the ground clock version', () => {
  const raw = operation({ request: request({ expectedWorldVersion: 8, worldData: worldData(15),
    clock: { operationId: id(3), expectedVersion: 4, expectedTick: 15, tick: 15 } }) });
  const checked = snapshot(raw), result = success(checked);
  assert.equal(result.worldVersion, 9);
  assert.equal(result.clock.version, 4);
  assert.deepEqual(checkedGroundTransactionResult(result, checked.request, checked.operationId), result);
});

test('ground family preserves its complete canonical SQL request and rejects fields it would otherwise drop', () => {
  const groundOperation = { uid: 'contract-ground-pearl', kind: 'brasa', from: null, to: null, expectedVersion: 0,
    profiles: [], world: WORLD, ground: { x: 12.5, z: -7.25, availableAt: 0, returnAt: 100 } };
  const input = operation({ request: request({ family: 'ground', operation: groundOperation }) });
  const checked = snapshot(input);
  assert.deepEqual(checked, input);
  for (const candidate of [
    { ...groundOperation, ignored: true },
    { ...groundOperation, world: 'world:other' },
    { ...groundOperation, ground: { ...groundOperation.ground, returnAt: 0 } },
  ]) rejects(operation({ request: request({ family: 'ground', operation: candidate }) }));
});

test('rejects unsafe JSON, noncanonical input, malformed envelopes, and oversized payloads', () => {
  const extra = operation(); extra.unexpected = true;
  const nestedExtra = operation(); nestedExtra.request.operation.unexpected = true;
  const hidden = operation(); Object.defineProperty(hidden, 'hidden', { value: true });
  const symbol = operation(); symbol[Symbol('hidden')] = true;
  let callbacks = 0;
  const getter = operation(); Object.defineProperty(getter.request.clock, 'tick', { enumerable: true, get() { callbacks++; return 0; } });
  const proxy = new Proxy(operation(), { ownKeys() { callbacks++; return Reflect.ownKeys(operation()); } });
  const sparse = operation(); sparse.request.worldData.resources.nodes.length = 2;
  const cycle = operation(); cycle.request.worldData.loop = cycle.request.worldData;
  const invalids = [null, [], extra, nestedExtra, hidden, symbol, getter, proxy, sparse, cycle,
    operation({ request: request({ worldData: { ...worldData(), seed: Number.NaN } }) }),
    operation({ request: request({ worldData: { ...worldData(), note: 'x'.repeat(2 * 1024 * 1024) } }) })];
  for (const raw of invalids) rejects(raw);
  assert.equal(callbacks, 0, 'validation must not invoke getters or proxy traps');
  assert.throws(() => groundTransactionOperation({ ...operation(), operationId: id(2) }),
    'outer and clock operation UUIDs must be distinct');
});

test('rejects invalid UUIDs, world identity, versions, clock ranges, and tick disagreement', () => {
  const mutate = (fn) => { const raw = operation(); fn(raw); return raw; };
  for (const raw of [
    mutate(x => { x.operationId = 'not-a-uuid'; }),
    mutate(x => { x.operationId = '00000000-0000-0000-0000-000000000000'; }),
    mutate(x => { x.request.clock.operationId = x.operationId; }),
    mutate(x => { x.request.expectedWorldVersion = 0; }),
    mutate(x => { x.request.expectedWorldVersion = 2147483647; }),
    mutate(x => { x.request.clock.expectedVersion = 0; }),
    mutate(x => { x.request.clock.expectedTick = 2; x.request.clock.tick = 1; }),
    mutate(x => { x.request.clock.tick = 1; }),
    mutate(x => { x.request.worldData.resources.tick = 1; }),
    mutate(x => { x.request.clock.tick = 0x100000000; }),
    mutate(x => { x.request.clock.expectedTick = 0x100000000; }),
    mutate(x => { x.request.clock.tick = Number.MAX_SAFE_INTEGER + 1; }),
    mutate(x => { x.request.clock.tick = 1.5; }),
    mutate(x => { x.request.family = 'unknown'; }),
    mutate(x => { x.request.family = 'economic'; }),
    mutate(x => { x.request.world = 'bad world'; }),
    mutate(x => { x.request.operation.world = 'other:world'; }),
  ]) rejects(raw);
});

test('result and receipt validation rejects changed bindings, replay, version, and family effects', () => {
  const checked = snapshot(), good = success(checked);
  const invalidResults = [
    { ...good, worldVersion: 1 },
    { ...good, worldVersion: 0 },
    { ...good, clock: { ...good.clock, world: 'world:other' } },
    { ...good, clock: { ...good.clock, tick: 1 } },
    { ...good, clock: { ...good.clock, version: good.clock.version + 1 } },
    { ...good, clock: { ...good.clock, operationId: id(44) } },
    { ...good, effect: { ok: true, replay: false, family: 'economic' } },
    { ok: false, why: 'kind', extra: true },
    { ok: false, why: 'unknown' },
    { ...good, extra: true },
  ];
  for (const result of invalidResults) assert.throws(() => checkedGroundTransactionResult(result, checked.request, checked.operationId));
  for (const receipt of [
    { request: checked.request, result: { ...good, replay: true } },
    { request: { ...checked.request, world: 'world:other' }, result: good },
    { request: { ...checked.request, clock: { ...checked.request.clock, tick: 1 } }, result: good },
    { request: checked.request, result: { ...good, worldVersion: 7 } },
    { request: checked.request, result: good, extra: true },
  ]) assert.throws(() => checkedGroundTransactionReceipt(receipt, checked.operationId));
});

test('only the declared checkpoint effect is accepted for the checkpoint family', () => {
  const checked = snapshot(), good = success(checked);
  for (const effect of [null, {}, { ok: true, replay: false, profiles: [] }, { ok: false, why: 'conflict' }])
    assert.throws(() => checkedGroundTransactionResult({ ...good, effect }, checked.request, checked.operationId));
  for (const failure of ['operation', 'conflict', 'ownership', 'kind'])
    assert.deepEqual(checkedGroundTransactionResult({ ok: false, why: failure }, checked.request, checked.operationId),
      { ok: false, why: failure });
});
