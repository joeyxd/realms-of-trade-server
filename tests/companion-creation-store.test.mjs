import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCompanionCreationMethods, createSupabaseCompanionCreationMethods,
  CompanionCreationStoreError } from '../server/companionCreationStore.mjs';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig } from '../src/net/companionCreation.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const world = 'world:salty-shore';
const creationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const request = (overrides = {}) => {
  const preset = structuredClone(DEFAULT_COMPANION_PRESET);
  return { world, owner, creationId, preset, config: companionCreationConfig(preset), ...overrides };
};

test('memory companion creation is private by scope, stopped by default, and idempotent only for exact creation input', async () => {
  let serial = 0;
  const store = createMemoryCompanionCreationMethods({
    now: () => '2026-10-11T12:00:00.000Z',
    characterId: () => `cccccccc-cccc-4ccc-8ccc-${String(++serial).padStart(12, '0')}`,
  });
  assert.deepEqual(await store.checkCompanionCreation(), { version: 1 });
  assert.equal(await store.loadCompanionCreation({ world, owner }), null);
  const first = await store.createCompanion(request());
  assert.equal(first.ok, true); assert.equal(first.replay, false);
  assert.equal(first.record.configuration.revision, 1);
  assert.equal(first.record.control.stopped, true); assert.equal(first.record.control.revision, 1);
  assert.deepEqual(await store.loadCompanionCreation({ world, owner }), first.record);
  assert.deepEqual(await store.createCompanion(request()), { ...first, replay: true });

  const otherPreset = structuredClone(DEFAULT_COMPANION_PRESET); otherPreset.name = 'Cobalto';
  assert.deepEqual(await store.createCompanion(request({ preset: otherPreset, config: companionCreationConfig(otherPreset) })),
    { ok: false, why: 'conflict', record: first.record });
  assert.deepEqual(await store.createCompanion(request({ creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })),
    { ok: false, why: 'limit', record: first.record });
  assert.equal(await store.loadCompanionCreation({ world, owner: owner2 }), null);
  assert.equal(await store.loadCompanionCreation({ world: 'another-world', owner }), null);
  const otherOwner = await store.createCompanion(request({ owner: owner2, creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
  assert.equal(otherOwner.ok, true);
  assert.notEqual(first.record.characterKey, otherOwner.record.characterKey);
});

test('memory store serializes concurrent create calls and rejects malformed contracts', async () => {
  const store = createMemoryCompanionCreationMethods();
  const one = request(), two = request({ creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  const race = await Promise.all([store.createCompanion(one), store.createCompanion(two)]);
  assert.equal(race.filter(row => row.ok).length, 1);
  assert.equal(race.filter(row => !row.ok && row.why === 'limit').length, 1);
  await assert.rejects(store.loadCompanionCreation({ world, owner, extra: true }), /invalid companion creation scope/);
  await assert.rejects(store.createCompanion({ ...request(), extra: true }), /invalid companion creation/);
  await assert.rejects(store.createCompanion(request({ owner: 'bad' })), /invalid companion creation scope/);
  await assert.rejects(store.createCompanion(request({ creationId: '00000000-0000-0000-0000-000000000000' })), /invalid companion creation/);
  const changedConfig = companionCreationConfig(one.preset); changedConfig.personality += '\nextra';
  await assert.rejects(store.createCompanion(request({ config: changedConfig })), /invalid companion creation config/);
});

test('memory store enforces the 64-per-world limit and global character identity uniqueness', async () => {
  let serial = 0;
  const store = createMemoryCompanionCreationMethods({
    characterId: () => `cccccccc-cccc-4ccc-8ccc-${String(++serial).padStart(12, '0')}`,
  });
  for (let index = 0; index < 64; index++) {
    const account = `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`;
    const created = await store.createCompanion(request({ owner: account,
      creationId: `eeeeeeee-eeee-4eee-8eee-${String(index + 1).padStart(12, '0')}` }));
    assert.equal(created.ok, true);
  }
  const over = await store.createCompanion(request({ owner: '99999999-9999-4999-8999-999999999999' }));
  assert.deepEqual(over, { ok: false, why: 'limit', record: null });

  let ids = 0;
  const collision = createMemoryCompanionCreationMethods({ characterId: () => {
    ids++;
    return ids === 1 ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  } });
  await collision.createCompanion(request());
  await assert.rejects(collision.createCompanion(request({ world: 'another-world', owner: owner2 })),
    error => error instanceof CompanionCreationStoreError && error.code === 'response');
});

test('Supabase methods use exact scoped RPCs, validate result shapes, and redact provider errors', async () => {
  const calls = [];
  const valid = request();
  let returned = { version: 1 };
  const methods = createSupabaseCompanionCreationMethods({ async rpc(name, args) {
    calls.push({ name, args }); return { data: structuredClone(returned), error: null };
  } });
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
  returned = null;
  assert.equal(await methods.loadCompanionCreation({ world, owner }), null);
  returned = { ok: true, replay: false, record: {
    characterKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', creationId, preset: valid.preset,
    createdAt: '2026-10-11T12:00:00.000Z',
    configuration: { revision: 1, config: valid.config, savedAt: '2026-10-11T12:00:00.000Z' },
    control: { revision: 1, stopped: true, savedAt: '2026-10-11T12:00:00.000Z' },
  } };
  assert.deepEqual(await methods.createCompanion(valid), returned);
  assert.deepEqual(calls.map(call => call.name), [
    'mn_companion_creation_ready', 'mn_load_companion_creation', 'mn_create_companion',
  ]);
  assert.deepEqual(calls[1].args, { p_world: world, p_owner: owner });
  assert.deepEqual(calls[2].args, { p_world: world, p_owner: owner, p_creation_id: creationId,
    p_preset: valid.preset, p_config: valid.config });

  returned = { ok: false, why: 'limit', record: null };
  assert.deepEqual(await methods.createCompanion(valid), returned);
  returned = { ok: true, replay: false, record: {} };
  await assert.rejects(methods.createCompanion(valid), error => error instanceof CompanionCreationStoreError && error.code === 'response');
  const unavailable = createSupabaseCompanionCreationMethods({ async rpc() {
    return { error: { code: 'secret', message: 'credential-bearing provider error' } };
  } });
  await assert.rejects(unavailable.checkCompanionCreation(), error => error instanceof CompanionCreationStoreError &&
    error.code === 'unavailable' && !error.message.includes('credential-bearing'));
});
