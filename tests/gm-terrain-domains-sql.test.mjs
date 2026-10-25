import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// SQL042's ordered migration harness, with no dependency on the concurrent JS v6 validator.
const directory = new URL('../server/migrations/', import.meta.url);
const names = (await readdir(directory)).filter(name => /^\d{3}_.*\.sql$/.test(name) && name <= '044_gm_terrain_domains.sql').sort();
assert.equal(names.at(-1), '044_gm_terrain_domains.sql');
const sql044 = await readFile(new URL(names.at(-1), directory), 'utf8');
const template = new PGlite();
await template.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; ' +
  'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
for (const name of names.slice(0, -1)) await template.exec(await readFile(new URL(name, directory), 'utf8'));
after(() => template.close());
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const domain = { minTx: -12, maxTx: 3, minTz: -4, maxTz: 3 };
const bytes = Buffer.alloc(13, 1), sha = createHash('sha256').update(bytes).digest('hex');
const object = y => ({ id: 'crate', assetId: 'prop:storage-crate', collider: 'none',
  transform: { position: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } });
const v6 = (tiles = [], objects = []) => ({ schema: 'marea.gm.map-draft', version: 6,
  base: { seed: 42, revision: 'terrain-s21-v1' }, objects, baseOverrides: [],
  terrain: { version: 4, tileSize: 70, domain: { ...domain }, tiles } });
const v5 = (tiles = [], objects = []) => ({ ...v6(tiles, objects), version: 5, terrain: { version: 3, tileSize: 70, tiles } });
const request = document => ({ world: 'domains-sql', owner, expectedRevision: 0, document });
const data = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].data;
const ready = db => data(db, 'SELECT public.mn_gm_terrain_domains_ready() AS data');
const valid = (db, document) => data(db, 'SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS data',
  [operation(99), JSON.stringify(request(document))]);
const save = (db, n, document) => data(db, 'SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data',
  [operation(n), JSON.stringify(request(document))]);
async function database(t) { const db = await template.clone(); t.after(() => db.close()); return db; }
async function migrate(db) { await db.exec(sql044); await db.exec(sql044); }

test('SQL044 re-applies; v2-v5 validation, saves and receipts keep their SQL042 behavior', async t => {
  const db = await database(t);
  const cases = [v5(), v5([[-4, -4, sha, 13], [3, 3, sha, 65536]], [object(256)]),
    v5([[4, 0, sha, 13]]), v5([], [object(300)]), { ...v5(), extra: true }];
  const before = await Promise.all(cases.map(document => valid(db, document)));
  assert.deepEqual(before, [true, true, false, false, false]);
  const v2 = { ...v5(), version: 2 }; delete v2.terrain;
  const older = [v2, { ...v2, version: 3, terrain: { version: 1, samples: [] } },
    { ...v2, version: 4, terrain: { version: 2, samples: [], materials: [] } }, v5()];
  const saved = await save(db, 1, v5()); assert.equal(saved.ok, true);
  assert.deepEqual(await save(db, 2, v6()), { ok: false, why: 'operation' });
  const receipts = (await db.query('SELECT * FROM public.mn_gm_draft_operations')).rows;
  await migrate(db);
  assert.deepEqual(await Promise.all(cases.map(document => valid(db, document))), before);
  for (const document of older) assert.equal(await valid(db, document), true);
  assert.deepEqual((await db.query('SELECT * FROM public.mn_gm_draft_operations')).rows, receipts);
  assert.deepEqual(await save(db, 1, v5()), { ...saved, replay: true });
});

test('a grown v6 saves its original domain and tile; missing blobs still leave no receipt', async t => {
  const db = await database(t); await migrate(db); await db.exec('SET ROLE service_role');
  const document = v6([[-10, 0, sha, bytes.length]], [object(-64), { ...object(256), id: 'high' }]);
  assert.deepEqual(await save(db, 1, document), { ok: false, why: 'tiles_missing', missing: [sha] });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.mn_gm_draft_operations')).rows[0].n, 0);
  await data(db, 'SELECT public.mn_put_gm_terrain_tiles($1,$2::jsonb) AS data',
    ['domains-sql', JSON.stringify([{ sha256: sha, b64: bytes.toString('base64') }])]);
  const saved = await save(db, 1, document);
  assert.equal(saved.ok, true); assert.equal(saved.head.revision, 1); assert.deepEqual(saved.head.document, document);
  assert.deepEqual(await save(db, 1, document), { ...saved, replay: true });
});

test('v6 domain, terrain, ordering, byte and transform constraints fail closed', async t => {
  const db = await database(t); await migrate(db);
  const changedDomain = patch => { const d = v6(); Object.assign(d.terrain.domain, patch); return d; };
  const extraTerrain = v6(); extraTerrain.terrain.extra = true;
  const override = v6(); override.baseOverrides = [{ id: 'base:rock:1:ab', hidden: false, transform: object(300).transform }];
  const cases = [
    ['canonical', changedDomain({ minTx: -4 })], ['bound 64', changedDomain({ maxTx: 64 })],
    ['bound -65', changedDomain({ minTx: -65 })], ['not containing base', changedDomain({ maxTz: 2 })],
    ['width 33', changedDomain({ minTx: -29 })], ['height 33', changedDomain({ minTz: -29 })],
    ['fractional', changedDomain({ minTx: -12.5 })], ['string', changedDomain({ minTx: '-12' })],
    ['extra domain key', changedDomain({ extra: true })], ['extra terrain key', extraTerrain],
    ['reversed bounds', changedDomain({ minTx: 4 })], ['tile outside', v6([[-13, 0, sha, 13]])],
    ['order', v6([[-10, 1, sha, 13], [-9, 0, sha, 13]])],
    ['duplicate', v6([[-10, 0, sha, 13], [-10, 0, sha, 13]])],
    ['y 300', v6([], [object(300)])], ['override y 300', override],
    ['unknown revision', { ...v6(), base: { seed: 42, revision: 'unknown' } }],
    ['extra document key', { ...v6(), extra: true }], ['uppercase sha', v6([[-10, 0, sha.toUpperCase(), 13]])],
    ['short bytes', v6([[-10, 0, sha, 12]])], ['large bytes', v6([[-10, 0, sha, 65537]])],
    ['fractional tile key', v6([[-10.5, 0, sha, 13]])], ['tuple size', v6([[-10, 0, sha]])],
    ['257 tiles', v6(Array.from({ length: 257 }, () => [-10, 0, sha, 13]))],
  ];
  assert.equal(await valid(db, v6([[-12, -4, sha, 13], [3, 3, sha, 65536]])), true);
  for (const [n, [label, document]] of cases.entries()) {
    assert.equal(await valid(db, document), false, label);
    assert.deepEqual(await save(db, n + 10, document), { ok: false, why: 'operation' }, label);
  }
});

test('readiness is service_role only and detects validator privileges and missing tile readiness', async t => {
  const db = await database(t); await migrate(db); await db.exec('SET ROLE service_role');
  assert.deepEqual(await ready(db), { version: 1 });
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(ready(db), { code: '42501' });
  }
  for (const [breakIt, repair] of [
    ['GRANT EXECUTE ON FUNCTION public.mn_valid_gm_draft_request_v5(uuid,jsonb) TO service_role',
      'REVOKE EXECUTE ON FUNCTION public.mn_valid_gm_draft_request_v5(uuid,jsonb) FROM service_role'],
    ['GRANT EXECUTE ON FUNCTION public.mn_valid_gm_draft_request_v5(uuid,jsonb) TO PUBLIC',
      'REVOKE EXECUTE ON FUNCTION public.mn_valid_gm_draft_request_v5(uuid,jsonb) FROM PUBLIC'],
    ['REVOKE EXECUTE ON FUNCTION public.mn_gm_terrain_tiles_ready() FROM service_role',
      'GRANT EXECUTE ON FUNCTION public.mn_gm_terrain_tiles_ready() TO service_role'],
    ['ALTER FUNCTION public.mn_valid_gm_draft_request_v5(uuid,jsonb) RENAME TO hidden_v5',
      'ALTER FUNCTION public.hidden_v5(uuid,jsonb) RENAME TO mn_valid_gm_draft_request_v5'],
  ]) {
    await db.exec(`RESET ROLE; ${breakIt}; SET ROLE service_role`);
    await assert.rejects(ready(db), { code: '42501' });
    await db.exec(`RESET ROLE; ${repair}; SET ROLE service_role`);
    assert.deepEqual(await ready(db), { version: 1 });
  }
});
