import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryInferenceConfigMethods, createSupabaseInferenceConfigMethods,
  InferenceConfigStoreError } from '../server/inferenceConfigStore.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const config = () => ({ v: 1, ceilingNanoUsd: 9000000000,
  connections: [{ id: 'local', ceilingNanoUsd: 4000000000 }, { id: 'remote', ceilingNanoUsd: 8000000000 }],
  companions: [{ character, connectionId: 'local', modelId: 'provider:model-a' },
    { character: character2, connectionId: 'remote', modelId: 'provider:model-b' }] });
const scope = { world: 'salty:shore', owner };

test('memory inference config store isolates accounts and worlds and supports exact CAS replay', async () => {
  const store = createMemoryInferenceConfigMethods();
  assert.deepEqual(await store.checkInferenceConfig(), { version: 1 });
  assert.deepEqual(await store.loadInferenceConfig(scope), { revision: 0, config: null, savedAt: null });
  const request = { ...scope, expectedRevision: 0, config: config() };
  const saved = await store.saveInferenceConfig(request);
  assert.equal(saved.ok, true); assert.equal(saved.replay, false); assert.equal(saved.head.revision, 1);
  assert.deepEqual(saved.head.config, config());
  assert.equal(Number.isFinite(Date.parse(saved.head.savedAt)), true);
  assert.deepEqual(await store.saveInferenceConfig(request), { ...saved, replay: true });

  const changed = config(); changed.ceilingNanoUsd++;
  assert.deepEqual(await store.saveInferenceConfig({ ...request, config: changed }),
    { ok: false, why: 'conflict', head: saved.head });
  const second = await store.saveInferenceConfig({ ...scope, expectedRevision: 1, config: changed });
  assert.equal(second.ok, true); assert.equal(second.head.revision, 2);
  assert.deepEqual(await store.saveInferenceConfig(request), { ok: false, why: 'conflict', head: second.head });
  for (const foreign of [{ ...scope, owner: owner2 }, { ...scope, world: 'other-world' }]) {
    assert.deepEqual(await store.loadInferenceConfig(foreign), { revision: 0, config: null, savedAt: null });
  }
  await assert.rejects(store.loadInferenceConfig({ ...scope, extra: true }), /invalid inference config scope/);
});

test('memory inference config store admits one concurrent writer and rejects malformed configuration', async () => {
  const store = createMemoryInferenceConfigMethods();
  const one = config(), two = config(); two.ceilingNanoUsd--;
  const results = await Promise.all([
    store.saveInferenceConfig({ ...scope, expectedRevision: 0, config: one }),
    store.saveInferenceConfig({ ...scope, expectedRevision: 0, config: two }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.why === 'conflict').length, 1);
  const bad = config(); bad.companions[0].connectionId = 'missing';
  await assert.rejects(store.saveInferenceConfig({ ...scope, expectedRevision: 1, config: bad }), /invalid_inference_config/);
  await assert.rejects(store.saveInferenceConfig({ ...scope, expectedRevision: 2147483647, config: config() }),
    /invalid inference config revision/);
  await assert.rejects(store.saveInferenceConfig({ ...scope, expectedRevision: 0, config: config(), extra: true }),
    /invalid inference config save/);
});

test('Supabase inference config store uses scoped RPCs and validates responses without leaking provider errors', async () => {
  const calls = [];
  let result = { version: 1 };
  const methods = createSupabaseInferenceConfigMethods({ async rpc(name, args) {
    calls.push({ name, args }); return { data: structuredClone(result), error: null };
  } });
  assert.deepEqual(await methods.checkInferenceConfig(), { version: 1 });
  result = { revision: 0, config: null, savedAt: null };
  assert.deepEqual(await methods.loadInferenceConfig(scope), result);
  result = { ok: true, replay: false, head: { revision: 1, config: config(), savedAt: new Date().toISOString() } };
  assert.deepEqual(await methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: config() }), result);
  assert.deepEqual(calls.map(call => call.name), [
    'mn_inference_config_ready', 'mn_load_inference_config', 'mn_save_inference_config',
  ]);
  assert.deepEqual(calls[1].args, { p_world: scope.world, p_owner: owner });
  assert.deepEqual(calls[2].args, { p_world: scope.world, p_owner: owner, p_expected_revision: 0, p_config: config() });

  result = { version: 0 };
  await assert.rejects(methods.checkInferenceConfig(), error => error instanceof InferenceConfigStoreError && error.code === 'response');
  result = { revision: 1, config: config(), savedAt: 'not-a-date', unexpected: true };
  await assert.rejects(methods.loadInferenceConfig(scope), error => error instanceof InferenceConfigStoreError && error.code === 'response');
  result = { ok: true, replay: false, head: { revision: 2, config: config(), savedAt: new Date().toISOString() } };
  await assert.rejects(methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: config() }),
    error => error instanceof InferenceConfigStoreError && error.code === 'response');
  const unavailable = createSupabaseInferenceConfigMethods({ async rpc() {
    return { error: { message: 'credential-bearing provider error' } };
  } });
  await assert.rejects(unavailable.checkInferenceConfig(), error => error instanceof InferenceConfigStoreError &&
    error.code === 'unavailable' && !error.message.includes('credential-bearing'));
});
