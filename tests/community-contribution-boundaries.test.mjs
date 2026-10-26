import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';
import { database } from './helpers/community-sql.mjs';

const worldId = 'world:salty-shore', worldEpoch = '00000000-0000-4000-8000-000000000001';
const characterId = '00000000-0000-4000-8000-000000000002', projectId = 'salty:carpentry';
const operationId = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const character = () => ({ worldId, worldEpoch, characterId, version: 1,
  data: { v: 1, eco: { tradeRev: 9, pack: { goods: { madera: 7 } } }, note: '' } });
const project = () => ({ worldId, worldEpoch, projectId, version: 1,
  requirements: { madera: 10 }, contributed: { madera: 2 } });
const request = (n = 100) => ({ operationId: operationId(n), worldId, worldEpoch, characterId,
  projectId, good: 'madera', amount: 1, expectedCharacterVersion: 1, expectedProjectVersion: 1 });

test('revision growth at the profile byte ceiling is a terminal non-mutating denial in both stores', async t => {
  const c = character(), p = project(), r = request();
  c.data.note = 'x'.repeat(131072 - Buffer.byteLength(JSON.stringify(c.data)));
  assert.equal(Buffer.byteLength(JSON.stringify(c.data)), 131072);
  const sql = await database(); t.after(() => sql.close());
  await sql.store.initializeCharacter(c); await sql.store.initializeProject(p);
  const memory = createMemoryContributionStore({ characters: [c], projects: [p] });
  for (const store of [memory, sql.store]) {
    assert.deepEqual(await store.commitContribution(r), { ok: false, why: 'conflict', replay: false });
    assert.deepEqual(await store.loadCharacter(worldId, worldEpoch, characterId), c);
    assert.deepEqual(await store.loadProject(worldId, worldEpoch, projectId), p);
    assert.deepEqual(await store.commitContribution(r), { ok: false, why: 'conflict', replay: true });
  }
});

test('failure on receipt insertion rolls back both updated rows and leaves the operation retryable', async t => {
  const sql = await database(); t.after(() => sql.close());
  const c = character(), p = project(), r = request(101);
  await sql.store.initializeCharacter(c); await sql.store.initializeProject(p);
  await sql.db.exec(`RESET ROLE;
    CREATE FUNCTION public.mn_comm_test_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture receipt insertion failure'; END $$;
    CREATE TRIGGER mn_comm_test_receipt_fail BEFORE INSERT ON public.mn_comm_contributions
      FOR EACH ROW EXECUTE FUNCTION public.mn_comm_test_receipt_fail();
    SET ROLE service_role;`);
  await assert.rejects(sql.store.commitContribution(r), e => e.code === 'unavailable');
  assert.deepEqual(await sql.store.loadCharacter(worldId, worldEpoch, characterId), c);
  assert.deepEqual(await sql.store.loadProject(worldId, worldEpoch, projectId), p);
  assert.equal(await sql.store.loadContributionReceipt(r.operationId), null);
  await sql.db.exec('RESET ROLE; DROP TRIGGER mn_comm_test_receipt_fail ON public.mn_comm_contributions; SET ROLE service_role;');
  const accepted = await sql.store.commitContribution(r);
  assert.equal(accepted.ok, true); assert.equal(accepted.replay, false);
  assert.equal(accepted.character.data.eco.pack.goods.madera, 6);
  assert.equal(accepted.project.contributed.madera, 3);
  assert.deepEqual(await sql.store.loadContributionReceipt(r.operationId), { request: r, result: accepted });
});

test('SQL accepts integer-valued numeric JSON across seeds and denies malformed project requirements', async t => {
  const sql = await database(); t.after(() => sql.close());
  const c = character(), p = project();
  const decimal = JSON.stringify(c).replace('"version":1', '"version":1.0')
    .replace('"tradeRev":9', '"tradeRev":9.0').replace('"madera":7', '"madera":7.0');
  await sql.db.query('SELECT public.mn_comm_initialize_character($1::jsonb)', [decimal]);
  await sql.store.initializeProject(p);
  const accepted = await sql.store.commitContribution(request(102));
  assert.equal(accepted.ok, true); assert.equal(accepted.character.data.eco.tradeRev, 10);
  for (const requirements of [{ madera: 'bad' }, { madera: null }, { madera: [] }, { madera: 0.5 }]) {
    const bad = { ...p, projectId: 'salty:bad', requirements };
    const checked = await sql.db.query('SELECT public.mn_comm_valid_project($1::jsonb) AS valid', [bad]);
    assert.equal(checked.rows[0].valid, false);
    await assert.rejects(sql.db.query('SELECT public.mn_comm_initialize_project($1::jsonb)', [bad]), e => e.code === 'CMI01');
  }
});
