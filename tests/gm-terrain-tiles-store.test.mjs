import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryGmDraftMethods, createSupabaseGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createDocument } from '../src/editor/document.js';
import { encodeTile, TERRAIN_TILES_NOT_READY, TILE_VERTICES } from '../src/editor/terrainTiles.js';

// GM07b2a (docs/briefs/gm07b2-server.md S1-S3, S9 store side): both draft stores hold terrain tiles and save v5
// drafts that reference them.
const BASE = 'terrain-s21-v1';
const WORLD = 'salty-shore';
const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const coded = code => error => error?.code === code;

// One raised vertex at local (5, 5), editable in every tile of the domain; tiles differ by key or by delta.
function tile(tx, tz, delta = 1000) {
  const deltasMm = new Int32Array(TILE_VERTICES);
  deltasMm[5 * 70 + 5] = delta;
  return encodeTile({ tx, tz, deltasMm, channels: [] }, BASE);
}
// The 64 tile keys of terrain-s21-v1, sorted by tz then tx.
const KEYS = Array.from({ length: 64 }, (_, n) => [(n % 8) - 4, Math.floor(n / 8) - 4]);
const reference = (bytes, tx, tz) => [tx, tz, hash(bytes), bytes.length];
const v5 = (tiles = [], objects = []) => createDocument({ seed: 42, baseRevision: BASE, objects,
  terrain: { version: 3, tileSize: 70, tiles } });
const save = (document, n, extra = {}) => ({ world: WORLD, owner, operationId: operation(n), expectedRevision: 0,
  document, ...extra });

// encodeTile never writes these: built byte by byte to reach the canonical checks.
function wideHeights(tx, tz) {
  const bytes = new Uint8Array(12 + TILE_VERTICES * 4), view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x4e, 0x54, 0x31, 1, 70], 0);
  view.setInt16(6, tx, true); view.setInt16(8, tz, true);
  bytes[10] = 2; bytes[11] = 0;
  view.setInt32(12 + (5 * 70 + 5) * 4, 1000, true);
  return bytes;
}
function withKey(bytes, tx) {
  const copy = new Uint8Array(bytes);
  new DataView(copy.buffer).setInt16(6, tx, true);
  return copy;
}

test('memory tile store: put deduplicates and keeps private copies; get answers the present tiles of that world', async () => {
  const store = createMemoryGmDraftMethods(), a = tile(0, 0), b = tile(1, 0), absent = tile(2, 0);
  assert.deepEqual(await store.checkGmTerrainTiles(), { version: 1 });
  assert.deepEqual(await store.putTerrainTiles({ world: WORLD, tiles: [a, b, a] }), { ok: true, stored: 2 });
  assert.deepEqual(await store.putTerrainTiles({ world: WORLD, tiles: [] }), { ok: true, stored: 0 });
  const original = new Uint8Array(a);
  a[100] ^= 0xff; // the caller's buffer is not the stored one
  const got = await store.getTerrainTiles({ world: WORLD, hashes: [hash(b), hash(original), hash(absent), hash(b)] });
  assert.deepEqual([...got.keys()], [hash(b), hash(original)], 'present tiles only, in request order, once');
  assert.deepEqual(got.get(hash(original)), original);
  assert.deepEqual(got.get(hash(b)), b);
  got.get(hash(b))[100] ^= 0xff; // nor is the returned copy
  assert.deepEqual((await store.getTerrainTiles({ world: WORLD, hashes: [hash(b)] })).get(hash(b)), b);
  assert.equal((await store.getTerrainTiles({ world: 'other-world', hashes: [hash(b)] })).size, 0);
  assert.equal((await store.getTerrainTiles({ world: WORLD, hashes: [] })).size, 0);
});

test('memory tile store refuses every bad input with its code and stores nothing from a refused batch', async () => {
  const store = createMemoryGmDraftMethods(), good = tile(0, 0), truncated = good.slice(0, 12);
  const trailing = new Uint8Array(good.length + 1); trailing.set(good);
  const magic = new Uint8Array(good); magic[0] = 0x58;
  await assert.rejects(store.putTerrainTiles({ world: 'bad world', tiles: [good] }), coded('scope'));
  await assert.rejects(store.getTerrainTiles({ world: 'bad world', hashes: [] }), coded('scope'));
  await assert.rejects(store.putTerrainTiles({ world: WORLD, tiles: good }), coded('tile_batch'));
  await assert.rejects(store.putTerrainTiles({ world: WORLD, tiles: Array(65).fill(good) }), coded('tile_batch'),
    'more than 64 tiles');
  await assert.rejects(store.putTerrainTiles({ world: WORLD,
    tiles: [new Uint8Array(3 * 1024 * 1024), new Uint8Array(3 * 1024 * 1024)] }), coded('tile_batch'), 'more than 4 MiB');
  for (const [label, bad] of [['plain array', [...good]], ['magic', magic], ['truncated', truncated],
    ['trailing', trailing], ['key outside the domain limits', withKey(good, 64)], ['non-canonical height encoding', wideHeights(0, 0)],
    ['over 65,536 bytes', new Uint8Array(65537)], ['empty', new Uint8Array(0)]]) {
    await assert.rejects(store.putTerrainTiles({ world: WORLD, tiles: [good, bad] }), coded('tile_invalid'), label);
  }
  assert.equal((await store.getTerrainTiles({ world: WORLD, hashes: [hash(good)] })).size, 0,
    'one bad tile refuses the whole batch');
  for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 7, null]) {
    await assert.rejects(store.getTerrainTiles({ world: WORLD, hashes: [hash(good), bad] }), coded('tile_hash'));
  }
  await assert.rejects(store.getTerrainTiles({ world: WORLD, hashes: hash(good) }), coded('tile_batch'));
  await assert.rejects(store.getTerrainTiles({ world: WORLD, hashes: Array(65).fill(hash(good)) }), coded('tile_batch'));
});

test('memory store saves v5 only with its tiles: tiles_missing writes nothing and the same operation id then succeeds', async () => {
  const store = createMemoryGmDraftMethods(), a = tile(0, 0), b = tile(1, 0);
  const document = v5([reference(a, 0, 0), reference(b, 1, 0)]);
  assert.deepEqual(await store.saveGmDraft(save(document, 1)),
    { ok: false, why: 'tiles_missing', missing: [hash(a), hash(b)].sort() });
  assert.deepEqual(await store.loadGmDraft({ world: WORLD, owner }), { revision: 0, document: null, savedAt: null });
  await store.putTerrainTiles({ world: WORLD, tiles: [a] });
  assert.deepEqual(await store.saveGmDraft(save(document, 1)), { ok: false, why: 'tiles_missing', missing: [hash(b)] });
  assert.deepEqual(await store.saveGmDraft(save(v5([[0, 0, hash(a), a.length + 1]]), 2)),
    { ok: false, why: 'tiles_missing', missing: [hash(a)] }, 'the stored length must equal the declared bytes');
  await store.putTerrainTiles({ world: 'other-world', tiles: [b] });
  assert.deepEqual(await store.saveGmDraft(save(document, 1)), { ok: false, why: 'tiles_missing', missing: [hash(b)] },
    'tiles of another world do not count');
  await store.putTerrainTiles({ world: WORLD, tiles: [b] });
  const saved = await store.saveGmDraft(save(document, 1));
  assert.equal(saved.ok, true);
  assert.equal(saved.replay, false);
  assert.equal(saved.head.revision, 1);
  assert.deepEqual(saved.head.document, document);
  assert.deepEqual(await store.saveGmDraft(save(document, 1)), { ...saved, replay: true });
  assert.deepEqual(await store.loadGmDraft({ world: WORLD, owner }), saved.head, 'a v5 head loads (document only)');
  assert.deepEqual(await store.saveGmDraft(save(document, 3)), { ok: false, why: 'conflict', revision: 1 });
  await assert.rejects(store.saveGmDraft(save(v5([[0, 0, hash(a), 12]]), 4, { expectedRevision: 1 })), coded('document'),
    'no tile is shorter than 13 bytes');
  const empty = await store.saveGmDraft(save(v5(), 5, { expectedRevision: 1 }));
  assert.equal(empty.ok, true, 'a v5 without tiles needs no upload');
});

function fakeClient({ ready = { version: 1 }, readyError = false, putError = null, putStored = null, getData = null,
  saveResult = null, head = null } = {}) {
  const calls = [], tiles = new Map();
  const client = { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'mn_gm_terrain_tiles_ready') {
      if (readyError) return { data: null, error: { code: '42883', message: 'function missing' } };
      return { data: structuredClone(ready), error: null };
    }
    if (name === 'mn_gm_material_drafts_ready') return { data: { version: 1, terrainVersion: 2 }, error: null };
    if (name === 'mn_put_gm_terrain_tiles') {
      if (putError) return { data: null, error: { code: putError, message: 'refused' } };
      for (const entry of args.p_tiles) tiles.set(entry.sha256, Buffer.from(entry.b64, 'base64'));
      return { data: { ok: true, stored: putStored ?? args.p_tiles.length }, error: null };
    }
    if (name === 'mn_get_gm_terrain_tiles') {
      if (getData) return { data: getData(args), error: null };
      return { data: args.p_hashes.filter(sha256 => tiles.has(sha256)).sort()
        .map(sha256 => ({ sha256, b64: tiles.get(sha256).toString('base64') })), error: null };
    }
    if (name === 'mn_save_gm_draft') {
      if (saveResult) return { data: saveResult(args), error: null };
      return { data: { ok: true, replay: false, head: { revision: args.p_request.expectedRevision + 1,
        document: args.p_request.document, savedAt: '2026-10-22T12:00:00.000Z' } }, error: null };
    }
    if (name === 'mn_load_gm_draft') return { data: head, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  } };
  return { calls, tiles, methods: createSupabaseGmDraftMethods(client) };
}

test('Supabase tile put checks every tile, probes readiness, then sends base64 in RPC calls of at most 16 tiles', async () => {
  const blobs = KEYS.map(([tx, tz]) => tile(tx, tz));
  const { calls, tiles, methods } = fakeClient();
  assert.deepEqual(await methods.putTerrainTiles({ world: WORLD, tiles: blobs.slice(0, 20) }), { ok: true, stored: 20 });
  assert.deepEqual(calls.map(call => call.name),
    ['mn_gm_terrain_tiles_ready', 'mn_put_gm_terrain_tiles', 'mn_put_gm_terrain_tiles']);
  assert.deepEqual(calls.slice(1).map(call => call.args.p_tiles.length), [16, 4]);
  for (const [n, entry] of [...calls[1].args.p_tiles, ...calls[2].args.p_tiles].entries()) {
    assert.deepEqual(Object.keys(entry), ['sha256', 'b64']);
    assert.equal(entry.sha256, hash(blobs[n]));
    assert.match(entry.b64, /^[A-Za-z0-9+/]+=*$/, 'plain base64, no line breaks');
    assert.deepEqual(new Uint8Array(Buffer.from(entry.b64, 'base64')), blobs[n]);
    assert.equal(calls[1].args.p_world, WORLD);
  }
  assert.equal(tiles.size, 20);

  const whole = fakeClient();
  assert.deepEqual(await whole.methods.putTerrainTiles({ world: WORLD, tiles: blobs }), { ok: true, stored: 64 });
  assert.deepEqual(whole.calls.slice(1).map(call => call.args.p_tiles.length), [16, 16, 16, 16]);

  const refused = fakeClient();
  await assert.rejects(refused.methods.putTerrainTiles({ world: WORLD, tiles: [blobs[0], wideHeights(0, 0)] }),
    coded('tile_invalid'));
  assert.deepEqual(refused.calls, [], 'a bad tile is refused before any RPC');
  const empty = fakeClient();
  assert.deepEqual(await empty.methods.putTerrainTiles({ world: WORLD, tiles: [] }), { ok: true, stored: 0 });
  assert.deepEqual(empty.calls, []);
  await assert.rejects(fakeClient({ putError: 'MNG03' }).methods.putTerrainTiles({ world: WORLD, tiles: [blobs[0]] }),
    coded('tile_invalid'), 'the SQL tile refusal');
  await assert.rejects(fakeClient({ putError: '57014' }).methods.putTerrainTiles({ world: WORLD, tiles: [blobs[0]] }),
    coded('unavailable'));
  await assert.rejects(fakeClient({ putStored: 15 }).methods.putTerrainTiles({ world: WORLD, tiles: blobs.slice(0, 16) }),
    coded('response'));
});

test('Supabase tile get re-hashes every returned tile and refuses any other answer', async () => {
  const a = tile(0, 0), b = tile(1, 0), c = tile(2, 0);
  const { calls, methods } = fakeClient();
  await methods.putTerrainTiles({ world: WORLD, tiles: [a, b] });
  calls.length = 0;
  const got = await methods.getTerrainTiles({ world: WORLD, hashes: [hash(b), hash(c), hash(a), hash(b)] });
  assert.deepEqual(calls, [{ name: 'mn_gm_terrain_tiles_ready', args: {} },
    { name: 'mn_get_gm_terrain_tiles', args: { p_world: WORLD, p_hashes: [hash(b), hash(c), hash(a)] } }]);
  assert.deepEqual([...got.keys()], [hash(b), hash(a)]);
  assert.ok(got.get(hash(a)) instanceof Uint8Array);
  assert.deepEqual(got.get(hash(a)), a);
  assert.deepEqual(got.get(hash(b)), b);
  const none = fakeClient();
  assert.equal((await none.methods.getTerrainTiles({ world: WORLD, hashes: [] })).size, 0);
  assert.deepEqual(none.calls, []);

  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const answers = [
    ['bytes of another tile', () => [{ sha256: hash(a), b64: b64(b) }]],
    ['an unrequested tile', () => [{ sha256: hash(c), b64: b64(c) }]],
    ['the same tile twice', () => [{ sha256: hash(a), b64: b64(a) }, { sha256: hash(a), b64: b64(a) }]],
    ['wrapped base64', () => [{ sha256: hash(a), b64: b64(a).replace(/(.{76})/g, '$1\n') }]],
    ['an extra key', () => [{ sha256: hash(a), b64: b64(a), bytes: a.length }]],
    ['not an array', () => ({ sha256: hash(a), b64: b64(a) })],
    ['more tiles than asked', () => [{ sha256: hash(a), b64: b64(a) }, { sha256: hash(b), b64: b64(b) },
      { sha256: hash(c), b64: b64(c) }]],
  ];
  for (const [label, getData] of answers) {
    await assert.rejects(fakeClient({ getData }).methods.getTerrainTiles({ world: WORLD, hashes: [hash(a), hash(b)] }),
      coded('response'), label);
  }
});

test('Supabase v5 save probes tile readiness first; without SQL042 v5 fails terrain_tiles_not_ready and v3/v4 skip it', async () => {
  const a = tile(0, 0), b = tile(1, 0), document = v5([reference(a, 0, 0), reference(b, 1, 0)]);
  for (const unready of [{ ready: null }, { ready: { version: 2 } }, { ready: { version: 1, extra: true } },
    { ready: [1] }, { readyError: true }]) {
    const { calls, methods } = fakeClient(unready);
    await assert.rejects(methods.checkGmTerrainTiles(), coded('unavailable'));
    calls.length = 0;
    await assert.rejects(methods.saveGmDraft(save(document, 1)), coded(TERRAIN_TILES_NOT_READY));
    await assert.rejects(methods.putTerrainTiles({ world: WORLD, tiles: [a] }), coded(TERRAIN_TILES_NOT_READY));
    await assert.rejects(methods.getTerrainTiles({ world: WORLD, hashes: [hash(a)] }), coded(TERRAIN_TILES_NOT_READY));
    assert.deepEqual(calls.map(call => call.name), Array(3).fill('mn_gm_terrain_tiles_ready'));
  }

  const ready = fakeClient();
  assert.deepEqual(await ready.methods.checkGmTerrainTiles(), { version: 1 });
  ready.calls.length = 0;
  const saved = await ready.methods.saveGmDraft(save(document, 1));
  assert.deepEqual(ready.calls.map(call => call.name), ['mn_gm_terrain_tiles_ready', 'mn_save_gm_draft']);
  assert.deepEqual(ready.calls[1].args, { p_operation_id: operation(1),
    p_request: { world: WORLD, owner, expectedRevision: 0, document } });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.head.document, document);

  const missing = [hash(a), hash(b)].sort();
  const answered = fakeClient({ saveResult: () => ({ ok: false, why: 'tiles_missing', missing }) });
  assert.deepEqual(await answered.methods.saveGmDraft(save(document, 1)), { ok: false, why: 'tiles_missing', missing });
  for (const bad of [[], [...missing].reverse(), [missing[0], missing[0]], [hash(tile(2, 0))], [missing[0].toUpperCase()],
    'x', undefined]) {
    await assert.rejects(fakeClient({ saveResult: () => ({ ok: false, why: 'tiles_missing', missing: bad }) })
      .methods.saveGmDraft(save(document, 1)), coded('response'), JSON.stringify(bad));
  }

  const legacy = fakeClient({ readyError: true });
  const v3 = createDocument({ seed: 42, baseRevision: BASE, terrain: { version: 1, samples: [[123, 1]] } });
  const v4 = createDocument({ seed: 42, baseRevision: BASE, terrain: { version: 2, samples: [[123, 1]],
    materials: [[123, 255, 0, 0, 0]] } });
  assert.equal((await legacy.methods.saveGmDraft(save(v3, 2))).ok, true);
  assert.equal((await legacy.methods.saveGmDraft(save(v4, 3))).ok, true);
  assert.deepEqual(legacy.calls.map(call => call.name),
    ['mn_save_gm_draft', 'mn_gm_material_drafts_ready', 'mn_save_gm_draft']);

  const head = { revision: 4, document, savedAt: '2026-10-22T12:00:00.000Z' };
  assert.deepEqual(await fakeClient({ head }).methods.loadGmDraft({ world: WORLD, owner }), head);
});
