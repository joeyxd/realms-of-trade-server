import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database as baseDatabase } from './helpers/ground-transaction-sql.mjs';

const sql020 = await readFile(new URL('../server/migrations/020_gm_drafts.sql', import.meta.url), 'utf8');
const sql031 = await readFile(new URL('../server/migrations/031_gm_terrain_drafts.sql', import.meta.url), 'utf8');
const sql033 = await readFile(new URL('../server/migrations/033_gm_terrain_materials.sql', import.meta.url), 'utf8');
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const v2 = () => ({ schema: 'marea.gm.map-draft', version: 2,
  base: { seed: 42, revision: 'terrain-s21-v1' }, objects: [], baseOverrides: [] });
const v3 = (samples = [[123, 1]]) => ({ ...v2(), version: 3, terrain: { version: 1, samples } });
const v4 = (samples = [[123, 1]], materials = [[123, 255, 0, 0, 0]]) =>
  ({ ...v2(), version: 4, terrain: { version: 2, samples, materials } });
const request = (document, expectedRevision = 0) => ({ world: 'salty-shore', owner, expectedRevision, document });

async function setup(t) {
  const f = await baseDatabase();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  await f.db.exec(sql020);
  await f.db.exec('SET ROLE service_role');
  return f;
}

async function valid(db, op, value) {
  return (await db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid', [op, value])).rows[0].valid;
}

test('SQL033 preserves v2/v3 receipts and stores/replays v4 material terrain', async t => {
  const f = await setup(t), legacyRequest = request(v2());
  const legacy = (await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(1), legacyRequest])).rows[0].data;

  await f.db.exec('RESET ROLE'); await f.db.exec(sql031); await f.db.exec('SET ROLE service_role');
  const terrainRequest = request(v3(), 1);
  const terrain = (await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(2), terrainRequest])).rows[0].data;

  await f.db.exec('RESET ROLE'); await f.db.exec(sql033); await f.db.exec(sql033); await f.db.exec('SET ROLE service_role');
  assert.deepEqual((await f.db.query('SELECT public.mn_gm_material_drafts_ready() AS data')).rows[0].data,
    { version: 1, terrainVersion: 2 });
  assert.deepEqual((await f.db.query('SELECT public.mn_gm_terrain_drafts_ready() AS data')).rows[0].data,
    { version: 1, terrainVersion: 1 }, 'the SQL031 readiness contract remains unchanged');
  assert.deepEqual((await f.db.query('SELECT public.mn_gm_drafts_ready() AS data')).rows[0].data,
    { version: 1 }, 'the existing adapter readiness contract remains unchanged');
  assert.deepEqual((await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(1), legacyRequest])).rows[0].data, { ...legacy, replay: true });
  assert.deepEqual((await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(2), terrainRequest])).rows[0].data, { ...terrain, replay: true });

  const materialRequest = request(v4(), 2);
  const saved = (await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(3), materialRequest])).rows[0].data;
  assert.equal(saved.ok, true);
  assert.equal(saved.head.revision, 3);
  assert.deepEqual(saved.head.document, materialRequest.document);
  assert.deepEqual((await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(3), materialRequest])).rows[0].data, { ...saved, replay: true });
  assert.deepEqual((await f.db.query('SELECT document FROM public.mn_gm_drafts WHERE world=$1 AND owner_id=$2::uuid',
    ['salty-shore', owner])).rows[0].document, materialRequest.document);
  const storedV3 = (await f.db.query('SELECT request FROM public.mn_gm_draft_operations WHERE operation_id=$1::uuid',
    [operation(2)])).rows[0].request;
  assert.deepEqual(storedV3, terrainRequest, 'the v3 receipt JSON is not rewritten by the migration');
});

test('SQL033 enforces canonical v4 height and material bounds independently', async t => {
  const f = await setup(t);
  await f.db.exec('RESET ROLE'); await f.db.exec(sql031); await f.db.exec(sql033); await f.db.exec('RESET ROLE');
  const id = operation(4);
  assert.equal(await valid(f.db, id, request(v2())), true);
  assert.equal(await valid(f.db, id, request(v3())), true);
  assert.equal(await valid(f.db, id, request(v4([[0, -12000], [314720, 12000]],
    [[0, 1, 0, 0, 0], [314720, 0, 0, 0, 255]]))), true);
  const twentyThousand = Array.from({ length: 20000 }, (_, index) => index);
  assert.equal(await valid(f.db, id, request(v4(twentyThousand.map(index => [index, 1]),
    twentyThousand.map(index => [index, 1, 0, 0, 0])))), true,
  'height and material lists each receive their own 20,000-entry allowance');

  const malformed = [
    { ...v4(), extra: true },
    { ...v4(), terrain: { ...v4().terrain, extra: false } },
    { ...v4(), terrain: { ...v4().terrain, version: 1 } },
    v4([[1, 1], [0, 1]]), v4([[1, 1], [1, 2]]), v4([[314721, 1]]), v4([[1, 0]]),
    v4([], [[1, 1, 0, 0]]), v4([], [[1, 1, 0, 0, 0, 0]]),
    v4([], [[1, 0, 0, 0, 0]]), v4([], [[1, 256, 0, 0, 0]]), v4([], [[1, 255, 1, 0, 0]]),
    v4([], [[2, 1, 0, 0, 0], [1, 1, 0, 0, 0]]),
    v4([], [[1, 1, 0, 0, 0], [1, 0, 1, 0, 0]]),
    v4([], [[314721, 1, 0, 0, 0]]), v4([], [[1.5, 1, 0, 0, 0]]),
    v4([], [[1, -1, 2, 0, 0]]), v4([], [[1, 1.5, 0, 0, 0]]),
    v4(Array.from({ length: 20001 }, (_, index) => [index, 1])),
    v4([], Array.from({ length: 20001 }, (_, index) => [index, 1, 0, 0, 0])),
  ];
  for (const [index, document] of malformed.entries()) assert.equal(await valid(f.db, id, request(document)), false,
    `rejects malformed v4 fixture ${index}: ${JSON.stringify(document).slice(0, 120)}`);

  const fractionalChannel = JSON.stringify(request(v4([], [[1, 1, 0, 0, 0]])))
    .replace('"materials":[[1,1,0,0,0]]', '"materials":[[1,1.0,0,0,0]]');
  const fractionalVersion = JSON.stringify(request(v4([], [])))
    .replace('"terrain":{"version":2,', '"terrain":{"version":2.0,');
  const fractionalDocumentVersion = JSON.stringify(request(v4([], []))).replace('"version":4,', '"version":4.0,');
  assert.equal((await f.db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid',
    [id, fractionalChannel])).rows[0].valid, false);
  assert.equal((await f.db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid',
    [id, fractionalVersion])).rows[0].valid, false);
  assert.equal((await f.db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid',
    [id, fractionalDocumentVersion])).rows[0].valid, false);
});

test('SQL033 readiness is private and validators remain uncallable', async t => {
  const f = await setup(t);
  await f.db.exec('RESET ROLE'); await f.db.exec(sql031); await f.db.exec(sql033); await f.db.exec('SET ROLE service_role');
  const acl = (await f.db.query(`SELECT
    has_function_privilege('service_role','public.mn_gm_material_drafts_ready()','EXECUTE') AS ready_service,
    has_function_privilege('anon','public.mn_gm_material_drafts_ready()','EXECUTE') AS ready_anon,
    has_function_privilege('authenticated','public.mn_gm_material_drafts_ready()','EXECUTE') AS ready_user,
    has_function_privilege('service_role','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') AS wrapper_service,
    has_function_privilege('anon','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') AS wrapper_anon,
    has_function_privilege('authenticated','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') AS wrapper_user,
    has_function_privilege('service_role','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') AS v3_service,
    has_function_privilege('anon','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') AS v3_anon,
    has_function_privilege('authenticated','public.mn_valid_gm_draft_request_v3(uuid,jsonb)','EXECUTE') AS v3_user`)).rows[0];
  assert.deepEqual(acl, { ready_service: true, ready_anon: false, ready_user: false,
    wrapper_service: false, wrapper_anon: false, wrapper_user: false,
    v3_service: false, v3_anon: false, v3_user: false });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`SET ROLE ${role}`);
    await assert.rejects(f.db.query('SELECT public.mn_gm_material_drafts_ready()'));
    await f.db.exec('RESET ROLE'); await f.db.exec('SET ROLE service_role');
  }
  assert.deepEqual((await f.db.query('SELECT public.mn_gm_material_drafts_ready() AS data')).rows[0].data,
    { version: 1, terrainVersion: 2 });
});
