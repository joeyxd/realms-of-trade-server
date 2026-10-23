import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCompanionConfigMethods, createSupabaseCompanionConfigMethods,
  CompanionConfigStoreError } from '../server/companionConfigStore.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const config = () => ({ v: 1, personality: 'Amable y prudente', goals: [
  { id: 'help-village', status: 'active', text: 'Ayudar a la aldea cuando sea seguro.', constraints: ['No gastar oro sin autorización'] },
] });
const scope = { world: 'salty:shore', owner, character };

test('memory config store isolates scopes, performs CAS, and recognizes only the immediate exact retry', async () => {
  const store = createMemoryCompanionConfigMethods();
  assert.deepEqual(await store.checkCompanionConfig(), { version: 1 });
  assert.deepEqual(await store.loadCompanionConfig(scope), { revision: 0, config: null, savedAt: null });

  const first = await store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() });
  assert.equal(first.ok, true); assert.equal(first.replay, false); assert.equal(first.head.revision, 1);
  assert.deepEqual(first.head.config, config());
  assert.equal(Number.isFinite(Date.parse(first.head.savedAt)), true);
  assert.deepEqual(await store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() }),
    { ...first, replay: true });

  const changed = config(); changed.personality = 'Más directa';
  assert.deepEqual(await store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: changed }),
    { ok: false, why: 'conflict', head: first.head });
  const second = await store.saveCompanionConfig({ ...scope, expectedRevision: 1, config: changed });
  assert.equal(second.ok, true); assert.equal(second.replay, false); assert.equal(second.head.revision, 2);
  assert.deepEqual(await store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() }),
    { ok: false, why: 'conflict', head: second.head });

  assert.deepEqual(await store.loadCompanionConfig({ ...scope, owner: owner2 }), { revision: 0, config: null, savedAt: null });
  assert.deepEqual(await store.loadCompanionConfig({ ...scope, character: character2 }), { revision: 0, config: null, savedAt: null });
  assert.deepEqual(await store.loadCompanionConfig({ ...scope, world: 'another-world' }), { revision: 0, config: null, savedAt: null });
  await assert.rejects(store.loadCompanionConfig({ ...scope, owner: character }), /invalid companion config scope/);
});

test('memory config store serializes concurrent first saves and rejects malformed DTOs', async () => {
  const store = createMemoryCompanionConfigMethods();
  const one = config(), two = config(); two.personality = 'Otra';
  const results = await Promise.all([
    store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: one }),
    store.saveCompanionConfig({ ...scope, expectedRevision: 0, config: two }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.why === 'conflict').length, 1);
  const invalid = config(); invalid.goals[0].id = 'bad id';
  await assert.rejects(store.saveCompanionConfig({ ...scope, expectedRevision: 1, config: invalid }));
  await assert.rejects(store.saveCompanionConfig({ ...scope, expectedRevision: 2147483647, config: config() }));
  await assert.rejects(store.loadCompanionConfig({ ...scope, extra: true }));
});

test('Supabase methods use only scoped RPCs, validate responses, and hide provider errors', async () => {
  const calls = [];
  let result = { version: 1 };
  const methods = createSupabaseCompanionConfigMethods({ async rpc(name, args) {
    calls.push({ name, args }); return { data: structuredClone(result), error: null };
  } });
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });
  result = { revision: 0, config: null, savedAt: null };
  assert.deepEqual(await methods.loadCompanionConfig(scope), result);
  result = { ok: true, replay: false, head: { revision: 1, config: config(), savedAt: new Date().toISOString() } };
  assert.deepEqual(await methods.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() }), result);
  assert.deepEqual(calls.map(call => call.name), [
    'mn_companion_config_ready', 'mn_load_companion_config', 'mn_save_companion_config',
  ]);
  assert.deepEqual(calls[1].args, { p_world: scope.world, p_owner: owner, p_character: character });
  assert.deepEqual(calls[2].args, { p_world: scope.world, p_owner: owner, p_character: character,
    p_expected_revision: 0, p_config: config() });

  result = { version: 0 };
  await assert.rejects(methods.checkCompanionConfig(), error => error instanceof CompanionConfigStoreError && error.code === 'response');
  result = { revision: 1, config: config(), savedAt: 'not-a-date', internal: 'unexpected' };
  await assert.rejects(methods.loadCompanionConfig(scope), error => error instanceof CompanionConfigStoreError && error.code === 'response');
  const unavailable = createSupabaseCompanionConfigMethods({ async rpc() { return { error: { message: 'credential-bearing detail' } }; } });
  await assert.rejects(unavailable.checkCompanionConfig(), error => error instanceof CompanionConfigStoreError &&
    error.code === 'unavailable' && !error.message.includes('credential-bearing'));
});
