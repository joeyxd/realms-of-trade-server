import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { database } from './helpers/community-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3);
const row = (characterId = CHAR, worldId = WORLD, worldEpoch = EPOCH, name = 'Nerea') => ({
  worldId, worldEpoch, characterId, version: 1,
  data: { v: 1, name, eco: { tradeRev: 0, pack: { cap: 40, goods: { madera: 4 } } } },
});
const binding = (overrides = {}) => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH,
  characterId: CHAR, ...overrides });
const memory = (characters = [row()]) => createMemoryContributionStore({ characters, bindings: [] });
async function sqlStore(t, options = {}) {
  const sql = await database(undefined, { bindings: true, ...options });
  t.after(() => sql.close());
  return sql;
}

test('memory bindings require an existing character, replay exactly, and cannot be reassigned', async () => {
  const store = memory([]);
  assert.deepEqual(await store.initializeBinding(binding()), { ok: false, why: 'missing' });
  await store.initializeCharacter(row());
  assert.deepEqual(await store.initializeBinding(binding()), { ok: true, binding: binding() });
  assert.deepEqual(await store.initializeBinding(binding()), { ok: true, binding: binding() });
  assert.deepEqual(await store.initializeBinding(binding({ accountId: id(9) })),
    { ok: false, why: 'conflict' }, 'another account cannot claim the already-bound character');
  assert.deepEqual(await store.initializeBinding(binding({ characterId: id(4) })),
    { ok: false, why: 'missing' });
  await store.initializeCharacter(row(id(4), WORLD, EPOCH, 'Replacement'));
  assert.deepEqual(await store.initializeBinding(binding({ characterId: id(4) })),
    { ok: false, why: 'conflict' });
  assert.deepEqual(await store.loadBinding(ACCOUNT, WORLD, EPOCH), binding());
});

test('SQL bindings require an existing character, replay exactly, and cannot be reassigned', async t => {
  const sql = await sqlStore(t);
  assert.deepEqual(await sql.store.initializeBinding(binding()), { ok: false, why: 'missing' });
  await sql.store.initializeCharacter(row());
  assert.deepEqual(await sql.store.initializeBinding(binding()), { ok: true, binding: binding() });
  assert.deepEqual(await sql.store.initializeBinding(binding()), { ok: true, binding: binding() });
  assert.deepEqual(await sql.store.initializeBinding(binding({ accountId: id(9) })),
    { ok: false, why: 'conflict' }, 'another account cannot claim the already-bound character');
  await sql.store.initializeCharacter(row(id(4), WORLD, EPOCH, 'Replacement'));
  assert.deepEqual(await sql.store.initializeBinding(binding({ characterId: id(4) })),
    { ok: false, why: 'conflict' });
  assert.deepEqual(await sql.store.loadBinding(ACCOUNT, WORLD, EPOCH), binding());
});

test('binding ownership is unique per world epoch and character collisions are scope-local', async t => {
  for (const kind of ['memory', 'sql']) {
    const sql = kind === 'sql' ? await sqlStore(t) : null;
    const store = sql?.store ?? memory([]);
    const create = async (b, name) => {
      const initialized = await store.initializeCharacter(row(b.characterId, b.worldId, b.worldEpoch, name));
      assert.equal(initialized.ok, true);
      return store.initializeBinding(b);
    };
    assert.deepEqual(await create(binding(), 'First'), { ok: true, binding: binding() });
    assert.deepEqual(await create(binding({ characterId: id(4) }), 'Other'), { ok: false, why: 'conflict' });
    const otherWorld = binding({ worldId: 'other-world' });
    assert.deepEqual(await create(otherWorld, 'Other world'), { ok: true, binding: otherWorld });
    const otherEpoch = binding({ worldEpoch: id(8) });
    assert.deepEqual(await create(otherEpoch, 'Other epoch'), { ok: true, binding: otherEpoch });
    assert.equal((await store.loadBinding(ACCOUNT, 'other-world', EPOCH)).characterId, CHAR);
    assert.equal(await store.loadBinding(ACCOUNT, WORLD, id(9)), null);
  }
});

test('strict binding fields and canonical plain objects are enforced by both adapters', async t => {
  const sql = await sqlStore(t), stores = [memory(), sql.store];
  for (const store of stores) {
    for (const invalid of [
      { ...binding(), extra: true },
      { ...binding(), accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase() },
      { ...binding(), worldId: 'world with spaces' },
      { ...binding(), characterId: '00000000-0000-0000-0000-000000000000' },
      Object.assign(Object.create({ inherited: true }), binding()),
    ]) {
      await assert.rejects(store.initializeBinding(invalid), error => error.code === 'input');
    }
    const accessor = { ...binding() };
    Object.defineProperty(accessor, 'worldId', { enumerable: true, get: () => WORLD });
    await assert.rejects(store.initializeBinding(accessor), error => error.code === 'input');
    await assert.rejects(store.loadBinding(ACCOUNT, WORLD, `${EPOCH} `), error => error.code === 'input');
  }
});

test('SQL binding RPC validates raw JSON and denies direct DML and untrusted roles', async t => {
  const sql = await sqlStore(t);
  await sql.store.initializeCharacter(row());
  const forged = { ...binding(), owner: 'client-claim' };
  await assert.rejects(sql.db.query('select public.mn_comm_initialize_binding($1::jsonb)', [JSON.stringify(forged)]),
    error => error.code === 'CMI01');
  await assert.rejects(sql.db.exec('insert into public.mn_comm_character_bindings default values'),
    error => error.code === '42501');
  await sql.db.exec('SET ROLE authenticated');
  await assert.rejects(sql.db.query('select public.mn_comm_load_binding($1,$2,$3)', [ACCOUNT, WORLD, EPOCH]),
    error => error.code === '42501');
  await sql.db.exec('RESET ROLE');
});

test('SQL migration reapplies cleanly and lost initialize reply is recovered by exact scoped read', async t => {
  const sql = await sqlStore(t, { reapply: true });
  await sql.store.initializeCharacter(row());
  await sql.store.initializeBinding(binding());
  const { communityBindingsSql } = await import('./helpers/community-sql.mjs');
  await sql.db.exec(`RESET ROLE; ${communityBindingsSql} SET ROLE service_role;`);
  assert.deepEqual(await sql.store.loadBinding(ACCOUNT, WORLD, EPOCH), binding(),
    'reapplying the binding migration preserves provisioned ownership');
  let lose = true;
  // Use a second local SDK adapter over the same PGlite database to inject a reply loss.
  const { adapters } = await import('./helpers/community-sql.mjs');
  const lossy = adapters(sql.db, [], { loseReply: name => {
    if (name !== 'mn_comm_initialize_binding' || !lose) return false;
    lose = false; return true;
  } }).store;
  await assert.rejects(lossy.initializeBinding(binding()), error => error.code === 'unavailable');
  assert.deepEqual(await sql.store.loadBinding(ACCOUNT, WORLD, EPOCH), binding());
});

test('binding survives a disk reopen without changing its owner', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'community-bindings-'));
  const dir = resolve(parent, 'database');
  assert.ok(dir.startsWith(resolve(parent) + '\\') || dir.startsWith(resolve(parent) + '/'));
  let sql;
  t.after(async () => {
    await sql?.close();
    assert.equal(dirname(resolve(parent)), resolve(tmpdir()));
    assert.ok(basename(parent).startsWith('community-bindings-'));
    await rm(parent, { recursive: true, force: true });
  });
  sql = await database(dir, { bindings: true });
  await sql.store.initializeCharacter(row());
  await sql.store.initializeBinding(binding());
  await sql.close(); sql = null;
  sql = await database(dir, { bindings: true });
  assert.deepEqual(await sql.store.loadBinding(ACCOUNT, WORLD, EPOCH), binding());
  assert.equal(basename(dir), 'database');
  assert.equal(dirname(dir), resolve(parent));
});
