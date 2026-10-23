import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCompanionPresenceMethods, createSupabaseCompanionPresenceMethods,
  CompanionPresenceStoreError } from '../server/companionPresenceStore.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const run = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const nextRun = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scope = { world: 'salty:shore', owner, character };
const initial = { revision: 0, active: false, runId: null, savedAt: null };

test('memory presence gate requires a fresh run to admit and the same run to retire', async () => {
  const store = createMemoryCompanionPresenceMethods();
  assert.deepEqual(await store.checkCompanionPresence(), { version: 1 });
  assert.deepEqual(await store.loadCompanionPresence(scope), initial);

  const started = await store.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run });
  assert.equal(started.ok, true); assert.equal(started.replay, false);
  assert.equal(started.head.revision, 1); assert.equal(started.head.active, true); assert.equal(started.head.runId, run);
  assert.equal(Number.isFinite(Date.parse(started.head.savedAt)), true);
  assert.deepEqual(await store.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    { ...started, replay: true });
  assert.deepEqual(await store.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: nextRun }),
    { ok: false, why: 'conflict', head: started.head });

  const wrongRunClose = await store.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: nextRun });
  assert.deepEqual(wrongRunClose, { ok: false, why: 'conflict', head: started.head });
  const closed = await store.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: run });
  assert.equal(closed.ok, true); assert.equal(closed.head.revision, 2); assert.equal(closed.head.active, false);
  assert.equal(closed.head.runId, run);
  assert.deepEqual(await store.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: run }),
    { ...closed, replay: true });
  assert.deepEqual(await store.saveCompanionPresence({ ...scope, expectedRevision: 2, active: true, runId: run }),
    { ok: false, why: 'conflict', head: closed.head }, 'a run UUID cannot be reused after retirement');

  const restarted = await store.saveCompanionPresence({ ...scope, expectedRevision: 2, active: true, runId: nextRun });
  assert.equal(restarted.ok, true); assert.equal(restarted.head.revision, 3); assert.equal(restarted.head.runId, nextRun);
});

test('memory presence gate serializes concurrent admission and rejects malformed values', async () => {
  const store = createMemoryCompanionPresenceMethods();
  const race = await Promise.all([
    store.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    store.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: nextRun }),
  ]);
  assert.equal(race.filter(result => result.ok).length, 1);
  assert.equal(race.filter(result => !result.ok && result.why === 'conflict').length, 1);

  for (const invalid of [
    { ...scope, expectedRevision: 0, active: true, runId: run, extra: true },
    { ...scope, expectedRevision: 0, active: 1, runId: run },
    { ...scope, expectedRevision: 2147483647, active: true, runId: run },
    { ...scope, expectedRevision: 0, active: true, runId: ZERO_UUID },
    { ...scope, expectedRevision: 0, active: true, runId: 'bad' },
    { ...scope, owner: ZERO_UUID }, { ...scope, character: owner }, { ...scope, world: 'bad world' },
  ]) await assert.rejects(store.saveCompanionPresence(invalid));
  await assert.rejects(store.loadCompanionPresence({ ...scope, extra: true }));
});

test('Supabase presence methods call scoped RPCs, validate strict DTOs, and hide provider errors', async () => {
  const calls = [];
  let result = { version: 1 };
  const methods = createSupabaseCompanionPresenceMethods({ async rpc(name, args) {
    calls.push({ name, args }); return { data: structuredClone(result), error: null };
  } });
  assert.deepEqual(await methods.checkCompanionPresence(), { version: 1 });
  result = initial;
  assert.deepEqual(await methods.loadCompanionPresence(scope), initial);
  result = { ok: true, replay: false, head: { revision: 1, active: true, runId: run, savedAt: new Date().toISOString() } };
  const saved = await methods.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run });
  assert.deepEqual(saved, result);
  assert.deepEqual(calls.map(call => call.name), [
    'mn_companion_presence_ready', 'mn_load_companion_presence', 'mn_save_companion_presence',
  ]);
  assert.deepEqual(calls[1].args, { p_world: scope.world, p_owner: owner, p_character: character });
  assert.deepEqual(calls[2].args, { p_world: scope.world, p_owner: owner, p_character: character,
    p_expected_revision: 0, p_active: true, p_run_id: run });

  result = { version: 0 };
  await assert.rejects(methods.checkCompanionPresence(), error => error instanceof CompanionPresenceStoreError && error.code === 'response');
  result = { revision: 0, active: false, runId: run, savedAt: null };
  await assert.rejects(methods.loadCompanionPresence(scope), error => error instanceof CompanionPresenceStoreError && error.code === 'response');
  result = { revision: 1, active: false, runId: ZERO_UUID, savedAt: new Date().toISOString() };
  await assert.rejects(methods.loadCompanionPresence(scope), error => error instanceof CompanionPresenceStoreError && error.code === 'response');
  result = { ok: false, why: 'conflict', head: initial };
  assert.deepEqual(await methods.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    { ok: false, why: 'conflict', head: initial });
  result = { ok: true, replay: false, head: { revision: 1, active: true, runId: nextRun, savedAt: new Date().toISOString() } };
  await assert.rejects(methods.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    error => error instanceof CompanionPresenceStoreError && error.code === 'response');

  const unavailable = createSupabaseCompanionPresenceMethods({ async rpc() { return { error: { message: 'private detail' } }; } });
  await assert.rejects(unavailable.checkCompanionPresence(), error => error instanceof CompanionPresenceStoreError &&
    error.code === 'unavailable' && !error.message.includes('private detail'));
  assert.throws(() => createSupabaseCompanionPresenceMethods({}), error => error instanceof CompanionPresenceStoreError && error.code === 'configuration');
});

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
