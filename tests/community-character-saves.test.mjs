import test from 'node:test';
import assert from 'node:assert/strict';
import { ContributionError } from '../server/community/contributionContract.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { adapters, communitySessionSql, database } from './helpers/community-sql.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = uuid(1), CHAR = uuid(2), PROJECT = 'salty:hall';
function character(version = 1) {
  return { worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, version, data: {
    v: 1, name: 'Nerea', gold: 321, flags: { tier: 3, nested: ['keep'] },
    eco: { tradeRev: 9, pack: { cap: 40, goods: { madera: 7, piedra: 2 } }, markets: { Aldea: { madera: 5 } } },
    raft: { id: 'raft-keep', cargo: { tronco: 4 } }, custom: { untouched: true },
  } };
}
const project = () => ({ worldId: WORLD, worldEpoch: EPOCH, projectId: PROJECT, version: 1,
  requirements: { madera: 10 }, contributed: { madera: 2 } });
const contribution = (characterVersion, operation = 10) => ({ operationId: uuid(operation), worldId: WORLD,
  worldEpoch: EPOCH, characterId: CHAR, projectId: PROJECT, good: 'madera', amount: 2,
  expectedCharacterVersion: characterVersion, expectedProjectVersion: 1 });
const freshData = (name = 'Nerea II') => {
  const data = structuredClone(character().data);
  data.name = name; data.gold = 999; data.custom.saved = true;
  return data;
};
async function sqlFixture(t, options = {}) {
  const sql = await database(undefined, { sessionSaves: true, ...options });
  t.after(() => sql.close());
  await sql.store.initializeCharacter(character());
  await sql.store.initializeProject(project());
  return sql;
}

test('ordinary profile save and contribution serialize through the same character revision', async t => {
  const sql = await sqlFixture(t);
  const memory = createMemoryContributionStore({ characters: [character()], projects: [project()] });
  for (const store of [memory, sql.store]) {
    const data = freshData();
    assert.deepEqual(await store.saveCharacter({ ...character(), data }),
      { ok: true, character: { ...character(2), data } });
    const contributed = await store.commitContribution(contribution(2));
    assert.equal(contributed.ok, true);
    assert.equal(contributed.character.version, 3);
    assert.equal(contributed.character.data.name, 'Nerea II');
    assert.equal(contributed.character.data.gold, 999);
    assert.equal(contributed.character.data.custom.saved, true);
    assert.equal(contributed.character.data.eco.tradeRev, 10);
    assert.equal(contributed.character.data.eco.pack.goods.madera, 5);
    assert.deepEqual(contributed.character.data.raft, character().data.raft);
    assert.deepEqual(contributed.character.data.flags, character().data.flags);
  }
});

test('a contribution makes a stale ordinary save lose without overwriting any profile data', async t => {
  const sql = await sqlFixture(t);
  const memory = createMemoryContributionStore({ characters: [character()], projects: [project()] });
  for (const store of [memory, sql.store]) {
    const before = character();
    const result = await store.commitContribution(contribution(1, 11));
    assert.equal(result.ok, true);
    assert.equal(result.character.version, 2);
    assert.deepEqual(await store.saveCharacter({ ...before, data: freshData('stale overwrite') }),
      { ok: false, why: 'conflict' });
    const current = await store.loadCharacter(WORLD, EPOCH, CHAR);
    assert.deepEqual(current, result.character);
    assert.equal(current.data.name, before.data.name);
    assert.equal(current.data.gold, before.data.gold);
    assert.equal(current.data.eco.pack.goods.madera, 5);
  }
});

test('two concurrent ordinary saves with the same expected revision admit exactly one CAS', async t => {
  const sql = await sqlFixture(t);
  const memory = createMemoryContributionStore({ characters: [character()], projects: [project()] });
  for (const store of [memory, sql.store]) {
    const [a, b] = await Promise.all(['A', 'B'].map(name => store.saveCharacter({ ...character(), data: freshData(name) })));
    assert.equal([a, b].filter(x => x.ok).length, 1);
    assert.equal([a, b].filter(x => !x.ok && x.why === 'conflict').length, 1);
    const current = await store.loadCharacter(WORLD, EPOCH, CHAR);
    assert.equal(current.version, 2);
    assert.ok(['A', 'B'].includes(current.data.name));
    assert.equal(current.data.gold, 999);
  }
});

test('save CAS is scoped, denies missing or stale rows, and accepts the last incrementable revision', async t => {
  const sql = await sqlFixture(t);
  const memory = createMemoryContributionStore({ characters: [character()], projects: [project()] });
  for (const store of [memory, sql.store]) {
    assert.deepEqual(await store.saveCharacter({ ...character(), characterId: uuid(77) }), { ok: false, why: 'missing' });
    assert.deepEqual(await store.saveCharacter({ ...character(), worldEpoch: uuid(8) }), { ok: false, why: 'missing' });
    assert.deepEqual(await store.saveCharacter({ ...character(), worldId: 'world:other' }), { ok: false, why: 'missing' });
    const advanced = await store.saveCharacter({ ...character(), data: freshData('advanced') });
    assert.equal(advanced.ok, true);
    assert.deepEqual(await store.saveCharacter({ ...character(), data: freshData('stale') }), { ok: false, why: 'conflict' });
  }

  const max = character(2147483646);
  const memoryMax = createMemoryContributionStore({ characters: [max] });
  const sqlMax = await database(undefined, { sessionSaves: true }); t.after(() => sqlMax.close());
  await sqlMax.store.initializeCharacter(max);
  for (const store of [memoryMax, sqlMax.store]) {
    const saved = await store.saveCharacter({ ...max, data: freshData('last revision') });
    assert.equal(saved.ok, true);
    assert.equal(saved.character.version, 2147483647);
    await assert.rejects(store.saveCharacter(saved.character), ContributionError);
  }
});

test('save validates full profile rows and raw SQL stays service-role only', async t => {
  const sql = await sqlFixture(t);
  for (const malformed of [
    { row: { ...character(), version: 2147483647 }, raw: JSON.stringify({ ...character(), version: 2147483647 }) },
    { row: { ...character(), version: 1.5 }, raw: JSON.stringify({ ...character(), version: 1.5 }) },
    { row: { ...character(), data: { ...character().data, eco: { ...character().data.eco,
      pack: { ...character().data.eco.pack, goods: { madera: Number.POSITIVE_INFINITY } } } } },
      raw: JSON.stringify({ ...character(), data: { ...character().data, eco: { ...character().data.eco,
        pack: { ...character().data.eco.pack, goods: { madera: null } } } } }) },
    { row: Object.assign(character(), { unexpected: true }), raw: JSON.stringify(Object.assign(character(), { unexpected: true })) },
  ]) {
    await assert.rejects(sql.store.saveCharacter(malformed.row), ContributionError);
    await assert.rejects(sql.db.query('SELECT public.mn_comm_save_character($1::jsonb)', [malformed.raw]));
  }
  await sql.db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(sql.db.query('SELECT public.mn_comm_save_character($1::jsonb)', [character()]));
  await sql.db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(sql.db.query('SELECT public.mn_comm_save_character($1::jsonb)', [character()]));
  await sql.db.exec('RESET ROLE; SET ROLE service_role');
  assert.equal((await sql.db.query('SELECT has_function_privilege(\'anon\', \'public.mn_comm_save_character(jsonb)\', \'EXECUTE\') AS allowed')).rows[0].allowed, false);
  assert.equal((await sql.db.query('SELECT has_function_privilege(\'authenticated\', \'public.mn_comm_save_character(jsonb)\', \'EXECUTE\') AS allowed')).rows[0].allowed, false);
});

test('session save migration reapplication preserves current rows and the deployed function contract', async t => {
  const sql = await sqlFixture(t);
  const data = freshData('before reapply');
  await sql.store.saveCharacter({ ...character(), data });
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(communitySessionSql);
  await sql.db.exec('SET ROLE service_role');
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), { ...character(2), data });
  const saved = await sql.store.saveCharacter({ ...character(2), data: freshData('after reapply') });
  assert.equal(saved.ok, true);
  assert.equal(saved.character.version, 3);
});

test('a lost save reply is unavailable; current-row load resolves outcome and stale retry cannot reapply', async t => {
  let loseFirstSaveReply = true;
  const sql = await sqlFixture(t, { adapterOptions: { loseReply: name => {
    if (name !== 'mn_comm_save_character' || !loseFirstSaveReply) return false;
    loseFirstSaveReply = false; return true;
  } } });
  await assert.rejects(sql.store.saveCharacter({ ...character(), data: freshData('written once') }),
    e => e.code === 'unavailable');
  const current = await sql.store.loadCharacter(WORLD, EPOCH, CHAR);
  assert.equal(current.version, 2);
  assert.equal(current.data.name, 'written once');
  assert.deepEqual(await sql.store.saveCharacter({ ...character(), data: freshData('retry') }),
    { ok: false, why: 'conflict' });
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), current);
});
