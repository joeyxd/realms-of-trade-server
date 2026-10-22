import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createDocument } from '../src/editor/document.js';
import { encodeTile, TERRAIN_TILES_NOT_READY, TILE_VERTICES } from '../src/editor/terrainTiles.js';

// GM07b2a SQL042 (docs/briefs/gm07b2-server.md S1, S2, S9): draft terrain tiles, the v5 validator wrapper, the
// tiles_missing save, the bounded collector and the readiness RPC, on top of every earlier migration in order.
const DIRECTORY = new URL('../server/migrations/', import.meta.url);
const NAMES = (await readdir(DIRECTORY)).filter(name => /^\d{3}_.*\.sql$/.test(name) && name <= '042_gm_terrain_tiles.sql').sort();
assert.equal(NAMES.at(-1), '042_gm_terrain_tiles.sql');
const sql042 = await readFile(new URL(NAMES.at(-1), DIRECTORY), 'utf8');
const BASE = 'terrain-s21-v1';
const WORLD = 'salty-shore';
const OTHER = 'other-shore';
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const entry = bytes => ({ sha256: hash(bytes), b64: b64(bytes) });

// SQL001-041 once (about 1.5 s); each test clones it and applies SQL042 twice (it is re-appliable like its peers).
// service_role bypasses RLS as in Supabase; anon and authenticated do not.
const template = new PGlite();
await template.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; ' +
  'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
for (const name of NAMES.slice(0, -1)) await template.exec(await readFile(new URL(name, DIRECTORY), 'utf8'));
after(() => template.close());

async function database(t, { migrate = true } = {}) {
  const db = await template.clone();
  t.after(() => db.close());
  if (migrate) await apply042(db);
  else await db.exec('SET ROLE service_role');
  return db;
}
async function apply042(db) {
  await db.exec('RESET ROLE'); await db.exec(sql042); await db.exec(sql042); await db.exec('SET ROLE service_role');
}
async function asOwner(db, run) {
  await db.exec('RESET ROLE');
  try { return await run(); } finally { await db.exec('SET ROLE service_role'); }
}
const data = async (db, sql, params) => (await db.query(sql, params)).rows[0].data;
const put = (db, world, tiles) => data(db, 'SELECT public.mn_put_gm_terrain_tiles($1,$2::jsonb) AS data',
  [world, JSON.stringify(tiles)]);
const get = (db, world, hashes) => data(db, 'SELECT public.mn_get_gm_terrain_tiles($1,$2::text[]) AS data', [world, hashes]);
const save = (db, n, request) => data(db, 'SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data', [operation(n), request]);
const ready = db => data(db, 'SELECT public.mn_gm_terrain_tiles_ready() AS data');
const receipts = async (db, n) => (await db.query(
  'SELECT count(*)::int AS n FROM public.mn_gm_draft_operations WHERE operation_id=$1::uuid', [operation(n)])).rows[0].n;
const rows = async (db, world) => (await db.query(
  'SELECT sha256, created_at FROM public.mn_gm_terrain_tiles WHERE world=$1 ORDER BY sha256', [world])).rows;
const sqlState = code => error => error?.code === code;

function tile(tx, tz, delta = 1000) {
  const deltasMm = new Int32Array(TILE_VERTICES);
  deltasMm[5 * 70 + 5] = delta;
  return encodeTile({ tx, tz, deltasMm, channels: [] }, BASE);
}
const reference = (bytes, tx, tz) => [tx, tz, hash(bytes), bytes.length];
const object = (id, y) => ({ id, assetId: 'prop:storage-crate',
  transform: { position: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none' });
const v5 = (tiles = [], objects = []) => ({ schema: 'marea.gm.map-draft', version: 5, base: { seed: 42, revision: BASE },
  objects, baseOverrides: [], terrain: { version: 3, tileSize: 70, tiles } });
const request = (document, expectedRevision = 0, world = WORLD) => ({ world, owner, expectedRevision, document });

// The Supabase adapter over this database: the transport the server uses, with its base64 tile bytes.
function adapter(db) {
  const calls = {
    mn_gm_drafts_ready: () => 'SELECT public.mn_gm_drafts_ready() AS data',
    mn_gm_material_drafts_ready: () => 'SELECT public.mn_gm_material_drafts_ready() AS data',
    mn_gm_terrain_tiles_ready: () => 'SELECT public.mn_gm_terrain_tiles_ready() AS data',
  };
  return createSupabaseGmDraftMethods({ async rpc(name, args) {
    try {
      let value;
      if (calls[name]) value = await data(db, calls[name]());
      else if (name === 'mn_put_gm_terrain_tiles') value = await put(db, args.p_world, args.p_tiles);
      else if (name === 'mn_get_gm_terrain_tiles') value = await get(db, args.p_world, args.p_hashes);
      else if (name === 'mn_load_gm_draft') value = await data(db, 'SELECT public.mn_load_gm_draft($1,$2::uuid) AS data',
        [args.p_world, args.p_owner]);
      else if (name === 'mn_save_gm_draft') value = await data(db,
        'SELECT public.mn_save_gm_draft($1::uuid,$2::jsonb) AS data', [args.p_operation_id, args.p_request]);
      else throw new Error(`Unexpected RPC: ${name}`);
      return { data: JSON.parse(JSON.stringify(value)), error: null };
    } catch (error) { return { data: null, error: { code: error.code ?? 'XX000', message: error.message } }; }
  } });
}

test('SQL042 loads after SQL001-041, re-applies, and its readiness answers {version: 1} only while the contract holds', async t => {
  const db = await database(t);
  assert.deepEqual(await ready(db), { version: 1 });
  assert.deepEqual(await data(db, 'SELECT public.mn_gm_drafts_ready() AS data'), { version: 1 });
  assert.deepEqual(await data(db, 'SELECT public.mn_gm_terrain_drafts_ready() AS data'), { version: 1, terrainVersion: 1 });
  assert.deepEqual(await data(db, 'SELECT public.mn_gm_material_drafts_ready() AS data'), { version: 1, terrainVersion: 2 });
  const store = adapter(db);
  assert.deepEqual(await store.checkGmTerrainTiles(), { version: 1 });
  assert.deepEqual(await store.checkGmDrafts(), { version: 1 });

  for (const [label, breakIt, repair] of [
    ['a table grant to anon', 'GRANT SELECT ON public.mn_gm_terrain_tiles TO anon',
      'REVOKE ALL ON public.mn_gm_terrain_tiles FROM anon'],
    ['an insert grant to service_role', 'GRANT INSERT ON public.mn_gm_terrain_tiles TO service_role',
      'REVOKE INSERT ON public.mn_gm_terrain_tiles FROM service_role'],
    ['an execute grant to authenticated', 'GRANT EXECUTE ON FUNCTION public.mn_put_gm_terrain_tiles(text,jsonb) TO authenticated',
      'REVOKE EXECUTE ON FUNCTION public.mn_put_gm_terrain_tiles(text,jsonb) FROM authenticated'],
    ['a dropped hash check', 'ALTER TABLE public.mn_gm_terrain_tiles DROP CONSTRAINT mn_gm_terrain_tiles_hash_check',
      'ALTER TABLE public.mn_gm_terrain_tiles ADD CONSTRAINT mn_gm_terrain_tiles_hash_check ' +
      "CHECK (pg_catalog.sha256(bytes) = pg_catalog.decode(sha256, 'hex'))"],
  ]) {
    await asOwner(db, () => db.exec(breakIt));
    await assert.rejects(ready(db), sqlState('42501'), label);
    await assert.rejects(store.checkGmTerrainTiles(), { code: 'unavailable' }, label);
    await asOwner(db, () => db.exec(repair));
    assert.deepEqual(await ready(db), { version: 1 }, `${label} repaired`);
  }
});

test('anon and authenticated can neither execute the tile RPCs nor read the tile table', async t => {
  const db = await database(t);
  const functions = ['public.mn_put_gm_terrain_tiles(text,jsonb)', 'public.mn_get_gm_terrain_tiles(text,text[])',
    'public.mn_gm_terrain_tiles_ready()', 'public.mn_save_gm_draft(uuid,jsonb)'];
  const validators = ['public.mn_valid_gm_draft_request(uuid,jsonb)', 'public.mn_valid_gm_draft_request_v4(uuid,jsonb)'];
  const privilege = async (role, kind, target, what) => (await db.query(
    `SELECT has_${kind}_privilege($1,$2,$3) AS ok`, [role, target, what])).rows[0].ok;
  for (const fn of functions) {
    assert.equal(await privilege('service_role', 'function', fn, 'EXECUTE'), true, fn);
    for (const role of ['anon', 'authenticated']) assert.equal(await privilege(role, 'function', fn, 'EXECUTE'), false, `${role} ${fn}`);
  }
  for (const fn of validators) for (const role of ['service_role', 'anon', 'authenticated']) {
    assert.equal(await privilege(role, 'function', fn, 'EXECUTE'), false, `${role} ${fn}`);
  }
  for (const what of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    assert.equal(await privilege('service_role', 'table', 'public.mn_gm_terrain_tiles', what), what === 'SELECT', what);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await privilege(role, 'table', 'public.mn_gm_terrain_tiles', what), false, `${role} ${what}`);
    }
  }
  const a = tile(0, 0);
  assert.deepEqual(await put(db, WORLD, [entry(a)]), { ok: true, stored: 1 });
  for (const role of ['anon', 'authenticated']) {
    await db.exec('RESET ROLE'); await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(put(db, WORLD, [entry(a)]), sqlState('42501'), `${role} put`);
      await assert.rejects(get(db, WORLD, [hash(a)]), sqlState('42501'), `${role} get`);
      await assert.rejects(ready(db), sqlState('42501'), `${role} ready`);
      await assert.rejects(db.query('SELECT sha256 FROM public.mn_gm_terrain_tiles'), sqlState('42501'), `${role} select`);
      await assert.rejects(db.query('DELETE FROM public.mn_gm_terrain_tiles'), sqlState('42501'), `${role} delete`);
    } finally { await db.exec('RESET ROLE'); await db.exec('SET ROLE service_role'); }
  }
  assert.equal((await rows(db, WORLD)).length, 1);
});

test('put is idempotent: the same tile twice keeps one row and refreshes created_at; get answers plain base64', async t => {
  const db = await database(t), a = tile(0, 0), b = tile(1, 0), absent = tile(2, 0);
  assert.deepEqual(await put(db, WORLD, [entry(a)]), { ok: true, stored: 1 });
  await asOwner(db, () => db.query(
    "UPDATE public.mn_gm_terrain_tiles SET created_at = now() - interval '2 days' WHERE world=$1", [WORLD]));
  const before = (await rows(db, WORLD))[0].created_at;
  assert.deepEqual(await put(db, WORLD, [entry(a)]), { ok: true, stored: 1 });
  const again = await rows(db, WORLD);
  assert.equal(again.length, 1, 'one row per (world, sha256)');
  assert.ok(again[0].created_at - before > 47 * 3600 * 1000, 'a re-upload refreshes created_at');
  assert.deepEqual(await put(db, WORLD, [entry(b), entry(a), entry(b)]), { ok: true, stored: 2 },
    'a batch counts each tile once');
  assert.equal((await rows(db, WORLD)).length, 2);

  const got = await get(db, WORLD, [hash(absent), hash(b), hash(a)]);
  assert.deepEqual(got.map(item => item.sha256), [hash(a), hash(b)].sort(), 'present tiles only, in hash order');
  for (const item of got) {
    assert.deepEqual(Object.keys(item).sort(), ['b64', 'sha256']);
    assert.doesNotMatch(item.b64, /\s/, 'encode() line breaks are stripped');
    assert.equal(item.b64, b64(item.sha256 === hash(a) ? a : b));
  }
  assert.deepEqual(await get(db, OTHER, [hash(a)]), [], 'tiles belong to their world');
  assert.deepEqual(await get(db, WORLD, []), []);

  const store = adapter(db), c = tile(3, 0);
  assert.deepEqual(await store.putTerrainTiles({ world: WORLD, tiles: [c, a] }), { ok: true, stored: 2 });
  const read = await store.getTerrainTiles({ world: WORLD, hashes: [hash(c), hash(absent), hash(a)] });
  assert.deepEqual([...read.keys()], [hash(c), hash(a)]);
  assert.deepEqual(read.get(hash(c)), c);
  assert.deepEqual(read.get(hash(a)), a);
});

test('put refuses a hash mismatch, sizes outside 13..65536 and malformed batches; the table CHECKs hold on their own', async t => {
  const db = await database(t), a = tile(0, 0), b = tile(1, 0);
  const sized = length => { const bytes = new Uint8Array(length); bytes[0] = 1; return bytes; };
  const refused = [
    ['hash mismatch', [{ sha256: hash(a), b64: b64(b) }]],
    ['over 65,536 bytes', [entry(sized(65537))]],
    ['under 13 bytes', [entry(sized(12))]],
    ['a good tile then a mismatch', [entry(a), { sha256: hash(a), b64: b64(b) }]],
    ['uppercase hash', [{ sha256: hash(a).toUpperCase(), b64: b64(a) }]],
    ['invalid base64', [{ sha256: hash(a), b64: '@@@@' }]],
    ['an extra key', [{ ...entry(a), bytes: a.length }]],
    ['a missing key', [{ sha256: hash(a) }]],
    ['17 tiles', Array.from({ length: 17 }, () => entry(a))],
    ['no tile', []],
  ];
  for (const [label, tiles] of refused) await assert.rejects(put(db, WORLD, tiles), sqlState('MNG03'), label);
  await assert.rejects(put(db, 'bad world', [entry(a)]), sqlState('MNG03'), 'world');
  await assert.rejects(data(db, 'SELECT public.mn_put_gm_terrain_tiles($1,$2::jsonb) AS data', [WORLD, '{}']), sqlState('MNG03'));
  assert.deepEqual(await rows(db, WORLD), [], 'a refused batch stores nothing');
  assert.deepEqual(await put(db, WORLD, [entry(sized(13)), entry(sized(65536))]), { ok: true, stored: 2 },
    'the length bounds are inclusive');

  await assert.rejects(get(db, WORLD, Array.from({ length: 65 }, () => hash(a))), sqlState('MNG03'), 'more than 64 hashes');
  await assert.rejects(get(db, WORLD, [hash(a).toUpperCase()]), sqlState('MNG03'));
  await assert.rejects(get(db, WORLD, ['abc']), sqlState('MNG03'));

  const insert = (sha256, bytes) => asOwner(db, () => db.query(
    'INSERT INTO public.mn_gm_terrain_tiles(world,sha256,bytes) VALUES($1,$2,$3)', [OTHER, sha256, bytes]));
  await assert.rejects(insert(hash(a), b), sqlState('23514'), 'sha256(bytes) must equal the key');
  await assert.rejects(insert(hash(sized(65537)), sized(65537)), sqlState('23514'));
  await assert.rejects(insert(hash(sized(12)), sized(12)), sqlState('23514'));
  await assert.rejects(insert(hash(a).toUpperCase(), a), sqlState('23514'));
  await assert.rejects(asOwner(db, () => db.query('INSERT INTO public.mn_gm_terrain_tiles(world,sha256,bytes) VALUES($1,$2,$3)',
    ['bad world', hash(a), a])), sqlState('23514'));
});

test('a v5 save with a missing tile answers tiles_missing without a receipt; after the put the same operation id saves', async t => {
  const db = await database(t), a = tile(0, 0), b = tile(1, 0);
  const document = v5([reference(a, 0, 0), reference(b, 1, 0)]), saving = request(document);
  assert.deepEqual(await save(db, 1, saving), { ok: false, why: 'tiles_missing', missing: [hash(a), hash(b)].sort() });
  assert.equal(await receipts(db, 1), 0, 'no receipt for tiles_missing');
  assert.equal(await data(db, 'SELECT public.mn_load_gm_draft($1,$2::uuid) AS data', [WORLD, owner]), null);
  await put(db, WORLD, [entry(a)]);
  await put(db, OTHER, [entry(b)]);
  assert.deepEqual(await save(db, 1, saving), { ok: false, why: 'tiles_missing', missing: [hash(b)] },
    'only the tiles still missing in this world');
  assert.deepEqual(await save(db, 2, request(v5([[0, 0, hash(a), a.length + 1]]))),
    { ok: false, why: 'tiles_missing', missing: [hash(a)] }, 'the stored length must equal the declared bytes');
  assert.equal(await receipts(db, 1) + await receipts(db, 2), 0);

  await put(db, WORLD, [entry(b)]);
  const saved = await save(db, 1, saving);
  assert.equal(saved.ok, true);
  assert.equal(saved.replay, false);
  assert.equal(saved.head.revision, 1);
  assert.deepEqual(saved.head.document, document);
  assert.equal(await receipts(db, 1), 1);
  assert.deepEqual(await save(db, 1, saving), { ...saved, replay: true });
  assert.deepEqual((await data(db, 'SELECT public.mn_load_gm_draft($1,$2::uuid) AS data', [WORLD, owner])).document, document);
  assert.deepEqual(await save(db, 3, saving), { ok: false, why: 'conflict', revision: 1 });

  // The same flow through the Supabase adapter: base64 upload, tiles_missing, retry with the same operation id.
  const store = adapter(db), c = tile(2, 0), next = createDocument({ seed: 42, baseRevision: BASE,
    terrain: { version: 3, tileSize: 70, tiles: [reference(a, 0, 0), reference(c, 2, 0)] } });
  const input = { world: WORLD, owner, operationId: operation(4), expectedRevision: 1, document: next };
  assert.deepEqual(await store.saveGmDraft(input), { ok: false, why: 'tiles_missing', missing: [hash(c)] });
  assert.deepEqual(await store.putTerrainTiles({ world: WORLD, tiles: [c] }), { ok: true, stored: 1 });
  const retried = await store.saveGmDraft(input);
  assert.equal(retried.ok, true);
  assert.equal(retried.head.revision, 2);
  assert.deepEqual((await store.loadGmDraft({ world: WORLD, owner })).document, next);
});

test('v5 validation: object y 256 saves and 257 does not; tile keys must be sorted, unique and inside the domain', async t => {
  const db = await database(t), a = tile(0, 0), b = tile(1, 0), c = tile(0, 1);
  await put(db, WORLD, [entry(a), entry(b), entry(c)]);
  const ok = await save(db, 1, request(v5([reference(a, 0, 0), reference(b, 1, 0), reference(c, 0, 1)],
    [object('high', 256), object('low', -64)])));
  assert.equal(ok.ok, true, JSON.stringify(ok).slice(0, 200));
  const refusedSaves = [
    ['object y 257', v5([], [object('too-high', 257)])],
    ['object y -64.5', v5([], [object('too-low', -64.5)])],
    ['base override y 257', { ...v5(), baseOverrides: [{ id: 'base:rock:1:ab', hidden: false,
      transform: object('x', 257).transform }] }],
    ['unsorted keys', v5([reference(b, 1, 0), reference(a, 0, 0)])],
    ['tz before tx order', v5([reference(c, 0, 1), reference(b, 1, 0)])],
    ['duplicate key', v5([reference(a, 0, 0), [0, 0, hash(b), b.length]])],
    ['tx 4 outside the domain', v5([[4, 0, hash(a), a.length]])],
    ['tz -5 outside the domain', v5([[0, -5, hash(a), a.length]])],
  ];
  for (const [n, [label, document]] of refusedSaves.entries()) {
    assert.deepEqual(await save(db, 10 + n, request(document, 1)), { ok: false, why: 'operation' }, label);
    assert.equal(await receipts(db, 10 + n), 0, label);
  }

  // The wrapper itself (owner only), for the remaining structural rules.
  const valid = (document, raw = null) => asOwner(db, async () => (await db.query(
    'SELECT public.mn_valid_gm_draft_request($1::uuid,$2::jsonb) AS ok',
    [operation(99), raw ?? JSON.stringify(request(document))])).rows[0].ok);
  const sha = 'f'.repeat(64);
  assert.equal(await valid(v5([[-4, -4, sha, 13], [3, 3, sha.replace('f', 'e'), 65536]])), true, 'domain corners and byte bounds');
  const malformed = [
    ['tileSize 64', { ...v5(), terrain: { version: 3, tileSize: 64, tiles: [] } }],
    ['terrain version 2', { ...v5(), terrain: { version: 2, tileSize: 70, tiles: [] } }],
    ['an extra terrain key', { ...v5(), terrain: { ...v5().terrain, extra: true } }],
    ['an extra document key', { ...v5(), extra: true }],
    ['unknown base revision', { ...v5(), base: { seed: 42, revision: 'terrain-s99' } }],
    ['uppercase sha256', v5([[0, 0, sha.toUpperCase(), 100]])],
    ['short sha256', v5([[0, 0, sha.slice(1), 100]])],
    ['bytes 12', v5([[0, 0, sha, 12]])],
    ['bytes 65537', v5([[0, 0, sha, 65537]])],
    ['three fields', v5([[0, 0, sha]])],
    ['string key', v5([['0', 0, sha, 100]])],
    ['fractional key', v5([[0.5, 0, sha, 100]])],
    ['257 entries', v5(Array.from({ length: 257 }, (_, n) => [(n % 8) - 4, Math.floor(n / 8) - 4, sha, 100]))],
    ['y as a string', v5([], [object('s', '1')])],
    ['too many objects (SQL020 rule through v4)', v5([], Array.from({ length: 5001 }, (_, n) => object(`o${n}`, 0)))],
  ];
  for (const [label, document] of malformed) assert.equal(await valid(document), false, label);
  const text = JSON.stringify(request(v5([[0, 0, sha, 100]])));
  assert.equal(await valid(null, text.replace('"version":5,', '"version":5.0,')), false, 'version 5.0');
  assert.equal(await valid(null, text.replace('"tileSize":70', '"tileSize":70.0')), false, 'tileSize 70.0');
  assert.equal(await valid(null, text.replace('[[0,0,', '[[0.0,0,')), false, 'tx 0.0');
  assert.equal(await valid(null, text.replace(',100]]', ',100.0]]')), false, 'bytes 100.0');
  assert.equal(await valid(null, text.replace('"version":5,', '"version":"5",')), false, 'version "5"');
});

test('the collector in put deletes at most 256 old unreferenced tiles of that world and keeps referenced or fresh ones', async t => {
  const db = await database(t), held = tile(0, 0), fresh = tile(1, 0), trigger = tile(2, 0), later = tile(3, 0);
  await put(db, WORLD, [entry(held)]);
  assert.equal((await save(db, 1, request(v5([reference(held, 0, 0)])))).ok, true);
  await asOwner(db, async () => {
    await db.query("UPDATE public.mn_gm_terrain_tiles SET created_at = now() - interval '3 days' WHERE world=$1", [WORLD]);
    // 300 old unreferenced tiles: synthetic 16-byte blobs (the table needs only the length and hash rules).
    for (const world of [WORLD, OTHER]) await db.query(`INSERT INTO public.mn_gm_terrain_tiles(world,sha256,bytes,created_at)
      SELECT $1, encode(sha256(s.b),'hex'), s.b, now() - interval '25 hours' - g * interval '1 second'
      FROM generate_series(1, 300) g CROSS JOIN LATERAL (SELECT decode(lpad(to_hex(g), 32, '0'), 'hex') AS b) s`, [world]);
    await db.query(`INSERT INTO public.mn_gm_terrain_tiles(world,sha256,bytes,created_at)
      VALUES($1,$2,$3,now() - interval '23 hours')`, [WORLD, hash(fresh), fresh]);
  });
  const old = async world => (await db.query(`SELECT count(*)::int AS n FROM public.mn_gm_terrain_tiles
    WHERE world=$1 AND created_at < now() - interval '24 hours' AND sha256 <> $2`, [world, hash(held)])).rows[0].n;
  const has = async (world, bytes) => (await get(db, world, [hash(bytes)])).length === 1;

  assert.deepEqual(await put(db, WORLD, [entry(trigger)]), { ok: true, stored: 1 });
  assert.equal(await old(WORLD), 300 - 256, 'at most 256 per call');
  const left = (await db.query(`SELECT min(created_at) AS oldest FROM public.mn_gm_terrain_tiles
    WHERE world=$1 AND sha256 <> $2`, [WORLD, hash(held)])).rows[0].oldest;
  // Kept: the 44 youngest of the old ones (25 h + 1..44 s); newest-first would have kept 25 h + 257..300 s.
  assert.ok(Date.now() - left < (25 * 3600 + 150) * 1000, 'the oldest go first');
  assert.equal(await has(WORLD, held), true, 'an old tile a head references stays');
  assert.equal(await has(WORLD, fresh), true, 'a tile younger than 24 h stays');
  assert.equal(await has(WORLD, trigger), true);
  assert.equal(await old(OTHER), 300, 'other worlds are not collected');

  assert.deepEqual(await put(db, WORLD, [entry(trigger)]), { ok: true, stored: 1 });
  assert.equal(await old(WORLD), 0);
  assert.equal(await has(WORLD, held), true);

  // Once the head moves on, the old tile it referenced is collectible like any other.
  await put(db, WORLD, [entry(later)]);
  assert.equal((await save(db, 2, request(v5([reference(later, 3, 0)]), 1))).ok, true);
  await put(db, WORLD, [entry(trigger)]);
  assert.equal(await has(WORLD, held), false);
  assert.equal(await has(WORLD, fresh), true);
});

test('with SQL042 applied v2-v4 saves still work and older receipts replay byte for byte; before it only v5 is refused', async t => {
  const db = await database(t, { migrate: false });
  const v2 = { schema: 'marea.gm.map-draft', version: 2, base: { seed: 42, revision: BASE }, objects: [], baseOverrides: [] };
  const v3 = { ...v2, version: 3, terrain: { version: 1, samples: [[123, 1]] } };
  const v4 = { ...v2, version: 4, terrain: { version: 2, samples: [[123, 1]], materials: [[123, 255, 0, 0, 0]] } };
  const before = [await save(db, 1, request(v2)), await save(db, 2, request(v3, 1)), await save(db, 3, request(v4, 2))];
  assert.deepEqual(before.map(result => result.ok), [true, true, true]);
  const stored = (await db.query('SELECT operation_id, request, result FROM public.mn_gm_draft_operations ORDER BY operation_id')).rows;
  const store = adapter(db), a = tile(0, 0);
  await assert.rejects(store.checkGmTerrainTiles(), { code: 'unavailable' });
  await assert.rejects(store.saveGmDraft({ world: WORLD, owner, operationId: operation(4), expectedRevision: 3,
    document: v5() }), { code: TERRAIN_TILES_NOT_READY });
  await assert.rejects(store.putTerrainTiles({ world: WORLD, tiles: [a] }), { code: TERRAIN_TILES_NOT_READY });
  assert.deepEqual(await save(db, 4, request(v5(), 3)), { ok: false, why: 'operation' }, 'SQL033 alone refuses version 5');

  await apply042(db);
  assert.deepEqual((await db.query('SELECT operation_id, request, result FROM public.mn_gm_draft_operations ORDER BY operation_id')).rows,
    stored, 'SQL042 rewrites no receipt');
  for (const [n, document, expected] of [[1, v2, 0], [2, v3, 1], [3, v4, 2]]) {
    assert.deepEqual(await save(db, n, request(document, expected)), { ...before[n - 1], replay: true });
  }
  const v4again = await store.saveGmDraft({ world: WORLD, owner, operationId: operation(5), expectedRevision: 3,
    document: { ...v4, terrain: { version: 2, samples: [[124, 2]], materials: [[124, 0, 255, 0, 0]] } } });
  assert.equal(v4again.ok, true);
  assert.equal(v4again.head.revision, 4);
  const v5saved = await store.saveGmDraft({ world: WORLD, owner, operationId: operation(6), expectedRevision: 4, document: v5() });
  assert.equal(v5saved.ok, true, 'a v5 without tiles saves once SQL042 is in');
  assert.equal(v5saved.head.revision, 5);
});
