import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCompanionControlMethods, createSupabaseCompanionControlMethods,
  CompanionControlStoreError } from '../server/companionControlStore.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope = { world: 'salty:shore', owner, character };
const initial = { revision: 0, stopped: true, savedAt: null };

test('memory control store isolates scopes, defaults stopped, CASes and recognizes only an immediate exact retry', async () => {
  const store = createMemoryCompanionControlMethods();
  assert.deepEqual(await store.checkCompanionControl(), { version: 1 });
  assert.deepEqual(await store.loadCompanionControl(scope), initial);

  const first = await store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false });
  assert.equal(first.ok, true); assert.equal(first.replay, false); assert.equal(first.head.revision, 1);
  assert.equal(first.head.stopped, false); assert.equal(Number.isFinite(Date.parse(first.head.savedAt)), true);
  assert.deepEqual(await store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    { ...first, replay: true });

  assert.deepEqual(await store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: true }),
    { ok: false, why: 'conflict', head: first.head });
  const second = await store.saveCompanionControl({ ...scope, expectedRevision: 1, stopped: true });
  assert.equal(second.ok, true); assert.equal(second.replay, false); assert.equal(second.head.revision, 2);
  assert.equal(second.head.stopped, true);
  assert.deepEqual(await store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    { ok: false, why: 'conflict', head: second.head });

  for (const foreign of [
    { ...scope, owner: owner2 }, { ...scope, character: character2 }, { ...scope, world: 'another-world' },
  ]) assert.deepEqual(await store.loadCompanionControl(foreign), initial);
  await assert.rejects(store.loadCompanionControl({ ...scope, owner: character }), /invalid companion control scope/);
});

test('memory control store serializes concurrent first saves and rejects malformed DTOs', async () => {
  const store = createMemoryCompanionControlMethods();
  const results = await Promise.all([
    store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    store.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: true }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.why === 'conflict').length, 1);

  for (const invalid of [
    { ...scope, expectedRevision: 0, stopped: false, extra: true },
    { ...scope, expectedRevision: 0, stopped: 1 },
    { ...scope, expectedRevision: 2147483647, stopped: false },
    { ...scope, owner: '00000000-0000-0000-0000-000000000000' },
    { ...scope, character: owner },
    { ...scope, world: 'bad world' },
  ]) await assert.rejects(store.saveCompanionControl(invalid));
  await assert.rejects(store.loadCompanionControl({ ...scope, extra: true }));
});

test('Supabase methods use only scoped RPCs, validate response DTOs, and hide provider errors', async () => {
  const calls = [];
  let result = { version: 1 };
  const methods = createSupabaseCompanionControlMethods({ async rpc(name, args) {
    calls.push({ name, args }); return { data: structuredClone(result), error: null };
  } });
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });
  result = initial;
  assert.deepEqual(await methods.loadCompanionControl(scope), initial);
  result = { ok: true, replay: false, head: { revision: 1, stopped: false, savedAt: new Date().toISOString() } };
  const saved = await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false });
  assert.deepEqual(saved, result);
  assert.deepEqual(calls.map(call => call.name), [
    'mn_companion_control_ready', 'mn_load_companion_control', 'mn_save_companion_control',
  ]);
  assert.deepEqual(calls[1].args, { p_world: scope.world, p_owner: owner, p_character: character });
  assert.deepEqual(calls[2].args, { p_world: scope.world, p_owner: owner, p_character: character,
    p_expected_revision: 0, p_stopped: false });

  result = { version: 0 };
  await assert.rejects(methods.checkCompanionControl(), error => error instanceof CompanionControlStoreError && error.code === 'response');
  result = { revision: 0, stopped: false, savedAt: null };
  await assert.rejects(methods.loadCompanionControl(scope), error => error instanceof CompanionControlStoreError && error.code === 'response');
  result = { revision: 1, stopped: false, savedAt: 'not-a-date', internal: 'unexpected' };
  await assert.rejects(methods.loadCompanionControl(scope), error => error instanceof CompanionControlStoreError && error.code === 'response');
  result = { ok: false, why: 'conflict', head: initial };
  assert.deepEqual(await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: true }),
    { ok: false, why: 'conflict', head: initial });

  const unavailable = createSupabaseCompanionControlMethods({ async rpc() { return { error: { message: 'credential-bearing detail' } }; } });
  await assert.rejects(unavailable.checkCompanionControl(), error => error instanceof CompanionControlStoreError &&
    error.code === 'unavailable' && !error.message.includes('credential-bearing'));
  assert.throws(() => createSupabaseCompanionControlMethods({}), error => error instanceof CompanionControlStoreError && error.code === 'configuration');
});
