import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database as baseDatabase } from './helpers/ground-transaction-sql.mjs';

const sql020 = await readFile(new URL('../server/migrations/020_gm_drafts.sql', import.meta.url), 'utf8');
const sql031 = await readFile(new URL('../server/migrations/031_gm_terrain_drafts.sql', import.meta.url), 'utf8');
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const v2 = () => ({ schema: 'marea.gm.map-draft', version: 2,
  base: { seed: 42, revision: 'terrain-s21-v1' }, objects: [], baseOverrides: [] });
const v3 = (samples = [[123, 1], [124, -12000]]) => ({ ...v2(), version: 3, terrain: { version: 1, samples } });
const request = (document, expectedRevision = 0) => ({ world: 'salty-shore', owner, expectedRevision, document });

async function setup(t) {
  const f = await baseDatabase();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  await f.db.exec(sql020);
  await f.db.exec('SET ROLE service_role');
  return f;
}

async function valid(db, op, value, validator = 'mn_valid_gm_draft_request') {
  return (await db.query(`SELECT public.${validator}($1::uuid,$2::jsonb) AS valid`, [op, value])).rows[0].valid;
}

test('SQL031 preserves v2 receipts and saves/replays strict v3 terrain drafts', async t => {
  const f = await setup(t), legacyRequest = request(v2());
  const committed = (await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(1), legacyRequest])).rows[0].data;
  assert.equal(committed.ok, true);
  await f.db.exec('RESET ROLE');
  await f.db.exec(sql031);
  await f.db.exec(sql031);
  await f.db.exec('SET ROLE service_role');

  assert.deepEqual((await f.db.query('SELECT public.mn_gm_terrain_drafts_ready() AS data')).rows[0].data,
    { version: 1, terrainVersion: 1 });
  assert.deepEqual((await f.db.query('SELECT public.mn_gm_drafts_ready() AS data')).rows[0].data,
    { version: 1 }, 'the existing adapter readiness contract remains unchanged');
  assert.deepEqual((await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(1), legacyRequest])).rows[0].data, { ...committed, replay: true });

  const terrainRequest = request(v3(), 1);
  const saved = (await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(2), terrainRequest])).rows[0].data;
  assert.equal(saved.ok, true);
  assert.equal(saved.head.revision, 2);
  assert.deepEqual(saved.head.document, terrainRequest.document);
  assert.deepEqual((await f.db.query('SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
    [operation(2), terrainRequest])).rows[0].data, { ...saved, replay: true });
  assert.deepEqual((await f.db.query('SELECT document FROM public.mn_gm_drafts WHERE world=$1 AND owner_id=$2::uuid',
    ['salty-shore', owner])).rows[0].document, terrainRequest.document);
});

test('SQL031 accepts canonical bounds and rejects malformed v3 terrain while retaining the strict v2 path', async t => {
  const f = await setup(t);
  await f.db.exec('RESET ROLE'); await f.db.exec(sql031);
  const id = operation(3);
  assert.equal(await valid(f.db, id, request(v2())), true);
  assert.equal(await valid(f.db, id, request(v3([[0, -12000], [314720, 12000]]))), true);
  assert.equal(await valid(f.db, id, request(v3(Array.from({ length: 20000 }, (_, i) => [i, 1])))), true);

  const invalidDocuments = [
    { ...v3(), extra: true },
    { ...v3(), terrain: { version: 1, samples: [], extra: false } },
    v3([[2, 1], [1, 1]]), v3([[1, 1], [1, 2]]),
    v3([[-1, 1]]), v3([[314721, 1]]), v3([[1.5, 1]]), v3([[1, 0]]),
    v3([[1, 12001]]), v3([[1, -12001]]), v3([[1, 1, 2]]), v3([[1, '2']]),
    v3(Array.from({ length: 20001 }, (_, i) => [i, 1])),
  ];
  for (const [index, document] of invalidDocuments.entries()) assert.equal(await valid(f.db, id, request(document)), false,
    `rejects malformed v3 fixture ${index}: ${JSON.stringify(document).slice(0, 120)}`);
  const fractionalTerrainVersion = JSON.stringify(request(v3([]))).replace('"terrain":{"version":1,', '"terrain":{"version":1.0,');
  const fractionalDocumentVersion = JSON.stringify(request(v3([]))).replace('"version":3,', '"version":3.0,');
  assert.equal((await f.db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid',
    [id, fractionalTerrainVersion])).rows[0].valid, false);
  assert.equal((await f.db.query('SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS valid',
    [id, fractionalDocumentVersion])).rows[0].valid, false);
  assert.equal(await valid(f.db, id, request(v3()), 'mn_valid_gm_draft_request_v2'), false,
    'the preserved SQL020 validator remains v2-only');

  const acl = (await f.db.query(`SELECT has_function_privilege('service_role','public.mn_gm_terrain_drafts_ready()','EXECUTE') AS ready_service,
    has_function_privilege('anon','public.mn_gm_terrain_drafts_ready()','EXECUTE') AS ready_anon,
    has_function_privilege('authenticated','public.mn_gm_terrain_drafts_ready()','EXECUTE') AS ready_user,
    has_function_privilege('service_role','public.mn_gm_drafts_ready()','EXECUTE') AS legacy_ready_service,
    has_function_privilege('service_role','public.mn_valid_gm_draft_request(uuid,jsonb)','EXECUTE') AS wrapper_service,
    has_function_privilege('service_role','public.mn_valid_gm_draft_request_v2(uuid,jsonb)','EXECUTE') AS v2_service`)).rows[0];
  assert.deepEqual(acl, { ready_service: true, ready_anon: false, ready_user: false,
    legacy_ready_service: true, wrapper_service: false, v2_service: false });
});
