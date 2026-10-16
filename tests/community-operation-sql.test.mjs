import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { operationDatabase, operationAdapter } from './helpers/community-operation-sql.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = id(1), ACCOUNT = id(2), CHAR = id(3), PROJECT = 'salty:hall';
const profile = (name = 'Nerea', goods = { madera: 6 }) => ({ v: 1, name, eco: { pack: { cap: 40, goods } } });
const binding = (overrides = {}) => ({ accountId: ACCOUNT, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, ...overrides });
const character = ({ name = 'Nerea', version = 1, goods = { madera: 6 }, characterId = CHAR,
  worldId = WORLD, worldEpoch = EPOCH } = {}) => ({ worldId, worldEpoch, characterId, version, data: profile(name, goods) });
const save = (operationId = id(10), changes = {}) => {
  const { accountId = ACCOUNT, ...characterChanges } = changes;
  const request = character({ name: 'Saved', ...characterChanges });
  return { operationId, binding: binding({ accountId, worldId: request.worldId, worldEpoch: request.worldEpoch,
    characterId: request.characterId }), kind: 'save', request };
};
const contribution = (operationId = id(20), changes = {}) => ({ operationId, binding: binding(), kind: 'contribution', request: {
  operationId, worldId: WORLD, worldEpoch: EPOCH, characterId: CHAR, projectId: PROJECT,
  good: 'madera', amount: 2, expectedCharacterVersion: 1, expectedProjectVersion: 1, ...changes,
} });
async function seeded(t, options = {}) {
  const sql = await operationDatabase(undefined, options); t.after(() => sql.close());
  const c = character();
  await sql.store.initializeCharacter(c);
  await sql.store.initializeBinding(binding());
  await sql.store.initializeProject({ worldId: WORLD, worldEpoch: EPOCH, projectId: PROJECT, version: 1,
    requirements: { madera: 10 }, contributed: { madera: 0 } });
  return sql;
}
const rawRpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
};

test('Supabase SDK journals a save once and keeps a completed historical result after later ordinary writes', async t => {
  const sql = await seeded(t, { reapply: true }), intent = save();
  const prepared = await sql.operationStore.prepareOperation(intent);
  assert.deepEqual(prepared, { intent, state: 'pending', result: null });
  assert.deepEqual(await sql.operationStore.prepareOperation(intent), prepared);
  const completed = await sql.operationStore.commitOperation(intent);
  assert.equal(completed.state, 'complete'); assert.equal(completed.result.ok, true);
  assert.equal(completed.result.character.version, 2); assert.equal(completed.result.character.data.name, 'Saved');
  assert.deepEqual(await sql.operationStore.commitOperation(intent), completed);
  await sql.store.saveCharacter({ ...completed.result.character, data: profile('Ordinary newer save') });
  assert.deepEqual(await sql.operationStore.loadOperation(intent.operationId), completed);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).data.name, 'Ordinary newer save');
});

test('exact intent collisions, missing ownership, and one-pending-per-character are rejected', async t => {
  const sql = await seeded(t), first = save(id(30));
  await sql.operationStore.prepareOperation(first);
  await assert.rejects(sql.operationStore.prepareOperation({ ...first, request: character({ name: 'changed' }) }));
  await assert.rejects(sql.operationStore.prepareOperation(save(id(31))));
  await assert.rejects(sql.operationStore.prepareOperation(save(id(32), { characterId: id(90) })));
  await assert.rejects(sql.operationStore.prepareOperation(save(id(33), { characterId: id(91), worldId: 'world:other' })));
});

test('contribution receipt and journal share a global UUID namespace in both insertion orders', async t => {
  const sql = await seeded(t), contributionIntent = contribution(id(40));
  const prior = await sql.store.commitContribution(contributionIntent.request);
  assert.equal(prior.ok, true);
  await assert.rejects(sql.operationStore.prepareOperation(save(id(40))));

  const pendingSave = save(id(41));
  await sql.operationStore.prepareOperation(pendingSave);
  await assert.rejects(sql.store.commitContribution(contribution(id(41)).request));
  assert.equal((await sql.operationStore.loadOperation(id(41))).state, 'pending');
});

test('contribution commits once and its durable journal result always retains replay false', async t => {
  const sql = await seeded(t), intent = contribution(id(50));
  await sql.operationStore.prepareOperation(intent);
  const completed = await sql.operationStore.commitOperation(intent);
  assert.equal(completed.result.ok, true); assert.equal(completed.result.replay, false);
  assert.equal(completed.result.character.version, 2); assert.equal(completed.result.project.version, 2);
  assert.deepEqual(await sql.operationStore.commitOperation(intent), completed);
  assert.equal((await sql.operationStore.loadOperation(intent.operationId)).result.replay, false);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 4);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 2);
});

test('journal can adopt an exact preexisting contribution receipt without marking it as a replay', async t => {
  const sql = await seeded(t), intent = contribution(id(55));
  const existing = await sql.store.commitContribution(intent.request);
  const entry = await sql.operationStore.prepareOperation(intent);
  assert.equal(entry.state, 'complete'); assert.equal(entry.result.ok, true);
  assert.equal(entry.result.replay, false); assert.equal(entry.result.accepted, existing.accepted);
  assert.deepEqual(await sql.operationStore.commitOperation(intent), entry);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
});

test('lost prepare response is recoverable by load before explicit commit', async t => {
  const sql = await seeded(t), intent = save(id(60)); let lose = true;
  const lossy = operationAdapter(sql.db, [], { loseReply: name => name === 'mn_comm_prepare_operation' && lose && !(lose = false) });
  await assert.rejects(lossy.store.prepareOperation(intent));
  assert.deepEqual(await sql.operationStore.loadOperation(intent.operationId), { intent, state: 'pending', result: null });
  const completed = await sql.operationStore.commitOperation(intent);
  assert.equal(completed.state, 'complete'); assert.equal(completed.result.character.version, 2);
});

test('lost commit response recovers its receipt and repeated commit performs no second mutation', async t => {
  const sql = await seeded(t), intent = contribution(id(70));
  await sql.operationStore.prepareOperation(intent); let lose = true;
  const lossy = operationAdapter(sql.db, [], { loseReply: name => name === 'mn_comm_commit_operation' && lose && !(lose = false) });
  await assert.rejects(lossy.store.commitOperation(intent));
  const recovered = await sql.operationStore.loadOperation(intent.operationId);
  assert.equal(recovered.state, 'complete'); assert.equal(recovered.result.replay, false);
  assert.deepEqual(await lossy.store.commitOperation(intent), recovered);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).version, 2);
});

test('journal completion failure rolls back contribution inventory, project, and receipt writes', async t => {
  const sql = await seeded(t), intent = contribution(id(80));
  await sql.operationStore.prepareOperation(intent);
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(`CREATE FUNCTION public.mn_comm_operation_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected journal completion fault'; END $$;
    CREATE TRIGGER mn_comm_operation_test_abort BEFORE UPDATE ON public.mn_comm_operation_intents
      FOR EACH ROW EXECUTE FUNCTION public.mn_comm_operation_test_abort(); SET ROLE service_role;`);
  await assert.rejects(sql.operationStore.commitOperation(intent));
  assert.equal((await sql.operationStore.loadOperation(intent.operationId)).state, 'pending');
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), character());
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).version, 1);
  assert.equal(await sql.store.loadContributionReceipt(intent.operationId), null);
});

test('pending list paginates by UUID and isolates world and epoch', async t => {
  const sql = await seeded(t);
  const ids = [id(91), id(92), id(93)];
  for (const [i, operationId] of ids.entries()) {
    const characterId = id(i + 101), accountId = id(i + 111);
    await sql.store.initializeCharacter(character({ characterId })); await sql.store.initializeBinding(binding({ characterId, accountId }));
    await sql.operationStore.prepareOperation(save(operationId, { characterId, accountId }));
  }
  // Distinct bound characters can hold independent pending operations.
  const otherEpoch = binding({ worldEpoch: id(9), characterId: id(109) });
  await sql.store.initializeCharacter(character({ characterId: otherEpoch.characterId, worldEpoch: otherEpoch.worldEpoch }));
  await sql.store.initializeBinding(otherEpoch);
  await sql.operationStore.prepareOperation(save(id(94), { characterId: otherEpoch.characterId, worldEpoch: otherEpoch.worldEpoch }));
  assert.deepEqual((await sql.operationStore.listPendingOperations(WORLD, EPOCH, null, 2)).map(x => x.intent.operationId), ids.slice(0, 2));
  assert.deepEqual((await sql.operationStore.listPendingOperations(WORLD, EPOCH, ids[1], 2)).map(x => x.intent.operationId), [ids[2]]);
  assert.deepEqual((await sql.operationStore.listPendingOperations(WORLD, id(9))).map(x => x.intent.operationId), [id(94)]);
});

test('a pending operation survives PGlite close and reopen and is committed explicitly', async t => {
  const parent = await mkdtemp(path.join(tmpdir(), 'mn-community-operation-'));
  assert.equal(path.resolve(path.dirname(parent)), path.resolve(tmpdir()));
  const dir = path.resolve(parent, 'database'); let sql;
  t.after(async () => { await sql?.close(); await rm(parent, { recursive: true, force: true }); });
  sql = await operationDatabase(dir);
  await sql.store.initializeCharacter(character()); await sql.store.initializeBinding(binding());
  const intent = save(id(100)); await sql.operationStore.prepareOperation(intent);
  await sql.close(); sql = null;
  sql = await operationDatabase(dir);
  assert.deepEqual(await sql.operationStore.loadOperation(intent.operationId), { intent, state: 'pending', result: null });
  const completed = await sql.operationStore.commitOperation(intent);
  assert.equal(completed.state, 'complete'); assert.equal(completed.result.character.version, 2);
});

test('raw journal validation, client ACLs, and immutable update or delete guards fail closed', async t => {
  const sql = await seeded(t), intent = save(id(110));
  await assert.rejects(rawRpc(sql.operationClient, 'mn_comm_prepare_operation', { p_intent: { ...intent, extra: true } }));
  await assert.rejects(sql.db.query('SELECT public.mn_comm_prepare_operation($1::jsonb)', [JSON.stringify({ ...intent, extra: true })]));
  await sql.operationStore.prepareOperation(intent);
  await sql.db.exec('RESET ROLE');
  await assert.rejects(sql.db.exec(`UPDATE public.mn_comm_operation_intents SET intent='{}'::jsonb WHERE operation_id='${intent.operationId}'`));
  await assert.rejects(sql.db.exec(`DELETE FROM public.mn_comm_operation_intents WHERE operation_id='${intent.operationId}'`));
  const completed = await sql.operationStore.commitOperation(intent);
  assert.equal(completed.state, 'complete');
  await assert.rejects(sql.db.exec(`UPDATE public.mn_comm_operation_intents SET result='{}'::jsonb WHERE operation_id='${intent.operationId}'`));
  const grants = (await sql.db.query(`SELECT has_table_privilege('service_role','public.mn_comm_operation_intents','UPDATE') upd,
    has_table_privilege('anon','public.mn_comm_operation_intents','SELECT') anon_read,
    has_function_privilege('anon','public.mn_comm_prepare_operation(jsonb)','EXECUTE') anon_exec`)).rows[0];
  assert.deepEqual(grants, { upd: false, anon_read: false, anon_exec: false });
  await sql.db.exec('SET ROLE anon');
  await assert.rejects(sql.db.query('SELECT * FROM public.mn_comm_operation_intents'), e => e.code === '42501');
  await assert.rejects(sql.db.query('SELECT public.mn_comm_prepare_operation($1::jsonb)', [JSON.stringify(intent)]), e => e.code === '42501');
});
